import asyncHandler from "express-async-handler";

import {
  looksLikeVoiceCommand,
  parseVoiceCommand,
  normalizeVoiceTranscript,
} from "../utils/voiceCommandParser.js";

export const parseVoiceCommandIntent = asyncHandler(async (req, res) => {
  const transcript = String(req.body?.transcript || "").trim();
  const context = req.body?.context || {};

  if (!transcript) {
    return res.status(400).json({
      ok: false,
      code: "missing_transcript",
      message: "Transcript is required",
    });
  }

  const normalized = normalizeVoiceTranscript(transcript);
  const parsed = parseVoiceCommand(transcript, context);

  return res.json({
    ok: true,
    transcript,
    normalizedTranscript: normalized,
    looksLikeCommand: looksLikeVoiceCommand(transcript),
    intent: parsed?.action || "",
    feedback: parsed?.feedback || "",
    confidence: Number(parsed?.confidence || 0),
    method: parsed ? "server_rule" : "none",
    teamKey: parsed?.teamKey || "",
    teamUiSide: parsed?.teamUiSide || "",
  });
});
