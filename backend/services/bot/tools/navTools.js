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
