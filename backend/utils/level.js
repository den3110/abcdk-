// utils/level.js
export const DUPR_MIN = 2.0;
export const DUPR_MAX = 8.0;

export const clamp = (n, min, max) =>
  Math.max(min, Math.min(max, Number(n) || 0));
export const round2 = (n) => Number((Number(n) || 0).toFixed(2));
export const round3 = (n) => Number((Number(n) || 0).toFixed(3));

export function normalizeDupr(n) {
  // clamp về [2.000, 8.000] và làm tròn 3 số
  return round3(clamp(n, DUPR_MIN, DUPR_MAX));
}

/** Quy đổi RAW(0..10) ↔ DUPR(2..8) tuyến tính */
export function duprFromRaw(raw0to10) {
  const r = clamp(raw0to10, 0, 10);
  return round3(DUPR_MIN + (r / 10) * (DUPR_MAX - DUPR_MIN));
}
export function rawFromDupr(dupr) {
  const d = clamp(dupr, DUPR_MIN, DUPR_MAX);
  return round2(((d - DUPR_MIN) / (DUPR_MAX - DUPR_MIN)) * 10); // 0..10
}

/** Sanitize meta optional từ FE */
export function sanitizeMeta(input = {}) {
  const freq = clamp(input.freq ?? 0, 0, 5); // 0..5
  const competed = Boolean(input.competed); // true/false
  const external = clamp(input.external ?? 0, 0, 10); // 0..10
  return { freq, competed, external };
}
