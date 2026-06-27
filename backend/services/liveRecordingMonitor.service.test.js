import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStaleExportAutoRequeueOptions,
  getLatestRecordingActivityDate,
  getLatestSegmentActivityDate,
  summarizeSegments,
} from "./liveRecordingMonitor.helpers.js";

test("summarizeSegments ignores presigned placeholders in totals and active segment selection", () => {
  const summary = summarizeSegments(
    [
      {
        index: 0,
        uploadStatus: "uploading_parts",
        meta: { startedAt: "2026-04-09T10:00:00.000Z" },
      },
      {
        index: 1,
        uploadStatus: "presigned",
      },
      {
        index: 24,
        uploadStatus: "presigned",
      },
    ],
    null,
    { includeDetailedSegments: true }
  );

  assert.equal(summary.totalSegments, 1);
  assert.equal(summary.placeholderSegments, 2);
  assert.equal(summary.uploadingSegments, 1);
  assert.equal(summary.activeUploadSegment?.index, 0);
  assert.equal(summary.latestSegment?.index, 0);
  assert.equal(summary.segments.length, 3);
});

test("recording activity falls back to startedAt and recording timestamps", () => {
  const recordingWithStartedSegment = {
    createdAt: "2026-04-09T09:58:00.000Z",
    updatedAt: "2026-04-09T09:59:00.000Z",
    segments: [
      {
        index: 0,
        uploadStatus: "uploading_parts",
        meta: {
          startedAt: "2026-04-09T10:00:00.000Z",
        },
      },
    ],
  };
  const emptyRecording = {
    createdAt: "2026-04-09T10:01:00.000Z",
    updatedAt: "2026-04-09T10:02:00.000Z",
    segments: [],
  };

  assert.equal(
    getLatestSegmentActivityDate(recordingWithStartedSegment)?.toISOString(),
    "2026-04-09T10:00:00.000Z"
  );
  assert.equal(
    getLatestRecordingActivityDate(emptyRecording, {
      includeLifecycleTimestamps: true,
    })?.toISOString(),
    "2026-04-09T10:02:00.000Z"
  );
  assert.equal(
    getLatestRecordingActivityDate(emptyRecording, {
      includeLifecycleTimestamps: false,
    }),
    null
  );
});

test("stale export auto-requeue respects the configured export window", () => {
  const now = new Date("2026-06-27T04:30:00.000Z");
  const options = buildStaleExportAutoRequeueOptions(
    {
      stage: "worker_offline",
      windowStart: "02:00",
    },
    1,
    now
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(options, "ignoreWindow"),
    false
  );
  assert.equal(options.publishReason, "recording_export_auto_requeued");
  assert.equal(options.replaceTerminalJob, true);
  assert.equal(options.replacePendingJob, true);
  assert.equal(options.forceReason, "stale_reconciliation");
  assert.equal(options.currentPipeline.stage, "worker_offline");
  assert.equal(options.currentPipeline.windowStart, "02:00");
  assert.equal(options.currentPipeline.autoRequeueCount, 2);
  assert.equal(options.currentPipeline.lastAutoRequeuedAt, now);
});
