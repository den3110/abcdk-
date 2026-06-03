import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import {
  CLAUDE_POSTER_VISION_MODEL,
  createClaudeJsonMessage,
} from "../lib/anthropicClient.js";

const MAX_ANALYSIS_WIDTH = 1024;

function resolvePosterVisionModel() {
  return String(CLAUDE_POSTER_VISION_MODEL || "claude-sonnet-4-6").trim() ||
    "claude-sonnet-4-6";
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
        h: { type: "number" },
        minFontSize: { type: "number" },
        maxFontSize: { type: "number" },
      },
      required: ["x", "y", "w", "h", "minFontSize", "maxFontSize"],
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

async function createChatTextCandidates(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const system = getContentText(
    messages.find((message) => message?.role === "system")?.content,
  );
  const userMessage = messages.find((message) => message?.role === "user") || {};
  const result = await createClaudeJsonMessage({
    model: payload?.model || POSTER_VISION_MODEL,
    system,
    content: userMessage.content || [],
    schema: posterLayoutJsonSchema.schema,
    toolName: "registration_poster_layout",
    toolDescription:
      "Phân tích layout poster đăng ký giải đấu và trả về JSON đúng schema.",
    maxTokens: payload?.max_tokens || 4096,
  });

  return [result.text].filter(Boolean);
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
      h: clamp(name.h ?? name.height, 1, height, Math.round(height * 0.06)),
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
        h: Math.max(a.name.h, b.name.h),
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
      source: "claude_vision",
      model: POSTER_VISION_MODEL,
      confidence: clamp(raw?.confidence, 0, 1, 0),
      notes: String(raw?.notes || "").slice(0, 500),
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function analyzeRegistrationPosterLayout({
  req,
  imageSource,
  extraPrompt = "",
}) {
  const original = await readImageBuffer(req, imageSource);
  const normalized = await sharp(original)
    .resize({ width: MAX_ANALYSIS_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(normalized).metadata();
  const width = meta.width || 960;
  const height = meta.height || 1280;
  const dataUrl = `data:image/png;base64,${normalized.toString("base64")}`;
  const adminPrompt = String(extraPrompt || "").trim().slice(0, 1200);
  const adminPromptBlock = adminPrompt
    ? `

Prompt bổ sung từ admin cho riêng mẫu poster này:
${adminPrompt}

Hãy ưu tiên prompt bổ sung này khi xác định vị trí avatar/name, miễn là vẫn trả đúng schema JSON và vẫn chỉ phân tích layout.
`
    : "";

  const prompt = `
Bạn là hệ thống thị giác máy tính cho PickleTour. Hãy phân tích poster template giải đấu và tìm đúng vùng để ghép ảnh đại diện VĐV + thay tên VĐV bằng nickname.

Yêu cầu:
- Trả tọa độ theo đúng kích thước ảnh đã gửi: width=${width}, height=${height}.
- avatar là vùng trắng/trống bên trong khung ảnh để đặt ảnh VĐV. Trả x,y,w,h là bounding box của phần ruột khung ảnh, không lấy viền trang trí, không lấy nhãn "VĐV", không lấy khung tên.
- Nếu khung ảnh có bo góc, lượn sóng hoặc hình dạng đặc biệt, vẫn trả bounding box phủ toàn bộ phần ruột khung ảnh để backend dùng mask của template ghép ảnh vừa khung.
- name là vùng placeholder tên cần bị thay thế, thường là ô lớn có chữ mẫu như "HỌ TÊN", "FULL NAME", "NICKNAME" hoặc vùng tên riêng bên dưới ảnh.
- name.x/name.y phải là tâm của chính placeholder tên cần thay thế. name.w/name.h phải bao phủ toàn bộ vùng chữ placeholder để backend xoá đúng vùng đó rồi vẽ nickname vào cùng vị trí.
- Không đặt name ở dưới placeholder, không đặt name ở khoảng giữa khung tên và footer, và không đặt name theo vị trí avatar nếu trên poster đã có vùng placeholder tên rõ ràng.
- Phải giữ nguyên nhãn vai trò nhỏ như "VĐV", "PLAYER", "ATHLETE"; tuyệt đối không chọn các nhãn này làm name.
- Nếu một slot có cả nhãn vai trò "VĐV" và chữ "HỌ TÊN", name phải là vùng "HỌ TÊN"; avatar vẫn là vùng ảnh bên trên; nhãn "VĐV" phải nằm ngoài vùng name.
- Trả x là tâm ngang, y là tâm dọc của vùng tên cần thay; w là bề rộng tối đa của vùng tên; h là chiều cao vùng cần xoá/thay.
- Nếu poster có 2 VĐV, trả slots.double có đúng 2 slot từ trái sang phải.
- slots.single là slot cho giải đơn; nếu template có 2 slot thì đặt slot single ở giữa 2 slot hoặc vùng trung tâm hợp lý.
- Bỏ qua logo, địa điểm, lịch thi đấu, tiêu đề, QR, nhà tài trợ.
- Không bịa nội dung chữ; chỉ tìm layout.
- Chỉ trả JSON đúng schema.
${adminPromptBlock}
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
  let usedModel = POSTER_VISION_MODEL;
  const routeErrors = [];
  for (const route of routes) {
    try {
      const textCandidates = await createChatTextCandidates({
        model: POSTER_VISION_MODEL,
        max_tokens: 4096,
        ...route.payload,
      });
      if (!textCandidates.length) {
        throw new Error("AI không trả về JSON layout");
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
          `AI trả text nhưng không parse được (candidates=${summarizeTextCandidates(textCandidates)}): ${lastParseError?.message || "unknown"}`,
        );
      }
      usedRoute = route.name;
      usedModel = POSTER_VISION_MODEL;
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
  config.ai.model = usedModel;

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
      model: usedModel,
      route: usedRoute,
    },
  };
}
