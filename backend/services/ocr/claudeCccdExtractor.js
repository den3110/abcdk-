import fetch from "node-fetch";
import {
  CLAUDE_CCCD_MODEL,
  createClaudeJsonMessage,
} from "../../lib/anthropicClient.js";
import { stripVN } from "../../utils/cccdParsing.js";

const MAX_KYC_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CCCD_IMAGES_PER_REQUEST = 2;

const CCCD_JSON_SCHEMA = {
  name: "cccd_extract",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      idNumber: { type: ["string", "null"] },
      fullName: { type: ["string", "null"] },
      dob: { type: ["string", "null"], description: "yyyy-mm-dd" },
      sex: { type: ["string", "null"] },
      nationality: { type: ["string", "null"] },
      hometown: { type: ["string", "null"] },
      residence: { type: ["string", "null"] },
      expiry: { type: ["string", "null"], description: "yyyy-mm-dd" },
      issueDate: { type: ["string", "null"], description: "yyyy-mm-dd" },
      issuePlace: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
    },
    required: [
      "idNumber",
      "fullName",
      "dob",
      "sex",
      "nationality",
      "hometown",
      "residence",
      "expiry",
      "issueDate",
      "issuePlace",
      "notes",
    ],
  },
  strict: true,
};

export function normName(s = "") {
  return stripVN(String(s).trim()).replace(/\s+/g, " ").toUpperCase();
}

export function normId(s = "") {
  return String(s || "").replace(/\D+/g, "");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdUTC(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function normDOB(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date && !Number.isNaN(value)) {
    return ymdUTC(value);
  }

  const s = String(value).trim();
  if (!s) return null;

  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m1) {
    const d = Number(m1[1]);
    const mo = Number(m1[2]);
    const y = Number(m1[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;

  const d = new Date(s);
  return Number.isNaN(d) ? null : ymdUTC(d);
}

function normalizeCccdImageInput(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

function normalizeImageList(imageOrDataUrls) {
  const input = Array.isArray(imageOrDataUrls)
    ? imageOrDataUrls
    : [imageOrDataUrls];

  const urls = input
    .flat()
    .map(normalizeCccdImageInput)
    .filter(Boolean)
    .slice(0, MAX_CCCD_IMAGES_PER_REQUEST);

  if (!urls.length) {
    throw new Error("Không có ảnh CCCD hợp lệ để gửi Claude.");
  }

  return urls;
}

export async function fetchImageAsBuffer(url) {
  const raw = normalizeCccdImageInput(url);
  if (!raw || !/^https?:\/\//i.test(raw)) {
    throw new Error("URL ảnh CCCD không hợp lệ.");
  }

  const r = await fetch(raw, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "user-agent": "PickleTour-KYC-Claude/1.0",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} when fetching ${raw}`);

  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error(`Empty image when fetching ${raw}`);
  if (buf.length > MAX_KYC_IMAGE_BYTES) {
    throw new Error(`Image is larger than ${MAX_KYC_IMAGE_BYTES / 1024 / 1024}MB`);
  }

  let filename = "image";
  try {
    const u = new URL(raw);
    filename = u.pathname.split("/").pop() || "image";
  } catch {}

  return { buffer: buf, contentType: ct, filename };
}

function bufferToDataUrl(buffer, contentType = "image/jpeg") {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function openaiExtractFromDataUrl(imageOrDataUrls, detail = "low") {
  const urls = normalizeImageList(imageOrDataUrls);
  const imageParts = urls.map((url) => ({
    type: "image_url",
    image_url: { url, detail },
  }));

  const systemPrompt = [
    "Bạn là trình TRÍCH XUẤT CHÍNH XÁC CAO từ ảnh Căn cước công dân Việt Nam.",
    "YÊU CẦU: tuyệt đối không suy đoán; nếu bất kỳ ký tự nào mơ hồ thì trả null cho trường đó.",
    "Ưu tiên đọc đúng vùng 'Số/No.' trên mặt trước. idNumber phải là DÃY SỐ THUẦN, liền nhau, không khoảng trắng.",
    "CHỐNG NHẦM LẪN ký tự: 0 khác 9, O khác 0, 1 khác 7, 3 khác 8, 5 khác S, 2 khác Z, 6 khác G.",
    "Nếu không chắc chắn 100% về một chữ số trong idNumber thì idNumber=null.",
    "Nếu thấy dạng ngày dd/mm/yyyy thì đổi sang yyyy-mm-dd.",
    "Không dùng suy luận ngữ nghĩa hay dự đoán theo tên; chỉ dựa vào pixel nhìn thấy.",
    "Không đọc từ mã QR, không đọc từ vùng mờ hoặc che phản quang.",
    "Nếu idNumber khác độ dài chuẩn, ưu tiên 12, coi là không chắc và trả idNumber=null.",
    "fullName: viết HOA, bỏ dấu, chuẩn hóa bởi hệ thống phía sau.",
    "BẮT BUỘC: chỉ trả về DUY NHẤT một JSON object, không markdown, không giải thích, không text thừa.",
  ].join(" ");

  const userPrompt = [
    "Nhiệm vụ: Trích xuất thông tin từ ảnh CCCD và trả về JSON object với các field sau:",
    "- idNumber: string hoặc null (Số/No., chỉ số; nếu mơ hồ bất kỳ ký tự thì null)",
    "- fullName: string hoặc null (HỌ VÀ TÊN, nguyên văn; nếu mờ thì null)",
    "- dob: string hoặc null (Ngày sinh, format yyyy-mm-dd; nếu mờ thì null)",
    "- sex: string hoặc null (Giới tính)",
    "- nationality: string hoặc null (Quốc tịch)",
    "- hometown: string hoặc null (Quê quán)",
    "- residence: string hoặc null (Nơi thường trú)",
    "- expiry: string hoặc null (Có giá trị đến, format yyyy-mm-dd)",
    "- issueDate: string hoặc null (Ngày cấp ở mặt sau; format yyyy-mm-dd)",
    "- issuePlace: string hoặc null (Nơi cấp ở mặt sau)",
    "- notes: string hoặc null (Ghi chú thêm nếu có)",
    "Nếu cung cấp 2 ảnh, hãy đọc thông tin xuyên suốt cả 2 mặt.",
  ].join("\n");

  const maxRetries = 2;
  let resp;
  let jsonText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await createClaudeJsonMessage({
        model: CLAUDE_CCCD_MODEL,
        system: systemPrompt,
        content: [{ type: "text", text: userPrompt }, ...imageParts],
        schema: CCCD_JSON_SCHEMA.schema,
        toolName: "extract_cccd",
        toolDescription:
          "Trích xuất thông tin từ ảnh CCCD Việt Nam và trả về JSON đúng schema.",
        maxTokens: 2048,
      });

      resp = result.response;
      jsonText = result.text;
      break;
    } catch (err) {
      const msg = String(err?.message || err?.error?.message || "");
      const isRetryable =
        /timeout|econnreset|429|rate.?limit|overloaded|api_error/i.test(msg);
      if (isRetryable && attempt < maxRetries) {
        console.warn(
          `[cccd-claude] attempt ${attempt + 1} failed (${msg.slice(0, 80)}), retrying in 2s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw err;
    }
  }

  let data = {};
  try {
    data = JSON.parse(jsonText || "{}");
  } catch {
    const match = String(jsonText).match(/\{[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {}
    }
  }

  return {
    idNumber: normId(data.idNumber),
    fullName: data.fullName ? normName(data.fullName) : null,
    dob: normDOB(data.dob),
    issueDate: normDOB(data.issueDate),
    _usage: resp?.usage || null,
    raw: data,
    raw_text: jsonText,
  };
}

export async function openaiExtractFromImageUrl(imageUrlOrArray, detail = "low") {
  const urls = normalizeImageList(imageUrlOrArray);
  const processedUrls = [];

  for (const url of urls) {
    if (/^data:image\//i.test(url)) {
      processedUrls.push(url);
      continue;
    }

    try {
      const { buffer, contentType } = await fetchImageAsBuffer(url);
      processedUrls.push(bufferToDataUrl(buffer, contentType));
    } catch (error) {
      console.error("fetchImageAsBuffer fail for:", url, error?.message);
    }
  }

  if (!processedUrls.length) {
    throw new Error("Không tải được ảnh KYC để gửi Claude.");
  }

  return openaiExtractFromDataUrl(processedUrls, detail);
}

export async function extractCccdProfileFieldsFromDataUrl(
  imageOrDataUrls,
  detail = "auto",
) {
  const urls = normalizeImageList(imageOrDataUrls);
  const imageParts = urls.map((url) => ({
    type: "image_url",
    image_url: { url, detail },
  }));

  const schema = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Họ và tên đầy đủ như trên CCCD, viết hoa từng từ.",
      },
      dob: {
        type: "string",
        description:
          "Ngày sinh dạng YYYY-MM-DD. Nếu không chắc chắn thì để chuỗi rỗng.",
      },
      gender: {
        type: "string",
        description:
          'Giới tính chuẩn hóa thành 1 trong: "male", "female". Nếu không xác định thì để "unspecified".',
        enum: ["male", "female", "unspecified"],
      },
      province: {
        type: "string",
        description:
          "Tỉnh/Thành phố cấp 1 trong địa chỉ thường trú. Ví dụ: Hà Nội, TP Hồ Chí Minh, Đồng Nai.",
      },
      cccd: {
        type: "string",
        description:
          "Số CCCD/CCCD gắn chip, đúng 12 chữ số. Nếu không đọc được đầy đủ thì để chuỗi rỗng.",
      },
    },
    required: ["name", "dob", "gender", "province", "cccd"],
    additionalProperties: false,
  };

  const result = await createClaudeJsonMessage({
    model: CLAUDE_CCCD_MODEL,
    system:
      "Bạn là trợ lý OCR chuyên đọc Căn cước công dân Việt Nam. Trả về JSON đúng schema, không giải thích.",
    content: [
      {
        type: "text",
        text: [
          "Hãy đọc thông tin trên Căn cước công dân Việt Nam trong ảnh dưới đây.",
          "",
          "- name: Họ và tên đầy đủ.",
          "- dob: Ngày sinh, trả về dạng YYYY-MM-DD.",
          '- gender: Chuyển "Nam"/"Nữ" thành "male"/"female". Nếu không rõ thì dùng "unspecified".',
          "- province: Tên tỉnh/thành phố trong phần địa chỉ thường trú.",
          "- cccd: Số căn cước, đúng 12 chữ số.",
          "",
          "Nếu không đọc được một trường thì để chuỗi rỗng cho trường đó.",
        ].join("\n"),
      },
      ...imageParts,
    ],
    schema,
    toolName: "cccd_fields",
    toolDescription:
      "Trích xuất các trường hồ sơ từ ảnh CCCD Việt Nam và trả về JSON đúng schema.",
    maxTokens: 2048,
  });

  const parsed = result.data || {};
  return {
    name: String(parsed.name || "").trim(),
    dob: String(parsed.dob || "").trim(),
    gender: parsed.gender || "unspecified",
    province: String(parsed.province || "").trim(),
    cccd: String(parsed.cccd || "").trim(),
  };
}
