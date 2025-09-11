// socket/index.js
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
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

  const isObjectIdString = (s) => /^[a-f\d]{24}$/i.test(String(s || ""));

  const ensureReferee = (socket) =>
    socket.user?.role === "referee" || socket.user?.role === "admin";
  const ensureAdmin = (socket) => socket.user?.role === "admin";

  // Resolve cluster-key: ưu tiên bracketId, fallback cluster string
  const resolveClusterKey = (bracket, cluster = "Main") =>
    bracket ? String(bracket) : cluster ?? "Main";

  const nameOfPerson = (p) =>
    (p?.fullName || p?.nickName || p?.name || p?.displayName || "").trim();

  const nameOfPair = (pair) => {
    if (!pair) return "";
    if (pair.displayName || pair.name) return pair.displayName || pair.name;
    const n1 = nameOfPerson(pair.player1);
    const n2 = nameOfPerson(pair.player2);
    return [n1, n2].filter(Boolean).join(" & ");
  };

  // Đổi nhãn hiển thị cho vòng bảng: ...#R{round}#... -> ...#B{round}#...
  const displayLabelKey = (m) => {
    if (!m?.labelKey) return "";
    const isGroup =
      m.format === "group" || m.type === "group" || !!m.pool?.name;
    return isGroup ? m.labelKey.replace(/#R(\d+)/, "#B$1") : m.labelKey;
  };

  // Scheduler state broadcaster (ưu tiên bracket)
  // ---------------- Broadcaster (ĐÃ SỬA) ----------------
  const broadcastState = async (
    tournamentId,
    { bracket, cluster = "Main" } = {}
  ) => {
    const clusterKey = resolveClusterKey(bracket, cluster);

    // 1) Sân theo bracket/cluster
    const courtsQuery = bracket
      ? { tournament: tournamentId, bracket }
      : { tournament: tournamentId, cluster: clusterKey };
    const courts = await Court.find(courtsQuery).sort({ order: 1 }).lean();

    // 2) Id các trận đang nằm trên sân để đảm bảo include
    const currentIds = courts
      .map((c) => c.currentMatch)
      .filter(Boolean)
      .map((x) => String(x));

    // 3) Trận cần cho điều phối
    const baseMatchFilter = {
      tournament: tournamentId,
      status: { $in: ["queued", "assigned", "live"] },
      ...(bracket ? { bracket } : { courtCluster: clusterKey }),
    };

    const MATCH_BASE_SELECT =
      "_id tournament bracket format type status queueOrder " +
      "court courtLabel pool rrRound round order code labelKey " +
      "scheduledAt startedAt finishedAt";

    let matches = await Match.find(baseMatchFilter)
      .select(MATCH_BASE_SELECT)
      .populate({
        path: "pairA",
        select:
          "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
      })
      .populate({
        path: "pairB",
        select:
          "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
      })
      .sort({ status: 1, queueOrder: 1 })
      .lean();

    // 4) Bảo đảm include mọi currentMatch
    const missingIds = currentIds.filter(
      (id) => !matches.some((m) => String(m._id) === id)
    );
    if (missingIds.length) {
      const extra = await Match.find({ _id: { $in: missingIds } })
        .select(MATCH_BASE_SELECT)
        .populate({
          path: "pairA",
          select:
            "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
        })
        .populate({
          path: "pairB",
          select:
            "displayName name player1.fullName player1.nickName player2.fullName player2.nickName",
        })
        .lean();
      matches = matches.concat(extra);
    }

    // 5) Thu gọn để FE bơm thẳng
    const matchesLite = matches.map((m) => ({
      _id: m._id,
      status: m.status,
      queueOrder: m.queueOrder,
      court: m.court,
      courtLabel: m.courtLabel,
      pool: m.pool, // { id, name }
      rrRound: m.rrRound,
      round: m.round,
      order: m.order,
      code: m.code,
      labelKey: m.labelKey,
      labelKeyDisplay: displayLabelKey(m), // 👈 thêm nhãn hiển thị B cho vòng bảng
      type: m.type,
      format: m.format,
      scheduledAt: m.scheduledAt,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
      pairAName: nameOfPair(m.pairA),
      pairBName: nameOfPair(m.pairB),
    }));

    const matchMap = new Map(matchesLite.map((m) => [String(m._id), m]));

    // 6) Gắn info gọn vào từng sân
    const courtsWithCurrent = courts.map((c) => {
      const m = matchMap.get(String(c.currentMatch));
      return {
        ...c,
        currentMatchObj: m || null,
        currentMatchCode: m?.labelKeyDisplay || m?.labelKey || m?.code || null,
        currentMatchTeams: m ? { A: m.pairAName, B: m.pairBName } : null,
      };
    });

    // 7) Emit
    io.to(`tour:${tournamentId}:${clusterKey}`).emit("scheduler:state", {
      courts: courtsWithCurrent,
      matches: matchesLite,
    });
  };

  io.on("connection", (socket) => {
    // ========= MATCH ROOMS =========
    socket.on("match:join", async ({ matchId }) => {
      if (!matchId) return;
      socket.join(`match:${matchId}`);

      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({ path: "referee", select: "name fullName nickname" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({ path: "liveBy", select: "name nickname" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({ path: "bracket", select: "type name order overlay" })
        .lean();

      if (!m) return;

      // Helper: lấy nickname ưu tiên player.nickname/nickName;
      // nếu thiếu HOẶC chuỗi rỗng => fallback sang user.nickname/user.nickName.
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        // (tuỳ chọn) giảm payload: xoá user nếu không cần về FE
        // if (p.user) delete p.user;
        return p;
      };

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      socket.emit("match:snapshot", toDTO(m));
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
      // 👇 phát lại state cho cụm/bracket chứa trận
      try {
        const m = await Match.findById(matchId)
          .select("tournament bracket courtCluster")
          .lean();
        if (m)
          await broadcastState(String(m.tournament), {
            bracket: m.bracket,
            cluster: m.courtCluster,
          });
      } catch (e) {
        console.error("[scheduler] broadcast after finish error:", e?.message);
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
    socket.on("match:started", async ({ matchId }) => {
      if (!matchId) return;

      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        // referee giờ là mảng — populate bình thường
        .populate({
          path: "referee",
          select: "name nickname",
        })
        // lấy luôn người đang điều khiển live
        .populate({ path: "liveBy", select: "name nickname" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({ path: "bracket", select: "type name order overlay" })
        .lean();

      if (!m) return;

      // Helper: ưu tiên player.nickname/nickName; nếu thiếu HOẶC rỗng -> fallback user.nickname/user.nickName
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        // Tuỳ chọn: không cần mang user về FE
        // if (p.user) delete p.user;
        return p;
      };

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      io.to(`match:${matchId}`).emit("match:snapshot", toDTO(m));
    });
    // (Giữ compatibility nếu FE còn dùng)
    socket.on("score:inc", async ({ matchId /*, side, delta*/ }) => {
      if (!matchId) return;

      const m = await Match.findById(matchId)
        .populate({
          path: "pairA",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({
          path: "pairB",
          select: "player1 player2 seed label teamName",
          populate: [
            {
              path: "player1",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
            {
              path: "player2",
              select: "nickname nickName user",
              populate: { path: "user", select: "nickname nickName" },
            },
          ],
        })
        .populate({ path: "referee", select: "name fullName nickname" })
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "nextMatch", select: "_id" })
        .populate({ path: "liveBy", select: "name nickname" })
        .populate({
          path: "tournament",
          select: "name image eventType overlay",
        })
        .populate({ path: "bracket", select: "type name order overlay" })
        .lean();

      if (!m) return;

      // Helper: ưu tiên player.nickname/nickName; nếu thiếu HOẶC rỗng -> fallback user.nickname/user.nickName
      const fillNick = (p) => {
        if (!p) return p;
        const pick = (v) => (v && String(v).trim()) || "";
        const primary = pick(p.nickname) || pick(p.nickName);
        const fromUser = pick(p.user?.nickname) || pick(p.user?.nickName);
        const n = primary || fromUser || "";
        if (n) {
          p.nickname = n;
          p.nickName = n;
        }
        // Tuỳ chọn: không cần mang user về FE
        // if (p.user) delete p.user;
        return p;
      };

      if (m.pairA) {
        m.pairA.player1 = fillNick(m.pairA.player1);
        m.pairA.player2 = fillNick(m.pairA.player2);
      }
      if (m.pairB) {
        m.pairB.player1 = fillNick(m.pairB.player1);
        m.pairB.player2 = fillNick(m.pairB.player2);
      }

      // bổ sung streams từ meta nếu có
      if (!m.streams && m.meta?.streams) m.streams = m.meta.streams;

      io.to(`match:${matchId}`).emit("score:updated", toDTO(m));
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
        await broadcastState(tournamentId, { bracket, cluster });
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

    // ========= SCHEDULER RESET (admin) =========
    // Payload:
    // {
    //   tournamentId: "68b16713ba906623ce8709f4",
    //   bracket:      "68b16756ba906623ce870a57",
    //   // optional:
    //   // rebuild: true  -> build lại queue xoay vòng sau khi reset
    //   // cluster: "Main" (fallback nếu không có bracket)
    // }
    socket.on(
      "scheduler:resetAll",
      async (
        { tournamentId, bracket, cluster = "Main", rebuild = true },
        ack
      ) => {
        try {
          if (!ensureAdmin(socket)) {
            ack?.({ ok: false, message: "Forbidden" });
            return;
          }
          if (!tournamentId || !isObjectIdString(tournamentId)) {
            ack?.({ ok: false, message: "Invalid tournamentId" });
            return;
          }
          if (bracket && !isObjectIdString(bracket)) {
            ack?.({ ok: false, message: "Invalid bracket id" });
            return;
          }

          const clusterKey = resolveClusterKey(bracket, cluster);
          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            // 1) Clear currentMatch trên các sân thuộc bracket/cluster
            const courtsFilter = bracket
              ? { tournament: tournamentId, bracket }
              : { tournament: tournamentId, cluster: clusterKey };

            const courtsResult = await Court.updateMany(
              courtsFilter,
              {
                $unset: { currentMatch: "" },
              },
              { session }
            );

            // 2) Xoá gán sân và đưa về hàng đợi cho các trận queued/assigned
            const matchFilterBase = {
              tournament: tournamentId,
              ...(bracket ? { bracket } : { courtCluster: clusterKey }),
              status: { $in: ["queued", "assigned"] },
            };

            const clearAssignRes = await Match.updateMany(
              matchFilterBase,
              {
                $unset: { court: "", courtLabel: "", queueOrder: "" },
              },
              { session }
            );

            const toQueuedRes = await Match.updateMany(
              { ...matchFilterBase, status: "assigned" },
              { $set: { status: "queued" } },
              { session }
            );

            await session.commitTransaction();
            session.endSession();

            // 3) Tuỳ chọn build lại queue & lấp sân trống
            if (rebuild) {
              try {
                await buildGroupsRotationQueue({
                  tournamentId,
                  bracket,
                  cluster: clusterKey,
                });
                await fillIdleCourtsForCluster({
                  tournamentId,
                  cluster: clusterKey,
                });
              } catch (e) {
                console.error(
                  "[scheduler] rebuild after reset error:",
                  e?.message
                );
              }
            }

            // 4) Phát lại state cho room đang xem cụm/bracket đó
            await broadcastState(tournamentId, {
              bracket,
              cluster: clusterKey,
            });

            ack?.({
              ok: true,
              clearedCourts: courtsResult?.modifiedCount ?? 0,
              clearedAssignments: clearAssignRes?.modifiedCount ?? 0,
              reassignedToQueued: toQueuedRes?.modifiedCount ?? 0,
              rebuilt: Boolean(rebuild),
            });
          } catch (e) {
            await session.abortTransaction().catch((e) => {
              console.log(e);
            });
            session.endSession();
            console.error("[scheduler] resetAll error:", e?.message);
            ack?.({ ok: false, message: e?.message || "Reset failed" });
          }
        } catch (e) {
          console.error("[scheduler] resetAll outer error:", e?.message);
          ack?.({ ok: false, message: e?.message || "Reset failed" });
        }
      }
    );

    socket.on(
      "scheduler:assignSpecific",
      async (
        {
          tournamentId,
          bracket,
          courtId,
          matchId,
          replace = false,
          cluster = "Main",
        },
        ack
      ) => {
        try {
          if (!ensureAdmin(socket)) {
            ack?.({ ok: false, message: "Forbidden" });
            return;
          }
          if (
            !isObjectIdString(tournamentId) ||
            !isObjectIdString(courtId) ||
            !isObjectIdString(matchId)
          ) {
            ack?.({ ok: false, message: "Invalid ids" });
            return;
          }
          if (bracket && !isObjectIdString(bracket)) {
            ack?.({ ok: false, message: "Invalid bracket id" });
            return;
          }

          // Load court + match
          const [court, match] = await Promise.all([
            Court.findById(courtId).lean(),
            Match.findById(matchId).lean(),
          ]);

          if (!court) return ack?.({ ok: false, message: "Court not found" });
          if (!match) return ack?.({ ok: false, message: "Match not found" });

          if (
            String(court.tournament) !== String(tournamentId) ||
            String(match.tournament) !== String(tournamentId)
          ) {
            return ack?.({ ok: false, message: "Tournament mismatch" });
          }

          // Nếu client truyền bracket thì kiểm tra khớp
          if (bracket && String(match.bracket) !== String(bracket)) {
            return ack?.({ ok: false, message: "Match not in bracket" });
          }
          // Nếu sân có bracket ràng buộc thì bắt buộc khớp với match
          if (
            court.bracket &&
            String(court.bracket) !== String(match.bracket)
          ) {
            return ack?.({
              ok: false,
              message: "Court belongs to another bracket",
            });
          }

          if (["live", "finished"].includes(match.status)) {
            return ack?.({
              ok: false,
              message: `Cannot assign a ${match.status} match`,
            });
          }

          const clusterKey =
            court.cluster || resolveClusterKey(bracket, cluster);

          const session = await mongoose.startSession();
          session.startTransaction();

          try {
            // 0) Nếu sân đang bận và không replace
            if (
              court.currentMatch &&
              String(court.currentMatch) !== String(match._id) &&
              !replace
            ) {
              throw new Error("Court is busy. Pass replace=true to override.");
            }

            // 1) Nếu sân đang có trận khác -> đẩy về queued & gỡ gán
            if (
              court.currentMatch &&
              String(court.currentMatch) !== String(match._id)
            ) {
              const prev = await Match.findById(court.currentMatch).session(
                session
              );
              if (prev && prev.status !== "finished") {
                prev.status = "queued";
                prev.set("court", undefined, { strict: false });
                prev.set("courtLabel", undefined, { strict: false });
                prev.set("queueOrder", undefined, { strict: false });
                await prev.save({ session });
              }
            }

            // 2) Nếu trận đang nằm ở sân khác -> gỡ currentMatch ở sân cũ
            if (match.court && String(match.court) !== String(court._id)) {
              const prevCourt = await Court.findById(match.court).session(
                session
              );
              if (
                prevCourt &&
                String(prevCourt.currentMatch) === String(match._id)
              ) {
                prevCourt.set("currentMatch", undefined, { strict: false });
                await prevCourt.save({ session });
              }
            }

            // 3) Cập nhật match -> assigned vào court
            const courtLabelGuess =
              court.name ||
              court.label ||
              (Number.isInteger(court.order) ? `Sân ${court.order}` : "Sân");
            const mDoc = await Match.findById(match._id).session(session);
            mDoc.status = "assigned";
            mDoc.court = court._id;
            mDoc.courtLabel = courtLabelGuess;
            mDoc.courtCluster = clusterKey;
            mDoc.set("queueOrder", undefined, { strict: false }); // bỏ thứ tự hàng đợi
            await mDoc.save({ session });

            // 4) Cập nhật court.currentMatch
            const cDoc = await Court.findById(court._id).session(session);
            cDoc.currentMatch = mDoc._id;
            await cDoc.save({ session });

            await session.commitTransaction();
            session.endSession();

            // 5) Phát lại state cho phòng xem cụm/bracket
            await broadcastState(String(tournamentId), {
              bracket: mDoc.bracket,
              cluster: clusterKey,
            });

            ack?.({
              ok: true,
              courtId: String(court._id),
              matchId: String(mDoc._id),
              status: mDoc.status,
              courtLabel: mDoc.courtLabel,
              cluster: clusterKey,
              replaced: Boolean(replace),
            });
          } catch (err) {
            await session.abortTransaction().catch(() => {});
            session.endSession();
            console.error("[scheduler] assignSpecific error:", err?.message);
            ack?.({ ok: false, message: err?.message || "Assign failed" });
          }
        } catch (e) {
          console.error("[scheduler] assignSpecific outer error:", e?.message);
          ack?.({ ok: false, message: e?.message || "Assign failed" });
        }
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
