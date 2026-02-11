// services/bot/tools/index.js
// Tool registry - OpenAI function calling definitions + executors

import * as dbTools from "./dbTools.js";
import * as navTools from "./navTools.js";
import * as knowledgeTools from "./knowledgeTools.js";

// ─────────────── TOOL EXECUTORS ───────────────
// Map tool name → function
export const TOOL_EXECUTORS = {
  search_tournaments: dbTools.search_tournaments,
  get_tournament_details: dbTools.get_tournament_details,
  count_registrations: dbTools.count_registrations,
  search_users: dbTools.search_users,
  get_my_info: dbTools.get_my_info,
  get_match_info: dbTools.get_match_info,
  get_leaderboard: dbTools.get_leaderboard,
  get_my_registrations: dbTools.get_my_registrations,
  get_my_rating_changes: dbTools.get_my_rating_changes,
  query_db: dbTools.query_db,
  get_user_stats: dbTools.get_user_stats,
  navigate: navTools.navigate,
  search_knowledge: knowledgeTools.search_knowledge,
};

// ─────────────── OPENAI TOOL SCHEMAS ───────────────
// Format: https://platform.openai.com/docs/guides/function-calling

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_tournaments",
      description:
        "Tìm kiếm giải đấu pickleball theo tên hoặc trạng thái (upcoming, ongoing, finished)",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên giải đấu (tìm gần đúng)",
          },
          status: {
            type: "string",
            enum: ["upcoming", "ongoing", "finished"],
            description:
              "Trạng thái giải: upcoming=sắp tới, ongoing=đang diễn ra, finished=đã kết thúc",
          },
          limit: { type: "number", description: "Số lượng kết quả tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_details",
      description: "Xem chi tiết 1 giải đấu cụ thể theo ID",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (ObjectId)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_registrations",
      description: "Đếm số đội/cặp đã đăng ký trong 1 giải đấu",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_users",
      description:
        "Tìm kiếm VĐV/người chơi theo tên. Chỉ trả về thông tin công khai (tên, nickname, rating, tỉnh). KHÔNG trả phone/email.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên VĐV cần tìm",
          },
          limit: { type: "number", description: "Số lượng tối đa" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_info",
      description:
        "Lấy thông tin cá nhân của user hiện tại (tên, SĐT, email, rating, KYC...). Chỉ dùng khi user hỏi về BẢN THÂN.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_info",
      description:
        "Xem chi tiết trận đấu: team A/B, tỉ số từng ván (gameScores), trạng thái, winner (A hoặc B)",
      parameters: {
        type: "object",
        properties: {
          matchId: {
            type: "string",
            description:
              "ID trận đấu. Nếu user nói 'trận NÀY', dùng matchId từ context.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leaderboard",
      description:
        "Xem bảng xếp hạng VĐV (reputation, điểm đơn, điểm đôi, points). Dùng Ranking model giống trang BXH thật.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng top (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_registrations",
      description:
        "Xem danh sách giải đấu mà user hiện tại đã đăng ký tham gia",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_rating_changes",
      description: "Xem lịch sử thay đổi rating của user hiện tại",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["singles", "doubles"],
            description: "Loại hình: đánh đơn hoặc đánh đôi",
          },
          limit: { type: "number", description: "Số lượng tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description:
        "Điều hướng/mở 1 màn hình trong app. Dùng khi user muốn 'mở', 'vào', 'xem', 'đi đến' 1 trang.",
      parameters: {
        type: "object",
        properties: {
          screen: {
            type: "string",
            enum: [
              "tournament_list",
              "tournament_detail",
              "bracket",
              "schedule",
              "registration",
              "court_detail",
              "profile",
              "settings",
              "leaderboard",
              "notifications",
              "home",
              "kyc",
              "clubs",
            ],
            description: "Màn hình cần mở",
          },
          tournamentId: {
            type: "string",
            description: "ID giải đấu (nếu cần)",
          },
          bracketId: { type: "string", description: "ID bảng đấu (nếu cần)" },
          courtCode: { type: "string", description: "Mã sân (nếu cần)" },
        },
        required: ["screen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Tìm kiếm thông tin trong knowledge base: hướng dẫn sử dụng, FAQ, chính sách, tính năng app PickleTour. Dùng khi user hỏi 'cách đăng ký', 'KYC là gì', 'rating tính thế nào'...",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Câu hỏi hoặc từ khóa cần tìm",
          },
          category: {
            type: "string",
            enum: ["faq", "guide", "feature", "policy"],
            description: "Danh mục (không bắt buộc)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_db",
      description:
        "🔥 GENERIC: Query bất kỳ collection nào trong database. Dùng khi KHÔNG có tool chuyên biệt phù hợp. Collections: tournaments, users, registrations, matches, brackets, courts, ratingChanges, assessments, reputationEvents, scoreHistories. Filter hỗ trợ MongoDB operators ($regex, $gte, $in, $or...). Context variables: {{currentUserId}}, {{tournamentId}}, {{matchId}}, {{bracketId}}, {{courtCode}}",
      parameters: {
        type: "object",
        properties: {
          collection: {
            type: "string",
            enum: [
              "tournaments",
              "users",
              "registrations",
              "matches",
              "brackets",
              "courts",
              "ratingChanges",
              "assessments",
              "reputationEvents",
              "scoreHistories",
            ],
            description: "Tên collection cần query",
          },
          filter: {
            type: "object",
            description:
              'MongoDB filter object. Ví dụ: {"status": "upcoming"}, {"name": {"$regex": "abc", "$options": "i"}}, {"tournament": "{{tournamentId}}"}',
          },
          sort: {
            type: "object",
            description:
              'Sort object. Ví dụ: {"createdAt": -1}, {"localRatings.doubles": -1}',
          },
          limit: {
            type: "number",
            description: "Số lượng kết quả tối đa (max 20)",
          },
          populate: {
            type: "string",
            description: 'Populate relations. Ví dụ: "tournament", "user"',
          },
        },
        required: ["collection"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description:
        "Thống kê chi tiết 1 VĐV: rating, tổng trận, thắng, thua, win rate, số giải tham gia. Dùng khi user hỏi 'thành tích', 'thống kê', 'so sánh' VĐV.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "ID VĐV (nếu đã biết)",
          },
          name: {
            type: "string",
            description: "Tên VĐV (tìm gần đúng nếu chưa có ID)",
          },
        },
      },
    },
  },
];
