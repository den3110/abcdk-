import asyncHandler from "express-async-handler";

import {
  assistCommandPalette,
  isCommandPaletteAiConfigured,
} from "../services/commandPaletteAi.service.js";

export const assistCommandPaletteIntent = asyncHandler(async (req, res) => {
  if (!isCommandPaletteAiConfigured()) {
    return res.status(503).json({
      message: "Command palette AI is not configured",
      code: "ai_unavailable",
    });
  }

  try {
    const result = await assistCommandPalette(req.body || {}, {
      userId: req.user?._id || req.user?.id || "",
      isAdmin: Boolean(req.user?.isAdmin || req.user?.role === "admin"),
      ip: req.ip || req.headers["x-forwarded-for"] || "",
    });

    return res.json(result);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    return res.status(statusCode).json({
      message: error?.message || "Command palette AI failed",
      code: statusCode === 503 ? "ai_unavailable" : "ai_failed",
    });
  }
});
