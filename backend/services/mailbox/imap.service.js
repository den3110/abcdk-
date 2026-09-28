import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptToken } from "../secret.service.js";

/** Tạo ImapFlow client từ 1 mailbox account (đã giải mã mật khẩu). */
function makeClient(account) {
  const user = account.username || account.email;
  const pass = decryptToken(account.passCipher || "");
  return new ImapFlow({
    host: account.imapHost || "imap.hostinger.com",
    port: Number(account.imapPort) || 993,
    secure: account.imapSecure !== false,
    auth: { user, pass },
    logger: false,
    // Chống treo khi mạng/creds lỗi.
    socketTimeout: 30000,
    greetingTimeout: 15000,
    connectionTimeout: 15000,
  });
}

/** Kết nối, chạy fn(client), luôn logout. */
async function withClient(account, fn) {
  const client = makeClient(account);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch (_) {
      try {
        client.close();
      } catch (_) {}
    }
  }
}

/** Kiểm tra kết nối IMAP (dùng cho nút Test). */
export async function testImap(account) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      return { ok: true, exists: client.mailbox?.exists ?? 0 };
    } finally {
      lock.release();
    }
  });
}

/** Phân loại thư mục theo special-use để UI hiển thị Inbox/Sent/... */
function roleOf(mb) {
  const su = (mb.specialUse || "").toLowerCase();
  if (su.includes("sent")) return "sent";
  if (su.includes("junk") || su.includes("spam")) return "spam";
  if (su.includes("trash") || su.includes("deleted")) return "trash";
  if (su.includes("draft")) return "drafts";
  if (su.includes("archive")) return "archive";
  const p = (mb.path || "").toLowerCase();
  if (p === "inbox") return "inbox";
  return "other";
}

export async function listFolders(account) {
  return withClient(account, async (client) => {
    const list = await client.list();
    const out = [];
    for (const mb of list) {
      if (mb.flags && mb.flags.has && mb.flags.has("\\Noselect")) continue;
      let unseen = 0;
      let total = 0;
      try {
        const status = await client.status(mb.path, {
          messages: true,
          unseen: true,
        });
        total = status.messages || 0;
        unseen = status.unseen || 0;
      } catch (_) {}
      out.push({
        path: mb.path,
        name: mb.name || mb.path,
        role: roleOf(mb),
        total,
        unseen,
      });
    }
    // Ưu tiên thứ tự: inbox, sent, drafts, spam, trash, archive, other
    const rank = {
      inbox: 0,
      sent: 1,
      drafts: 2,
      archive: 3,
      spam: 4,
      trash: 5,
      other: 6,
    };
    out.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9));
    return out;
  });
}

/** Có đính kèm không? duyệt bodyStructure. */
function hasAttachments(node) {
  if (!node) return false;
  const disp = (node.disposition || "").toLowerCase();
  if (disp === "attachment") return true;
  if (Array.isArray(node.childNodes)) {
    return node.childNodes.some((c) => hasAttachments(c));
  }
  return false;
}

function envToAddr(list) {
  if (!Array.isArray(list)) return [];
  return list.map((a) => ({
    name: a.name || "",
    address: a.address ? `${a.address}` : "",
  }));
}

/**
 * Danh sách thư trong 1 folder (mới nhất trước), phân trang + tìm kiếm.
 */
export async function listMessages(
  account,
  folder,
  { page = 1, pageSize = 25, search = "" } = {},
) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const total = client.mailbox?.exists || 0;
      let uids = null;

      if (search && search.trim()) {
        const q = search.trim();
        uids = await client.search(
          {
            or: [
              { subject: q },
              { from: q },
              { to: q },
              { body: q },
            ],
          },
          { uid: true },
        );
        uids = (uids || []).sort((a, b) => b - a); // mới nhất trước
      }

      const messages = [];
      if (uids) {
        const start = (page - 1) * pageSize;
        const slice = uids.slice(start, start + pageSize);
        if (slice.length) {
          for await (const msg of client.fetch(
            slice,
            { envelope: true, flags: true, bodyStructure: true, size: true },
            { uid: true },
          )) {
            messages.push(mapListMsg(msg));
          }
          messages.sort((a, b) => b.uid - a.uid);
        }
        return {
          total: uids.length,
          page,
          pageSize,
          messages,
        };
      }

      // Không search: dùng sequence number, mới nhất trước.
      if (total === 0) return { total: 0, page, pageSize, messages: [] };
      const endSeq = total - (page - 1) * pageSize;
      const startSeq = Math.max(1, endSeq - pageSize + 1);
      if (endSeq < 1) return { total, page, pageSize, messages: [] };
      for await (const msg of client.fetch(
        `${startSeq}:${endSeq}`,
        { envelope: true, flags: true, bodyStructure: true, size: true },
        { uid: false },
      )) {
        messages.push(mapListMsg(msg));
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { total, page, pageSize, messages };
    } finally {
      lock.release();
    }
  });
}

function mapListMsg(msg) {
  const env = msg.envelope || {};
  const flags = msg.flags || new Set();
  return {
    uid: msg.uid,
    subject: env.subject || "(không tiêu đề)",
    from: envToAddr(env.from),
    to: envToAddr(env.to),
    date: env.date || msg.internalDate || null,
    seen: flags.has ? flags.has("\\Seen") : false,
    flagged: flags.has ? flags.has("\\Flagged") : false,
    hasAttachments: hasAttachments(msg.bodyStructure),
    size: msg.size || 0,
    messageId: env.messageId || "",
  };
}

/** Đọc 1 thư đầy đủ (parse html/text + đính kèm). Đánh dấu \Seen. */
export async function getMessage(account, folder, uid, { markSeen = true } = {}) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);
      if (markSeen) {
        try {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
        } catch (_) {}
      }
      const addr = (a) =>
        a
          ? (a.value || []).map((x) => ({
              name: x.name || "",
              address: x.address || "",
            }))
          : [];
      return {
        uid,
        subject: parsed.subject || "(không tiêu đề)",
        from: addr(parsed.from),
        to: addr(parsed.to),
        cc: addr(parsed.cc),
        date: parsed.date || null,
        messageId: parsed.messageId || "",
        inReplyTo: parsed.inReplyTo || "",
        references: parsed.references || "",
        html: parsed.html || "",
        text: parsed.text || "",
        attachments: (parsed.attachments || []).map((a, i) => ({
          index: i,
          filename: a.filename || `attachment-${i}`,
          contentType: a.contentType || "application/octet-stream",
          size: a.size || (a.content ? a.content.length : 0),
          cid: a.cid || null,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

/** Lấy 1 attachment (buffer) theo index (thứ tự parse). */
export async function getAttachment(account, folder, uid, index) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);
      const att = (parsed.attachments || [])[index];
      if (!att) return null;
      return {
        filename: att.filename || `attachment-${index}`,
        contentType: att.contentType || "application/octet-stream",
        content: att.content, // Buffer
      };
    } finally {
      lock.release();
    }
  });
}

export async function setSeen(account, folder, uid, seen) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (seen) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      else await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}

export async function moveMessage(account, folder, uid, target) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uid, target, { uid: true });
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}

/** Xoá: nếu đang ở Trash thì expunge hẳn, ngược lại chuyển vào Trash. */
export async function deleteMessage(account, folder, uid) {
  return withClient(account, async (client) => {
    // tìm trash path
    let trashPath = null;
    try {
      const list = await client.list();
      const trash = list.find((mb) => roleOf(mb) === "trash");
      trashPath = trash ? trash.path : null;
    } catch (_) {}

    const lock = await client.getMailboxLock(folder);
    try {
      const isTrash = trashPath && folder === trashPath;
      if (!trashPath || isTrash) {
        await client.messageDelete(uid, { uid: true });
        return { ok: true, expunged: true };
      }
      await client.messageMove(uid, trashPath, { uid: true });
      return { ok: true, movedTo: trashPath };
    } finally {
      lock.release();
    }
  });
}

/** Lưu 1 bản raw vào folder (dùng để append thư đã gửi vào Sent). */
export async function appendMessage(account, folder, raw, flags = ["\\Seen"]) {
  return withClient(account, async (client) => {
    try {
      await client.append(folder, raw, flags);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

/** Tìm path của folder theo role (vd "sent"). */
export async function findFolderByRole(account, role) {
  return withClient(account, async (client) => {
    const list = await client.list();
    const mb = list.find((m) => roleOf(m) === role);
    return mb ? mb.path : null;
  });
}
