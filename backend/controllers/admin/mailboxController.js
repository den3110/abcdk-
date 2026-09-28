import asyncHandler from "express-async-handler";
import MailboxAccount from "../../models/mailboxAccountModel.js";
import { encryptToken } from "../../services/secret.service.js";
import * as imap from "../../services/mailbox/imap.service.js";
import * as smtp from "../../services/mailbox/smtp.service.js";

/** Ẩn passCipher, chỉ báo hasPassword. */
function publicAccount(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const { passCipher, ...rest } = o;
  return { ...rest, id: o._id, hasPassword: !!passCipher };
}

async function loadAccount(id) {
  const acc = await MailboxAccount.findById(id).lean();
  return acc;
}

/* ========================= Account CRUD ========================= */

// GET /api/admin/mailbox/accounts
export const listAccounts = asyncHandler(async (req, res) => {
  const docs = await MailboxAccount.find().sort({ order: 1, createdAt: 1 });
  res.json({ data: docs.map(publicAccount) });
});

// POST /api/admin/mailbox/accounts
export const createAccount = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.email) {
    res.status(400);
    throw new Error("Thiếu email");
  }
  const doc = new MailboxAccount({
    email: String(b.email).toLowerCase().trim(),
    label: b.label || "",
    fromName: b.fromName || "",
    username: b.username || b.email,
    imapHost: b.imapHost || undefined,
    imapPort: b.imapPort || undefined,
    imapSecure: b.imapSecure,
    smtpHost: b.smtpHost || undefined,
    smtpPort: b.smtpPort || undefined,
    smtpSecure: b.smtpSecure,
    enabled: b.enabled !== false,
    order: b.order || 0,
  });
  if (b.password) doc.passCipher = encryptToken(String(b.password));
  await doc.save();
  res.status(201).json({ data: publicAccount(doc) });
});

// PUT /api/admin/mailbox/accounts/:id
export const updateAccount = asyncHandler(async (req, res) => {
  const doc = await MailboxAccount.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy hộp thư");
  }
  const b = req.body || {};
  const fields = [
    "email",
    "label",
    "fromName",
    "username",
    "imapHost",
    "imapPort",
    "imapSecure",
    "smtpHost",
    "smtpPort",
    "smtpSecure",
    "enabled",
    "order",
  ];
  for (const f of fields) {
    if (b[f] !== undefined) doc[f] = b[f];
  }
  if (b.email) doc.email = String(b.email).toLowerCase().trim();
  // Chỉ đổi mật khẩu khi client gửi password mới (khác rỗng).
  if (b.password) doc.passCipher = encryptToken(String(b.password));
  await doc.save();
  res.json({ data: publicAccount(doc) });
});

// DELETE /api/admin/mailbox/accounts/:id
export const deleteAccount = asyncHandler(async (req, res) => {
  await MailboxAccount.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/mailbox/accounts/:id/test  (hoặc body trực tiếp để test trước khi lưu)
export const testAccount = asyncHandler(async (req, res) => {
  let account;
  if (req.params.id && req.params.id !== "new") {
    account = await loadAccount(req.params.id);
    if (!account) {
      res.status(404);
      throw new Error("Không tìm thấy hộp thư");
    }
    // cho phép override password mới chưa lưu để test
    if (req.body?.password) account.passCipher = encryptToken(String(req.body.password));
  } else {
    const b = req.body || {};
    account = {
      email: b.email,
      username: b.username || b.email,
      imapHost: b.imapHost || "imap.hostinger.com",
      imapPort: b.imapPort || 993,
      imapSecure: b.imapSecure !== false,
      smtpHost: b.smtpHost || "smtp.hostinger.com",
      smtpPort: b.smtpPort || 465,
      smtpSecure: b.smtpSecure !== false,
      passCipher: b.password ? encryptToken(String(b.password)) : "",
    };
  }
  const result = { imap: null, smtp: null };
  try {
    await imap.testImap(account);
    result.imap = { ok: true };
  } catch (e) {
    result.imap = { ok: false, error: e?.message || String(e) };
  }
  try {
    await smtp.testSmtp(account);
    result.smtp = { ok: true };
  } catch (e) {
    result.smtp = { ok: false, error: e?.message || String(e) };
  }
  res.json({
    ok: !!(result.imap.ok && result.smtp.ok),
    ...result,
  });
});

/* ========================= Mail operations ========================= */

async function requireAccount(id, res) {
  const acc = await loadAccount(id);
  if (!acc) {
    res.status(404).json({ error: "Không tìm thấy hộp thư" });
    return null;
  }
  return acc;
}

// GET /:id/folders
export const getFolders = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const folders = await imap.listFolders(acc);
  res.json({ data: folders });
});

// GET /:id/messages?folder=&page=&pageSize=&search=
export const getMessages = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const folder = req.query.folder || "INBOX";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const search = req.query.search || "";
  const data = await imap.listMessages(acc, folder, { page, pageSize, search });
  res.json(data);
});

// GET /:id/message?folder=&uid=
export const getOneMessage = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const folder = req.query.folder || "INBOX";
  const uid = Number(req.query.uid);
  if (!uid) {
    res.status(400);
    throw new Error("Thiếu uid");
  }
  const markSeen = req.query.markSeen !== "0";
  const data = await imap.getMessage(acc, folder, uid, { markSeen });
  res.json({ data });
});

// GET /:id/attachment?folder=&uid=&index=
export const getAttachment = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const folder = req.query.folder || "INBOX";
  const uid = Number(req.query.uid);
  const index = Number(req.query.index) || 0;
  const att = await imap.getAttachment(acc, folder, uid, index);
  if (!att) {
    res.status(404);
    throw new Error("Không tìm thấy tệp đính kèm");
  }
  res.setHeader("Content-Type", att.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(att.filename)}"`,
  );
  res.send(att.content);
});

// POST /:id/mark { folder, uid, seen }
export const markMessage = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const { folder = "INBOX", uid, seen = true } = req.body || {};
  await imap.setSeen(acc, folder, Number(uid), !!seen);
  res.json({ ok: true });
});

// POST /:id/move { folder, uid, target }
export const moveMessage = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const { folder, uid, target } = req.body || {};
  await imap.moveMessage(acc, folder, Number(uid), target);
  res.json({ ok: true });
});

// POST /:id/delete { folder, uid }
export const deleteMessage = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const { folder, uid } = req.body || {};
  const r = await imap.deleteMessage(acc, folder, Number(uid));
  res.json(r);
});

// POST /:id/send { to, cc, bcc, subject, html, text, inReplyTo, references, attachments[] }
export const sendMessage = asyncHandler(async (req, res) => {
  const acc = await requireAccount(req.params.id, res);
  if (!acc) return;
  const b = req.body || {};
  if (!b.to) {
    res.status(400);
    throw new Error("Thiếu người nhận (to)");
  }
  const result = await smtp.sendMail(acc, {
    to: b.to,
    cc: b.cc,
    bcc: b.bcc,
    subject: b.subject,
    html: b.html,
    text: b.text,
    inReplyTo: b.inReplyTo,
    references: b.references,
    attachments: b.attachments,
  });

  // Lưu vào Sent (không chặn nếu lỗi).
  try {
    const sentPath = await imap.findFolderByRole(acc, "sent");
    if (sentPath) await imap.appendMessage(acc, sentPath, result.raw);
  } catch (_) {}

  res.json({ ok: true, messageId: result.messageId });
});
