// backend/services/ocr/cedrusCccdExtractor.js
// Bóc tách trường CCCD Việt Nam từ ảnh, dùng OCR server https://ocr.cedrus.dev
// (endpoint POST /upload, multipart "file", trả về { ocr_result, ocr_boxes, ... }).
// Rẻ hơn Claude nhiều, không tính token — dùng làm nguồn OCR chính.
//
// Xuất 2 hàm cùng signature với claudeCccdExtractor:
//   - cedrusExtractFromDataUrl(images, detail)      → KYC full fields
//   - cedrusExtractCccdProfileFieldsFromDataUrl(images, detail) → 5 field profile
// Cả 2 nhận string | string[] gồm dataURL/http(s) URL.

import fetch from "node-fetch";
import FormData from "form-data";
import { stripVN } from "../../utils/cccdParsing.js";
import { normId, normName, normDOB } from "./cccdCommon.js";

const CEDRUS_URL = String(
  process.env.CEDRUS_OCR_URL || "https://ocr.cedrus.dev",
).replace(/\/+$/, "");
const CEDRUS_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.CEDRUS_OCR_TIMEOUT_MS || 45000),
);
const MAX_KYC_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CCCD_IMAGES_PER_REQUEST = 2;

function bufferFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!m) return null;
  const contentType = m[1];
  const buf = Buffer.from(m[2], "base64");
  return { buffer: buf, contentType };
}

async function fetchToBuffer(url) {
  const r = await fetch(url, {
    headers: {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "user-agent": "PickleTour-CCCD-Cedrus/1.0",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi tải ảnh CCCD`);
  const ct = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  if (!buf.length) throw new Error("Ảnh CCCD tải về rỗng");
  return { buffer: buf, contentType: ct };
}

async function normalizeToBuffer(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) return bufferFromDataUrl(raw);
  if (/^https?:\/\//i.test(raw)) return fetchToBuffer(raw);
  return null;
}

async function normalizeImageList(imageOrDataUrls) {
  const input = Array.isArray(imageOrDataUrls) ? imageOrDataUrls : [imageOrDataUrls];
  const buffers = [];
  for (const item of input.flat().filter(Boolean)) {
    const b = await normalizeToBuffer(item);
    if (!b) continue;
    if (b.buffer.length > MAX_KYC_IMAGE_BYTES) {
      throw new Error(
        `Ảnh CCCD vượt quá ${MAX_KYC_IMAGE_BYTES / 1024 / 1024}MB`,
      );
    }
    buffers.push(b);
    if (buffers.length >= MAX_CCCD_IMAGES_PER_REQUEST) break;
  }
  if (!buffers.length) throw new Error("Không có ảnh CCCD hợp lệ cho Cedrus OCR");
  return buffers;
}

function extToFilename(contentType, idx) {
  const ct = String(contentType || "image/jpeg").toLowerCase();
  const ext =
    ct.includes("png")
      ? "png"
      : ct.includes("webp")
      ? "webp"
      : ct.includes("gif")
      ? "gif"
      : "jpg";
  return `cccd_${idx}.${ext}`;
}

async function runCedrusOcr(buffer, contentType, idx = 0) {
  const form = new FormData();
  form.append("file", buffer, {
    filename: extToFilename(contentType, idx),
    contentType,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CEDRUS_TIMEOUT_MS);
  try {
    const r = await fetch(`${CEDRUS_URL}/upload`, {
      method: "POST",
      body: form,
      headers: {
        Accept: "application/json",
        ...form.getHeaders(),
      },
      signal: controller.signal,
    });
    const status = r.status;
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Cedrus OCR trả về non-JSON (HTTP ${status})`);
    }
    if (!r.ok || json?.success === false) {
      const msg = json?.message || `HTTP ${status}`;
      throw new Error(`Cedrus OCR fail: ${msg}`);
    }
    return {
      text: String(json?.ocr_result || "").trim(),
      boxes: Array.isArray(json?.ocr_boxes) ? json.ocr_boxes : [],
      width: Number(json?.image_width || 0),
      height: Number(json?.image_height || 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- PARSER ----------
// Cedrus trả về text theo dòng (\n). Ta chuẩn hoá + regex tìm từng field.
// idNumber: 12 chữ số liên tiếp (CCCD gắn chip). Không lẫn 9 chữ số CMND cũ.
// Danh sách label chuẩn xuất hiện trên CCCD VN.

const LABELS = {
  fullName: ["Họ và tên", "Ho va ten", "Full name", "Ho ten", "Ho ten :"],
  dob: ["Ngày sinh", "Date of birth", "Ngay sinh", "Sinh ngay"],
  sex: ["Giới tính", "Sex", "Gioi tinh"],
  nationality: ["Quốc tịch", "Nationality", "Quoc tich"],
  hometown: ["Quê quán", "Place of origin", "Que quan", "Nguyên quán", "Nguyen quan"],
  residence: [
    "Nơi thường trú",
    "Nơi cư trú",
    "Place of residence",
    "Noi thuong tru",
    "Noi cu tru",
    "Nơi đăng ký thường trú",
  ],
  expiry: ["Có giá trị đến", "Date of expiry", "Co gia tri den"],
  issueDate: ["Ngày cấp", "Date of issue", "Ngay cap"],
  issuePlace: ["Nơi cấp", "Place of issue", "Noi cap"],
};

function findByLabels(lines, labels, opts = {}) {
  const { maxJoin = 2 } = opts;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const norm = stripVN(raw).toLowerCase();
    for (const label of labels) {
      const key = stripVN(label).toLowerCase();
      const pos = norm.indexOf(key);
      if (pos === -1) continue;
      // 1) Ưu tiên lấy phần đuôi cùng dòng
      const tail = raw
        .slice(pos + label.length)
        .replace(/^[\s:.\-–—/|]+/, "")
        .trim();
      if (tail && tail.length >= 2) return tail;
      // 2) Nếu không có, ghép các dòng tiếp theo (đến maxJoin dòng)
      const parts = [];
      for (let j = 1; j <= maxJoin && i + j < lines.length; j++) {
        const nxt = lines[i + j].trim();
        if (!nxt) continue;
        // Dừng khi gặp label khác
        const nxtNorm = stripVN(nxt).toLowerCase();
        const hitOther = Object.entries(LABELS).some(([k, arr]) => {
          if (arr === labels) return false;
          return arr.some((l) => nxtNorm.startsWith(stripVN(l).toLowerCase()));
        });
        if (hitOther) break;
        parts.push(nxt);
      }
      if (parts.length) return parts.join(", ").replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function findIdNumber(text) {
  // Ưu tiên 12 chữ số liên tiếp (CCCD gắn chip). Cho phép có dấu cách/-.
  const cleaned = text.replace(/[.\-\s]/g, "");
  const m12 = cleaned.match(/(?<!\d)\d{12}(?!\d)/g);
  if (m12 && m12.length) {
    // Chọn ứng viên trong khoảng "Số / No." nếu có
    const near = text.match(
      /(?:Số|So|No\.?|N°)\s*[:.\-]?\s*([\d\s.\-]{12,20})/i,
    );
    if (near) {
      const c = near[1].replace(/\D+/g, "");
      if (c.length === 12) return c;
    }
    return m12[0];
  }
  // CMND cũ 9 chữ số làm dự phòng
  const m9 = cleaned.match(/(?<!\d)\d{9}(?!\d)/g);
  if (m9 && m9.length) return m9[0];
  return null;
}

function findAllDates(text) {
  const out = [];
  const rx = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g;
  let m;
  while ((m = rx.exec(text))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100) {
      out.push({
        raw: m[0],
        ymd: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        y,
        idx: m.index,
      });
    }
  }
  return out;
}

function normalizeSex(v) {
  if (!v) return null;
  const s = stripVN(String(v)).toLowerCase();
  if (/\bnam\b|\bmale\b/.test(s)) return "Nam";
  if (/\bnu\b|\bfemale\b/.test(s)) return "Nữ";
  return String(v).trim();
}

function cleanValue(v) {
  if (!v) return null;
  return String(v)
    .replace(/\s+/g, " ")
    .replace(/^[.\-:,;]+/, "")
    .replace(/[.\-:,;]+$/, "")
    .trim() || null;
}

function pickFullName(lines) {
  const v = findByLabels(lines, LABELS.fullName, { maxJoin: 1 });
  if (v) return cleanValue(v);
  // fallback: dòng viết HOA hết, không chứa số, không phải label
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s.length < 4) continue;
    if (/\d/.test(s)) continue;
    if (s !== s.toUpperCase()) continue;
    const norm = stripVN(s).toLowerCase();
    const isLabel = Object.values(LABELS).some((arr) =>
      arr.some((l) => norm.startsWith(stripVN(l).toLowerCase())),
    );
    if (isLabel) continue;
    if (/^[A-ZÀ-Ỹ][A-ZÀ-Ỹ\s]{3,}$/.test(s)) return cleanValue(s);
  }
  return null;
}

function pickNationality(lines) {
  const v = findByLabels(lines, LABELS.nationality, { maxJoin: 1 });
  if (v) return cleanValue(v);
  const text = lines.join("\n");
  if (/việt\s*nam|viet\s*nam|Vietnam/i.test(text)) return "Việt Nam";
  return null;
}

// Parse text OCR → CCCD fields tương thích schema Claude cũ
function parseCccdFromText(text) {
  if (!text) return {};
  const rawLines = String(text)
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const joined = rawLines.join("\n");

  const idNumber = findIdNumber(joined);
  const fullName = pickFullName(rawLines);
  const nationality = pickNationality(rawLines);
  const sex = normalizeSex(findByLabels(rawLines, LABELS.sex, { maxJoin: 1 }));

  // Dates — CCCD chip mặt trước có 2 date: DOB + expiry.
  // Fallback: nhận diện qua label; nếu label parse không ra, dùng thứ tự
  //   (DOB thường trước expiry, expiry thường ở góc dưới bên phải).
  let dob = normDOB(findByLabels(rawLines, LABELS.dob, { maxJoin: 1 }));
  let expiry = normDOB(findByLabels(rawLines, LABELS.expiry, { maxJoin: 1 }));
  let issueDate = normDOB(findByLabels(rawLines, LABELS.issueDate, { maxJoin: 1 }));
  if (!dob || !expiry) {
    const all = findAllDates(joined);
    if (!dob && all.length) {
      const earliest = [...all].sort((a, b) => a.y - b.y)[0];
      dob = earliest.ymd;
    }
    if (!expiry && all.length >= 2) {
      const latest = [...all].sort((a, b) => b.y - a.y)[0];
      if (latest.ymd !== dob) expiry = latest.ymd;
    }
  }

  const hometown = cleanValue(findByLabels(rawLines, LABELS.hometown, { maxJoin: 3 }));
  const residence = cleanValue(findByLabels(rawLines, LABELS.residence, { maxJoin: 3 }));
  const issuePlace = cleanValue(findByLabels(rawLines, LABELS.issuePlace, { maxJoin: 1 }));

  return {
    idNumber: idNumber || null,
    fullName: fullName || null,
    dob: dob || null,
    sex: sex || null,
    nationality: nationality || null,
    hometown: hometown || null,
    residence: residence || null,
    expiry: expiry || null,
    issueDate: issueDate || null,
    issuePlace: issuePlace || null,
    notes: null,
  };
}

// Ghép kết quả 2 mặt (trước/sau) — trường nào có ưu tiên giữ, còn thiếu bù từ mặt kia.
function mergeCccdFields(a = {}, b = {}) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (b[k] && !out[k]) out[k] = b[k];
  }
  return out;
}

/**
 * Chạy Cedrus OCR trên 1 hoặc nhiều ảnh CCCD → data giống openaiExtractFromDataUrl.
 */
export async function cedrusExtractFromDataUrl(imageOrDataUrls) {
  const bufs = await normalizeImageList(imageOrDataUrls);
  const ocrs = [];
  for (let i = 0; i < bufs.length; i++) {
    const b = bufs[i];
    const r = await runCedrusOcr(b.buffer, b.contentType, i);
    ocrs.push(r);
  }
  const combinedText = ocrs.map((o) => o.text).join("\n");
  const parsedList = ocrs.map((o) => parseCccdFromText(o.text));
  const data = parsedList.reduce((acc, p) => mergeCccdFields(acc, p), {});
  return {
    idNumber: normId(data.idNumber),
    fullName: data.fullName ? normName(data.fullName) : null,
    dob: normDOB(data.dob),
    issueDate: normDOB(data.issueDate),
    _usage: {
      provider: "cedrus",
      images: bufs.length,
      // approx cost: 0 (dịch vụ tự host, không dùng token LLM)
    },
    raw: data,
    raw_text: combinedText,
  };
}

/**
 * Extract 5 field profile theo cùng contract với extractCccdProfileFieldsFromDataUrl (Claude).
 */
export async function cedrusExtractCccdProfileFieldsFromDataUrl(imageOrDataUrls) {
  const r = await cedrusExtractFromDataUrl(imageOrDataUrls);
  const d = r.raw || {};
  // Chuẩn hoá gender
  const g = normalizeSex(d.sex);
  const gender = g === "Nam" ? "male" : g === "Nữ" ? "female" : "unspecified";
  // province: lấy phần cuối cùng của residence hoặc hometown (thường là tỉnh/thành)
  const rawAddr = d.residence || d.hometown || "";
  const parts = String(rawAddr)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const province = parts.length ? parts[parts.length - 1] : "";

  return {
    name: (d.fullName || r.fullName || "").trim(),
    dob: (d.dob || r.dob || "").trim(),
    gender,
    province,
    cccd: (r.idNumber || d.idNumber || "").trim(),
  };
}

// Test helper cho các test/CI: expose parseCccdFromText để có thể test parser mà không cần OCR server.
export const __internal = { parseCccdFromText };
