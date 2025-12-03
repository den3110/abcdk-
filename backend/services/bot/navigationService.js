// services/bot/navigationService.js
// Navigation Layer sử dụng Qwen 0.5b (local) hoặc keyword matching
// Xử lý các câu lệnh điều hướng trong app

import axios from "axios";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_NAV_MODEL = process.env.OLLAMA_NAV_MODEL || "qwen2.5:0.5b";

// ============================================
// NAVIGATION INTENTS - Định nghĩa các màn hình
// ============================================

export const NAVIGATION_INTENTS = {
  // === Tournament ===
  tournament_list: {
    screen: "TournamentList",
    keywords: ["danh sách giải", "các giải", "giải đấu", "xem giải", "tìm giải", "list giải"],
    deepLink: "pickletour://tournaments",
    description: "Danh sách các giải đấu"
  },
  tournament_detail: {
    screen: "TournamentDetail", 
    keywords: ["chi tiết giải", "thông tin giải", "xem giải này"],
    deepLink: "pickletour://tournament/{id}",
    requiresContext: ["tournamentId"],
    description: "Chi tiết giải đấu"
  },
  
  // === Registration ===
  registration: {
    screen: "Registration",
    keywords: ["đăng ký", "đăng kí", "tham gia giải", "ghi danh", "register"],
    deepLink: "pickletour://register/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Đăng ký tham gia giải"
  },
  my_registrations: {
    screen: "MyRegistrations",
    keywords: ["đơn đăng ký của tôi", "giải đã đăng ký", "đơn của mình"],
    deepLink: "pickletour://my-registrations",
    description: "Danh sách đơn đăng ký của bạn"
  },

  // === Bracket & Schedule ===
  bracket: {
    screen: "Bracket",
    keywords: ["sơ đồ", "bracket", "nhánh đấu", "bảng đấu", "vòng đấu", "xem bảng"],
    deepLink: "pickletour://bracket/{bracketId}",
    requiresContext: ["bracketId", "tournamentId"],
    description: "Sơ đồ/nhánh đấu"
  },
  schedule: {
    screen: "Schedule",
    keywords: ["lịch đấu", "lịch thi đấu", "schedule", "thời gian đấu", "lịch trình"],
    deepLink: "pickletour://schedule/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Lịch thi đấu"
  },
  
  // === Match ===
  match_detail: {
    screen: "MatchDetail",
    keywords: ["chi tiết trận", "xem trận", "trận đấu này", "thông tin trận"],
    deepLink: "pickletour://match/{matchId}",
    requiresContext: ["matchId"],
    description: "Chi tiết trận đấu"
  },
  live_score: {
    screen: "LiveScore",
    keywords: ["tỉ số trực tiếp", "live score", "điểm số", "xem tỉ số"],
    deepLink: "pickletour://live/{matchId}",
    requiresContext: ["matchId"],
    description: "Tỉ số trực tiếp"
  },

  // === Court ===
  court_list: {
    screen: "CourtList",
    keywords: ["danh sách sân", "các sân", "sân đấu", "xem sân"],
    deepLink: "pickletour://courts/{tournamentId}",
    requiresContext: ["tournamentId"],
    description: "Danh sách sân đấu"
  },
  court_detail: {
    screen: "CourtDetail",
    keywords: ["chi tiết sân", "sân này", "thông tin sân"],
    deepLink: "pickletour://court/{courtCode}",
    requiresContext: ["courtCode", "tournamentId"],
    description: "Chi tiết sân"
  },

  // === Profile & Account ===
  profile: {
    screen: "Profile",
    keywords: ["trang cá nhân", "profile", "hồ sơ", "tài khoản", "thông tin tôi", "của tôi"],
    deepLink: "pickletour://profile",
    description: "Trang cá nhân"
  },
  settings: {
    screen: "Settings",
    keywords: ["cài đặt", "settings", "thiết lập", "tùy chỉnh"],
    deepLink: "pickletour://settings",
    description: "Cài đặt"
  },
  my_ratings: {
    screen: "MyRatings",
    keywords: ["điểm của tôi", "rating của tôi", "xem điểm", "hệ số"],
    deepLink: "pickletour://my-ratings",
    description: "Điểm rating của bạn"
  },

  // === Live Stream ===
  livestream: {
    screen: "LiveStream",
    keywords: ["phát trực tiếp", "livestream", "live", "stream", "phát sóng"],
    deepLink: "pickletour://livestream/{matchId}",
    requiresContext: ["matchId"],
    description: "Phát trực tiếp"
  },

  // === Search & Explore ===
  search_player: {
    screen: "SearchPlayer",
    keywords: ["tìm vđv", "tìm người chơi", "search player", "tìm kiếm vđv"],
    deepLink: "pickletour://search/players",
    description: "Tìm kiếm VĐV"
  },
  leaderboard: {
    screen: "Leaderboard",
    keywords: ["bảng xếp hạng", "leaderboard", "top vđv", "ranking"],
    deepLink: "pickletour://rankings",
    description: "Bảng xếp hạng"
  },

  // === Notifications ===
  notifications: {
    screen: "Notifications",
    keywords: ["thông báo", "notification", "tin nhắn", "alerts"],
    deepLink: "pickletour://notifications",
    description: "Thông báo"
  },

  // === Home ===
  home: {
    screen: "Home",
    keywords: ["trang chủ", "home", "về đầu", "màn hình chính"],
    deepLink: "pickletour://home",
    description: "Trang chủ"
  }
};

// ============================================
// NAVIGATION TRIGGERS - Từ khóa kích hoạt
// ============================================

const NAV_TRIGGER_PATTERNS = [
  /^(mở|vào|đi đến|xem|show|open|go to|navigate)\s+/i,
  /^(đưa tôi đến|dẫn tôi đến|chuyển đến)\s+/i,
  /trang\s+\w+/i,
  /màn hình\s+\w+/i,
];

// ============================================
// LAYER 1: Keyword Matching (Instant, Free)
// ============================================

/**
 * Match navigation intent bằng keywords
 * @param {string} message - User message
 * @returns {Object|null} - { intent, screen, confidence } hoặc null
 */
export function matchNavigationKeywords(message) {
  const normalizedMsg = message.toLowerCase().trim();
  
  let bestMatch = null;
  let bestScore = 0;

  for (const [intentName, intent] of Object.entries(NAVIGATION_INTENTS)) {
    for (const keyword of intent.keywords) {
      const normalizedKeyword = keyword.toLowerCase();
      
      // Exact match
      if (normalizedMsg.includes(normalizedKeyword)) {
        // Score based on keyword length (longer = more specific)
        const score = normalizedKeyword.length / normalizedMsg.length;
        const adjustedScore = Math.min(score * 1.5, 1); // Boost but cap at 1
        
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = {
            intent: intentName,
            ...intent,
            matchedKeyword: keyword,
            confidence: adjustedScore
          };
        }
      }
    }
  }

  // Require minimum confidence
  if (bestMatch && bestScore >= 0.3) {
    return bestMatch;
  }

  return null;
}

// ============================================
// LAYER 2: Ollama Classification (Qwen 0.5b)
// ============================================

/**
 * Dùng Qwen 0.5b để classify navigation intent
 * @param {string} message - User message
 * @returns {Object|null} - { intent, screen, confidence } hoặc null
 */
export async function classifyNavigationWithOllama(message) {
  const intentNames = Object.keys(NAVIGATION_INTENTS).join(", ");
  
  const prompt = `Phân loại câu sau vào 1 trong các intent điều hướng app.
Intents: ${intentNames}, none

Câu: "${message}"

Nếu không phải điều hướng, trả lời "none".
Chỉ trả lời 1 từ là tên intent:`;

  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      {
        model: OLLAMA_NAV_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          num_predict: 30,    // Chỉ cần output ngắn
          top_p: 0.9,
          repeat_penalty: 1.1
        }
      },
      { timeout: 5000 } // 5s timeout
    );

    const result = response.data?.response?.trim().toLowerCase();
    console.log("[NavigationService] Ollama result:", result);

    // Parse result
    if (!result || result === "none" || result.includes("none")) {
      return null;
    }

    // Find matching intent
    const matchedIntent = Object.keys(NAVIGATION_INTENTS).find(
      name => result.includes(name.toLowerCase())
    );

    if (matchedIntent) {
      return {
        intent: matchedIntent,
        ...NAVIGATION_INTENTS[matchedIntent],
        confidence: 0.7, // Ollama confidence
        source: "ollama"
      };
    }

    return null;
  } catch (error) {
    console.error("[NavigationService] Ollama error:", error.message);
    return null;
  }
}

// ============================================
// MAIN FUNCTION: Process Navigation
// ============================================

/**
 * Xử lý navigation request
 * @param {string} message - User message
 * @param {Object} context - Context từ headers (tournamentId, matchId, etc.)
 * @returns {Object|null} - Navigation response hoặc null (không phải navigation)
 */
export async function processNavigation(message, context = {}) {
  const startTime = Date.now();

  // Check if message looks like navigation command
  const isNavTrigger = NAV_TRIGGER_PATTERNS.some(p => p.test(message));
  
  // ========== Layer 1: Keyword Match (instant) ==========
  const keywordMatch = matchNavigationKeywords(message);
  
  if (keywordMatch && keywordMatch.confidence >= 0.5) {
    console.log(`[Navigation] Keyword match: ${keywordMatch.intent} (${keywordMatch.confidence})`);
    return buildNavigationResponse(keywordMatch, context, Date.now() - startTime);
  }

  // ========== Layer 2: Ollama (nếu có trigger pattern) ==========
  if (isNavTrigger || (keywordMatch && keywordMatch.confidence >= 0.3)) {
    console.log("[Navigation] Trying Ollama classification...");
    
    const ollamaMatch = await classifyNavigationWithOllama(message);
    
    if (ollamaMatch) {
      console.log(`[Navigation] Ollama match: ${ollamaMatch.intent}`);
      return buildNavigationResponse(ollamaMatch, context, Date.now() - startTime);
    }
  }

  // Không phải navigation
  return null;
}

// ============================================
// HELPER: Build Response
// ============================================

function buildNavigationResponse(match, context, processingTime) {
  const { intent, screen, deepLink, requiresContext, description } = match;

  // Check required context
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

  // Build response message
  let responseMessage;
  if (missingContext.length > 0) {
    responseMessage = `Để mở ${description}, bạn cần chọn ${missingContext.join(", ")} trước.`;
  } else {
    responseMessage = `Đang mở ${description}...`;
  }

  return {
    type: "navigation",
    action: "navigate",
    screen,
    deepLink: missingContext.length === 0 ? finalDeepLink : null,
    intent,
    description,
    message: responseMessage,
    confidence: match.confidence,
    source: match.source || "keyword",
    missingContext: missingContext.length > 0 ? missingContext : undefined,
    processingTime
  };
}

// ============================================
// HEALTH CHECK
// ============================================

export async function checkOllamaHealth() {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 3000
    });
    
    const models = response.data?.models || [];
    const hasNavModel = models.some(m => m.name.includes(OLLAMA_NAV_MODEL.split(":")[0]));
    
    return {
      status: "ok",
      models: models.map(m => m.name),
      hasNavModel,
      recommendedModel: OLLAMA_NAV_MODEL
    };
  } catch (error) {
    return {
      status: "error",
      error: error.message,
      hint: "Run: ollama pull qwen2.5:0.5b"
    };
  }
}