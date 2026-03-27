import asyncHandler from "express-async-handler";

import {
  listAiTtsAdapterModels,
  synthesizeAiTtsSpeech,
} from "../services/aiTtsAdapter.service.js";

function safeText(value) {
  return String(value || "").trim();
}

function isLoopbackRequest(req) {
  const ip = safeText(req.ip || req.socket?.remoteAddress || "");
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("::ffff:127.0.0.")
  );
}

function isAuthorized(req) {
  const token = safeText(
    req.headers?.authorization?.replace(/^Bearer\s+/i, "")
  );
  return (
    token === "local-adapter" ||
    token === safeText(process.env.LIVE_RECORDING_AI_TTS_API_KEY)
  );
}

function ensureAiTtsAdapterAccess(req, res) {
  if (isLoopbackRequest(req) || isAuthorized(req)) {
    return true;
  }
  res.status(401).json({ message: "Unauthorized ai-tts adapter request" });
  return false;
}

export const getAiTtsAdapterModels = asyncHandler(async (req, res) => {
  if (!ensureAiTtsAdapterAccess(req, res)) return;
  const data = await listAiTtsAdapterModels();
  res.json({
    object: "list",
    data,
  });
});

export const createAiTtsAdapterSpeech = asyncHandler(async (req, res) => {
  if (!ensureAiTtsAdapterAccess(req, res)) return;

  const {
    input,
    voice = "alloy",
    instructions = "",
    speed = 1,
  } = req.body || {};

  const result = await synthesizeAiTtsSpeech({
    text: input,
    voice,
    instructions,
    speed,
  });

  res.setHeader("Content-Type", result.contentType || "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(result.buffer);
});
