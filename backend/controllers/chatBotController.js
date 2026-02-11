// controllers/chatBotController.js
// ✅ v3.0 - Agent-based with Function Calling
// Thay thế hoàn toàn 3-layer cũ (quickResponse + skillMatching + GPT planner)

import {
  runAgent,
  runAgentStream,
  BOT_IDENTITY,
} from "../services/bot/agentService.js";
import ChatBotMessage from "../models/chatBotMessageModel.js";

// Roles that bypass session limit
const UNLIMITED_ROLES = ["admin", "referee"];
const SESSION_LIMIT = 30;

/* ========== MAIN CHAT HANDLER ========== */
export async function handleChat(req, res) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    // Extract context from headers
    const currentUser = req.user;
    const tournamentId = req.headers["x-pkt-tournament-id"];
    const matchId = req.headers["x-pkt-match-id"];
    const bracketId = req.headers["x-pkt-bracket-id"];
    const courtCode = req.headers["x-pkt-court-code"];

    const context = {
      currentUser,
      currentUserId: currentUser?._id,
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    };

    const userId = currentUser?._id || null;

    // ═══════════ SESSION LIMIT ═══════════
    const userRole = currentUser?.role;
    const isUnlimited = UNLIMITED_ROLES.includes(userRole);

    if (userId && !isUnlimited) {
      const now = new Date();

      const lastLimit = await ChatBotMessage.findOne({
        userId,
        role: "system",
        "meta.kind": "session-limit",
      }).sort({ createdAt: -1 });

      let sessionStart = null;

      if (lastLimit?.meta?.resetAt) {
        const resetAt = new Date(lastLimit.meta.resetAt);

        if (now < resetAt) {
          const msLeft = resetAt.getTime() - now.getTime();
          const totalMinutesLeft = Math.ceil(msLeft / 60000);
          const hoursLeft = Math.floor(totalMinutesLeft / 60);
          const minutesLeft = totalMinutesLeft % 60;

          return res.status(429).json({
            error: "session_limit_reached",
            message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
            limit: SESSION_LIMIT,
            resetAt: resetAt.toISOString(),
            remaining: { hours: hoursLeft, minutes: minutesLeft },
          });
        }

        sessionStart = new Date(lastLimit.meta.resetAt);
      }

      const countQuery = { userId, role: "user" };
      if (sessionStart) countQuery.createdAt = { $gte: sessionStart };

      const userMsgCount = await ChatBotMessage.countDocuments(countQuery);

      if (userMsgCount >= SESSION_LIMIT) {
        const limitTime = now;
        const resetAt = computeSessionResetAt(limitTime);
        const msLeft = resetAt.getTime() - now.getTime();
        const totalMinutesLeft = Math.ceil(msLeft / 60000);
        const hoursLeft = Math.floor(totalMinutesLeft / 60);
        const minutesLeft = totalMinutesLeft % 60;

        try {
          await ChatBotMessage.create({
            userId,
            role: "system",
            message: `Session limit reached. Bạn đã dùng hết ${SESSION_LIMIT} tin nhắn.`,
            meta: {
              kind: "session-limit",
              limit: SESSION_LIMIT,
              limitReachedAt: limitTime,
              resetAt,
            },
            navigation: null,
            context: { tournamentId, matchId, bracketId, courtCode },
          });
        } catch (e) {
          console.error("[handleChat] log session-limit error:", e.message);
        }

        return res.status(429).json({
          error: "session_limit_reached",
          message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
          limit: SESSION_LIMIT,
          resetAt: resetAt.toISOString(),
          remaining: { hours: hoursLeft, minutes: minutesLeft },
        });
      }
    }
    // ═══════════ END SESSION LIMIT ═══════════

    // Log user message
    let userMessageDoc = null;
    try {
      userMessageDoc = await ChatBotMessage.create({
        userId,
        role: "user",
        message,
        meta: null,
        navigation: null,
        context: { tournamentId, matchId, bracketId, courtCode },
      });
    } catch (e) {
      console.error("[handleChat] log user message error:", e.message);
    }

    // ✅ RUN AGENT (thay thế toàn bộ 3 layers cũ)
    const result = await runAgent(message, context, userId);

    // Build response
    const response = {
      reply: result.reply,
      source: "agent",
      toolsUsed: result.toolsUsed,
      processingTime: result.processingTime,
      botName: BOT_IDENTITY.nameVi,
    };

    if (result.navigation) {
      response.navigation = result.navigation;
    }

    // Log bot message
    try {
      await ChatBotMessage.create({
        userId,
        role: "bot",
        message: response.reply,
        meta: {
          type: "agent",
          source: "agent",
          toolsUsed: result.toolsUsed,
          processingTime: result.processingTime,
        },
        navigation: result.navigation || null,
        context: { tournamentId, matchId, bracketId, courtCode },
        replyTo: userMessageDoc?._id || null,
      });
    } catch (e) {
      console.error("[handleChat] log bot message error:", e.message);
    }

    return res.json(response);
  } catch (err) {
    console.error("handleChat error:", err);
    return res.status(500).json({
      error: "Lỗi server",
      botName: BOT_IDENTITY.nameVi,
    });
  }
}

/* ========== SSE STREAMING CHAT HANDLER ========== */
export async function handleChatStream(req, res) {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Thiếu message" });
    }

    const currentUser = req.user;
    const tournamentId = req.headers["x-pkt-tournament-id"];
    const matchId = req.headers["x-pkt-match-id"];
    const bracketId = req.headers["x-pkt-bracket-id"];
    const courtCode = req.headers["x-pkt-court-code"];

    const context = {
      currentUser,
      currentUserId: currentUser?._id,
      tournamentId,
      matchId,
      bracketId,
      courtCode,
    };

    const userId = currentUser?._id || null;

    // Session limit check (same as handleChat)
    const userRole = currentUser?.role;
    const isUnlimited = UNLIMITED_ROLES.includes(userRole);

    if (userId && !isUnlimited) {
      const now = new Date();
      const lastLimit = await ChatBotMessage.findOne({
        userId,
        role: "system",
        "meta.kind": "session-limit",
      }).sort({ createdAt: -1 });

      if (lastLimit?.meta?.resetAt) {
        const resetAt = new Date(lastLimit.meta.resetAt);
        if (now < resetAt) {
          return res.status(429).json({
            error: "session_limit_reached",
            message: `Bạn đã đạt giới hạn ${SESSION_LIMIT} tin nhắn cho lượt này.`,
          });
        }
      }

      const countQuery = { userId, role: "user" };
      if (lastLimit?.meta?.resetAt) {
        countQuery.createdAt = { $gte: new Date(lastLimit.meta.resetAt) };
      }
      const userMsgCount = await ChatBotMessage.countDocuments(countQuery);
      if (userMsgCount >= SESSION_LIMIT) {
        const resetAt = computeSessionResetAt(now);
        try {
          await ChatBotMessage.create({
            userId,
            role: "system",
            message: `Session limit reached (${SESSION_LIMIT}).`,
            meta: {
              kind: "session-limit",
              limit: SESSION_LIMIT,
              limitReachedAt: now,
              resetAt,
            },
            navigation: null,
            context: { tournamentId, matchId, bracketId, courtCode },
          });
        } catch (e) {
          /* ignore */
        }
        return res.status(429).json({ error: "session_limit_reached" });
      }
    }

    // Log user message
    let userMessageDoc = null;
    try {
      userMessageDoc = await ChatBotMessage.create({
        userId,
        role: "user",
        message,
        meta: null,
        navigation: null,
        context: { tournamentId, matchId, bracketId, courtCode },
      });
    } catch (e) {
      console.error("[handleChatStream] log user message error:", e.message);
    }

    // ═══ SSE Headers ═══
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const emit = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // ═══ Run Agent with streaming ═══
    const result = await runAgentStream(message, context, userId, emit);

    // Log bot message after completion
    if (result) {
      try {
        await ChatBotMessage.create({
          userId,
          role: "bot",
          message: result.reply,
          meta: {
            type: "agent",
            source: "agent-stream",
            toolsUsed: result.toolsUsed,
            processingTime: result.processingTime,
          },
          navigation: result.navigation || null,
          context: { tournamentId, matchId, bracketId, courtCode },
          replyTo: userMessageDoc?._id || null,
        });
      } catch (e) {
        console.error("[handleChatStream] log bot msg error:", e.message);
      }
    }

    res.end();
  } catch (err) {
    console.error("handleChatStream error:", err);
    // If headers already sent, try to emit error event
    if (res.headersSent) {
      try {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: "Lỗi server" })}\n\n`,
        );
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      } catch {
        /* ignore */
      }
    } else {
      return res.status(500).json({ error: "Lỗi server" });
    }
  }
}

/* ========== HEALTH CHECK ========== */
export async function handleHealthCheck(req, res) {
  return res.json({
    status: "ok",
    bot: BOT_IDENTITY,
    engine: {
      type: "agent-function-calling",
      model: process.env.BOT_MODEL || "gpt-4o-mini",
      provider: process.env.CLIPROXY_BASE_URL ? "CLIProxyAPI" : "OpenAI",
      tools: [
        "search_tournaments",
        "get_tournament_details",
        "count_registrations",
        "search_users",
        "get_my_info",
        "get_match_info",
        "get_leaderboard",
        "get_my_registrations",
        "get_my_rating_changes",
        "navigate",
        "search_knowledge",
      ],
    },
    timestamp: new Date().toISOString(),
  });
}

/* ========== BOT INFO ========== */
export async function handleBotInfo(req, res) {
  return res.json({
    ...BOT_IDENTITY,
    features: [
      "Greeting & Small Talk",
      "FAQ về PickleTour (RAG)",
      "Navigation commands",
      "Tra cứu thông tin giải đấu",
      "Tra cứu thông tin cá nhân",
      "Tìm kiếm VĐV",
      "Bảng xếp hạng",
      "Conversation memory",
      "Function calling (11 tools)",
    ],
  });
}

/* ========== GET CHAT HISTORY (cursor-based) ========== */
export async function handleGetChatHistory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const before = req.query.before; // cursor: _id of oldest message client has

    const query = {
      userId: currentUser._id,
      role: { $in: ["user", "bot"] }, // exclude system messages
    };

    // Cursor: fetch messages OLDER than the given _id
    if (before) {
      query._id = { $lt: before };
    }

    // Sort DESC to get the most recent N, then reverse for chronological order
    const messages = await ChatBotMessage.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1) // fetch one extra to determine hasMore
      .lean();

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop(); // remove the extra

    // Reverse to chronological order (oldest first)
    messages.reverse();

    const nextCursor = hasMore ? messages[0]?._id : null;

    return res.json({
      messages: messages.map((m) => ({
        id: m._id,
        role: m.role,
        message: m.message,
        meta: m.meta,
        navigation: m.navigation,
        context: m.context,
        createdAt: m.createdAt,
      })),
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("[handleGetChatHistory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== CLEAR CHAT HISTORY ========== */
export async function handleClearChatHistory(req, res) {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await ChatBotMessage.deleteMany({
      userId: currentUser._id,
    });

    return res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (err) {
    console.error("[handleClearChatHistory] error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

/* ========== HELPERS ========== */
function computeSessionResetAt(limitTime) {
  const t = new Date(limitTime);
  const minutes = t.getMinutes();
  const extraMinutes = minutes === 0 ? 0 : 60 - minutes;
  const totalMinutes = 4 * 60 + extraMinutes;
  const reset = new Date(t.getTime() + totalMinutes * 60 * 1000);
  reset.setSeconds(0, 0);
  return reset;
}
