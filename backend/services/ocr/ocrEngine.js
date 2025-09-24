// --- helpers crop theo tỉ lệ ---
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import {
  stripVN,
  normalizeDOB,
  valueAfterLabel,
} from "../../utils/cccdParsing.js";

let textWorker,
  digitWorker,
  ready = false;

export async function initOcr() {
  if (ready) return;
  textWorker = await createWorker("vie+eng");
  await textWorker.setParameters({ tessedit_pageseg_mode: "6" });

  digitWorker = await createWorker("eng");
  await digitWorker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "0123456789/.-",
  });
  ready = true;
}

const cropRel = async (buf, x, y, w, h) => {
  const img = sharp(buf);
  const meta = await img.metadata();
  const X = Math.round(x * meta.width);
  const Y = Math.round(y * meta.height);
  const W = Math.round(w * meta.width);
  const H = Math.round(h * meta.height);
  return img
    .extract({ left: X, top: Y, width: W, height: H })
    .grayscale()
    .normalise()
    .toBuffer();
};

const rotate = (buf, deg) => sharp(buf).rotate(deg).toBuffer();

const sanitize = (s) =>
  (s || "")
    .replace(/[^\p{L}\p{N}\s,.:;\/\-\(\)']+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

export async function ocrDigits(buf) {
  if (!ready) await initOcr();
  const { data } = await digitWorker.recognize(buf);
  return data.text || "";
}
export async function ocrText(buf) {
  if (!ready) await initOcr();
  const { data } = await textWorker.recognize(buf);
  return data.text || "";
}

/**
 * recognizeCCCDLite: template mặt TRƯỚC CCCD (chip ở góc phải), ảnh tương đối thẳng.
 * Thử 0° và 180° (có thể bật 90/270 nếu bạn muốn).
 */
export async function recognizeCCCDLite(inputBuffer) {
  if (!ready) await initOcr();

  // 1) chuẩn hoá cơ bản
  const base = await sharp(inputBuffer)
    .resize({ width: 1800, withoutEnlargement: false })
    .toBuffer();

  const orientations = [0, 180]; // cần nữa thì thêm 90,270
  const tries = [];

  for (const deg of orientations) {
    const img = deg ? await rotate(base, deg) : base;

    // 2) cắt ROI theo layout (tỉ lệ dựa trên CCCD phổ biến)
    // tên: khoảng 0.22→0.90 chiều ngang, 0.38→0.52 chiều dọc
    const nameROI = await cropRel(img, 0.22, 0.38, 0.7, 0.14);
    // dob: dòng “Ngày sinh …” thường ngay dưới tên, lấy 0.55→0.90 ngang, 0.50→0.08 dọc
    const dobROI = await cropRel(img, 0.55, 0.5, 0.35, 0.08);
    // hometown: đoạn có “Quê quán …”, dưới nữa
    const homeROI = await cropRel(img, 0.22, 0.6, 0.74, 0.12);

    // 3) OCR từng ROI
    const [nameText, dobDigits, homeText] = await Promise.all([
      ocrText(nameROI),
      ocrDigits(dobROI),
      ocrText(homeROI),
    ]);

    const name = (() => {
      const s = sanitize(nameText)
        .replace(/[0-9/.\-]+/g, "")
        .trim();
      // thích chữ HOA: tesseract hay ra HOA -> OK
      if (s && s.length >= 3) return s;
      return null;
    })();

    const dob = (() => {
      const m = (dobDigits || "").match(
        /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/
      );
      return m ? normalizeDOB(m[1]) : null;
    })();

    const hometown = (() => {
      const s = sanitize(homeText);
      if (!s) return null;
      const hasLoc = /tinh|thanh pho|huyen|quan|xa|phuong|,/.test(
        stripVN(s).toLowerCase()
      );
      return hasLoc ? s : s.length > 8 ? s : null;
    })();

    // 4) chấm điểm orientation
    let score = 0;
    if (dob) score += 5;
    if (name) score += 3;
    if (hometown) score += 2;
    tries.push({
      deg,
      name,
      dob,
      hometown,
      rawText: [nameText, dobDigits, homeText].join("\n"),
      score,
    });
  }

  // 5) chọn bản tốt nhất
  tries.sort((a, b) => b.score - a.score);
  const best = tries[0] || {
    name: null,
    dob: null,
    hometown: null,
    rawText: "",
  };

  return {
    fullName: best.name || null,
    dob: best.dob || null,
    hometown: best.hometown || null,
    rawText: sanitize(best.rawText),
    debug: { orientation: best.deg, score: best.score },
  };
}

/** Fallback parsing toàn văn (giữ từ bản trước của bạn) */
export function extractFieldsFromText(rawText) {
  const lines = (rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const fullName =
    valueAfterLabel(lines, [
      "Họ và tên",
      "Ho va ten",
      "HỌ VÀ TÊN",
      "Họ tên",
      "Ho ten",
    ]) ||
    lines.find((l) => /^[A-ZĐ ]{6,}$/.test(stripVN(l))) ||
    null;

  const dobRaw =
    valueAfterLabel(lines, [
      "Ngày, tháng, năm sinh",
      "Ngay, thang, nam sinh",
      "Ngày sinh",
      "Ngay sinh",
    ]) ||
    lines.find((l) => /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}\b/.test(l)) ||
    null;

  const dob = normalizeDOB(dobRaw || "");

  const hometown =
    valueAfterLabel(lines, [
      "Quê quán",
      "Que quan",
      "Nguyên quán",
      "Nguyen quan",
      "Nơi sinh",
      "Noi sinh",
      "Nơi thường trú",
      "Noi thuong tru",
    ]) ||
    lines.find((l) =>
      /tinh|thanh pho|huyen|quan|xa|phuong|,/.test(stripVN(l).toLowerCase())
    ) ||
    null;

  return {
    fullName: fullName || null,
    dob: dob || null,
    hometown: hometown || null,
    rawText,
  };
}
