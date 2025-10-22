// overlays.js - Tất cả logic overlay ở đây
// Bạn có thể customize thoải mái không ảnh hưởng code chính

// ==================== CONFIG ====================
export const DEFAULT_OVERLAY_CONFIG = {
  scoreBoard: true,
  timer: true,
  tournamentName: true,
  logo: true,
  sponsors: false,
  lowerThird: false,
  socialMedia: false,
  qrCode: false,
  frameDecor: false,
  liveBadge: true,
  viewerCount: false,
};

// ==================== HELPER ====================
const roundRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

// ==================== OVERLAY DRAWERS ====================

export const drawScoreBoard = (ctx, w, h, data) => {
  if (!data) return;
  const scale = Math.min(w / 1280, 1);
  const x = 20 * scale;
  const y = 20 * scale;
  const width = 320 * scale;
  const height = 120 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(11,15,20,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 15 * scale;
  roundRect(ctx, x, y, width, height, 12 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tournament name
  ctx.fillStyle = "#9AA4AF";
  ctx.font = `500 ${11 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText(
    data?.tournament?.name || "Tournament",
    x + 14 * scale,
    y + 22 * scale
  );

  // Team A
  const teamA = data?.teams?.A?.name || "Team A";
  const scoreA = data?.gameScores?.[data?.currentGame || 0]?.a || 0;
  ctx.fillStyle = "#25C2A0";
  ctx.beginPath();
  ctx.arc(x + 18 * scale, y + 45 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#E6EDF3";
  ctx.font = `600 ${16 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText(teamA, x + 32 * scale, y + 50 * scale);
  ctx.font = `800 ${24 * scale}px Arial`;
  ctx.textAlign = "right";
  ctx.fillText(String(scoreA), x + width - 14 * scale, y + 50 * scale);

  // Team B
  const teamB = data?.teams?.B?.name || "Team B";
  const scoreB = data?.gameScores?.[data?.currentGame || 0]?.b || 0;
  ctx.fillStyle = "#4F46E5";
  ctx.beginPath();
  ctx.arc(x + 18 * scale, y + 85 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#E6EDF3";
  ctx.font = `600 ${16 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText(teamB, x + 32 * scale, y + 90 * scale);
  ctx.font = `800 ${24 * scale}px Arial`;
  ctx.textAlign = "right";
  ctx.fillText(String(scoreB), x + width - 14 * scale, y + 90 * scale);
  ctx.restore();
};

export const drawTimer = (ctx, w, h, streamTime) => {
  const minutes = Math.floor(streamTime / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (streamTime % 60).toString().padStart(2, "0");
  const scale = Math.min(w / 1280, 1);
  const x = w / 2 - 80 * scale;
  const y = 20 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(239,68,68,0.95)";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 15 * scale;
  roundRect(ctx, x, y, 160 * scale, 50 * scale, 25 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "white";
  ctx.font = `bold ${28 * scale}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText(`${minutes}:${seconds}`, w / 2, y + 35 * scale);
  ctx.restore();
};

export const drawTournamentName = (ctx, w, h, data) => {
  if (!data) return;
  const text = data?.tournament?.name || "Tournament 2025";
  const scale = Math.min(w / 1280, 1);
  const x = w - 320 * scale;
  const y = 20 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(11,15,20,0.85)";
  roundRect(ctx, x, y, 300 * scale, 50 * scale, 10 * scale);
  ctx.fill();
  ctx.fillStyle = "#FFD700";
  ctx.font = `bold ${18 * scale}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText(text, x + 150 * scale, y + 32 * scale);
  ctx.restore();
};

export const drawLogo = (ctx, w, h) => {
  const scale = Math.min(w / 1280, 1);
  const x = w - 170 * scale;
  const y = 90 * scale;
  const size = 150 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 10 * scale;
  roundRect(ctx, x, y, size, 60 * scale, 8 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#667eea";
  ctx.font = `bold ${24 * scale}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText("YOUR LOGO", x + size / 2, y + 38 * scale);
  ctx.restore();
};

export const drawSponsors = (ctx, w, h) => {
  const sponsors = ["SPONSOR 1", "SPONSOR 2", "SPONSOR 3"];
  const scale = Math.min(w / 1280, 1);
  const x = w - 250 * scale;
  const y = h - 120 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  roundRect(ctx, x, y, 230 * scale, 100 * scale, 8 * scale);
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.font = `bold ${12 * scale}px Arial`;
  ctx.textAlign = "center";
  sponsors.forEach((sponsor, i) =>
    ctx.fillText(sponsor, x + 115 * scale, y + (25 + i * 25) * scale)
  );
  ctx.restore();
};

export const drawLowerThird = (ctx, w, h) => {
  const scale = Math.min(w / 1280, 1);
  const x = 40 * scale;
  const y = h - 100 * scale;
  const width = 500 * scale;

  ctx.save();
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, "rgba(239,68,68,0.95)");
  gradient.addColorStop(1, "rgba(220,38,38,0.95)");
  ctx.fillStyle = gradient;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 15 * scale;
  roundRect(ctx, x, y, width, 70 * scale, 35 * scale);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.fillRect(x, y, 4 * scale, 70 * scale);
  ctx.shadowBlur = 0;
  ctx.font = `bold ${24 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText("Player Name", x + 20 * scale, y + 30 * scale);
  ctx.font = `${16 * scale}px Arial`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("Champion • Team A", x + 20 * scale, y + 55 * scale);
  ctx.restore();
};

export const drawSocialMedia = (ctx, w, h) => {
  const socials = [
    { icon: "📱", text: "@YourChannel" },
    { icon: "🐦", text: "@YourTwitter" },
    { icon: "📺", text: "YourStream" },
  ];
  const scale = Math.min(w / 1280, 1);
  const x = 20 * scale;
  const y = h - 150 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(11,15,20,0.85)";
  roundRect(ctx, x, y, 280 * scale, 130 * scale, 10 * scale);
  ctx.fill();
  socials.forEach((social, i) => {
    ctx.fillStyle = "white";
    ctx.font = `${20 * scale}px Arial`;
    ctx.textAlign = "left";
    ctx.fillText(social.icon, x + 15 * scale, y + (35 + i * 40) * scale);
    ctx.font = `${14 * scale}px Arial`;
    ctx.fillText(social.text, x + 50 * scale, y + (35 + i * 40) * scale);
  });
  ctx.restore();
};

export const drawQRCode = (ctx, w, h) => {
  const scale = Math.min(w / 1280, 1);
  const x = w - 130 * scale;
  const y = h - 130 * scale;
  const size = 110 * scale;

  ctx.save();
  ctx.fillStyle = "white";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 10 * scale;
  roundRect(ctx, x, y, size, size, 8 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#000";
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 0)
        ctx.fillRect(
          x + (10 + i * 11) * scale,
          y + (10 + j * 11) * scale,
          10 * scale,
          10 * scale
        );
    }
  ctx.restore();
};

export const drawFrameDecoration = (ctx, w, h) => {
  ctx.save();
  const g1 = ctx.createLinearGradient(0, 0, w, 0);
  g1.addColorStop(0, "rgba(102,126,234,0.8)");
  g1.addColorStop(1, "rgba(118,75,162,0.8)");
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);
  const g2 = ctx.createLinearGradient(0, 0, 0, h);
  g2.addColorStop(0, "rgba(102,126,234,0.8)");
  g2.addColorStop(1, "rgba(118,75,162,0.8)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, 3, h);
  ctx.fillRect(w - 3, 0, 3, h);
  ctx.fillStyle = "rgba(255,215,0,0.9)";
  [
    [10, 10],
    [w - 20, 10],
    [10, h - 20],
    [w - 20, h - 20],
  ].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

export const drawLiveBadge = (ctx, w, h) => {
  const scale = Math.min(w / 1280, 1);
  const x = w - 150 * scale;
  const y = 20 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(239,68,68,0.95)";
  ctx.shadowColor = "rgba(239,68,68,0.5)";
  ctx.shadowBlur = 15 * scale;
  roundRect(ctx, x, y, 130 * scale, 45 * scale, 22 * scale);
  ctx.fill();
  const pulseSize = (8 + Math.sin(Date.now() / 300) * 2) * scale;
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(x + 25 * scale, y + 22 * scale, pulseSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "white";
  ctx.font = `bold ${20 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText("LIVE", x + 50 * scale, y + 30 * scale);
  ctx.restore();
};

export const drawViewerCount = (ctx, w, h) => {
  const viewers = Math.floor(Math.random() * 1000 + 500);
  const scale = Math.min(w / 1280, 1);
  const x = w - 150 * scale;
  const y = 75 * scale;

  ctx.save();
  ctx.fillStyle = "rgba(11,15,20,0.85)";
  roundRect(ctx, x, y, 130 * scale, 40 * scale, 20 * scale);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = `${18 * scale}px Arial`;
  ctx.textAlign = "left";
  ctx.fillText("👥", x + 15 * scale, y + 27 * scale);
  ctx.font = `bold ${16 * scale}px Arial`;
  ctx.fillText(`${viewers.toLocaleString()}`, x + 45 * scale, y + 27 * scale);
  ctx.restore();
};

// ==================== MAIN RENDERER ====================

/**
 * Vẽ tất cả overlays lên canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {HTMLVideoElement} video - Video element
 * @param {number} w - Canvas width
 * @param {number} h - Canvas height
 * @param {Object} overlayConfig - Config overlay nào được bật
 * @param {Object} overlayData - Data từ API (match info)
 * @param {number} streamTime - Stream time in seconds
 */
export const renderOverlays = (
  ctx,
  video,
  w,
  h,
  overlayConfig,
  overlayData,
  streamTime
) => {
  // Draw video background
  if (video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  // Draw overlays theo config
  if (overlayConfig.scoreBoard && overlayData)
    drawScoreBoard(ctx, w, h, overlayData);
  if (overlayConfig.timer) drawTimer(ctx, w, h, streamTime);
  if (overlayConfig.tournamentName && overlayData)
    drawTournamentName(ctx, w, h, overlayData);
  if (overlayConfig.logo) drawLogo(ctx, w, h);
  if (overlayConfig.sponsors) drawSponsors(ctx, w, h);
  if (overlayConfig.lowerThird) drawLowerThird(ctx, w, h);
  if (overlayConfig.socialMedia) drawSocialMedia(ctx, w, h);
  if (overlayConfig.qrCode) drawQRCode(ctx, w, h);
  if (overlayConfig.frameDecor) drawFrameDecoration(ctx, w, h);
  if (overlayConfig.liveBadge) drawLiveBadge(ctx, w, h);
  if (overlayConfig.viewerCount) drawViewerCount(ctx, w, h);
};
