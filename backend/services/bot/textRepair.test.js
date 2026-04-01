import test from "node:test";
import assert from "node:assert/strict";

import {
  getCuratedKnowledgeOverride,
  normalizeUserFacingData,
  repairUserFacingText,
} from "./textRepair.js";

test("repairUserFacingText fixes classic mojibake strings", () => {
  assert.equal(
    repairUserFacingText("Pikora - Trợ lý PickleTour"),
    "Pikora - Trợ lý PickleTour",
  );
  assert.equal(
    repairUserFacingText("Tra cứu kiến thức"),
    "Tra cứu kiến thức",
  );
});

test("normalizeUserFacingData repairs nested objects", () => {
  const result = normalizeUserFacingData({
    label: "Mở trang này ở tab mới",
    nested: {
      value: "Không tìm thấy thông tin phù hợp",
    },
  });

  assert.equal(result.label, "Mở trang này ở tab mới");
  assert.equal(result.nested.value, "Không tìm thấy thông tin phù hợp");
});

test("getCuratedKnowledgeOverride returns clean fallback for common FAQ", () => {
  const result = getCuratedKnowledgeOverride("pickleball là gì");

  assert.ok(result);
  assert.equal(result.title, "Pickleball là gì");
  assert.match(result.content, /tennis, cầu lông và bóng bàn/i);
});
