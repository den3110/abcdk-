// services/liveProviders/facebook.js
import { LiveProvider } from "./base.js";
import { fbCreateLiveOnPage } from "../facebookLive.service.js";
import { getPageLiveState } from "../facebookApi.js";
import { getFbPageTokenSmart } from "../tokenManagers/fbPageToken.manager.js";

export class FacebookProvider extends LiveProvider {
  static providerName = "facebook";

  async getChannelLiveState(channelDoc) {
    const pageId = channelDoc.externalId;
    const pageAccessToken = await getFbPageTokenSmart(channelDoc);
    const state = await getPageLiveState({ pageId, pageAccessToken });
    const busy = state.liveNow.length + state.prepared.length > 0;
    return { busy, raw: state };
  }

  async createLive({ channelDoc, title, description }) {
    const pageId = channelDoc.externalId;
    const pageAccessToken = await getFbPageTokenSmart(channelDoc);

    const live = await fbCreateLiveOnPage({
      pageId,
      pageAccessToken,
      title,
      description,
      status: "LIVE_NOW",
    });

    const secure = live?.secure_stream_url || "";
    let serverUrl = secure,
      streamKey = "";
    try {
      const u = new URL(secure);
      const parts = u.pathname.split("/").filter(Boolean);
      const keyPart = parts.pop() || "";
      serverUrl = `${u.protocol}//${u.host}/${parts.join("/")}/`;
      streamKey = `${keyPart}${u.search || ""}`;
    } catch {}

    return {
      platformLiveId: live.liveVideoId || live.id,
      serverUrl,
      streamKey,
      secureStreamUrl: secure,
      permalinkUrl: live.permalink_url?.startsWith("http")
        ? live.permalink_url
        : "https://facebook.com" + (live.permalink_url || ""),
      raw: live,
    };
  }
}
