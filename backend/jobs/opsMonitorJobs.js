// jobs/opsMonitorJobs.js — quét sức khoẻ hệ thống định kỳ + báo cáo tổng hợp hằng ngày.
// Chỉ chạy trên instance leader (agenda vốn đã leader-only trong server.js).
import { agenda } from "./agenda.js";
import { runOpsMonitorCycle, sendOpsDigest } from "../services/ops/opsMonitor.service.js";
import { isOpsAlertEnabled } from "../services/ops/opsAlert.service.js";

export const OPS_CHECK_JOB = "ops-monitor.check";
export const OPS_DIGEST_JOB = "ops-monitor.digest";

agenda.define(OPS_CHECK_JOB, { lockLifetime: 5 * 60 * 1000 }, async (_job, done) => {
  try {
    if (!isOpsAlertEnabled()) return done();
    const result = await runOpsMonitorCycle({ notify: true });
    if (result.notified?.length) {
      console.log(
        `[ops-monitor] gửi ${result.notified.length} cảnh báo:`,
        result.notified.map((n) => `${n.key}(${n.reason})`).join(", ")
      );
    }
    done();
  } catch (error) {
    done(error);
  }
});

agenda.define(OPS_DIGEST_JOB, { lockLifetime: 5 * 60 * 1000 }, async (_job, done) => {
  try {
    if (!isOpsAlertEnabled()) return done();
    await sendOpsDigest();
    done();
  } catch (error) {
    done(error);
  }
});
