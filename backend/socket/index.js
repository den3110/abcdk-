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
} from "./liveHandlers.js";
import Match from "../models/matchModel.js";
import { WHITELIST } from "../server.js";

export async function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: WHITELIST,
      credentials: true,
    },
  });

  // (optional) scale qua Redis adapter
  if (process.env.REDIS_URL) {
    try {
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await pub.connect();
      await sub.connect();
      io.adapter(createAdapter(pub, sub));
      console.log("✅ Redis adapter connected on port", process.env.REDIS_URL);
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
    }
  }

  // auth nhẹ: lấy user từ token (nếu có)
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");
      console.log("Socket auth token:", socket.handshake.headers.cookie);
    if (!token) {
      socket.user = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { _id: decoded.id, role: decoded.role };
      return next();
    } catch {
      // cho join xem như guest (spectator), chặn hành động referee phía dưới
      socket.user = null;
      return next();
    }
  });

  io.on("connection", (socket) => {
    // join room theo match
    socket.on("match:join", async ({ matchId }) => {
      if (!matchId) return;
      socket.join(matchId);
      const m = await Match.findById(matchId).populate(
        "pairA pairB referee previousA previousB nextMatch"
      );
      if (m) socket.emit("match:snapshot", toDTO(m));
    });

    const ensureReferee = () =>
      socket.user?.role === "referee" || socket.user?.role === "admin";

    // referee: start
    socket.on("match:start", async ({ matchId }) => {
      if (!ensureReferee()) return;
      await startMatch(matchId, socket.user?._id, io);
    });

    // referee: point
    socket.on("match:point", async ({ matchId, team, step = 1 }) => {
      if (!ensureReferee()) return;
      await addPoint(matchId, team, step, socket.user?._id, io);
    });

    // referee: undo
    socket.on("match:undo", async ({ matchId }) => {
      if (!ensureReferee()) return;
      await undoLast(matchId, socket.user?._id, io);
    });

    // referee: finish / forfeit
    socket.on("match:finish", async ({ matchId, winner, reason }) => {
      if (!ensureReferee()) return;
      await finishMatch(matchId, winner, reason, socket.user?._id, io);
    });

    socket.on(
      "match:forfeit",
      async ({ matchId, winner, reason = "forfeit" }) => {
        if (!ensureReferee()) return;
        await forfeitMatch(matchId, winner, reason, socket.user?._id, io);
      }
    );
  });

  return io;
}
