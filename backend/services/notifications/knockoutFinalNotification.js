// src/services/notifications/knockoutFinalNotification.js
import mongoose from "mongoose";
import Tournament from "../../models/tournamentModel.js";
import Bracket from "../../models/bracketModel.js";
import Registration from "../../models/registrationModel.js";
import { publishNotification, EVENTS, CATEGORY } from "./notificationHub.js";

const { Types } = mongoose;

// Deduplicate string ids
const uniqStrings = (arr = []) => {
  const out = new Set();
  for (const v of arr) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    out.add(s);
  }
  return [...out];
};

// Deduplicate and chỉ giữ những cái là ObjectId hợp lệ (dùng cho _id query)
const uniqValidIdStrings = (arr = []) => {
  const out = new Set();
  for (const v of arr) {
    if (v == null) continue;
    let s;
    if (v instanceof Types.ObjectId) s = v.toHexString();
    else s = String(v).trim();
    if (!Types.ObjectId.isValid(s)) continue;
    out.add(s);
  }
  return [...out];
};

function buildTeamName(reg) {
  if (!reg) return "Đội chưa rõ";

  const p1 =
    reg.player1?.nickName ||
    reg.player1?.fullName ||
    reg.player1?.displayName ||
    reg.player1?.user?.nickname ||
    reg.player1?.user?.fullName ||
    "VĐV 1";

  const p2 =
    reg.player2?.nickName ||
    reg.player2?.fullName ||
    reg.player2?.displayName ||
    reg.player2?.user?.nickname ||
    reg.player2?.user?.fullName ||
    null;

  return p2 ? `${p1} & ${p2}` : p1;
}

function collectUserIdsFromReg(reg) {
  const ids = [];
  if (reg?.player1?.user) ids.push(String(reg.player1.user));
  if (reg?.player2?.user) ids.push(String(reg.player2.user));
  return ids;
}

/**
 * Khi bracket knockout đã hoàn tất:
 *  - 1 thông báo SYSTEM_BROADCAST tóm tắt top 1–4
 *  - Thông báo riêng THEO CỤM hạng:
 *      + 1 phát cho tất cả user hạng Nhất
 *      + 1 phát cho tất cả user hạng Nhì
 *      + 1 phát cho tất cả user hạng Ba / đồng hạng Ba
 *      + 1 phát cho tất cả user hạng Tư (nếu có)
 *
 * GỌI Ở: matchModel post-save / post-findOneAndUpdate khi status="finished"
 */
export async function notifyKnockoutFinalStandings({
  tournamentId,
  bracketId,
}) {
  if (!bracketId) return;

  const Match = mongoose.model("Match");

  const br = await Bracket.findById(bracketId)
    .select("type name stage tournament meta")
    .lean();

  if (!br) return;
  if (br.type !== "knockout") return;

  const tourId = tournamentId || br.tournament;
  const tour = tourId
    ? await Tournament.findById(tourId).select("name").lean()
    : null;
  const tourName = tour?.name || "Giải đấu";

  // 1) Chỉ bắn khi KHÔNG còn match nào chưa finish trong bracket này
  const stillPlaying = await Match.exists({
    bracket: br._id,
    status: { $ne: "finished" },
  });
  if (stillPlaying) return;

  // 2) Gate: mỗi bracket chỉ bắn 1 lần
  const gate = await Bracket.findOneAndUpdate(
    {
      _id: br._id,
      "meta.knockoutFinalNotified": { $ne: true },
    },
    { $set: { "meta.knockoutFinalNotified": true } },
    { new: false }
  ).lean();

  // Nếu đã có flag rồi -> có người khác bắn rồi, thôi
  if (!gate) return;

  // 3) Lấy toàn bộ match trong bracket để suy ra thứ hạng
  const matches = await Match.find({ bracket: br._id })
    .select("branch round status winner pairA pairB meta isThirdPlace")
    .lean();
  if (!matches.length) return;

  const mainMatches = matches.filter((m) => m.branch === "main");
  if (!mainMatches.length) return;

  const maxRound = mainMatches.reduce(
    (acc, m) => Math.max(acc, Number(m.round || 0)),
    0
  );
  if (!maxRound || !Number.isFinite(maxRound)) return;

  const finals = mainMatches.filter((m) => Number(m.round) === maxRound);
  if (finals.length !== 1) return;

  const final = finals[0];
  if (final.status !== "finished" || !final.winner) return;

  const pairAId = final.pairA ? String(final.pairA) : null;
  const pairBId = final.pairB ? String(final.pairB) : null;

  let championRegId = null;
  let runnerUpRegId = null;

  if (pairAId && pairBId) {
    if (final.winner === "A") {
      championRegId = pairAId;
      runnerUpRegId = pairBId;
    } else if (final.winner === "B") {
      championRegId = pairBId;
      runnerUpRegId = pairAId;
    }
  }

  if (!championRegId || !runnerUpRegId) return;

  // 4) Suy ra hạng 3/4
  let thirdRegIds = [];
  let fourthRegIds = [];

  let thirdMatch =
    matches.find((m) => m.isThirdPlace) ||
    matches.find((m) => m.meta?.thirdPlace) ||
    matches.find((m) => {
      if (m.branch !== "consol") return false;
      const label = m.meta?.stageLabel;
      if (typeof label !== "string") return false;
      const l = label.toLowerCase();
      return l.includes("3/4") || l.includes("3-4") || l.includes("hạng 3");
    });

  if (thirdMatch && thirdMatch.status === "finished" && thirdMatch.winner) {
    const tAId = thirdMatch.pairA ? String(thirdMatch.pairA) : null;
    const tBId = thirdMatch.pairB ? String(thirdMatch.pairB) : null;

    if (tAId && tBId) {
      if (thirdMatch.winner === "A") {
        thirdRegIds = [tAId];
        fourthRegIds = [tBId];
      } else if (thirdMatch.winner === "B") {
        thirdRegIds = [tBId];
        fourthRegIds = [tAId];
      }
    }
  } else {
    // Không có trận tranh 3/4 -> đồng hạng 3 = 2 đội thua bán kết
    const semiRound = maxRound - 1;
    const semiMatches = mainMatches.filter(
      (m) => Number(m.round) === semiRound && m.status === "finished"
    );

    if (semiMatches.length >= 2) {
      const losers = [];
      for (const sm of semiMatches) {
        const sAId = sm.pairA ? String(sm.pairA) : null;
        const sBId = sm.pairB ? String(sm.pairB) : null;
        if (!sAId || !sBId || !sm.winner) continue;

        if (sm.winner === "A") {
          losers.push(sBId);
        } else if (sm.winner === "B") {
          losers.push(sAId);
        }
      }
      thirdRegIds = uniqStrings(losers);
      fourthRegIds = []; // đồng hạng 3
    }
  }

  // 5) Lấy Registration cho các đội top 1–4
  const regIdStrings = uniqValidIdStrings([
    championRegId,
    runnerUpRegId,
    ...thirdRegIds,
    ...fourthRegIds,
  ]);

  if (!regIdStrings.length) return;

  const regs = await Registration.find({ _id: { $in: regIdStrings } })
    .select("player1 player2")
    .populate({
      path: "player1.user",
      select: "fullName name nickname displayName",
    })
    .populate({
      path: "player2.user",
      select: "fullName name nickname displayName",
    })
    .lean();

  const regMap = new Map(regs.map((r) => [String(r._id), r]));

  const championReg = regMap.get(String(championRegId));
  const runnerUpReg = regMap.get(String(runnerUpRegId));
  const thirdRegs = thirdRegIds
    .map((id) => regMap.get(String(id)))
    .filter(Boolean);
  const fourthRegs = fourthRegIds
    .map((id) => regMap.get(String(id)))
    .filter(Boolean);

  const championName = buildTeamName(championReg);
  const runnerUpName = buildTeamName(runnerUpReg);
  const thirdNames = thirdRegs.map(buildTeamName);
  const fourthNames = fourthRegs.map(buildTeamName);

  // 6) SYSTEM_BROADCAST: tóm tắt kết quả chung cuộc
  const bracketLabel = br.name ? ` • ${br.name}` : "";
  const title = `Kết quả chung cuộc • ${tourName}${bracketLabel}`;

  const lines = [];
  lines.push(`🏆 Hạng 1: ${championName}`);
  lines.push(`🥈 Hạng 2: ${runnerUpName}`);
  if (thirdNames.length) {
    const thirdLabel = thirdNames.length > 1 ? "🥉 Đồng hạng 3" : "🥉 Hạng 3";
    lines.push(`${thirdLabel}: ${thirdNames.join(", ")}`);
  }
  if (fourthNames.length) {
    lines.push(`🏅 Hạng 4: ${fourthNames.join(", ")}`);
  }

  const body = lines.join("\n");

  await publishNotification(
    EVENTS.SYSTEM_BROADCAST,
    {
      title,
      body,
      url: tourId ? `/tournament/${tourId}/bracket` : "/(tabs)/tournaments",
      category: CATEGORY.RESULT,
    },
    {}
  );

  // 7) Gửi riêng theo CỤM hạng (gom userIds, không for từng user)
  const championUserIds = uniqStrings(collectUserIdsFromReg(championReg));
  const runnerUpUserIds = uniqStrings(collectUserIdsFromReg(runnerUpReg));
  const thirdUserIds = uniqStrings(
    thirdRegs.flatMap((r) => collectUserIdsFromReg(r))
  );
  const fourthUserIds = uniqStrings(
    fourthRegs.flatMap((r) => collectUserIdsFromReg(r))
  );

  const rankGroups = [
    {
      label: "HẠNG NHẤT",
      emoji: "🏆",
      userIds: championUserIds,
    },
    {
      label: "HẠNG NHÌ",
      emoji: "🥈",
      userIds: runnerUpUserIds,
    },
    {
      label: thirdUserIds.length > 1 ? "ĐỒNG HẠNG BA" : "HẠNG BA",
      emoji: "🥉",
      userIds: thirdUserIds,
    },
    {
      label: "HẠNG TƯ",
      emoji: "🏅",
      userIds: fourthUserIds,
    },
  ].filter((g) => g.userIds && g.userIds.length);

  for (const g of rankGroups) {
    await publishNotification(
      EVENTS.USER_DIRECT_BROADCAST,
      {
        directUserIds: g.userIds, // 👈 1 phát cho cả cụm user cùng hạng
        title: `Kết quả của bạn • ${tourName}`,
        body: `${g.emoji} Bạn đã đạt ${g.label} tại ${tourName}${bracketLabel}.`,
        url: tourId ? `/tournament/${tourId}/bracket` : "/(tabs)/tournaments",
        // KHÔNG truyền topicId ở đây để không bị hiểu nhầm là userId trong implicitAudience
        category: CATEGORY.RESULT,
      },
      {}
    );
  }

  return {
    ok: true,
    tournamentId: tourId ? String(tourId) : null,
    bracketId: String(br._id),
  };
}
