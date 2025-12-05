// controllers/chatBotController.js
// ✅ UPDATED: Thêm Quick Response Layer (Greeting, FAQ, Small Talk, Navigation)
// Bot identity: Trợ lý PickleTour

import { embedText, cosineSim } from "../services/bot/embeddingService.js";
import {
  addSkill,
  findBestSkillByEmbedding,
} from "../services/bot/skillStore.js";
import { executeSkill } from "../services/bot/executionEngine.js";
import { chatWithPlanner } from "../services/bot/openaiService.js";
import {
  processQuickResponse,
  checkQuickResponseHealth,
  BOT_IDENTITY,
} from "../services/bot/quickResponseService.js";

import ChatBotMessage from "../models/chatBotMessageModel.js";

/* ========== HELPER: LOG MESSAGE ========== */
async function logChatMessage({
  userId,
  role,
  message,
  meta,
  navigation,
  context,
  replyTo = null,
}) {
  try {
    await ChatBotMessage.create({
      userId: userId || null,
      role,
      message,
      meta: meta || null,
      navigation: navigation || null,
      context: context
        ? {
            tournamentId: context.tournamentId,
            matchId: context.matchId,
            bracketId: context.bracketId,
            courtCode: context.courtCode,
          }
        : {},
      replyTo,
    });
  } catch (e) {
    console.error("[logChatMessage] error:", e.message);
  }
}

/* ========== MAIN CHAT HANDLER ========== */
export async function handleChat(req, res) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    // ✅ Extract ALL context from headers
    const currentUser = req.user;
    const tournamentId = req.headers["x-pkt-tournament-id"];
    const matchId = req.headers["x-pkt-match-id"];
    const bracketId = req.headers["x-pkt-bracket-id"];
    const courtCode = req.headers["x-pkt-court-code"];

    console.log("✅ Context:", {
      userId: currentUser?._id,
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    });

    // Build rich context
    const context = {
      currentUser,
      currentUserId: currentUser?._id,
      authToken: req.headers.authorization?.replace("Bearer ", ""),
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    };

    const userId = currentUser?._id || null;

    /* ---------- LƯU USER MESSAGE ---------- */
    let userMessageDoc = null;
    try {
      userMessageDoc = await ChatBotMessage.create({
        userId,
        role: "user",
        message,
        meta: null,
        navigation: null,
        context: {
          tournamentId,
          matchId,
          bracketId,
          courtCode,
        },
      });
    } catch (e) {
      console.error("[handleChat] log user message error:", e.message);
    }

    /* ========== LAYER 0: QUICK RESPONSE (Qwen 0.5b) ========== */
    // Handles: Greeting, Small Talk, FAQ, Navigation
    // Cost: FREE (local Ollama)
    try {
      const quickResult = await processQuickResponse(message, context);

      if (quickResult) {
        console.log(
          `[QUICK RESPONSE] Type: ${quickResult.type}, Intent: ${quickResult.intent}`
        );

        const response = {
          reply: quickResult.reply,
          type: quickResult.type,
          source: quickResult.source,
          confidence: quickResult.confidence,
          processingTime: quickResult.processingTime,
          botName: BOT_IDENTITY.nameVi,
        };

        if (quickResult.navigation) {
          response.navigation = quickResult.navigation;
        }

        // 🔹 LOG BOT MESSAGE
        await logChatMessage({
          userId,
          role: "bot",
          message: response.reply,
          meta: {
            type: response.type,
            source: response.source,
            confidence: response.confidence,
            processingTime: response.processingTime,
          },
          navigation: response.navigation,
          context,
          replyTo: userMessageDoc?._id || null,
        });

        return res.json(response);
      }
    } catch (quickError) {
      console.error(
        "[handleChat] Quick response layer error:",
        quickError.message
      );
      // Continue to next layer
    }

    /* ========== LAYER 1: WARM PATH (Skill Matching) ========== */
    // Uses: OpenAI Embedding for similarity search
    try {
      const userEmbedding = await embedText(message);
      const best = await findBestSkillByEmbedding(
        userEmbedding,
        0.8,
        cosineSim
      );

      if (best?.skill?.action) {
        console.log("[WARM PATH] Found matching skill:", best.skill.name);

        const extractedParams = buildDefaultParamsForSkill(best.skill, context);
        const reply = await executeSkill(best.skill, extractedParams, context);

        const response = {
          reply,
          usedSkill: best.skill.name,
          score: best.score,
          source: "warm",
          botName: BOT_IDENTITY.nameVi,
        };

        // 🔹 LOG BOT MESSAGE
        await logChatMessage({
          userId,
          role: "bot",
          message: response.reply,
          meta: {
            type: "skill",
            source: response.source,
            usedSkill: response.usedSkill,
            score: response.score,
          },
          navigation: null,
          context,
          replyTo: userMessageDoc?._id || null,
        });

        return res.json(response);
      }
    } catch (e) {
      console.error("[handleChat] warm-path error", e);
    }

    /* ========== LAYER 2: COLD PATH (GPT Planner) ========== */
    // Uses: OpenAI GPT-4o-mini for skill creation
    console.log("[COLD PATH] Calling GPT planner...");

    const gptMsg = await chatWithPlanner(message);
    const content = gptMsg?.content || "{}";

    console.log("[GPT Response]", content);

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("[handleChat] Parse JSON fail:", e, content);

      const response = {
        reply: "Xin lỗi, mình gặp lỗi khi xử lý. Bạn thử lại nhé.",
        botName: BOT_IDENTITY.nameVi,
      };

      await logChatMessage({
        userId,
        role: "bot",
        message: response.reply,
        meta: {
          type: "cold-error-parse",
          source: "cold",
        },
        navigation: null,
        context,
        replyTo: userMessageDoc?._id || null,
      });

      return res.json(response);
    }

    const answer =
      parsed?.answer_to_user ||
      "Xin lỗi, hiện tại mình chưa trả lời được câu này. Bạn thử hỏi cách khác hoặc liên hệ hỗ trợ nhé!";

    if (!parsed.should_create_skill || !parsed.skill_spec) {
      const response = {
        reply: answer,
        createdSkill: false,
        source: "cold-no-skill",
        botName: BOT_IDENTITY.nameVi,
      };

      await logChatMessage({
        userId,
        role: "bot",
        message: response.reply,
        meta: {
          type: "cold",
          source: response.source,
          createdSkill: response.createdSkill,
        },
        navigation: null,
        context,
        replyTo: userMessageDoc?._id || null,
      });

      return res.json(response);
    }

    try {
      const skillSpec = parsed.skill_spec;

      // ✅ VALIDATION - Check required fields
      if (!skillSpec.name) {
        console.error("[handleChat] Missing skill name:", skillSpec);

        const response = {
          reply: answer,
          createdSkill: false,
          source: "cold-missing-name",
          botName: BOT_IDENTITY.nameVi,
        };

        await logChatMessage({
          userId,
          role: "bot",
          message: response.reply,
          meta: {
            type: "cold",
            source: response.source,
            createdSkill: response.createdSkill,
          },
          navigation: null,
          context,
          replyTo: userMessageDoc?._id || null,
        });

        return res.json(response);
      }

      if (!skillSpec.action || !skillSpec.action.type) {
        console.error("[handleChat] Missing action or action.type:", skillSpec);

        const response = {
          reply: answer,
          createdSkill: false,
          source: "cold-missing-action",
          botName: BOT_IDENTITY.nameVi,
        };

        await logChatMessage({
          userId,
          role: "bot",
          message: response.reply,
          meta: {
            type: "cold",
            source: response.source,
            createdSkill: response.createdSkill,
          },
          navigation: null,
          context,
          replyTo: userMessageDoc?._id || null,
        });

        return res.json(response);
      }

      // ✅ VALIDATION - Check valid action.type
      const validTypes = ["mongo", "aggregate", "internal", "http"];
      if (!validTypes.includes(skillSpec.action.type)) {
        console.error(
          "[handleChat] Invalid action.type:",
          skillSpec.action.type
        );

        const response = {
          reply: answer,
          createdSkill: false,
          source: "cold-invalid-action-type",
          botName: BOT_IDENTITY.nameVi,
        };

        await logChatMessage({
          userId,
          role: "bot",
          message: response.reply,
          meta: {
            type: "cold",
            source: response.source,
            createdSkill: response.createdSkill,
          },
          navigation: null,
          context,
          replyTo: userMessageDoc?._id || null,
        });

        return res.json(response);
      }

      console.log("[COLD PATH] Valid skill spec:", {
        name: skillSpec.name,
        type: skillSpec.action.type,
      });

      const skillEmbedding = await embedText(
        (skillSpec.description || "") +
          " " +
          (skillSpec.examples || []).join(" ")
      );

      const skillDoc = {
        name: skillSpec.name,
        description: skillSpec.description || "",
        examples: skillSpec.examples || [],
        input_schema: skillSpec.input_schema || null,
        action: skillSpec.action,
        response_template: skillSpec.response_template || "",
        embedding: skillEmbedding,
      };

      console.log("[COLD PATH] Saving new skill:", skillDoc.name);

      const savedSkill = await addSkill(skillDoc);

      const extractedParams = buildDefaultParamsForSkill(savedSkill, context);

      let replyFromSkill = null;
      try {
        replyFromSkill = await executeSkill(
          savedSkill,
          extractedParams,
          context
        );
      } catch (e) {
        console.error("[handleChat] executeSkill error:", e);
      }

      const response = {
        reply: replyFromSkill || answer,
        createdSkill: !!replyFromSkill,
        skillName: replyFromSkill ? savedSkill.name : null,
        source: "cold-with-skill",
        botName: BOT_IDENTITY.nameVi,
      };

      await logChatMessage({
        userId,
        role: "bot",
        message: response.reply,
        meta: {
          type: "cold",
          source: response.source,
          createdSkill: response.createdSkill,
          skillName: response.skillName,
        },
        navigation: null,
        context,
        replyTo: userMessageDoc?._id || null,
      });

      return res.json(response);
    } catch (e) {
      console.error("[handleChat] save/execute skill error:", e);

      const response = {
        reply: answer,
        createdSkill: false,
        source: "cold-error",
        botName: BOT_IDENTITY.nameVi,
      };

      await logChatMessage({
        userId,
        role: "bot",
        message: response.reply,
        meta: {
          type: "cold",
          source: response.source,
          createdSkill: response.createdSkill,
        },
        navigation: null,
        context,
        replyTo: userMessageDoc?._id || null,
      });

      return res.json(response);
    }
  } catch (err) {
    console.error("handleChat error:", err);

    const response = {
      error: "Lỗi server",
      botName: BOT_IDENTITY.nameVi,
    };

    return res.status(500).json(response);
  }
}

/* ========== HEALTH CHECK ENDPOINT ========== */
export async function handleHealthCheck(req, res) {
  try {
    const quickHealth = await checkQuickResponseHealth();

    return res.json({
      status: "ok",
      bot: BOT_IDENTITY,
      layers: {
        quickResponse: {
          status: quickHealth.status,
          details: quickHealth,
          handles: ["greeting", "small_talk", "faq", "navigation"],
        },
        skillMatching: {
          status: "ready",
          description: "OpenAI embedding similarity search",
        },
        gptPlanner: {
          status: process.env.OPENAI_API_KEY ? "ready" : "missing API key",
          description: "GPT-4o-mini for skill creation",
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      error: err.message,
    });
  }
}

/* ========== BOT INFO ENDPOINT ========== */
export async function handleBotInfo(req, res) {
  return res.json({
    ...BOT_IDENTITY,
    version: "2.0",
    features: [
      "Greeting & Small Talk",
      "FAQ về PickleTour",
      "Navigation commands",
      "Tra cứu thông tin giải đấu",
      "Tra cứu thông tin cá nhân",
      "Tìm kiếm VĐV",
    ],
  });
}

/* ========== GET CHAT HISTORY ========== */
export async function handleGetChatHistory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const since = req.query.since ? new Date(req.query.since) : null;

    const query = { userId: currentUser._id };
    if (since) {
      query.createdAt = { $gte: since };
    }

    const messages = await ChatBotMessage.find(query)
      .sort({ createdAt: 1 })
      .limit(limit);

    return res.json({
      messages: messages.map((m) => ({
        id: m._id,
        role: m.role,
        message: m.message,
        meta: m.meta,
        navigation: m.navigation,
        context: m.context,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error("[handleGetChatHistory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== HELPER FUNCTIONS ========== */
function buildDefaultParamsForSkill(skill, context = {}) {
  const params = {};
  const schema = skill.input_schema || skill.inputSchema || null;
  const props = schema?.properties || {};

  // ✅ Inject ALL context variables
  if (context.tournamentId) params.tournamentId = context.tournamentId;
  if (context.matchId) params.matchId = context.matchId;
  if (context.bracketId) params.bracketId = context.bracketId;
  if (context.courtCode) params.courtCode = context.courtCode;
  if (context.currentUserId) params.currentUserId = context.currentUserId;

  if (props.today) params.today = new Date().toISOString();

  if (props.limit) {
    const def = props.limit.default;
    params.limit = (def && Number(def)) || 10;
  }

  if (props.kind) {
    params.kind = props.kind.default || "doubles";
  }

  for (const [key, prop] of Object.entries(props)) {
    if (prop.default !== undefined && params[key] === undefined) {
      params[key] = prop.default;
    }
  }

  return params;
}
