import test from "node:test";
import assert from "node:assert/strict";

import { resolveMatchDisplayCode } from "./matchSideDisplay.service.js";

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
