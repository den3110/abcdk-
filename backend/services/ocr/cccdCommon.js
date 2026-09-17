// backend/services/ocr/cccdCommon.js
// Helpers chung dùng chéo giữa cedrus & claude extractor + provider dispatcher.
import { stripVN } from "../../utils/cccdParsing.js";

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
  if (value instanceof Date && !Number.isNaN(value)) return ymdUTC(value);
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
