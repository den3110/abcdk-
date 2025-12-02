// controllers/botController.js (hoặc tương đương)
import { embedText, cosineSim } from "../services/bot/embeddingService.js";
import {
  addSkill,
  findBestSkillByEmbedding,
} from "../services/bot/skillStore.js";
import { executeSkill } from "../services/bot/executionEngine.js";
import { chatWithPlanner } from "../services/bot/openaiService.js";

export async function handleChat(req, res) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    /* ========== 1) WARM PATH: DÙNG SKILL ĐÃ HỌC (KHÔNG TỐN GPT) ========== */
    try {
      const userEmbedding = await embedText(message);
      // threshold 0.8 cho dễ reuse skill hơn một chút
      const best = await findBestSkillByEmbedding(
        userEmbedding,
        0.8,
        cosineSim
      );

      if (best?.skill?.action) {
        const extractedParams = buildDefaultParamsForSkill(best.skill);

        const reply = await executeSkill(best.skill, extractedParams, {
          // context nếu sau này bạn muốn truyền user, headers...
        });

        return res.json({
          reply,
          usedSkill: best.skill.name,
          score: best.score,
          source: "warm",
        });
      }
    } catch (e) {
      console.error("[handleChat] warm-path error (skill search/execute)", e);
      // Cho rơi xuống cold path
    }

    /* ========== 2) COLD PATH: GỌI PLANNER GPT ========== */

    const gptMsg = await chatWithPlanner(message);
    const content = gptMsg?.content || "{}";

    console.log(content)

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("[handleChat] Parse JSON GPT fail:", e, content);
      return res.json({
        reply:
          "Xin lỗi, mình gặp lỗi khi xử lý yêu cầu. Bạn thử lại giúp mình nhé.",
      });
    }

    const answer =
      parsed?.answer_to_user ||
      "Xin lỗi, hiện tại mình chưa trả lời được câu này.";

    // 2a) GPT quyết định KHÔNG tạo skill -> trả luôn answer_to_user
    if (!parsed.should_create_skill || !parsed.skill_spec) {
      return res.json({
        reply: answer,
        createdSkill: false,
        source: "cold-no-skill",
      });
    }

    // 2b) GPT có skill_spec -> LƯU SKILL + CỐ CHẠY, nhưng luôn fallback về answer_to_user
    try {
      const skillSpec = parsed.skill_spec;

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

      const savedSkill = await addSkill(skillDoc);

      const extractedParams = buildDefaultParamsForSkill(savedSkill);

      let replyFromSkill = null;
      try {
        replyFromSkill = await executeSkill(savedSkill, extractedParams, {});
      } catch (e) {
        console.error(
          "[handleChat] executeSkill ngay sau khi tạo skill lỗi:",
          e
        );
      }

      return res.json({
        reply: replyFromSkill || answer,
        createdSkill: !!replyFromSkill,
        skillName: replyFromSkill ? savedSkill.name : null,
        source: "cold-with-skill",
      });
    } catch (e) {
      console.error("[handleChat] error when saving/executing new skill:", e);
      // fallback nếu lỗi lưu skill/embedding
      return res.json({
        reply: answer,
        createdSkill: false,
        source: "cold-error",
      });
    }
  } catch (err) {
    console.error("handleChat error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/**
 * Build param mặc định theo input_schema của skill
 */
function buildDefaultParamsForSkill(skill) {
  const params = {};
  const schema = skill.input_schema || skill.inputSchema || null;
  const props = schema?.properties || {};

  // Cho phép planner dùng field "today" dạng string
  if (props.today) {
    params.today = new Date().toISOString();
  }

  // Nếu schema có limit.default thì dùng, không thì default 10
  if (props.limit) {
    const def = props.limit.default;
    params.limit = (def && Number(def)) || 10;
  }

  return params;
}
