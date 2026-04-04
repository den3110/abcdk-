// controllers/courtController.js (ví dụ)
import Court from "../models/courtModel.js";
import CourtStation from "../models/courtStationModel.js";
import { enrichCourtsWithManualAssignment } from "../services/courtManualAssignment.service.js";
import { getCourtStationCurrentMatch } from "../services/courtCluster.service.js";

const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};

// giống cái normalize trong matchModel để tránh case isBreak = false
const BREAK_DEFAULT = {
  active: false,
  afterGame: null,
  note: "",
  startedAt: null,
  expectedResumeAt: null,
};
const normalizeBreak = (val) => {
  if (!val || typeof val !== "object" || Array.isArray(val)) {
    return { ...BREAK_DEFAULT };
  }
  return {
    active: !!val.active,
    afterGame:
      typeof val.afterGame === "number"
        ? val.afterGame
        : BREAK_DEFAULT.afterGame,
    note: typeof val.note === "string" ? val.note : BREAK_DEFAULT.note,
    startedAt: val.startedAt ? new Date(val.startedAt) : null,
    expectedResumeAt: val.expectedResumeAt
      ? new Date(val.expectedResumeAt)
      : null,
  };
};

export const getCourtById = async (req, res) => {
  try {
    setNoStoreHeaders(res);
    const { courtId } = req.params;

    const station = await CourtStation.findById(courtId)
      .populate("clusterId", "name slug")
      .lean();
    if (station) {
      const stationPayload = await getCourtStationCurrentMatch(courtId);
      const payload = {
        _id: String(station._id),
        id: String(station._id),
        type: "court_station",
        name: station.name,
        label: station.name,
        number: null,
        clusterId: stationPayload?.cluster?._id || String(station.clusterId?._id || station.clusterId),
        clusterName: stationPayload?.cluster?.name || station.clusterId?.name || "",
        currentMatch: stationPayload?.currentMatch?._id
          ? {
              _id: stationPayload.currentMatch._id,
              status: stationPayload.currentMatch.status,
              code: stationPayload.currentMatch.code,
              displayCode: stationPayload.currentMatch.displayCode,
            }
          : null,
        nextMatch: null,
      };
      setNoStoreHeaders(res);
      return res.json(payload);
    }

    const court = await Court.findById(courtId)
      .populate("tournament", "name status")
      .populate("bracket", "name type")
      .populate({
        path: "currentMatch",
        // ✅ lấy thêm isBreak
        select: "status labelKey code court courtLabel facebookLive isBreak",
        populate: [
          {
            path: "pairA",
            populate: {
              path: "player1.user player2.user",
              select: "name",
            },
          },
          {
            path: "pairB",
            populate: {
              path: "player1.user player2.user",
              select: "name",
            },
          },
        ],
      })
      .lean();

    if (!court) {
      return res.status(404).json({
        success: false,
        message: "Court not found",
      });
    }

    let payload = court;

    const [decoratedCourt] = await enrichCourtsWithManualAssignment([court]);
    if (decoratedCourt) {
      payload = {
        ...court,
        manualAssignment: decoratedCourt.manualAssignment,
        nextMatch: decoratedCourt.nextMatch || null,
        remainingCount: decoratedCourt.remainingCount || 0,
        listEnabled: !!decoratedCourt.listEnabled,
      };
    }

    // ✅ đảm bảo isBreak luôn là object để FE không bị văng
    if (payload.currentMatch) {
      payload.currentMatch.isBreak = normalizeBreak(payload.currentMatch.isBreak);
    }

    setNoStoreHeaders(res);
    res.json(payload);
  } catch (error) {
    console.error("Error getting court:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get court info",
      error: error.message,
    });
  }
};
