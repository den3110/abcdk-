import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFacebookVodRetryPlan,
  buildRecordingSourceSummary,
  getFacebookVodRetryDelayMs,
  RECORDING_SOURCE_FACEBOOK_VOD,
  RECORDING_SOURCE_SEGMENTS,
  resolveLiveRecordingExportSource,
} from "./liveRecordingFacebookVodShared.service.js";
import { pickFacebookVodSourceUrl } from "./liveRecordingFacebookVod.service.js";

test("resolveLiveRecordingExportSource prefers uploaded segments over facebook vod", () => {
  const source = resolveLiveRecordingExportSource(
    {
      segments: [
        { index: 1, uploadStatus: "uploaded", objectKey: "segments/1.mp4" },
      ],
      meta: {
        source: {
          type: RECORDING_SOURCE_FACEBOOK_VOD,
          platform: "facebook",
          pageId: "page-1",
          videoId: "video-1",
        },
      },
    },
    {
      facebookLive: {
        status: "ENDED",
        videoId: "video-1",
      },
    }
  );

  assert.equal(source.type, RECORDING_SOURCE_SEGMENTS);
  assert.equal(source.uploadedSegments.length, 1);
});

test("resolveLiveRecordingExportSource falls back to facebook vod with no segments", () => {
  const source = resolveLiveRecordingExportSource(
    {
      segments: [],
      meta: {
        source: {
          type: RECORDING_SOURCE_FACEBOOK_VOD,
          platform: "facebook",
          pageId: "page-1",
          videoId: "video-1",
        },
      },
    },
    {
      facebookLive: {
        status: "ENDED",
        videoId: "video-1",
      },
    }
  );

  assert.equal(source.type, RECORDING_SOURCE_FACEBOOK_VOD);
  assert.equal(source.sourceMeta.videoId, "video-1");
  assert.equal(source.sourceMeta.pageId, "page-1");
});

test("buildFacebookVodRetryPlan uses endedAt as retry window start", () => {
  const endedAt = new Date("2026-03-28T10:00:00.000Z");
  const now = new Date("2026-03-28T10:01:00.000Z");
  const plan = buildFacebookVodRetryPlan({
    recording: {
      meta: {
        facebookVod: {
          attemptCount: 0,
        },
      },
    },
    match: {
      facebookLive: {
        status: "ENDED",
        endedAt,
        videoId: "video-1",
      },
    },
    now,
  });

  assert.equal(plan.startedAt.toISOString(), endedAt.toISOString());
  assert.equal(
    plan.deadlineAt.toISOString(),
    "2026-03-28T12:00:00.000Z"
  );
  assert.equal(plan.nextDelayMs, getFacebookVodRetryDelayMs(1));
  assert.equal(
    plan.nextAttemptAt.toISOString(),
    "2026-03-28T10:03:00.000Z"
  );
});

test("buildFacebookVodRetryPlan increases delay after repeated attempts", () => {
  const plan = buildFacebookVodRetryPlan({
    recording: {
      createdAt: new Date("2026-03-28T10:00:00.000Z"),
      meta: {
        facebookVod: {
          startedAt: new Date("2026-03-28T10:00:00.000Z"),
          deadlineAt: new Date("2026-03-28T12:00:00.000Z"),
          attemptCount: 2,
        },
      },
    },
    now: new Date("2026-03-28T10:10:00.000Z"),
  });

  assert.equal(plan.nextAttemptNumber, 3);
  assert.equal(plan.nextDelayMs, getFacebookVodRetryDelayMs(3));
  assert.equal(
    plan.nextAttemptAt.toISOString(),
    "2026-03-28T10:20:00.000Z"
  );
});

test("buildRecordingSourceSummary exposes facebook retry metadata", () => {
  const summary = buildRecordingSourceSummary({
    segments: [],
    status: "exporting",
    meta: {
      source: {
        type: RECORDING_SOURCE_FACEBOOK_VOD,
        platform: "facebook",
        pageId: "page-1",
        videoId: "video-1",
      },
      facebookVod: {
        nextAttemptAt: new Date("2026-03-28T10:20:00.000Z"),
        deadlineAt: new Date("2026-03-28T12:00:00.000Z"),
        lastError: "not ready",
      },
    },
  });

  assert.equal(summary.type, RECORDING_SOURCE_FACEBOOK_VOD);
  assert.equal(summary.videoId, "video-1");
  assert.equal(summary.pageId, "page-1");
  assert.equal(summary.lastError, "not ready");
});

test("pickFacebookVodSourceUrl prefers source field", () => {
  const url = pickFacebookVodSourceUrl({
    hd_src_no_ratelimit: "https://example.com/backup.mp4",
    source: "https://example.com/video.mp4",
  });

  assert.equal(url, "https://example.com/video.mp4");
});
