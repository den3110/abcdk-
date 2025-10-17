// services/liveProviders/youtube.js
import { LiveProvider } from "./base.js";
import { google } from "googleapis";
import { decryptToken } from "../secret.service.js";
import { getCfgStr } from "../config.service.js";

async function buildOAuth2(cred) {
  const clientId = await getCfgStr("GOOGLE_CLIENT_ID", "");
  const clientSecret = await getCfgStr("GOOGLE_CLIENT_SECRET", "");
  const redirectUri = await getCfgStr("GOOGLE_REDIRECT_URI", "");
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  oauth2.setCredentials({
    access_token: cred?.accessToken
      ? decryptToken(cred.accessToken)
      : undefined,
    refresh_token: cred?.refreshToken
      ? decryptToken(cred.refreshToken)
      : undefined,
    expiry_date: cred?.expiresAt
      ? new Date(cred.expiresAt).getTime()
      : undefined,
  });

  return oauth2;
}

async function getYT(cred) {
  const auth = await buildOAuth2(cred);
  return google.youtube({ version: "v3", auth });
}

export class YouTubeProvider extends LiveProvider {
  static providerName = "youtube";

  async getChannelLiveState(/* channelDoc */) {
    const yt = await getYT(this.cred);
    const { data } = await yt.liveBroadcasts.list({
      part: ["id", "snippet", "status"],
      broadcastStatus: "active",
      maxResults: 50,
    });
    const busy = Array.isArray(data?.items) && data.items.length > 0;
    return { busy, raw: data };
  }

  async createLive({ channelDoc, title, description, privacy = "public" }) {
    const yt = await getYT(this.cred);

    // 1) Tạo stream (reusable)
    const sRes = await yt.liveStreams.insert({
      part: ["snippet", "cdn", "contentDetails"],
      requestBody: {
        snippet: { title: `${title} — stream` },
        cdn: {
          ingestionType: "rtmp",
          resolution: "variable",
          frameRate: "variable",
        },
        contentDetails: { isReusable: true },
      },
    });
    const stream = sRes.data;
    const ingest = stream?.cdn?.ingestionInfo || {};
    const serverUrl = ingest?.ingestionAddress || null;
    const streamKey = ingest?.streamName || null;

    // 2) Tạo broadcast
    const bRes = await yt.liveBroadcasts.insert({
      part: ["snippet", "status", "contentDetails"],
      requestBody: {
        snippet: {
          title,
          description,
          scheduledStartTime: new Date().toISOString(),
        },
        status: { privacyStatus: privacy },
        contentDetails: { enableAutoStart: false, enableAutoStop: false },
      },
    });
    const broadcast = bRes.data;

    // 3) Bind stream vào broadcast
    await yt.liveBroadcasts.bind({
      id: broadcast.id,
      part: ["id", "snippet", "contentDetails", "status"],
      streamId: stream.id,
    });

    return {
      platformLiveId: broadcast.id,
      serverUrl,
      streamKey,
      secureStreamUrl: null,
      permalinkUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
      raw: { broadcast, stream },
    };
  }
}
