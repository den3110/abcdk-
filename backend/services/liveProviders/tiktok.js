// services/liveProviders/tiktok.js
import { LiveProvider } from "./base.js";
import LiveSession from "../../models/liveSessionModel.js";

async function isChannelBusyDB(channelId, windowMs = 6 * 3600 * 1000) {
  const since = new Date(Date.now() - windowMs);
  const existing = await LiveSession.exists({
    channelId,
    createdAt: { $gte: since },
    status: { $nin: ["ENDED", "CANCELED", "ERROR"] },
  });
  return !!existing;
}

export class TikTokProvider extends LiveProvider {
  static providerName = "tiktok";

  async getChannelLiveState(channelDoc) {
    const busy = await isChannelBusyDB(channelDoc._id);
    return { busy, raw: null };
  }

  async createLive({ channelDoc /*, title*/ }) {
    const ing = channelDoc?.meta?.manualIngest || {};
    if (!ing.serverUrl || !ing.streamKey) {
      throw new Error("TikTok channel missing manual RTMP ingest config");
    }
    return {
      platformLiveId: `${channelDoc.externalId}-${Date.now()}`,
      serverUrl: ing.serverUrl,
      streamKey: ing.streamKey,
      secureStreamUrl: null,
      permalinkUrl: null,
      raw: {},
    };
  }
}
