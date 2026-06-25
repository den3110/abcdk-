export const overlayTemplateBindingLabels = {
  static: "Tĩnh",
  "tournament.name": "Tên giải",
  "tournament.logoUrl": "Logo giải",
  "match.code": "Mã trận",
  "match.round": "Số vòng",
  "match.roundLabel": "Vòng đấu",
  "match.stageName": "Stage",
  "match.courtName": "Sân",
  "teamA.name": "Tên đội A",
  "teamB.name": "Tên đội B",
  "teamA.seed": "Seed A",
  "teamB.seed": "Seed B",
  scoreA: "Điểm A",
  scoreB: "Điểm B",
  "sets.teamA": "Set thắng A",
  "sets.teamB": "Set thắng B",
  "sets.summary": "Tóm tắt set",
  "serve.side": "Đội giao bóng",
  "serve.count": "Số bóng giao",
};

export const overlayTemplateBindingOptions = Object.entries(
  overlayTemplateBindingLabels,
).map(([value, label]) => ({ value, label }));

export function resolveOverlayTemplateValue(layer, values = {}) {
  const binding = layer?.binding || "static";
  if (binding === "static") return layer?.text || "";
  const value = values[binding];
  if (value === null || value === undefined || value === "") {
    return layer?.text || "";
  }
  return String(value);
}
