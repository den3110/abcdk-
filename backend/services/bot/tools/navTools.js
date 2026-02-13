// services/bot/tools/navTools.js
// Navigation tool - điều hướng trong app

const SCREENS = {
  tournament_list: {
    screen: "TournamentList",
    deepLink: "pickletour://tournaments",
    webPath: "/pickle-ball/tournaments",
    description: "Danh sách giải đấu",
  },
  tournament_detail: {
    screen: "TournamentDetail",
    deepLink: "pickletour://tournament/{tournamentId}",
    webPath: "/tournament/{tournamentId}",
    requires: ["tournamentId"],
    description: "Chi tiết giải đấu",
  },
  bracket: {
    screen: "Bracket",
    deepLink: "pickletour://bracket/{bracketId}",
    webPath: "/tournament/{tournamentId}/bracket",
    requires: ["tournamentId"],
    description: "Sơ đồ nhánh đấu",
  },
  schedule: {
    screen: "Schedule",
    deepLink: "pickletour://schedule/{tournamentId}",
    webPath: "/tournament/{tournamentId}/schedule",
    requires: ["tournamentId"],
    description: "Lịch thi đấu",
  },
  registration: {
    screen: "Registration",
    deepLink: "pickletour://register/{tournamentId}",
    webPath: "/tournament/{tournamentId}/register",
    requires: ["tournamentId"],
    description: "Đăng ký giải đấu",
  },
  court_detail: {
    screen: "CourtDetail",
    deepLink: "pickletour://court/{courtCode}",
    webPath: "/courts/{courtCode}",
    requires: ["courtCode"],
    description: "Chi tiết sân",
  },
  profile: {
    screen: "Profile",
    deepLink: "pickletour://profile",
    webPath: "/profile",
    description: "Trang cá nhân",
  },
  settings: {
    screen: "Settings",
    deepLink: "pickletour://settings",
    webPath: "/settings",
    description: "Cài đặt",
  },
  leaderboard: {
    screen: "Leaderboard",
    deepLink: "pickletour://rankings",
    webPath: "/pickle-ball/rankings",
    description: "Bảng xếp hạng",
  },
  notifications: {
    screen: "Notifications",
    deepLink: "pickletour://notifications",
    webPath: "/notifications",
    description: "Thông báo",
  },
  home: {
    screen: "Home",
    deepLink: "pickletour://home",
    webPath: "/",
    description: "Trang chủ",
  },
  kyc: {
    screen: "KYC",
    deepLink: "pickletour://kyc",
    webPath: "/kyc",
    description: "Xác thực danh tính KYC",
  },
  clubs: {
    screen: "Clubs",
    deepLink: "pickletour://clubs",
    webPath: "/clubs",
    description: "Danh sách câu lạc bộ",
  },
  club_detail: {
    screen: "ClubDetail",
    deepLink: "pickletour://clubs/{clubId}",
    webPath: "/clubs/{clubId}",
    requires: ["clubId"],
    description: "Chi tiết câu lạc bộ",
  },
  login: {
    screen: "Login",
    deepLink: "pickletour://login",
    webPath: "/login",
    description: "Đăng nhập",
  },
  register: {
    screen: "Register",
    deepLink: "pickletour://register",
    webPath: "/register",
    description: "Đăng ký tài khoản",
  },
  verify_otp: {
    screen: "VerifyOtp",
    deepLink: "pickletour://verify-otp",
    webPath: "/verify-otp",
    description: "Xác thực OTP",
  },
  register_otp: {
    screen: "RegisterOtp",
    deepLink: "pickletour://register/otp",
    webPath: "/register/otp",
    description: "OTP Đăng ký",
  },
  forgot_password: {
    screen: "ForgotPassword",
    deepLink: "pickletour://forgot-password",
    webPath: "/forgot-password",
    description: "Quên mật khẩu",
  },
  contact: {
    screen: "Contact",
    deepLink: "pickletour://contact",
    webPath: "/contact",
    description: "Liên hệ",
  },
  public_profile: {
    screen: "PublicProfile",
    deepLink: "pickletour://user/{userId}",
    webPath: "/user/{userId}",
    requires: ["userId"],
    description: "Trang cá nhân công khai",
  },
  my_tournaments: {
    screen: "MyTournaments",
    deepLink: "pickletour://my-tournaments",
    webPath: "/my-tournaments",
    description: "Giải đấu của tôi",
  },
  level_point: {
    screen: "LevelPoint",
    deepLink: "pickletour://levelpoint",
    webPath: "/levelpoint",
    description: "Điểm trình độ",
  },
  tournament_checkin: {
    screen: "TournamentCheckin",
    deepLink: "pickletour://tournament/{tournamentId}/checkin",
    webPath: "/tournament/{tournamentId}/checkin",
    requires: ["tournamentId"],
    description: "Check-in giải đấu",
  },
  tournament_overview: {
    screen: "TournamentOverview",
    deepLink: "pickletour://tournament/{tournamentId}/overview",
    webPath: "/tournament/{tournamentId}/overview",
    requires: ["tournamentId"],
    description: "Tổng quan giải đấu",
  },
  tournament_manage: {
    screen: "TournamentManage",
    deepLink: "pickletour://tournament/{tournamentId}/manage",
    webPath: "/tournament/{tournamentId}/manage",
    requires: ["tournamentId"],
    description: "Quản lý giải đấu",
  },
  draw: {
    screen: "Draw",
    deepLink: "pickletour://tournament/{tournamentId}/draw",
    webPath: "/tournament/{tournamentId}/draw",
    requires: ["tournamentId"],
    description: "Bốc thăm",
  },
  admin_draw: {
    screen: "AdminDraw",
    deepLink:
      "pickletour://tournament/{tournamentId}/brackets/{bracketId}/draw",
    webPath: "/tournament/{tournamentId}/brackets/{bracketId}/draw",
    requires: ["tournamentId", "bracketId"],
    description: "Admin Bốc thăm",
  },
  live_matches: {
    screen: "LiveMatches",
    deepLink: "pickletour://live",
    webPath: "/live",
    description: "Trận đấu đang Live",
  },
  live_studio: {
    screen: "LiveStudio",
    deepLink: "pickletour://studio/live",
    webPath: "/studio/live",
    description: "Live Studio",
  },
  court_streaming: {
    screen: "CourtStreaming",
    deepLink: "pickletour://streaming/{courtId}",
    webPath: "/streaming/{courtId}",
    requires: ["courtId"],
    description: "Streaming sân đấu",
  },
  court_live_studio: {
    screen: "CourtLiveStudio",
    deepLink:
      "pickletour://live/{tournamentId}/brackets/{bracketId}/live-studio/{courtId}",
    webPath: "/live/{tournamentId}/brackets/{bracketId}/live-studio/{courtId}",
    requires: ["tournamentId", "bracketId", "courtId"],
    description: "Studio Sân đấu",
  },
  facebook_settings: {
    screen: "FacebookLiveSettings",
    deepLink: "pickletour://settings/facebook",
    webPath: "/settings/facebook",
    description: "Cài đặt Facebook Live",
  },
  admin_users: {
    screen: "AdminUsers",
    deepLink: "pickletour://admin/users",
    webPath: "/admin/users",
    description: "Quản lý người dùng",
  },
};

/**
 * Navigate đến 1 màn hình trong app
 */
export async function navigate(
  { screen, tournamentId, bracketId, courtCode },
  context,
) {
  const cfg = SCREENS[screen];
  if (!cfg) {
    const available = Object.keys(SCREENS).join(", ");
    return {
      error: `Màn hình "${screen}" không tồn tại. Các màn hình: ${available}`,
    };
  }

  // Check required context
  if (cfg.requires) {
    const params = { ...context, tournamentId, bracketId, courtCode };
    const missing = cfg.requires.filter((r) => !params[r]);
    if (missing.length > 0) {
      return {
        error: `Cần thêm thông tin: ${missing.join(", ")}`,
        missingContext: missing,
      };
    }
  }

  // Build deepLink & webPath
  const params = { ...context, tournamentId, bracketId, courtCode };
  const replace = (str) =>
    str.replace(/\{(\w+)\}/g, (_, key) => params[key] || "");

  return {
    screen: cfg.screen,
    deepLink: replace(cfg.deepLink),
    webPath: replace(cfg.webPath || ""),
    description: cfg.description,
    message: `Đã mở ${cfg.description}`,
  };
}
