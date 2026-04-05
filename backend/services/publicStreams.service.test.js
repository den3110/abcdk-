import test from "node:test";
import assert from "node:assert/strict";

import {
  attachPublicStreamsToMatch,
  sanitizePublicFacebookLive,
} from "./publicStreams.service.js";

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
