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

// ❗️ KHÔNG import từ server.js để tránh circular
export function initSocket(
  httpServer,
  { whitelist = [], path = "/socket.io" } = {}
) {
  const io = new Server(httpServer, {
    path,
    cors: {
      origin: whitelist,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Kết nối Redis adapter *không làm hàm initSocket trở thành async*
  (async () => {
    if (!process.env.REDIS_URL) return;
    try {
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await pub.connect();
      await sub.connect();
      io.adapter(createAdapter(pub, sub));
      console.log("✅ Redis adapter connected:", process.env.REDIS_URL);
    } catch (error) {
      console.error("❌ Redis connection failed:", error);
    }
  })();

  // auth nhẹ: lấy user từ token (nếu có)
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token?.replace("Bearer ", "") ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");
    try {
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = { _id: decoded.userId, role: decoded.role };
      }
    } catch {
      socket.user = null; // guest
    }
    next();
  });

  io.on("connection", (socket) => {
    // join room theo match (dùng prefix để thống nhất với BE emit)
    socket.on("match:join", async ({ matchId }) => {
      if (!matchId) return;
      const room = `match:${matchId}`;
      socket.join(room);
      // query giống hệt shape tham chiếu và trả về plain object
      const m = await Match.findById(matchId)
        .populate({ path: "pairA", select: "player1 player2" })
        .populate({ path: "pairB", select: "player1 player2" })
        .populate({ path: "referee", select: "name fullName" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        // chỉ cần _id để biết còn trận sau không
        .populate({ path: "nextMatch", select: "_id" })
        // ⚠️ Nếu FE cần eventType cho label:
        // .populate({ path: "tournament", select: "eventType" })
        .lean();
      if (m) socket.emit("match:snapshot", toDTO(m));
    });
    socket.on("overlay:join", ({ matchId }) => {
      if (!matchId) return;
      socket.join(`match:${String(matchId)}`);
    });

    const ensureReferee = () =>
      socket.user?.role === "referee" || socket.user?.role === "admin";

    socket.on("match:start", async ({ matchId }) => {
      if (!ensureReferee()) return;
      await startMatch(matchId, socket.user?._id, io);
    });

    socket.on("match:point", async ({ matchId, team, step = 1 }) => {
      if (!ensureReferee()) return;
      await addPoint(matchId, team, step, socket.user?._id, io);
    });

    socket.on("match:undo", async ({ matchId }) => {
      if (!ensureReferee()) return;
      await undoLast(matchId, socket.user?._id, io);
    });

    socket.on("match:finish", async ({ matchId, winner, reason }) => {
      if (!ensureReferee()) return;
      await finishMatch(matchId, winner, reason, socket.user?._id, io);
    });

    socket.on("serve:set", async ({ matchId, side, server }) => {
      const ok =
        socket.user?.role === "referee" || socket.user?.role === "admin";
      if (!ok) return;
      await setServe(matchId, side, server, socket.user?._id, io);
    });

    socket.on(
      "match:forfeit",
      async ({ matchId, winner, reason = "forfeit" }) => {
        if (!ensureReferee()) return;
        await forfeitMatch(matchId, winner, reason, socket.user?._id, io);
      }
    );

    socket.on("score:inc", async (data) => {
      const { matchId, side, delta } = data || {};

      // TODO: xử lý cập nhật điểm ở đây (gọi service hoặc mutation DB)
      // ví dụ:
      // await MatchService.incrementScore(matchId, side, delta);
      const m = await Match.findById(matchId).populate(
        "pairA pairB referee previousA previousB nextMatch tournament bracket"
      );
      // Gửi thông báo cho tất cả client khác cùng phòng match
      if (m) io.to(`match:${matchId}`).emit("score:updated", toDTO(m));
    });

    // ... trong io.on('connection', (socket) => { ... })
    socket.on("draw:join", ({ bracketId }) => {
      if (!bracketId) return;
      socket.join(`draw:${String(bracketId)}`);
    });

    // (tuỳ chọn) rời phòng
    socket.on("draw:leave", ({ bracketId }) => {
      if (!bracketId) return;
      socket.leave(`draw:${String(bracketId)}`);
    });
    // ✅ tương thích FE cũ
    socket.on("draw:subscribe", ({ bracketId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
    });
    socket.on("draw:unsubscribe", ({ bracketId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
    });

    // ✅ hỗ trợ join theo bracketId hoặc drawId
    socket.on("draw:join", ({ bracketId, drawId }) => {
      if (bracketId) socket.join(`draw:${String(bracketId)}`);
      if (drawId) socket.join(`drawsess:${String(drawId)}`);
    });
    socket.on("draw:leave", ({ bracketId, drawId }) => {
      if (bracketId) socket.leave(`draw:${String(bracketId)}`);
      if (drawId) socket.leave(`drawsess:${String(drawId)}`);
    });
  });

  return io; // ✅ trả instance ngay lập tức
}
