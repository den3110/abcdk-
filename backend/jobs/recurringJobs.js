// jobs/recurringJobs.js — tự động gia hạn lịch cố định sắp hết (autoRenew)
import { agenda } from "./agenda.js";
import { runRecurringAutoRenew } from "../controllers/venueOpsController.js";

export const RECURRING_AUTORENEW_JOB = "recurring.auto-renew";

agenda.define(RECURRING_AUTORENEW_JOB, async (_job, done) => {
  try {
    const r = await runRecurringAutoRenew();
    if (r?.renewed) console.log(`[recurring.auto-renew] gia hạn ${r.renewed}/${r.plans} lịch`);
    done();
  } catch (e) {
    done(e);
  }
});
