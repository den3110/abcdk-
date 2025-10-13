// controllers/adminMatchLiveController.js
import Tournament from "../models/tournamentModel.js";
import {
  fbCreateLiveOnPage,
  fbPostComment,
} from "../services/facebookLive.service.js";
import Match from "../models/matchModel.js";
import { startObsStreamingWithOverlay } from "../services/obs.service.js";

// 🔰 NEW: lấy pageId & token động từ module FB token manager (cron-only)
import FbToken from "../models/fbTokenModel.js";
import { getValidPageToken } from "../services/fbTokenService.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST

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

// Ưu tiên: req.body.pageId / req.query.pageId → tournament.facebookPageId → trang đầu tiên trong DB FbToken
async function resolvePageId(req, tournament) {
  const fromReq = req.body?.pageId || req.query?.pageId;
  if (fromReq) return String(fromReq);

  const fromTournament =
    tournament?.facebookPageId ||
    tournament?.facebook?.pageId ||
    tournament?.meta?.facebook?.pageId;
  if (fromTournament) return String(fromTournament);

  const first = await FbToken.findOne({}, null, { sort: { createdAt: 1 } });
  return first?.pageId || null;
}

export const createFacebookLiveForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    const t = match.tournament;
    const pageId = await resolvePageId(req, t);
    if (!pageId) {
      return res.status(400).json({
        message:
          "Không tìm thấy Facebook Page để tạo live. Hãy cấu hình pageId ở giải hoặc seed FbToken trước.",
      });
    }

    // 🔰 NEW: Lấy PAGE ACCESS TOKEN hợp lệ (tự refresh nếu gần hết hạn)
    const pageAccessToken = await getValidPageToken(pageId);

    const courtName = match?.court?.name || "";
    const overlayUrl = `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;

    const title = `${t?.name || "PickleTour"} – ${match.roundLabel || ""} ${
      courtName ? "· " + courtName : ""
    }`;
    const description =
      `Trực tiếp trận đấu trên PickleTour.\n` +
      `Scoreboard overlay: ${overlayUrl}`;

    const live = await fbCreateLiveOnPage({
      pageId,
      pageAccessToken,
      title,
      description,
      status: "LIVE_NOW",
    });

    const { server, streamKey } = splitServerAndKey(live?.secure_stream_url);

    // comment overlay (không chặn flow nếu lỗi)
    try {
      await fbPostComment({
        liveVideoId: live.liveVideoId || live.id,
        pageAccessToken,
        message: `Overlay (OBS Browser Source): ${overlayUrl}`,
      });
    } catch (err) {
      console.log(err?.response?.data || err.message);
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
      pageId, // 🔰 lưu lại pageId dùng cho lần sau
    };
    await match.save();

    // Auto OBS (không chặn flow)
    let obsResult = { started: false };
    if (OBS_AUTO_START) {
      try {
        obsResult = await startObsStreamingWithOverlay({
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

    res.json({
      liveVideoId: live.liveVideoId || live.id,
      permalink_url: match.facebookLive.permalink_url,
      server_url: server,
      stream_key: streamKey,
      secure_stream_url: live.secure_stream_url,
      overlay_url: overlayUrl,
      note: "Dán Server/Key vào OBS/encoder rồi Start Streaming.",
      studio_url: studioUrl,
      // obs: obsResult,
      pageId, // để UI biết đang stream lên page nào
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Create Facebook Live failed",
      error: err?.response?.data || err.message,
    });
  }
};
