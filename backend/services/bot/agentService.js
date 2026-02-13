// services/bot/agentService.js
// ✅ NEW: Agent-based chatbot engine with OpenAI Function Calling
// Thay thế toàn bộ 3-layer cũ (quickResponse + skillMatching + GPT planner)

import OpenAI from "openai";
import { TOOL_DEFINITIONS, TOOL_EXECUTORS } from "./tools/index.js";
import { getRecentMessages } from "./memoryService.js";
import { maybeLearn } from "./learningService.js";
import User from "../../models/userModel.js";

// ─────────────── CONFIG ───────────────

const openai = new OpenAI({
  apiKey: process.env.CLIPROXY_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.CLIPROXY_BASE_URL || undefined,
});

const MODEL = process.env.BOT_MODEL || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 5; // Giới hạn số lần gọi tool liên tiếp
const MAX_TOOL_RESULT_CHARS = 3000; // Cap tool result size to reduce tokens
const isDev = process.env.NODE_ENV !== "production";

// ─────────────── TOOL LABELS (Vietnamese) ───────────────
const TOOL_LABELS = {
  search_tournaments: "Tìm giải",
  get_tournament_details: "Chi tiết giải",
  count_registrations: "Đếm đăng ký",
  search_users: "Tìm người dùng",
  get_my_info: "Thông tin tôi",
  get_match_info: "Chi tiết trận",
  get_leaderboard: "BXH",
  get_most_active_players: "Top VĐV tích cực",
  get_my_registrations: "Đăng ký của tôi",
  get_my_rating_changes: "Biến động rating",
  get_tournament_matches: "Trận đấu giải",
  get_tournament_brackets: "Bảng đấu",
  get_tournament_registrations: "DS đăng ký",
  get_tournament_courts: "Sân đấu",
  search_clubs: "Tìm CLB",
  get_tournament_summary: "Thống kê giải",
  get_club_details: "Chi tiết CLB",
  get_bracket_standings: "Xếp hạng bảng",
  get_user_matches: "Trận đấu user",
  get_club_members: "Thành viên CLB",
  get_club_events: "Sự kiện CLB",
  search_news: "Tin tức",
  get_sponsors: "Nhà tài trợ",
  get_player_evaluations: "Đánh giá VĐV",
  get_live_streams: "Live stream",
  get_club_announcements: "Thông báo CLB",
  get_reg_invites: "Lời mời đăng ký",
  get_support_tickets: "Hỗ trợ",
  get_my_subscriptions: "Theo dõi",
  get_casual_matches: "Trận tự do",
  get_complaints: "Khiếu nại",
  get_club_polls: "Bình chọn CLB",
  get_club_join_requests: "Xin vào CLB",
  get_tournament_managers: "BTC giải",
  get_match_recordings: "Ghi hình trận",
  get_draw_results: "Kết quả bốc thăm",
  get_radar_nearby: "Radar gần đây",
  get_login_history: "Đăng nhập",
  get_cms_content: "CMS/FAQ",
  get_my_devices: "Thiết bị",
  get_app_version: "Phiên bản app",
  get_live_channels: "Kênh live",
  get_app_update_info: "Cập nhật app",
  check_my_registration: "Đăng ký giải",
  get_head_to_head: "Đối đầu",
  get_upcoming_matches: "Trận sắp tới",
  get_score_history: "Điểm kỹ năng",
  get_event_rsvp: "RSVP sự kiện",
  get_reputation_history: "Uy tín",
  get_live_matches: "Trận đang live",
  get_match_score_detail: "Chi tiết điểm",
  compare_players: "So sánh VĐV",
  get_tournament_schedule: "Lịch thi đấu",
  get_tournament_rules: "Luật thi đấu",
  get_court_status: "Trạng thái sân",
  get_match_live_log: "Diễn biến trận",
  get_tournament_payment_info: "Lệ phí",
  get_bracket_groups: "Nhóm/bảng đấu",
  get_user_casual_stats: "Thống kê tự do",
  get_match_rating_impact: "Ảnh hưởng rating",
  get_user_profile_detail: "Hồ sơ VĐV",
  get_tournament_progress: "Tiến độ giải",
  get_match_video: "Video trận",
  get_tournament_referees: "Trọng tài giải",
  get_seeding_info: "Hạt giống",
  get_player_ranking: "Điểm xếp hạng",
  get_player_tournament_history: "Lịch sử giải",
  get_bracket_match_tree: "Cây bracket",
  get_user_match_history: "Lịch sử tự do",
  get_tournament_age_check: "Kiểm tra tuổi",
  get_match_duration: "Thời lượng trận",
  get_tournament_standings: "Kết quả giải",
  get_user_stats: "Thống kê VĐV",
  navigate: "Điều hướng",
  search_knowledge: "Tra cứu",
  query_db: "Truy vấn DB",
  get_app_config: "Cấu hình app",
};

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
5. Nếu user hỏi chung chung (vd "tìm giải"), hãy HỎI LẠI để làm rõ (khu vực, trình độ) thay vì search bừa.
6. Luôn trả lời bằng tiếng Việt trừ khi user dùng tiếng Anh
7. Bạn ĐƯỢC PHÉP trả lời về: kiến thức Pickleball (luật, thuật ngữ, kỹ thuật), giải đấu, VĐV, tính năng app
8. Chỉ từ chối các câu hỏi hoàn toàn không liên quan (chính trị, 18+, tài chính...)

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
Khi user muốn "mở", "vào", "xem trang", "đi đến" một trang nào đó:
1. Nếu cần tournamentId → gọi search_tournaments trước để lấy ID
2. Sau đó gọi navigate với screen + tournamentId/bracketId/courtCode
3. Hệ thống sẽ TỰ ĐỘNG hiện nút bấm để user chuyển trang
QUAN TRỌNG: KHÔNG tạo markdown link [text](url) trong reply. Chỉ cần gọi tool navigate, hệ thống sẽ tự hiện nút.
Ví dụ: "mở sơ đồ giải ABC" → search_tournaments(name:"ABC") → navigate(screen:"bracket", tournamentId: ...) → reply: "Đã mở sơ đồ giải ABC!"

# Tools có sẵn
Bạn có các tools để truy vấn dữ liệu. Dùng tools phù hợp nhất với câu hỏi.
- 🔍 search_knowledge: Tìm FAQ/hướng dẫn (ƯU TIÊN gọi trước khi trả lời kiến thức)
- 🧭 navigate: Điều hướng màn hình app (NHỚ lấy ID trước nếu cần)
- 🔥 query_db: Query bất kỳ collection khi KHÔNG có tool chuyên biệt

# Ngữ cảnh trang
Khi có "Context hiện tại" với Tournament ID → user đang ở trang giải đấu đó.
- Nếu user hỏi "giải này", "bảng 1", "sân nào", "ai đăng ký" → dùng Tournament ID từ context, KHÔNG cần gọi search_tournaments.
- Nếu user hỏi về một giải KHÁC tên → gọi search_tournaments bình thường.

# Khi nào dùng query_db
- Khi KHÔNG có tool chuyên biệt phù hợp
- Collections: tournaments, users, registrations, matches, brackets, courts, ratingChanges, assessments, reputationEvents, scoreHistories
- Filter hỗ trợ MongoDB operators: $regex, $gte, $lte, $in, $or, $exists...
- Context variables: {{currentUserId}}, {{tournamentId}}, {{matchId}}, {{bracketId}}, {{courtCode}}
`.trim();

// Tool group descriptions - only sent when the group is selected
const TOOL_GROUP_PROMPTS = {
  tournament_info: `
- 🏆 search_tournaments: Tìm giải (tên, tỉnh)
- 📊 get_tournament_details/summary: Chi tiết + stats giải
- 📐 get_tournament_rules: Luật thi đấu (bestOf, điểm/ván)
- 📆 get_tournament_schedule: Lịch thi đấu theo ngày/sân
- 💰 get_tournament_payment_info: Lệ phí, bank, liên hệ
- 👑 get_tournament_managers: BTC giải
- 📊 get_tournament_progress: Tiến độ giải (% xong)
- 🎂 get_tournament_age_check: Điều kiện tuổi
- 👨‍⚖️ get_tournament_referees: DS trọng tài`.trim(),
  tournament_data: `
- 📋 get_tournament_brackets: Bảng đấu trong giải
- 📝 get_tournament_registrations: Đội đăng ký
- 🏟️ get_tournament_courts: Sân đấu
- 🏆 get_tournament_standings: Xếp hạng giải (vô địch, á quân)
- ⚔️ get_tournament_matches: Trận đấu giải
- 🎲 get_draw_results: Bốc thăm chia bảng
- 🔢 count_registrations: Đếm đăng ký`.trim(),
  bracket: `
- 📊 get_bracket_standings: BXH bảng (W-L, set diff)
- 👥 get_bracket_groups: Ai trong bảng nào?
- 🌳 get_bracket_match_tree: Cây bracket/đường đấu
- 🌱 get_seeding_info: Hạt giống, drawSize`.trim(),
  match: `
- ℹ️ get_match_info: Chi tiết trận
- 🎯 get_match_score_detail: Điểm từng ván
- 📝 get_match_live_log: Diễn biến point-by-point
- 🎥 get_match_video: Link video/FB live
- ⏱️ get_match_duration: Thời lượng trận
- 📈 get_match_rating_impact: Ảnh hưởng rating
- 🎥 get_match_recordings: Video replay
- 🟢 get_live_matches: Trận đang diễn ra`.trim(),
  user_personal: `
- 📝 get_my_registrations: Đăng ký giải của tôi
- 📈 get_my_rating_changes: Biến động rating
- 🔔 get_my_subscriptions: Theo dõi
- 📱 get_my_devices: Thiết bị
- ✅ check_my_registration: Kiểm tra đăng ký
- 🔐 get_login_history: Lịch sử đăng nhập
- 📅 get_upcoming_matches: Trận sắp tới`.trim(),
  user_stats: `
- 📈 get_user_stats: Thống kê VĐV (win rate, tổng trận)
- 🏅 get_player_ranking: Ranking (single/double/mix/tier)
- 📜 get_player_tournament_history: Lịch sử giải + W-L
- 📊 get_score_history: Biến động điểm kỹ năng
- ⭐ get_reputation_history: Uy tín
- 👤 get_user_profile_detail: Hồ sơ VĐV
- 🎓 get_player_evaluations: Chấm trình
- 🏆 get_leaderboard: BXH`.trim(),
  user_social: `
- 🔍 search_users: Tìm người dùng
- 🤝 compare_players: So sánh 2 VĐV
- ⚔️ get_head_to_head: Đối đầu A vs B
- 🎯 get_user_matches: Lịch sử trận VĐV
- 🆓 get_user_match_history: Trận tự do
- 🎮 get_user_casual_stats: Thống kê tự do
- 🎾 get_casual_matches: Trận casual/practice
- 📍 get_radar_nearby: Ai gần muốn đánh`.trim(),
  club: `
- 🏅 search_clubs: Tìm CLB
- 🏛️ get_club_details: Chi tiết CLB
- 👥 get_club_members: Thành viên
- 📅 get_club_events: Sự kiện CLB
- 📢 get_club_announcements: Thông báo
- 🗳️ get_club_polls: Bình chọn
- 📩 get_club_join_requests: Đơn gia nhập`.trim(),
  live: `
- 📺 get_live_streams: Trận đang live
- 📡 get_live_channels: Kênh live (FB/YT)
- 🟢 get_live_matches: Trận đang diễn ra
- 🏟️ get_court_status: Trạng thái sân`.trim(),
  misc: `
- 📰 search_news: Tin tức
- 🤝 get_sponsors: Nhà tài trợ
- 🎟️ get_support_tickets: Hỗ trợ
- ⚠️ get_complaints: Khiếu nại
- ✉️ get_reg_invites: Lời mời đăng ký
- 📋 get_event_rsvp: RSVP sự kiện CLB
- 🆕 get_app_version: Phiên bản app
- 📦 get_app_update_info: Cập nhật app`.trim(),
};

function buildToolPromptSection(selectedGroups) {
  const parts = [];
  for (const group of selectedGroups) {
    if (TOOL_GROUP_PROMPTS[group]) {
      parts.push(TOOL_GROUP_PROMPTS[group]);
    }
  }
  return parts.length ? `\n\n# Tools chuyên biệt\n${parts.join("\n")}` : "";
}

// ─────────────── TOOL FILTERING ───────────────
// Group tools by category to only send relevant ones to OpenAI

const TOOL_GROUPS = {
  core: [
    "search_knowledge",
    "navigate",
    "query_db",
    "get_my_info",
    "get_app_config",
    "get_cms_content",
  ],
  tournament_info: [
    "search_tournaments",
    "get_tournament_details",
    "get_tournament_summary",
    "get_tournament_rules",
    "get_tournament_schedule",
    "get_tournament_payment_info",
    "get_tournament_managers",
    "get_tournament_progress",
    "get_tournament_age_check",
    "get_tournament_referees",
  ],
  tournament_data: [
    "get_tournament_brackets",
    "get_tournament_registrations",
    "get_tournament_courts",
    "get_tournament_standings",
    "get_tournament_matches",
    "get_draw_results",
    "count_registrations",
  ],
  bracket: [
    "get_bracket_standings",
    "get_bracket_groups",
    "get_bracket_match_tree",
    "get_seeding_info",
  ],
  match: [
    "get_match_info",
    "get_match_score_detail",
    "get_match_live_log",
    "get_match_video",
    "get_match_duration",
    "get_match_rating_impact",
    "get_match_recordings",
    "get_live_matches",
  ],
  user_personal: [
    "get_my_registrations",
    "get_my_rating_changes",
    "get_my_subscriptions",
    "get_my_devices",
    "check_my_registration",
    "get_login_history",
    "get_upcoming_matches",
  ],
  user_stats: [
    "get_user_stats",
    "get_player_ranking",
    "get_player_tournament_history",
    "get_score_history",
    "get_reputation_history",
    "get_user_profile_detail",
    "get_player_evaluations",
    "get_leaderboard",
    "get_most_active_players",
  ],
  user_social: [
    "search_users",
    "compare_players",
    "get_head_to_head",
    "get_user_matches",
    "get_user_match_history",
    "get_user_casual_stats",
    "get_casual_matches",
    "get_radar_nearby",
  ],
  club: [
    "search_clubs",
    "get_club_details",
    "get_club_members",
    "get_club_events",
    "get_club_announcements",
    "get_club_polls",
    "get_club_join_requests",
  ],
  live: [
    "get_live_streams",
    "get_live_channels",
    "get_live_matches",
    "get_court_status",
  ],
  misc: [
    "search_news",
    "get_sponsors",
    "get_support_tickets",
    "get_complaints",
    "get_reg_invites",
    "get_event_rsvp",
    "get_app_version",
    "get_app_update_info",
  ],
};

// Keyword → groups mapping
const KEYWORD_GROUPS = [
  {
    keywords: [
      "giải",
      "tournament",
      "giải đấu",
      "lệ phí",
      "phí",
      "luật",
      "quy định",
      "lịch thi đấu",
      "ban tổ chức",
      "BTC",
      "trọng tài",
      "tiến độ",
      "tuổi",
    ],
    groups: ["tournament_info", "tournament_data"],
  },
  {
    keywords: [
      "bảng",
      "bracket",
      "vòng",
      "hạt giống",
      "seed",
      "đường đấu",
      "nhóm",
    ],
    groups: ["bracket"],
  },
  {
    keywords: [
      "trận",
      "match",
      "tỉ số",
      "score",
      "điểm",
      "ván",
      "live",
      "video",
      "diễn biến",
      "thời lượng",
      "kéo dài",
    ],
    groups: ["match"],
  },
  {
    keywords: [
      "của tôi",
      "tôi đã",
      "đăng ký",
      "rating",
      "thiết bị",
      "đăng nhập",
      "trận sắp",
    ],
    groups: ["user_personal"],
  },
  {
    keywords: [
      "ranking",
      "xếp hạng",
      "điểm",
      "thống kê",
      "skill",
      "kỹ năng",
      "uy tín",
      "hồ sơ",
      "BXH",
      "leaderboard",
      "đánh giá",
      "chấm trình",
      "lịch sử giải",
    ],
    groups: ["user_stats"],
  },
  {
    keywords: [
      "so sánh",
      "đối đầu",
      "VĐV",
      "người chơi",
      "player",
      "tìm người",
      "radar",
      "tự do",
      "casual",
    ],
    groups: ["user_social"],
  },
  {
    keywords: [
      "CLB",
      "câu lạc bộ",
      "club",
      "thành viên",
      "sự kiện CLB",
      "bình chọn",
    ],
    groups: ["club"],
  },
  {
    keywords: ["live", "trực tiếp", "stream", "kênh", "sân"],
    groups: ["live"],
  },
  {
    keywords: [
      "tin tức",
      "tài trợ",
      "hỗ trợ",
      "khiếu nại",
      "app",
      "phiên bản",
      "cập nhật",
      "RSVP",
    ],
    groups: ["misc"],
  },
];

function selectTools(message, context, memory = []) {
  const msg = message.toLowerCase();
  const selectedGroups = new Set(["core"]); // Always include core

  // 1. Add groups based on message keywords
  for (const { keywords, groups } of KEYWORD_GROUPS) {
    if (keywords.some((kw) => msg.includes(kw.toLowerCase()))) {
      groups.forEach((g) => selectedGroups.add(g));
    }
  }

  // 2. Add groups based on page URL context
  const pagePath = context.currentPath || context.pagePath || "";
  if (/\/pickle-ball\/[^/]+\/match/i.test(pagePath)) {
    selectedGroups.add("match");
    selectedGroups.add("tournament_data");
  } else if (/\/pickle-ball\/[^/]+/i.test(pagePath)) {
    selectedGroups.add("tournament_info");
    selectedGroups.add("tournament_data");
    selectedGroups.add("bracket");
  } else if (/\/clubs\/[^/]+/i.test(pagePath)) {
    selectedGroups.add("club");
  } else if (/\/clubs/i.test(pagePath)) {
    selectedGroups.add("club");
  } else if (/\/rankings/i.test(pagePath)) {
    selectedGroups.add("user_stats");
  } else if (/\/live/i.test(pagePath)) {
    selectedGroups.add("live");
  } else if (/\/profile/i.test(pagePath)) {
    selectedGroups.add("user_personal");
    selectedGroups.add("user_stats");
  }

  // 3. Add groups based on context IDs
  if (context.tournamentId) {
    selectedGroups.add("tournament_info");
    selectedGroups.add("tournament_data");
    selectedGroups.add("bracket");
  }
  if (context.matchId) selectedGroups.add("match");
  if (context.bracketId) selectedGroups.add("bracket");
  if (context.currentUserId) selectedGroups.add("user_personal");

  // 4. Conversation follow-up: check recent memory for tools used
  if (memory.length > 0) {
    const recentContent = memory
      .slice(-4)
      .map((m) => m.content || "")
      .join(" ")
      .toLowerCase();
    // Build reverse lookup: tool name → group
    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
      if (tools.some((t) => recentContent.includes(t))) {
        selectedGroups.add(group);
      }
    }
  }

  // 5. Fallback: if no keyword matched, add common groups
  if (selectedGroups.size <= 1) {
    selectedGroups.add("tournament_info");
    selectedGroups.add("user_stats");
    selectedGroups.add("user_personal");
  }

  // Collect tool names
  const toolNames = new Set();
  for (const group of selectedGroups) {
    (TOOL_GROUPS[group] || []).forEach((t) => toolNames.add(t));
  }

  // Filter TOOL_DEFINITIONS
  const tools = TOOL_DEFINITIONS.filter((td) =>
    toolNames.has(td.function?.name),
  );

  return { tools, selectedGroups };
}

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

  // 1) Load memory & profile in parallel
  const [memory, userProfile] = await Promise.all([
    userId ? getRecentMessages(userId, 6) : [],
    userId ? fetchUserProfile(userId) : null,
  ]);

  // 2) Build system prompt with context
  let systemContent = SYSTEM_PROMPT;
  const contextParts = [];

  if (userProfile) {
    contextParts.push(
      `User hiện tại:\n- Tên: ${userProfile.name} (${userProfile.nickname || ""})\n- Rating: ${userProfile.rating}\n- Khu vực: ${userProfile.province || "N/A"}`,
    );
  }

  if (context.currentUserId)
    contextParts.push(`User ID: ${context.currentUserId}`);
  if (context.tournamentId)
    contextParts.push(
      `Tournament ID hiện tại: ${context.tournamentId} (user đang xem giải này, dùng ID này khi user hỏi về "giải này", "bảng 1", "sân nào trống"...)`,
    );
  if (context.matchId) contextParts.push(`Match ID: ${context.matchId}`);
  if (context.bracketId) contextParts.push(`Bracket ID: ${context.bracketId}`);
  if (context.courtCode) contextParts.push(`Court code: ${context.courtCode}`);
  if (context.courtId) contextParts.push(`Court ID: ${context.courtId}`);

  // Page context — describe what page user is on
  if (context.currentPath) {
    const p = context.currentPath;
    let pageDesc = p;
    if (/\/tournament\/[^/]+\/bracket/i.test(p))
      pageDesc = "Trang sơ đồ nhánh đấu (bracket)";
    else if (/\/tournament\/[^/]+\/schedule/i.test(p))
      pageDesc = "Trang lịch thi đấu";
    else if (/\/tournament\/[^/]+\/register/i.test(p))
      pageDesc = "Trang đăng ký giải";
    else if (/\/tournament\/[^/]+\/checkin/i.test(p))
      pageDesc = "Trang check-in giải";
    else if (/\/tournament\/[^/]+\/overview/i.test(p))
      pageDesc = "Trang tổng quan giải đấu";
    else if (/\/tournament\/[^/]+\/manage/i.test(p))
      pageDesc = "Trang quản lý giải đấu";
    else if (/\/tournament\/[^/]+\/draw/i.test(p))
      pageDesc = "Trang bốc thăm / xếp hạt giống";
    else if (/\/tournament\/[a-f0-9]{24}$/i.test(p))
      pageDesc = "Trang chi tiết giải đấu";
    else if (/\/pickle-ball\/tournaments/i.test(p))
      pageDesc = "Trang danh sách giải đấu";
    else if (/\/pickle-ball\/rankings/i.test(p))
      pageDesc = "Trang bảng xếp hạng";
    else if (/\/clubs\/[^/]+/i.test(p)) pageDesc = "Trang chi tiết câu lạc bộ";
    else if (/\/clubs/i.test(p)) pageDesc = "Trang danh sách câu lạc bộ";
    else if (/\/live/i.test(p)) pageDesc = "Trang xem trực tiếp";
    else if (/\/profile/i.test(p)) pageDesc = "Trang cá nhân";
    else if (p === "/" || p === "") pageDesc = "Trang chủ";
    contextParts.push(`User đang xem: ${pageDesc}`);
  }

  if (contextParts.length > 0) {
    systemContent += `\n\n# Context hiện tại\n${contextParts.join("\n")}`;
  }

  // 3) Select relevant tools and build dynamic prompt
  const { tools: selectedTools, selectedGroups } = selectTools(
    message,
    context,
    memory,
  );
  systemContent += buildToolPromptSection(selectedGroups);
  if (isDev)
    console.log(
      `[Agent] Selected ${selectedTools.length}/${TOOL_DEFINITIONS.length} tools (groups: ${[...selectedGroups].join(", ")})`,
    );

  // 3.5) Build messages array
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
        tools: selectedTools,
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

      // Auto-learn if applicable (async)
      maybeLearn(message, reply, toolsUsed).catch((err) =>
        console.error("Learning error:", err),
      );

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
            content: truncateResult(JSON.stringify(result)),
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

  // 1) Load memory & profile in parallel
  const [memory, userProfile] = await Promise.all([
    userId ? getRecentMessages(userId, 6) : [],
    userId ? fetchUserProfile(userId) : null,
  ]);

  // 2) Build system prompt with context
  let systemContent = SYSTEM_PROMPT;
  const contextParts = [];

  if (userProfile) {
    contextParts.push(
      `User hiện tại:\n- Tên: ${userProfile.name} (${userProfile.nickname || ""})\n- Rating: ${userProfile.rating}\n- Khu vực: ${userProfile.province || "N/A"}`,
    );
  }

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

  // 3) Select relevant tools and build dynamic prompt
  const { tools: selectedTools, selectedGroups } = selectTools(
    message,
    context,
    memory,
  );
  systemContent += buildToolPromptSection(selectedGroups);
  if (isDev)
    console.log(
      `[Agent] Selected ${selectedTools.length}/${TOOL_DEFINITIONS.length} tools (groups: ${[...selectedGroups].join(", ")})`,
    );

  // 3.5) Build messages array
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
        tools: selectedTools,
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

      // Auto-learn if applicable (async)
      maybeLearn(message, reply, toolsUsed).catch((err) =>
        console.error("Learning error:", err),
      );

      // Generate smart follow-up suggestions
      const suggestions = await generateSuggestions(
        message,
        reply,
        userId,
        context,
        userProfile,
      );
      if (suggestions.length > 0) {
        emit("suggestions", { suggestions });
      }

      emit("done", {});

      // Return for logging by caller
      return { reply, toolsUsed, navigation, processingTime, suggestions };
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
        emit("tool_start", {
          tool: fnName,
          label: TOOL_LABELS[fnName] || fnName,
          args: fnArgs,
        });

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
              webPath: result.webPath || null,
              description: result.description,
            };
          }

          // Build preview
          const preview = buildToolPreview(fnName, result);

          emit("tool_done", {
            tool: fnName,
            label: TOOL_LABELS[fnName] || fnName,
            resultPreview: preview,
            durationMs: Date.now() - toolStart,
          });

          return {
            tool_call_id: toolCall.id,
            role: "tool",
            content: truncateResult(JSON.stringify(result)),
          };
        } catch (err) {
          console.error(`[Agent] Tool ${fnName} error:`, err.message);
          emit("tool_done", {
            tool: fnName,
            label: TOOL_LABELS[fnName] || fnName,
            resultPreview: isDev ? `Lỗi: ${err.message}` : "Lỗi khi xử lý",
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
  if (result.error) return isDev ? `Lỗi: ${result.error}` : "Lỗi khi xử lý";

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
    case "get_tournament_matches":
      return result.total != null
        ? `${result.total} trận (🔴 ${result.stats?.live || 0} live, ✅ ${result.stats?.finished || 0} xong)`
        : "Đã lấy thông tin trận";
    case "get_my_info":
      return "Đã lấy thông tin cá nhân";
    case "get_tournament_brackets":
      return result.total != null
        ? `${result.total} bảng đấu`
        : "Đã lấy bảng đấu";
    case "get_tournament_registrations":
      return result.totalRegistrations != null
        ? `${result.totalRegistrations} đội (💰 ${result.stats?.paid || 0} paid, ✅ ${result.stats?.checkedIn || 0} check-in)`
        : "Đã lấy đội đăng ký";
    case "get_tournament_courts":
      return result.total != null
        ? `${result.total} sân (🟢 ${result.stats?.idle || 0} trống, 🔴 ${result.stats?.live || 0} live)`
        : "Đã lấy sân đấu";
    case "search_clubs":
      return result.count
        ? `Tìm thấy ${result.count} CLB`
        : "Không tìm thấy CLB nào";
    case "get_tournament_summary":
      return result.tournament?.name
        ? `${result.tournament.name}: ${result.stats?.totalRegistrations || 0} đội, ${result.stats?.progress || "0%"} hoàn thành`
        : "Đã lấy tổng quan giải";
    case "get_club_details":
      return result.name
        ? `CLB ${result.name} (${result.memberCount} thành viên)`
        : "Đã lấy thông tin CLB";
    case "get_bracket_standings":
      return result.total != null
        ? `BXH ${result.bracket}: ${result.total} đội`
        : "Đã lấy bảng xếp hạng";
    case "get_user_matches":
      return result.stats
        ? `${result.total} trận (${result.stats.wins}W/${result.stats.losses}L - ${result.stats.winRate})`
        : "Đã lấy lịch sử trận đấu";
    case "get_club_members":
      return result.totalMembers != null
        ? `${result.totalMembers} thành viên (hiển ${result.showing})`
        : "Đã lấy thành viên CLB";
    case "get_club_events":
      return result.total != null
        ? `${result.total} sự kiện ${result.type === "upcoming" ? "sắp tới" : "đã qua"}`
        : "Đã lấy sự kiện CLB";
    case "search_news":
      return result.total != null
        ? `${result.total} bài viết`
        : "Đã tìm tin tức";
    case "get_sponsors":
      return result.total != null
        ? `${result.total} nhà tài trợ`
        : "Đã lấy nhà tài trợ";
    case "get_player_evaluations":
      return result.latestOverall
        ? `Đơn: ${result.latestOverall.singles || "?"} / Đôi: ${result.latestOverall.doubles || "?"} (${result.total} lượt chấm)`
        : "Đã lấy chấm trình";
    case "get_live_streams":
      return result.total != null
        ? `${result.total} luồng đang live`
        : "Đã kiểm tra trực tiếp";
    case "get_club_announcements":
      return result.total != null
        ? `${result.total} thông báo (${result.pinnedCount || 0} ghim)`
        : "Đã lấy thông báo CLB";
    case "get_reg_invites":
      return result.total != null
        ? `${result.total} lời mời`
        : "Đã lấy lời mời đăng ký";
    case "get_support_tickets":
      return result.total != null
        ? `${result.total} ticket`
        : "Đã lấy ticket hỗ trợ";
    case "get_my_subscriptions":
      return result.total != null
        ? `Đang theo dõi ${result.total} topic`
        : "Đã lấy subscriptions";
    case "get_casual_matches":
      return result.stats
        ? `${result.total} trận tự do (${result.stats.wins}W/${result.stats.losses}L)`
        : "Đã lấy trận tự do";
    case "get_complaints":
      return result.total != null
        ? `${result.total} khiếu nại`
        : "Đã lấy khiếu nại";
    case "get_club_polls":
      return result.total != null
        ? `${result.total} bình chọn`
        : "Đã lấy bình chọn CLB";
    case "get_club_join_requests":
      return result.total != null
        ? `${result.total} đơn xin`
        : "Đã lấy đơn gia nhập";
    case "get_tournament_managers":
      return result.total != null
        ? `${result.total} quản lý`
        : "Đã lấy quản lý giải";
    case "get_match_recordings":
      return result.total != null
        ? `${result.total} video replay`
        : "Đã lấy video";
    case "get_draw_results":
      return result.total != null
        ? `${result.total} kết quả bốc thăm`
        : "Đã lấy kết quả bốc thăm";
    case "get_radar_nearby":
      return result.total != null
        ? `${result.total} người gần đây`
        : result.message || "Đã kiểm tra radar";
    case "get_login_history":
      return result.lastLogin
        ? `Đăng nhập cuối: ${new Date(result.lastLogin).toLocaleDateString("vi-VN")}`
        : "Đã lấy lịch sử đăng nhập";
    case "get_cms_content":
      return result.slug
        ? `Nội dung: ${result.slug}`
        : result.total != null
          ? `${result.total} CMS blocks`
          : "Đã lấy CMS";
    case "get_my_devices":
      return result.total != null
        ? `${result.total} thiết bị`
        : "Đã lấy thiết bị";
    case "get_app_version":
      return result.versions?.length
        ? `v${result.versions[0].version} (${result.versions[0].platform})`
        : "Đã lấy phiên bản";
    case "get_live_channels":
      return result.total != null
        ? `${result.total} kênh live`
        : "Đã lấy kênh live";
    case "get_app_update_info":
      return result.configs?.length
        ? `v${result.configs[0].latestVersion} (${result.configs[0].platform})`
        : "Đã lấy thông tin cập nhật";
    case "check_my_registration":
      return result.registered
        ? `Đã đăng ký (${result.total} đội)`
        : "Chưa đăng ký";
    case "get_head_to_head":
      return result.totalMatches != null
        ? `${result.totalMatches} trận đối đầu (${result.winsA}-${result.winsB})`
        : "Đã tra lịch sử đối đầu";
    case "get_upcoming_matches":
      return result.total != null
        ? `${result.total} trận sắp tới`
        : "Đã lấy lịch thi đấu";
    case "get_score_history":
      return result.total != null
        ? `${result.total} lần chấm điểm`
        : "Đã lấy lịch sử điểm";
    case "get_event_rsvp":
      return result.going != null
        ? `${result.going} tham gia, ${result.notGoing} không`
        : "Đã lấy RSVP";
    case "get_reputation_history":
      return result.totalBonus != null
        ? `Tổng bonus: ${result.totalBonus}% (${result.total} lần)`
        : "Đã lấy lịch sử uy tín";
    case "get_live_matches":
      return result.total != null
        ? `${result.total} trận đang live`
        : "Đã kiểm tra live matches";
    case "get_match_score_detail":
      return result.games?.length
        ? `${result.games.length} ván (${result.games.map((g) => `${g.scoreA}-${g.scoreB}`).join(", ")})`
        : "Đã lấy chi tiết điểm";
    case "compare_players":
      return result.playerA && result.playerB
        ? `${result.playerA.name} vs ${result.playerB.name}`
        : "Đã so sánh VĐV";
    case "get_tournament_schedule":
      return result.total != null
        ? `${result.total} trận trong lịch`
        : "Đã lấy lịch thi đấu";
    case "get_tournament_rules":
      return result.total != null ? `${result.total} bảng đấu` : "Đã lấy luật";
    case "get_bracket_standings":
      return result.standings?.length
        ? `${result.standings.length} đội xếp hạng`
        : "Đã lấy xếp hạng";
    case "get_court_status":
      return result.total != null
        ? `${result.total} sân (${result.idle || 0} trống, ${result.live || 0} live)`
        : "Đã kiểm tra sân";
    case "get_match_live_log":
      return result.totalEvents != null
        ? `${result.totalEvents} events diễn biến`
        : "Đã lấy diễn biến";
    case "get_tournament_payment_info":
      return result.registrationFee != null
        ? `Lệ phí: ${result.registrationFee.toLocaleString("vi-VN")}đ`
        : "Đã lấy thông tin thanh toán";
    case "get_bracket_groups":
      return result.totalGroups != null
        ? `${result.totalGroups} nhóm`
        : "Đã lấy nhóm";
    case "get_user_casual_stats":
      return result.totalMatches != null
        ? `${result.totalMatches} trận (${result.winRate} winRate)`
        : "Đã lấy thống kê";
    case "get_match_rating_impact":
      return result.ratingDelta != null
        ? `Δ rating: ${result.ratingDelta > 0 ? "+" : ""}${result.ratingDelta}`
        : "Đã lấy rating";
    case "get_user_profile_detail":
      return result.name ? `${result.name} (${result.role})` : "Đã lấy hồ sơ";
    case "get_tournament_progress":
      return result.matches?.progressPercent
        ? `${result.matches.progressPercent} hoàn tất`
        : "Đã lấy tiến độ";
    case "get_match_video":
      return result.hasVideo ? "Có video/livestream" : "Không có video";
    case "get_tournament_referees":
      return result.total != null
        ? `${result.total} trọng tài`
        : "Đã lấy DS trọng tài";
    case "get_seeding_info":
      return result.total != null
        ? `${result.total} bảng đấu`
        : "Đã lấy hạt giống";
    case "get_player_ranking":
      return result.single != null
        ? `Đơn: ${result.single} | Đôi: ${result.double} (${result.tierLabel})`
        : "Đã lấy ranking";
    case "get_player_tournament_history":
      return result.total != null ? `${result.total} giải` : "Đã lấy lịch sử";
    case "get_bracket_match_tree":
      return result.total != null
        ? `${result.total} trận trong bracket`
        : "Đã lấy bracket tree";
    case "get_user_match_history":
      return result.total != null
        ? `${result.total} trận tự do`
        : "Đã lấy lịch sử";
    case "get_tournament_age_check":
      return result.eligible != null
        ? result.eligible
          ? "Đủ điều kiện tuổi"
          : "Không đủ tuổi"
        : "Đã kiểm tra tuổi";
    case "get_match_duration":
      return result.durationMinutes != null
        ? `${result.durationMinutes} phút`
        : result.avgDurationMinutes != null
          ? `TB ${result.avgDurationMinutes} phút (${result.totalMatches} trận)`
          : "Đã lấy thời lượng";
    default:
      return "Hoàn tất";
  }
}

// ─────────────── HELPERS ───────────────

/**
 * Fetch basic user profile for personalization
 */
async function fetchUserProfile(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId)
      .select("name nickname localRatings province")
      .lean();
    if (!user) return null;
    return {
      name: user.name,
      nickname: user.nickname,
      rating: user.localRatings?.doubles || 2.5,
      province: user.province,
    };
  } catch {
    return null;
  }
}

/**
 * Generate smart follow-up suggestions based on conversation context
 * Uses a lightweight GPT call for speed
 */
async function generateSuggestions(
  userMessage,
  botReply,
  userId,
  context = {},
  userProfile = null,
) {
  try {
    // Build context string for suggestions
    let contextHint = "";
    if (userProfile) {
      contextHint += `User: ${userProfile.name} (Rating ${userProfile.rating}, ${userProfile.province || ""}). `;
    }
    if (context.tournamentId) contextHint += "Đang xem giải đấu. ";
    if (context.matchId) contextHint += "Đang xem trận đấu. ";
    if (context.currentPath) contextHint += `Page: ${context.currentPath}.`;

    const res = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `Bạn là Pikora, trợ lý PickleTour. Gợi ý 3 câu hỏi tiếp theo dựa trên hội thoại và ngữ cảnh.
Context: ${contextHint}

Quy tắc:
- Ngắn gọn (dưới 30 ký tự)
- Cá nhân hóa theo user/context nếu có
- Đa dạng (chi tiết/liên quan/chuyển hướng)
- Tiếng Việt
- Trả về JSON array: ["Gợi ý 1", "Gợi ý 2"]
- KHÔNG giải thích`,
        },
        {
          role: "user",
          content: `User: "${userMessage}"\nBot: "${botReply.substring(0, 300)}"`,
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

function truncateResult(str) {
  if (str.length <= MAX_TOOL_RESULT_CHARS) return str;
  return (
    str.slice(0, MAX_TOOL_RESULT_CHARS) +
    "\n... [truncated — data quá dài, chỉ hiển thị phần đầu]"
  );
}

// ─────────────── BOT IDENTITY (export cho controller) ───────────────

export const BOT_IDENTITY = {
  name: "Pikora",
  nameVi: "Pikora - Trợ lý PickleTour",
  version: "3.0",
  engine: "agent-function-calling",
  personality: ["Thân thiện", "Vui vẻ", "Chuyên nghiệp", "Ngắn gọn"],
};
