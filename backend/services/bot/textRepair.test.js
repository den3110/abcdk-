import test from "node:test";
import assert from "node:assert/strict";

import {
  getCuratedKnowledgeOverride,
  normalizeUserFacingData,
  repairUserFacingText,
} from "./textRepair.js";

test("repairUserFacingText fixes classic mojibake strings", () => {
  assert.equal(
    repairUserFacingText("Pikora - TrÃ¡Â»Â£ lÃƒÂ½ PickleTour"),
    "Pikora - Trợ lý PickleTour",
  );
  assert.equal(
    repairUserFacingText("Tra cÃ¡Â»Â©u kiÃ¡ÂºÂ¿n thÃ¡Â»Â©c"),
    "Tra cứu kiến thức",
  );
});

test("normalizeUserFacingData repairs nested objects", () => {
  const result = normalizeUserFacingData({
    label: "MÃ¡Â»Å¸ trang nÃƒÂ y Ã¡Â»Å¸ tab mÃ¡Â»â€ºi",
    nested: {
      value: "KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y thÃƒÂ´ng tin phÃƒÂ¹ hÃ¡Â»Â£p",
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

test("repairUserFacingText fixes common question-mark corruption", () => {
  assert.equal(repairUserFacingText("chi ti?t clb"), "chi tiết CLB");
  assert.equal(repairUserFacingText("m? clb"), "mở CLB");
  assert.equal(repairUserFacingText("thi?t b?"), "thiết bị");
});
