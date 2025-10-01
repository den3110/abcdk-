// services/presenceService.js
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const HEARTBEAT_TTL = +(process.env.PRESENCE_TTL || 30); // giây

const CLIENTS = ["web", "app", "admin", "referee"];

const normClient = (raw) => {
  try {
    const c = String(raw || "").toLowerCase();
    return CLIENTS.includes(c) ? c : "web";
  } catch (e) {
    console.error("[presence] normClient error:", e);
    return "web";
  }
};

// ===== Redis init (bọc try/catch) =====
export const presenceRedis = createClient({ url: REDIS_URL });
presenceRedis.on("error", (e) => console.error("[presence] redis error:", e));
try {
  await presenceRedis.connect();
  console.log("[presence] redis connected");
} catch (e) {
  console.error("[presence] redis connect failed:", e);
}

const r = presenceRedis;

export async function listOnlineUserIds() {
  try {
    return await presenceRedis.sMembers("presence:online");
  } catch (e) {
    console.error("[presence] listOnlineUserIds error:", e);
    return [];
  }
}

export async function getUserPresence(userId) {
  try {
    const [isMem, clientsHash, meta] = await Promise.all([
      presenceRedis.sIsMember("presence:online", String(userId)),
      presenceRedis.hGetAll(`presence:clients:${userId}`),
      presenceRedis.hGetAll(`presence:meta:${userId}`),
    ]);
    const byClient = {
      web: Number(clientsHash.web || 0) > 0,
      app: Number(clientsHash.app || 0) > 0,
      admin: Number(clientsHash.admin || 0) > 0,
      referee: Number(clientsHash.referee || 0) > 0,
    };
    return {
      userId: String(userId),
      online: isMem === 1 || isMem === true,
      byClient,
      lastSeen: meta?.lastSeen ? Number(meta.lastSeen) : null,
    };
  } catch (e) {
    console.error("[presence] getUserPresence error:", e, { userId });
    return {
      userId: String(userId),
      online: false,
      byClient: {},
      lastSeen: null,
    };
  }
}

/**
 * Keys:
 * presence:online                     -> SET userIds (unique users online)
 * presence:online:<client>            -> SET userIds theo client
 * presence:clients:<userId>           -> HASH { web: N, app: N, admin: N, referee: N }
 * presence:sockets:<userId>           -> SET socketIds
 * presence:socket2user:<socketId>     -> HASH { userId, client } (mapping ngược)
 * presence:alive:<socketId>           -> TTL key for heartbeat
 * presence:meta:<userId>              -> HASH { lastSeen }
 */

export async function addConnection({ userId, socketId, client }) {
  try {
    const c = normClient(client);
    await r.sAdd(`presence:sockets:${userId}`, socketId);
    await r.hSet(`presence:socket2user:${socketId}`, { userId, client: c });
    const n = await r.hIncrBy(`presence:clients:${userId}`, c, 1);
    await r.sAdd("presence:online", String(userId));
    if (n === 1) {
      await r.sAdd(`presence:online:${c}`, String(userId));
    }
    await r.hSet(`presence:meta:${userId}`, {
      lastSeen: Date.now().toString(),
    });
    // set nhịp sống ban đầu
    await refreshHeartbeat(socketId).catch((e) =>
      console.error("[presence] refreshHeartbeat (on connect) error:", e)
    );
  } catch (e) {
    console.error("[presence] addConnection error:", e, {
      userId,
      socketId,
      client,
    });
    throw e;
  }
}

export async function removeConnection({ userId, socketId, client }) {
  try {
    const c = normClient(client);
    await r.sRem(`presence:sockets:${userId}`, socketId).catch(() => {});
    // clean alive + mapping
    await Promise.all([
      r.del(`presence:alive:${socketId}`).catch(() => {}),
      r.del(`presence:socket2user:${socketId}`).catch(() => {}),
    ]);

    // giảm count client (có thể đã 0 nếu đã cleanup trước đó)
    let left = 0;
    try {
      left = await r.hIncrBy(`presence:clients:${userId}`, c, -1);
    } catch (e) {
      // nếu hash không tồn tại, coi như 0
      left = 0;
    }

    if (left <= 0) {
      await r.hDel(`presence:clients:${userId}`, c).catch(() => {});
      await r.sRem(`presence:online:${c}`, String(userId)).catch(() => {});
    }

    // nếu user không còn socket nào -> loại khỏi online
    const remainingSockets = await r
      .sCard(`presence:sockets:${userId}`)
      .catch(() => 0);
    if (!remainingSockets || remainingSockets <= 0) {
      await Promise.all([
        r.sRem("presence:online", String(userId)),
        r.del(`presence:sockets:${userId}`),
        r.del(`presence:clients:${userId}`),
      ]).catch(() => {});
    }
    // đặt lastSeen = now mỗi lần có biến động (an toàn cho cả offline)
    await presenceRedis
      .hSet(`presence:meta:${userId}`, { lastSeen: Date.now().toString() })
      .catch(() => {});
  } catch (e) {
    console.error("[presence] removeConnection error:", e, {
      userId,
      socketId,
      client,
    });
    throw e;
  }
}

export async function refreshHeartbeat(socketId, ttlSeconds = HEARTBEAT_TTL) {
  try {
    // Dùng SET EX thay vì EXPIRE để chắc chắn tồn tại với TTL
    await r.set(`presence:alive:${socketId}`, "1", { EX: ttlSeconds });
  } catch (e) {
    console.error("[presence] refreshHeartbeat error:", e, { socketId });
    throw e;
  }
}

export async function cleanupExpiredSocket(socketId) {
  try {
    const mapping = await presenceRedis.hGetAll(
      `presence:socket2user:${socketId}`
    );
    if (!mapping || !mapping.userId) {
      await presenceRedis.del(`presence:alive:${socketId}`).catch(() => {});
      await presenceRedis
        .del(`presence:socket2user:${socketId}`)
        .catch(() => {});
      return;
    }
    await presenceRedis
      .hSet(`presence:meta:${mapping.userId}`, {
        lastSeen: Date.now().toString(),
      })
      .catch(() => {});
    await removeConnection({
      userId: mapping.userId,
      socketId,
      client: mapping.client || "web",
    });
  } catch (e) {
    console.error("[presence] cleanupExpiredSocket error:", e, { socketId });
  }
}

/**
 * Quét các socket đã hết heartbeat (TTL mất) – dùng khi không bật keyspace notifications.
 * Cần cân nhắc tần suất gọi (ví dụ 30–60s).
 */
export async function sweepStaleSockets({ batch = 500 } = {}) {
  try {
    let cursor = "0";
    do {
      const res = await r.scan(cursor, {
        MATCH: "presence:socket2user:*",
        COUNT: batch,
      });
      cursor = res.cursor;
      const keys = res.keys || [];
      if (keys.length) {
        const socketIds = keys.map((k) =>
          k.replace("presence:socket2user:", "")
        );
        for (const sid of socketIds) {
          try {
            const ttl = await r.ttl(`presence:alive:${sid}`);
            if (ttl === -2 || ttl === -1) {
              // -2: không tồn tại, -1: tồn tại nhưng không có TTL (coi như lỗi) -> cleanup
              await cleanupExpiredSocket(sid);
            }
          } catch (e) {
            console.error("[presence] sweep ttl error:", e, { sid });
          }
        }
      }
    } while (cursor !== "0");
  } catch (e) {
    console.error("[presence] sweepStaleSockets error:", e);
  }
}

export async function getSummary() {
  try {
    const total = await r.sCard("presence:online");
    const [web, app, admin, referee] = await Promise.all(
      CLIENTS.map((c) => r.sCard(`presence:online:${c}`))
    );
    return {
      total,
      byClient: { web, app, admin, referee },
      ts: Date.now(),
    };
  } catch (e) {
    console.error("[presence] getSummary error:", e);
    // trả về safe fallback
    return {
      total: 0,
      byClient: { web: 0, app: 0, admin: 0, referee: 0 },
      ts: Date.now(),
    };
  }
}

export async function emitSummary(io, to = "presence:watchers") {
  try {
    const summary = await getSummary();
    io.to(to).emit("presence:update", summary);
  } catch (e) {
    console.error("[presence] emitSummary error:", e);
  }
}
