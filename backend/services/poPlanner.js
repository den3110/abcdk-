// services/poPlanner.js
/**
 * Progressive-qualifying PO:
 * - Round 1: n teams -> pairs1 = floor(n/2). winners1 qualify, losers1 = n - winners1
 * - Round 2: entrants = losers1 -> pairs2 = floor(entrants/2). winners2 qualify, losers2 remain
 * - Round k: continue until:
 *    + maxRounds reached, or
 *    + targetQualifiers reached (sum winners so far), or
 *    + entrants < 2
 */
export function buildProgressivePO({
  entrants,
  maxRounds = 10,
  targetQualifiers = null,
}) {
  let n = Math.max(entrants | 0, 0);
  const rounds = [];
  let totalQ = 0;

  for (let r = 1; r <= maxRounds && n >= 2; r++) {
    const pairs = Math.floor(n / 2);
    const winners = pairs; // mỗi cặp lấy 1
    const losers = n - winners; // đi tiếp cho vòng sau

    rounds.push({
      r,
      entrants: n,
      pairs,
      qualifiers: winners, // fed-out
      losersNext: losers, // fed-in cho vòng sau
    });

    totalQ += winners;
    if (targetQualifiers != null && totalQ >= targetQualifiers) {
      break; // đạt đủ số Q cần lấy
    }

    n = losers; // chỉ losers đá vòng sau
  }

  return { rounds, totalQualifiers: totalQ, lastEntrants: n };
}
