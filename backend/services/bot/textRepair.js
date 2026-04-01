const CP1252_EXTRA_TO_BYTE = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const VIETNAMESE_CHAR_REGEX =
  /[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u0102\u00c2\u0110\u00ca\u00d4\u01a0\u01af\u00e0\u00e1\u1ea1\u1ea3\u00e3\u1eb1\u1eaf\u1eb7\u1eb3\u1eb5\u1ea7\u1ea5\u1ead\u1ea9\u1eab\u00e8\u00e9\u1eb9\u1ebb\u1ebd\u1ec1\u1ebf\u1ec7\u1ec3\u1ec5\u00ec\u00ed\u1ecb\u1ec9\u0129\u00f2\u00f3\u1ecd\u1ecf\u00f5\u1ed3\u1ed1\u1ed9\u1ed5\u1ed7\u1edd\u1edb\u1ee3\u1edf\u1ee1\u00f9\u00fa\u1ee5\u1ee7\u0169\u1eeb\u1ee9\u1ef1\u1eed\u1eef\u1ef3\u00fd\u1ef5\u1ef7\u1ef9]/gu;
const MOJIBAKE_REGEX =
  /(?:\u00c3.|\u00c2.|\u00c4.|\u00c6.|\u00e1[\u0080-\u00ff]{1,2}|\u00e2[\u0080-\u00ff]{1,2}|\u00e2\u20ac.|\u00ef\u00bf\u00bd|\ufffd)/gu;

function normalizeQuery(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(regex, value) {
  const matches = String(value || "").match(regex);
  return matches ? matches.length : 0;
}

function scoreTextHealth(value) {
  const text = String(value || "");
  return (
    countMatches(VIETNAMESE_CHAR_REGEX, text) * 3 -
    countMatches(MOJIBAKE_REGEX, text) * 8 -
    countMatches(/\ufffd/gu, text) * 12 -
    countMatches(/[\u0080-\u009f]/gu, text) * 10
  );
}

function encodeWindows1252Like(value) {
  const bytes = [];
  const text = String(value || "");

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) continue;

    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const cp1252Byte = CP1252_EXTRA_TO_BYTE.get(codePoint);
    if (cp1252Byte != null) {
      bytes.push(cp1252Byte);
      continue;
    }

    return null;
  }

  return Buffer.from(bytes);
}

function decodeWindows1252Utf8(value) {
  const buffer = encodeWindows1252Like(value);
  if (!buffer) return "";
  try {
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function decodeLatin1Utf8(value) {
  try {
    return Buffer.from(String(value || ""), "latin1").toString("utf8");
  } catch {
    return "";
  }
}

function collectRepairCandidates(value) {
  const cleaned = String(value || "").replace(/^\ufeff+/u, "");
  const candidates = new Set([cleaned]);
  let frontier = [cleaned];

  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    for (const item of frontier) {
      for (const candidate of [
        decodeWindows1252Utf8(item),
        decodeLatin1Utf8(item),
      ]) {
        if (!candidate || candidates.has(candidate)) continue;
        candidates.add(candidate);
        next.push(candidate);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  return [...candidates];
}

export function repairUserFacingText(value) {
  if (typeof value !== "string" || !value) return value;

  let best = value.replace(/^\ufeff+/u, "");
  let bestScore = scoreTextHealth(best);

  for (const candidate of collectRepairCandidates(best)) {
    const nextScore = scoreTextHealth(candidate);
    if (nextScore > bestScore) {
      best = candidate;
      bestScore = nextScore;
    }
  }

  return best;
}

export function normalizeUserFacingData(value) {
  if (typeof value === "string") {
    return repairUserFacingText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeUserFacingData(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeUserFacingData(item),
      ]),
    );
  }
  return value;
}

const CURATED_KNOWLEDGE_OVERRIDES = [
  {
    patterns: [
      "pickleball la gi",
      "pickleball la mon gi",
      "gioi thieu ve pickleball",
      "luat choi pickleball",
    ],
    data: {
      title: "Pickleball là gì",
      category: "pickleball",
      content:
        "Pickleball là môn thể thao kết hợp giữa tennis, cầu lông và bóng bàn. Người chơi thi đấu trên sân nhỏ hơn tennis, dùng vợt composite hoặc gỗ và bóng nhựa có lỗ. Môn này dễ học, phù hợp nhiều lứa tuổi và đang phát triển nhanh tại Việt Nam.",
    },
  },
  {
    patterns: [
      "pickletour la gi",
      "ung dung pickletour la gi",
      "app pickletour la gi",
    ],
    data: {
      title: "PickleTour là gì",
      category: "app",
      content:
        "PickleTour là nền tảng quản lý giải đấu pickleball, hỗ trợ tổ chức giải, đăng ký thi đấu, theo dõi lịch đấu, xem kết quả và tra cứu điểm trình trên web và app.",
    },
  },
  {
    patterns: [
      "cach dang ky tai khoan",
      "dang ky tai khoan nhu the nao",
      "tao tai khoan pickletour",
    ],
    data: {
      title: "Cách đăng ký tài khoản",
      category: "account",
      content:
        "Để đăng ký tài khoản PickleTour, bạn mở trang Đăng ký, điền họ tên, email hoặc số điện thoại, tạo mật khẩu và xác minh thông tin theo hướng dẫn trên màn hình. Sau khi tạo xong, bạn có thể đăng nhập để đăng ký giải và theo dõi điểm trình.",
    },
  },
  {
    patterns: ["quen mat khau", "reset mat khau", "doi mat khau nhu the nao"],
    data: {
      title: "Quên mật khẩu",
      category: "account",
      content:
        "Nếu quên mật khẩu, bạn chọn Quên mật khẩu ở màn hình đăng nhập, nhập email hoặc số điện thoại đã đăng ký, rồi làm theo hướng dẫn để đặt lại mật khẩu mới.",
    },
  },
  {
    patterns: [
      "xac thuc danh tinh la gi",
      "kyc la gi",
      "xac minh danh tinh la gi",
    ],
    data: {
      title: "Xác thực danh tính là gì",
      category: "account",
      content:
        "Xác thực danh tính (KYC) là bước xác minh thông tin cá nhân để hệ thống ghi nhận tài khoản chính chủ. Sau khi xác thực, điểm trình và hồ sơ thi đấu của bạn sẽ đáng tin cậy hơn khi tham gia giải.",
    },
  },
];

export function getCuratedKnowledgeOverride(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;

  const match = CURATED_KNOWLEDGE_OVERRIDES.find((item) =>
    item.patterns.some((pattern) => normalized.includes(pattern)),
  );

  return match ? normalizeUserFacingData(match.data) : null;
}
