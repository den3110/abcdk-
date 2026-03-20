// src/controllers/overlayController.js
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import expressAsyncHandler from "express-async-handler";
import { Sponsor } from "../models/sponsorModel.js";
import CmsBlock from "../models/cmsBlockModel.js";
import UserMatch from "../models/userMatchModel.js";
import Tournament from "../models/tournamentModel.js";
import { toPublicUrl } from "../utils/publicUrl.js";
// ===== Helpers =====
const gamesToWin = (bestOf) => Math.floor((Number(bestOf) || 3) / 2) + 1;
const gameWon = (x, y, pts, byTwo) =>
  Number(x) >= Number(pts) && (byTwo ? x - y >= 2 : x - y >= 1);

// tính số set thắng mỗi bên
function setWins(gameScores = [], rules) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    if (gameWon(g?.a ?? 0, g?.b ?? 0, rules.pointsToWin, rules.winByTwo)) a++;
    else if (gameWon(g?.b ?? 0, g?.a ?? 0, rules.pointsToWin, rules.winByTwo))
      b++;
  }
  return { a, b };
}

// Ưu tiên nickname
const preferNick = (p) =>
  (
    p?.nickname ||
    p?.nickName ||
    p?.shortName ||
    p?.name ||
    p?.fullName ||
    ""
  ).trim();

// Tên fallback theo eventType
function regName(reg, evType) {
  if (!reg) return "—";
  if (evType === "single") return reg?.player1?.fullName || "N/A";
  const a = reg?.player1?.fullName || "N/A";
  const b = reg?.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}

/* ===== helpers nhỏ ===== */
const pick = (v) => (v && String(v).trim()) || "";

function gameWinner(g, rules) {
  if (!g) return null;
  const a = Number(g.a) || 0;
  const b = Number(g.b) || 0;
  // ưu tiên cờ capped lưu trong set
  if (g.capped === true) return a > b ? "A" : b > a ? "B" : null;

  const pts = Number(rules?.pointsToWin ?? 11);
  const byTwo = Boolean(rules?.winByTwo ?? true);

  // hard cap: chạm điểm là thắng
  if (
    rules?.cap?.mode === "hard" &&
    Number.isFinite(+rules?.cap?.points) &&
    (a === +rules.cap.points || b === +rules.cap.points)
  ) {
    return a > b ? "A" : b > a ? "B" : null;
  }

  if (a >= pts || b >= pts) {
    if (byTwo) {
      if (Math.abs(a - b) >= 2) return a > b ? "A" : "B";
    } else {
      if (a !== b) return a > b ? "A" : "B";
    }
  }
  // soft cap: không kéo vô tận → nếu đã vượt cap.points thì hơn điểm là thắng
  if (
    rules?.cap?.mode === "soft" &&
    Number.isFinite(+rules?.cap?.points) &&
    (a >= +rules.cap.points || b >= +rules.cap.points) &&
    a !== b
  ) {
    return a > b ? "A" : "B";
  }
  return null;
}

export async function getOverlayMatch(req, res) {
  try {
    const { id } = req.params;
    const normalizePublicAssetUrl = (value) =>
      toPublicUrl(req, value, { absolute: false });

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid match id" });
    }

    // 🟢 1) ƯU TIÊN USER MATCH
    let m = await UserMatch.findById(id)
      .populate(
        "participants.user",
        "name fullName avatar nickname nickName phone"
      )
      .populate({
        path: "referee",
        select: "name fullName nickname nickName",
      })
      .populate({
        path: "liveBy",
        select: "name fullName nickname nickName",
      })
      .populate({
        path: "serve.serverId",
        model: "User",
        select: "name fullName nickname nickName",
      })
      .populate({
        path: "court",
        select:
          "name number code label zone area venue building floor cluster group",
      })
      .lean();

    const isUserMatch = !!m;

    // 🔵 2) NẾU KHÔNG PHẢI USER MATCH → FALLBACK MATCH CŨ
    if (!m) {
      m = await Match.findById(id)
        .populate({
          path: "tournament",
          // ✅ tournament có overlay.logoUrl (theo schema bạn gửi)
          select: "name eventType image overlay nameDisplayMode",
        })
        .populate({
          path: "bracket",
          select:
            "type name order stage overlay config meta drawRounds drawStatus slotPlan groups noRankDelta",
        })
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "fullName name shortName nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "referee",
          select: "name fullName nickname nickName",
        })
        .populate({
          path: "liveBy",
          select: "name fullName nickname nickName",
        })
        .populate({ path: "previousA", select: "round order code" })
        .populate({ path: "previousB", select: "round order code" })
        .populate({ path: "nextMatch", select: "_id round order code" })
        .populate({
          path: "court",
          select:
            "name number code label zone area venue building floor cluster group",
        })
        .populate({
          path: "serve.serverId",
          model: "User",
          select: "name fullName nickname nickName",
        })
        .lean();
    }

    if (!m) return res.status(404).json({ message: "Match not found" });

    /* ==========================
     * Logo + Sponsor (y hệt getOverlayConfig)
     * ========================== */
    const FALLBACK_LOGO = "https://placehold.co/240x60/png?text=PickleTour";

    let webLogoUrl = FALLBACK_LOGO;
    let webLogoAlt = "";

    try {
      const heroBlock = await CmsBlock.findOne({ slug: "hero" }).lean();
      if (heroBlock?.data) {
        webLogoUrl = heroBlock.data.overlayLogoUrl || FALLBACK_LOGO;
        webLogoAlt =
          heroBlock.data.overlayLogoAlt || heroBlock.data.imageAlt || "";
      }
    } catch (e) {
      console.error(
        "[overlayMatch] load hero CmsBlock failed:",
        e?.message || e
      );
    }

    // ✅ tid chỉ có với Match cũ
    const tid = !isUserMatch
      ? m?.tournament?._id || m?.tournament || null
      : null;

    // ✅ luôn query Tournament để chắc chắn có overlay.logoUrl (đúng schema bạn gửi)
    let tournamentDoc = null;
    if (!isUserMatch && tid) {
      tournamentDoc = await Tournament.findById(tid)
        .select("name eventType image overlay nameDisplayMode")
        .lean();

      // fallback nếu query fail mà populate có sẵn object
      if (!tournamentDoc && m?.tournament && typeof m.tournament === "object") {
        tournamentDoc = m.tournament;
      }
    }

    let sponsors = [];
    if (tid && !isUserMatch) {
      const filter = { tournaments: tid };
      sponsors = await Sponsor.find(filter)
        .select(
          "_id name slug logoUrl websiteUrl refLink tier weight featured tournaments updatedAt"
        )
        .sort({ featured: -1, weight: -1, updatedAt: -1, name: 1 })
        .limit(12)
        .lean();
    }

    webLogoUrl = normalizePublicAssetUrl(webLogoUrl);
    sponsors = sponsors.map((s) => ({
      ...s,
      logoUrl: normalizePublicAssetUrl(s.logoUrl),
      websiteUrl: normalizePublicAssetUrl(s.websiteUrl),
      refLink: normalizePublicAssetUrl(s.refLink),
    }));

    const sponsorLogos = sponsors
      .map((s) => (s.logoUrl || "").trim())
      .filter(Boolean)
      .slice(0, 12);

    /* ==========================
     * Helpers
     * ========================== */
    const pick = (v) => (v == null ? "" : String(v).trim());

    const preferNick = (p) =>
      pick(p?.nickname) ||
      pick(p?.nickName) ||
      pick(p?.user?.nickname) ||
      pick(p?.user?.nickName);

    const fillNick = (p) => {
      if (!p) return p;
      const n =
        pick(p.nickname) ||
        pick(p.nickName) ||
        pick(p.user?.nickname) ||
        pick(p.user?.nickName);
      if (n) {
        p.nickname = n;
        p.nickName = n;
      }
      return p;
    };

    if (m?.pairA) {
      m.pairA.player1 = fillNick(m.pairA.player1);
      m.pairA.player2 = fillNick(m.pairA.player2);
    }
    if (m?.pairB) {
      m.pairB.player1 = fillNick(m.pairB.player1);
      m.pairB.player2 = fillNick(m.pairB.player2);
    }

    /* ==========================
     * Event type + Rules
     * ========================== */
    const evType =
      (
        tournamentDoc?.eventType ||
        m?.tournament?.eventType ||
        ""
      ).toLowerCase() === "single"
        ? "single"
        : "double";
    const displayMode =
      tournamentDoc?.nameDisplayMode === "fullName" ||
      m?.tournament?.nameDisplayMode === "fullName"
        ? "fullName"
        : "nickname";

    const rules = {
      bestOf: Number(m?.rules?.bestOf ?? 3),
      pointsToWin: Number(m?.rules?.pointsToWin ?? 11),
      winByTwo: Boolean(m?.rules?.winByTwo ?? true),
      cap:
        m?.rules?.cap && typeof m.rules.cap === "object"
          ? {
              mode: m.rules.cap.mode || "none",
              points:
                m.rules.cap.points == null ? null : Number(m.rules.cap.points),
            }
          : { mode: "none", points: null },
    };

    const setWins = (gameScores = [], rulesObj) => {
      const pts = Number(rulesObj.pointsToWin || 11);
      const byTwo = !!rulesObj.winByTwo;
      let a = 0;
      let b = 0;
      for (const g of gameScores) {
        const ga = Number(g?.a ?? 0);
        const gb = Number(g?.b ?? 0);
        const max = Math.max(ga, gb);
        const min = Math.min(ga, gb);
        const done = max >= pts && (byTwo ? max - min >= 2 : true);
        if (!done) continue;
        if (ga > gb) a += 1;
        else b += 1;
      }
      return { a, b };
    };

    const gamesToWin = (bestOf = 1) => Math.floor(Number(bestOf) / 2) + 1;
    const { a: setsA, b: setsB } = setWins(m?.gameScores || [], rules);

    const fullNameOf = (p) =>
      pick(p?.fullName) ||
      pick(p?.name) ||
      pick(p?.shortName) ||
      preferNick(p) ||
      "";

    const displayNameOf = (p) => {
      const nickname = preferNick(p);
      const fullName = fullNameOf(p);
      if (displayMode === "fullName") return fullName || nickname || "";
      return nickname || pick(p?.shortName) || fullName || "";
    };

    const playersFromReg = (reg) => {
      if (!reg) return [];
      return [reg.player1, reg.player2].filter(Boolean).map((p) => ({
        id: String(p?._id || p?.user || ""),
        nickname: preferNick(p),
        fullName: fullNameOf(p),
        name: fullNameOf(p),
        displayName: displayNameOf(p),
        displayNameMode: displayMode,
        shortName: p?.shortName || undefined,
      }));
    };

    const regName = (reg) => {
      if (!reg) return "";
      if (evType === "single") {
        return displayNameOf(reg?.player1);
      }
      const a = displayNameOf(reg?.player1);
      const b = displayNameOf(reg?.player2);
      return [a, b].filter(Boolean).join(" & ");
    };

    const teamName = (reg) => {
      return (
        pick(reg?.teamName) ||
        pick(reg?.label) ||
        pick(reg?.title) ||
        regName(reg)
      );
    };

    /* ==========================
     * Serve
     * ========================== */
    const serve =
      m?.serve && (m.serve.side || m.serve.server || m.serve.playerIndex)
        ? m.serve
        : { side: "A", server: 1 };

    const serveUser =
      m?.serve?.serverId && typeof m.serve.serverId === "object"
        ? {
            id: String(m.serve.serverId._id),
            name:
              m.serve.serverId.name ||
              m.serve.serverId.fullName ||
              preferNick(m.serve.serverId) ||
              "",
            nickname:
              pick(m.serve.serverId.nickname) ||
              pick(m.serve.serverId.nickName) ||
              undefined,
          }
        : undefined;

    /* ==========================
     * Court
     * ========================== */
    const courtId = m?.court?._id || m?.courtId || null;
    const courtNumber = m?.court?.number ?? m?.courtNo ?? undefined;
    const courtName =
      m?.court?.name ??
      m?.courtName ??
      (courtNumber != null ? `Sân ${courtNumber}` : "");

    const courtExtra = {
      code: m?.court?.code || undefined,
      label: m?.court?.label || m?.courtLabel || undefined,
      zone: m?.court?.zone || m?.court?.area || undefined,
      venue: m?.court?.venue || undefined,
      building: m?.court?.building || undefined,
      floor: m?.court?.floor || undefined,
      cluster: m?.court?.cluster || m?.courtCluster || undefined,
      group: m?.court?.group || undefined,
    };

    /* ==========================
     * Streams + Video
     * ========================== */
    const streams =
      (Array.isArray(m?.streams) && m.streams.length && m.streams) ||
      (Array.isArray(m?.meta?.streams) && m.meta.streams) ||
      [];
    const video = pick(m?.video);

    /* ==========================
     * Overlay (theme + logo + sponsors + clock)
     * ========================== */
    const baseOverlay =
      m?.overlay ||
      tournamentDoc?.overlay ||
      m?.tournament?.overlay ||
      m?.bracket?.overlay ||
      {};

    const overlayEnabled =
      typeof baseOverlay.enabled === "boolean" ? !!baseOverlay.enabled : true;

    const showClock =
      typeof baseOverlay.showClock === "boolean"
        ? !!baseOverlay.showClock
        : true;

    // ✅ RULE LOGO:
    // - UserMatch: baseOverlay.logoUrl
    // - Match: Tournament.overlay.logoUrl (query Tournament)
    let resolvedLogoUrl = isUserMatch
      ? String(baseOverlay?.logoUrl || "").trim()
      : String(tournamentDoc?.overlay?.logoUrl || "").trim();

    resolvedLogoUrl = normalizePublicAssetUrl(resolvedLogoUrl);

    const rootOverlay = {
      theme: baseOverlay.theme || "dark",
      accentA: baseOverlay.accentA || "#25C2A0",
      accentB: baseOverlay.accentB || "#4F46E5",
      corner: baseOverlay.corner || "tl",
      rounded:
        typeof baseOverlay.rounded === "number" ? baseOverlay.rounded : 18,
      shadow:
        typeof baseOverlay.shadow === "boolean" ? baseOverlay.shadow : true,
      showSets:
        typeof baseOverlay.showSets === "boolean" ? baseOverlay.showSets : true,
      fontFamily: baseOverlay.fontFamily || "",
      nameScale:
        typeof baseOverlay.nameScale === "number" ? baseOverlay.nameScale : 1,
      scoreScale:
        typeof baseOverlay.scoreScale === "number" ? baseOverlay.scoreScale : 1,
      customCss: baseOverlay.customCss || "",

      // ✅ đúng yêu cầu
      // logoUrl: resolvedLogoUrl || webLogoUrl,

      size: baseOverlay.size || "md",
      scaleScore:
        typeof baseOverlay.scaleScore === "number" ? baseOverlay.scaleScore : 1,
      enabled: overlayEnabled,
      showClock,

      webLogoUrl,
      webLogoAlt,
      sponsorLogos,
    };

    /* ==========================
     * Round / Seeds / Logs
     * ========================== */
    const brType = (m?.bracket?.type || m?.format || "").toString();
    const drawSize =
      Number(m?.bracket?.meta?.drawSize) > 0
        ? Number(m.bracket.meta.drawSize)
        : Number.isInteger(+m?.bracket?.drawRounds)
        ? 1 << +m.bracket.drawRounds
        : 0;
    const roundNo = Number.isFinite(+m?.round) ? +m.round : 1;

    let roundSize;
    if (drawSize && ["knockout", "double_elim", "roundElim"].includes(brType)) {
      roundSize = Math.max(2, drawSize >> (roundNo - 1));
    }
    const roundCode =
      m?.roundCode ||
      (Number.isFinite(roundSize) ? `R${roundSize}` : undefined);

    const seeds = {
      A: m?.seedA || undefined,
      B: m?.seedB || undefined,
    };

    const liveLogTail = Array.isArray(m?.liveLog)
      ? m.liveLog.slice(-10)
      : undefined;

    /* ==========================
     * Stage
     * ========================== */
    const format = (m?.format || m?.bracket?.type || "").toString() || brType;

    let stageType = null;
    let stageName = "";

    if (isUserMatch) {
      stageType = "user_match";
      stageName = "Trận đấu PickleTour";
    } else {
      const isGroupLike =
        ["group", "round_robin", "gsl", "swiss"].includes(format) ||
        m?.phase === "group";

      const isKnockoutLike =
        ["knockout", "roundElim"].includes(format) ||
        ["knockout", "roundElim"].includes(brType);

      const isDoubleElim = format === "double_elim" || brType === "double_elim";

      const isThirdPlaceMatch =
        !!m?.isThirdPlace ||
        !!m?.meta?.thirdPlace ||
        (m?.branch === "consol" &&
          (roundSize === 2 ||
            (m?.roundName || "").toLowerCase().includes("3/4")));

      if (isGroupLike) {
        stageType = "group";
        stageName = "Vòng bảng";
      } else if (isThirdPlaceMatch && (isKnockoutLike || isDoubleElim)) {
        stageType = "third_place";
        stageName = "Tranh hạng 3/4";
      } else if (isKnockoutLike) {
        stageType = "playoff";
        if (roundSize >= 64) stageName = "Vòng 64 đội";
        else if (roundSize >= 32) stageName = "Vòng 32 đội";
        else if (roundSize >= 16) stageName = "Vòng 16 đội";
        else if (roundSize === 8) stageName = "Tứ kết";
        else if (roundSize === 4) stageName = "Bán kết";
        else if (roundSize === 2) {
          stageName =
            m?.branch === "gf" || m?.phase === "grand_final"
              ? "Chung kết tổng"
              : "Chung kết";
        } else stageName = "Playoff";
      } else if (isDoubleElim) {
        stageType = "playoff";
        const branch = m?.branch || "main";
        if (branch === "wb" || branch === "main")
          stageName = "Playoff – Nhánh thắng";
        else if (branch === "lb") stageName = "Playoff – Nhánh thua";
        else if (branch === "gf") stageName = "Chung kết tổng";
        else stageName = "Playoff";
      } else if (
        ["winners", "losers", "decider", "grand_final"].includes(m?.phase)
      ) {
        stageType = "playoff";
        if (m.phase === "grand_final") stageName = "Chung kết";
        else if (m.phase === "decider") stageName = "Trận quyết định";
        else stageName = "Playoff";
      }
    }

    /* ==========================
     * Referees + chain
     * ========================== */
    const referees =
      Array.isArray(m?.referee) && m.referee.length
        ? m.referee.map((r) => ({
            id: String(r?._id),
            name: r?.name || r?.fullName || "",
            nickname: pick(r?.nickname) || pick(r?.nickName) || undefined,
          }))
        : [];

    const referee =
      referees[0] ||
      (m?.referee
        ? {
            id: String(m.referee?._id || ""),
            name: m.referee?.name || m.referee?.fullName || "",
            nickname:
              pick(m.referee?.nickname) ||
              pick(m.referee?.nickName) ||
              undefined,
          }
        : undefined);

    const previousA = m?.previousA
      ? {
          id: String(m.previousA._id),
          round: m.previousA.round,
          order: m.previousA.order,
          code: m.previousA.code || undefined,
        }
      : undefined;

    const previousB = m?.previousB
      ? {
          id: String(m.previousB._id),
          round: m.previousB.round,
          order: m.previousB.order,
          code: m.previousB.code || undefined,
        }
      : undefined;

    const nextMatch = m?.nextMatch
      ? {
          id: String(m.nextMatch._id),
          round: m.nextMatch.round,
          order: m.nextMatch.order,
          code: m.nextMatch.code || undefined,
          slot: m?.nextSlot || undefined,
        }
      : undefined;

    /* ==========================
     * Times
     * ========================== */
    const times = {
      scheduledAt: m?.scheduledAt || null,
      assignedAt: m?.assignedAt || null,
      startedAt: m?.startedAt || null,
      finishedAt: m?.finishedAt || null,
      updatedAt: m?.updatedAt || null,
      createdAt: m?.createdAt || null,
    };

    /* ==========================
     * Break
     * ========================== */
    const isBreak = m?.isBreak
      ? {
          active: !!m.isBreak.active,
          afterGame:
            m.isBreak.afterGame != null
              ? Number(m.isBreak.afterGame)
              : m.currentGame ?? null,
          note: m.isBreak.note || "",
          startedAt: m.isBreak.startedAt || null,
          expectedResumeAt: m.isBreak.expectedResumeAt || null,
        }
      : {
          active: false,
          afterGame: null,
          note: "",
          startedAt: null,
          expectedResumeAt: null,
        };

    /* ==========================
     * Response
     * ========================== */
    res.json({
      matchId: String(m._id),
      status: (m.status || "").toUpperCase(),
      winner: m.winner || "",

      tournament: isUserMatch
        ? {
            id: null,
            name: m?.title || "",
            image: "",
            nameDisplayMode: "nickname",
            displayNameMode: "nickname",
            eventType: evType,
            overlay: undefined,
            webLogoUrl,
            webLogoAlt,
            sponsors: undefined,
          }
        : {
            id: tournamentDoc?._id || m?.tournament?._id || tid || null,
            name: tournamentDoc?.name || m?.tournament?.name || "",
            image: tournamentDoc?.image || m?.tournament?.image || "",
            nameDisplayMode:
              tournamentDoc?.nameDisplayMode === "fullName" ||
              m?.tournament?.nameDisplayMode === "fullName"
                ? "fullName"
                : "nickname",
            displayNameMode: displayMode,
            eventType: evType,
            overlay:
              tournamentDoc?.overlay || m?.tournament?.overlay || undefined,
            webLogoUrl,
            webLogoAlt,
            sponsors:
              sponsors.length > 0
                ? sponsors.map((s) => ({
                    id: String(s._id),
                    name: s.name,
                    slug: s.slug,
                    logoUrl: s.logoUrl || "",
                    websiteUrl: s.websiteUrl || "",
                    refLink: s.refLink || "",
                    tier: s.tier,
                    featured: !!s.featured,
                    weight: s.weight ?? 0,
                  }))
                : undefined,
          },

      bracket: m?.bracket
        ? {
            id: String(m.bracket._id),
            type: m.bracket.type || "",
            name: m.bracket.name || "",
            order: m.bracket.order ?? undefined,
            stage: m.bracket.stage ?? undefined,
            overlay: m.bracket.overlay || undefined,
            drawRounds: m.bracket.drawRounds ?? undefined,
            drawStatus: m.bracket.drawStatus || undefined,
            noRankDelta: !!m.bracket.noRankDelta,
            config: m.bracket.config || undefined,
            meta: m.bracket.meta || undefined,
            groups:
              Array.isArray(m.bracket.groups) && m.bracket.groups.length
                ? m.bracket.groups.map((g) => ({
                    id: String(g._id),
                    name: g.name,
                    expectedSize: g.expectedSize,
                    size:
                      Number.isFinite(g.expectedSize) && g.expectedSize > 0
                        ? g.expectedSize
                        : Array.isArray(g.regIds)
                        ? g.regIds.length
                        : 0,
                  }))
                : undefined,
          }
        : undefined,

      bracketType: m?.bracket?.type || "",
      format: m?.format || m?.bracket?.type || "",
      branch: m?.branch || "main",
      phase: m?.phase || null,
      pool: m?.pool || { id: null, name: "" },

      roundCode,
      roundName: m?.roundName || "",
      round: roundNo,
      roundSize: roundSize || undefined,

      stageType: stageType || undefined,
      stageName: stageName || undefined,

      seeds,

      code: m?.code || undefined,
      labelKey: m?.labelKey || undefined,
      stageIndex: m?.stageIndex || undefined,

      teams: {
        A: {
          name: teamName(m.pairA),
          displayName: teamName(m.pairA),
          displayNameMode: displayMode,
          players: playersFromReg(m.pairA),
          seed: m?.pairA?.seed ?? undefined,
          label: m?.pairA?.label ?? undefined,
          teamName: m?.pairA?.teamName ?? undefined,
        },
        B: {
          name: teamName(m.pairB),
          displayName: teamName(m.pairB),
          displayNameMode: displayMode,
          players: playersFromReg(m.pairB),
          seed: m?.pairB?.seed ?? undefined,
          label: m?.pairB?.label ?? undefined,
          teamName: m?.pairB?.teamName ?? undefined,
        },
      },

      pairA: m?.pairA
        ? {
            id: String(m.pairA._id || ""),
            seed: m.pairA.seed ?? undefined,
            label: m.pairA.label ?? undefined,
            teamName: m.pairA.teamName ?? undefined,
            displayName: teamName(m.pairA),
            displayNameMode: displayMode,
          }
        : null,

      pairB: m?.pairB
        ? {
            id: String(m.pairB._id || ""),
            seed: m.pairB.seed ?? undefined,
            label: m.pairB.label ?? undefined,
            teamName: m.pairB.teamName ?? undefined,
            displayName: teamName(m.pairB),
            displayNameMode: displayMode,
          }
        : null,

      rules,
      currentGame: Number.isInteger(m?.currentGame) ? m.currentGame : 0,

      serve: {
        side: (serve?.side || "A").toUpperCase() === "B" ? "B" : "A",
        server: Number(serve?.server ?? serve?.playerIndex ?? 1) || 1,
        serverId:
          serveUser || (m?.serve?.serverId ? String(m.serve.serverId) : null),
      },

      gameScores: Array.isArray(m?.gameScores) ? m.gameScores : [],
      sets: { A: setsA, B: setsB },
      needSetsToWin: gamesToWin(rules.bestOf),

      court: courtId
        ? { id: courtId, name: courtName, number: courtNumber, ...courtExtra }
        : null,
      courtId: courtId || undefined,
      courtName: courtName || undefined,
      courtNo: courtNumber ?? undefined,
      queueOrder: m?.queueOrder ?? undefined,

      referees,
      referee,

      liveBy: m?.liveBy
        ? {
            id: String(m.liveBy._id),
            name: m.liveBy.name || m.liveBy.fullName || "",
            nickname:
              pick(m.liveBy.nickname) || pick(m.liveBy.nickName) || undefined,
          }
        : undefined,

      previousA,
      previousB,
      nextMatch,

      ...times,

      video: video || undefined,
      streams,
      liveVersion: m?.liveVersion ?? undefined,
      liveLogTail,
      liveLog: undefined,

      participants:
        Array.isArray(m?.participants) && m.participants.length && !isUserMatch
          ? m.participants.map((x) => String(x))
          : undefined,

      overlay: rootOverlay || undefined,
      meta: m?.meta || undefined,
      note: m?.note || undefined,

      rating: {
        delta: m?.ratingDelta ?? 0,
        applied: !!m?.ratingApplied,
        appliedAt: m?.ratingAppliedAt || null,
      },

      isBreak,
    });
  } catch (err) {
    console.error("GET /overlay/match error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

const FINISHED = "finished";
const STATUS_RANK = {
  assigned: 0,
  queued: 1,
  scheduled: 2,
  live: 3,
};

const toTs = (d) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);
const toNum = (v) => (Number.isFinite(+v) ? +v : Number.POSITIVE_INFINITY);

/** Xây dựng key sort đa tiêu chí (lexicographic) */
function sortKey(m) {
  return [
    STATUS_RANK[m?.status] ?? 99,
    toNum(m?.queueOrder),
    toTs(m?.assignedAt),
    toTs(m?.scheduledAt),
    toTs(m?.startedAt),
    toNum(m?.round),
    toNum(m?.order),
    toTs(m?.createdAt),
    String(m?._id || ""),
  ];
}
function lexCmp(a, b) {
  const ka = sortKey(a),
    kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/**
 * GET /api/courts/:courtId/next?after=:matchId
 * Trả { matchId: "..." } | { matchId: null }
 */
export const getNextMatchByCourt = expressAsyncHandler(async (req, res) => {
  const { courtId } = req.params;
  const { after } = req.query;

  if (!courtId || !mongoose.Types.ObjectId.isValid(courtId)) {
    return res.status(400).json({ message: "Invalid courtId" });
  }
  const cid = new mongoose.Types.ObjectId(courtId);

  // Lấy toàn bộ ứng viên trên cùng sân, chưa finished
  const candidates = await Match.find({
    court: cid,
    status: { $ne: FINISHED },
  })
    .select(
      "_id status queueOrder assignedAt scheduledAt startedAt round order createdAt court"
    )
    .lean();

  if (!candidates.length) {
    return res.json({ matchId: null });
  }

  candidates.sort(lexCmp);

  // Nếu có "after" và tồn tại trong tập → lấy phần tử đứng sau nó
  if (after && mongoose.Types.ObjectId.isValid(after)) {
    const idx = candidates.findIndex((m) => String(m._id) === String(after));
    if (idx >= 0) {
      const next = candidates[idx + 1];
      return res.json({ matchId: next ? String(next._id) : null });
    }
    // Nếu "after" không nằm trong tập (vì đã finished/khác sân), ta lấy phần tử đầu
  }

  // Mặc định: trả trận "đầu hàng" theo tiêu chí sort
  return res.json({ matchId: String(candidates[0]._id) });
});
