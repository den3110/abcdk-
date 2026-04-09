import test from "node:test";
import assert from "node:assert/strict";

import {
  attachPublicStreamsToMatch,
  sanitizePublicFacebookLive,
} from "./publicStreams.service.js";
import {
  buildRecordingPlaybackUrl,
  buildRecordingRawStreamUrl,
} from "./liveRecordingV2Export.service.js";

test("sanitizePublicFacebookLive removes Facebook access token aliases", () => {
  const sanitized = sanitizePublicFacebookLive({
    id: "fb-live-1",
    pageId: "page-1",
    pageAccessToken: "secret-page-token",
    pageToken: "legacy-page-token",
    accessToken: "secret-access-token",
    access_token: "secret-access-token-snake",
    permalink_url: "https://facebook.com/watch/live-1",
  });

  assert.deepEqual(sanitized, {
    id: "fb-live-1",
    pageId: "page-1",
    permalink_url: "https://facebook.com/watch/live-1",
  });
});

test("attachPublicStreamsToMatch keeps public Facebook fields but strips access tokens", () => {
  const payload = attachPublicStreamsToMatch({
    _id: "match-1",
    status: "finished",
    facebookLive: {
      id: "fb-live-1",
      pageId: "page-1",
      videoId: "video-1",
      pageAccessToken: "secret-page-token",
      permalink_url: "https://facebook.com/page/videos/video-1/",
      watch_url: "https://fb.watch/example",
    },
  });

  assert.equal(payload.facebookLive?.pageAccessToken, undefined);
  assert.equal(payload.facebookLive?.permalink_url, "https://facebook.com/page/videos/video-1/");
  assert.equal(payload.facebookLive?.watch_url, "https://fb.watch/example");
  assert.equal(Array.isArray(payload.streams), true);
});

test("finished matches prefer full drive video and do not expose server2 replay streams", () => {
  const payload = attachPublicStreamsToMatch(
    {
      _id: "match-2",
      status: "finished",
      facebookLive: {
        id: "fb-live-2",
        pageId: "page-2",
        videoId: "video-2",
        permalink_url: "https://facebook.com/page/videos/video-2/",
      },
    },
    {
      _id: "661111111111111111111111",
      match: "match-2",
      status: "ready",
      driveFileId: "drive-file-2",
    },
  );

  const fullVideo = payload.streams.find((stream) => stream.key === "full_video");
  assert.equal(Boolean(fullVideo), true);
  assert.equal(fullVideo?.kind, "file");
  assert.equal(fullVideo?.meta?.isCompleteVideo, true);
  assert.equal(
    fullVideo?.playUrl,
    buildRecordingRawStreamUrl("661111111111111111111111"),
  );
  assert.equal(
    fullVideo?.openUrl,
    buildRecordingPlaybackUrl("661111111111111111111111"),
  );
  assert.equal(payload.streams.some((stream) => stream.key === "server2"), false);
  assert.equal(payload.defaultStreamKey, "full_video");
  assert.equal(payload.publicReplayStateHint, "complete");
});

test("live matches only expose Facebook stream even when recording segments exist", () => {
  const payload = attachPublicStreamsToMatch(
    {
      _id: "match-live-3",
      status: "live",
      facebookLive: {
        id: "fb-live-3",
        pageId: "page-3",
        permalink_url: "https://facebook.com/page/videos/live-3/",
      },
    },
    {
      _id: "663333333333333333333333",
      match: "match-live-3",
      status: "recording",
      r2TargetId: "target-1",
      segments: [
        {
          index: 0,
          uploadStatus: "uploaded",
          durationSeconds: 6,
        },
      ],
    },
  );

  assert.deepEqual(
    payload.streams.map((stream) => stream.key),
    ["server1"],
  );
  assert.equal(payload.defaultStreamKey, "server1");
  assert.equal(payload.publicReplayStateHint, "none");
});

test("finished matches fall back to Facebook when full Drive video is not ready", () => {
  const payload = attachPublicStreamsToMatch(
    {
      _id: "match-finished-fb-fallback",
      status: "finished",
      facebookLive: {
        id: "fb-live-4",
        pageId: "page-4",
        videoId: "video-4",
        permalink_url: "https://facebook.com/page/videos/video-4/",
      },
    },
    {
      _id: "664444444444444444444444",
      match: "match-finished-fb-fallback",
      status: "exporting",
    },
  );

  assert.deepEqual(
    payload.streams.map((stream) => stream.key),
    ["server1"],
  );
  assert.equal(payload.defaultStreamKey, "server1");
  assert.equal(payload.publicReplayStateHint, "temporary");
});

test("finished record-only matches stay in processing until Drive video is ready", () => {
  const payload = attachPublicStreamsToMatch(
    {
      _id: "match-record-only-1",
      status: "finished",
    },
    {
      _id: "665555555555555555555555",
      match: "match-record-only-1",
      status: "pending_export_window",
    },
  );

  assert.deepEqual(payload.streams, []);
  assert.equal(payload.defaultStreamKey, null);
  assert.equal(payload.publicReplayStateHint, "processing");
});

test("ai commentary is not exposed before full replay Drive video is ready", () => {
  const payload = attachPublicStreamsToMatch(
    {
      _id: "match-3",
      status: "finished",
    },
    {
      _id: "662222222222222222222222",
      match: "match-3",
      status: "ready",
      aiCommentary: {
        dubbedDriveRawUrl:
          "https://drive.google.com/uc?export=download&id=ai-drive-file",
      },
    },
  );

  assert.deepEqual(payload.streams, []);
  assert.equal(payload.defaultStreamKey, null);
  assert.equal(payload.publicReplayStateHint, "processing");
});
