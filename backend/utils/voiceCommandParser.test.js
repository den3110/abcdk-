import test from "node:test";
import assert from "node:assert/strict";

import { parseVoiceCommand } from "./voiceCommandParser.js";

const baseContext = {
  activeSide: "A",
  leftSide: "A",
  rightSide: "B",
  ctaLabel: "",
};

test("parse điểm bên trái", () => {
  const result = parseVoiceCommand("Đội bên trái điểm", baseContext);
  assert.equal(result?.action, "INC_POINT");
  assert.equal(result?.teamKey, "A");
  assert.equal(result?.teamUiSide, "left");
});

test("parse timeout bên phải", () => {
  const result = parseVoiceCommand("Timeout bên phải", baseContext);
  assert.equal(result?.action, "TIMEOUT");
  assert.equal(result?.teamKey, "B");
  assert.equal(result?.teamUiSide, "right");
});

test("parse bắt game tiếp", () => {
  const result = parseVoiceCommand("Bắt game tiếp", {
    ...baseContext,
    ctaLabel: "Bắt game tiếp",
  });
  assert.equal(result?.action, "START_NEXT_GAME");
});

test("parse kết thúc trận", () => {
  const result = parseVoiceCommand("Kết thúc trận", baseContext);
  assert.equal(result?.action, "FINISH_MATCH");
});

test("parse đổi tay", () => {
  const result = parseVoiceCommand("Đổi tay", baseContext);
  assert.equal(result?.action, "TOGGLE_SERVER");
});
