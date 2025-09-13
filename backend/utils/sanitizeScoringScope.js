// utils/sanitizeScoringScope.js
export function sanitizeScoringScope(body = {}) {
  if (!body.scoringScope) return;

  const type =
    body.scoringScope?.type === "provinces" ? "provinces" : "national";
  let provinces = [];

  if (type === "provinces") {
    provinces = Array.from(
      new Set(
        (body.scoringScope.provinces ?? [])
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
  }

  body.scoringScope = { type, provinces }; // ← national luôn ép provinces = []
}
