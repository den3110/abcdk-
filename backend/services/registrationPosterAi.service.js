import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import OpenAI from "openai";
import dotenv from "dotenv";
import AiPosterUsage from "../models/aiPosterUsageModel.js";

dotenv.config();

const MAX_ANALYSIS_WIDTH = 1024;
const POSTER_AI_LAYOUT_VERSION = 6;
const DEFAULT_OPENAI_POSTER_MODEL = "gpt-5.5";
const OPENAI_OFFICIAL_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_POSTER_DAILY_LIMIT = 10;

function resolvePosterVisionModel() {
  return String(
    process.env.OPENAI_POSTER_VISION_MODEL ||
      process.env.OPENAI_POSTER_MODEL ||
      DEFAULT_OPENAI_POSTER_MODEL,
  ).trim() || DEFAULT_OPENAI_POSTER_MODEL;
}

const POSTER_VISION_MODEL = resolvePosterVisionModel();
let posterOpenAiClient = null;

function trim(value) {
  return String(value || "").trim();
}

function resolveOfficialOpenAiPosterBaseUrl() {
  const base = trim(process.env.OPENAI_POSTER_BASE_URL).replace(/\/+$/, "");
  if (
    base === "https://api.openai.com" ||
    base === OPENAI_OFFICIAL_BASE_URL
  ) {
    return OPENAI_OFFICIAL_BASE_URL;
  }
  return OPENAI_OFFICIAL_BASE_URL;
}

function getOfficialOpenAiPosterKey() {
  const key = trim(process.env.OPENAI_POSTER_API_KEY);
  return key.startsWith("sk-") ? key : "";
}

function getOpenAiPosterClient() {
  const apiKey = getOfficialOpenAiPosterKey();
  if (!apiKey) {
    throw new Error(
      "Thiếu OPENAI_POSTER_API_KEY hợp lệ để gọi OpenAI chính thống cho AI poster.",
    );
  }
  if (!posterOpenAiClient) {
    posterOpenAiClient = new OpenAI({
      apiKey,
      baseURL: resolveOfficialOpenAiPosterBaseUrl(),
    });
  }
  return posterOpenAiClient;
}

function resolveOpenAiPosterDailyLimit() {
  const limit = Number(process.env.OPENAI_POSTER_DAILY_LIMIT);
  return Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : DEFAULT_OPENAI_POSTER_DAILY_LIMIT;
}

function getPosterUsageYmd(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function reserveOpenAiPosterCall(model = POSTER_VISION_MODEL) {
  const limit = resolveOpenAiPosterDailyLimit();
  const ymd = getPosterUsageYmd();
  try {
    const usage = await AiPosterUsage.findOneAndUpdate(
      {
        scope: "openai-poster",
        ymd,
        count: { $lt: limit },
      },
      {
        $inc: { count: 1 },
        $setOnInsert: { scope: "openai-poster", ymd },
        $set: { lastAttemptAt: new Date(), model },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    if (!usage) {
      throw new Error("quota_exceeded");
    }
    return { ymd, count: usage.count, limit };
  } catch (error) {
    if (error?.code === 11000) {
      const usage = await AiPosterUsage.findOneAndUpdate(
        {
          scope: "openai-poster",
          ymd,
          count: { $lt: limit },
        },
        {
          $inc: { count: 1 },
          $set: { lastAttemptAt: new Date(), model },
        },
        { new: true },
      ).lean();
      if (usage) return { ymd, count: usage.count, limit };
    }
    if (error?.code === 11000 || error?.message === "quota_exceeded") {
      throw new Error(
        `Đã đạt giới hạn ${limit} lần gọi OpenAI AI poster trong ngày ${ymd}. Vui lòng thử lại ngày mai hoặc tăng OPENAI_POSTER_DAILY_LIMIT.`,
      );
    }
    throw error;
  }
}

const rectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
  required: ["x", "y", "w", "h"],
};

const slotSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    avatar: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: {
          type: "number",
          description:
            "Tọa độ góc trái trên của phần ruột ô trắng/kem dùng để đặt ảnh VĐV.",
        },
        y: {
          type: "number",
          description:
            "Tọa độ góc trái trên của phần ruột ô trắng/kem dùng để đặt ảnh VĐV.",
        },
        w: {
          type: "number",
          description:
            "Chiều rộng phần ruột ô trắng/kem, không bao gồm viền, nhãn VĐV hoặc khung tên.",
        },
        h: {
          type: "number",
          description:
            "Chiều cao phần ruột ô trắng/kem, không bao gồm viền, nhãn VĐV hoặc khung tên.",
        },
        radius: {
          type: "number",
          description: "Độ bo góc của ô ảnh để crop avatar khớp với placeholder.",
        },
        safeInset: {
          type: "number",
          description:
            "Số pixel cần lùi vào trong vùng avatar để tránh che viền/khung/tab. Thường 0-6.",
        },
        clipPath: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              description:
                'Kiểu mask crop avatar: "rounded_rect" cho khung chữ nhật/bo góc, "polygon" cho khung lượn sóng/phức tạp.',
            },
            points: {
              type: "array",
              description:
                'Danh sách điểm polygon theo tọa độ tuyệt đối của ảnh đã gửi. Dùng [] khi type là "rounded_rect".',
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
              },
            },
          },
          required: ["type", "points"],
        },
      },
      required: ["x", "y", "w", "h", "radius", "safeInset", "clipPath"],
    },
    name: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
        textBox: rectSchema,
        erase: rectSchema,
        eraseRegions: {
          type: "array",
          items: rectSchema,
          minItems: 1,
          maxItems: 6,
        },
        minFontSize: { type: "number" },
        maxFontSize: { type: "number" },
      },
      required: [
        "x",
        "y",
        "w",
        "h",
        "textBox",
        "erase",
        "eraseRegions",
        "minFontSize",
        "maxFontSize",
      ],
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

function toOpenAiResponsesContent(content) {
  const parts = Array.isArray(content) ? content : [{ type: "text", text: content }];
  return parts
    .map((part) => {
      if (!part) return null;
      if (typeof part === "string") {
        return { type: "input_text", text: part };
      }
      if (part.type === "text") {
        return { type: "input_text", text: String(part.text || "") };
      }
      if (part.type === "image_url") {
        const imageUrl = String(part.image_url?.url || "").trim();
        return imageUrl ? { type: "input_image", image_url: imageUrl } : null;
      }
      if (part.type === "input_text" || part.type === "input_image") {
        return part;
      }
      return null;
    })
    .filter(Boolean);
}

function extractResponsesText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function createOpenAiPosterTextCandidates(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const system = getContentText(
    messages.find((message) => message?.role === "system")?.content,
  );
  const userMessage = messages.find((message) => message?.role === "user") || {};
  const model = payload?.model || POSTER_VISION_MODEL;
  const client = getOpenAiPosterClient();
  await reserveOpenAiPosterCall(model);
  const response = await client.responses.create({
    model,
    ...(system ? { instructions: system } : {}),
    input: [
      {
        role: "user",
        content: toOpenAiResponsesContent(userMessage.content || []),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "registration_poster_layout",
        strict: true,
        schema: posterLayoutJsonSchema.schema,
      },
    },
    max_output_tokens: payload?.max_tokens || 4096,
  });

  return [extractResponsesText(response)].filter(Boolean);
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

function normalizeClipPath(clipPath, width, height) {
  const type = String(clipPath?.type || "").toLowerCase();
  const points = Array.isArray(clipPath?.points)
    ? clipPath.points
        .map((point) => ({
          x: clamp(point?.x, 0, width, 0),
          y: clamp(point?.y, 0, height, 0),
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];

  if (type === "polygon" && points.length >= 3) {
    return { type: "polygon", points: points.slice(0, 24) };
  }

  return { type: "rounded_rect", points: [] };
}

function normalizeEraseRegion(region, width, height, label) {
  const x = Number(region?.x ?? region?.left);
  const y = Number(region?.y ?? region?.top);
  const w = Number(region?.w ?? region?.width);
  const h = Number(region?.h ?? region?.height);
  if (![x, y, w, h].every(Number.isFinite)) {
    throw new Error(`AI poster layout trả ${label} không hợp lệ.`);
  }
  return {
    x: clamp(x, 0, width, 0),
    y: clamp(y, 0, height, 0),
    w: clamp(w, 1, width, 1),
    h: clamp(h, 1, height, 1),
  };
}

function normalizeSlot(slot, width, height) {
  const avatar = slot?.avatar || {};
  const name = slot?.name || {};
  const erase = name?.erase;
  if (!erase || typeof erase !== "object") {
    throw new Error("AI poster layout thiếu name.erase cho vùng xoá tên.");
  }
  if (!name?.textBox || typeof name.textBox !== "object") {
    throw new Error("AI poster layout thiếu name.textBox cho vùng vẽ tên.");
  }
  if (!Array.isArray(name?.eraseRegions) || !name.eraseRegions.length) {
    throw new Error("AI poster layout thiếu name.eraseRegions cho vùng xoá tên.");
  }
  const nameX = Number(name.x);
  const nameY = Number(name.y);
  const nameWRaw = Number(name.w);
  const nameHRaw = Number(name.h ?? name.height);
  if (![nameX, nameY, nameWRaw, nameHRaw].every(Number.isFinite)) {
    throw new Error("AI poster layout trả name/name.erase không hợp lệ.");
  }
  const eraseRect = normalizeEraseRegion(erase, width, height, "name.erase");
  const textBox = normalizeEraseRegion(name.textBox, width, height, "name.textBox");
  const eraseRegions = name.eraseRegions
    .slice(0, 6)
    .map((region, idx) =>
      normalizeEraseRegion(region, width, height, `name.eraseRegions[${idx}]`),
    );
  const avatarW = clamp(avatar.w, 1, width, Math.round(width * 0.3));
  const avatarH = clamp(avatar.h, 1, height, Math.round(width * 0.3));
  const nameW = textBox.w;
  const nameH = textBox.h;
  return {
    avatar: {
      x: clamp(avatar.x, 0, width, 0),
      y: clamp(avatar.y, 0, height, 0),
      w: avatarW,
      h: avatarH,
      radius: avatar.radius ?? 24,
      safeInset: clamp(
        avatar.safeInset,
        0,
        Math.min(24, Math.min(avatarW, avatarH) * 0.12),
        0,
      ),
      clipPath: normalizeClipPath(avatar.clipPath, width, height),
    },
    name: {
      x: clamp(textBox.x + textBox.w / 2, 0, width, Math.round(width / 2)),
      y: clamp(textBox.y + textBox.h / 2, 0, height, Math.round(height * 0.65)),
      w: nameW,
      h: nameH,
      textBox,
      erase: eraseRect,
      eraseRegions,
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
  const eraseX = Math.min(a.name.erase.x, b.name.erase.x);
  const eraseY = Math.min(a.name.erase.y, b.name.erase.y);
  const eraseW =
    Math.max(
      a.name.erase.x + a.name.erase.w,
      b.name.erase.x + b.name.erase.w,
    ) - eraseX;
  const eraseH =
    Math.max(
      a.name.erase.y + a.name.erase.h,
      b.name.erase.y + b.name.erase.h,
    ) - eraseY;
  const erase = { x: eraseX, y: eraseY, w: eraseW, h: eraseH };
  const textBox = {
    x: eraseX,
    y: eraseY,
    w: eraseW,
    h: Math.max(a.name.textBox.h, b.name.textBox.h),
  };
  return normalizeSlot(
    {
      avatar: {
        x: avatarCenterX - avatarW / 2,
        y: (a.avatar.y + b.avatar.y) / 2,
        w: avatarW,
        h: avatarH,
        radius: a.avatar.radius ?? b.avatar.radius ?? 24,
        safeInset: Math.max(a.avatar.safeInset || 0, b.avatar.safeInset || 0),
      },
      name: {
        x: (a.name.x + b.name.x) / 2,
        y: (a.name.y + b.name.y) / 2,
        w: Math.max(a.name.w, b.name.w),
        h: Math.max(a.name.h, b.name.h),
        textBox,
        erase,
        eraseRegions: [erase],
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
      layoutVersion: POSTER_AI_LAYOUT_VERSION,
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
Bạn là hệ thống thị giác máy tính cho PickleTour. Hãy tự phân tích poster template giải đấu và trả về layout chính xác để backend crop ảnh VĐV vào đúng ô trắng, rồi thay tên VĐV bằng nickname.

Yêu cầu:
- Trả tọa độ theo đúng kích thước ảnh đã gửi: width=${width}, height=${height}.
- avatar là vùng trắng/kem/trống bên trong khung ảnh để đặt ảnh VĐV. Đây là vùng ảnh thật sẽ bị crop và ghép vào poster.
- avatar.x và avatar.y BẮT BUỘC là góc trái trên của phần ruột ô trắng/kem; avatar.w/avatar.h là chiều rộng/chiều cao phần ruột ô đó. Không trả x/y theo tâm.
- avatar phải sát mép trong của khung ảnh để ảnh render phủ kín vùng mở ảnh. Không được thu nhỏ box vào giữa làm còn thừa nền trắng/kem xung quanh ảnh.
- avatar.safeInset là số pixel cần lùi vào trong để ảnh không che viền vàng/đen/tab. Nếu avatar.x/y/w/h đã là vùng ảnh an toàn thì safeInset = 0; nếu còn sát viền khung thì dùng 1-6. Không dùng safeInset lớn làm ảnh bị hụt khỏi ô trắng.
- Ảnh VĐV sau khi render phải nằm bên trong ô trắng/kem. Nếu avatar box rơi xuống nền sân, nền người chơi, thanh tên, nhãn "VĐV", footer hoặc vùng tối phía sau thì kết quả sai.
- Không lấy viền trang trí, không lấy nhãn "VĐV", không lấy dấu "&", không lấy khung tên, không lấy ảnh nền sân phía sau làm avatar.
- Nếu có ô trắng bên trên nhãn "VĐV" và khung tên "HỌ TÊN", avatar phải là ô trắng đó; avatar.y + avatar.h phải kết thúc trước nhãn "VĐV"/khung tên.
- Nếu poster có hai ô trắng cho hai VĐV, slots.double[0] là ô trắng bên trái và slots.double[1] là ô trắng bên phải. Hai ô này thường nằm cùng hàng, cùng kích thước, phía trên từng khung tên.
- Nếu khung ảnh là chữ nhật hoặc bo góc thông thường và không có tab/nhãn chen vào phần ảnh, trả avatar.clipPath.type = "rounded_rect", avatar.clipPath.points = [], radius phản ánh độ bo góc thực tế.
- Nếu khung ảnh lượn sóng, vát chéo, đa giác, có tai/gờ, có tab/nhãn "VĐV" đè vào đáy khung, hoặc hình dạng phức tạp, trả avatar.clipPath.type = "polygon" và avatar.clipPath.points là các điểm bám theo mép phần ảnh nhìn thấy, theo chiều kim đồng hồ, dùng tọa độ tuyệt đối trong ảnh width=${width}, height=${height}. Không dùng polygon bám viền trang trí bên ngoài.
- Nếu không chắc khung có phải rounded_rect đơn giản hay không, hãy ưu tiên polygon.
- Với polygon, avatar.x/y/w/h vẫn là bounding box bao toàn bộ vùng polygon sau khi đã né viền/tab, còn clipPath.points mới là hình crop thật. Dùng khoảng 6-16 điểm; chỉ dùng nhiều hơn nếu khung thật sự phức tạp.
- name là vùng placeholder tên cần bị thay thế, thường là ô lớn có chữ mẫu như "HỌ TÊN", "FULL NAME", "NICKNAME" hoặc vùng tên riêng bên dưới ảnh.
- name.textBox là hình chữ nhật của panel nơi backend sẽ vẽ nickname mới. textBox.x/textBox.y là góc trái trên panel tên, textBox.w/textBox.h là kích thước panel tên. Chọn đúng ô đen/vàng lớn dành cho tên VĐV, không chọn nhãn "VĐV", không chọn dòng xác nhận, không chọn tiêu đề giải.
- name.x/name.y phải là tâm của name.textBox. name.w/name.h phải bằng kích thước name.textBox để backend căn giữa nickname trong panel đó.
- name.erase là hình chữ nhật xoá placeholder tên, với x/y là góc trái trên và w/h là kích thước. name.erase phải bao phủ TOÀN BỘ chữ mẫu như "HỌ TÊN", "FULL NAME", "NICKNAME" và nền panel tên cần che, không được để sót phần trên của chữ mẫu cũ.
- name.eraseRegions là danh sách các hình chữ nhật xoá do AI tự detect. Mỗi vùng phải bao phủ một cụm chữ mẫu hoặc nền panel cần xoá trước khi vẽ nickname. Nếu chữ "HỌ TÊN" nằm cao hơn nickname mới, phải có một eraseRegion riêng bao phủ trọn chữ "HỌ TÊN" đó.
- Nếu placeholder tên có nhiều phần bị tách nhau bởi viền/trang trí, trả nhiều eraseRegions nhỏ thay vì một vùng lớn che nhầm sang nhãn "VĐV", avatar, dòng xác nhận, tiêu đề hoặc footer.
- Với template có chữ "HỌ TÊN" nằm phía trên vị trí tên thật, name.erase.y phải nằm cao hơn điểm cao nhất của chữ "HỌ TÊN"; name.erase.h phải kết thúc thấp hơn điểm thấp nhất của placeholder đó.
- Tự kiểm tra bằng mắt trước khi trả JSON: nếu backend vẽ một hình chữ nhật tối lên từng eraseRegion thì toàn bộ chữ mẫu "HỌ TÊN"/"FULL NAME"/"NICKNAME" phải biến mất, còn nhãn "VĐV" vẫn còn.
- Tự kiểm tra vị trí chữ mới: nếu backend vẽ nickname ở tâm name.textBox thì nickname phải nằm gọn trong panel tên, không nằm đè lên ảnh, nhãn "VĐV", dòng xác nhận, tiêu đề giải hoặc footer.
- name.x/name.y là tâm nơi backend vẽ nickname mới. name.x/name.y phải nằm trong name.textBox; tuyệt đối không đặt theo tâm eraseRegions nếu eraseRegions chỉ là vùng xoá chữ mẫu phía trên.
- Không đặt name ở dưới placeholder, không đặt name ở khoảng giữa khung tên và footer, và không đặt name theo vị trí avatar nếu trên poster đã có vùng placeholder tên rõ ràng.
- Phải giữ nguyên nhãn vai trò nhỏ như "VĐV", "PLAYER", "ATHLETE"; tuyệt đối không chọn các nhãn này làm name.
- Nếu một slot có cả nhãn vai trò "VĐV" và chữ "HỌ TÊN", name phải là vùng "HỌ TÊN"; avatar vẫn là vùng ảnh bên trên; nhãn "VĐV" phải nằm ngoài vùng name.
- Trả x là tâm ngang, y là tâm dọc của vùng tên cần thay; w là bề rộng tối đa của vùng tên; h là chiều cao vùng cần xoá/thay.
- Nếu poster có 2 VĐV, trả slots.double có đúng 2 slot từ trái sang phải.
- slots.single là slot cho giải đơn; nếu template có 2 slot thì đặt slot single ở giữa 2 slot hoặc vùng trung tâm hợp lý.
- Bỏ qua logo, địa điểm, lịch thi đấu, tiêu đề, QR, nhà tài trợ.
- Tự kiểm tra trước khi trả JSON: avatar phải nằm phía trên name của cùng slot, không giao với name, không giao với nhãn "VĐV", clipPath phải nằm trong avatar box, ảnh khi object-fit cover phải lấp đầy clipPath, và không được còn mảng trắng/kem lớn bên trong vùng ảnh.
- Không bịa nội dung chữ; chỉ tìm layout.
- Chỉ trả JSON đúng schema.
${adminPromptBlock}
`;

  const baseMessages = [
    {
      role: "system",
      content:
        "Bạn là model thị giác phân tích layout poster. Hãy tự xác định chính xác ô trắng avatar và khung tên để backend render theo tọa độ bạn trả về. Không trả markdown.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];
  const routes = [
    {
      name: "responses_json_schema",
      payload: {
        messages: baseMessages,
      },
    },
  ];

  let parsed = null;
  let usedRoute = "";
  let usedModel = POSTER_VISION_MODEL;
  const routeErrors = [];
  for (const route of routes) {
    try {
      const textCandidates = await createOpenAiPosterTextCandidates({
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
      `OpenAI không trả về JSON layout cho AI poster. Chi tiết: ${detail}`,
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
