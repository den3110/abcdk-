// controllers/adminMatchLiveController.js
import Tournament from "../models/tournamentModel.js";
import {
  fbCreateLiveOnPage,
  fbPostComment,
} from "../services/facebookLive.service.js";
import Match from "../models/matchModel.js";
import { startObsStreamingWithOverlay } from "../services/obs.service.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST +
      "/overlay/score?matchId=68e7022bf249ef7279b174ec&theme=dark&size=md&showSets=1&autoNext=1";
const FB_PAGE_ID = process.env.FB_PAGE_ID;
const FB_PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
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

export const createFacebookLiveForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    const t = match.tournament;
    const courtName = match?.court?.name || "";
    const overlayUrl = `${OVERLAY_BASE}/scoreboard?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;

    const title = `${t?.name || "PickleTour"} – ${match.roundLabel || ""} ${
      courtName ? "· " + courtName : ""
    }`;
    const description =
      `Trực tiếp trận đấu trên PickleTour.\n` +
      `Scoreboard overlay: ${overlayUrl}`;

    const live = await fbCreateLiveOnPage({
      pageId: FB_PAGE_ID,
      pageAccessToken: FB_PAGE_TOKEN,
      title,
      description,
      status: "LIVE_NOW",
    });

    const { server, streamKey } = splitServerAndKey(live?.secure_stream_url);

    // (tuỳ chọn) comment overlay để dễ pin thủ công trong Live Producer
    try {
      await fbPostComment({
        liveVideoId: live.liveVideoId || live.id,
        pageAccessToken: FB_PAGE_TOKEN,
        message: `Overlay (OBS Browser Source): ${overlayUrl}`,
      });
    } catch (err) {
      console.log(err?.response?.data || err.message);
      /* không chặn main flow */
    }

    // Lưu vào match
    match.facebookLive = {
      id: live.liveVideoId || live.id,
      permalink_url: live.permalink_url,
      secure_stream_url: live.secure_stream_url,
      server_url: server,
      stream_key: streamKey,
      createdAt: new Date(),
      status: "CREATED",
    };
    await match.save();

    // === Auto điều khiển OBS (không chặn flow nếu lỗi) ===
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
        // vẫn trả FB info bình thường
      }
    }

    const studioUrl =
      `${process.env.HOST}/studio/live` +
      `?matchId=${match._id}` +
      `&server=${encodeURIComponent(server)}` +
      `&key=${encodeURIComponent(streamKey)}`;

    res.json({
      liveVideoId: live.liveVideoId || live.id,
      permalink_url: live.permalink_url,
      server_url: server,
      stream_key: streamKey,
      secure_stream_url: live.secure_stream_url,
      overlay_url: overlayUrl,
      note: "Dán Server/Key vào OBS/encoder rồi Start Streaming.",
      studio_url: studioUrl,
      //    obs: obsResult,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Create Facebook Live failed",
      error: err?.response?.data || err.message,
    });
  }
};
