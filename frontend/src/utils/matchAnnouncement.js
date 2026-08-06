// utils/matchAnnouncement.js
// Sinh voice tiếng Việt gọi VĐV về sân bằng Web Speech API (SpeechSynthesis).
// Chạy trực tiếp trên trình duyệt admin/BTC, không cần backend TTS.
//
// Format: "Mời cặp vận động viên <A1>, <A2> và <B1>, <B2> về sân <N>
//          làm thủ tục thi đấu"
import { getTournamentPlayerName } from "./tournamentName.js";

const trimName = (v) => String(v || "").trim();

// Lấy list tên VĐV của 1 pair. Ưu tiên fullName (đọc voice dễ hiểu hơn nickname).
// Dùng chung helper getTournamentPlayerName → xử lý được các trường lồng
// (player.user.fullName, player.user.name, displayName, v.v.)
function extractPlayerNames(pair) {
  if (!pair) return [];
  const raw = Array.isArray(pair.players) && pair.players.length
    ? pair.players
    : [pair.player1, pair.player2, pair.p1, pair.p2].filter(Boolean);
  const names = raw
    .map((p) => getTournamentPlayerName(p, "fullName", ""))
    .filter(Boolean);
  if (names.length) return names;
  // Fallback: split pair.name / teamName như "A / B"
  const teamStr = trimName(pair.teamName || pair.name || pair.displayName);
  if (teamStr) {
    return teamStr
      .split(/[\/&,]/)
      .map((s) => trimName(s))
      .filter(Boolean);
  }
  return [];
}

// Extract tên sân dễ đọc từ match. Cover đủ tên field như courtLabel()
// helper trong TournamentManagePage.
function extractCourtLabel(match) {
  const asText = (v) => {
    if (!v) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "object") {
      return String(
        v.name || v.label || v.code || v.title || "",
      ).trim();
    }
    return String(v).trim();
  };
  const candidates = [
    match?.courtStationLabel,
    match?.courtStationName,
    match?.courtLabel,
    match?.courtName,
    match?.courtStation,
    match?.courtAssigned,
    match?.assignedCourt,
    match?.court,
    match?.courtCode,
    match?.courtTitle,
  ];
  for (const c of candidates) {
    const s = asText(c);
    if (s) return s;
  }
  return "";
}

// Tạo câu thông báo tiếng Việt.
export function buildAnnouncementText(match) {
  const aNames = extractPlayerNames(match?.pairA);
  const bNames = extractPlayerNames(match?.pairB);
  const court = extractCourtLabel(match) || "được chỉ định";

  const joinNames = (arr) => arr.join(", ");
  const aText = aNames.length ? joinNames(aNames) : "cặp A";
  const bText = bNames.length ? joinNames(bNames) : "cặp B";

  return `Mời cặp vận động viên ${aText} và ${bText} về ${
    /^s(â|a)n\b/i.test(court) ? court : "sân " + court
  } làm thủ tục thi đấu.`;
}

// Chọn giọng đọc tiếng Việt tốt nhất có sẵn.
function pickVoice() {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices?.length) return null;
    // Ưu tiên vi-VN, sau đó vi, sau đó bất kỳ voice có "vietnam"
    const exact = voices.find((v) => /^vi[-_]?vn$/i.test(v.lang));
    if (exact) return exact;
    const startsVi = voices.find((v) => /^vi\b/i.test(v.lang));
    if (startsVi) return startsVi;
    const nameMatch = voices.find((v) => /viet/i.test(v.name));
    if (nameMatch) return nameMatch;
    return null;
  } catch {
    return null;
  }
}

// Phát voice. Trả về Promise resolve khi phát xong (hoặc reject nếu lỗi).
export function speakVi(text, opts = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      reject(new Error("Trình duyệt không hỗ trợ SpeechSynthesis"));
      return;
    }
    const synth = window.speechSynthesis;

    // Nếu voices chưa load, đợi 1 lần voiceschanged rồi phát.
    const doSpeak = () => {
      // Dừng phát hiện tại (nếu có) để tránh chồng chéo.
      try {
        synth.cancel();
      } catch {}

      const u = new SpeechSynthesisUtterance(text);
      u.lang = "vi-VN";
      u.rate = opts.rate ?? 0.95;
      u.pitch = opts.pitch ?? 1;
      u.volume = opts.volume ?? 1;
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = (e) => reject(e?.error || new Error("Lỗi phát voice"));
      synth.speak(u);
    };

    const voices = synth.getVoices();
    if (voices && voices.length > 0) {
      doSpeak();
    } else {
      const handler = () => {
        synth.removeEventListener?.("voiceschanged", handler);
        doSpeak();
      };
      synth.addEventListener?.("voiceschanged", handler);
      // Fallback timeout — 1s
      setTimeout(doSpeak, 1000);
    }
  });
}

export function announceMatch(match, opts) {
  const text = buildAnnouncementText(match);
  return speakVi(text, opts).then(() => text);
}
