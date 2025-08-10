import mongoose from "mongoose";
import Match from "../models/matchModel.js";

/**
 * Reset các trận phụ thuộc theo chuỗi nextMatch:
 *  - Ở mỗi bước, gỡ đội ở slot A/B tương ứng (từ trận trước đổ sang)
 *  - Đưa match về scheduled, xoá winner, xoá gameScores
 *  - Tiếp tục đi tới nextMatch của nó
 *  - KHÔNG đụng vào các slot không liên quan
 */
export async function softResetChainFrom(rootMatchId, session = null) {
  let cur = await Match.findById(rootMatchId).session(session);
  if (!cur) return;

  // Bắt đầu từ trận KẾ TIẾP của root
  while (cur?.nextMatch && cur?.nextSlot) {
    const next = await Match.findById(cur.nextMatch).session(session);
    if (!next) break;

    const slotField = cur.nextSlot === "A" ? "pairA" : "pairB";

    // Chỉ gỡ slot được feed từ trận trước đó
    next[slotField] = null;
    next.status = "scheduled";
    next.winner = "";
    next.gameScores = [];

    await next.save({ session });

    // Nhảy tiếp sang trận sau
    cur = next;
  }
}
