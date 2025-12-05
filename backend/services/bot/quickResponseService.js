// services/bot/quickResponseService.js
// Quick Response Layer - Xử lý Greeting, FAQ, Small Talk, Navigation
// Sử dụng Qwen 0.5b (local) + Keyword matching
// Bot identity: Trợ lý PickleTour

import axios from "axios";
// ⚠️ chỉnh lại path cho đúng với project của bạn
import Tournament from "../../models/tournamentModel.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_NAV_MODEL || "qwen2.5:0.5b";
const QUICK_RESPONSE_DEBUG = process.env.QUICK_RESPONSE_DEBUG === "true";

// ============================================
// 🤖 BOT IDENTITY - Trợ lý PickleTour
// ============================================

export const BOT_IDENTITY = {
  name: "PickleTour Assistant",
  nameVi: "Trợ lý PickleTour",
  description: "Trợ lý AI của ứng dụng quản lý giải đấu Pickleball",
  personality: [
    "Thân thiện, nhiệt tình",
    "Chuyên về pickleball và giải đấu",
    "Trả lời ngắn gọn, dễ hiểu",
    "Hỗ trợ tiếng Việt",
  ],
};

const SYSTEM_PROMPT = `Bạn là ${BOT_IDENTITY.nameVi} - ${
  BOT_IDENTITY.description
}.
Tính cách: ${BOT_IDENTITY.personality.join(", ")}.
Luôn trả lời ngắn gọn, thân thiện bằng tiếng Việt.
Không bịa thông tin. Nếu không biết thì nói không biết.`;

// ============================================
// 🚫 DATA QUERY DETECTION (Skip Quick Response)
// ============================================

const DATA_QUERY_INDICATORS = [
  // Query/Fetch verbs
  /\b(lấy|lấy ra|cho|cho tôi|cho mình|trả về|hiển thị|xuất)\b/i,
  /\b(get|fetch|retrieve|show me|give me|display)\b/i,
  
  // Info/Data keywords
  /\b(thông tin|chi tiết|dữ liệu|info|information|detail|data)\b.*\b(về|của|cho|nằm)\b/i,
  
  // Quantifiers
  /\bcó bao nhiêu\b/i,
  /\bmấy\b.*\b(đội|cặp|người|vận động viên|vđv|trận)\b/i,
  /\bsố lượng\b/i,
  /\btổng cộng\b/i,
  /\bhow many\b/i,
  
  // Analysis/Check verbs
  /\b(kiểm tra|xem xét|phân tích|check|analyze)\b.*\b(thông tin|dữ liệu)\b/i,
  
  // "What is" questions about data
  /\bchi tiết.*\b(là gì|như thế nào|thế nào|sao)\b/i,
  /\bthông tin.*\b(là gì|gồm|bao gồm)\b/i,
];

/**
 * Phát hiện câu hỏi là data query (lấy dữ liệu) thay vì navigation
 */
function isDataQuery(message) {
  if (!message) return false;
  
  // Check patterns
  const hasQueryPattern = DATA_QUERY_INDICATORS.some(pattern => 
    pattern.test(message)
  );
  
  if (hasQueryPattern) {
    debugLog("⏭️  Detected DATA QUERY pattern");
    return true;
  }
  
  return false;
}

// ============================================
// 🔧 TEXT HELPERS
// ============================================

function normalizeText(str = "") {
  return (
    str
      .toString()
      .trim()
      .toLowerCase()
      // bỏ dấu tiếng Việt
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // bỏ bớt ký tự thừa
      .replace(/[“”"']/g, "")
      .replace(/\s+/g, " ")
  );
}

function debugLog(...args) {
  if (QUICK_RESPONSE_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[QuickResponse]", ...args);
  }
}

// ============================================
// 👋 GREETING PATTERNS
// ============================================

const GREETING_PATTERNS = [
  // Vietnamese
  { patterns: [/^xin\s*chào/i, /^chào\s*(bạn|bot|app)?/i], type: "hello" },
  { patterns: [/^hi\b/i, /^hello\b/i, /^hey\b/i], type: "hello" },
  { patterns: [/^(good\s*)?(morning|sáng)/i], type: "morning" },
  { patterns: [/^(good\s*)?(afternoon|chiều)/i], type: "afternoon" },
  { patterns: [/^(good\s*)?(evening|tối)/i], type: "evening" },
  { patterns: [/^(tạm\s*biệt|bye|goodbye|bái)/i], type: "goodbye" },
  { patterns: [/^(cảm\s*ơn|thanks|thank\s*you|cám\s*ơn)/i], type: "thanks" },
  // Một số slang thường dùng
  { patterns: [/^yo\b/i, /^ê\b/i, /^alo\b/i], type: "hello" },
];

const GREETING_RESPONSES = {
  hello: [
    "Xin chào! Mình là trợ lý PickleTour 🏓 Mình có thể giúp gì cho bạn?",
    "Chào bạn! Mình là trợ lý PickleTour. Bạn cần hỗ trợ gì về giải đấu pickleball không?",
    "Hi! Mình là PickleTour Assistant 🏓 Hỏi mình bất cứ điều gì về giải đấu nhé!",
  ],
  morning: [
    "Chào buổi sáng! Mình là trợ lý PickleTour 🌅 Hôm nay bạn cần gì?",
    "Good morning! Chúc bạn một ngày thi đấu tốt lành 🏓",
  ],
  afternoon: [
    "Chào buổi chiều! Trợ lý PickleTour đây, mình giúp được gì cho bạn?",
    "Chào buổi chiều! Bạn muốn xem giải đấu hay đăng ký thi đấu?",
  ],
  evening: [
    "Chào buổi tối! Trợ lý PickleTour đây 🌙 Mình có thể hỗ trợ gì?",
    "Chào buổi tối! Bạn cần tìm hiểu về giải đấu nào không?",
  ],
  goodbye: [
    "Tạm biệt bạn! Chúc bạn thi đấu thật tốt 🏓",
    "Bye bye! Hẹn gặp lại bạn trên sân pickleball nhé!",
    "Tạm biệt! Nếu cần hỗ trợ, cứ quay lại hỏi mình nhé 👋",
  ],
  thanks: [
    "Không có gì! Rất vui được hỗ trợ bạn 😊",
    "Không có chi! Chúc bạn có những trận đấu thật hay 🏓",
    "Mình rất vui vì đã giúp được bạn! Cần gì cứ hỏi nhé.",
  ],
};

// ============================================
// 💬 SMALL TALK PATTERNS
// ============================================

const SMALL_TALK = {
  // Bot identity
  bot_identity: {
    patterns: [
      /bạn là (ai|gì)/i,
      /mày là (ai|gì)/i,
      /you are/i,
      /who are you/i,
      /giới thiệu (bản thân|về mình)/i,
      /tên (bạn|mày) là gì/i,
    ],
    responses: [
      "Mình là trợ lý PickleTour 🏓 - ứng dụng quản lý giải đấu Pickleball! Mình có thể giúp bạn tìm giải, đăng ký thi đấu, xem lịch đấu, tra cứu điểm rating và nhiều thứ khác.",
      "Mình là PickleTour Assistant - trợ lý AI của app PickleTour. Mình chuyên hỗ trợ về giải đấu pickleball, từ đăng ký, xem lịch đấu đến tra cứu kết quả. Hỏi mình bất cứ gì nhé!",
    ],
  },

  // Bot capabilities
  bot_capabilities: {
    patterns: [
      /bạn (làm|biết làm) (được )?gì/i,
      /bạn (có thể|giúp được) gì/i,
      /chức năng/i,
      /help me/i,
      /hướng dẫn/i,
      /giúp (mình|tôi)/i,
    ],
    responses: [
      `Mình là trợ lý PickleTour, có thể giúp bạn:
• 🏆 Tìm và xem thông tin giải đấu
• 📝 Hướng dẫn đăng ký tham gia giải
• 📅 Xem lịch thi đấu, sơ đồ bảng đấu
• ⭐ Tra cứu điểm rating của bạn
• 🔍 Tìm kiếm VĐV khác
• 📊 Xem kết quả trận đấu

Bạn muốn mình hỗ trợ gì?`,
    ],
  },

  // App info
  app_info: {
    patterns: [
      /pickletour là (gì|app gì)/i,
      /ứng dụng này (là gì|làm gì)/i,
      /app này/i,
    ],
    responses: [
      "PickleTour là ứng dụng quản lý giải đấu Pickleball hàng đầu Việt Nam 🏓 App giúp BTC tổ chức giải chuyên nghiệp và VĐV dễ dàng đăng ký, theo dõi lịch đấu, xem kết quả realtime. Bạn có thể tải app trên App Store và Google Play!",
    ],
  },

  // Pickleball info
  pickleball_info: {
    patterns: [
      /pickleball là (gì|môn gì)/i,
      /giới thiệu (về )?pickleball/i,
      /luật (chơi )?pickleball/i,
      /luật (chơi )/i,
    ],
    responses: [
      "Pickleball là môn thể thao kết hợp giữa tennis, cầu lông và bóng bàn 🏓 Chơi trên sân nhỏ hơn tennis, dùng vợt gỗ/composite và bóng nhựa có lỗ. Môn này dễ học, phù hợp mọi lứa tuổi và đang rất hot tại Việt Nam! Bạn muốn tìm giải để thi đấu không?",
    ],
  },

  // Positive feedback
  positive: {
    patterns: [
      /tuyệt vời/i,
      /hay (quá|lắm)/i,
      /good|great|nice|awesome/i,
      /giỏi (quá|lắm)/i,
      /👍|❤️|🎉/,
    ],
    responses: [
      "Cảm ơn bạn! Rất vui vì đã giúp được bạn 😊",
      "Hehe, cảm ơn bạn nhiều! Cần gì cứ hỏi mình nhé 🏓",
      "Yay! Mình rất vui 😄 Chúc bạn thi đấu thành công!",
    ],
  },

  // Negative/confused
  confused: {
    patterns: [/không hiểu/i, /\?\?\?/, /gì (vậy|zậy|dzậy)/i, /hả\??$/i],
    responses: [
      "Xin lỗi nếu mình chưa rõ ràng 😅 Bạn có thể hỏi lại cụ thể hơn được không?",
      "Mình xin lỗi! Bạn thử diễn đạt lại câu hỏi nhé, mình sẽ cố gắng hỗ trợ tốt hơn.",
    ],
  },

  // How are you
  how_are_you: {
    patterns: [
      /bạn (có )?khỏe không/i,
      /how are you/i,
      /bạn (thế nào|sao) rồi/i,
      /what'?s up/i,
    ],
    responses: [
      "Mình khỏe lắm! Sẵn sàng hỗ trợ bạn về giải đấu pickleball 🏓 Bạn cần gì?",
      "Mình ổn! Cảm ơn bạn hỏi thăm 😊 Hôm nay bạn có muốn tìm giải đấu không?",
    ],
  },
};

// ============================================
// ❓ FAQ - Câu hỏi thường gặp về PickleTour
// ============================================

export const FAQ_DATABASE = {
  // === Đăng ký giải ===
  registration_how: {
    keywords: [
      "cách đăng ký",
      "đăng ký như thế nào",
      "đăng ký giải thế nào",
      "làm sao đăng ký",
      "hướng dẫn đăng ký",
    ],
    question: "Làm sao để đăng ký giải đấu?",
    answer: `Để đăng ký giải đấu trên PickleTour:
1. Vào trang giải đấu bạn muốn tham gia
2. Nhấn nút "Đăng ký" 
3. Nếu đánh đôi, mời đồng đội qua số điện thoại
4. Thanh toán lệ phí (nếu có)
5. Chờ BTC duyệt đơn
6. Nếu có vấn đề gì có thể khiếu nại qua nút khiếu nại
Bạn muốn mình mở trang danh sách giải không?`,
  },

  registration_fee: {
    keywords: [
      "lệ phí",
      "phí đăng ký",
      "giá đăng ký",
      "bao nhiêu tiền",
      "chi phí",
    ],
    question: "Lệ phí đăng ký giải là bao nhiêu?",
    answer:
      "Lệ phí đăng ký tùy thuộc vào từng giải đấu, thường từ 100k-1tr/người. Bạn có thể xem chi tiết lệ phí trong trang thông tin giải. Một số giải miễn phí hoàn toàn!",
  },

  registration_deadline: {
    keywords: [
      "hạn đăng ký",
      "deadline",
      "đăng ký đến khi nào",
      "còn đăng ký được không",
    ],
    question: "Hạn đăng ký giải đến khi nào?",
    answer:
      "Mỗi giải có deadline đăng ký khác nhau, thường là 1-3 ngày trước khi giải bắt đầu. Bạn xem trong trang chi tiết giải sẽ có thông tin cụ thể. Nên đăng ký sớm vì nhiều giải hay hết slot nhanh lắm!",
  },

  registration_cancel: {
    keywords: ["hủy đăng ký", "rút đơn", "không tham gia được", "cancel"],
    question: "Làm sao hủy đăng ký giải?",
    answer:
      "Để hủy đăng ký, vào mục 'Đơn đăng ký của tôi', chọn đơn cần hủy và nhấn 'Hủy đăng ký'. Lưu ý: việc hủy có thể ảnh hưởng đến điểm uy tín của bạn, và lệ phí có thể không được hoàn lại tùy chính sách từng giải.",
  },

  // === Rating & Điểm ===
  rating_what: {
    keywords: ["rating là gì", "điểm rating", "hệ số", "điểm số"],
    question: "Rating/điểm là gì?",
    answer:
      "Rating là điểm đánh giá trình độ của VĐV, từ 2.0 (mới chơi) đến 5.0+ (chuyên nghiệp). Điểm này giúp BTC xếp bảng đấu công bằng. Rating sẽ tăng/giảm sau mỗi trận đấu dựa trên kết quả và đối thủ.",
  },

  rating_check: {
    keywords: ["xem điểm", "điểm của tôi", "rating của mình", "tra cứu điểm"],
    question: "Làm sao xem điểm rating của mình?",
    answer:
      "Vào trang cá nhân (Profile) của bạn sẽ thấy điểm rating đơn và đôi. Hoặc bạn có thể hỏi mình 'Điểm của tôi là bao nhiêu?' để tra cứu nhanh!",
  },

  rating_improve: {
    keywords: ["tăng điểm", "lên rating", "cải thiện điểm", "nâng điểm"],
    question: "Làm sao để tăng điểm rating?",
    answer:
      "Để tăng rating, bạn cần tham gia các giải đấu và thắng các đối thủ có rating cao hơn hoặc tương đương. Thắng đối thủ rating cao hơn = tăng nhiều điểm hơn. Thua đối thủ rating thấp = giảm nhiều điểm hơn.",
  },

  // === KYC / Xác thực ===
  kyc_what: {
    keywords: ["kyc là gì", "xác thực", "cccd", "căn cước"],
    question: "KYC/Xác thực danh tính là gì?",
    answer:
      "KYC (Know Your Customer) là quá trình xác thực danh tính bằng CCCD/CMND. Một số giải yêu cầu KYC để đảm bảo VĐV dùng đúng thông tin cá nhân, tránh gian lận về độ tuổi hay rating.",
  },

  kyc_how: {
    keywords: [
      "cách xác thực",
      "làm kyc",
      "upload cccd",
      "gửi căn cước",
      "để xác thực",
      "hướng dẫn kyc",
      "xác thực cccd",
    ],
    question: "Làm sao để xác thực KYC?",
    answer: `Để xác thực KYC:
1. Vào Profile > Xác thực danh tính
2. Chụp/upload ảnh mặt trước CCCD
3. Chụp/upload ảnh mặt sau CCCD  
4. Chờ hệ thống duyệt (thường trong 24h)

Thông tin của bạn được bảo mật tuyệt đối!`,
  },

  // === Giải đấu ===
  tournament_find: {
    keywords: ["tìm giải", "giải nào", "giải sắp tới", "giải gần đây"],
    question: "Làm sao tìm giải đấu?",
    answer:
      "Bạn vào trang 'Danh sách giải' sẽ thấy tất cả giải đang mở đăng ký. Có thể lọc theo khu vực, thời gian, trình độ. Hoặc nói với mình 'Mở trang giải' để mình dẫn bạn đến!",
  },

  tournament_bracket: {
    keywords: ["xem bảng đấu", "sơ đồ", "nhánh đấu", "bracket"],
    question: "Làm sao xem bảng đấu/bracket?",
    answer:
      "Vào trang giải > chọn nội dung thi đấu > Xem sơ đồ. Sơ đồ sẽ hiện sau khi BTC bốc thăm xếp cặp. Bạn cũng có thể nói 'Mở sơ đồ đấu' để mình dẫn bạn đến.",
  },

  tournament_schedule: {
    keywords: ["lịch đấu", "giờ đấu", "khi nào đấu", "thời gian đấu"],
    question: "Làm sao xem lịch thi đấu?",
    answer:
      "Vào trang giải > Lịch đấu để xem toàn bộ lịch. Khi có trận của bạn, app sẽ gửi thông báo trước 15-30 phút. Nhớ bật thông báo để không bỏ lỡ nhé!",
  },

  // === Kết quả & Livestream ===
  result_check: {
    keywords: ["kết quả", "xem kết quả", "tỉ số", "ai thắng"],
    question: "Làm sao xem kết quả trận đấu?",
    answer:
      "Vào trang giải > Kết quả hoặc xem trực tiếp trong sơ đồ đấu. Kết quả được cập nhật realtime ngay khi trận kết thúc!",
  },

  livestream: {
    keywords: ["xem trực tiếp", "livestream", "live", "phát sóng"],
    question: "Có thể xem trực tiếp trận đấu không?",
    answer:
      "Có! Một số giải có livestream trên PickleTour hoặc Facebook. Vào trang trận đấu sẽ thấy nút 'Xem trực tiếp' nếu trận đó được phát sóng. Bạn cũng có thể phát live trận đấu của mình lên Facebook!",
  },

  // === Tài khoản ===
  account_edit: {
    keywords: [
      "sửa thông tin",
      "đổi tên",
      "cập nhật profile",
      "chỉnh sửa tài khoản",
    ],
    question: "Làm sao sửa thông tin tài khoản?",
    answer:
      "Vào Profile > Chỉnh sửa để cập nhật tên, ảnh đại diện, số điện thoại... Lưu ý: một số thông tin như CCCD sau khi xác thực sẽ không đổi được.",
  },

  account_password: {
    keywords: ["đổi mật khẩu", "quên mật khẩu", "reset password"],
    question: "Làm sao đổi/khôi phục mật khẩu?",
    answer:
      "Vào Cài đặt > Đổi mật khẩu. Nếu quên mật khẩu, ở màn hình đăng nhập nhấn 'Quên mật khẩu' và làm theo hướng dẫn qua email/SMS.",
  },

  // === Hỗ trợ ===
  support_contact: {
    keywords: ["liên hệ", "hỗ trợ", "hotline", "support", "báo lỗi"],
    question: "Làm sao liên hệ hỗ trợ?",
    answer:
      "Bạn có thể liên hệ hỗ trợ qua:\n• Fanpage: facebook.com/pickletour\n• Email: support@pickletour.com\n• Hotline: 1900-xxx-xxx\nHoặc cứ hỏi mình, mình sẽ cố gắng giúp bạn!",
  },
};

// ============================================
// 🧭 NAVIGATION INTENTS
// ============================================

export const NAVIGATION_INTENTS = {
  tournament_list: {
    screen: "TournamentList",
    keywords: [
      "danh sách giải",
      "các giải",
      "giải đấu",
      "xem giải",
      "tìm giải",
      "list giải",
      "mở trang giải",
    ],
    // ✅ Negative keywords: nếu có → KHÔNG phải navigation
    negativeKeywords: [
      "lấy",
      "lấy ra", 
      "cho tôi",
      "thông tin",
      "chi tiết",
      "dữ liệu",
      "bao nhiêu",
      "mấy",
    ],
    deepLink: "pickletour://tournaments",
    description: "Danh sách các giải đấu",
    entityType: "tournament", // 👈 có entity giải
    resolvedIntent: "tournament_detail", // 👈 nếu resolve được giải thì chuyển sang detail
  },
  tournament_detail: {
    screen: "TournamentDetail",
    keywords: ["chi tiết giải", "thông tin giải", "xem giải này"],
    // ✅ Negative keywords
    negativeKeywords: [
      "lấy",
      "lấy ra",
      "cho tôi", 
      "là gì",
      "bao gồm",
      "gồm những gì",
    ],
    deepLink: "pickletour://tournament/{tournamentId}", // 👈 sửa placeholder cho đúng
    requiresContext: ["tournamentId"],
    description: "Chi tiết giải đấu",
    entityType: "tournament",
  },
  registration: {
    screen: "Registration",
    keywords: [
      "đăng ký giải",
      "đăng kí giải",
      "tham gia giải",
      "ghi danh",
      "register",
    ],
    deepLink: "pickletour://register/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Đăng ký tham gia giải",
  },
  my_registrations: {
    screen: "MyRegistrations",
    keywords: ["đơn đăng ký của tôi", "giải đã đăng ký", "đơn của mình"],
    deepLink: "pickletour://my-registrations",
    description: "Danh sách đơn đăng ký của bạn",
  },
  bracket: {
    screen: "Bracket",
    keywords: [
      "sơ đồ",
      "bracket",
      "nhánh đấu",
      "bảng đấu",
      "vòng đấu",
      "xem bảng",
    ],
    deepLink: "pickletour://bracket/{bracketId}",
    requiresContext: ["bracketId", "tournamentId"],
    description: "Sơ đồ/nhánh đấu",
  },
  schedule: {
    screen: "Schedule",
    keywords: [
      "lịch đấu",
      "lịch thi đấu",
      "schedule",
      "thời gian đấu",
      "lịch trình",
    ],
    deepLink: "pickletour://schedule/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Lịch thi đấu",
  },
  match_detail: {
    screen: "MatchDetail",
    keywords: ["chi tiết trận", "xem trận", "trận đấu này", "thông tin trận"],
    deepLink: "pickletour://match/{matchId}",
    requiresContext: ["matchId"],
    description: "Chi tiết trận đấu",
  },
  live_score: {
    screen: "LiveScore",
    keywords: ["tỉ số trực tiếp", "live score", "điểm số", "xem tỉ số"],
    deepLink: "pickletour://live/{matchId}",
    requiresContext: ["matchId"],
    description: "Tỉ số trực tiếp",
  },
  court_list: {
    screen: "CourtList",
    keywords: ["danh sách sân", "các sân", "sân đấu", "xem sân"],
    deepLink: "pickletour://courts/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Danh sách sân đấu",
  },
  profile: {
    screen: "Profile",
    keywords: ["trang cá nhân", "profile", "hồ sơ", "tài khoản"],
    deepLink: "pickletour://profile",
    description: "Trang cá nhân",
  },
  settings: {
    screen: "Settings",
    keywords: ["cài đặt", "settings", "thiết lập", "tùy chỉnh"],
    deepLink: "pickletour://settings",
    description: "Cài đặt",
  },
  my_ratings: {
    screen: "MyRatings",
    keywords: ["điểm của tôi", "rating của tôi", "xem điểm", "hệ số của mình"],
    deepLink: "pickletour://my-ratings",
    description: "Điểm rating của bạn",
  },
  livestream: {
    screen: "LiveStream",
    keywords: ["phát trực tiếp", "livestream", "live", "stream", "phát sóng"],
    deepLink: "pickletour://livestream/{matchId}",
    requiresContext: ["matchId"],
    description: "Phát trực tiếp",
  },
  search_player: {
    screen: "SearchPlayer",
    keywords: ["tìm vđv", "tìm người chơi", "search player", "tìm kiếm vđv"],
    deepLink: "pickletour://search/players",
    description: "Tìm kiếm VĐV",
  },
  leaderboard: {
    screen: "Leaderboard",
    keywords: ["bảng xếp hạng", "leaderboard", "top vđv", "ranking"],
    deepLink: "pickletour://leaderboard",
    description: "Bảng xếp hạng",
  },
  notifications: {
    screen: "Notifications",
    keywords: ["thông báo", "notification", "tin nhắn", "alerts"],
    deepLink: "pickletour://notifications",
    description: "Thông báo",
  },
  home: {
    screen: "Home",
    keywords: ["trang chủ", "home", "về đầu", "màn hình chính"],
    deepLink: "pickletour://(tabs)/index",
    description: "Trang chủ",
  },
};

// ============================================
// 🔍 ENTITY RESOLVERS (config-based, không if/else theo intent)
// ============================================

const ENTITY_RESOLVERS = {
  tournament: {
    slotName: "tournamentId",
    extractName: extractTournamentNameCandidate,
    resolve: resolveTournamentByName,
    describe: "giải đấu",
  },
};

// Bóc tên giải từ câu natural (đã normalize)
function extractTournamentNameCandidate(normalizedMsg) {
  const markers = ["giai dau", "giai", "tournament"];
  let pos = -1;
  let marker = null;

  for (const m of markers) {
    const idx = normalizedMsg.indexOf(m + " ");
    if (idx !== -1) {
      pos = idx;
      marker = m + " ";
      break;
    }
  }

  if (pos === -1) return null;

  let candidate = normalizedMsg.slice(pos + marker.length).trim();
  candidate = candidate.split(/[.?!]/)[0].trim();

  const trashHead = ["la", "ten", "trang", "page", "cua", "nay", "nua"];
  let tokens = candidate.split(/\s+/);
  while (tokens.length && trashHead.includes(tokens[0])) {
    tokens.shift();
  }
  candidate = tokens.join(" ").trim();

  if (candidate.length < 2) return null;
  return candidate; // ví dụ: "test giai 7"
}

// Score giống nhau giữa tên giải và candidate
function scoreTournamentName(name, candidateNorm) {
  const nameNorm = normalizeText(name || "");
  if (!nameNorm) return 0;

  if (nameNorm === candidateNorm) return 1;
  if (nameNorm.includes(candidateNorm)) return 0.9;
  if (candidateNorm.includes(nameNorm)) return 0.9;

  const candTokens = candidateNorm.split(" ");
  const nameTokens = nameNorm.split(" ");
  const overlap = candTokens.filter((t) => nameTokens.includes(t)).length;
  if (overlap === 0) return 0;

  return overlap / Math.max(candTokens.length, 1);
}

// Query Mongo tìm giải khớp nhất
async function resolveTournamentByName(candidateRaw) {
  const candidateNorm = normalizeText(candidateRaw);

  const escaped = candidateNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");

  const tournaments = await Tournament.find(
    {
      $or: [
        { name: { $regex: regex } },
        { slug: { $regex: regex } },
        { shortName: { $regex: regex } },
      ],
    },
    { name: 1, slug: 1 }
  )
    .limit(5)
    .lean();

  if (!tournaments.length) return null;

  let best = null;
  let bestScore = 0;

  for (const t of tournaments) {
    const s = scoreTournamentName(t.name, candidateNorm);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }

  if (!best || bestScore < 0.4) return null;

  return {
    id: String(best._id),
    name: best.name,
    score: bestScore,
  };
}

// Chọn intent navigation tốt nhất theo keyword
function findBestNavigationIntent(normalizedMsg) {
  const text =
    typeof normalizedMsg === "string"
      ? normalizedMsg
      : normalizeText(normalizedMsg || "");

  let bestMatch = null;
  let bestScore = 0;

  for (const [intentName, intent] of Object.entries(NAVIGATION_INTENTS)) {
    // ✅ Check negative keywords first
    if (intent.negativeKeywords) {
      const hasNegative = intent.negativeKeywords.some(nk => 
        text.includes(normalizeText(nk))
      );
      if (hasNegative) {
        debugLog(`Intent ${intentName} rejected: matched negative keyword`);
        continue; // Skip this intent
      }
    }

    for (const keyword of intent.keywords) {
      const nk = normalizeText(keyword);
      if (!text.includes(nk)) continue;

      let score = 0.6;
      score += Math.min(nk.length / Math.max(text.length, 10), 0.3);
      const adjusted = Math.min(score, 0.98);

      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestMatch = {
          intent: intentName,
          score: adjusted,
          ...intent,
        };
      }
    }
  }

  return bestScore >= 0.5 ? bestMatch : null;
}

// ============================================
// 🎯 MAIN PROCESSOR
// ============================================

/**
 * Xử lý quick response - greeting, small talk, FAQ, navigation
 * @param {string} message - User message
 * @param {Object} context - Context từ headers
 * @returns {Object|null} - Response hoặc null (cần xử lý ở layer tiếp theo)
 */
export async function processQuickResponse(message, context = {}) {
  const startTime = Date.now();
  const rawMsg = (message || "").trim();
  const normalizedMsg = normalizeText(rawMsg);

  if (!rawMsg) return null;

  // ========== 0. Skip if DATA QUERY ==========
  // Phát hiện câu hỏi lấy dữ liệu → nhảy thẳng xuống OpenAI
  if (isDataQuery(rawMsg)) {
    debugLog("⏭️  DATA QUERY detected, skipping quick response → pass to OpenAI");
    return null; // ← Nhảy xuống Layer 1 (Warm Path) hoặc Layer 2 (Cold Path)
  }

  // ========== 1. Check Greeting ==========
  const greetingResult = checkGreeting(rawMsg, normalizedMsg);
  if (greetingResult) {
    debugLog("Matched greeting:", greetingResult.type);
    return {
      type: "greeting",
      reply: greetingResult.response,
      intent: greetingResult.type,
      confidence: 0.95,
      source: "greeting",
      processingTime: Date.now() - startTime,
    };
  }

  // ========== 2. Check Small Talk ==========
  const smallTalkResult = checkSmallTalk(rawMsg);
  if (smallTalkResult) {
    debugLog("Matched small talk:", smallTalkResult.intent);
    return {
      type: "small_talk",
      reply: smallTalkResult.response,
      intent: smallTalkResult.intent,
      confidence: 0.9,
      source: "small_talk",
      processingTime: Date.now() - startTime,
    };
  }

  // ========== 3. Check Navigation (có entity resolver) ==========
  const navResult = await checkNavigation(rawMsg, normalizedMsg, context);
  if (navResult && navResult.confidence >= 0.5) {
    debugLog(
      "Matched navigation:",
      navResult.intent,
      navResult.confidence,
      navResult.source
    );
    return {
      type: "navigation",
      reply: navResult.message,
      navigation: {
        action: "navigate",
        screen: navResult.screen,
        deepLink: navResult.deepLink,
        missingContext: navResult.missingContext,
      },
      intent: navResult.intent,
      confidence: navResult.confidence,
      source: navResult.source || "navigation",
      processingTime: Date.now() - startTime,
    };
  }

  // ========== 4. Check FAQ (Keyword) ==========
  const faqResult = checkFAQ(normalizedMsg);
  if (faqResult && faqResult.confidence >= 0.6) {
    debugLog("Matched FAQ:", faqResult.intent, faqResult.confidence);
    return {
      type: "faq",
      reply: faqResult.answer,
      question: faqResult.question,
      intent: faqResult.intent,
      confidence: faqResult.confidence,
      source: "faq",
      processingTime: Date.now() - startTime,
    };
  }

  // ========== 5. Try Ollama for ambiguous cases ==========
  if (rawMsg.length < 50 || looksLikeSimpleQuestion(rawMsg)) {
    const ollamaResult = await tryOllamaClassification(rawMsg, context);
    if (ollamaResult) {
      return {
        ...ollamaResult,
        processingTime: Date.now() - startTime,
      };
    }
  }

  // Không match - chuyển xuống layer tiếp theo
  return null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkGreeting(message, normalizedMsg) {
  // Ưu tiên regex (đầu câu)
  for (const greeting of GREETING_PATTERNS) {
    for (const pattern of greeting.patterns) {
      if (pattern.test(message)) {
        const responses = GREETING_RESPONSES[greeting.type];
        const response =
          responses[Math.floor(Math.random() * responses.length)];
        return { type: greeting.type, response };
      }
    }
  }

  // Fallback: check từ khoá đơn giản trên normalized text
  const shortGreeting = [
    { key: "xin chao", type: "hello" },
    { key: "chao ban", type: "hello" },
    { key: "hi", type: "hello" },
    { key: "hello", type: "hello" },
    { key: "good morning", type: "morning" },
    { key: "good afternoon", type: "afternoon" },
    { key: "good evening", type: "evening" },
    { key: "tam biet", type: "goodbye" },
    { key: "bye", type: "goodbye" },
    { key: "cam on", type: "thanks" },
    { key: "cam onn", type: "thanks" },
  ];

  for (const g of shortGreeting) {
    if (normalizedMsg.includes(g.key)) {
      const responses = GREETING_RESPONSES[g.type];
      const response = responses[Math.floor(Math.random() * responses.length)];
      return { type: g.type, response };
    }
  }

  return null;
}

function checkSmallTalk(message) {
  for (const [intent, data] of Object.entries(SMALL_TALK)) {
    for (const pattern of data.patterns) {
      if (pattern.test(message)) {
        const response =
          data.responses[Math.floor(Math.random() * data.responses.length)];
        return { intent, response };
      }
    }
  }
  return null;
}

// 💡 Navigation có entity resolver
async function checkNavigation(rawMsg, normalizedMsg, context = {}) {
  const norm =
    typeof normalizedMsg === "string"
      ? normalizedMsg
      : normalizeText(normalizedMsg || "");

  const baseMatch = findBestNavigationIntent(norm);
  if (!baseMatch) return null;

  const entityType = baseMatch.entityType;
  const resolverCfg = entityType ? ENTITY_RESOLVERS[entityType] : null;

  // Không có entity config → fallback navigation basic
  if (!resolverCfg) {
    return {
      ...buildNavigationResponse(baseMatch, context, baseMatch.score),
      source: "navigation",
    };
  }

  // Thử bóc tên entity (tournamentName)
  const candidateName = resolverCfg.extractName(norm);
  if (!candidateName) {
    debugLog("Navigation entity: no candidate name extracted");
    return {
      ...buildNavigationResponse(baseMatch, context, baseMatch.score),
      source: "navigation",
    };
  }

  const resolved = await resolverCfg.resolve(candidateName);
  if (!resolved) {
    debugLog("Navigation entity: cannot resolve", candidateName);
    return {
      ...buildNavigationResponse(baseMatch, context, baseMatch.score),
      source: "navigation",
    };
  }

  const finalIntentName = baseMatch.resolvedIntent || baseMatch.intent;
  const finalIntentCfg = NAVIGATION_INTENTS[finalIntentName] || baseMatch;

  const newContext = {
    ...context,
    [resolverCfg.slotName]: resolved.id,
  };

  const enhancedMatch = {
    intent: finalIntentName,
    screen: finalIntentCfg.screen,
    deepLink: finalIntentCfg.deepLink,
    requiresContext: finalIntentCfg.requiresContext,
    description: `${finalIntentCfg.description} "${resolved.name}"`,
  };

  const nav = buildNavigationResponse(
    enhancedMatch,
    newContext,
    Math.max(baseMatch.score, resolved.score || 0.8)
  );

  return {
    ...nav,
    source: "navigation-entity-resolved",
  };
}

function checkFAQ(normalizedMsg) {
  let bestMatch = null;
  let bestScore = 0;

  for (const [intent, faq] of Object.entries(FAQ_DATABASE)) {
    let hitCount = 0;
    let localScore = 0;

    for (const keyword of faq.keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalizedMsg.includes(normalizedKeyword)) {
        hitCount += 1;
        localScore += 0.5; // mỗi keyword ăn 0.5
        localScore += Math.min(
          normalizedKeyword.length / Math.max(normalizedMsg.length, 10),
          0.3
        );
      }
    }

    if (hitCount > 0) {
      const confidence = Math.min(localScore, 0.98);
      if (confidence > bestScore) {
        bestScore = confidence;
        bestMatch = { intent, ...faq, confidence };
      }
    }
  }

  return bestMatch;
}

function buildNavigationResponse(match, context, score) {
  const { intent, screen, deepLink, requiresContext, description } = match;

  let finalDeepLink = deepLink;
  let missingContext = [];

  if (requiresContext) {
    for (const ctxKey of requiresContext) {
      if (context[ctxKey]) {
        finalDeepLink = finalDeepLink.replace(`{${ctxKey}}`, context[ctxKey]);
      } else {
        missingContext.push(ctxKey);
      }
    }
  }

  let message;
  if (missingContext.length > 0) {
    message = `Để mở ${description}, bạn cần chọn ${missingContext.join(
      ", "
    )} trước.`;
  } else {
    message = `Đang mở ${description}... 🏓`;
  }

  return {
    intent,
    screen,
    deepLink: missingContext.length === 0 ? finalDeepLink : null,
    description,
    message,
    confidence: score,
    missingContext: missingContext.length > 0 ? missingContext : undefined,
  };
}

function looksLikeSimpleQuestion(message) {
  const simplePatterns = [
    /^(làm sao|làm thế nào|cách nào)/i,
    /^(có thể|có được không)/i,
    /\?$/,
    /^(tại sao|vì sao|why)/i,
    /^(khi nào|lúc nào|bao giờ)/i,
    /^(ở đâu|chỗ nào)/i,
    /^(ai|who)/i,
    /^(cái gì|what|gì)/i,
  ];
  return simplePatterns.some((p) => p.test(message));
}

/**
 * Dùng Ollama để classify khi keyword không đủ confident
 */
async function tryOllamaClassification(message, context) {
  try {
    const allIntents = [
      ...Object.keys(SMALL_TALK),
      ...Object.keys(FAQ_DATABASE),
      ...Object.keys(NAVIGATION_INTENTS),
      "greeting",
      "unknown",
    ];
    const intentList = allIntents.join(", ");

    const prompt = `${SYSTEM_PROMPT}

Phân loại câu hỏi sau vào 1 intent. Chỉ trả lời đúng tên intent (ví dụ: "tournament_find"), không giải thích.
Nếu không chắc, trả lời "unknown".
Các intents hợp lệ: ${intentList}

Câu: "${message}"
Intent:`;

    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 30,
          top_p: 0.9,
        },
      },
      { timeout: 5000 }
    );

    let result = response.data?.response?.trim().toLowerCase();
    if (!result) return null;

    // clean kết quả: lấy token đầu tiên, bỏ dấu chấm/phẩy
    result = result.split(/\s+/)[0].replace(/[.,]/g, "");

    debugLog("Ollama classified:", result);

    if (!allIntents.includes(result) || result === "unknown") {
      return null;
    }

    // Check if it's a FAQ
    if (FAQ_DATABASE[result]) {
      return {
        type: "faq",
        reply: FAQ_DATABASE[result].answer,
        question: FAQ_DATABASE[result].question,
        intent: result,
        confidence: 0.75,
        source: "ollama-faq",
      };
    }

    // Check if it's small talk
    if (SMALL_TALK[result]) {
      const responses = SMALL_TALK[result].responses;
      return {
        type: "small_talk",
        reply: responses[Math.floor(Math.random() * responses.length)],
        intent: result,
        confidence: 0.75,
        source: "ollama-small_talk",
      };
    }

    // Check if it's navigation
    if (NAVIGATION_INTENTS[result]) {
      const navResponse = buildNavigationResponse(
        { intent: result, ...NAVIGATION_INTENTS[result] },
        context,
        0.7
      );
      return {
        type: "navigation",
        reply: navResponse.message,
        navigation: {
          action: "navigate",
          screen: navResponse.screen,
          deepLink: navResponse.deepLink,
          missingContext: navResponse.missingContext,
        },
        intent: result,
        confidence: 0.7,
        source: "ollama-navigation",
      };
    }

    // greeting bằng Ollama thực ra không cần, nhưng để đây cho đủ case
    if (result === "greeting") {
      const g = GREETING_RESPONSES.hello;
      return {
        type: "greeting",
        reply: g[Math.floor(Math.random() * g.length)],
        intent: "hello",
        confidence: 0.7,
        source: "ollama-greeting",
      };
    }

    return null;
  } catch (error) {
    console.error("[QuickResponse] Ollama error:", error.message);
    return null;
  }
}

// ============================================
// HEALTH CHECK
// ============================================

export async function checkQuickResponseHealth() {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 3000,
    });

    const models = response.data?.models || [];
    const hasModel = models.some((m) =>
      m.name.includes(OLLAMA_MODEL.split(":")[0])
    );

    return {
      status: "ok",
      ollama: {
        status: "connected",
        model: OLLAMA_MODEL,
        hasModel,
      },
      stats: {
        greetingPatterns: GREETING_PATTERNS.length,
        smallTalkIntents: Object.keys(SMALL_TALK).length,
        faqCount: Object.keys(FAQ_DATABASE).length,
        navigationIntents: Object.keys(NAVIGATION_INTENTS).length,
      },
    };
  } catch (error) {
    return {
      status: "degraded",
      ollama: {
        status: "disconnected",
        error: error.message,
      },
      note: "Keyword matching still works without Ollama",
    };
  }
}