import test from "node:test";
import assert from "node:assert/strict";
import { applyLiveSyncEvent } from "./matchLiveSync.service.js";

function createMatch(overrides = {}) {
  return {
    status: "scheduled",
    rules: { bestOf: 3, pointsToWin: 11, winByTwo: true },
    gameScores: [],
    currentGame: 0,
    serve: { side: "A", server: 2, opening: true },
    liveLog: [],
    liveVersion: 0,
    meta: {},
    ...overrides,
  };
}

test("start initializes live status and first game", () => {
  const match = createMatch();
  const result = applyLiveSyncEvent(match, {
    type: "start",
    clientEventId: "evt-start",
    payload: {},
  });

  assert.equal(result.ok, true);
  assert.equal(match.status, "live");
  assert.equal(match.currentGame, 0);
  assert.deepEqual(match.gameScores, [{ a: 0, b: 0 }]);
  assert.deepEqual(match.serve, {
    side: "A",
    server: 2,
    serverId: null,
    opening: true,
  });
  assert.equal(match.liveVersion, 1);
});

test("point updates score and flips serve on receiver point", () => {
  const match = createMatch({
    status: "live",
    gameScores: [{ a: 0, b: 0 }],
    serve: { side: "A", server: 2, opening: true },
  });

  const result = applyLiveSyncEvent(match, {
    type: "point",
    clientEventId: "evt-point",
    payload: { team: "B", step: 1 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(match.gameScores, [{ a: 0, b: 1 }]);
  assert.equal(match.serve.side, "B");
  assert.equal(match.serve.server, 1);
  assert.equal(match.serve.opening, false);
  assert.equal(match.liveVersion, 1);
});

test("undo reopens a finished match and restores previous serve", () => {
  const match = createMatch({
    status: "finished",
    winner: "A",
    finishedAt: new Date(),
    gameScores: [{ a: 11, b: 9 }],
    currentGame: 0,
    liveVersion: 5,
    serve: { side: "B", server: 1 },
    liveLog: [
      {
        type: "point",
        payload: {
          team: "A",
          step: 1,
          prevServe: { side: "A", server: 2, opening: true },
        },
      },
    ],
  });

  const result = applyLiveSyncEvent(match, {
    type: "undo",
    clientEventId: "evt-undo",
    payload: {},
  });

  assert.equal(result.ok, true);
  assert.equal(match.status, "live");
  assert.equal(match.winner, "");
  assert.equal(match.finishedAt, null);
  assert.deepEqual(match.gameScores, [{ a: 10, b: 9 }]);
  assert.deepEqual(match.serve, {
    side: "A",
    server: 2,
    serverId: null,
    opening: true,
  });
  assert.equal(match.liveVersion, 6);
});

test("finish marks winner and appends finish log", () => {
  const match = createMatch({
    status: "live",
    gameScores: [{ a: 11, b: 7 }],
  });

  const result = applyLiveSyncEvent(match, {
    type: "finish",
    clientEventId: "evt-finish",
    payload: { winner: "A", reason: "manual_finish" },
  });

  assert.equal(result.ok, true);
  assert.equal(match.status, "finished");
  assert.equal(match.winner, "A");
  assert.equal(match.liveLog.at(-1)?.type, "finish");
  assert.equal(match.liveVersion, 1);
});
