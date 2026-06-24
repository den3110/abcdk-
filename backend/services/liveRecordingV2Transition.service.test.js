import test from "node:test";
import assert from "node:assert/strict";

import { isMatchEndedForRecordingExport } from "./liveRecordingEndedMatch.service.js";

test("isMatchEndedForRecordingExport accepts finished matches", () => {
  assert.equal(
    isMatchEndedForRecordingExport({
      status: "finished",
      live: { status: "live" },
    }),
    true
  );
});

test("isMatchEndedForRecordingExport accepts idle live state only with an end signal", () => {
  assert.equal(
    isMatchEndedForRecordingExport({
      status: "live",
      live: {
        status: "idle",
        platforms: { facebook: { active: false, lastEndAt: new Date() } },
      },
    }),
    true
  );

  assert.equal(
    isMatchEndedForRecordingExport({
      status: "live",
      live: {
        status: "idle",
        platforms: { facebook: { active: false } },
      },
    }),
    false
  );
});
