// Renderer overlay PNG (alpha) 1920x1080 cho auto-live server-side.
// Worker Python ffmpeg fetch qua HTTP: /api/tournament-auto-live/overlay/:sessionId.png?v=N.
// Layout đơn giản: scoreboard bottom-left kiểu native-live-app, kèm court name
// góc trên phải. Không phải overlay-web đầy đủ — MVP mỏng, đọc rõ trên FB/YT.
import { createCanvas } from "canvas";
import mongoose from "mongoose";
import Match from "../../models/matchModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Tournament from "../../models/tournamentModel.js";

const W = 1920;
const H = 1080;
const SCALE_Y = H; // constant

// Palette: tối, gradient volt/cyan giống UI V2 modern.
const COLORS = {
  bgTop: "rgba(15,23,42,0.86)",
  bgBottom: "rgba(15,23,42,0.72)",
  border: "rgba(148,163,184,0.35)",
  accent: "#22c1d6",
  accentDark: "#0EA5E9",
  text: "#F8FAFC",
  sub: "#94A3B8",
  chip: "rgba(255,255,255,0.10)",
  serveGlow: "#f5b301",
  win: "#22c55e",
  set: "#0EA5E9",
};

/**
 * Đọc snapshot dữ liệu overlay cho court (không dùng payload overlay đầy đủ
 * để tránh cost, chỉ query các field renderer cần).
 * Trả về:
 *   { court:{name,code}, tournament:{name,logo}, match:{id, status,
 *     teamA:{name,short}, teamB:{name,short}, gameScores:[{a,b}],
 *     sets:{A,B}, currentGame, serve:{side,server}, rules:{pointsToWin,winByTwo,bestOf} } }
 *   hoặc { court:{...}, tournament, match: null } khi chưa có trận.
 */
export async function loadOverlayData(courtStationId) {
  const station = await CourtStation.findById(courtStationId)
    .select("_id name code clusterId currentMatch")
    .populate({ path: "clusterId", select: "_id name venueName" })
    .lean();
  if (!station) return null;

  const currentMatchId = station.currentMatch;
  let match = null;
  let tournament = null;
  if (currentMatchId) {
    match = await Match.findById(currentMatchId)
      .select(
        "_id status pairA pairB gameScores currentGame serve rules tournament code labelKey stageIndex startedAt"
      )
      .populate({
        path: "pairA",
        select: "_id label teamName seed player1 player2",
        populate: [
          { path: "player1", select: "name nickname avatar" },
          { path: "player2", select: "name nickname avatar" },
        ],
      })
      .populate({
        path: "pairB",
        select: "_id label teamName seed player1 player2",
        populate: [
          { path: "player1", select: "name nickname avatar" },
          { path: "player2", select: "name nickname avatar" },
        ],
      })
      .lean();
    if (match?.tournament) {
      tournament = await Tournament.findById(match.tournament)
        .select("_id name shortName image tournamentMode")
        .lean();
    }
  }

  return { station, match, tournament };
}

function pairShortName(pair) {
  if (!pair) return "—";
  if (pair.teamName) return pair.teamName;
  const p1 = pair.player1?.nickname || pair.player1?.name || "";
  const p2 = pair.player2?.nickname || pair.player2?.name || "";
  if (p1 && p2) return `${p1} / ${p2}`;
  return p1 || p2 || pair.label || "—";
}

function setWins(gameScores = [], rules = {}) {
  const pointsToWin = Number(rules.pointsToWin || 11);
  const winByTwo = rules.winByTwo !== false;
  let a = 0, b = 0;
  for (const g of gameScores || []) {
    const ga = Number(g?.a || 0), gb = Number(g?.b || 0);
    const cap = Math.max(ga, gb);
    if (cap < pointsToWin) continue;
    if (winByTwo && Math.abs(ga - gb) < 2) continue;
    if (ga > gb) a++; else b++;
  }
  return { a, b };
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Render PNG buffer 1920x1080 alpha. `data` = kết quả loadOverlayData().
 * Layout:
 *   [1400,880] scoreboard 460x160 bottom-left
 *   [1200,60]  court chip top-right (Sân X · Cluster)
 */
export function renderOverlayPng(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const stationName = data?.station?.name || "";
  const cluster = data?.station?.clusterId;
  const clusterLabel = cluster?.venueName || cluster?.name || "";

  // Court chip top-left corner (60,50) — vẫn ngắn, không phá cảnh
  drawCourtChip(ctx, stationName, clusterLabel, data?.tournament?.name);

  const match = data?.match;
  if (!match) {
    drawWaitingBadge(ctx);
    return canvas.toBuffer("image/png");
  }

  drawScoreboard(ctx, match);
  return canvas.toBuffer("image/png");
}

function drawCourtChip(ctx, station, clusterLabel, tournamentName) {
  const x = 60, y = 50;
  const label = [station, clusterLabel].filter(Boolean).join(" · ");
  const sub = tournamentName || "";
  ctx.save();
  ctx.font = "bold 26px 'Arial'";
  const wLabel = ctx.measureText(label).width;
  ctx.font = "500 20px 'Arial'";
  const wSub = ctx.measureText(sub).width;
  const w = Math.max(wLabel, wSub) + 40;
  const h = sub ? 78 : 48;

  ctx.fillStyle = COLORS.bgTop;
  roundedRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 26px 'Arial'";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 20, y + 12);
  if (sub) {
    ctx.fillStyle = COLORS.sub;
    ctx.font = "500 20px 'Arial'";
    ctx.fillText(sub, x + 20, y + 46);
  }
  ctx.restore();
}

function drawWaitingBadge(ctx) {
  const x = 60, y = 900;
  ctx.save();
  ctx.fillStyle = "rgba(15,23,42,0.75)";
  roundedRect(ctx, x, y, 380, 90, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 30px 'Arial'";
  ctx.textBaseline = "middle";
  ctx.fillText("Đang chờ trận tiếp theo…", x + 24, y + 45);
  ctx.restore();
}

function drawScoreboard(ctx, match) {
  const rules = match.rules || {};
  const gs = match.gameScores || [];
  const cur = Math.max(0, Math.min(gs.length - 1, Number(match.currentGame || 0)));
  const g = gs[cur] || { a: 0, b: 0 };
  const { a: setsA, b: setsB } = setWins(gs, rules);
  const bestOf = Number(rules.bestOf || 3);

  const teamA = pairShortName(match.pairA);
  const teamB = pairShortName(match.pairB);
  const serveSide = String(match?.serve?.side || "A").toUpperCase() === "B" ? "B" : "A";

  const x = 60, y = H - 260;
  const w = 780, h = 200;

  // Card background
  ctx.save();
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, COLORS.bgTop);
  grad.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = grad;
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header dải volt/cyan trái
  ctx.fillStyle = COLORS.accent;
  roundedRect(ctx, x, y, 6, h, 3);
  ctx.fill();

  // Team rows
  ctx.textBaseline = "middle";
  drawTeamRow(ctx, x + 24, y + 46, w - 48, teamA, g.a, setsA, serveSide === "A", true, bestOf);
  drawTeamRow(ctx, x + 24, y + 130, w - 48, teamB, g.b, setsB, serveSide === "B", false, bestOf);

  // Bo bên phải: current game number
  drawGameNumberBadge(ctx, x + w - 78, y + h - 36, cur + 1, bestOf);

  ctx.restore();
}

function drawTeamRow(ctx, x, y, w, name, points, sets, serving, isTop, bestOf) {
  // Serving glow chấm vàng bên trái
  ctx.save();
  if (serving) {
    ctx.beginPath();
    ctx.arc(x + 12, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.serveGlow;
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.serveGlow;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x + 12, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(148,163,184,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();

  // Tên đội (cắt nếu dài)
  ctx.save();
  ctx.fillStyle = COLORS.text;
  ctx.font = "bold 34px 'Arial'";
  const label = truncate(ctx, name, w - 260);
  ctx.fillText(label, x + 36, y);

  // Sets nhỏ bên phải trước point
  ctx.font = "bold 26px 'Arial'";
  ctx.fillStyle = COLORS.set;
  const setsW = ctx.measureText(String(sets)).width;
  ctx.fillText(String(sets), x + w - 130 - setsW, y);

  // Points to lớn bên phải
  ctx.font = "bold 60px 'Arial'";
  ctx.fillStyle = COLORS.text;
  const ptsStr = String(points);
  const ptsW = ctx.measureText(ptsStr).width;
  ctx.fillText(ptsStr, x + w - 20 - ptsW, y);
  ctx.restore();
}

function drawGameNumberBadge(ctx, x, y, gameNo, bestOf) {
  ctx.save();
  ctx.fillStyle = "rgba(34,193,214,0.20)";
  roundedRect(ctx, x, y - 14, 62, 26, 8);
  ctx.fill();
  ctx.fillStyle = COLORS.accent;
  ctx.font = "bold 14px 'Arial'";
  ctx.textBaseline = "middle";
  ctx.fillText(`Ván ${gameNo}/${bestOf}`, x + 8, y);
  ctx.restore();
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 3 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}
