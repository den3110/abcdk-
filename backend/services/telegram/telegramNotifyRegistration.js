// services/telegramNotifyRegistration.js
import Tournament from "../../models/tournamentModel.js";
import { sendToTopic } from "../../utils/telegram.js";
import dotenv from "dotenv"
dotenv.config()

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  // hiển thị gọn: tối đa 2 chữ số thập phân, bỏ .0
  return n.toFixed(2).replace(/\.?0+$/, "");
};

const pickName = (p = {}) =>
  p.nickName || p.nickname || p.fullName || p.name || "Ẩn danh";

export async function notifyNewPair({ tournamentId, reg }) {
  const t = await Tournament.findById(tournamentId).lean();
  const tele = t?.tele;
  if (!tele?.enabled || !tele?.hubChatId || !tele?.topicId) return;

  const p1Name = pickName(reg.player1 || {});
  const p2Name = reg.player2 ? pickName(reg.player2) : null;

  const s1 = fmtScore(reg.player1?.score);
  const s2 = reg.player2 ? fmtScore(reg.player2?.score) : null;

  // Nếu bạn có bracketName/eventName/levelLabel thì có thể chèn thêm 1 dòng ở giữa
  // const bracket = reg.bracketName || reg.eventName;
  // const level = reg.levelLabel ? ` — Trình: ${esc(reg.levelLabel)}` : "";
  const host= process.env.NODE_ENV=== "production" ? process.env.HOST : "http://localhost:5001"
  const url = `${host}/tournament/${t._id}/register`; // chỉnh theo route public của bạn
    console.log(url)
  const lines = [
    `✅ <b>Cặp đăng ký mới</b>`,
    `<b>Giải:</b> ${esc(t.title)}`,
    p2Name
      ? `<b>Cặp:</b> ${esc(p1Name)} — Điểm trình: ${s1} & ${esc(
          p2Name
        )} — Điểm: ${s2}`
      : `<b>VĐV:</b> ${esc(p1Name)} — Điểm trình: ${s1}`,
    `<a href="${url}">Xem giải</a>`,
  ];

  const text = lines.join("\n");

  try {
    await sendToTopic({ chatId: tele.hubChatId, topicId: tele.topicId, text });
  } catch (e) {
    console.error("[tele] notifyNewPair failed:", e.message);
  }
}
