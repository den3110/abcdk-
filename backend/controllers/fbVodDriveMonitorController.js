import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import {
  ensureFbVodDriveMonitorExport,
  getFbVodDriveMonitorSnapshot,
} from "../services/fbVodDriveMonitor.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function mapEnsureReasonToMessage(reason) {
  switch (reason) {
    case "match_not_found":
      return "Match not found";
    case "facebook_vod_not_eligible":
      return "Match is not eligible for Facebook VOD fallback";
    case "recording_output_already_ready":
      return "Recording output is already ready";
    case "recording_has_uploaded_segments":
      return "Match already has internal recording segments";
    default:
      return "";
  }
}

export const getFbVodMonitor = expressAsyncHandler(async (req, res) => {
  const snapshot = await getFbVodDriveMonitorSnapshot({
    range: req.query?.range,
    status: req.query?.status,
    q: req.query?.q,
    page: req.query?.page,
    limit: req.query?.limit,
  });

  return res.json(snapshot);
});

export const ensureFbVodMonitorExport = expressAsyncHandler(
  async (req, res) => {
    const matchId = asTrimmed(req.params?.matchId);
    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(400).json({ message: "matchId is invalid" });
    }

    const result = await ensureFbVodDriveMonitorExport(matchId);
    if (result?.reason === "match_not_found") {
      return res.status(404).json({ message: "Match not found" });
    }

    return res.json({
      ok: true,
      created: Boolean(result?.created),
      reused: Boolean(result?.recording && !result?.created),
      queued: Boolean(result?.queued),
      skipped: Boolean(result?.skipped),
      reason: result?.reason || null,
      message: mapEnsureReasonToMessage(result?.reason) || null,
      row: result?.row || null,
    });
  }
);
