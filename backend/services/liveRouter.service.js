// services/liveRouter.service.js
import Credential from "../models/credentialModel.js";
import Channel from "../models/channelModel.js";
import LiveSession from "../models/liveSessionModel.js";
import { PROVIDERS } from "./liveProviders/index.js";
import { withRetry } from "./retry.service.js";
import IORedis from "ioredis";
import Redlock from "redlock";
import { getCfgInt } from "./config.service.js";

const redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL) : null;
const redlock = redis ? new Redlock([redis], { retryCount: 0 }) : null;

function isBusyError(err) {
  const m = (
    err?.response?.data?.error?.message ||
    err?.message ||
    ""
  ).toLowerCase();
  return /only one live|already has a live|another live video|is currently live|broadcast.*exists|throttle|rate limit/.test(
    m
  );
}

async function isChannelBusyDB(channelId, windowMs = 6 * 3600 * 1000) {
  const since = new Date(Date.now() - windowMs);
  const existing = await LiveSession.exists({
    channelId,
    createdAt: { $gte: since },
    status: { $nin: ["ENDED", "CANCELED", "ERROR"] },
  });
  return !!existing;
}

export async function pickCandidateChannels({ match, providersWanted }) {
  // Có thể refine theo tournament ở đây (vd: match.tournament.meta.preferences)
  const q = { provider: { $in: providersWanted }, eligibleLive: true };
  const all = await Channel.find(q).populate("credentialId").lean();
  // Có thể sort thêm theo createdAt/name nếu muốn
  return all;
}

async function getAdapter(cred) {
  const Provider = PROVIDERS[cred.provider];
  if (!Provider) throw new Error(`Unsupported provider ${cred.provider}`);
  return new Provider(cred);
}

async function isOwnerBusyAcrossProvider(
  ownerKey,
  channelsOfOwner,
  { windowMs, crossProviderExclusive }
) {
  if (!crossProviderExclusive) {
    for (const ch of channelsOfOwner) {
      if (await isChannelBusyDB(ch._id, windowMs))
        return { busy: true, channelId: ch._id };
    }
    return { busy: false };
  }
  const since = new Date(Date.now() - windowMs);
  const chIds = channelsOfOwner.map((c) => c._id);
  const exists = await LiveSession.exists({
    channelId: { $in: chIds },
    createdAt: { $gte: since },
    status: { $nin: ["ENDED", "CANCELED", "ERROR"] },
  });
  return { busy: !!exists };
}

/**
 * Tạo live đa nền tảng, skip cả owner nếu có kênh bận.
 * Trả về { session, chosen } hoặc throw { detail }.
 */
export async function createLiveForMatchMulti({
  match,
  providersWanted = ["facebook"],
  title,
  description,
  policy,
}) {
  const busyWindowMsCfg = await getCfgInt(
    "LIVE_BUSY_WINDOW_MS",
    6 * 3600 * 1000
  );
  const constraints = {
    maxConcurrentPerOwner: policy?.constraints?.maxConcurrentPerOwner ?? 1,
    busyWindowMs: busyWindowMsCfg,
    crossProviderExclusive: !!policy?.constraints?.crossProviderExclusive,
  };

  const lockKey = redis ? `lock:live:create:${match._id}` : null;
  const lock = redlock
    ? await redlock.acquire([lockKey], 10000).catch(() => null)
    : null;

  try {
    const candidates = await pickCandidateChannels({ match, providersWanted });

    // group theo ownerKey giữ thứ tự xuất hiện
    const byOwner = new Map();
    for (const ch of candidates) {
      const key = ch.ownerKey || "__null__";
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key).push(ch);
    }

    const tried = [];
    const busyOwners = [];
    const errors = [];

    for (const [owner, channels] of byOwner.entries()) {
      // 1) Busy theo DB (cross provider nếu bật)
      const ownerDbBusy = await isOwnerBusyAcrossProvider(
        owner,
        channels,
        constraints
      );
      if (ownerDbBusy.busy) {
        busyOwners.push({ owner, reason: "db-session" });
        continue;
      }

      // 2) Preflight theo provider: nếu bất kỳ kênh báo bận → skip owner
      let ownerBusyByGraph = false;
      for (const ch of channels) {
        try {
          const cred = ch.credentialId?._id
            ? ch.credentialId
            : await Credential.findById(ch.credentialId);
          const adapter = await getAdapter(cred);
          const st = await withRetry(() => adapter.getChannelLiveState(ch), {
            retries: 1,
          });
          if (st.busy) {
            ownerBusyByGraph = true;
            break;
          }
        } catch {
          // preflight lỗi → bỏ qua, vẫn cho phép thử create
        }
      }
      if (ownerBusyByGraph) {
        busyOwners.push({ owner, reason: "graph" });
        continue;
      }

      // 3) Thử tạo theo từng channel của owner (giới hạn concurrent per owner)
      let createdCount = 0;
      for (const ch of channels) {
        if (createdCount >= constraints.maxConcurrentPerOwner) break;
        tried.push({ provider: ch.provider, externalId: ch.externalId });

        // DB busy (race) → bỏ qua
        if (await isChannelBusyDB(ch._id, constraints.busyWindowMs)) continue;

        try {
          const cred = ch.credentialId?._id
            ? ch.credentialId
            : await Credential.findById(ch.credentialId);
          const adapter = await getAdapter(cred);

          const live = await withRetry(
            () => adapter.createLive({ channelDoc: ch, title, description }),
            { retries: 2, baseMs: 400 }
          );

          // Persist session
          const session = await LiveSession.create({
            provider: ch.provider,
            channelId: ch._id,
            platformLiveId: live.platformLiveId,
            status: "CREATED",
            serverUrl: live.serverUrl,
            streamKey: live.streamKey,
            secureStreamUrl: live.secureStreamUrl,
            permalinkUrl: live.permalinkUrl,
            matchId: match._id,
            logs: [`created ${new Date().toISOString()}`],
          });

          createdCount += 1;
          // Nếu chỉ cần 1 output → trả về luôn
          return { session, chosen: ch };
        } catch (e) {
          if (isBusyError(e)) {
            // một kênh bận → skip cả owner theo yêu cầu
            busyOwners.push({ owner, reason: "create-busy" });
            break;
          }
          errors.push({
            channel: { provider: ch.provider, externalId: ch.externalId },
            message: e?.response?.data?.error?.message || e.message,
          });
          continue; // thử kênh khác cùng owner
        }
      }
      // chưa tạo được cho owner này → thử owner kế
    }

    const detail = { tried, busyOwners, errors };
    const err = new Error("No available channel");
    err.detail = detail;
    throw err;
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
}
