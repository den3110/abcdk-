export const VOWELS = "aăâeêioôơuưy";

// Các dấu thanh trong bảng mã Unicode Combining Diacritical Marks (NFD)
export const TONE_MARKS = [
  "\u0300", // Huyền
  "\u0301", // Sắc
  "\u0303", // Ngã
  "\u0309", // Hỏi
  "\u0323", // Nặng
];

// Danh sách ký tự ẩn cần dọn dẹp
const HIDDEN_CHARS_REGEX = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;

/**
 * Thuật toán đặt dấu thanh (Tone Marks) đúng chuẩn tiếng Việt (Kiểu mới)
 * 1. Nhận diện các cụm nguyên âm liền kề
 * 2. Tìm hạt nhân (nucleus) của cụm
 * 3. Gắn lại dấu thanh vào ngay sau nucleus
 * @param {string} text_nfd Chuỗi ở định dạng NFD
 * @returns {string} Chuỗi NFD đã quy chuẩn vị trí dấu
 */
export function canonicalize_vietnamese_tones(text_nfd) {
  // Regex tìm 1 từ cấu tạo bởi Word characters và Combining marks
  const wordRegex = /[\p{L}\p{M}]+/gu;

  return text_nfd.replace(wordRegex, (word) => {
    let cleanedWord = "";
    let wordTone = "";

    // 1. Tách mảng các ký tự của từ (bao gồm cả base char và combining marks)
    // Tách dấu thanh (nếu có) ra khỏi từ
    for (const char of word) {
      if (TONE_MARKS.includes(char)) {
        wordTone = char; // Giữ lại dấu thanh cuối cùng tìm thấy
      } else {
        cleanedWord += char;
      }
    }

    if (!wordTone) return word; // Không có dấu thanh, giữ nguyên

    // 2. Phân tích cụm nguyên âm để tìm nucleus
    // (Lưu ý: str chứa các base chars + combining marks KHÁC ngoài tone, như dấu nón ^, râu +)
    let vowelStartIndex = -1;
    let vowelEndIndex = -1;
    let hasFinalConsonant = false;

    // Tìm đoạn chứa nguyên âm (A, E, I, O, U, Y)
    // Cần match cả các Regex bao gồm ký tự unicode NFD
    const vowelPattern = new RegExp(
      `[${VOWELS}][\\u0302\\u0306\\u031B]*`,
      "gi",
    );

    // Thuật toán quét và xác định cụm nguyên âm liên tiếp
    let match;
    const vowelMatches = [];
    while ((match = vowelPattern.exec(cleanedWord)) !== null) {
      vowelMatches.push(match);
    }

    if (vowelMatches.length === 0) {
      // Không tìm thấy nguyên âm (hiếm), nhét dấu vào cuối
      return cleanedWord + wordTone;
    }

    // Gộp các nguyên âm liền kề thành 1 cụm liên tục dài nhất
    let bestCluster = [];
    let currentCluster = [];

    for (let i = 0; i < vowelMatches.length; i++) {
      const m = vowelMatches[i];
      if (currentCluster.length === 0) {
        currentCluster.push(m);
      } else {
        // Kiểm tra xem có liền kề không (kế tiếp index của the last char in current cluster)
        const lastM = currentCluster[currentCluster.length - 1];
        if (m.index === lastM.index + lastM[0].length) {
          currentCluster.push(m);
        } else {
          if (currentCluster.length > bestCluster.length) {
            bestCluster = currentCluster;
          }
          currentCluster = [m];
        }
      }
    }
    if (currentCluster.length > bestCluster.length) {
      bestCluster = currentCluster;
    }

    if (bestCluster.length === 0) return cleanedWord + wordTone;

    const clusterStart = bestCluster[0].index;
    const clusterEnd =
      bestCluster[bestCluster.length - 1].index +
      bestCluster[bestCluster.length - 1][0].length;

    // Xác định có phụ âm cuối không (có ký tự nào sau cụm nguyên âm không?)
    hasFinalConsonant = clusterEnd < cleanedWord.length;

    let nucleusIndex = -1;
    let nucleusLength = 0;

    // Phân tích Nucleus trong bestCluster
    // Các phần tử trong bestCluster có dạng: string, index. Ví dụ "o", "a", "ê" (e + \u0302)
    const chars = bestCluster.map((m) => m[0].toLowerCase());

    // Rule 1: Chứa các nguyên âm có mũ/râu (ê, ơ, â, ă, ô) -> ưu tiên nó
    for (let i = 0; i < bestCluster.length; i++) {
      const c = bestCluster[i][0].toLowerCase();
      // Ký tự mang mark mũ/râu (trong NFD là ký tự gốc theo sau bởi \u0302, \u0306, \u031B)
      if (
        c.includes("\u0302") ||
        c.includes("\u0306") ||
        c.includes("\u031B")
      ) {
        nucleusIndex = bestCluster[i].index;
        nucleusLength = bestCluster[i][0].length;
        break;
      }
    }

    // Rule 2: Cụm có bán âm "qu", "gi" (vd "quý", "già")
    if (nucleusIndex === -1 && bestCluster.length >= 2) {
      const firstChar = chars[0][0]; // lấy chữ cái đầu tiên của nguyên âm đầu
      const prevChar =
        clusterStart > 0 ? cleanedWord[clusterStart - 1].toLowerCase() : "";

      if (
        (firstChar === "u" && prevChar === "q") ||
        (firstChar === "i" && prevChar === "g")
      ) {
        // Bỏ qua nguyên âm đầu tiên ('u' hoặc 'i'), lấy nguyên âm thứ 2 làm nucleus
        nucleusIndex = bestCluster[1].index;
        nucleusLength = bestCluster[1][0].length;
      }
    }

    // Rule 3: Mặc định theo vị trí (Có phụ âm cuối / Không phụ âm cuối)
    if (nucleusIndex === -1) {
      if (bestCluster.length === 1) {
        nucleusIndex = bestCluster[0].index;
        nucleusLength = bestCluster[0][0].length;
      } else {
        if (hasFinalConsonant) {
          // Có phụ âm cuối -> dấu ở nguyên âm sát phụ âm cuối nhất (thường là nguyên âm cuối của cụm)
          // VD: hoàn -> a
          nucleusIndex = bestCluster[bestCluster.length - 1].index;
          nucleusLength = bestCluster[bestCluster.length - 1][0].length;
        } else {
          // Trừ âm tiết "oa", "oe", "uy", nếu không có phụ âm cuối kết thúc thì đặt ở ký tự cuối cùng "hòa" -> "a" thay vì "o" ở cách cũ (kiểu mới)
          // Actually, Kiểu mới (GD&ĐT) đặt ở chữ cái cuối của âm tiết đôi nếu không âm cuối (hòa -> a, quý -> y)
          // Nên đặt ở cuối là chuẩn cho kiểu mới.
          nucleusIndex = bestCluster[bestCluster.length - 1].index;
          nucleusLength = bestCluster[bestCluster.length - 1][0].length;
        }
      }
    }

    if (nucleusIndex !== -1) {
      // Chèn tone mark vào ngay sau nucleus
      const insertPosition = nucleusIndex + nucleusLength;
      return (
        cleanedWord.slice(0, insertPosition) +
        wordTone +
        cleanedWord.slice(insertPosition)
      );
    }

    return cleanedWord + wordTone;
  });
}

/**
 * Xóa toàn bộ dấu (kể cả dấu thanh và dấu phụ âm), chuyển đ/Đ thành d/D
 */
export function remove_diacritics(str_nfd) {
  // Loại bỏ toàn bộ diacritics (Combining marks - \p{M} category \u0300-\u036F)
  let folded = str_nfd.replace(/[\u0300-\u036f]/g, "");

  // Xử lý riêng chữ đ/Đ: Unicode của đ là U+0111
  folded = folded.replace(/đ/g, "d").replace(/Đ/g, "D");

  return folded;
}

/**
 * Xóa ký tự ẩn (ZWSP, LRM,...), chuẩn hóa whitespace, và đặc biệt:
 * cắt bỏ các ký tự dấu Telex lẻ loi ở cuối từ (nếu có lỗi gõ phím chưa được convert thành dấu).
 * Ví dụ: "quang hof" -> "quang ho" (sau đó Mongo regex sẽ tự tìm ra quang hoà)
 */
export function clean_whitespace_and_hidden_chars(input) {
  if (!input) return "";
  let cleaned = input.replace(HIDDEN_CHARS_REGEX, "");
  // Chuyển NBSP (\u00A0) và các loại space khác thành space thường
  cleaned = cleaned.replace(/[\s\u00A0]+/g, " ");

  // Clean telex trailing tone marks (f, s, r, x, j) ngay sau nguyên âm
  // Việc này xử lý trường hợp user type "quang hof" thay vì "quang hoà"
  cleaned = cleaned
    .split(" ")
    .map((word) => {
      return word.replace(/([aăâeêioôơuưy]+)[fsrxj]$/iu, "$1");
    })
    .join(" ");

  return cleaned.trim();
}

/**
 * Hàm tổng quát xử lý chuỗi phục vụ Search
 * Đảm bảo Idempotent: normalize_for_search(normalize_for_search(x)) == normalize_for_search(x)
 *
 * @param {string} input
 * @param {object} options
 * @returns { canonical: string, folded: string, tokens: string[] }
 */
export function normalize_for_search(input, options = {}) {
  const opts = {
    canonicalize_tone: true,
    fold_case: true,
    fold_accents: true,
    tokenize: false,
    ...options,
  };

  if (!input) return { canonical: "", folded: "", tokens: [] };

  // 1. Dọn dẹp whitespace, hidden chars
  let normalized = clean_whitespace_and_hidden_chars(String(input));

  // 2. Phân rã NFD để lộ dấu (combining marks)
  normalized = normalized.normalize("NFD");

  // 3. Lowercase (case folding an toàn trên NFD)
  if (opts.fold_case) {
    normalized = normalized.toLowerCase();
  }

  // 4. Tone canonicalization (Chuẩn hóa vị trí dấu thanh)
  if (opts.canonicalize_tone) {
    normalized = canonicalize_vietnamese_tones(normalized);
  }

  // 5. Accent folding (Bỏ dấu)
  let folded = normalized;
  if (opts.fold_accents) {
    folded = remove_diacritics(folded);
  }

  // 6. Trả lại dạng gom NFC gọn gàng
  const canonical = normalized.normalize("NFC");
  folded = folded.normalize("NFC");

  // 7. Tokenization
  let tokens = [];
  if (opts.tokenize) {
    // Tách theo khoảng trắng và các ký tự punctuation phổ biến
    tokens = folded.split(/[\s\p{P}]+/u).filter(Boolean);
  }

  return { canonical, folded, tokens };
}

/**
 * Tạo Regex Pattern tiếng Việt hỗ trợ tìm kiếm không dấu (Accent-insensitive) cho MongoDB.
 * Chuyển một chuỗi đã được bỏ dấu (folded) thành regex pattern khớp với mọi biến thể có dấu (NFC hoặc NFD).
 * Ví dụ: "nguyen" -> "ng[\u0300-\u036f]*[uúùủũụưứừửữự][\u0300-\u036f]*[yýỳỷỹỵ][\u0300-\u036f]*[eéèẻẽẹêếềểễệ][\u0300-\u036f]*n[\u0300-\u036f]*"
 *
 * @param {string} folded_str - Chuỗi đã được normalize_for_search và bỏ dấu
 * @returns {string} Regex pattern
 */

const VI_CHAR_CLASS = {
  a: "aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ",
  e: "eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ",
  i: "iìíỉĩịIÌÍỈĨỊ",
  o: "oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ",
  u: "uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ",
  y: "yỳýỷỹỵYỲÝỶỸỴ",
  d: "dđDĐ",
};

const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function build_vietnamese_regex(token = "") {
  const escaped = escapeRegExp(String(token));
  return escaped.replace(/[aeiouydAEIOUYD]/g, (ch) => {
    const cls = VI_CHAR_CLASS[ch.toLowerCase()];
    return cls ? `[${cls}]` : ch;
  });
}
