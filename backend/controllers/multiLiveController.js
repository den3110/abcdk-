// controllers/multiLiveController.js
import Match from "../models/matchModel.js";
import { createLiveForMatchMulti } from "../services/liveRouter.service.js";

const OVERLAY_BASE =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.HOST;

export const createLiveForMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await Match.findById(matchId).populate("tournament court");
    if (!match) return res.status(404).json({ message: "Match not found" });

    const providers = req.body.providers || ["facebook"]; // ví dụ: ["facebook","youtube"]
    const courtName = match?.court?.name ? ` · ${match.court.name}` : "";
    const title = `${match.tournament?.name || "PickleTour"} – ${
      match.roundLabel || ""
    }${courtName}`;
    const overlayUrl = `${OVERLAY_BASE}/overlay/score?matchId=${match._id}&theme=fb&ratio=16:9&safe=1`;
    const description = `Trực tiếp trận đấu trên PickleTour.\nScoreboard overlay: ${overlayUrl}`;

    const { session, chosen } = await createLiveForMatchMulti({
      match,
      providersWanted: providers,
      title,
      description,
      policy: {
        providerPriority: providers,
        constraints: {
          maxConcurrentPerOwner: 1,
          busyWindowMs: Number(
            process.env.LIVE_BUSY_WINDOW_MS || 6 * 3600 * 1000
          ),
          crossProviderExclusive: true,
        },
      },
    });

    return res.json({
      provider: session.provider,
      channel: {
        id: chosen._id,
        externalId: chosen.externalId,
        name: chosen.name,
      },
      live: {
        id: session.platformLiveId,
        server_url: session.serverUrl,
        stream_key: session.streamKey,
        secure_stream_url: session.secureStreamUrl,
        permalink_url: session.permalinkUrl,
      },
      overlay_url: overlayUrl,
      note: "Paste Server/Key vào OBS/encoder rồi Start Streaming.",
    });
  } catch (e) {
    return res.status(409).json({
      message: "No available channel",
      detail: e.detail || e.message,
    });
  }
};
