// jobs/emailCampaignJob.js
// Gửi chiến dịch email hàng loạt ở background (theo lô + nhịp nghỉ), ghi nhật ký
// từng người nhận và bỏ qua người đã gửi (để chạy lại an toàn); hỗ trợ hủy.
import { agenda } from "./agenda.js";
import EmailCampaign from "../models/emailCampaignModel.js";
import EmailCampaignRecipient from "../models/emailCampaignRecipientModel.js";
import User from "../models/userModel.js";
import EmailContact from "../models/emailContactModel.js";
import { sendMarketingEmail } from "../services/emailService.js";
import {
  buildUserFilter,
  userUnsubscribeUrl,
  contactUnsubscribeUrl,
  isValidEmail,
} from "../services/emailCampaignService.js";

export const EMAIL_CAMPAIGN_JOB = "email.campaign.send";

const BATCH = Math.max(1, Number(process.env.EMAIL_CAMPAIGN_BATCH) || 10);
const DELAY_MS = Math.max(0, Number(process.env.EMAIL_CAMPAIGN_DELAY_MS) || 2000);
const MAX_SAMPLE_FAILURES = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function isCanceled(campaignId) {
  const c = await EmailCampaign.findById(campaignId).select("status").lean();
  return !c || c.status === "canceled";
}

agenda.define(EMAIL_CAMPAIGN_JOB, async (job, done) => {
  const { campaignId } = job.attrs.data || {};
  const campaign = await EmailCampaign.findById(campaignId);
  if (!campaign) return done();
  if (campaign.status === "canceled") return done();

  const emailContent = {
    subject: campaign.subject,
    previewText: campaign.previewText,
    heading: campaign.heading || campaign.subject,
    bodyHtml: campaign.bodyHtml,
    ctaText: campaign.ctaText,
    ctaUrl: campaign.ctaUrl,
  };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const sampleFailures = [];

  const recordFail = (email, err) => {
    failed += 1;
    if (sampleFailures.length < MAX_SAMPLE_FAILURES)
      sampleFailures.push({ email, error: String(err?.message || err).slice(0, 240) });
  };

  const flushProgress = async () => {
    await EmailCampaign.findByIdAndUpdate(campaignId, {
      $set: {
        "progress.sent": sent,
        "progress.failed": failed,
        "progress.skipped": skipped,
        sampleFailures,
      },
    });
  };

  // recips: [{ email, name, avatar, unsubUrl }]
  const processBatch = async (recips) => {
    if (await isCanceled(campaignId)) return false;
    const emails = recips.map((r) => r.email).filter(Boolean);

    // Bỏ qua người đã gửi thành công trước đó (chạy lại an toàn)
    const already = await EmailCampaignRecipient.find({
      campaign: campaignId,
      email: { $in: emails },
      status: "sent",
    })
      .select("email")
      .lean();
    const doneSet = new Set(already.map((x) => x.email));

    const logDocs = [];
    await Promise.allSettled(
      recips.map(async (r) => {
        const email = String(r.email || "").trim().toLowerCase();
        if (!isValidEmail(email)) {
          skipped += 1;
          return;
        }
        if (doneSet.has(email)) {
          skipped += 1;
          return;
        }
        const res = await sendMarketingEmail({
          to: email,
          ...emailContent,
          unsubscribeUrl: r.unsubUrl || "",
        });
        if (res?.ok) {
          sent += 1;
          logDocs.push({ campaign: campaignId, email, name: r.name || "", avatar: r.avatar || "", status: "sent", sentAt: new Date() });
        } else {
          recordFail(email, res?.error);
          logDocs.push({ campaign: campaignId, email, name: r.name || "", avatar: r.avatar || "", status: "failed", error: String(res?.error?.message || res?.error || "").slice(0, 240), sentAt: new Date() });
        }
      })
    );

    if (logDocs.length) {
      // ordered:false + bỏ qua lỗi trùng key (email đã có bản ghi)
      await EmailCampaignRecipient.insertMany(logDocs, { ordered: false }).catch(() => {});
    }
    await flushProgress();
    return true;
  };

  try {
    await EmailCampaign.findByIdAndUpdate(campaignId, {
      $set: { status: "running", startedAt: new Date(), sampleFailures: [] },
    });

    const scope = campaign.audience?.scope;

    if (scope === "list") {
      const uniq = [
        ...new Set(
          (campaign.audience.emails || [])
            .map((e) => String(e || "").trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      await EmailCampaign.findByIdAndUpdate(campaignId, { $set: { "progress.total": uniq.length } });
      const batches = chunk(
        uniq.map((email) => ({ email, name: "", avatar: "", unsubUrl: "" })),
        BATCH
      );
      for (let i = 0; i < batches.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await processBatch(batches[i]);
        if (!ok) break;
        // eslint-disable-next-line no-await-in-loop
        if (i < batches.length - 1) await sleep(DELAY_MS);
      }
    } else {
      // Nguồn cursor: contactList | user (all/tournament)
      let cursor;
      let total;
      let mapRecip;
      if (scope === "contactList") {
        const filter = { list: campaign.audience.contactList, optOut: { $ne: true } };
        total = await EmailContact.countDocuments(filter);
        cursor = EmailContact.find(filter).select("email name avatar _id").lean().cursor();
        mapRecip = (d) => ({ email: d.email, name: d.name || "", avatar: d.avatar || "", unsubUrl: contactUnsubscribeUrl(d._id) });
      } else {
        const filter = await buildUserFilter(campaign.audience || {});
        total = await User.countDocuments(filter);
        cursor = User.find(filter).select("email name avatar _id").lean().cursor();
        mapRecip = (d) => ({ email: d.email, name: d.name || "", avatar: d.avatar || "", unsubUrl: userUnsubscribeUrl(d._id) });
      }

      await EmailCampaign.findByIdAndUpdate(campaignId, { $set: { "progress.total": total } });

      let buffer = [];
      let canceled = false;
      for await (const d of cursor) {
        buffer.push(mapRecip(d));
        if (buffer.length >= BATCH) {
          // eslint-disable-next-line no-await-in-loop
          const ok = await processBatch(buffer);
          buffer = [];
          if (!ok) {
            canceled = true;
            break;
          }
          // eslint-disable-next-line no-await-in-loop
          await sleep(DELAY_MS);
        }
      }
      if (!canceled && buffer.length) await processBatch(buffer);
      if (canceled) await cursor.close().catch(() => {});
    }

    const finalStatus = (await isCanceled(campaignId)) ? "canceled" : "completed";
    await EmailCampaign.findByIdAndUpdate(campaignId, {
      $set: {
        status: finalStatus,
        finishedAt: new Date(),
        "progress.sent": sent,
        "progress.failed": failed,
        "progress.skipped": skipped,
        sampleFailures,
      },
    });
    done();
  } catch (e) {
    await EmailCampaign.findByIdAndUpdate(campaignId, {
      $set: {
        status: "failed",
        finishedAt: new Date(),
        error: String(e?.message || e).slice(0, 500),
        "progress.sent": sent,
        "progress.failed": failed,
        sampleFailures,
      },
    });
    done(e);
  }
});
