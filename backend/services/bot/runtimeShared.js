import User from "../../models/userModel.js";

export function createBotIdentity({
  version,
  engine,
  personality = ["Thân thiện", "Vui vẻ", "Chuyên nghiệp", "Ngắn gọn"],
} = {}) {
  return {
    name: "Pikora",
    nameVi: "Pikora - Trợ lý PickleTour",
    version: version || "4.0",
    engine: engine || "shared-runtime",
    personality,
  };
}

export const TOOL_LABELS = {
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

export function buildToolPreview(
  tool,
  result,
  { isDev = process.env.NODE_ENV !== "production" } = {},
) {
  if (!result) return "Không có kết quả";
  if (result.error) return isDev ? `Lỗi: ${result.error}` : "Lỗi khi xử lý";

  switch (tool) {
    case "search_knowledge":
      return result.results?.length
        ? `Tìm thấy ${result.results.length} bài viết`
        : result.count
          ? `Tìm thấy ${result.count} mục kiến thức`
          : "Không tìm thấy thông tin";
    case "search_tournaments":
      return result.count
        ? `Tìm thấy ${result.count} giải đấu`
        : "Không tìm thấy giải nào";
    case "search_players":
    case "search_users":
      return result.count
        ? `Tìm thấy ${result.count} VĐV`
        : "Không tìm thấy VĐV nào";
    case "get_user_stats":
      return result.name
        ? `Thống kê ${result.name}: ${result.wonMatches ?? result.totalWon ?? 0}W/${result.lostMatches ?? result.totalLost ?? 0}L`
        : "Đã lấy thống kê VĐV";
    case "get_leaderboard":
      return result.players?.length
        ? `BXH: ${result.players.length} VĐV`
        : "Đã lấy BXH";
    case "query_db":
      return result.count != null
        ? `Truy vấn ${result.collection}: ${result.count} kết quả`
        : "Đã truy vấn DB";
    case "navigate":
      return result.description || "Đã chuẩn bị điều hướng";
    case "get_tournament_matches":
      return result.total != null
        ? `${result.total} trận (${result.stats?.live || 0} live, ${result.stats?.finished || 0} xong)`
        : "Đã lấy thông tin trận";
    case "get_my_info":
      return result.name
        ? `Đã lấy hồ sơ của ${result.name}`
        : "Đã lấy thông tin cá nhân";
    case "get_tournament_brackets":
      return result.total != null
        ? `${result.total} bảng đấu`
        : "Đã lấy bảng đấu";
    case "get_tournament_registrations":
      return result.totalRegistrations != null
        ? `${result.totalRegistrations} đội (${result.stats?.paid || 0} paid, ${result.stats?.checkedIn || 0} check-in)`
        : "Đã lấy đội đăng ký";
    case "get_tournament_courts":
      return result.total != null
        ? `${result.total} sân (${result.stats?.idle || 0} trống, ${result.stats?.live || 0} live)`
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
        ? `CLB ${result.name} (${result.memberCount || 0} thành viên)`
        : "Đã lấy thông tin CLB";
    case "get_bracket_standings":
      return result.total != null
        ? `BXH ${result.bracket}: ${result.total} đội`
        : result.standings?.length
          ? `${result.standings.length} đội xếp hạng`
          : "Đã lấy bảng xếp hạng";
    case "get_user_matches":
      return result.stats
        ? `${result.total} trận (${result.stats.wins}W/${result.stats.losses}L - ${result.stats.winRate})`
        : "Đã lấy lịch sử trận đấu";
    case "get_club_members":
      return result.totalMembers != null
        ? `${result.totalMembers} thành viên (hiện ${result.showing})`
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
      return result.total != null
        ? `${result.total} bảng đấu`
        : "Đã lấy luật";
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
        ? `Delta rating: ${result.ratingDelta > 0 ? "+" : ""}${result.ratingDelta}`
        : "Đã lấy rating";
    case "get_user_profile_detail":
      return result.name
        ? `${result.name} (${result.role})`
        : "Đã lấy hồ sơ";
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

export async function fetchUserProfile(userId) {
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

export function removeDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function normalizeText(value) {
  return removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactList(list) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

export function extractEntityName(message) {
  const cleaned = String(message || "")
    .replace(/[?!.]/g, " ")
    .replace(
      /\b(xin|cho|tôi|toi|mình|minh|giúp|giup|hãy|hay|làm ơn|lam on|vui lòng|vui long|mở|mo|vào|vao|xem|tìm|tim|tra cứu|tra cuu|cho tôi biết|cho toi biet|có thể|co the|giúp tôi|giup toi)\b/gi,
      " ",
    )
    .replace(
      /\b(giải|giai|tournament|câu lạc bộ|cau lac bo|clb|club|tin tức|tin tuc|news|vđv|vdv|người chơi|nguoi choi|player|bảng xếp hạng|bang xep hang|bxh|rating|hồ sơ|ho so|lịch thi đấu|lich thi dau|nhánh đấu|nhanh dau|bracket|trang|page)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned : "";
}

export function extractPairNames(message) {
  const raw = String(message || "");
  const splitters = [" với ", " va ", " vs ", " và "];
  for (const splitter of splitters) {
    const parts = raw.split(new RegExp(splitter, "i"));
    if (parts.length >= 2) {
      return [extractEntityName(parts[0]), extractEntityName(parts[1])];
    }
  }
  return ["", ""];
}
