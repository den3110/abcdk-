import test from "node:test";
import assert from "node:assert/strict";

import { attachPublicStreamsToMatch } from "./publicStreams.service.js";
import {
  buildLiveFeedSearchItem,
  buildFeedPosterUrl,
  buildFeedStageLabel,
  buildLiveFeedItem,
  compareLiveFeedItems,
  getLiveFeedModeStatuses,
  getLiveFeedSmartScore,
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

test("buildLiveFeedItem labels live matches as Live", () => {
  const feedItem = buildLiveFeedItem({
    _id: "live-2",
    status: "live",
    streams: [
      {
        key: "server1",
        kind: "facebook",
        ready: true,
        openUrl: "https://facebook.com/live-2",
      },
    ],
    defaultStreamKey: "server1",
  });

  assert.equal(feedItem.smartBadge, "Live");
});

test("buildLiveFeedSearchItem returns lightweight search payload", () => {
  const item = buildLiveFeedSearchItem({
    _id: "match-search-1",
    status: "live",
    smartBadge: "Live",
    displayCode: "M1-A1",
    stageLabel: "Chung kết",
    courtLabel: "Court 1",
    updatedAt: "2026-04-09T10:00:00.000Z",
    teamAName: "A / B",
    teamBName: "C / D",
    tournament: {
      _id: "tour-1",
      name: "Giải A",
      image: "https://example.com/tour.png",
    },
  });

  assert.deepEqual(item, {
    _id: "match-search-1",
    status: "live",
    smartBadge: "Live",
    displayCode: "M1-A1",
    stageLabel: "Chung kết",
    courtLabel: "Court 1",
    updatedAt: "2026-04-09T10:00:00.000Z",
    teamAName: "A / B",
    teamBName: "C / D",
    pairA: null,
    pairB: null,
    tournament: {
      _id: "tour-1",
      name: "Giải A",
      image: "https://example.com/tour.png",
    },
  });
});

test("pickFeedPreferredStream prefers direct file streams before Facebook iframe streams", () => {
  const preferred = pickFeedPreferredStream([
    {
      key: "server1",
      kind: "facebook",
      ready: true,
      priority: 1,
    },
    {
      key: "legacy_video",
      kind: "file",
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

  assert.equal(preferred?.key, "legacy_video");
});

test("pickFeedPreferredStream prefers completed replay video over temporary streams", () => {
  const preferred = pickFeedPreferredStream([
    {
      key: "server1",
      kind: "facebook",
      ready: true,
      priority: 1,
    },
    {
      key: "full_video",
      kind: "file",
      ready: true,
      priority: 0,
      meta: {
        isCompleteVideo: true,
      },
    },
  ]);

  assert.equal(preferred?.key, "full_video");
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

test("buildLiveFeedItem marks completed replay with controls and contain fit", () => {
  const feedItem = buildLiveFeedItem({
    _id: "match-3",
    status: "finished",
    streams: [
      {
        key: "full_video",
        kind: "file",
        ready: true,
        playUrl: "https://example.com/full.mp4",
        openUrl: "https://example.com/full",
        meta: {
          isCompleteVideo: true,
          useNativeControls: true,
        },
      },
      {
        key: "server1",
        kind: "facebook",
        ready: true,
        openUrl: "https://facebook.com/example",
      },
    ],
    defaultStreamKey: "full_video",
  });

  assert.equal(feedItem.feedPreferredStreamKey, "full_video");
  assert.equal(feedItem.replayState, "complete");
  assert.equal(feedItem.useNativeControls, true);
  assert.equal(feedItem.preferredObjectFit, "contain");
});

test("buildLiveFeedItem marks replay as processing when backend flags replay as pending", () => {
  const feedItem = buildLiveFeedItem({
    _id: "match-4",
    status: "finished",
    streams: [],
    defaultStreamKey: null,
    publicReplayStateHint: "processing",
  });

  assert.equal(feedItem.replayState, "processing");
  assert.equal(feedItem.useNativeControls, false);
});

test("buildFeedStageLabel resolves grand final and third-place labels", () => {
  assert.equal(
    buildFeedStageLabel({
      phase: "grand_final",
      round: 1,
      bracket: {
        type: "double_elim",
      },
    }),
    "Chung kết tổng",
  );

  assert.equal(
    buildFeedStageLabel({
      meta: {
        thirdPlace: true,
      },
      round: 3,
      bracket: {
        type: "knockout",
      },
    }),
    "Tranh 3-4",
  );
});

test("buildLiveFeedItem exposes stage chips for code and branch stage", () => {
  const feedItem = buildLiveFeedItem({
    _id: "match-stage-1",
    displayCode: "V5-NT-T1",
    status: "finished",
    phase: "losers",
    branch: "lb",
    round: 4,
    bracket: {
      type: "double_elim",
      meta: {
        drawSize: 8,
      },
    },
    streams: [
      {
        key: "server1",
        kind: "facebook",
        ready: true,
        openUrl: "https://facebook.com/example",
      },
    ],
    defaultStreamKey: "server1",
  });

  assert.equal(feedItem.stageLabel, "Chung kết nhánh thua");
  assert.equal(feedItem.displayCode, "V5-NT-T1");
});

test("smart ranking boosts fresh live matches ahead of stale live matches", () => {
  const now = Date.now();
  const hotLive = buildLiveFeedItem({
    _id: "match-hot",
    status: "live",
    currentGame: 3,
    score: {
      scoreA: 10,
      scoreB: 9,
    },
    updatedAt: new Date(now - 2 * 60 * 1000).toISOString(),
    startedAt: new Date(now - 18 * 60 * 1000).toISOString(),
    streams: [
      {
        key: "server1",
        kind: "facebook",
        ready: true,
        openUrl: "https://facebook.com/hot-live",
      },
    ],
    defaultStreamKey: "server1",
  });
  const flatLive = buildLiveFeedItem({
    _id: "match-flat",
    status: "live",
    currentGame: 1,
    updatedAt: new Date(now - 55 * 60 * 1000).toISOString(),
    startedAt: new Date(now - 75 * 60 * 1000).toISOString(),
    streams: [
      {
        key: "server1",
        kind: "facebook",
        ready: true,
        openUrl: "https://facebook.com/example",
      },
    ],
    defaultStreamKey: "server1",
  });

  assert.ok(getLiveFeedSmartScore(hotLive) > getLiveFeedSmartScore(flatLive));

  const items = [flatLive, hotLive];
  items.sort(compareLiveFeedItems);
  assert.equal(items[0]._id, "match-hot");
});
