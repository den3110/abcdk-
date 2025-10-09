// routes/planSuggest.js
import OpenAI from "openai";
import Ajv from "ajv";
import asyncHandler from "express-async-handler";
import { planCommit } from "../controllers/admin/adminTournamentController.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ajv = new Ajv({ allErrors: true, strict: false });

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["groups", "po", "ko"],
  properties: {
    groups: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          // tất cả keys đều required, keys “tùy chọn” cho phép null
          required: [
            "count",
            "totalTeams",
            "groupSizes",
            "size",
            "qualifiersPerGroup",
            "rules",
          ],
          properties: {
            count: { type: "integer", minimum: 1 },
            // cho phép null để không bắt buộc giá trị
            totalTeams: { type: ["integer", "null"], minimum: 0 },
            groupSizes: {
              type: ["array", "null"],
              items: { type: "integer", minimum: 0 },
            },
            size: { type: ["integer", "null"], minimum: 0 },
            qualifiersPerGroup: { type: "integer", minimum: 1 },
            rules: { $ref: "#/$defs/rules" },
          },
        },
      ],
    },

    po: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["drawSize", "maxRounds", "seeds", "rules"],
          properties: {
            drawSize: { type: "integer", minimum: 1 },
            maxRounds: { type: "integer", minimum: 1 },
            rules: { $ref: "#/$defs/rules" },
            seeds: { $ref: "#/$defs/seedsPO" },
          },
        },
      ],
    },

    ko: {
      type: "object",
      additionalProperties: false,
      required: ["drawSize", "seeds", "rules", "finalRules"],
      properties: {
        drawSize: { type: "integer", minimum: 2 },
        rules: { $ref: "#/$defs/rules" },
        finalRules: { anyOf: [{ type: "null" }, { $ref: "#/$defs/rules" }] },
        seeds: { $ref: "#/$defs/seedsKO" },
      },
    },
  },

  $defs: {
    rules: {
      type: "object",
      additionalProperties: false,
      required: ["bestOf", "pointsToWin", "winByTwo", "cap"],
      properties: {
        bestOf: { type: "integer", enum: [1, 3, 5] },
        pointsToWin: { type: "integer", enum: [11, 15, 21] },
        winByTwo: { type: "boolean" },
        cap: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "points"],
          properties: {
            mode: { type: "string", enum: ["none", "soft", "hard"] },
            points: {
              anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
            },
          },
        },
      },
    },

    seedRegistration: {
      type: "object",
      additionalProperties: false,
      required: ["type", "label", "ref"],
      properties: {
        type: { type: "string", const: "registration" },
        label: { type: "string" },
        // empty object allowed, nhưng vẫn phải có field `ref`
        ref: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {},
        },
      },
    },

    seedBye: {
      type: "object",
      additionalProperties: false,
      required: ["type", "label", "ref"],
      properties: {
        type: { type: "string", const: "bye" },
        label: { type: "string" },
        ref: {
          type: "object",
          additionalProperties: false,
          required: [],
          properties: {},
        },
      },
    },

    seedGroupRank: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ref", "label"],
      properties: {
        type: { type: "string", const: "groupRank" },
        label: { type: "string" },
        ref: {
          type: "object",
          additionalProperties: false,
          // ✅ bắt buộc có đủ 3 key: stage, groupCode, rank
          required: ["stage", "groupCode", "rank"],
          properties: {
            stage: { type: ["integer", "string"] },
            groupCode: { type: ["string", "null"] },
            rank: { type: "integer", minimum: 1 },
          },
        },
      },
    },

    seedStageWinner: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ref", "label"],
      properties: {
        type: { type: "string", const: "stageMatchWinner" },
        label: { type: "string" },
        ref: {
          type: "object",
          additionalProperties: false,
          required: ["stageIndex", "round", "order"],
          properties: {
            stageIndex: { type: ["integer", "string"] },
            round: { type: "integer", minimum: 1 },
            order: { type: "integer", minimum: 0 },
          },
        },
      },
    },

    seedPair: {
      type: "object",
      additionalProperties: false,
      required: ["pair", "A", "B"],
      properties: {
        pair: { type: "integer", minimum: 1 },
        A: {
          anyOf: [
            { $ref: "#/$defs/seedRegistration" },
            { $ref: "#/$defs/seedBye" },
            { $ref: "#/$defs/seedGroupRank" },
            { $ref: "#/$defs/seedStageWinner" },
          ],
        },
        B: {
          anyOf: [
            { $ref: "#/$defs/seedRegistration" },
            { $ref: "#/$defs/seedBye" },
            { $ref: "#/$defs/seedGroupRank" },
            { $ref: "#/$defs/seedStageWinner" },
          ],
        },
      },
    },

    seedsKO: { type: "array", items: { $ref: "#/$defs/seedPair" } },
    seedsPO: { type: "array", items: { $ref: "#/$defs/seedPair" } },
  },
};

const validatePlan = ajv.compile(planSchema);
const SYSTEM_PROMPT = buildSystemPrompt();

function ajvErrToText(errors = []) {
  return errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

/** Prompt hướng dẫn model xuất đúng payload */
function buildSystemPrompt() {
  return `
Bạn là "AI Tournament Planner". Trả về **DUY NHẤT** JSON đúng schema (groups|po|null và ko) để gọi /plan/commit:
- Không gắn id đội; nếu cần tên dùng "Đội X".
- Nếu chọn Group+KO:
  • Chia groupSizes đều, dồn dư (ví dụ 33 đội → [4,4,4,4,4,5,4,4]).
  • ko.seeds kiểu A1–B2 / B1–A2 theo cặp bảng (1–2, 3–4,...). Hạng ≥3 xếp serpentine.
- Nếu chọn PO+KO:
  • po.seeds V1 ghép 1–2,3–4…; nếu lẻ cho BYE ở cặp cuối.
  • ko.seeds ưu tiên W-V1-Ti vs W-V2-Ti; dư rót từ V3→V4...
- Rules mặc định: BO3 / 11 / winByTwo / cap none (nhận từ client nếu có).
- stageIndex/round/order dùng 1-based hiển thị: label "W-V{round}-T{order+1}", ref.order là 0-based.
- Tuyệt đối không in thêm text ngoài JSON.
`.trim();
}

/** Prompt user (đầu vào cho model) */
function buildUserPrompt({
  paidCount,
  mode,
  groupTargetSize,
  groupTopN,
  rules,
}) {
  return JSON.stringify({
    paidCount,
    mode,
    groupTargetSize,
    groupTopN,
    rules,
  });
}

/** Gọi OpenAI Responses API (Structured Outputs) */
async function askOpenAIForPlan(payload) {
  const instructions = SYSTEM_PROMPT;
  const input = buildUserPrompt(payload);

  const resp = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions,
    input,
    text: {
      format: {
        // ✅ ĐÚNG CÚ PHÁP: phẳng, KHÔNG lồng json_schema
        type: "json_schema",
        name: "TournamentPlan",
        schema: planSchema,
        strict: true,
      },
    },
    temperature: 0.2,
    max_output_tokens: 2000,
  });

  // Lấy text đã hợp nhất
  const text = resp.output_text ?? "";
  // Cắt gọn nếu model bọc ```json
  const jsonStr = (() => {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    return s >= 0 && e >= s ? text.slice(s, e + 1) : text;
  })();

  return JSON.parse(jsonStr);
}
/** POST /api/admin/tournaments/:id/plan/suggest -> trả về JSON plan */
export const suggestPlan = asyncHandler(async (req, res) => {
  const { paidCount, mode, groupTargetSize, groupTopN, rules } = req.body || {};

  if (!Number.isInteger(paidCount) || paidCount < 1) {
    return res.status(400).json({ error: "paidCount phải là số nguyên dương" });
  }

  try {
    const plan = await askOpenAIForPlan({
      paidCount,
      mode,
      groupTargetSize,
      groupTopN,
      rules,
    });

    const ok = validatePlan(plan);
    if (!ok) {
      return res.status(400).json({
        error: "Plan không hợp lệ",
        details: ajvErrToText(validatePlan.errors),
      });
    }

    return res.json(plan);
  } catch (e) {
    console.error("suggestPlan error:", e);
    return res.status(500).json({ error: e.message || "AI suggest failed" });
  }
});

/** POST /api/admin/tournaments/:id/plan/suggest-and-commit -> tạo luôn brackets theo plan AI */
export const suggestAndCommit = asyncHandler(async (req, res) => {
  const { paidCount, mode, groupTargetSize, groupTopN, rules } = req.body || {};

  if (!Number.isInteger(paidCount) || paidCount < 1) {
    return res.status(400).json({ error: "paidCount phải là số nguyên dương" });
  }

  try {
    const plan = await askOpenAIForPlan({
      paidCount,
      mode,
      groupTargetSize,
      groupTopN,
      rules,
    });

    const ok = validatePlan(plan);
    if (!ok) {
      return res.status(400).json({
        error: "Plan không hợp lệ",
        details: ajvErrToText(validatePlan.errors),
      });
    }

    // Dùng lại handler commit: truyền plan làm body
    const req2 = { ...req, body: plan };
    return planCommit(req2, res);
  } catch (e) {
    console.error("suggestAndCommit error:", e);
    return res
      .status(500)
      .json({ error: e.message || "AI suggest&commit failed" });
  }
});
