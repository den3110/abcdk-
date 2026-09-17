// backend/services/ocr/cccdQrDecoder.js
// Quét mã QR trên ảnh CCCD (mặt trước) + parse payload chuẩn CCCD gắn chip:
//   <CCCD>|<CMND cũ>|<Họ tên>|<ddmmyyyy DOB>|<Nam/Nữ>|<địa chỉ thường trú>|<ddmmyyyy ngày cấp>
// Thử 4 orientation (0/90/180/270°) để phòng trường hợp ảnh xoay.

import { createCanvas, loadImage } from "canvas";
import jsQR from "jsqr";
import { normId, normDOB } from "./cccdCommon.js";

function drawRotated(img, deg) {
  const w = img.width;
  const h = img.height;
  let cw = w;
  let ch = h;
  if (deg === 90 || deg === 270) {
    cw = h;
    ch = w;
  }
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  if (deg === 0) {
    ctx.drawImage(img, 0, 0);
  } else if (deg === 180) {
    ctx.setTransform(-1, 0, 0, -1, cw, ch);
    ctx.drawImage(img, 0, 0);
  } else if (deg === 90) {
    ctx.setTransform(0, 1, -1, 0, cw, 0);
    ctx.drawImage(img, 0, 0);
  } else if (deg === 270) {
    ctx.setTransform(0, -1, 1, 0, 0, ch);
    ctx.drawImage(img, 0, 0);
  }
  return { canvas, ctx, cw, ch };
}

/**
 * Decode QR from an image buffer, thử 4 chiều xoay.
 * Trả về string payload hoặc null.
 */
export async function decodeQrFromBuffer(buffer) {
  if (!buffer) return null;
  try {
    const img = await loadImage(buffer);
    for (const deg of [0, 180, 90, 270]) {
      try {
        const { ctx, cw, ch } = drawRotated(img, deg);
        const { data, width, height } = ctx.getImageData(0, 0, cw, ch);
        const code = jsQR(data, width, height, {
          inversionAttempts: "attemptBoth",
        });
        if (code?.data) return code.data;
      } catch {}
    }
  } catch {}
  return null;
}

function parseQrDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  // Format phổ biến: "ddmmyyyy" (8 số liền) hoặc "dd/mm/yyyy" / "yyyy-mm-dd"
  const m = t.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return normDOB(t);
}

/**
 * Parse payload QR CCCD gắn chip theo format Bộ Công An.
 * Trả về { idNumber, fullName, dob, sex, residence, issueDate } hoặc null.
 * Chấp nhận payload có 5-8 phần cách bằng "|" (một số CCCD cũ thiếu ngày cấp).
 */
export function parseCccdChipQr(payload) {
  if (!payload) return null;
  const raw = String(payload).trim();
  // Nếu payload bọc JSON (một số phần mềm export QR mới)
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      return normalizeCccdFieldsFromObject(obj);
    } catch {}
  }
  const parts = raw.split("|").map((s) => s.trim());
  if (parts.length < 5) return null;
  const [cccdNo, _cmndOld, hoTen, dob8, sex, address, issueDate8] = parts;
  const id = normId(cccdNo || "");
  // CCCD chuẩn 12 chữ số — nếu không phải, coi như không phải QR CCCD
  if (id.length !== 12 && id.length !== 9) return null;
  return {
    idNumber: id,
    fullName: hoTen ? String(hoTen).replace(/\s+/g, " ").trim() : null,
    dob: parseQrDate(dob8),
    sex: sex ? String(sex).trim() : null,
    residence: address ? String(address).replace(/\s+/g, " ").trim() : null,
    issueDate: parseQrDate(issueDate8),
    _rawParts: parts,
  };
}

function normalizeCccdFieldsFromObject(obj) {
  const lower = {};
  for (const [k, v] of Object.entries(obj)) lower[String(k).toLowerCase()] = v;
  const pick = (...alts) => {
    for (const a of alts) {
      if (lower[a] !== undefined && lower[a] !== null && String(lower[a]).trim())
        return String(lower[a]).trim();
    }
    return null;
  };
  const id = normId(
    pick("cccd", "id", "idnumber", "so_cccd", "socccd", "identity") || "",
  );
  if (id.length !== 12 && id.length !== 9) return null;
  return {
    idNumber: id,
    fullName: pick("name", "fullname", "ho_ten", "hoten", "ho_va_ten"),
    dob: parseQrDate(pick("dob", "ngay_sinh", "ngaysinh")),
    sex: pick("sex", "gender", "gioi_tinh", "gioitinh"),
    residence: pick(
      "address",
      "residence",
      "noi_thuong_tru",
      "noithuongtru",
    ),
    issueDate: parseQrDate(pick("issue_date", "ngay_cap", "ngaycap")),
    _rawParts: null,
  };
}

/**
 * Try decode 1..N images (each: buffer + contentType), return first QR CCCD found.
 */
export async function tryQrCccdFromBuffers(bufs) {
  for (const b of bufs || []) {
    const payload = await decodeQrFromBuffer(b.buffer);
    if (!payload) continue;
    const parsed = parseCccdChipQr(payload);
    if (parsed) return parsed;
  }
  return null;
}
