// controllers/adminMatchLiveController.js
import {
  fbCreateLiveOnPage,
  fbPostComment,
} from "../services/facebookLive.service.js";
import Match from "../models/matchModel.js";
import { startObsStreamingWithOverlay } from "../services/obs.service.js";

import FbToken from "../models/fbTokenModel.js";
import { getValidPageToken } from "../services/fbTokenService.js";
import { getPageLiveState } from "../services/facebookApi.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST;

const OBS_AUTO_START = String(process.env.OBS_AUTO_START || "0") === "1";

// ───────────────────────────────────────────────────────────────────────────────
function splitServerAndKey(secureUrl) {
  try {
    const u = new URL(secureUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const keyPart = parts.pop() || "";
    const server = `${u.protocol}//${u.host}/${parts.join("/")}/`;
    const streamKey = `${keyPart}${u.search || ""}`;
    return { server, streamKey };
  } catch {
    return { server: secureUrl, streamKey: "" };
  }
}

async function buildCandidatePageIds(req, tournament) {
  const fromReq = req.body?.pageId || req.query?.pageId || null;
  const fromTournament =
    tournament?.facebookPageId ||
    tournament?.facebook?.pageId ||
    tournament?.meta?.facebook?.pageId ||
    null;

  const tokens = await FbToken.find(
    {},
    { pageId: 1 },
    { sort: { createdAt: 1 } }
  ).lean();
  const all = tokens.map((t) => String(t.pageId)).filter(Boolean);

  const ordered = [];
  const pushUnique = (id) =>
    id && !ordered.includes(String(id)) && ordered.push(String(id));
  pushUnique(fromReq);
  pushUnique(fromTournament);
  all.forEach(pushUnique);
  return ordered;
}

async function getPageLabel(pageId) {
  const doc = await FbToken.findOne({ pageId }, { pageName: 1 }).lean();
  return doc?.pageName ? `${doc.pageName} (${pageId})` : String(pageId);
}

// Phân loại lỗi tạo live → có phải do page đang bận hay không
function isBusyCreateError(err) {
  const gErr = err?.response?.data?.error || {};
  const msg = (gErr.message || err.message || "").toLowerCase();
  const patterns = [
    "only one live", // “Only one live video …”
    "already has a live", // “… already has a live …”
    "another live video", // “Another live video is active …”
    "is currently live", // “Page is currently live …”
    "broadcast", // “… broadcast already exists …”
    "throttle",
    "rate limit",
  ];
  return patterns.some((p) => msg.includes(p));
}

// ───────────────────────────────────────────────────────────────────────────────
export const createFacebookLiveForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    const t = match.tournament;
    const overlayUrl = `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;
    const courtName = match?.court?.name || "";
    const title = `${t?.name || "PickleTour"} – ${match.roundLabel || ""}${
      courtName ? " · " + courtName : ""
    }`;
    const description = `Trực tiếp trận đấu trên PickleTour.\nScoreboard overlay: ${overlayUrl}`;

    const candidates = await buildCandidatePageIds(req, t);
    if (!candidates.length) {
      return res.status(400).json({
        message:
          "Không tìm thấy Facebook Page. Hãy cấu hình pageId ở giải hoặc seed FbToken trước.",
      });
    }

    const tried = [];
    const busyByGraph = [];
    const errors = [];
    let chosen = null;

    for (const pageId of candidates) {
      tried.push(pageId);
      const label = await getPageLabel(pageId);

      // 1) lấy token hợp lệ (auto refresh)
      let pageAccessToken;
      try {
        pageAccessToken = await getValidPageToken(pageId);
      } catch (e) {
        console.warn(`[FB][token] Skip ${label}: ${e?.message || e}`);
        errors.push({ pageId, message: e?.message || String(e) });
        continue;
      }

      // 2) preflight FB-side: nếu lỗi → vẫn thử tạo; nếu báo bận → bỏ qua page này
      try {
        const state = await getPageLiveState({ pageId, pageAccessToken });
        if (state.busy) {
          const toFull = (u) =>
            u?.startsWith("http") ? u : u ? `https://facebook.com${u}` : "";
          console.warn(
            `[FB][skip] Page busy by Graph → ${label}: live=${state.liveNow.length} prepared=${state.prepared.length}`
          );
          state.liveNow.forEach((v) =>
            console.warn(
              `[FB][skip]   LIVE id=${v.id} status=${v.status} url=${toFull(
                v.permalink_url
              )}`
            )
          );
          state.prepared.forEach((v) =>
            console.warn(
              `[FB][skip]   PREP id=${v.id} status=${v.status} url=${toFull(
                v.permalink_url
              )}`
            )
          );
          busyByGraph.push({
            pageId,
            liveNow: state.liveNow.map((v) => v.id),
            prepared: state.prepared.map((v) => v.id),
          });
          continue;
        }
      } catch (preflightErr) {
        console.warn(
          `[FB][preflight] ${label} failed, will attempt create anyway:`,
          preflightErr?.message || preflightErr
        );
      }

      // 🔔 LOG: sẽ live ở page nào (trước khi tạo)
      console.info(
        `[FB][choose] Attempting to GO LIVE on: ${label} — https://facebook.com/${pageId}`
      );

      // 3) thử tạo live; nếu FB bảo bận → nhảy qua page sau
      try {
        const live = await fbCreateLiveOnPage({
          pageId,
          pageAccessToken,
          title,
          description,
          status: "LIVE_NOW",
        });

        // ✅ Thành công → xác nhận log
        console.info(
          `[FB][success] LIVE created on: ${label} ` +
            `liveVideoId=${live.liveVideoId || live.id} ` +
            `permalink=${
              live.permalink_url?.startsWith("http")
                ? live.permalink_url
                : "https://facebook.com" + (live.permalink_url || "")
            }`
        );

        chosen = { pageId, live, pageAccessToken };
        break;
      } catch (e) {
        if (isBusyCreateError(e)) {
          console.warn(
            `[FB][create-busy] ${label}: ${
              e?.response?.data?.error?.message || e.message
            }`
          );
          continue;
        }
        console.error(
          `[FB][create-error] ${label}:`,
          e?.response?.data || e.message || e
        );
        errors.push({
          pageId,
          message: e?.response?.data?.error?.message || e.message || String(e),
          code: e?.response?.data?.error?.code,
          subcode: e?.response?.data?.error?.error_subcode,
        });
        continue;
      }
    }

    if (!chosen) {
      return res.status(409).json({
        message:
          "Không còn Facebook Page nào trống/khả dụng để tạo live lúc này.",
        tried,
        busy: busyByGraph,
        errors,
      });
    }

    const { pageId, live, pageAccessToken } = chosen;
    const { server, streamKey } = splitServerAndKey(live?.secure_stream_url);

    // Bình luận overlay (best-effort)
    try {
      await fbPostComment({
        liveVideoId: live.liveVideoId || live.id,
        pageAccessToken,
        message: `Overlay (OBS Browser Source): ${overlayUrl}`,
      });
    } catch (err) {
      console.log(
        "[FB] comment overlay error:",
        err?.response?.data || err.message
      );
    }

    // Lưu vào match
    match.facebookLive = {
      id: live.liveVideoId || live.id,
      permalink_url: live.permalink_url?.startsWith("http")
        ? live.permalink_url
        : "https://facebook.com" + (live.permalink_url || ""),
      secure_stream_url: live.secure_stream_url,
      server_url: server,
      stream_key: streamKey,
      createdAt: new Date(),
      status: "CREATED",
      pageId,
    };
    await match.save();

    // Auto OBS (không chặn flow)
    if (OBS_AUTO_START) {
      try {
        await startObsStreamingWithOverlay({
          server_url: server,
          stream_key: streamKey,
          overlay_url: overlayUrl,
        });
      } catch (e) {
        console.error("[OBS] start failed:", e?.message || e);
      }
    }

    const studioUrl =
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000/studio/live"
        : `${process.env.HOST}/studio/live`) +
      `?matchId=${match._id}&server=${encodeURIComponent(
        server
      )}&key=${encodeURIComponent(streamKey)}`;

    return res.json({
      liveVideoId: live.liveVideoId || live.id,
      permalink_url: match.facebookLive.permalink_url,
      server_url: server,
      stream_key: streamKey,
      secure_stream_url: live.secure_stream_url,
      overlay_url: overlayUrl,
      note: "Dán Server/Key vào OBS/encoder rồi Start Streaming.",
      studio_url: studioUrl,
      pageId,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Create Facebook Live failed",
      error: err?.response?.data || err.message,
    });
  }
};
