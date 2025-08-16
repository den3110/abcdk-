// utils/sorters.js
// ==================
export function seedCompare(a, b) {
  // higher score first
  if (b.seedScore !== a.seedScore) return b.seedScore - a.seedScore;
  // tie-breaker by regId for stability
  return String(a.regId).localeCompare(String(b.regId));
}
