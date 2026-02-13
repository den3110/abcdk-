// services/bot/learningService.js
// Auto-learning: save successful Q&A to Knowledge Base

import Knowledge from "../../models/knowledgeModel.js";

// ─── Config ───
const MIN_REPLY_LENGTH = 80; // Minimum reply length to consider "useful"
const DEDUP_SCORE_THRESHOLD = 3; // MongoDB text score threshold for dedup
const TTL_DAYS = 30; // Auto-expire after 30 days
const MAX_LEARNED_DOCS = 500; // Max learned entries in KB

// Tools that indicate greeting/nav — skip learning for these
const SKIP_TOOLS = new Set(["navigate", "search_knowledge", "get_my_info"]);

// Dynamic data tools — DO NOT learn from these (stale data risk)
const DYNAMIC_TOOLS = new Set([
  "get_match_info",
  "get_tournament_matches",
  "get_ongoing_matches",
  "get_live_sessions",
  "get_leaderboard",
  "get_most_active_players",
  "get_player_ranking",
  "get_match_score_detail",
  "get_tournament_registrations",
  "count_registrations",
  "check_in_player",
  "get_tournament_courts",
]);

// ─── Keyword Extraction ───
// Remove Vietnamese stop words and extract meaningful terms
const STOP_WORDS = new Set([
  "là",
  "và",
  "của",
  "cho",
  "với",
  "trong",
  "được",
  "có",
  "này",
  "các",
  "những",
  "một",
  "không",
  "đã",
  "sẽ",
  "đang",
  "bao",
  "nhiêu",
  "thế",
  "nào",
  "gì",
  "ở",
  "từ",
  "đến",
  "về",
  "theo",
  "trên",
  "dưới",
  "ai",
  "tôi",
  "mình",
  "bạn",
  "tui",
  "em",
  "anh",
  "chị",
  "the",
  "is",
  "are",
  "was",
  "were",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "how",
  "what",
  "who",
  "where",
  "when",
  "which",
  "that",
  "this",
  "hỏi",
  "xem",
  "cho",
  "biết",
  "giúp",
  "ơi",
  "nhé",
  "nha",
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 8);
}

// ─── Dedup Check ───
async function isDuplicate(question) {
  try {
    // Text search for similar questions
    const existing = await Knowledge.find(
      {
        source: "bot-learned",
        isActive: true,
        $text: { $search: question },
      },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(1)
      .lean();

    if (existing.length > 0 && existing[0].score >= DEDUP_SCORE_THRESHOLD) {
      // Update existing: refresh TTL + bump usageCount
      await Knowledge.updateOne(
        { _id: existing[0]._id },
        {
          $inc: { usageCount: 1 },
          $set: {
            expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
          },
        },
      );
      return true;
    }
    return false;
  } catch {
    return false; // On error, allow learning
  }
}

// ─── Capacity Check ───
async function checkCapacity() {
  const count = await Knowledge.countDocuments({ source: "bot-learned" });
  if (count >= MAX_LEARNED_DOCS) {
    // Delete oldest, least used entries
    const oldest = await Knowledge.find({ source: "bot-learned" })
      .sort({ usageCount: 1, createdAt: 1 })
      .limit(10)
      .select("_id");
    await Knowledge.deleteMany({ _id: { $in: oldest.map((d) => d._id) } });
  }
}

// ─── Main: maybeLearn ───
/**
 * Auto-save a successful Q&A pair to knowledge base.
 * Called async (fire-and-forget) after agent reply.
 *
 * @param {string} question - User's original question
 * @param {string} reply    - Bot's final reply
 * @param {string[]} toolsUsed - List of tools that were called
 */
export async function maybeLearn(question, reply, toolsUsed = []) {
  try {
    // ── Guard: skip if no tools used (simple chat)
    const meaningfulTools = toolsUsed.filter((t) => !SKIP_TOOLS.has(t));
    if (meaningfulTools.length === 0) return;

    // ── Guard: skip if ALL meaningful tools are dynamic (data might change)
    const staticTools = meaningfulTools.filter((t) => !DYNAMIC_TOOLS.has(t));
    if (staticTools.length === 0) {
      console.log("[learning] Skipped — only dynamic tools:", toolsUsed);
      return;
    }

    // ── Guard: skip if reply too short or is an error
    if (!reply || reply.length < MIN_REPLY_LENGTH) return;
    if (/xin lỗi.*lỗi|không hiểu|thử lại/i.test(reply)) return;

    // ── Guard: skip if question too short
    if (!question || question.trim().length < 5) return;

    // ── Dedup: check if similar Q already exists
    if (await isDuplicate(question)) {
      console.log("[learning] Duplicate found, refreshed TTL");
      return;
    }

    // ── Capacity check
    await checkCapacity();

    // ── Extract keywords from question
    const keywords = extractKeywords(question);

    // ── Build title (first 80 chars of question)
    const title =
      question.length > 80 ? question.slice(0, 77) + "..." : question;

    // ── Save to KB
    await Knowledge.create({
      title,
      content: reply.slice(0, 2000), // Cap content length
      category: "learned",
      source: "bot-learned",
      keywords,
      toolsUsed: meaningfulTools,
      usageCount: 0,
      expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
      isActive: true,
    });

    console.log(
      `[learning] Saved: "${title}" (${meaningfulTools.length} tools, ${keywords.length} keywords)`,
    );
  } catch (err) {
    // Never throw — this is fire-and-forget
    console.error("[learning] Error:", err.message);
  }
}
