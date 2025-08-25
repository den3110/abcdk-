// socket/index.js
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";

import {
  startMatch,
  addPoint,
  undoLast,
  finishMatch,
  forfeitMatch,
  toDTO,
  setServe,
} from "./liveHandlers.js";

import Match from "../models/matchModel.js";
import Court from "../models/courtModel.js";

import {
  assignNextToCourt,
  onMatchFinished,
  buildGroupsRotationQueue,
  fillIdleCourtsForCluster,
} from "../services/courtQueueService.js";

/**
 * Khởi tạo Socket.IO server
 * @param {import('http').Server} httpServer
 * @param {{ whitelist?: string[], path?: string }} opts
 * @returns {Server}
 */
export function initSocket(
  httpServer,
  { whitelist = [], path = "/socket.io" } = {}
) {
  const io = new Server(httpServer, {
    path,
    cors: { origin: whitelist, credentials: true },
    transports: ["websocket", "polling"],
  });

  // Optional Redis adapter (clustered scale-out)
  (async () => {
    if (!process.env.REDIS_URL) return;
    try {
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await pub.connect();
      await sub.connect();
      io.adapter(createAdapter(pub, sub));
      console.log("✅ Redis adapter connected:", process.env.REDIS_URL);
    } catch (err) {
      console.error("❌ Redis connection failed:", err);
    }
  })();

  // Lightweight auth: put user info on socket if token is valid
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token?.replace("Bearer ", "") ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = { _id: decoded.userId, role: decoded.role };
      } else {
        socket.user = null;
      }
      next();
    } catch {
      socket.user = null;
      next();
    }
  });

  // Helpers
  const ensureReferee = (socket) =>
    socket.user?.role === "referee" || socket.user?.role === "admin";
  const ensureAdmin = (socket) => socket.user?.role === "admin";

  // Resolve cluster-key: ưu tiên bracketId, fallback cluster string
  const resolveClusterKey = (bracket, cluster = "Main") =>
    bracket ? String(bracket) : cluster ?? "Main";

  // Scheduler state broadcaster (ưu tiên bracket)
  const broadcastState = async (
    tournamentId,
    { bracket, cluster = "Main" } = {}
  ) => {
    const clusterKey = resolveClusterKey(bracket, cluster);

    const courtsQuery = bracket
      ? { tournament: tournamentId, bracket }
      : { tournament: tournamentId, cluster: clusterKey };

    const [courts, matches] = await Promise.all([
      Court.find(courtsQuery).sort({ order: 1 }).lean(),
      Match.find({
        tournament: tournamentId,
        courtCluster: clusterKey,
        status: { $in: ["queued", "assigned", "live"] },
      })
        .select(
          "_id status queueOrder court courtLabel participants pool rrRound round order"
        )
        .sort({ status: 1, queueOrder: 1 })
        .lean(),
    ]);

    io.to(`tour:${tournamentId}:${clusterKey}`).emit("scheduler:state", {
      courts,
      matches,
    });
  };

  io.on("connection", (socket) => {
    // ========= MATCH ROOMS =========
    socket.on("match:join", async ({ matchId }) => {
      if (!matchId) return;
      socket.join(`match:${matchId}`);

      const m = await Match.findById(matchId)
        .populate({ path: "pairA", select: "player1 player2" })
        .populate({ path: "pairB", select: "player1 player2" })
        .populate({ path: "referee", select: "name fullName nickname" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({ path: "bracket", select: "type name order overlay" })
        .lean();

      if (m) socket.emit("match:snapshot", toDTO(m));
    });

    socket.on("overlay:join", ({ matchId }) => {
      if (!matchId) return;
      socket.join(`match:${String(matchId)}`);
    });

    // ========= LIVE CONTROLS (referee/admin) =========
    socket.on("match:start", async ({ matchId }) => {
      if (!ensureReferee(socket)) return;
      await startMatch(matchId, socket.user?._id, io);
    });

    socket.on("match:point", async ({ matchId, team, step = 1 }) => {
      if (!ensureReferee(socket)) return;
      await addPoint(matchId, team, step, socket.user?._id, io);
    });

    socket.on("match:undo", async ({ matchId }) => {
      if (!ensureReferee(socket)) return;
      await undoLast(matchId, socket.user?._id, io);
    });

    socket.on("match:finish", async ({ matchId, winner, reason }) => {
      if (!ensureReferee(socket)) return;
      await finishMatch(matchId, winner, reason, socket.user?._id, io);
      try {
        await onMatchFinished({ matchId });
      } catch (e) {
        console.error("[scheduler] onMatchFinished error:", e?.message);
      }
    });

    socket.on(
      "match:forfeit",
      async ({ matchId, winner, reason = "forfeit" }) => {
        if (!ensureReferee(socket)) return;
        await forfeitMatch(matchId, winner, reason, socket.user?._id, io);
        try {
          await onMatchFinished({ matchId });
        } catch (e) {
          console.error(
            "[scheduler] onMatchFinished (forfeit) error:",
            e?.message
          );
        }
      }
    );

    socket.on("serve:set", async ({ matchId, side, server }) => {
      if (!ensureReferee(socket)) return;
      await setServe(matchId, side, server, socket.user?._id, io);
    });

    // (Giữ compatibility nếu FE còn dùng)
    socket.on("score:inc", async ({ matchId /*, side, delta*/ }) => {
      const m = await Match.findById(matchId).populate(
        "pairA pairB referee previousA previousB nextMatch tournament bracket"
      );
      if (m) io.to(`match:${matchId}`).emit("score:updated", toDTO(m));
    });

    // ========= SCHEDULER (Tournament + Bracket/Cluster) =========
    socket.on(
      "scheduler:join",
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        socket.join(`tour:${tournamentId}:${clusterKey}`);
        broadcastState(tournamentId, { bracket, cluster });
      }
    );

    socket.on(
      "scheduler:leave",
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        socket.leave(`tour:${tournamentId}:${clusterKey}`);
      }
    );

    socket.on(
      "scheduler:requestState",
      ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!tournamentId) return;
        broadcastState(tournamentId, { bracket, cluster });
      }
    );

    socket.on(
      "scheduler:assignNext",
      async ({ tournamentId, courtId, bracket, cluster = "Main" }) => {
        if (!ensureAdmin(socket)) return;
        if (!tournamentId || !courtId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        try {
          await assignNextToCourt({
            tournamentId,
            courtId,
            cluster: clusterKey,
          });
        } catch (e) {
          console.error("[scheduler] assignNext error:", e?.message);
        }
        broadcastState(tournamentId, { bracket, cluster });
      }
    );

    // Cho phép build queue qua socket (admin)
    socket.on(
      "scheduler:buildQueue",
      async ({ tournamentId, bracket, cluster = "Main" }) => {
        if (!ensureAdmin(socket)) return;
        if (!tournamentId) return;
        const clusterKey = resolveClusterKey(bracket, cluster);
        try {
          await buildGroupsRotationQueue({
            tournamentId,
            bracket,
            cluster: clusterKey,
          });
          await fillIdleCourtsForCluster({ tournamentId, cluster: clusterKey });
        } catch (e) {
          console.error("[scheduler] buildQueue error:", e?.message);
        }
        broadcastState(tournamentId, { bracket, cluster });
      }
    );

    // ========= DRAW rooms (giữ tương thích cũ) =========
    socket.on("draw:join", ({ bracketId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
    });
    socket.on("draw:leave", ({ bracketId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
    });
    socket.on("draw:subscribe", ({ bracketId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
    });
    socket.on("draw:unsubscribe", ({ bracketId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
    });
  });

  return io;
}
