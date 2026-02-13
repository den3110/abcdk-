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
  get_tournament_standings: dbTools.get_tournament_standings,
  get_tournament_matches: dbTools.get_tournament_matches,
  get_tournament_brackets: dbTools.get_tournament_brackets,
  get_tournament_registrations: dbTools.get_tournament_registrations,
  get_tournament_courts: dbTools.get_tournament_courts,
  search_clubs: dbTools.search_clubs,
  get_tournament_summary: dbTools.get_tournament_summary,
  get_club_details: dbTools.get_club_details,
  get_bracket_standings: dbTools.get_bracket_standings,
  get_user_matches: dbTools.get_user_matches,
  get_club_members: dbTools.get_club_members,
  get_club_events: dbTools.get_club_events,
  search_news: dbTools.search_news,
  get_sponsors: dbTools.get_sponsors,
  get_player_evaluations: dbTools.get_player_evaluations,
  get_live_streams: dbTools.get_live_streams,
  get_club_announcements: dbTools.get_club_announcements,
  get_reg_invites: dbTools.get_reg_invites,
  get_support_tickets: dbTools.get_support_tickets,
  get_my_subscriptions: dbTools.get_my_subscriptions,
  get_casual_matches: dbTools.get_casual_matches,
  get_complaints: dbTools.get_complaints,
  get_club_polls: dbTools.get_club_polls,
  get_club_join_requests: dbTools.get_club_join_requests,
  get_tournament_managers: dbTools.get_tournament_managers,
  get_match_recordings: dbTools.get_match_recordings,
  get_draw_results: dbTools.get_draw_results,
  get_radar_nearby: dbTools.get_radar_nearby,
  get_login_history: dbTools.get_login_history,
  get_cms_content: dbTools.get_cms_content,
  get_my_devices: dbTools.get_my_devices,
  get_app_version: dbTools.get_app_version,
  get_live_channels: dbTools.get_live_channels,
  get_app_update_info: dbTools.get_app_update_info,
  check_my_registration: dbTools.check_my_registration,
  get_head_to_head: dbTools.get_head_to_head,
  get_upcoming_matches: dbTools.get_upcoming_matches,
  get_score_history: dbTools.get_score_history,
  get_event_rsvp: dbTools.get_event_rsvp,
  get_reputation_history: dbTools.get_reputation_history,
  get_live_matches: dbTools.get_live_matches,
  get_match_score_detail: dbTools.get_match_score_detail,
  compare_players: dbTools.compare_players,
  get_tournament_schedule: dbTools.get_tournament_schedule,
  get_tournament_rules: dbTools.get_tournament_rules,
  get_bracket_standings: dbTools.get_bracket_standings,
  get_court_status: dbTools.get_court_status,
  get_match_live_log: dbTools.get_match_live_log,
  get_tournament_payment_info: dbTools.get_tournament_payment_info,
  get_bracket_groups: dbTools.get_bracket_groups,
  get_user_casual_stats: dbTools.get_user_casual_stats,
  get_match_rating_impact: dbTools.get_match_rating_impact,
  get_user_profile_detail: dbTools.get_user_profile_detail,
  get_tournament_progress: dbTools.get_tournament_progress,
  get_match_video: dbTools.get_match_video,
  get_tournament_referees: dbTools.get_tournament_referees,
  get_seeding_info: dbTools.get_seeding_info,
  get_player_ranking: dbTools.get_player_ranking,
  get_player_tournament_history: dbTools.get_player_tournament_history,
  get_bracket_match_tree: dbTools.get_bracket_match_tree,
  get_user_match_history: dbTools.get_user_match_history,
  get_tournament_age_check: dbTools.get_tournament_age_check,
  get_match_duration: dbTools.get_match_duration,
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
          sortBy: {
            type: "string",
            enum: ["ratingDoubles", "ratingSingles", "name"],
            description:
              "Sắp xếp kết quả. Dùng khi user hỏi 'điểm cao nhất', 'rating cao nhất'",
          },
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
        "Xem bảng xếp hạng VĐV (reputation, điểm đơn, điểm đôi, mix, points). Dùng Ranking model giống trang BXH thật. Có thể sort theo từng loại điểm.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng top (mặc định 10)" },
          sortBy: {
            type: "string",
            enum: ["single", "double", "mix", "points", "reputation"],
            description:
              "Sort theo loại điểm nào. VD: 'single' = điểm đơn, 'double' = điểm đôi, 'mix' = điểm đánh mix, 'points' = tổng điểm, 'reputation' = uy tín. Không truyền = sort mặc định (tier→double→single→points).",
          },
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
        "Điều hướng màn hình. QUAN TRỌNG: Nếu cần mở giải đấu/trận/bảng, PHẢI search trước để lấy ID, rồi truyền ID vào hàm này.",
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
            description: "ID giải đấu (BẮT BUỘC nếu mở màn hình giải đấu)",
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
        "Tìm kiếm thông tin trong knowledge base: hướng dẫn, FAQ, chính sách, tính năng app, VÀ kiến thức bot đã học được từ hội thoại trước. LUÔN gọi tool này trước khi trả lời câu hỏi.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Câu hỏi hoặc từ khóa cần tìm",
          },
          category: {
            type: "string",
            enum: ["faq", "guide", "feature", "policy", "learned"],
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
      name: "get_tournament_matches",
      description:
        "Lấy danh sách trận đấu của 1 giải đấu kèm thống kê: trận đang live, trận dài nhất, trận chênh lệch điểm nhất, tên đội, tỉ số. Dùng khi user hỏi về các trận đấu trong giải.",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
          status: {
            type: "string",
            enum: ["scheduled", "queued", "assigned", "live", "finished"],
            description: "Lọc theo trạng thái trận (tuỳ chọn)",
          },
          bracketId: {
            type: "string",
            description: "ID bảng đấu cụ thể (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 20, max 30)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_brackets",
      description:
        'Lấy danh sách bảng đấu (brackets) trong 1 giải: tên bảng, loại (knockout/group/...), luật chơi, số trận live/xong/chờ. Dùng khi user hỏi "giải có bao nhiêu bảng", "bảng đôi nam là gì".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_registrations",
      description:
        'Danh sách đội đăng ký giải hoặc trong 1 bảng đấu cụ thể. Trả tên VĐV, trạng thái thanh toán, check-in. Dùng khi user hỏi "ai đăng ký giải X", "bảng A có mấy đội", "đội nào check-in rồi". Truyền bracketId nếu hỏi về 1 bảng cụ thể.',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
          bracketId: {
            type: "string",
            description:
              "ID bảng đấu — truyền khi muốn lấy đội trong bảng cụ thể (tuỳ chọn)",
          },
          paymentStatus: {
            type: "string",
            enum: ["Paid", "Unpaid"],
            description: "Lọc theo trạng thái thanh toán (tuỳ chọn)",
          },
          hasCheckin: {
            type: "boolean",
            description: "true = đã check-in, false = chưa check-in (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số đội tối đa (mặc định 20, max 50)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_courts",
      description:
        'Danh sách sân đấu trong giải: tên sân, trạng thái (idle/live/assigned), trận đang chơi trên sân. Dùng khi user hỏi "sân nào đang trống", "sân 3 có trận gì".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clubs",
      description:
        'Tìm câu lạc bộ (CLB) theo tên hoặc tỉnh/thành. Dùng khi user hỏi "CLB nào ở Hà Nội", "tìm CLB pickleball ABC".',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên CLB cần tìm (tuỳ chọn)",
          },
          province: {
            type: "string",
            description: "Tỉnh/thành phố (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số CLB tối đa (mặc định 5, max 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_summary",
      description:
        'Tổng quan toàn diện 1 giải đấu: thông tin cơ bản + số bảng + số đội + số trận (live/xong/chờ) + số sân + tiến độ %. Dùng khi user hỏi "cho tôi tổng quan giải X", "giải X đang như nào".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_details",
      description:
        'Chi tiết đầy đủ của 1 câu lạc bộ: tên, mô tả, số thành viên, chủ CLB, tỉnh/thành, chính sách gia nhập, link MXH. Dùng khi user hỏi "CLB X ở đâu", "CLB này có bao nhiêu thành viên".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID của CLB",
          },
          slug: {
            type: "string",
            description: "Slug URL của CLB (thay cho clubId)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_standings",
      description:
        'BXH (bảng xếp hạng) của 1 bảng đấu vòng tròn/round-robin/swiss. Trả rank, tên đội, thắng/thua, điểm, hiệu sets/points. Dùng khi user hỏi "BXH bảng A", "ai đứng nhất", "thứ hạng trong bảng". KHÔNG dùng cho knockout (dùng get_tournament_standings thay vào).',
      parameters: {
        type: "object",
        properties: {
          bracketId: {
            type: "string",
            description: "ID bảng đấu (BẮT BUỘC)",
          },
          tournamentId: {
            type: "string",
            description: "ID giải đấu (tuỳ chọn)",
          },
        },
        required: ["bracketId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_matches",
      description:
        'Lịch sử trận đấu của 1 VĐV: tên đối thủ, tỷ số, thắng/thua, thời gian, sân. Dùng khi user hỏi "trận đấu của tôi", "tôi thắng mấy trận", "lịch sử thi đấu".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID của VĐV — bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Giới hạn trong 1 giải (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["scheduled", "live", "finished"],
            description: "Lọc trạng thái trận (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 10, max 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_members",
      description:
        'Danh sách thành viên CLB: tên, role (owner/admin/member), ngày gia nhập. Dùng khi user hỏi "CLB có ai?", "admin CLB là ai?".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          role: {
            type: "string",
            enum: ["owner", "admin", "member"],
            description: "Lọc theo role (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số thành viên tối đa (mặc định 20, max 50)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_events",
      description:
        'Sự kiện của CLB: tiêu đề, địa điểm, thời gian, số người tham dự. Dùng khi user hỏi "CLB có event gì?", "sự kiện sắp tới của CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          upcoming: {
            type: "boolean",
            description: "true = sắp tới, false = đã qua (mặc định true)",
          },
          limit: {
            type: "number",
            description: "Số sự kiện tối đa (mặc định 10)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_news",
      description:
        'Tin tức Pickleball: tiêu đề, tóm tắt, nguồn, ngày đăng. Dùng khi user hỏi "tin tức mới?", "có gì mới hôm nay?".',
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Từ khóa tìm kiếm (tuỳ chọn)",
          },
          tag: {
            type: "string",
            description: "Lọc theo tag (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số bài tối đa (mặc định 5, max 15)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sponsors",
      description:
        'Nhà tài trợ: tên, hạng (Platinum/Gold/Silver/Bronze), mô tả, website. Dùng khi user hỏi "ai tài trợ giải?", "sponsor giải này".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu — bỏ trống để lấy tất cả sponsor",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_evaluations",
      description:
        'Kết quả chấm trình VĐV: điểm singles/doubles, chi tiết kỹ năng, người chấm. Dùng khi user hỏi "trình độ của tôi?", "ai chấm tôi bao nhiêu?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID của VĐV — bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_streams",
      description:
        'Danh sách trực tiếp: provider (facebook/youtube/tiktok), link xem, trận đang phát. Dùng khi user hỏi "trận nào đang live?", "link xem trực tiếp".',
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["CREATED", "LIVE", "ENDED"],
            description: "Lọc trạng thái (mặc định LIVE)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_announcements",
      description:
        'Thông báo CLB: tiêu đề, nội dung, ghim, người viết. Dùng khi user hỏi "CLB có thông báo gì?", "tin tức CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          limit: {
            type: "number",
            description: "Số thông báo tối đa (mặc định 10)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reg_invites",
      description:
        'Lời mời đăng ký giải: ai mời, trạng thái (pending/accepted/declined). Dùng khi user hỏi "ai mời tôi đăng ký?", "lời mời của tôi".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải đấu (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["pending", "accepted", "declined", "cancelled", "expired"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_support_tickets",
      description:
        'Ticket hỗ trợ: tiêu đề, trạng thái, tin nhắn cuối. Dùng khi user hỏi "ticket hỗ trợ của tôi", "tôi đã gửi yêu cầu chưa?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          status: {
            type: "string",
            enum: ["open", "resolved", "closed"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_subscriptions",
      description:
        'User đang theo dõi giải/CLB nào: loại topic, tên, kênh thông báo. Dùng khi user hỏi "tôi đang theo dõi gì?", "notification của tôi".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          topicType: {
            type: "string",
            enum: ["tournament", "match", "club", "org", "global"],
            description: "Lọc loại topic (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_casual_matches",
      description:
        'Trận tự do (UserMatch) của user: trận casual, practice, club. Dùng khi user hỏi "trận tự do của tôi", "trận casual gần đây".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          status: {
            type: "string",
            enum: ["scheduled", "queued", "assigned", "live", "finished"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
          category: {
            type: "string",
            enum: [
              "casual",
              "practice",
              "club",
              "league",
              "tournament",
              "other",
            ],
            description: "Loại trận (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 10, max 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_complaints",
      description:
        'Khiếu nại giải đấu: nội dung, trạng thái, phản hồi BTC. Dùng khi user hỏi "khiếu nại của tôi", "tôi đã phản ánh gì?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["pending", "reviewed", "resolved", "rejected"],
            description: "Lọc trạng thái",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_polls",
      description:
        'Bình chọn CLB: câu hỏi, lựa chọn, số vote. Dùng khi user hỏi "CLB có bình chọn gì?", "poll CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: { type: "string", description: "ID CLB (BẮT BUỘC)" },
          limit: { type: "number", description: "Số poll tối đa (mặc định 5)" },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_join_requests",
      description:
        'Đơn xin vào CLB: trạng thái (pending/accepted/rejected). Dùng khi user hỏi "tôi đã xin vào CLB chưa?", "đơn gia nhập CLB".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          clubId: { type: "string", description: "ID CLB" },
          status: {
            type: "string",
            enum: ["pending", "accepted", "rejected", "cancelled"],
            description: "Lọc trạng thái",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_managers",
      description:
        'Quản lý giải đấu: tên, role, SĐT. Dùng khi user hỏi "ai quản lý giải?", "liên hệ BTC".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_recordings",
      description:
        'Video replay trận: trạng thái, thời lượng, dung lượng. Dùng khi user hỏi "xem lại trận", "video trận này".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (BẮT BUỘC)" },
          status: {
            type: "string",
            enum: ["recording", "merging", "ready", "failed"],
            description: "Lọc trạng thái (mặc định ready)",
          },
        },
        required: ["matchId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_draw_results",
      description:
        'Kết quả bốc thăm/xếp hạt giống: chia bảng, cặp đấu knockout. Dùng khi user hỏi "bốc thăm bảng nào?", "kết quả chia bảng".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng đấu (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_radar_nearby",
      description:
        'Radar: người chơi gần đây đang muốn đánh. Dùng khi user hỏi "ai gần tôi muốn đánh?", "radar", "tìm bạn đánh".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          maxDistanceKm: {
            type: "number",
            description: "Bán kính km (mặc định 10)",
          },
          limit: {
            type: "number",
            description: "Số người tối đa (mặc định 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_login_history",
      description:
        'Lịch sử đăng nhập: thời gian, phương thức, thiết bị. Dùng khi user hỏi "lịch sử đăng nhập", "đăng nhập lần cuối".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cms_content",
      description:
        'Nội dung CMS (FAQ, quy định, hướng dẫn...). Không có slug → liệt kê các slug khả dụng. Dùng khi user hỏi "quy định giải", "FAQ", "hướng dẫn".',
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description:
              "Slug CMS block (vd: hero, contact, faq). Bỏ trống để xem danh sách",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_devices",
      description:
        'Thiết bị đã đăng ký: tên, hãng, model, phiên bản app. Dùng khi user hỏi "thiết bị của tôi", "tôi dùng điện thoại gì?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_version",
      description:
        'Phiên bản app mới nhất: version, mô tả, bắt buộc. Dùng khi user hỏi "phiên bản mới nhất?", "cập nhật app".',
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["ios", "android"],
            description: "ios hoặc android (tuỳ chọn, mặc định cả 2)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_channels",
      description:
        'Kênh live stream: Facebook, YouTube, TikTok. Dùng khi user hỏi "kênh live nào?", "live trên đâu?".',
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["facebook", "youtube", "tiktok"],
            description: "Lọc theo nền tảng (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_update_info",
      description:
        'Thông tin cập nhật app: phiên bản store, link tải, changelog, bắt buộc cập nhật. Dùng khi user hỏi "link tải app?", "có cập nhật bắt buộc?", "changelog".',
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["all", "ios", "android"],
            description: "Nền tảng (mặc định: tất cả)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_my_registration",
      description:
        'Kiểm tra tôi đã đăng ký giải chưa: mã đăng ký, thanh toán, check-in. Dùng khi user hỏi "tôi đăng ký chưa?", "mã đăng ký của tôi?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_head_to_head",
      description:
        'Lịch sử đối đầu giữa 2 VĐV: thắng/thua, điểm từng trận. Dùng khi user hỏi "A vs B bao nhiêu lần?", "lịch sử đối đầu".',
      parameters: {
        type: "object",
        properties: {
          playerAId: { type: "string", description: "ID VĐV A" },
          playerBId: { type: "string", description: "ID VĐV B" },
        },
        required: ["playerAId", "playerBId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_matches",
      description:
        'Trận sắp tới của tôi: sân, giờ, đối thủ. Dùng khi user hỏi "trận tới của tôi?", "tôi đánh lúc mấy?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn)",
          },
          limit: { type: "number", description: "Số trận (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_score_history",
      description:
        'Lịch sử chấm điểm kỹ năng: single/double score theo thời gian. Dùng khi user hỏi "điểm của tôi thay đổi thế nào?", "lịch sử điểm".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_rsvp",
      description:
        'Danh sách RSVP sự kiện CLB: ai tham gia, ai không. Dùng khi user hỏi "ai đi sự kiện?", "tôi RSVP chưa?".',
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "ID sự kiện CLB" },
          userId: {
            type: "string",
            description: "Kiểm tra RSVP của ai (tuỳ chọn)",
          },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reputation_history",
      description:
        'Lịch sử uy tín: bonus từ các giải. Dùng khi user hỏi "uy tín của tôi?", "reputation thay đổi?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_matches",
      description:
        'Trận đang live: điểm hiện tại, sân, đội. Dùng khi user hỏi "trận nào đang đánh?", "live match?", "match nào đang diễn ra?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn, lấy từ context)",
          },
          limit: { type: "number", description: "Số trận (mặc định 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_score_detail",
      description:
        'Chi tiết điểm từng ván: scoreA, scoreB, best-of, cap. Dùng khi user hỏi "ván 1 bao nhiêu-bao nhiêu?", "chi tiết điểm trận?".',
      parameters: {
        type: "object",
        properties: {
          matchId: {
            type: "string",
            description: "ID trận (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_players",
      description:
        'So sánh 2 VĐV: rating, skill, reputation, số trận, số giải. Dùng khi user hỏi "so sánh A với B?", "ai giỏi hơn?".',
      parameters: {
        type: "object",
        properties: {
          playerAId: { type: "string", description: "ID VĐV A" },
          playerBId: { type: "string", description: "ID VĐV B" },
        },
        required: ["playerAId", "playerBId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_schedule",
      description:
        'Lịch thi đấu giải: trận theo ngày, sân, vòng. Dùng khi user hỏi "lịch thi đấu ngày mai?", "schedule sân 1?", "trận nào vòng 2?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          date: {
            type: "string",
            description: "Ngày lọc (YYYY-MM-DD, tuỳ chọn)",
          },
          courtLabel: { type: "string", description: "Tên sân lọc (tuỳ chọn)" },
          limit: { type: "number", description: "Số trận (mặc định 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_rules",
      description:
        'Luật thi đấu từng bảng: bestOf, điểm/ván, cap, seeding method, format config. Dùng khi user hỏi "luật giải?", "đánh mấy ván?", "seeding kiểu gì?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          bracketId: {
            type: "string",
            description: "ID bảng cụ thể (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_standings",
      description:
        'Bảng xếp hạng vòng bảng/RR/Swiss: W-L, điểm, set diff, points diff. Dùng khi user hỏi "bảng xếp hạng?", "ai nhất bảng A?", "standings?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          groupName: {
            type: "string",
            description: "Lọc theo tên nhóm (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_court_status",
      description:
        'Trạng thái sân real-time: idle/live/assigned, trận đang đánh. Dùng khi user hỏi "sân nào trống?", "sân 1 có ai?", "tình hình sân?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          courtName: {
            type: "string",
            description: "Lọc theo tên sân (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_live_log",
      description:
        'Diễn biến trận point-by-point: điểm, serve, undo, break. Dùng khi user hỏi "diễn biến trận?", "ai ghi điểm cuối?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
          limit: {
            type: "number",
            description: "Số events cuối (mặc định 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_payment_info",
      description:
        'Lệ phí đăng ký, thông tin ngân hàng, liên hệ BTC. Dùng khi user hỏi "lệ phí bao nhiêu?", "chuyển khoản đâu?", "liên hệ BTC?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_groups",
      description:
        'Thành viên từng nhóm/bảng: danh sách đội, skill score. Dùng khi user hỏi "bảng A có ai?", "nhóm của tôi?", "ai trong pool 2?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          groupName: {
            type: "string",
            description: "Lọc theo tên nhóm (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_casual_stats",
      description:
        'Thống kê trận tự do (UserMatch): W-L, winRate, điểm, phân loại. Dùng khi user hỏi "thành tích tự do?", "tôi thắng bao nhiêu trận?", "stats casual?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          category: {
            type: "string",
            description: "Lọc loại: casual/practice/club/league (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_rating_impact",
      description:
        'Rating thay đổi sau trận: oldRating, newRating, delta mỗi VĐV. Dùng khi user hỏi "rating tôi thay đổi bao nhiêu?", "ảnh hưởng rating trận vừa rồi?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_profile_detail",
      description:
        'Thông tin chi tiết VĐV: localRatings (singles/doubles), tỉnh, CCCD, role, evaluator. Dùng khi user hỏi "thông tin VĐV X?", "rating đơn/đôi?", "profile?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_progress",
      description:
        'Tiến độ giải: % trận xong, số trận live/chờ, sân hoạt động, trạng thái bảng. Dùng khi user hỏi "giải tiến hành tới đâu?", "bao nhiêu trận xong?", "progress?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_video",
      description:
        'Link video/livestream trận: URL YouTube, FB live, embed. Dùng khi user hỏi "xem lại trận?", "có video không?", "link livestream?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_referees",
      description:
        'DS trọng tài giải: tên, nickname, tỉnh. Dùng khi user hỏi "ai làm trọng tài?", "trọng tài giải này?", "referee list?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_seeding_info",
      description:
        'Hạt giống & bốc thăm: seed number, drawSize, phương pháp seeding, ratingKey. Dùng khi user hỏi "hạt giống?", "ai seed 1?", "bốc thăm kiểu gì?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_ranking",
      description:
        'Điểm xếp hạng VĐV: single/double/mix/points, tier (Gold/Red/Grey), reputation. Dùng khi user hỏi "điểm của tôi?", "ranking VĐV X?", "hạng mấy?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          name: { type: "string", description: "Tên VĐV (tuỳ chọn)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_tournament_history",
      description:
        'Lịch sử tham gia giải: danh sách giải, W-L mỗi giải, seed, trạng thái. Dùng khi user hỏi "tôi đã đá mấy giải?", "giải nào tôi tham gia?", "thành tích giải?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          limit: { type: "number", description: "Số giải (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_match_tree",
      description:
        'Cây bracket: tất cả trận theo round/order, team, winner, nextMatch. Dùng khi user hỏi "đường đấu?", "ai gặp ai vòng sau?", "bracket tree?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_match_history",
      description:
        'Lịch sử trận tự do (UserMatch): kết quả, điểm, người chơi, địa điểm. Dùng khi user hỏi "lịch sử trận tự do?", "tôi đá đâu gần đây?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          category: {
            type: "string",
            description: "Loại: casual/practice/club/league",
          },
          status: {
            type: "string",
            description: "Trạng thái: scheduled/live/finished",
          },
          limit: { type: "number", description: "Số trận (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_age_check",
      description:
        'Kiểm tra điều kiện tuổi giải: giới hạn tuổi, năm sinh. Dùng khi user hỏi "tôi đủ tuổi không?", "giải giới hạn tuổi?", "sinh năm mấy được đăng ký?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          userId: { type: "string", description: "ID user (lấy từ context)" },
          dob: {
            type: "string",
            description: "Ngày sinh (YYYY-MM-DD, tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_duration",
      description:
        'Thời lượng trận: phút, hoặc trung bình cả giải. Dùng khi user hỏi "trận kéo dài bao lâu?", "trung bình mấy phút?", "trận dài nhất?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
          tournamentId: {
            type: "string",
            description: "ID giải (xem stats cả giải)",
          },
          limit: { type: "number", description: "(không dùng, reserved)" },
        },
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
  {
    type: "function",
    function: {
      name: "get_tournament_standings",
      description:
        "Lấy kết quả xếp hạng chung cuộc của giải đấu knockout: vô địch (hạng 1), á quân (hạng 2), hạng 3 (hoặc đồng hạng 3), hạng 4. Dùng khi user hỏi 'ai vô địch', 'đội nào hạng nhất', 'kết quả chung cuộc', 'xếp hạng giải'.",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu",
          },
          bracketId: {
            type: "string",
            description:
              "ID bracket cụ thể (tuỳ chọn, nếu không truyền sẽ lấy tất cả bracket knockout)",
          },
        },
      },
    },
  },
];
