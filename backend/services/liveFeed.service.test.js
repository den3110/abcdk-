import test from "node:test";
import assert from "node:assert/strict";

import { attachPublicStreamsToMatch } from "./publicStreams.service.js";
import {
  buildFeedPosterUrl,
  buildLiveFeedItem,
  compareLiveFeedItems,
  getLiveFeedModeStatuses,
  pickFeedPreferredStream,
} from "./liveFeed.service.js";

test("getLiveFeedModeStatuses maps mode values to fixed status sets", () => {
  assert.deepEqual(getLiveFeedModeStatuses("all"), [
    "live",
    "assigned",
    "queued",
    "finished",
  ]);
  assert.deepEqual(getLiveFeedModeStatuses("live"), [
    "live",
    "assigned",
    "queued",
  ]);
  assert.deepEqual(getLiveFeedModeStatuses("replay"), ["finished"]);
  assert.deepEqual(getLiveFeedModeStatuses("unknown"), [
    "live",
    "assigned",
    "queued",
    "finished",
  ]);
});

test("compareLiveFeedItems keeps live items ahead of replay items", () => {
  const items = [
    {
      _id: "finished-1",
      status: "finished",
      updatedAt: "2026-04-09T10:00:00.000Z",
    },
    {
      _id: "live-1",
      status: "live",
      updatedAt: "2026-04-09T09:00:00.000Z",
    },
  ];

  items.sort(compareLiveFeedItems);

  assert.equal(items[0]._id, "live-1");
  assert.equal(items[1]._id, "finished-1");
});

test("pickFeedPreferredStream prefers native-ready streams before iframe streams", () => {
  const preferred = pickFeedPreferredStream([
    {
      key: "server1",
      kind: "facebook",
      ready: true,
      priority: 1,
    },
    {
      key: "server2",
      kind: "delayed_manifest",
      ready: true,
      priority: 2,
    },
    {
      key: "youtube",
      kind: "iframe",
      ready: true,
      priority: 3,
    },
  ]);

  assert.equal(preferred?.key, "server2");
});

test("buildFeedPosterUrl applies youtube then facebook then tournament fallback order", () => {
  assert.equal(
    buildFeedPosterUrl({
      meta: {
        youtube: {
          videoId: "yt123",
        },
      },
      facebookLive: {
        videoId: "fb123",
      },
      tournament: {
        image: "https://example.com/tournament.png",
      },
    }),
    "https://i.ytimg.com/vi/yt123/maxresdefault_live.jpg",
  );

  assert.equal(
    buildFeedPosterUrl({
      facebookLive: {
        videoId: "fb123",
      },
      tournament: {
        image: "https://example.com/tournament.png",
      },
    }),
    "https://graph.facebook.com/fb123/picture?type=large",
  );

  assert.equal(
    buildFeedPosterUrl({
      tournament: {
        image: "https://example.com/tournament.png",
      },
    }),
    "https://example.com/tournament.png",
  );
});

test("buildLiveFeedItem keeps Facebook payload sanitized", () => {
  const attached = attachPublicStreamsToMatch({
    _id: "match-1",
    status: "finished",
    tournament: {
      _id: "tour-1",
      name: "Giải A",
      image: "https://example.com/tour.png",
    },
    facebookLive: {
      id: "fb-live-1",
      videoId: "fb-video-1",
      pageAccessToken: "secret",
      accessToken: "secret-2",
      permalink_url: "https://facebook.com/page/videos/fb-video-1/",
    },
  });
  const feedItem = buildLiveFeedItem(attached);

  assert.equal(feedItem.facebookLive?.pageAccessToken, undefined);
  assert.equal(feedItem.facebookLive?.accessToken, undefined);
  assert.equal(
    feedItem.posterUrl,
    "https://graph.facebook.com/fb-video-1/picture?type=large",
  );
});
