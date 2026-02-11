// services/bot/agentService.js
// ✅ NEW: Agent-based chatbot engine with OpenAI Function Calling
// Thay thế toàn bộ 3-layer cũ (quickResponse + skillMatching + GPT planner)

import OpenAI from "openai";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS } from "./tools/index.js";
import { getRecentMessages } from "./memoryService.js";

// ─────────────── CONFIG ───────────────

const openai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.CLIPROXY_BASE_URL || undefined,
});

const MODEL = process.env.BOT_MODEL || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5; // Giới hạn số lần gọi tool liên tiếp

// ─────────────── SYSTEM PROMPT ───────────────

const SYSTEM_PROMPT = `
Bạn là Pikora 🏓 - trợ lý ảo của ứng dụng PickleTour, nền tảng quản lý giải đấu Pickleball.

# Thông tin
- Tên: Pikora
- Vai trò: Trợ lý AI cho app PickleTour - hỗ trợ về giải đấu, VĐV, tính năng app, và cả kiến thức Pickleball
- Ngôn ngữ: Tiếng Việt (trả lời tiếng Anh nếu user nói tiếng Anh)
- Tính cách: Thân thiện, vui vẻ, chuyên nghiệp, ngắn gọn

# Quy tắc trả lời
1. Trả lời ngắn gọn, đi thẳng vào vấn đề
2. Dùng emoji phù hợp nhưng không quá nhiều
3. Nếu không biết → nói thẳng, KHÔNG bịa
4. LUÔN gọi search_knowledge TRƯỚC khi trả lời các câu hỏi về: tính năng, hướng dẫn, luật chơi, thuật ngữ, FAQ
5. Luôn trả lời bằng tiếng Việt trừ khi user dùng tiếng Anh
6. Bạn ĐƯỢC PHÉP trả lời về: kiến thức Pickleball (luật, thuật ngữ, kỹ thuật), giải đấu, VĐV, tính năng app
7. Chỉ từ chối các câu hỏi hoàn toàn không liên quan (chính trị, 18+, tài chính...)

# Format trả lời (Markdown)
- Dùng **bold** cho tên, con số quan trọng
- Khi có danh sách dữ liệu (VĐV, giải đấu, BXH...) → LUÔN dùng bảng markdown:
  | # | Tên | Rating | Tỉnh |
  |---|-----|--------|------|
  | 1 | ... | ...    | ...  |
- Dùng bullet points cho hướng dẫn từng bước
- Dùng > blockquote cho lưu ý quan trọng
- Dùng \`code\` cho mã, ID, số liệu cụ thể

# Bảo mật dữ liệu
- Thông tin cá nhân (SĐT, email) của người KHÁC: TUYỆT ĐỐI KHÔNG chia sẻ
- Chỉ chia sẻ info công khai: tên, nickname, rating, tỉnh, giới tính
- User chỉ được xem SĐT/email CỦA CHÍNH MÌNH (qua tool get_my_info)

# Context từ app
Khi user nói "này", "hiện tại", "đang":
- "giải này" → dùng tournamentId trong context
- "trận này" → dùng matchId trong context
- "bảng này" → dùng bracketId trong context
- "sân này" → dùng courtCode trong context

Khi user nói "tất cả", "những", "các", "nào" → query chung, KHÔNG dùng context

# Điều hướng
Khi user muốn "mở", "vào", "xem", "đi đến" → gọi tool navigate

# Tools có sẵn
Bạn có các tools để:
- 🔍 Tìm kiếm FAQ/hướng dẫn/kiến thức → search_knowledge (ƯU TIÊN gọi trước)
- 🏆 Tìm kiếm giải đấu, VĐV
- 📊 Xem thông tin trận đấu, bảng xếp hạng
- 👤 Xem thông tin cá nhân user
- 📈 Thống kê chi tiết VĐV (win rate, tổng trận...) → dùng get_user_stats
- ⚖️ So sánh 2 VĐV → gọi get_user_stats 2 lần rồi so sánh
- 🧭 Điều hướng màn hình app → navigate
- 🔥 Query bất kỳ data nào trong DB → dùng query_db (generic)

# Khi nào dùng query_db
- Khi KHÔNG có tool chuyên biệt phù hợp
- query_db cho phép query bất kỳ collection với filter/sort/limit tùy ý
- Collections: tournaments, users, registrations, matches, brackets, courts, ratingChanges, assessments, reputationEvents, scoreHistories
- Filter hỗ trợ MongoDB operators: $regex, $gte, $lte, $in, $or, $exists...
- Context variables trong filter: {{currentUserId}}, {{tournamentId}}, {{matchId}}, {{bracketId}}, {{courtCode}}
`.trim();

// ─────────────── MAIN AGENT FUNCTION ───────────────

/**
 * Chạy agent: GPT + function calling + memory
 *
 * @param {string} message - Tin nhắn user
 * @param {object} context - Context từ headers (tournamentId, matchId, ...)
 * @param {string|null} userId - User ID (cho memory)
 * @returns {{ reply: string, toolsUsed: string[], navigation: object|null, processingTime: number }}
 */
export async function runAgent(message, context = {}, userId = null) {
  const startTime = Date.now();

  // 1) Load conversation memory
  const memory = userId ? await getRecentMessages(userId, 10) : [];

  // 2) Build system prompt with context
  let systemContent = SYSTEM_PROMPT;
  const contextParts = [];
  if (context.currentUserId)
    contextParts.push(`User ID: ${context.currentUserId}`);
  if (context.tournamentId)
    contextParts.push(`Tournament ID: ${context.tournamentId}`);
  if (context.matchId) contextParts.push(`Match ID: ${context.matchId}`);
  if (context.bracketId) contextParts.push(`Bracket ID: ${context.bracketId}`);
  if (context.courtCode) contextParts.push(`Court code: ${context.courtCode}`);

  if (contextParts.length > 0) {
    systemContent += `\n\n# Context hiện tại\n${contextParts.join("\n")}`;
  }

  // 3) Build messages array
  const messages = [
    { role: "system", content: systemContent },
    ...memory,
    { role: "user", content: message },
  ];

  // 4) Run agent loop (GPT → tool calls → GPT → ...)
  const toolsUsed = [];
  let navigation = null;
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response;
    try {
      response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1000,
      });
    } catch (err) {
      console.error("[Agent] OpenAI API error:", err.message);
      return {
        reply: "Xin lỗi, mình đang gặp lỗi kết nối. Bạn thử lại sau nhé!",
        toolsUsed: [],
        navigation: null,
        processingTime: Date.now() - startTime,
      };
    }

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // Nếu GPT trả lời trực tiếp (không gọi tool)
    if (
      choice.finish_reason === "stop" ||
      !assistantMessage.tool_calls?.length
    ) {
      const reply =
        assistantMessage.content ||
        "Xin lỗi, mình không hiểu câu hỏi. Bạn thử hỏi khác nhé!";
      return {
        reply,
        toolsUsed,
        navigation,
        processingTime: Date.now() - startTime,
      };
    }

    // GPT muốn gọi tools
    messages.push(assistantMessage);

    // Execute tất cả tool calls song song
    const toolResults = await Promise.all(
      assistantMessage.tool_calls.map(async (toolCall) => {
        const fnName = toolCall.function.name;
        const fnArgs = safeParseJSON(toolCall.function.arguments);

        console.log(`[Agent] Tool call: ${fnName}(${JSON.stringify(fnArgs)})`);
        toolsUsed.push(fnName);

        const executor = TOOL_EXECUTORS[fnName];
        if (!executor) {
          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify({ error: `Tool ${fnName} không tồn tại` }),
          };
        }

        try {
          const result = await executor(fnArgs, context);

          // Capture navigation result
          if (fnName === "navigate" && result?.deepLink) {
            navigation = {
              screen: result.screen,
              deepLink: result.deepLink,
              description: result.description,
            };
          }

          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify(result),
          };
        } catch (err) {
          console.error(`[Agent] Tool ${fnName} error:`, err.message);
          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify({ error: err.message }),
          };
        }
      }),
    );

    // Add tool results to messages
    messages.push(...toolResults);
  }

  // Max rounds reached
  return {
    reply: "Xin lỗi, mình đang xử lý quá lâu. Bạn thử hỏi đơn giản hơn nhé!",
    toolsUsed,
    navigation,
    processingTime: Date.now() - startTime,
  };
}

// ─────────────── STREAMING AGENT ───────────────

/**
 * Agent với SSE streaming — emit events real-time
 *
 * Events emitted:
 *   thinking   { step: "Đang phân tích câu hỏi..." }
 *   tool_start { tool: "search_knowledge", args: {...} }
 *   tool_done  { tool: "search_knowledge", resultPreview: "...", durationMs: 123 }
 *   reply      { text: "...", toolsUsed: [...], processingTime: 1234 }
 *   done       {}
 *   error      { message: "..." }
 */
export async function runAgentStream(
  message,
  context = {},
  userId = null,
  emit,
) {
  const startTime = Date.now();

  emit("thinking", { step: "Đang tải ngữ cảnh hội thoại..." });

  // 1) Load conversation memory
  const memory = userId ? await getRecentMessages(userId, 10) : [];

  // 2) Build system prompt with context
  let systemContent = SYSTEM_PROMPT;
  const contextParts = [];
  if (context.currentUserId)
    contextParts.push(`User ID: ${context.currentUserId}`);
  if (context.tournamentId)
    contextParts.push(`Tournament ID: ${context.tournamentId}`);
  if (context.matchId) contextParts.push(`Match ID: ${context.matchId}`);
  if (context.bracketId) contextParts.push(`Bracket ID: ${context.bracketId}`);
  if (context.courtCode) contextParts.push(`Court code: ${context.courtCode}`);

  if (contextParts.length > 0) {
    systemContent += `\n\n# Context hiện tại\n${contextParts.join("\n")}`;
  }

  emit("thinking", { step: "Đang phân tích câu hỏi..." });

  // 3) Build messages array
  const messages = [
    { role: "system", content: systemContent },
    ...memory,
    { role: "user", content: message },
  ];

  // 4) Run agent loop
  const toolsUsed = [];
  let navigation = null;
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    let response;
    try {
      response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1000,
      });
    } catch (err) {
      console.error("[Agent] OpenAI API error:", err.message);
      emit("error", { message: "Lỗi kết nối AI. Bạn thử lại sau nhé!" });
      emit("done", {});
      return;
    }

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // GPT trả lời trực tiếp
    if (
      choice.finish_reason === "stop" ||
      !assistantMessage.tool_calls?.length
    ) {
      const reply =
        assistantMessage.content ||
        "Xin lỗi, mình không hiểu câu hỏi. Bạn thử hỏi khác nhé!";

      const processingTime = Date.now() - startTime;

      emit("reply", { text: reply, toolsUsed, navigation, processingTime });

      // Generate smart follow-up suggestions
      const suggestions = await generateSuggestions(message, reply, userId);
      if (suggestions.length > 0) {
        emit("suggestions", { suggestions });
      }

      emit("done", {});

      // Return for logging by caller
      return { reply, toolsUsed, navigation, processingTime };
    }

    // GPT muốn gọi tools
    messages.push(assistantMessage);

    // Execute tool calls (song song)
    const toolResults = await Promise.all(
      assistantMessage.tool_calls.map(async (toolCall) => {
        const fnName = toolCall.function.name;
        const fnArgs = safeParseJSON(toolCall.function.arguments);
        const toolStart = Date.now();

        toolsUsed.push(fnName);

        // Emit tool_start
        emit("tool_start", { tool: fnName, args: fnArgs });

        const executor = TOOL_EXECUTORS[fnName];
        if (!executor) {
          emit("tool_done", {
            tool: fnName,
            resultPreview: `Tool ${fnName} không tồn tại`,
            durationMs: Date.now() - toolStart,
            error: true,
          });
          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify({ error: `Tool ${fnName} không tồn tại` }),
          };
        }

        try {
          const result = await executor(fnArgs, context);

          // Capture navigation
          if (fnName === "navigate" && result?.deepLink) {
            navigation = {
              screen: result.screen,
              deepLink: result.deepLink,
              description: result.description,
            };
          }

          // Build preview
          const preview = buildToolPreview(fnName, result);

          emit("tool_done", {
            tool: fnName,
            resultPreview: preview,
            durationMs: Date.now() - toolStart,
          });

          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify(result),
          };
        } catch (err) {
          console.error(`[Agent] Tool ${fnName} error:`, err.message);
          emit("tool_done", {
            tool: fnName,
            resultPreview: `Lỗi: ${err.message}`,
            durationMs: Date.now() - toolStart,
            error: true,
          });
          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify({ error: err.message }),
          };
        }
      }),
    );

    messages.push(...toolResults);

    // Emit thinking for next round
    if (rounds < MAX_TOOL_ROUNDS) {
      emit("thinking", { step: "Đang tổng hợp kết quả..." });
    }
  }

  // Max rounds
  const processingTime = Date.now() - startTime;
  emit("reply", {
    text: "Xin lỗi, mình đang xử lý quá lâu. Bạn thử hỏi đơn giản hơn nhé!",
    toolsUsed,
    navigation,
    processingTime,
  });
  emit("done", {});
  return {
    reply: "Xin lỗi, mình đang xử lý quá lâu. Bạn thử hỏi đơn giản hơn nhé!",
    toolsUsed,
    navigation,
    processingTime,
  };
}

// ─── Build human-readable preview from tool result ───
function buildToolPreview(tool, result) {
  if (!result) return "Không có kết quả";

  switch (tool) {
    case "search_knowledge":
      return result.results?.length
        ? `Tìm thấy ${result.results.length} bài viết`
        : "Không tìm thấy bài nào";
    case "search_tournaments":
      return result.count
        ? `Tìm thấy ${result.count} giải đấu`
        : "Không tìm thấy giải nào";
    case "search_players":
      return result.count
        ? `Tìm thấy ${result.count} VĐV`
        : "Không tìm thấy VĐV nào";
    case "get_user_stats":
      return result.name
        ? `Thống kê ${result.name}: ${result.wonMatches}W/${result.lostMatches}L`
        : "Đã lấy thống kê";
    case "get_leaderboard":
      return result.players?.length
        ? `BXH: ${result.players.length} VĐV`
        : "Đã lấy BXH";
    case "query_db":
      return result.count != null
        ? `Truy vấn ${result.collection}: ${result.count} kết quả`
        : "Đã truy vấn DB";
    case "navigate":
      return result.description || "Đã điều hướng";
    case "get_my_info":
      return "Đã lấy thông tin cá nhân";
    default:
      return "Hoàn tất";
  }
}

// ─────────────── HELPERS ───────────────

/**
 * Generate smart follow-up suggestions based on conversation context
 * Uses a lightweight GPT call for speed
 */
async function generateSuggestions(userMessage, botReply, userId) {
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `Bạn là Pikora, trợ lý PickleTour. Dựa vào câu hỏi user và câu trả lời của bot, hãy gợi ý 3-4 câu hỏi tiếp theo mà user có thể muốn hỏi.

Quy tắc:
- Mỗi gợi ý ngắn gọn (dưới 30 ký tự)
- Liên quan đến ngữ cảnh hội thoại
- Đa dạng: có thể hỏi sâu hơn, hỏi topic liên quan, hoặc chuyển hướng
- Tiếng Việt
- Trả về JSON array, VÍ DỤ: ["Xem top 20?", "So sánh 2 VĐV", "Giải đấu sắp tới?"]
- KHÔNG giải thích, CHỈ trả JSON array`,
        },
        {
          role: "user",
          content: `User hỏi: "${userMessage}"\nBot trả lời: "${botReply.substring(0, 300)}"`,
        },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    const text = res.choices[0]?.message?.content?.trim();
    if (!text) return [];

    // Parse JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr
          .filter((s) => typeof s === "string" && s.length > 0)
          .slice(0, 4);
      }
    }
    return [];
  } catch (err) {
    console.error("[Agent] generateSuggestions error:", err.message);
    return [];
  }
}

function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// ─────────────── BOT IDENTITY (export cho controller) ───────────────

export const BOT_IDENTITY = {
  name: "Pikora",
  nameVi: "Pikora - Trợ lý PickleTour",
  version: "3.0",
  engine: "agent-function-calling",
  personality: ["Thân thiện", "Vui vẻ", "Chuyên nghiệp", "Ngắn gọn"],
};
