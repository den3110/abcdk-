// controllers/admin/emailCampaignController.js
import asyncHandler from "express-async-handler";
import EmailCampaign from "../../models/emailCampaignModel.js";
import EmailCampaignRecipient from "../../models/emailCampaignRecipientModel.js";
import EmailContact from "../../models/emailContactModel.js";
import User from "../../models/userModel.js";
import { agenda } from "../../jobs/agenda.js";
import { EMAIL_CAMPAIGN_JOB } from "../../jobs/emailCampaignJob.js";
import { sendMarketingEmail } from "../../services/emailService.js";
import {
  countAudience,
  isValidEmail,
  verifyUnsubToken,
} from "../../services/emailCampaignService.js";

function pickAudience(body = {}) {
  const scope = ["all", "tournament", "list", "contactList"].includes(
    body?.audience?.scope
  )
    ? body.audience.scope
    : "all";
  return {
    scope,
    tournament: scope === "tournament" ? body.audience?.tournament || null : null,
    contactList: scope === "contactList" ? body.audience?.contactList || null : null,
    emails:
      scope === "list"
        ? (body.audience?.emails || [])
            .map((e) => String(e || "").trim())
            .filter(Boolean)
        : [],
  };
}

function pickContent(body = {}) {
  return {
    name: String(body.name || "").trim(),
    subject: String(body.subject || "").trim(),
    previewText: String(body.previewText || "").trim(),
    heading: String(body.heading || "").trim(),
    bodyHtml: String(body.bodyHtml || ""),
    ctaText: String(body.ctaText || "").trim(),
    ctaUrl: String(body.ctaUrl || "").trim(),
  };
}

// POST /admin/email-campaigns/estimate
export const estimateCampaignAudience = asyncHandler(async (req, res) => {
  const audience = pickAudience(req.body);
  const count = await countAudience(audience);
  res.json({ count, audience });
});

// POST /admin/email-campaigns
export const createCampaign = asyncHandler(async (req, res) => {
  const content = pickContent(req.body);
  if (!content.subject) {
    res.status(400);
    throw new Error("Thiếu tiêu đề email (subject).");
  }
  const audience = pickAudience(req.body);
  const estimatedCount = await countAudience(audience);
  const campaign = await EmailCampaign.create({
    ...content,
    audience: { ...audience, estimatedCount },
    status: "draft",
    triggeredBy: req.user?._id || null,
  });
  res.status(201).json(campaign);
});

// GET /admin/email-campaigns
export const listCampaigns = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const [items, total] = await Promise.all([
    EmailCampaign.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EmailCampaign.countDocuments(),
  ]);
  res.json({ items, page, limit, total, totalPages: Math.ceil(total / limit) || 1 });
});

// GET /admin/email-campaigns/:id
export const getCampaign = asyncHandler(async (req, res) => {
  const c = await EmailCampaign.findById(req.params.id).lean();
  if (!c) {
    res.status(404);
    throw new Error("Không tìm thấy chiến dịch.");
  }
  res.json(c);
});

// PATCH /admin/email-campaigns/:id  (chỉ khi draft)
export const updateCampaign = asyncHandler(async (req, res) => {
  const c = await EmailCampaign.findById(req.params.id);
  if (!c) {
    res.status(404);
    throw new Error("Không tìm thấy chiến dịch.");
  }
  if (!["draft", "failed", "canceled"].includes(c.status)) {
    res.status(400);
    throw new Error("Chỉ sửa được chiến dịch ở trạng thái nháp.");
  }
  Object.assign(c, pickContent(req.body));
  const audience = pickAudience(req.body);
  c.audience = { ...audience, estimatedCount: await countAudience(audience) };
  await c.save();
  res.json(c);
});

// POST /admin/email-campaigns/test   body: { ...content, emails:[] }
export const sendTestEmail = asyncHandler(async (req, res) => {
  const content = pickContent(req.body);
  if (!content.subject || !content.bodyHtml) {
    res.status(400);
    throw new Error("Cần tiêu đề và nội dung để gửi thử.");
  }
  const emails = [
    ...new Set(
      (req.body.emails || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(isValidEmail)
    ),
  ].slice(0, 5);
  if (!emails.length) {
    res.status(400);
    throw new Error("Nhập ít nhất 1 email hợp lệ để gửi thử.");
  }
  const results = [];
  for (const to of emails) {
    // eslint-disable-next-line no-await-in-loop
    const r = await sendMarketingEmail({ to, ...content, unsubscribeUrl: "" });
    results.push({ to, ok: !!r?.ok, error: r?.ok ? "" : String(r?.error?.message || r?.error || "") });
  }
  res.json({ ok: results.every((r) => r.ok), results });
});

// POST /admin/email-campaigns/:id/send
export const sendCampaign = asyncHandler(async (req, res) => {
  const c = await EmailCampaign.findById(req.params.id);
  if (!c) {
    res.status(404);
    throw new Error("Không tìm thấy chiến dịch.");
  }
  if (["queued", "running"].includes(c.status)) {
    res.status(400);
    throw new Error("Chiến dịch đang chạy.");
  }
  if (!c.subject || !c.bodyHtml) {
    res.status(400);
    throw new Error("Chiến dịch cần tiêu đề và nội dung.");
  }
  const estimatedCount = await countAudience(c.audience || {});
  if (!estimatedCount) {
    res.status(400);
    throw new Error("Không có người nhận nào phù hợp.");
  }

  c.status = "queued";
  c.progress = { total: estimatedCount, sent: 0, failed: 0, skipped: 0 };
  c.sampleFailures = [];
  c.error = "";
  c.startedAt = null;
  c.finishedAt = null;
  c.audience.estimatedCount = estimatedCount;
  await c.save();

  const job = agenda.create(EMAIL_CAMPAIGN_JOB, { campaignId: String(c._id) });
  await job.save();
  c.queueJobId = job?.attrs?._id ? String(job.attrs._id) : "";
  await c.save();

  res.status(202).json({ ok: true, status: "queued", estimatedCount, id: String(c._id) });
});

// POST /admin/email-campaigns/:id/cancel
export const cancelCampaign = asyncHandler(async (req, res) => {
  const c = await EmailCampaign.findById(req.params.id);
  if (!c) {
    res.status(404);
    throw new Error("Không tìm thấy chiến dịch.");
  }
  if (!["queued", "running"].includes(c.status)) {
    res.status(400);
    throw new Error("Chỉ hủy được chiến dịch đang chờ/đang chạy.");
  }
  c.status = "canceled";
  await c.save();
  res.json({ ok: true, status: "canceled" });
});

// DELETE /admin/email-campaigns/:id
export const deleteCampaign = asyncHandler(async (req, res) => {
  const c = await EmailCampaign.findById(req.params.id);
  if (!c) {
    res.status(404);
    throw new Error("Không tìm thấy chiến dịch.");
  }
  if (["queued", "running"].includes(c.status)) {
    res.status(400);
    throw new Error("Không xóa được chiến dịch đang chạy. Hãy hủy trước.");
  }
  await c.deleteOne();
  res.json({ ok: true, _id: req.params.id });
});

// GET /admin/email-campaigns/:id/recipients?status=&page=&q=
export const getCampaignRecipients = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = { campaign: req.params.id };
  if (["sent", "failed", "skipped"].includes(req.query.status))
    filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(
      String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
    filter.$or = [{ email: rx }, { name: rx }];
  }
  const [items, total, sent, failed] = await Promise.all([
    EmailCampaignRecipient.find(filter)
      .sort({ sentAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    EmailCampaignRecipient.countDocuments(filter),
    EmailCampaignRecipient.countDocuments({ campaign: req.params.id, status: "sent" }),
    EmailCampaignRecipient.countDocuments({ campaign: req.params.id, status: "failed" }),
  ]);
  res.json({ items, page, limit, total, totals: { sent, failed } });
});

// GET /api/email/unsubscribe?u=token  (public)
export const unsubscribeEmail = asyncHandler(async (req, res) => {
  const parsed = verifyUnsubToken(req.query.u);
  const page = (title, msg) => `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f8fb;color:#1f2937">
<div style="max-width:460px;margin:12vh auto;padding:28px 24px;background:#fff;border:1px solid #e5e7eb;border-radius:14px;text-align:center">
<div style="display:inline-block;padding:8px 12px;background:#0FA9A2;color:#fff;border-radius:10px;font-weight:700">PickleTour</div>
<h1 style="font-size:20px;margin:18px 0 8px">${title}</h1>
<p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0">${msg}</p>
</div></body></html>`;

  if (!parsed) {
    return res
      .status(400)
      .send(page("Liên kết không hợp lệ", "Liên kết hủy nhận email đã hết hạn hoặc không đúng."));
  }
  if (parsed.kind === "u") {
    await User.updateOne(
      { _id: parsed.id },
      { $set: { marketingEmailOptOut: true, marketingEmailOptOutAt: new Date() } }
    );
  } else {
    await EmailContact.updateOne(
      { _id: parsed.id },
      { $set: { optOut: true, optOutAt: new Date() } }
    );
  }
  return res.send(
    page(
      "Đã hủy nhận email",
      "Bạn sẽ không còn nhận email quảng cáo từ PickleTour. Các email giao dịch (OTP, đặt lại mật khẩu) vẫn được gửi khi cần."
    )
  );
});
