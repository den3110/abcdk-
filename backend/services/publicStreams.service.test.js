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
import {
  buildRecordingAiCommentaryPlaybackUrl,
  buildRecordingAiCommentaryRawUrl,
} from "./liveRecordingAiCommentaryPlayback.service.js";

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
});

test("ai commentary replay prefers internal routes over raw Drive links", () => {
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

  const aiCommentary = payload.streams.find(
    (stream) => stream.key === "ai_commentary",
  );
  assert.equal(Boolean(aiCommentary), true);
  assert.equal(
    aiCommentary?.playUrl,
    buildRecordingAiCommentaryPlaybackUrl("662222222222222222222222"),
  );
  assert.equal(
    aiCommentary?.meta?.rawUrl,
    buildRecordingAiCommentaryRawUrl("662222222222222222222222"),
  );
});
