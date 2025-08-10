// utils/level.js
export const SKILL_WEIGHTS = {
  1: 0.15, // Forehand
  2: 0.1, // Backhand
  3: 0.15, // Serve/Return
  4: 0.2, // Dink
  5: 0.15, // 3rd Shot
  6: 0.15, // Volley
  7: 0.1, // Strategy
  8: 0.0, // Tần suất (không vào level, nhưng có thể cộng vào points khác)
  9: 0.0, // Đấu giải (0/1)
  10: 0.0, // Điểm hệ thống khác (0-10) — có thể dùng riêng
};

// clamp helper
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

// Hệ số map từ tổng weighted -> level (0..5/6/7 tuỳ bạn)
export const MAP_FACTOR = 1.9;

// Tính toán level đơn/đôi từ items [{skillId, single, double}]
export function computeLevels(items = []) {
  let sumSingle = 0;
  let sumDouble = 0;

  for (const it of items) {
    const id = Number(it?.skillId);
    const w = SKILL_WEIGHTS[id] ?? 0;
    const s = clamp(it?.single, 0, 10);
    const d = clamp(it?.double, 0, 10);
    sumSingle += s * w;
    sumDouble += d * w;
  }

  const singleScore = Number(sumSingle.toFixed(2));
  const doubleScore = Number(sumDouble.toFixed(2));
  const singleLevel = Number((singleScore / MAP_FACTOR).toFixed(1));
  const doubleLevel = Number((doubleScore / MAP_FACTOR).toFixed(1));

  // Bạn có thể dùng các yếu tố phụ để ra “điểm danh dự” / points
  const freq = clamp(items.find((x) => x.skillId === 8)?.single ?? 0, 0, 5);
  const competed = clamp(items.find((x) => x.skillId === 9)?.single ?? 0, 0, 1);
  const external = clamp(
    items.find((x) => x.skillId === 10)?.single ?? 0,
    0,
    10
  );

  const meta = { freq, competed: Boolean(competed), external };

  return { singleScore, doubleScore, singleLevel, doubleLevel, meta };
}
