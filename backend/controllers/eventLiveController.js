// controllers/eventLiveController.js
// API công khai cho tính năng "Xem live giải đấu" (vd Heineken Pickleball World Cup).
import asyncHandler from "express-async-handler";
import {
  getEventLiveData,
  getEventLiveConfig,
} from "../services/eventLiveStreams.service.js";

// GET /api/event-live  -> { enabled, event..., live:[], replays:[] }
export const getEventLive = asyncHandler(async (req, res) => {
  const force = String(req.query.refresh || "") === "1";
  const data = await getEventLiveData({ force });
  res.set("Cache-Control", "public, max-age=60");
  res.json(data);
});

// GET /api/event-live/config -> { enabled, eventName, eventLogoUrl, bannerImageUrl, tournamentId }
// (nhẹ, cho banner trang chủ; KHÔNG trả apiKey/channel)
export const getEventLiveConfigPublic = asyncHandler(async (req, res) => {
  const cfg = await getEventLiveConfig();
  res.set("Cache-Control", "public, max-age=120");
  res.json({
    enabled: cfg.enabled,
    eventName: cfg.eventName,
    eventLogoUrl: cfg.eventLogoUrl,
    bannerImageUrl: cfg.bannerImageUrl,
    tournamentId: cfg.tournamentId,
    configured: Boolean(cfg.youtubeChannel),
  });
});
