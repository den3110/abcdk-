import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchSideDisplayContextFromMatches,
  resolveMatchDisplayCode,
  resolveMatchSideDisplayName,
  resolveMatchSideDisplayPair,
} from "./matchSideDisplay.service.js";

test("resolveMatchDisplayCode keeps explicit bracket display code before computed fallback", () => {
  const match = {
    displayCode: "V3-T2",
    code: "V3-T2",
    globalRound: 9,
    round: 9,
    order: 1,
    bracket: { type: "knockout" },
  };

  assert.equal(resolveMatchDisplayCode(match), "V3-T2");
});

test("resolveMatchDisplayCode computes only when no explicit display code exists", () => {
  const match = {
    globalRound: 9,
    round: 9,
    order: 1,
    bracket: { type: "knockout" },
  };

  assert.equal(resolveMatchDisplayCode(match), "V9-T2");
});

test("resolveMatchDisplayCode ignores internal raw match code", () => {
  const match = {
    code: "R1#2",
    globalRound: 5,
    round: 1,
    order: 1,
    bracket: { type: "knockout" },
  };

  assert.equal(resolveMatchDisplayCode(match), "V5-T2");
});

test("resolveMatchDisplayCode scopes bracket base by tournament", async () => {
  const t1 = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const t2 = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const b1Group = "111111111111111111111111";
  const b1Ko = "222222222222222222222222";
  const b2Pre = "333333333333333333333333";
  const b2Ko = "444444444444444444444444";
  const resolvedPair = (name) => ({ teamName: name });
  const makeMatch = ({ id, tournament, bracket, round, order }) => ({
    _id: id,
    tournament,
    bracket,
    round,
    order,
    pairA: resolvedPair("A"),
    pairB: resolvedPair("B"),
  });

  const target = makeMatch({
    id: "999999999999999999999999",
    tournament: t2,
    bracket: {
      _id: b2Ko,
      tournament: t2,
      type: "knockout",
      stage: 2,
      order: 2,
      meta: { maxRounds: 3 },
    },
    round: 2,
    order: 1,
  });
  const context = await buildMatchSideDisplayContextFromMatches([
    makeMatch({
      id: "100000000000000000000001",
      tournament: t1,
      bracket: {
        _id: b1Group,
        tournament: t1,
        type: "group",
        stage: 1,
        order: 1,
      },
      round: 1,
      order: 0,
    }),
    makeMatch({
      id: "100000000000000000000002",
      tournament: t1,
      bracket: {
        _id: b1Ko,
        tournament: t1,
        type: "knockout",
        stage: 2,
        order: 2,
        meta: { maxRounds: 3 },
      },
      round: 1,
      order: 0,
    }),
    makeMatch({
      id: "200000000000000000000001",
      tournament: t2,
      bracket: {
        _id: b2Pre,
        tournament: t2,
        type: "knockout",
        stage: 1,
        order: 1,
        meta: { maxRounds: 2 },
      },
      round: 1,
      order: 0,
    }),
    target,
  ]);

  assert.equal(resolveMatchDisplayCode(target, context), "V4-T2");
});

test("resolveMatchSideDisplayPair carries finished source winner pair", async () => {
  const tournament = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const source = {
    _id: "100000000000000000000001",
    tournament,
    bracket: {
      _id: "111111111111111111111111",
      tournament,
      type: "roundElim",
      stage: 1,
      order: 1,
    },
    round: 1,
    order: 0,
    status: "finished",
    winner: "B",
    pairA: {
      _id: "200000000000000000000001",
      player1: { fullName: "Player A1" },
      player2: { fullName: "Player A2" },
    },
    pairB: {
      _id: "200000000000000000000002",
      player1: { fullName: "Player B1" },
      player2: { fullName: "Player B2" },
    },
  };
  const target = {
    _id: "300000000000000000000001",
    tournament,
    bracket: {
      _id: "222222222222222222222222",
      tournament,
      type: "roundElim",
      stage: 2,
      order: 2,
    },
    round: 1,
    order: 0,
    status: "live",
    seedA: {
      type: "stageMatchWinner",
      ref: { stageIndex: 1, round: 1, order: 0 },
      label: "W-V1-T1",
    },
  };

  const context = {
    matchesById: new Map([
      [source._id, source],
      [target._id, target],
    ]),
    baseByBracketId: new Map(),
  };

  assert.equal(resolveMatchSideDisplayPair(target, "A", context), source.pairB);
  assert.equal(resolveMatchSideDisplayName(target, "A", context), "Player B1 / Player B2");
});

test("resolveMatchSideDisplayPair carries single known source side for active match", async () => {
  const tournament = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const source = {
    _id: "400000000000000000000001",
    tournament,
    bracket: {
      _id: "333333333333333333333333",
      tournament,
      type: "roundElim",
      stage: 1,
      order: 1,
    },
    round: 1,
    order: 16,
    status: "scheduled",
    winner: "",
    pairA: {
      _id: "500000000000000000000001",
      player1: { fullName: "Only A1" },
      player2: { fullName: "Only A2" },
    },
    pairB: null,
  };
  const target = {
    _id: "600000000000000000000001",
    tournament,
    bracket: {
      _id: "444444444444444444444444",
      tournament,
      type: "roundElim",
      stage: 2,
      order: 2,
    },
    round: 1,
    order: 1,
    status: "live",
    seedB: {
      type: "stageMatchWinner",
      ref: { stageIndex: 1, round: 1, order: 16 },
      label: "W-V1-T17",
    },
  };

  const context = {
    matchesById: new Map([
      [source._id, source],
      [target._id, target],
    ]),
    baseByBracketId: new Map(),
  };

  assert.equal(resolveMatchSideDisplayPair(target, "B", context), source.pairA);
  assert.equal(resolveMatchSideDisplayName(target, "B", context), "Only A1 / Only A2");
});

test("resolveMatchSideDisplayPair ignores empty projected pair shells", async () => {
  const tournament = "cccccccccccccccccccccccc";
  const source = {
    _id: "700000000000000000000001",
    tournament,
    bracket: {
      _id: "777777777777777777777777",
      tournament,
      type: "roundElim",
      stage: 1,
      order: 1,
    },
    round: 1,
    order: 2,
    status: "finished",
    winner: "A",
    pairA: {
      _id: "800000000000000000000001",
      player1: { fullName: "Resolved A1" },
      player2: { fullName: "Resolved A2" },
    },
    pairB: {
      _id: "800000000000000000000002",
      player1: { fullName: "Resolved B1" },
      player2: { fullName: "Resolved B2" },
    },
  };
  const target = {
    _id: "900000000000000000000001",
    tournament,
    bracket: {
      _id: "999999999999999999999999",
      tournament,
      type: "roundElim",
      stage: 2,
      order: 1,
    },
    round: 1,
    order: 0,
    status: "live",
    pairA: { player1: {}, player2: {} },
    seedA: {
      type: "stageMatchWinner",
      ref: { stageIndex: 1, round: 1, order: 2 },
      label: "W-V1-T3",
    },
  };

  const context = {
    matchesById: new Map([
      [source._id, source],
      [target._id, target],
    ]),
    baseByBracketId: new Map(),
  };

  assert.equal(resolveMatchSideDisplayPair(target, "A", context), source.pairA);
  assert.equal(
    resolveMatchSideDisplayName(target, "A", context),
    "Resolved A1 / Resolved A2"
  );
});
