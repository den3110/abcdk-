import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchSideDisplayContextFromMatches,
  resolveMatchDisplayCode,
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
