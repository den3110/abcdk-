// utils/draw/roundRobin.js
/**
 * Tạo lịch vòng tròn (round-robin) cho danh sách regIds
 * Trả về mảng rounds: [[regId, regId], ...]
 */
export function buildRoundRobin(regIds = []) {
  const teams = regIds.slice();
  const hasBye = teams.length % 2 !== 0;
  if (hasBye) teams.push(null); // BYE

  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;

  const res = [];
  for (let r = 0; r < rounds; r++) {
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const t1 = teams[i];
      const t2 = teams[n - 1 - i];
      if (t1 && t2) pairings.push([t1, t2]);
    }
    res.push(pairings);

    // rotate (giữ index 0)
    const fixed = teams[0];
    const rest = teams.slice(1);
    rest.unshift(rest.pop());
    teams.splice(0, teams.length, fixed, ...rest);
  }
  return res;
}
