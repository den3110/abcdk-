// controllers/adminMatchLiveController.js
import {
  fbCreateLiveOnPage,
  fbPostComment,
} from "../services/facebookLive.service.js";
import Match from "../models/matchModel.js";
import { startObsStreamingWithOverlay } from "../services/obs.service.js";
import FbToken from "../models/fbTokenModel.js";
import { getValidPageToken } from "../services/fbTokenService.js";
import { getPageLiveState } from "../services/facebookApi.js"; // 👈 NEW

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST;
const OBS_AUTO_START = String(process.env.OBS_AUTO_START || "0") === "1";

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

async function tryCreateLiveOnPage({ pageId, title, description }) {
  const pageAccessToken = await getValidPageToken(pageId);
  const live = await fbCreateLiveOnPage({
    pageId,
    pageAccessToken,
    title,
    description,
    status: "LIVE_NOW",
  });
  return { live, pageAccessToken };
}

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
      try {
        // ✅ FB-side preflight: hỏi thẳng Graph xem Page có đang LIVE/đã có UNPUBLISHED (đã phát stream key) không
        const token = await getValidPageToken(pageId);
        const state = await getPageLiveState({
          pageId,
          pageAccessToken: token,
        });
        if (state.busy) {
          // 🔎 LOG ngay tại controller khi skip vì đang live/giữ key
          const toFull = (u) =>
            u?.startsWith("http") ? u : u ? `https://facebook.com${u}` : "";
          if (state.liveNow.length) {
            console.warn(
              `[FB][skip] Page ${pageId} is LIVE: ${state.liveNow
                .map((v) => v.id)
                .join(", ")}`
            );
            state.liveNow.forEach((v) => {
              console.warn(
                `[FB][skip]   LIVE id=${v.id} status=${v.status} url=${toFull(
                  v.permalink_url
                )}`
              );
            });
          }
          if (state.prepared.length) {
            console.warn(
              `[FB][skip] Page ${pageId} has PREPARED lives: ${state.prepared
                .map((v) => v.id)
                .join(", ")}`
            );
            state.prepared.forEach((v) => {
              console.warn(
                `[FB][skip]   PREP id=${v.id} status=${v.status} url=${toFull(
                  v.permalink_url
                )}`
              );
            });
          }
          busyByGraph.push({
            pageId,
            liveNow: state.liveNow.map((v) => v.id),
            prepared: state.prepared.map((v) => v.id),
          });
          continue; // thử page khác
        }

        // Thử tạo live — nếu vẫn bị FB chặn thì coi như bận
        const { live, pageAccessToken } = await tryCreateLiveOnPage({
          pageId,
          title,
          description,
        });
        chosen = { pageId, live, pageAccessToken };
        break;
      } catch (e) {
        const gErr = e?.response?.data?.error || {};
        const msg = gErr.message || e.message || String(e);
        const busyMsg =
          /only one live|already has a live|Only one live video|throttle|rate limit/i;
        if (busyMsg.test(msg)) {
          busyByGraph.push({ pageId, reason: msg });
          continue;
        }
        errors.push({
          pageId,
          message: msg,
          code: gErr.code,
          subcode: gErr.error_subcode,
        });
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
