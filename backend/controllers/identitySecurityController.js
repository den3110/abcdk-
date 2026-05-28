import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import {
  buildAiIdentityExplanation,
  buildIdentitySecurityOverview,
  buildIdentitySecuritySnapshot,
  toUserSafeSnapshot,
} from "../services/identitySecurity.service.js";

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

function assertValidUserId(userId) {
  if (!mongoose.isValidObjectId(String(userId || ""))) {
    const err = new Error("userId không hợp lệ");
    err.statusCode = 400;
    throw err;
  }
}

export const getIdentitySecurityOverview = asyncHandler(async (req, res) => {
  const days = clampInt(req.query.days, 30, 1, 180);
  const limit = clampInt(req.query.limit, 12, 3, 30);
  const result = await buildIdentitySecurityOverview({ days, limit });
  res.json(result);
});

export const getIdentitySecurityUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  assertValidUserId(userId);
  const days = clampInt(req.query.days, 30, 1, 180);
  const snapshot = await buildIdentitySecuritySnapshot({ userId, days });
  res.json(snapshot);
});

export const explainIdentitySecurityUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  assertValidUserId(userId);
  const days = clampInt(req.body?.days || req.query.days, 30, 1, 180);
  const audience = String(req.body?.audience || "admin").trim() || "admin";
  const snapshot = await buildIdentitySecuritySnapshot({ userId, days });
  const explanation = await buildAiIdentityExplanation({ snapshot, audience });
  res.json({ explanation, generatedAt: new Date() });
});

export const getMyIdentitySecurity = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  assertValidUserId(userId);
  const days = clampInt(req.query.days, 30, 1, 180);
  const snapshot = await buildIdentitySecuritySnapshot({ userId, days });
  res.json(toUserSafeSnapshot(snapshot));
});

export const explainMyIdentitySecurity = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  assertValidUserId(userId);
  const days = clampInt(req.body?.days || req.query.days, 30, 1, 180);
  const snapshot = await buildIdentitySecuritySnapshot({ userId, days });
  const explanation = await buildAiIdentityExplanation({
    snapshot,
    audience: "user",
  });
  res.json({ explanation, generatedAt: new Date() });
});
