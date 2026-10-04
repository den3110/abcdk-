// jobs/playerCourtPositionJob.js
// Định kỳ quét lại vị trí sở trường (ô 1 / ô 2) của VĐV từ các trận mới → cập nhật
// collection PlayerCourtPosition để bảng xếp hạng/hồ sơ/overlay luôn mới.
import { agenda } from "./agenda.js";
import { rebuildAllPlayerCourtPositions } from "../services/playerCourtPosition.service.js";

export const PLAYER_COURT_POSITION_JOB = "stats.player-court-position.rebuild";

agenda.define(PLAYER_COURT_POSITION_JOB, async (job, done) => {
  try {
    const r = await rebuildAllPlayerCourtPositions();
    console.log(
      `[player-position] rebuild: scanned ${r.scanned} trận, ${r.players} VĐV`,
    );
    done();
  } catch (e) {
    console.error("[player-position] rebuild error:", e?.message);
    done(e);
  }
});
