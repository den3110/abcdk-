// services/eventLivePresence.service.js
// Quản lý real-time viewer presence cho event live.
// Redis = state nhanh (ai đang xem), MongoDB = lịch sử phiên (duration, analytics).
import EventLivePresence from "../models/eventLivePresenceModel.js";
import User from "../models/userModel.js";

const EVENT_LIVE_VIEWERS_ROOM = "event-live:viewers";
const VIEWER_HEARTBEAT_TTL = 60; // giây — stale sau 60s không ping

// ───── Redis keys ─────
const ONLINE_SET = "event-live:online";
const socketKey = (sid) => `event-live:s2u:${sid}`;
const userSocketsKey = (uid) => `event-live:usocks:${uid}`;
const aliveKey = (sid) => `event-live:alive:${sid}`;
const peakKey = () => {
  const d = new Date(Date.now() + 7 * 3600 * 1000); // VN timezone offset
  return `event-live:peak:${d.toISOString().slice(0, 10)}`;
};

// ───── Lazy redis getter (tránh circular import) ─────
let _redis = null;
async function getRedis() {
  if (_redis) return _redis;
  try {
    const mod = await import("./presenceService.js");
    _redis = mod.presenceRedis || mod.default?.presenceRedis;
  } catch {
    /* presenceRedis chưa sẵn sàng */
  }
  if (!_redis) {
    // fallback: dùng redis client từ socket
    try {
      const { getRedisClient } = await import("../socket/index.js");
      _redis = getRedisClient?.();
    } catch {
      /* không có */
    }
  }
  return _redis;
}

// ───── Core functions ─────

export async function addEventLiveViewer({ userId, socketId, platform }) {
  const r = await getRedis();
  if (!r) return;
  const uid = String(userId);
  const sid = String(socketId);

  await r.hSet(socketKey(sid), {
    userId: uid,
    platform: platform || "unknown",
    joinedAt: Date.now().toString(),
  });
  await r.sAdd(userSocketsKey(uid), sid);
  await r.sAdd(ONLINE_SET, uid);
  await r.set(aliveKey(sid), "1", { EX: VIEWER_HEARTBEAT_TTL });

  // Peak tracking
  const total = await r.sCard(ONLINE_SET);
  const pk = peakKey();
  const currentPeak = Number(await r.get(pk)) || 0;
  if (total > currentPeak) {
    await r.set(pk, String(total), { EX: 48 * 3600 });
  }

  // MongoDB presence record
  try {
    await EventLivePresence.create({
      user: uid,
      socketId: sid,
      platform: platform || "unknown",
      joinedAt: new Date(),
      lastActiveAt: new Date(),
    });
  } catch (e) {
    console.error("[event-live-presence] create error:", e?.message);
  }
}

export async function removeEventLiveViewer({ userId, socketId }) {
  const r = await getRedis();
  if (!r) return;
  const uid = String(userId);
  const sid = String(socketId);

  await r.del(socketKey(sid)).catch(() => {});
  await r.del(aliveKey(sid)).catch(() => {});
  await r.sRem(userSocketsKey(uid), sid).catch(() => {});

  const remaining = await r.sCard(userSocketsKey(uid)).catch(() => 0);
  if (!remaining || remaining <= 0) {
    await r.sRem(ONLINE_SET, uid).catch(() => {});
    await r.del(userSocketsKey(uid)).catch(() => {});
  }

  // Close MongoDB presence record
  try {
    const session = await EventLivePresence.findOne({
      socketId: sid,
      leftAt: null,
    });
    if (session) {
      session.leftAt = new Date();
      session.lastActiveAt = new Date();
      session.durationSec = Math.round(
        (session.leftAt.getTime() - session.joinedAt.getTime()) / 1000,
      );
      await session.save();
    }
  } catch (e) {
    console.error("[event-live-presence] close error:", e?.message);
  }
}

export async function refreshEventLiveViewerHeartbeat(socketId) {
  const r = await getRedis();
  if (!r) return;
  await r.set(aliveKey(String(socketId)), "1", { EX: VIEWER_HEARTBEAT_TTL });

  // Cập nhật lastActiveAt trong MongoDB
  try {
    await EventLivePresence.updateOne(
      { socketId: String(socketId), leftAt: null },
      { $set: { lastActiveAt: new Date() } },
    );
  } catch {
    /* best effort */
  }
}

export async function getCurrentEventLiveViewers() {
  const r = await getRedis();
  if (!r) return { total: 0, viewers: [], peakToday: 0, ts: Date.now() };

  const userIds = await r.sMembers(ONLINE_SET).catch(() => []);
  const total = userIds.length;

  let viewers = [];
  if (total > 0) {
    viewers = await User.find({ _id: { $in: userIds } })
      .select("name fullName nickname nickName avatar")
      .lean();
  }

  const pk = peakKey();
  const peakToday = Number(await r.get(pk).catch(() => 0)) || total;

  return { total, viewers, peakToday, ts: Date.now() };
}

export async function emitEventLiveViewerSummary(io, to = EVENT_LIVE_VIEWERS_ROOM) {
  try {
    const data = await getCurrentEventLiveViewers();
    io.to(to).emit("event-live:viewers:update", data);
  } catch (e) {
    console.error("[event-live-presence] emitSummary error:", e?.message);
  }
}

// Dọn socket chết (gọi từ sweeper interval hiện có)
export async function sweepStaleEventLiveViewers() {
  const r = await getRedis();
  if (!r) return 0;
  let cleaned = 0;
  try {
    let cursor = "0";
    do {
      const res = await r.scan(cursor, {
        MATCH: "event-live:s2u:*",
        COUNT: 200,
      });
      cursor = String(res?.cursor ?? "0");
      for (const key of res.keys || []) {
        const sid = key.replace("event-live:s2u:", "");
        const ttl = await r.ttl(aliveKey(sid));
        if (ttl === -2) {
          // heartbeat expired
          const mapping = await r.hGetAll(socketKey(sid));
          if (mapping?.userId) {
            await removeEventLiveViewer({
              userId: mapping.userId,
              socketId: sid,
            });
            cleaned++;
          }
        }
      }
    } while (cursor !== "0");
  } catch (e) {
    console.error("[event-live-presence] sweep error:", e?.message);
  }
  return cleaned;
}
