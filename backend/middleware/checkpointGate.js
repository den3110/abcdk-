import asyncHandler from "express-async-handler";
import {
  recordCheckpointEvent,
  shouldRequireActionCheckpoint,
  startLoginCheckpoint,
} from "../services/checkpoint.service.js";

export const requireCheckpointForRisk = ({
  intent = "sensitive_action",
  minLevel = 1,
  routeGroup = "",
} = {}) =>
  asyncHandler(async (req, res, next) => {
    if (!req.user) return next();

    const decision = await shouldRequireActionCheckpoint({
      user: req.user,
      req,
      intent,
      minLevel,
    });

    if (!decision.required) return next();

    const checkpoint = await startLoginCheckpoint({
      user: req.user,
      req,
      decision,
      reason: intent,
    });

    void recordCheckpointEvent({
      req,
      user: req.user,
      subjectUser: req.user,
      type: "action_checkpoint_required",
      category: "checkpoint",
      outcome: "blocked",
      severity: decision.level >= 3 ? "high" : "medium",
      routeGroup,
      metadata: {
        intent,
        level: decision.level,
        score: decision.score,
        signals: decision.signals || [],
      },
    });

    return res.status(423).json({
      message: "Cần hoàn tất checkpoint bảo mật trước khi tiếp tục.",
      checkpointRequired: true,
      checkpoint,
    });
  });
