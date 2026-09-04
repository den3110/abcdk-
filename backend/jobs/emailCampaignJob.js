// jobs/emailCampaignJob.js
// Gửi chiến dịch email hàng loạt ở background, theo lô + có nhịp nghỉ để tránh
// vượt giới hạn SMTP; hỗ trợ hủy giữa chừng.
import { agenda } from "./agenda.js";
import EmailCampaign from "../models/emailCampaignModel.js";
import User from "../models/userModel.js";
import { sendMarketingEmail } from "../services/emailService.js";
import {
  buildUserFilter,
  unsubscribeUrl,
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

  // Gửi 1 lô song song rồi cập nhật tiến độ; trả về false nếu bị hủy.
  const processBatch = async (recips) => {
    if (await isCanceled(campaignId)) return false;
    await Promise.allSettled(
      recips.map(async ({ email, userId }) => {
        if (!isValidEmail(email)) {
          skipped += 1;
          return;
        }
        const res = await sendMarketingEmail({
          to: email,
          ...emailContent,
          unsubscribeUrl: userId ? unsubscribeUrl(userId) : "",
        });
        if (res?.ok) sent += 1;
        else recordFail(email, res?.error);
      })
    );
    await flushProgress();
    return true;
  };

  try {
    await EmailCampaign.findByIdAndUpdate(campaignId, {
      $set: { status: "running", startedAt: new Date(), sampleFailures: [] },
    });

    if (campaign.audience?.scope === "list") {
      const uniq = [
        ...new Set(
          (campaign.audience.emails || [])
            .map((e) => String(e || "").trim().toLowerCase())
            .filter(Boolean)
        ),
      ];
      await EmailCampaign.findByIdAndUpdate(campaignId, {
        $set: { "progress.total": uniq.length },
      });
      const batches = chunk(
        uniq.map((email) => ({ email, userId: null })),
        BATCH
      );
      for (let i = 0; i < batches.length; i += 1) {
        const ok = await processBatch(batches[i]);
        if (!ok) break;
        if (i < batches.length - 1) await sleep(DELAY_MS);
      }
    } else {
      const filter = await buildUserFilter(campaign.audience || {});
      const total = await User.countDocuments(filter);
      await EmailCampaign.findByIdAndUpdate(campaignId, {
        $set: { "progress.total": total },
      });
      const cursor = User.find(filter)
        .select("email _id")
        .lean()
        .cursor();
      let buffer = [];
      let canceled = false;
      for await (const u of cursor) {
        buffer.push({ email: u.email, userId: u._id });
        if (buffer.length >= BATCH) {
          const ok = await processBatch(buffer);
          buffer = [];
          if (!ok) {
            canceled = true;
            break;
          }
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
