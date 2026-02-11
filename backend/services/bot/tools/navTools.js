// services/bot/tools/navTools.js
// Navigation tool - điều hướng trong app

const SCREENS = {
  tournament_list: {
    screen: "TournamentList",
    deepLink: "pickletour://tournaments",
    description: "Danh sách giải đấu",
  },
  tournament_detail: {
    screen: "TournamentDetail",
    deepLink: "pickletour://tournament/{tournamentId}",
    requires: ["tournamentId"],
    description: "Chi tiết giải đấu",
  },
  bracket: {
    screen: "Bracket",
    deepLink: "pickletour://bracket/{bracketId}",
    requires: ["bracketId"],
    description: "Sơ đồ nhánh đấu",
  },
  schedule: {
    screen: "Schedule",
    deepLink: "pickletour://schedule/{tournamentId}",
    requires: ["tournamentId"],
    description: "Lịch thi đấu",
  },
  registration: {
    screen: "Registration",
    deepLink: "pickletour://register/{tournamentId}",
    requires: ["tournamentId"],
    description: "Đăng ký giải đấu",
  },
  court_detail: {
    screen: "CourtDetail",
    deepLink: "pickletour://court/{courtCode}",
    requires: ["courtCode"],
    description: "Chi tiết sân",
  },
  profile: {
    screen: "Profile",
    deepLink: "pickletour://profile",
    description: "Trang cá nhân",
  },
  settings: {
    screen: "Settings",
    deepLink: "pickletour://settings",
    description: "Cài đặt",
  },
  leaderboard: {
    screen: "Leaderboard",
    deepLink: "pickletour://rankings",
    description: "Bảng xếp hạng",
  },
  notifications: {
    screen: "Notifications",
    deepLink: "pickletour://notifications",
    description: "Thông báo",
  },
  home: {
    screen: "Home",
    deepLink: "pickletour://home",
    description: "Trang chủ",
  },
  kyc: {
    screen: "KYC",
    deepLink: "pickletour://kyc",
    description: "Xác thực danh tính KYC",
  },
  clubs: {
    screen: "Clubs",
    deepLink: "pickletour://clubs",
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
    const params = { tournamentId, bracketId, courtCode, ...context };
    const missing = cfg.requires.filter((r) => !params[r]);
    if (missing.length > 0) {
      return {
        error: `Cần thêm thông tin: ${missing.join(", ")}`,
        missingContext: missing,
      };
    }
  }

  // Build deepLink
  let deepLink = cfg.deepLink;
  const params = { tournamentId, bracketId, courtCode, ...context };
  deepLink = deepLink.replace(/\{(\w+)\}/g, (_, key) => params[key] || "");

  return {
    screen: cfg.screen,
    deepLink,
    description: cfg.description,
    message: `Đã mở ${cfg.description}`,
  };
}
