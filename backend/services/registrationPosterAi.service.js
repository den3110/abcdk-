import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { openai, OPENAI_VISION_MODEL } from "../lib/openaiClient.js";

const MAX_ANALYSIS_WIDTH = 1024;

function resolvePosterVisionModel() {
  return (
    String(process.env.OPENAI_POSTER_VISION_MODEL || OPENAI_VISION_MODEL || "")
      .trim() || "gpt-5-codex-mini"
  );
}

const POSTER_VISION_MODEL = resolvePosterVisionModel();

const slotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    avatar: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
        radius: { type: "number" },
      },
      required: ["x", "y", "w", "h", "radius"],
    },
    name: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        minFontSize: { type: "number" },
        maxFontSize: { type: "number" },
      },
      required: ["x", "y", "w", "minFontSize", "maxFontSize"],
    },
  },
  required: ["avatar", "name"],
};

const posterLayoutJsonSchema = {
  name: "registration_poster_layout",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      baseWidth: { type: "number" },
      baseHeight: { type: "number" },
      slots: {
        type: "object",
        additionalProperties: false,
        properties: {
          single: { type: "array", items: slotSchema },
          double: { type: "array", items: slotSchema },
        },
        required: ["single", "double"],
      },
      text: {
        type: "object",
        additionalProperties: false,
        properties: {
          color: { type: "string" },
          fontFamily: { type: "string" },
          fontWeight: { type: "number" },
          fontStyle: { type: "string" },
          transform: { type: "string" },
          minFontSize: { type: "number" },
          maxFontSize: { type: "number" },
          charRatio: { type: "number" },
        },
        required: [
          "color",
          "fontFamily",
          "fontWeight",
          "fontStyle",
          "transform",
          "minFontSize",
          "maxFontSize",
          "charRatio",
        ],
      },
      confidence: { type: "number" },
      notes: { type: "string" },
    },
    required: ["baseWidth", "baseHeight", "slots", "text", "confidence", "notes"],
  },
};

function resolveLocalImagePath(src = "") {
  const clean = String(src || "").split("?")[0].replace(/\\/g, "/").trim();
  if (!clean || /^https?:\/\//i.test(clean)) return null;
  if (/^[a-zA-Z]:\//.test(clean)) return path.normalize(clean);
  return path.join(process.cwd(), clean.replace(/^\/+/, ""));
}

async function readImageBuffer(req, src = "") {
  const raw = String(src || "").trim();
  if (!raw) throw new Error("Thiếu ảnh poster để AI phân tích");

  const localPath = resolveLocalImagePath(raw);
  if (localPath) {
    try {
      return await fs.readFile(localPath);
    } catch {}
  }

  const origin = `${req.protocol}://${req.get("host")}`;
  const url = /^https?:\/\//i.test(raw) ? raw : new URL(raw, origin).toString();
  const response = await fetch(url, {
    headers: req.get("cookie") ? { cookie: req.get("cookie") } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Không tải được ảnh poster: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function extractJson(text = "") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI không trả về JSON layout");
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return JSON.parse(fenced);

  const objectMatch = raw.match(/\{[\s\S]*\}$/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error("Không đọc được JSON layout từ AI");
}

function getContentText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text || part?.output_text || "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function extractChatTextCandidates(response) {
  const choice = response?.choices?.[0] || {};
  const message = response?.choices?.[0]?.message || {};
  return [
    getContentText(message.content),
    getContentText(message.reasoning_content),
    getContentText(message.reasoning),
    getContentText(message.output_text),
    getContentText(choice.text),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

function summarizeRouteError(routeName, error) {
  return `${routeName}: ${String(error?.message || error).slice(0, 240)}`;
}

function summarizeTextCandidates(candidates) {
  return candidates
    .map((text) => `${text.length} chars`)
    .filter(Boolean)
    .join(", ");
}

function summarizeAiResponse(response) {
  const choice = response?.choices?.[0] || {};
  const message = choice.message || {};
  const finishReason = choice.finish_reason || "unknown";
  const refusal = message.refusal
    ? ` refusal=${String(message.refusal).slice(0, 120)}`
    : "";
  const reasoningLength = message.reasoning_content
    ? ` reasoning=${String(message.reasoning_content).length} chars`
    : "";
  return `finish=${finishReason}${refusal}${reasoningLength}`;
}

function clamp(n, min, max, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeSlot(slot, width, height) {
  const avatar = slot?.avatar || {};
  const name = slot?.name || {};
  return {
    avatar: {
      x: clamp(avatar.x, 0, width, 0),
      y: clamp(avatar.y, 0, height, 0),
      w: clamp(avatar.w, 1, width, Math.round(width * 0.3)),
      h: clamp(avatar.h, 1, height, Math.round(width * 0.3)),
      radius: avatar.radius ?? 24,
    },
    name: {
      x: clamp(name.x, 0, width, Math.round(width / 2)),
      y: clamp(name.y, 0, height, Math.round(height * 0.65)),
      w: clamp(name.w, 1, width, Math.round(width * 0.4)),
      minFontSize: clamp(name.minFontSize, 8, 96, 22),
      maxFontSize: clamp(name.maxFontSize, 8, 120, 46),
    },
  };
}

function deriveSingleSlotFromDouble(slots, width, height) {
  if (!Array.isArray(slots) || slots.length < 2) return null;
  const [a, b] = slots;
  const avatarCenterX =
    (a.avatar.x + a.avatar.w / 2 + b.avatar.x + b.avatar.w / 2) / 2;
  const avatarW = Math.max(1, Math.round((a.avatar.w + b.avatar.w) / 2));
  const avatarH = Math.max(1, Math.round((a.avatar.h + b.avatar.h) / 2));
  return normalizeSlot(
    {
      avatar: {
        x: avatarCenterX - avatarW / 2,
        y: (a.avatar.y + b.avatar.y) / 2,
        w: avatarW,
        h: avatarH,
        radius: a.avatar.radius ?? b.avatar.radius ?? 24,
      },
      name: {
        x: (a.name.x + b.name.x) / 2,
        y: (a.name.y + b.name.y) / 2,
        w: Math.max(a.name.w, b.name.w),
        minFontSize: Math.min(a.name.minFontSize, b.name.minFontSize),
        maxFontSize: Math.max(a.name.maxFontSize, b.name.maxFontSize),
      },
    },
    width,
    height,
  );
}

function normalizeLayout(raw, width, height) {
  let doubleSlots = Array.isArray(raw?.slots?.double)
    ? raw.slots.double.slice(0, 2)
    : [];
  let singleSlots = Array.isArray(raw?.slots?.single)
    ? raw.slots.single.slice(0, 1)
    : [];
  doubleSlots = doubleSlots.map((slot) => normalizeSlot(slot, width, height));
  singleSlots = singleSlots.map((slot) => normalizeSlot(slot, width, height));
  if (!singleSlots.length) {
    const derivedSingle = deriveSingleSlotFromDouble(doubleSlots, width, height);
    if (derivedSingle) singleSlots = [derivedSingle];
  }
  if (!doubleSlots.length && singleSlots.length) {
    doubleSlots = singleSlots;
  }

  return {
    baseWidth: width,
    baseHeight: height,
    slots: {
      single: singleSlots,
      double: doubleSlots,
    },
    text: {
      color: raw?.text?.color || "#ffffff",
      fontFamily: raw?.text?.fontFamily || "Arial, sans-serif",
      fontWeight: clamp(raw?.text?.fontWeight, 100, 1000, 900),
      fontStyle: raw?.text?.fontStyle || "italic",
      transform: raw?.text?.transform || "uppercase",
      minFontSize: clamp(raw?.text?.minFontSize, 8, 96, 24),
      maxFontSize: clamp(raw?.text?.maxFontSize, 8, 120, 46),
      charRatio: clamp(raw?.text?.charRatio, 0.35, 1.2, 0.58),
    },
    ai: {
      source: "openai_vision",
      model: POSTER_VISION_MODEL,
      confidence: clamp(raw?.confidence, 0, 1, 0),
      notes: String(raw?.notes || "").slice(0, 500),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function analyzeRegistrationPosterLayout({ req, imageSource }) {
  if (!process.env.OPENAI_API_KEY && !process.env.CLIPROXY_API_KEY) {
    throw new Error("Thiếu OPENAI_API_KEY hoặc CLIPROXY_API_KEY để chạy AI poster");
  }

  const original = await readImageBuffer(req, imageSource);
  const normalized = await sharp(original)
    .resize({ width: MAX_ANALYSIS_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(normalized).metadata();
  const width = meta.width || 960;
  const height = meta.height || 1280;
  const dataUrl = `data:image/png;base64,${normalized.toString("base64")}`;

  const prompt = `
Bạn là hệ thống thị giác máy tính cho PickleTour. Hãy phân tích poster template giải đấu và tìm vùng để ghép ảnh đại diện VĐV + tên VĐV.

Yêu cầu:
- Trả tọa độ theo đúng kích thước ảnh đã gửi: width=${width}, height=${height}.
- avatar là vùng ảnh trắng/trống/placeholder để đặt ảnh VĐV. Trả x,y là góc trái trên, w,h là kích thước.
- name là vùng chữ tên VĐV, thường nằm dưới ảnh, có chữ mẫu như "HỌ TÊN", "VDV", hoặc khung tên.
- Nếu thấy chữ "HỌ TÊN" hoặc một placeholder tên tương tự, name.x/name.y phải là tâm của chính dòng chữ đó để backend thay chữ này bằng tên VĐV thật.
- Trả x là tâm ngang, y là tâm dọc dòng chữ, w là bề rộng tối đa của khung tên.
- Nếu poster có 2 VĐV, trả slots.double có đúng 2 slot từ trái sang phải.
- slots.single là slot cho giải đơn; nếu template có 2 slot thì đặt slot single ở giữa 2 slot hoặc vùng trung tâm hợp lý.
- Bỏ qua logo, địa điểm, lịch thi đấu, tiêu đề, QR, nhà tài trợ.
- Không bịa nội dung chữ; chỉ tìm layout.
- Chỉ trả JSON đúng schema.
`;

  const schemaText = JSON.stringify(posterLayoutJsonSchema.schema);
  const baseMessages = [
    {
      role: "system",
      content:
        "Bạn phân tích bố cục ảnh poster và trả JSON layout để backend render ảnh tự động. Không trả markdown.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];
  const jsonObjectMessages = [
    baseMessages[0],
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${prompt}\n\nSchema JSON bắt buộc:\n${schemaText}\n\nChỉ trả về một JSON object hợp lệ, không markdown, không giải thích.`,
        },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];
  const routes = [
    {
      name: "chat_json_schema",
      payload: {
        response_format: {
          type: "json_schema",
          json_schema: posterLayoutJsonSchema,
        },
        messages: baseMessages,
      },
    },
    {
      name: "chat_json_object",
      payload: {
        response_format: { type: "json_object" },
        messages: jsonObjectMessages,
      },
    },
    {
      name: "chat_plain_json",
      payload: {
        messages: jsonObjectMessages,
      },
    },
  ];

  let parsed = null;
  let usedRoute = "";
  const routeErrors = [];
  for (const route of routes) {
    try {
      const response = await openai.chat.completions.create({
        model: POSTER_VISION_MODEL,
        max_tokens: 4096,
        ...route.payload,
      });
      const textCandidates = extractChatTextCandidates(response);
      if (!textCandidates.length) {
        throw new Error(
          `AI không trả về JSON layout (${summarizeAiResponse(response)})`,
        );
      }
      let lastParseError = null;
      for (const jsonText of textCandidates) {
        try {
          parsed = extractJson(jsonText);
          break;
        } catch (parseError) {
          lastParseError = parseError;
        }
      }
      if (!parsed) {
        throw new Error(
          `AI trả text nhưng không parse được (${summarizeAiResponse(response)}; candidates=${summarizeTextCandidates(textCandidates)}): ${lastParseError?.message || "unknown"}`,
        );
      }
      usedRoute = route.name;
      break;
    } catch (error) {
      routeErrors.push(summarizeRouteError(route.name, error));
    }
  }
  if (!parsed) {
    console.error(
      "[AI Poster] all JSON routes failed:",
      routeErrors.join(" | "),
    );
    const detail = routeErrors.join(" | ").slice(0, 700);
    throw new Error(
      `AI không trả về JSON layout. Đã thử json_schema, json_object và plain JSON. Chi tiết: ${detail}`,
    );
  }
  const config = normalizeLayout(parsed, width, height);
  config.ai.route = usedRoute;

  if (!config.slots.double.length && !config.slots.single.length) {
    throw new Error("AI không tìm thấy slot ảnh/tên trên poster");
  }

  return {
    config,
    analysis: {
      width,
      height,
      confidence: config.ai.confidence,
      notes: config.ai.notes,
      model: POSTER_VISION_MODEL,
      route: usedRoute,
    },
  };
}
