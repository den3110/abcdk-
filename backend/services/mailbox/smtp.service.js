import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { decryptToken } from "../secret.service.js";

function makeTransport(account) {
  const user = account.username || account.email;
  const pass = decryptToken(account.passCipher || "");
  return nodemailer.createTransport({
    host: account.smtpHost || "smtp.hostinger.com",
    port: Number(account.smtpPort) || 465,
    secure: account.smtpSecure !== false,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

/** Tách danh sách địa chỉ (chuỗi "a@x, Tên <b@y>" hoặc mảng) -> [email]. */
function parseAddrList(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  const out = [];
  for (const item of arr) {
    const s = String(item).trim();
    if (!s) continue;
    const m = s.match(/<([^>]+)>/);
    const email = (m ? m[1] : s).trim();
    if (email) out.push(email);
  }
  return out;
}

/** Kiểm tra SMTP (nút Test). */
export async function testSmtp(account) {
  const t = makeTransport(account);
  await t.verify();
  return { ok: true };
}

/**
 * Gửi thư từ 1 mailbox account. Trả về raw MIME (Buffer) để append vào Sent.
 * attachments: [{ filename, contentType, contentBase64 }]
 */
export async function sendMail(account, opts) {
  const fromAddr = account.email;
  const fromName = account.fromName || account.label || "";
  const mailOptions = {
    from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
    to: opts.to,
    cc: opts.cc || undefined,
    bcc: opts.bcc || undefined,
    subject: opts.subject || "(không tiêu đề)",
    text: opts.text || undefined,
    html: opts.html || undefined,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.references || undefined,
    attachments: Array.isArray(opts.attachments)
      ? opts.attachments.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.contentBase64 || "", "base64"),
          contentType: a.contentType || undefined,
        }))
      : undefined,
  };

  // Build raw MIME 1 lần để vừa gửi vừa lưu Sent.
  const raw = await new MailComposer(mailOptions).compile().build();

  const rcpt = [
    ...parseAddrList(opts.to),
    ...parseAddrList(opts.cc),
    ...parseAddrList(opts.bcc),
  ];

  const transport = makeTransport(account);
  const info = await transport.sendMail({
    envelope: { from: fromAddr, to: rcpt },
    raw,
  });

  return { messageId: info.messageId, raw };
}
