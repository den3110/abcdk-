// services/tokenManagers/fbPageToken.manager.js
import Channel from "../../models/channelModel.js";
import Credential from "../../models/credentialModel.js";
import { decryptToken } from "../secret.service.js";
import { getPageViaFields, debugToken } from "../facebookApi.js";

const THRESH_HOURS = Number(process.env.REFRESH_THRESHOLD_HOURS || "72");
const THRESH_MS = THRESH_HOURS * 3600 * 1000;
const isNearExpiry = (d) =>
  d ? new Date(d).getTime() - Date.now() <= THRESH_MS : false;

/**
 * Get valid PAGE access token for a Facebook Page (Channel):
 * 1) Use cached token in Channel.meta if still valid.
 * 2) Try channel.credential → other FB credentials of same owner → all FB credentials.
 * 3) Cache pageToken + expiry back to Channel.meta.
 */
export async function getFbPageTokenSmart(channelDoc) {
  if (!channelDoc) throw new Error("channelDoc required");
  const pageId = String(channelDoc.externalId);

  // 1) cached
  const cached = channelDoc?.meta?.pageToken;
  const cachedExp = channelDoc?.meta?.pageTokenExpiresAt
    ? new Date(channelDoc.meta.pageTokenExpiresAt)
    : null;
  if (cached && cachedExp && !isNearExpiry(cachedExp)) return cached;

  // 2) candidate credentials
  const credPrimary = channelDoc.credentialId
    ? await Credential.findById(channelDoc.credentialId)
    : null;
  const qSameOwner = channelDoc.ownerKey
    ? { provider: "facebook", ownerKey: channelDoc.ownerKey }
    : { provider: "facebook" };
  const allCreds = await Credential.find(qSameOwner).lean();

  const seen = new Set();
  const ordered = [];
  if (credPrimary) {
    ordered.push(credPrimary);
    seen.add(String(credPrimary._id));
  }
  for (const c of allCreds) if (!seen.has(String(c._id))) ordered.push(c);

  // 3) try each long user token
  for (const cred of ordered) {
    const lut = decryptToken(cred.accessToken);
    let dbg;
    try {
      dbg = await debugToken(lut);
    } catch {
      dbg = { isValid: false };
    }
    if (!dbg.isValid || isNearExpiry(dbg.expiresAt)) continue;

    try {
      const page = await getPageViaFields(lut, pageId);
      if (!page?.access_token) continue;

      let pDbg = null;
      try {
        pDbg = await debugToken(page.access_token);
      } catch {}
      await Channel.updateOne(
        { _id: channelDoc._id },
        {
          $set: {
            "meta.pageToken": page.access_token,
            "meta.pageTokenExpiresAt": pDbg?.expiresAt || null,
            lastCheckedAt: new Date(),
          },
        }
      );
      return page.access_token;
    } catch {
      continue; // thử cred khác
    }
  }

  throw new Error(
    `Cannot fetch page access_token for ${pageId} from any credential`
  );
}
