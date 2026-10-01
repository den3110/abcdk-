// Renderer overlay PNG (alpha) 1920x1080 cho auto-live server-side.
// Worker Python ffmpeg fetch qua HTTP: /api/tournament-auto-live/overlay/:sessionId.png?v=N.
// Layout đơn giản: scoreboard bottom-left kiểu native-live-app, kèm court name
// góc trên phải. Không phải overlay-web đầy đủ — MVP mỏng, đọc rõ trên FB/YT.
import { createCanvas, loadImage } from "canvas";
import mongoose from "mongoose";
import Match from "../../models/matchModel.js";
import UserMatch from "../../models/userMatchModel.js";
import CourtStation from "../../models/courtStationModel.js";
import Tournament from "../../models/tournamentModel.js";
import { Sponsor } from "../../models/sponsorModel.js";
import { buildStageName } from "../liveAppRuntime.service.js";

const W = 1920;
const H = 1080;

// Logo PickleTour luôn hiển thị góc phải-trên mọi stream.
const PT_LOGO_URL = process.env.AUTOLIVE_PT_LOGO_URL
  || `${process.env.PUBLIC_BACKEND_URL || "https://pickletour.vn"}/pickletour-v3-logo.png`;
// Fallback logo hợp lệ: nếu AUTOLIVE_PT_LOGO_URL trỏ file KHÔNG tồn tại (server trả
// HTML index.html → nạp ảnh thất bại → mất logo) thì dùng logo v3 luôn có sẵn.
const PT_LOGO_FALLBACK = `${process.env.PUBLIC_BACKEND_URL || "https://pickletour.vn"}/pickletour-v3-logo.png`;
// Logo tài trợ luân phiên (1 logo/lần) ở góc phải-dưới, đổi mỗi ROTATE_MS.
const SPONSOR_ROTATE_MS = 8000;

// Cache ảnh đã tải (logo/sponsor) — tránh tải lại mỗi ~1s worker fetch.
const imgCache = new Map(); // url → { img|null, at }
const IMG_TTL = 10 * 60 * 1000;
// TTL ngắn khi FETCH FAIL (img=null) — trước đây dùng chung 10 phút → 1 lần
// hiccup mạng lúc backend khởi động là mất luôn logo/sponsor suốt 10 phút.
const IMG_FAIL_TTL = 30 * 1000;
async function toPngBuffer(buf) {
  // node-canvas KHÔNG decode webp → convert bằng sharp. Cũng chuẩn hoá mọi
  // định dạng lạ về PNG cho chắc.
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(buf).png().toBuffer();
  } catch { return null; }
}

async function loadImageCached(url) {
  if (!url) return null;
  const c = imgCache.get(url);
  if (c) {
    const ttl = c.img ? IMG_TTL : IMG_FAIL_TTL;
    if (Date.now() - c.at < ttl) return c.img;
  }
  let img = null;
  try {
    let buf;
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    } else {
      buf = null;
      img = await loadImage(url);
    }
    if (buf) {
      const isWebp = /\.webp(\?|$)/i.test(url) || (buf.length > 12 && buf.slice(8, 12).toString() === "WEBP");
      if (isWebp) {
        const png = await toPngBuffer(buf);
        if (png) img = await loadImage(png);
      } else {
        try { img = await loadImage(buf); }
        catch { const png = await toPngBuffer(buf); if (png) img = await loadImage(png); }
      }
    }
  } catch (e) {
    img = null;
    console.warn(`[overlayRenderer] loadImage fail: ${url} · ${e?.message || e}`);
  }
  imgCache.set(url, { img, at: Date.now() });
  return img;
}

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
    // Registration nhúng player1/player2 (playerSchema: fullName, nickName)
    // — KHÔNG phải ref User, populate lồng sẽ ghi đè thành null.
    match = await Match.findById(currentMatchId)
      .select(
        "_id status pairA pairB gameScores currentGame serve rules tournament code labelKey stageIndex startedAt " +
        "round roundName roundCode format phase pool rrRound bracket"
      )
      .populate({ path: "pairA", select: "_id label teamName seed player1 player2" })
      .populate({ path: "pairB", select: "_id label teamName seed player1 player2" })
      // Bracket để suy ra VÒNG ĐẤU (buildStageName) + NỘI DUNG THI ĐẤU (bracket.name)
      .populate({ path: "bracket", select: "_id name type stage order drawRounds meta config" })
      .lean();
    if (match?.tournament) {
      tournament = await Tournament.findById(match.tournament)
        .select("_id name shortName image tournamentMode")
        .lean();
    }
  }

  // Sponsor giải (logo góc phải-dưới, luân phiên). Sort ưu tiên như overlay web.
  let sponsors = [];
  const tid = match?.tournament || tournament?._id;
  if (tid) {
    sponsors = await Sponsor.find({ tournaments: tid })
      .select("_id name logoUrl weight featured")
      .sort({ featured: -1, weight: -1, updatedAt: -1, name: 1 })
      .limit(12)
      .lean()
      .catch(() => []);
  }
  const sponsorLogos = (sponsors || [])
    .map((s) => (s.logoUrl || "").trim())
    .filter(Boolean);

  // VÒNG ĐẤU (hiển thị thanh xanh trên cùng) + NỘI DUNG THI ĐẤU (thanh dưới).
  let roundLabel = "";
  let contentLabel = "";
  if (match) {
    // Thanh xanh trên = VÒNG + TÊN BRACKET: "Vòng 2 - PRE-QUALIFYING" (buildStageName).
    try { roundLabel = buildStageName(match) || ""; } catch { roundLabel = ""; }
    // Thanh dưới = TÊN GIẢI ĐẤU (đã chứa nội dung, vd "THE RIVERSIDE CHAMPIONSHIP • Đôi nữ 3.7").
    contentLabel = (tournament?.name || tournament?.shortName || "").toString().trim();
  }

  return { station, match, tournament, sponsorLogos, roundLabel, contentLabel };
}

// Overlay cho TRẬN NGẪU NHIÊN (UserMatch standalone, không thuộc giải). UserMatch
// đã lưu sẵn pairA/pairB (build từ participants) + gameScores/currentGame/serve/rules
// — cùng shape với Match, nên tái dùng renderOverlayPng nguyên vẹn.
export async function loadOverlayDataFromUserMatch(userMatchId) {
  if (!mongoose.isValidObjectId(userMatchId)) return null;
  const m = await UserMatch.findById(userMatchId)
    .select("_id status pairA pairB gameScores currentGame serve rules title winner")
    .lean();
  if (!m) return null;
  return {
    station: { name: String(m.title || "").trim() }, // tiêu đề trận thay tên sân
    match: m,
    tournament: null,
    sponsorLogos: [],
  };
}

function playerLabel(p) {
  if (!p) return "";
  return String(p.nickName || p.nickname || p.fullName || p.name || "").trim();
}

function pairShortName(pair) {
  if (!pair) return "—";
  const team = String(pair.teamName || "").trim();
  if (team) return team;
  const p1 = playerLabel(pair.player1);
  const p2 = playerLabel(pair.player2);
  if (p1 && p2) return `${p1} / ${p2}`;
  return p1 || p2 || String(pair.label || "").trim() || "—";
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

// ────────────────────────────────────────────────────────────────────────
// Broadcast "bug" scoreboard — style V2 của native-live-app, scale cho 1080p.
// Bố cục (neo góc dưới-trái):
//   ┌──────────────────────────────┐  top bar gradient cyan → tên giải
//   │ Team A          [set] [ điểm ]│  2 hàng đội: tên + chấm giao + set + điểm
//   │ Team B          [set] [ điểm ]│
//   └──────────────────────────────┘  bottom bar: sân · cụm   |   VÁN g/bo
// ────────────────────────────────────────────────────────────────────────
const FONT = "'Arial'";
const BUG = {
  x: 48, bottom: 56, w: 520,
  topH: 38, rowH: 48, gap: 3, scoreColW: 92, setColW: 42, bottomH: 34, r: 14,
};
const C2 = {
  topGrad0: "#0EA5E9", topGrad1: "#22C1D6",
  mid: "rgba(11,17,32,0.94)",
  rowAlt: "rgba(255,255,255,0.04)",
  scoreGrad0: "#16A34A", scoreGrad1: "#0E9F6E",
  setCol: "rgba(30,41,59,0.95)", setText: "#38BDF8",
  bottom: "rgba(30,41,59,0.96)",
  text: "#F8FAFC", sub: "#CBD5E1", topText: "#FFFFFF",
  serve: "#FBBF24", divider: "rgba(255,255,255,0.30)",
};

function shadowOn(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
}
function shadowOff(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

// Hộp che ngày/giờ camera: vẽ khối tối đặc bo góc tại vùng chỉ định (toạ độ 1920x1080).
function drawTimestampCover(ctx, box) {
  const W0 = 1920, H0 = 1080;
  const x = Math.max(0, Math.min(Number(box?.x) || 1360, W0 - 8));
  const y = Math.max(0, Math.min(Number(box?.y) || 46, H0 - 8));
  const w = Math.max(8, Math.min(Number(box?.w) || 544, W0 - x));
  const h = Math.max(8, Math.min(Number(box?.h) || 72, H0 - y));
  ctx.save();
  ctx.fillStyle = "rgba(12,17,28,0.98)"; // tối gần đặc → che kín ngày giờ
  roundedRect(ctx, x, y, w, h, Math.min(12, h / 3));
  ctx.fill();
  ctx.restore();
}

// Áp ĐỘ MỜ chung cho toàn overlay: vẽ lại canvas lên canvas trong suốt với globalAlpha.
function finalizeBuffer(canvas, opacity) {
  const a = Number(opacity);
  if (!Number.isFinite(a) || a >= 1) return canvas.toBuffer("image/png");
  const out = createCanvas(W, H);
  const octx = out.getContext("2d");
  octx.clearRect(0, 0, W, H);
  octx.globalAlpha = Math.max(0, Math.min(1, a));
  octx.drawImage(canvas, 0, 0);
  octx.globalAlpha = 1;
  return out.toBuffer("image/png");
}

export async function renderOverlayPng(data) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // (Che ngày/giờ KHÔNG còn vẽ bằng overlay-box vì không blur được + dễ lệch — đã
  //  chuyển lại dùng ffmpeg delogo (blur thật) ở worker, canh theo khung 1920x1080.)

  // Vị trí các overlay có thể cấu hình (data.layout). Mặc định:
  //   scoreboard góc trái-trên, logo PickleTour góc phải-trên, sponsor phải-dưới
  const layout = data?.layout || {};
  const scoreCorner = layout.scoreboard || "top-left";
  const brandCorner = layout.brand || "top-right";
  const sponsorCorner = layout.sponsor || "bottom-right";

  await drawBrandLogo(ctx, brandCorner);
  await drawSponsorRotating(ctx, data?.sponsorLogos || [], sponsorCorner);

  const match = data?.match;
  const stationName = data?.station?.name || "";
  const cluster = data?.station?.clusterId;
  const clusterLabel = cluster?.venueName || cluster?.name || "";
  const tournamentName = (data?.tournament?.name || data?.tournament?.shortName || "GIẢI PICKLETOUR").toString();
  // Thanh XANH trên cùng = VÒNG ĐẤU; thanh dưới = NỘI DUNG THI ĐẤU (vd "Đôi hỗn hợp 4.6").
  const roundLabel = (data?.roundLabel || "").toString().trim();
  const contentLabel = (data?.contentLabel || "").toString().trim();

  if (!match) {
    drawBug(ctx, {
      corner: scoreCorner,
      tournament: tournamentName,
      rows: [{ name: "Đang chờ trận tiếp theo…", pts: "", sets: "", serve: 0, muted: true }],
      bottomLeft: contentLabel || [stationName, clusterLabel].filter(Boolean).join(" · "),
      bottomRight: "",
      single: true,
    });
    return finalizeBuffer(canvas, data?.opacity);
  }

  const rules = match.rules || {};
  const gs = match.gameScores || [];
  const cur = Math.max(0, Math.min(gs.length - 1, Number(match.currentGame || 0)));
  const g = gs[cur] || { a: 0, b: 0 };
  const { a: setsA, b: setsB } = setWins(gs, rules);
  const bestOf = Number(rules.bestOf || 3);
  const serveSide = String(match?.serve?.side || "A").toUpperCase() === "B" ? "B" : "A";
  const serveCount = Math.max(1, Math.min(2, Number(match?.serve?.server ?? 1) || 1));

  drawBug(ctx, {
    corner: scoreCorner,
    // Thanh xanh trên = VÒNG ĐẤU (fallback tên giải nếu không suy ra được vòng).
    tournament: roundLabel || tournamentName,
    rows: [
      { name: pairShortName(match.pairA), pts: String(g.a || 0), sets: String(setsA), serve: serveSide === "A" ? serveCount : 0 },
      { name: pairShortName(match.pairB), pts: String(g.b || 0), sets: String(setsB), serve: serveSide === "B" ? serveCount : 0 },
    ],
    // Thanh dưới = NỘI DUNG THI ĐẤU (fallback sân · cụm nếu trống).
    bottomLeft: contentLabel || [stationName, clusterLabel].filter(Boolean).join(" · "),
    bottomRight: `VÁN ${cur + 1}/${bestOf}`,
  });
  return finalizeBuffer(canvas, data?.opacity);
}

// Vẽ ảnh vừa khung (contain) trong hộp, giữ tỉ lệ, căn theo align.
function drawContain(ctx, img, bx, by, bw, bh, alignX) {
  const s = Math.min(bw / img.width, bh / img.height);
  const w = img.width * s, h = img.height * s;
  let x = bx;
  if (alignX === "right") x = bx + bw - w;
  else if (alignX === "center") x = bx + (bw - w) / 2;
  const y = by + (bh - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

async function drawBrandLogo(ctx, corner = "top-right") {
  let img = await loadImageCached(PT_LOGO_URL);
  // URL tuỳ chỉnh hỏng (file không có → trả HTML) → dùng logo v3 mặc định.
  if (!img && PT_LOGO_URL !== PT_LOGO_FALLBACK) img = await loadImageCached(PT_LOGO_FALLBACK);
  if (!img) return;
  const box = 132;
  const { x, y } = cornerXY(corner, box, box, 48, 40);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 16;
  drawContain(ctx, img, x, y, box, box, "center");
  ctx.restore();
}

async function drawSponsorRotating(ctx, logos, corner = "bottom-right") {
  if (!logos || !logos.length) return;
  const idx = Math.floor(Date.now() / SPONSOR_ROTATE_MS) % logos.length;
  const img = await loadImageCached(logos[idx]);
  if (!img) return;
  const boxW = 260, boxH = 100;
  const { x: bx, y: by } = cornerXY(corner, boxW, boxH, 48, 44);
  // Nền bo tròn mờ cho logo nổi trên nền video sáng/tối
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundedRect(ctx, bx - 14, by - 12, boxW + 28, boxH + 24, 14);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.restore();
  drawContain(ctx, img, bx, by, boxW, boxH, "center");
}

// Toạ độ góc neo cho 1 hộp wxh theo corner + lề.
function cornerXY(corner, w, h, mx = 48, my = 40) {
  const right = W - mx - w;
  const bottom = H - my - h;
  switch (corner) {
    case "top-right": return { x: right, y: my };
    case "bottom-left": return { x: mx, y: bottom };
    case "bottom-right": return { x: right, y: bottom };
    case "top-left":
    default: return { x: mx, y: my };
  }
}

function drawBug(ctx, o) {
  const rows = o.rows;
  const midH = o.single ? BUG.rowH : BUG.rowH * 2;
  const hasBottom = !!(o.bottomLeft || o.bottomRight);
  const bottomH = hasBottom ? BUG.bottomH : 0;
  const totalH = BUG.topH + midH + bottomH;
  const w = BUG.w;
  const r = BUG.r;
  const { x, y } = cornerXY(o.corner || "top-left", w, totalH, 48, 40);

  // Shadow nền (vẽ 1 khối bo tròn mờ dưới toàn bug)
  ctx.save();
  shadowOn(ctx);
  ctx.fillStyle = "#0B1120";
  roundedRect(ctx, x, y, w, totalH, r);
  ctx.fill();
  ctx.restore();

  // Clip toàn bộ bug theo bo góc để các lớp trong không tràn
  ctx.save();
  roundedRect(ctx, x, y, w, totalH, r);
  ctx.clip();

  // ── Top bar: gradient cyan, tên giải uppercase ──
  const topGrad = ctx.createLinearGradient(x, y, x + w, y);
  topGrad.addColorStop(0, C2.topGrad0);
  topGrad.addColorStop(1, C2.topGrad1);
  ctx.fillStyle = topGrad;
  ctx.fillRect(x, y, w, BUG.topH);
  ctx.fillStyle = C2.topText;
  ctx.font = `800 21px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fillTextTracked(ctx, truncate(ctx, String(o.tournament).toUpperCase(), w - 40), x + w / 2, y + BUG.topH / 2 + 1, 1.2);

  // ── Mid: nền tối, các hàng đội ──
  const midTop = y + BUG.topH;
  ctx.fillStyle = C2.mid;
  ctx.fillRect(x, midTop, w, midH);

  const nameAreaW = w - BUG.setColW - BUG.scoreColW;

  // Set column (navy) + Score column (green) nền
  if (!o.single) {
    ctx.fillStyle = C2.setCol;
    ctx.fillRect(x + nameAreaW, midTop, BUG.setColW, midH);
    const sGrad = ctx.createLinearGradient(x + w - BUG.scoreColW, midTop, x + w, midTop + midH);
    sGrad.addColorStop(0, C2.scoreGrad0);
    sGrad.addColorStop(1, C2.scoreGrad1);
    ctx.fillStyle = sGrad;
    ctx.fillRect(x + w - BUG.scoreColW, midTop, BUG.scoreColW, midH);
  }

  rows.forEach((row, i) => {
    const rowY = midTop + i * BUG.rowH;
    if (i === 1) {
      // divider mảnh giữa 2 hàng (toàn chiều ngang name area)
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + 16, rowY, nameAreaW - 16, 1);
    }
    drawBugRow(ctx, row, x, rowY, nameAreaW, o.single);
  });

  if (!o.single) {
    // Điểm + set từng hàng
    rows.forEach((row, i) => {
      const cy = midTop + i * BUG.rowH + BUG.rowH / 2;
      // set
      ctx.fillStyle = C2.setText;
      ctx.font = `800 24px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(row.sets, x + nameAreaW + BUG.setColW / 2, cy + 1);
      // score
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `800 44px ${FONT}`;
      ctx.fillText(row.pts, x + w - BUG.scoreColW / 2, cy + 1);
    });
    // divider ngang trong cột điểm
    ctx.fillStyle = C2.divider;
    ctx.fillRect(x + w - BUG.scoreColW + 10, midTop + midH / 2 - 1, BUG.scoreColW - 20, 2);
  }

  // ── Bottom bar ──
  if (hasBottom) {
    const bTop = midTop + midH;
    ctx.fillStyle = C2.bottom;
    ctx.fillRect(x, bTop, w, bottomH);
    // vạch cyan mảnh trên bottom
    ctx.fillStyle = C2.topGrad1;
    ctx.fillRect(x, bTop, w, 2);
    ctx.textBaseline = "middle";
    const by = bTop + bottomH / 2 + 1;
    if (o.bottomLeft) {
      ctx.fillStyle = C2.sub;
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = "left";
      fillTextTracked(ctx, truncate(ctx, String(o.bottomLeft).toUpperCase(), w * 0.6), x + 16, by, 0.6);
    }
    if (o.bottomRight) {
      ctx.fillStyle = C2.topGrad1;
      ctx.font = `800 16px ${FONT}`;
      ctx.textAlign = "right";
      fillTextTracked(ctx, String(o.bottomRight).toUpperCase(), x + w - 16, by, 0.6, "right");
    }
  }

  ctx.restore();
  // reset alignment mặc định
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawBugRow(ctx, row, x, rowY, nameAreaW, single) {
  const cy = rowY + BUG.rowH / 2;
  let nameX = x + 22;

  // Chấm giao bóng (vàng) trước tên
  if (row.serve > 0) {
    ctx.fillStyle = C2.serve;
    ctx.beginPath();
    ctx.arc(nameX + 6, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    if (row.serve >= 2) {
      ctx.beginPath();
      ctx.arc(nameX + 26, cy, 7, 0, Math.PI * 2);
      ctx.fill();
      nameX += 44;
    } else {
      nameX += 24;
    }
  }

  ctx.fillStyle = row.muted ? C2.sub : C2.text;
  ctx.font = single ? `700 24px ${FONT}` : `800 27px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxW = nameAreaW - (nameX - x) - 16;
  ctx.fillText(truncate(ctx, row.name, maxW), nameX, cy + 1);
}

/** Vẽ text kèm letter-spacing (node-canvas chưa hỗ trợ trực tiếp). */
function fillTextTracked(ctx, text, cx, cy, spacing, align) {
  if (!spacing) { ctx.fillText(text, cx, cy); return; }
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (chars.length - 1);
  let start;
  const a = align || ctx.textAlign;
  if (a === "center") start = cx - total / 2;
  else if (a === "right") start = cx - total;
  else start = cx;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  let px = start;
  chars.forEach((c, i) => {
    ctx.fillText(c, px, cy);
    px += widths[i] + spacing;
  });
  ctx.textAlign = prevAlign;
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}
