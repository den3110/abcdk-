import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldRejectRecordingExportDuration,
} from "./liveRecordingV2Export.service.js";

test("does not reject short recordings when duration is small", () => {
  assert.equal(
    shouldRejectRecordingExportDuration({
      expectedDurationSeconds: 90,
      actualDurationSeconds: 40,
    }),
    false
  );
});

test("does not reject when output duration is close to expected", () => {
  assert.equal(
    shouldRejectRecordingExportDuration({
      expectedDurationSeconds: 3600,
      actualDurationSeconds: 3565,
    }),
    false
  );
});

test("rejects exports that are much shorter than expected", () => {
  assert.equal(
    shouldRejectRecordingExportDuration({
      expectedDurationSeconds: 6936.356,
      actualDurationSeconds: 436.781578,
    }),
    true
  );
});
