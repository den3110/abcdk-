import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import OverlayTemplate from "../models/overlayTemplateModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import { canManageTournament } from "../utils/tournamentAuth.js";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };
const MAX_LAYERS = 60;
const MAX_TEXT = 220;
const MAX_URL = 1200;

const SAFE_BINDINGS = new Set([
  "static",
  "tournament.name",
  "tournament.logoUrl",
  "match.code",
  "match.round",
  "match.roundLabel",
  "match.stageName",
  "match.courtName",
  "teamA.name",
  "teamB.name",
  "teamA.seed",
  "teamB.seed",
  "scoreA",
  "scoreB",
  "sets.teamA",
  "sets.teamB",
  "sets.summary",
  "serve.side",
  "serve.count",
]);

const COLOR_RE =
  /^(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|transparent)$/i;

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const cleanString = (value, max = MAX_TEXT) =>
  String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, max);

const cleanColor = (value, fallback = "transparent") => {
  const text = cleanString(value, 80).trim();
  return COLOR_RE.test(text) ? text : fallback;
};

const cleanFont = (value) =>
  cleanString(value, 120)
    .replace(/[;"'<>]/g, "")
    .trim();

const cleanUrl = (value) => {
  const text = cleanString(value, MAX_URL).trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/(?!\/)/.test(text)) return text;
  return "";
};

const cleanBinding = (value) => {
  const key = cleanString(value, 80).trim();
  return SAFE_BINDINGS.has(key) ? key : "static";
};

const cleanVisibleWhen = (value) => {
  if (!value || typeof value !== "object") return null;
  const binding = cleanBinding(value.binding);
  const equals = cleanString(value.equals ?? value.value, 40).trim();
  if (binding === "static" || !equals) return null;
  return { binding, equals };
};

const uid = (prefix) =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now()
    .toString(36)
    .slice(-4)}`;

const textLayer = ({
  id,
  label,
  binding = "static",
  text = "",
  x,
  y,
  width,
  height,
  fontSize = 42,
  fontWeight = 700,
  color = "#ffffff",
  textAlign = "left",
  zIndex = 10,
}) => ({
  id,
  type: "text",
  label,
  binding,
  text,
  x,
  y,
  width,
  height,
  zIndex,
  style: {
    fontFamily: "Montserrat, Arial, sans-serif",
    fontSize,
    fontWeight,
    color,
    textAlign,
    lineHeight: 1.1,
  },
});

const rectLayer = ({
  id,
  label,
  x,
  y,
  width,
  height,
  background = "rgba(7, 12, 20, 0.88)",
  borderColor = "rgba(255,255,255,0.16)",
  borderWidth = 1,
  borderRadius = 24,
  zIndex = 0,
}) => ({
  id,
  type: "rect",
  label,
  binding: "static",
  x,
  y,
  width,
  height,
  zIndex,
  style: { background, borderColor, borderWidth, borderRadius },
});

const serveIndicatorLayer = ({
  id,
  label,
  side = "A",
  x,
  y,
  width = 30,
  height = 30,
  color = "#22c55e",
  zIndex = 30,
}) => {
  const normalizedSide = String(side).toUpperCase() === "B" ? "B" : "A";
  return {
    id,
    type: "serveIndicator",
    label,
    binding: "serve.side",
    text: "",
    x,
    y,
    width,
    height,
    zIndex,
    visible: true,
    visibleWhen: { binding: "serve.side", equals: normalizedSide },
    style: {
      color,
      background: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      borderRadius: 999,
    },
  };
};

const systemTemplate = (key, name, description, layers) => ({
  id: key,
  key,
  name,
  description,
  isSystem: true,
  engine: "safe-layers",
  canvas: DEFAULT_CANVAS,
  document: {
    background: "transparent",
    layers,
  },
});

const SYSTEM_TEMPLATES = [
  systemTemplate("corner-pro", "Góc trái chuyên nghiệp", "Bảng điểm gọn ở góc trái.", [
    rectLayer({ id: "bg", label: "Nền bảng điểm", x: 48, y: 48, width: 660, height: 242 }),
    rectLayer({
      id: "score_band",
      label: "Nền cột điểm",
      x: 594,
      y: 104,
      width: 92,
      height: 140,
      background: "#23865c",
      borderColor: "transparent",
      borderRadius: 18,
      zIndex: 2,
    }),
    textLayer({
      id: "tournament",
      label: "Tên giải",
      binding: "tournament.name",
      text: "Tên giải đấu",
      x: 78,
      y: 72,
      width: 470,
      height: 34,
      fontSize: 26,
      fontWeight: 800,
      zIndex: 3,
    }),
    textLayer({
      id: "team_a",
      label: "Đội A",
      binding: "teamA.name",
      text: "Đội A",
      x: 78,
      y: 126,
      width: 470,
      height: 52,
      fontSize: 36,
      fontWeight: 800,
      zIndex: 3,
    }),
    textLayer({
      id: "team_b",
      label: "Đội B",
      binding: "teamB.name",
      text: "Đội B",
      x: 78,
      y: 190,
      width: 470,
      height: 52,
      fontSize: 36,
      fontWeight: 800,
      zIndex: 3,
    }),
    textLayer({
      id: "score_a",
      label: "Điểm A",
      binding: "scoreA",
      text: "0",
      x: 594,
      y: 124,
      width: 92,
      height: 52,
      fontSize: 42,
      fontWeight: 900,
      textAlign: "center",
      zIndex: 4,
    }),
    textLayer({
      id: "score_b",
      label: "Điểm B",
      binding: "scoreB",
      text: "0",
      x: 594,
      y: 190,
      width: 92,
      height: 52,
      fontSize: 42,
      fontWeight: 900,
      textAlign: "center",
      zIndex: 4,
    }),
    serveIndicatorLayer({
      id: "serve_a",
      label: "Bóng giao A",
      side: "A",
      x: 558,
      y: 138,
      width: 26,
      height: 26,
    }),
    serveIndicatorLayer({
      id: "serve_b",
      label: "Bóng giao B",
      side: "B",
      x: 558,
      y: 204,
      width: 26,
      height: 26,
    }),
    textLayer({
      id: "round",
      label: "Vòng đấu",
      binding: "match.roundLabel",
      text: "Vòng đấu",
      x: 78,
      y: 250,
      width: 420,
      height: 28,
      fontSize: 22,
      fontWeight: 700,
      color: "rgba(255,255,255,0.78)",
      zIndex: 3,
    }),
  ]),
  systemTemplate("bottom-tv", "Thanh dưới kiểu TV", "Bảng điểm ngang ở cuối màn hình.", [
    rectLayer({
      id: "bg",
      label: "Nền bảng điểm",
      x: 360,
      y: 842,
      width: 1200,
      height: 156,
      background: "rgba(13, 18, 28, 0.92)",
      borderRadius: 18,
    }),
    textLayer({
      id: "team_a",
      label: "Đội A",
      binding: "teamA.name",
      text: "Đội A",
      x: 418,
      y: 884,
      width: 420,
      height: 56,
      fontSize: 40,
      fontWeight: 800,
      textAlign: "right",
    }),
    textLayer({
      id: "score_a",
      label: "Điểm A",
      binding: "scoreA",
      text: "0",
      x: 868,
      y: 864,
      width: 92,
      height: 86,
      fontSize: 70,
      fontWeight: 900,
      textAlign: "center",
    }),
    textLayer({
      id: "score_b",
      label: "Điểm B",
      binding: "scoreB",
      text: "0",
      x: 960,
      y: 864,
      width: 92,
      height: 86,
      fontSize: 70,
      fontWeight: 900,
      textAlign: "center",
      color: "#d8f7ff",
    }),
    textLayer({
      id: "team_b",
      label: "Đội B",
      binding: "teamB.name",
      text: "Đội B",
      x: 1082,
      y: 884,
      width: 420,
      height: 56,
      fontSize: 40,
      fontWeight: 800,
    }),
    serveIndicatorLayer({
      id: "serve_a",
      label: "Bóng giao A",
      side: "A",
      x: 842,
      y: 898,
      width: 28,
      height: 28,
    }),
    serveIndicatorLayer({
      id: "serve_b",
      label: "Bóng giao B",
      side: "B",
      x: 1054,
      y: 898,
      width: 28,
      height: 28,
    }),
    textLayer({
      id: "meta",
      label: "Thông tin trận",
      binding: "match.stageName",
      text: "Thông tin trận",
      x: 438,
      y: 952,
      width: 1044,
      height: 32,
      fontSize: 24,
      fontWeight: 700,
      textAlign: "center",
      color: "rgba(255,255,255,0.72)",
    }),
  ]),
  systemTemplate("sponsor-clean", "Sponsor rõ ràng", "Có khu vực logo và nhà tài trợ.", [
    rectLayer({
      id: "bg",
      label: "Nền bảng điểm",
      x: 52,
      y: 770,
      width: 760,
      height: 230,
      background: "rgba(255,255,255,0.92)",
      borderColor: "rgba(15,23,42,0.12)",
      borderRadius: 20,
    }),
    rectLayer({
      id: "accent",
      label: "Thanh nhấn",
      x: 52,
      y: 770,
      width: 14,
      height: 230,
      background: "#2563eb",
      borderColor: "transparent",
      borderRadius: 20,
      zIndex: 2,
    }),
    textLayer({
      id: "tournament",
      label: "Tên giải",
      binding: "tournament.name",
      text: "Tên giải đấu",
      x: 96,
      y: 800,
      width: 530,
      height: 34,
      fontSize: 26,
      fontWeight: 800,
      color: "#0f172a",
      zIndex: 3,
    }),
    textLayer({
      id: "team_a",
      label: "Đội A",
      binding: "teamA.name",
      text: "Đội A",
      x: 96,
      y: 856,
      width: 500,
      height: 44,
      fontSize: 34,
      fontWeight: 800,
      color: "#0f172a",
      zIndex: 3,
    }),
    textLayer({
      id: "team_b",
      label: "Đội B",
      binding: "teamB.name",
      text: "Đội B",
      x: 96,
      y: 914,
      width: 500,
      height: 44,
      fontSize: 34,
      fontWeight: 800,
      color: "#0f172a",
      zIndex: 3,
    }),
    textLayer({
      id: "score_a",
      label: "Điểm A",
      binding: "scoreA",
      text: "0",
      x: 648,
      y: 848,
      width: 92,
      height: 52,
      fontSize: 44,
      fontWeight: 900,
      color: "#0f172a",
      textAlign: "center",
      zIndex: 3,
    }),
    textLayer({
      id: "score_b",
      label: "Điểm B",
      binding: "scoreB",
      text: "0",
      x: 648,
      y: 906,
      width: 92,
      height: 52,
      fontSize: 44,
      fontWeight: 900,
      color: "#0f172a",
      textAlign: "center",
      zIndex: 3,
    }),
    serveIndicatorLayer({
      id: "serve_a",
      label: "Bóng giao A",
      side: "A",
      x: 608,
      y: 864,
      width: 26,
      height: 26,
      color: "#16a34a",
    }),
    serveIndicatorLayer({
      id: "serve_b",
      label: "Bóng giao B",
      side: "B",
      x: 608,
      y: 922,
      width: 26,
      height: 26,
      color: "#16a34a",
    }),
  ]),
  systemTemplate("vertical-live", "Dọc cho live mobile", "Bố cục dọc gọn cho khung quay đứng.", [
    rectLayer({
      id: "bg",
      label: "Nền bảng điểm",
      x: 70,
      y: 120,
      width: 420,
      height: 520,
      background: "rgba(5, 8, 13, 0.9)",
      borderRadius: 28,
    }),
    textLayer({
      id: "round",
      label: "Vòng đấu",
      binding: "match.roundLabel",
      text: "Vòng đấu",
      x: 104,
      y: 162,
      width: 352,
      height: 34,
      fontSize: 24,
      color: "rgba(255,255,255,0.72)",
      textAlign: "center",
    }),
    textLayer({
      id: "team_a",
      label: "Đội A",
      binding: "teamA.name",
      text: "Đội A",
      x: 104,
      y: 240,
      width: 352,
      height: 80,
      fontSize: 40,
      fontWeight: 900,
      textAlign: "center",
    }),
    textLayer({
      id: "score_a",
      label: "Điểm A",
      binding: "scoreA",
      text: "0",
      x: 104,
      y: 332,
      width: 352,
      height: 76,
      fontSize: 72,
      fontWeight: 900,
      textAlign: "center",
      color: "#8ee6b8",
    }),
    textLayer({
      id: "team_b",
      label: "Đội B",
      binding: "teamB.name",
      text: "Đội B",
      x: 104,
      y: 452,
      width: 352,
      height: 80,
      fontSize: 40,
      fontWeight: 900,
      textAlign: "center",
    }),
    textLayer({
      id: "score_b",
      label: "Điểm B",
      binding: "scoreB",
      text: "0",
      x: 104,
      y: 542,
      width: 352,
      height: 76,
      fontSize: 72,
      fontWeight: 900,
      textAlign: "center",
      color: "#93c5fd",
    }),
    serveIndicatorLayer({
      id: "serve_a",
      label: "Bóng giao A",
      side: "A",
      x: 448,
      y: 267,
      width: 28,
      height: 28,
    }),
    serveIndicatorLayer({
      id: "serve_b",
      label: "Bóng giao B",
      side: "B",
      x: 448,
      y: 477,
      width: 28,
      height: 28,
    }),
  ]),
];

const SYSTEM_TEMPLATE_BY_KEY = new Map(
  SYSTEM_TEMPLATES.map((template) => [template.key, template])
);

const serializeTemplate = (template) => {
  if (!template) return null;
  const obj = typeof template.toObject === "function" ? template.toObject() : template;
  return {
    id: String(obj._id || obj.id || obj.key || ""),
    key: obj.key || obj.sourceTemplateKey || "",
    name: obj.name || "",
    description: obj.description || "",
    engine: obj.engine || "safe-layers",
    sourceTemplateKey: obj.sourceTemplateKey || obj.key || "",
    isSystem: !!obj.isSystem,
    tournament: obj.tournament ? String(obj.tournament) : null,
    scopeType: obj.scopeType || "tournament",
    scopeId: obj.scopeId ? String(obj.scopeId) : null,
    status: obj.status || "draft",
    version: obj.version || 1,
    canvas: obj.canvas || DEFAULT_CANVAS,
    document: obj.document || { background: "transparent", layers: [] },
    bindings: Array.isArray(obj.bindings) ? obj.bindings : [],
    publishedAt: obj.publishedAt || null,
    updatedAt: obj.updatedAt || null,
    createdAt: obj.createdAt || null,
  };
};

const normalizeCanvas = (input = {}) => ({
  width: clamp(input.width, 320, 3840, DEFAULT_CANVAS.width),
  height: clamp(input.height, 180, 2160, DEFAULT_CANVAS.height),
});

const normalizeStyle = (style = {}) => ({
  fontFamily: cleanFont(style.fontFamily) || "Montserrat, Arial, sans-serif",
  fontSize: clamp(style.fontSize, 8, 220, 36),
  fontWeight: clamp(style.fontWeight, 100, 1000, 700),
  color: cleanColor(style.color, "#ffffff"),
  background: cleanColor(style.background, "transparent"),
  borderColor: cleanColor(style.borderColor, "transparent"),
  borderWidth: clamp(style.borderWidth, 0, 24, 0),
  borderRadius: clamp(style.borderRadius, 0, 240, 0),
  textAlign: ["left", "center", "right"].includes(style.textAlign)
    ? style.textAlign
    : "left",
  lineHeight: clamp(style.lineHeight, 0.8, 2, 1.1),
});

const normalizeLayer = (layer = {}, index = 0) => {
  const type = ["text", "rect", "image", "serveIndicator"].includes(layer.type)
    ? layer.type
    : "text";
  const normalized = {
    id: cleanString(layer.id, 80).trim() || uid(type),
    type,
    label: cleanString(layer.label || layer.id || `Layer ${index + 1}`, 80),
    binding: cleanBinding(layer.binding),
    text: cleanString(layer.text, MAX_TEXT),
    src: type === "image" ? cleanUrl(layer.src) : "",
    x: clamp(layer.x, -3840, 3840, 80),
    y: clamp(layer.y, -2160, 2160, 80),
    width: clamp(layer.width, 4, 3840, type === "text" ? 360 : 240),
    height: clamp(layer.height, 4, 2160, type === "text" ? 64 : 120),
    rotation: clamp(layer.rotation, -180, 180, 0),
    opacity: clamp(layer.opacity, 0, 1, 1),
    zIndex: clamp(layer.zIndex, -100, 1000, index),
    visible: layer.visible !== false,
    locked: layer.locked === true,
    style: normalizeStyle(layer.style || {}),
  };

  const visibleWhen = cleanVisibleWhen(layer.visibleWhen);
  if (visibleWhen) normalized.visibleWhen = visibleWhen;

  if (type === "rect") {
    normalized.binding = "static";
    normalized.text = "";
  }
  if (type === "serveIndicator") {
    normalized.binding = "serve.side";
    normalized.text = "";
    normalized.src = "";
  }
  return normalized;
};

const normalizeDocument = (input = {}) => {
  const layers = Array.isArray(input.layers) ? input.layers : [];
  const normalizedLayers = layers
    .slice(0, MAX_LAYERS)
    .map(normalizeLayer)
    .sort((a, b) => a.zIndex - b.zIndex);

  return {
    background: cleanColor(input.background, "transparent"),
    layers: normalizedLayers,
  };
};

const extractBindings = (document) =>
  Array.from(
    new Set(
      (document?.layers || [])
        .flatMap((layer) => [layer.binding, layer.visibleWhen?.binding])
        .filter((binding) => binding && binding !== "static")
    )
  );

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

async function resolveScopeFromBody(body = {}) {
  const requestedScope = cleanString(body.scopeType || "tournament", 40);
  const scopeType = ["match", "bracket", "tournament", "default"].includes(
    requestedScope
  )
    ? requestedScope
    : "tournament";
  const rawScopeId = body.scopeId || body.matchId || body.bracketId || body.tournamentId;
  const rawTournamentId = body.tournamentId;

  if (scopeType === "match") {
    if (!isObjectId(rawScopeId)) throw new Error("Invalid match id");
    const match = await Match.findById(rawScopeId)
      .select("_id tournament bracket")
      .lean();
    if (!match) throw new Error("Match not found");
    return {
      scopeType,
      scopeId: match._id,
      tournamentId: match.tournament,
      match,
    };
  }

  if (scopeType === "bracket") {
    if (!isObjectId(rawScopeId)) throw new Error("Invalid bracket id");
    const bracket = await Bracket.findById(rawScopeId)
      .select("_id tournament")
      .lean();
    if (!bracket) throw new Error("Bracket not found");
    return {
      scopeType,
      scopeId: bracket._id,
      tournamentId: bracket.tournament,
      bracket,
    };
  }

  if (scopeType === "default") {
    if (!isObjectId(rawTournamentId)) throw new Error("Invalid tournament id");
    return {
      scopeType,
      scopeId: null,
      tournamentId: rawTournamentId,
    };
  }

  const tournamentId = rawTournamentId || rawScopeId;
  if (!isObjectId(tournamentId)) throw new Error("Invalid tournament id");
  const tournament = await Tournament.findById(tournamentId).select("_id").lean();
  if (!tournament) throw new Error("Tournament not found");
  return {
    scopeType: "tournament",
    scopeId: tournament._id,
    tournamentId: tournament._id,
  };
}

async function assertCanManage(req, tournamentId) {
  const allowed = await canManageTournament(req.user, tournamentId);
  if (!allowed) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
}

export const listOverlayTemplateLibrary = expressAsyncHandler(async (_req, res) => {
  res.json({ ok: true, items: SYSTEM_TEMPLATES.map(serializeTemplate) });
});

export const listOverlayTemplates = expressAsyncHandler(async (req, res) => {
  const tournamentId = req.query.tournamentId || req.query.tid;
  if (!isObjectId(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }

  await assertCanManage(req, tournamentId);

  const items = await OverlayTemplate.find({
    tournament: tournamentId,
    status: { $ne: "archived" },
  })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  res.json({ ok: true, items: items.map(serializeTemplate) });
});

export const cloneOverlayTemplate = expressAsyncHandler(async (req, res) => {
  try {
    const scope = await resolveScopeFromBody(req.body || {});
    await assertCanManage(req, scope.tournamentId);

    const sourceKey = cleanString(req.body?.sourceTemplateKey || req.body?.key, 80);
    const source = SYSTEM_TEMPLATE_BY_KEY.get(sourceKey);
    const baseDocument = req.body?.document || source?.document;
    const baseCanvas = req.body?.canvas || source?.canvas || DEFAULT_CANVAS;
    if (!baseDocument) {
      return res.status(400).json({ message: "Missing template document" });
    }

    const document = normalizeDocument(baseDocument);
    const template = await OverlayTemplate.create({
      name: cleanString(req.body?.name || source?.name || "Overlay template", 120),
      description: cleanString(req.body?.description || source?.description || "", 500),
      engine: "safe-layers",
      sourceTemplateKey: sourceKey,
      tournament: scope.tournamentId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      status: "draft",
      canvas: normalizeCanvas(baseCanvas),
      document,
      bindings: extractBindings(document),
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    res.status(201).json({ ok: true, template: serializeTemplate(template) });
  } catch (error) {
    const status = error.statusCode || 400;
    res.status(status).json({ message: error.message || "Cannot clone template" });
  }
});

export const updateOverlayTemplate = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  const template = await OverlayTemplate.findById(id);
  if (!template || template.status === "archived") {
    return res.status(404).json({ message: "Template not found" });
  }
  await assertCanManage(req, template.tournament);

  if (req.body?.name != null) {
    template.name = cleanString(req.body.name, 120) || template.name;
  }
  if (req.body?.description != null) {
    template.description = cleanString(req.body.description, 500);
  }
  if (req.body?.canvas) {
    template.canvas = normalizeCanvas(req.body.canvas);
  }
  if (req.body?.document) {
    const document = normalizeDocument(req.body.document);
    template.document = document;
    template.bindings = extractBindings(document);
  }
  template.updatedBy = req.user?._id || null;
  template.version = Number(template.version || 1) + 1;
  await template.save();

  res.json({ ok: true, template: serializeTemplate(template) });
});

export const publishOverlayTemplate = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: "Invalid template id" });
  }

  const template = await OverlayTemplate.findById(id);
  if (!template || template.status === "archived") {
    return res.status(404).json({ message: "Template not found" });
  }
  await assertCanManage(req, template.tournament);

  await OverlayTemplate.updateMany(
    {
      _id: { $ne: template._id },
      tournament: template.tournament,
      scopeType: template.scopeType,
      scopeId: template.scopeId || null,
      status: "published",
    },
    { $set: { status: "draft" } }
  );

  template.status = "published";
  template.publishedAt = new Date();
  template.updatedBy = req.user?._id || null;
  template.version = Number(template.version || 1) + 1;
  await template.save();

  res.json({ ok: true, template: serializeTemplate(template) });
});

export const resolveOverlayTemplate = expressAsyncHandler(async (req, res) => {
  const matchId = req.query.matchId || req.params.matchId;
  if (!isObjectId(matchId)) {
    return res.status(400).json({ message: "Invalid match id" });
  }

  const match = await Match.findById(matchId)
    .select("_id tournament bracket")
    .lean();
  if (!match) {
    return res.status(404).json({ message: "Match not found" });
  }

  const scopes = [
    { scopeType: "match", scopeId: match._id },
    ...(match.bracket ? [{ scopeType: "bracket", scopeId: match.bracket }] : []),
    { scopeType: "tournament", scopeId: match.tournament },
    { scopeType: "default", scopeId: null },
  ];

  let resolved = null;
  let resolvedScope = null;
  for (const scope of scopes) {
    const query = {
      tournament: match.tournament,
      scopeType: scope.scopeType,
      status: "published",
    };
    if (scope.scopeId) query.scopeId = scope.scopeId;
    else query.$or = [{ scopeId: null }, { scopeId: { $exists: false } }];

    resolved = await OverlayTemplate.findOne(query)
      .sort({ publishedAt: -1, updatedAt: -1 })
      .lean();
    if (resolved) {
      resolvedScope = scope.scopeType;
      break;
    }
  }

  res.json({
    ok: true,
    matchId: String(match._id),
    tournamentId: String(match.tournament),
    template: serializeTemplate(resolved),
    resolvedScope,
  });
});
