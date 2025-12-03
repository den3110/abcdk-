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
  BOT_IDENTITY 
} from "../services/bot/quickResponseService.js";

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

    /* ========== LAYER 0: QUICK RESPONSE (Qwen 0.5b) ========== */
    // Handles: Greeting, Small Talk, FAQ, Navigation
    // Cost: FREE (local Ollama)
    try {
      const quickResult = await processQuickResponse(message, context);
      
      if (quickResult) {
        console.log(`[QUICK RESPONSE] Type: ${quickResult.type}, Intent: ${quickResult.intent}`);
        
        const response = {
          reply: quickResult.reply,
          type: quickResult.type,
          source: quickResult.source,
          confidence: quickResult.confidence,
          processingTime: quickResult.processingTime,
          botName: BOT_IDENTITY.nameVi
        };

        // Add navigation info if applicable
        if (quickResult.navigation) {
          response.navigation = quickResult.navigation;
        }

        return res.json(response);
      }
    } catch (quickError) {
      console.error("[handleChat] Quick response layer error:", quickError.message);
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

        return res.json({
          reply,
          usedSkill: best.skill.name,
          score: best.score,
          source: "warm",
          botName: BOT_IDENTITY.nameVi
        });
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
      return res.json({
        reply: "Xin lỗi, mình gặp lỗi khi xử lý. Bạn thử lại nhé.",
        botName: BOT_IDENTITY.nameVi
      });
    }

    const answer =
      parsed?.answer_to_user ||
      "Xin lỗi, hiện tại mình chưa trả lời được câu này. Bạn thử hỏi cách khác hoặc liên hệ hỗ trợ nhé!";

    if (!parsed.should_create_skill || !parsed.skill_spec) {
      return res.json({
        reply: answer,
        createdSkill: false,
        source: "cold-no-skill",
        botName: BOT_IDENTITY.nameVi
      });
    }

    try {
      const skillSpec = parsed.skill_spec;

      // ✅ VALIDATION - Check required fields
      if (!skillSpec.name) {
        console.error("[handleChat] Missing skill name:", skillSpec);
        return res.json({
          reply: answer,
          createdSkill: false,
          source: "cold-missing-name",
          botName: BOT_IDENTITY.nameVi
        });
      }

      if (!skillSpec.action || !skillSpec.action.type) {
        console.error("[handleChat] Missing action or action.type:", skillSpec);
        return res.json({
          reply: answer,
          createdSkill: false,
          source: "cold-missing-action",
          botName: BOT_IDENTITY.nameVi
        });
      }

      // ✅ VALIDATION - Check valid action.type
      const validTypes = ["mongo", "aggregate", "internal", "http"];
      if (!validTypes.includes(skillSpec.action.type)) {
        console.error("[handleChat] Invalid action.type:", skillSpec.action.type);
        return res.json({
          reply: answer,
          createdSkill: false,
          source: "cold-invalid-action-type",
          botName: BOT_IDENTITY.nameVi
        });
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

      return res.json({
        reply: replyFromSkill || answer,
        createdSkill: !!replyFromSkill,
        skillName: replyFromSkill ? savedSkill.name : null,
        source: "cold-with-skill",
        botName: BOT_IDENTITY.nameVi
      });
    } catch (e) {
      console.error("[handleChat] save/execute skill error:", e);
      return res.json({
        reply: answer,
        createdSkill: false,
        source: "cold-error",
        botName: BOT_IDENTITY.nameVi
      });
    }
  } catch (err) {
    console.error("handleChat error:", err);
    return res.status(500).json({ 
      error: "Lỗi server",
      botName: BOT_IDENTITY.nameVi
    });
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
          handles: ["greeting", "small_talk", "faq", "navigation"]
        },
        skillMatching: {
          status: "ready",
          description: "OpenAI embedding similarity search"
        },
        gptPlanner: {
          status: process.env.OPENAI_API_KEY ? "ready" : "missing API key",
          description: "GPT-4o-mini for skill creation"
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ 
      status: "error", 
      error: err.message 
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
      "Tìm kiếm VĐV"
    ]
  });
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