import test from "node:test";
import assert from "node:assert/strict";

import {
  getLiveRecordingExportScheduleFor,
} from "./liveRecordingExportWindow.service.js";

const ENV_KEYS = [
  "LIVE_RECORDING_EXPORT_WINDOW_ENABLED",
  "LIVE_RECORDING_EXPORT_WINDOW_START",
  "LIVE_RECORDING_EXPORT_WINDOW_END",
  "LIVE_RECORDING_EXPORT_WINDOW_TZ",
];

function withWindowEnv(overrides, fn) {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );
  for (const key of ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      process.env[key] = overrides[key];
    } else {
      delete process.env[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("getLiveRecordingExportScheduleFor keeps the earliest time when already in export window", () => {
  withWindowEnv(
    {
      LIVE_RECORDING_EXPORT_WINDOW_ENABLED: "1",
      LIVE_RECORDING_EXPORT_WINDOW_START: "00:00",
      LIVE_RECORDING_EXPORT_WINDOW_END: "06:00",
      LIVE_RECORDING_EXPORT_WINDOW_TZ: "Asia/Ho_Chi_Minh",
    },
    () => {
      const referenceNow = new Date("2026-03-29T17:00:00.000Z"); // 00:00 ICT
      const earliestAt = new Date("2026-03-29T17:05:00.000Z"); // 00:05 ICT
      const schedule = getLiveRecordingExportScheduleFor(
        earliestAt,
        referenceNow
      );

      assert.equal(schedule.shouldQueueNow, true);
      assert.equal(schedule.scheduledAt.toISOString(), earliestAt.toISOString());
      assert.equal(schedule.delayMs, 5 * 60 * 1000);
    }
  );
});

test("getLiveRecordingExportScheduleFor moves retries to the next export window when outside the window", () => {
  withWindowEnv(
    {
      LIVE_RECORDING_EXPORT_WINDOW_ENABLED: "1",
      LIVE_RECORDING_EXPORT_WINDOW_START: "00:00",
      LIVE_RECORDING_EXPORT_WINDOW_END: "06:00",
      LIVE_RECORDING_EXPORT_WINDOW_TZ: "Asia/Ho_Chi_Minh",
    },
    () => {
      const referenceNow = new Date("2026-03-29T03:00:00.000Z"); // 10:00 ICT
      const earliestAt = new Date("2026-03-29T03:02:00.000Z"); // 10:02 ICT
      const schedule = getLiveRecordingExportScheduleFor(
        earliestAt,
        referenceNow
      );

      assert.equal(schedule.shouldQueueNow, false);
      assert.equal(
        schedule.scheduledAt.toISOString(),
        "2026-03-29T17:00:00.000Z"
      ); // next 00:00 ICT
      assert.equal(schedule.delayMs, 14 * 60 * 60 * 1000);
    }
  );
});
