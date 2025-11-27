// src/services/groupStageNotification.js
import Bracket from "../../models/bracketModel.js";
import Match from "../../models/matchModel.js";
import Registration from "../../models/registrationModel.js";
import { publishNotification, EVENTS } from "./notificationHub.js";
import mongoose from "mongoose";

function asStr(v) {
  return v ? String(v) : null;
}

function formatRegPair(reg) {
  if (!reg) return "";
  const pick = (p) =>
    p?.user?.nickname ||
    p?.user?.nickName ||
    p?.nickName ||
    p?.fullName ||
    p?.name ||
    null;

  const n1 = pick(reg.player1) || "VĐV 1";
  const n2 = pick(reg.player2);
  return n2 ? `${n1} & ${n2}` : n1;
}

// ✅ bóc _id nếu truyền cả document / object
function normalizeId(v) {
  if (!v) return null;
  if (typeof v === "object" && v._id) return String(v._id);
  return String(v);
}

/**
 * Gửi thông báo kết quả vòng bảng cho toàn bộ VĐV trong **1 group** của 1 bracket.
 *
 * - BẮT BUỘC truyền groupId (bảng nào thì chỉ bắn cho bảng đó).
 * - Chỉ chạy khi tất cả trận của group đó (các match có pool.id = group._id)
 *   mà đã có đủ 2 đội (pairA, pairB != null) đều ở trạng thái finished.
 * - Xác định qualified nếu registration xuất hiện ở stage tiếp theo (stage+1) bất kỳ bracket nào.
 * - CHỈ gửi event GROUP_STAGE_RESULT (không gửi đối thủ vòng sau).
 */
export async function notifyGroupStageResults({
  tournamentId,
  bracketId,
  groupId,
} = {}) {
  try {
    if (!bracketId) return { ok: false, error: "missing bracketId" };
    if (!groupId) return { ok: false, error: "missing groupId" };

    const br = await Bracket.findById(bracketId)
      .select(
        "tournament stage type groups config.roundRobin.points config.roundRobin.tiebreakers"
      )
      .lean();

    if (!br || br.type !== "group") {
      return { ok: false, error: "not a group bracket" };
    }

    const tourId = normalizeId(tournamentId || br.tournament);
    if (!tourId) {
      return { ok: false, error: "missing tournamentId" };
    }

    // 👉 Chỉ xử lý đúng 1 group
    const groupIdStr = String(groupId);
    const group = (br.groups || []).find((g) => String(g._id) === groupIdStr);

    if (!group) {
      return { ok: false, reason: "group_not_found" };
    }

    const groupRegIds = (group.regIds || []).map((id) => String(id));
    const uniqueGroupRegIds = [...new Set(groupRegIds)];

    if (!uniqueGroupRegIds.length) {
      return { ok: false, reason: "group_empty" };
    }

    // 1) Chỉ bắn khi group này đã hoàn thành:
    //    mọi match của group (pool.id = group._id) có đủ 2 đội đều finished.
    const notDone = await Match.countDocuments({
      tournament: tourId,
      bracket: bracketId,
      "pool.id": group._id,
      pairA: { $ne: null },
      pairB: { $ne: null },
      status: { $ne: "finished" },
    });

    if (notDone > 0) {
      // group này chưa xong -> thôi, lần sau gọi lại
      return { ok: false, reason: "group_not_complete" };
    }

    // 2) Lấy config round-robin
    const rrCfg = br.config?.roundRobin || {};
    const pointsCfg = rrCfg.points || {};
    const winPts = typeof pointsCfg.win === "number" ? pointsCfg.win : 1;
    const lossPts = typeof pointsCfg.loss === "number" ? pointsCfg.loss : 0;
    const tiebreakers =
      Array.isArray(rrCfg.tiebreakers) && rrCfg.tiebreakers.length
        ? rrCfg.tiebreakers
        : ["h2h", "setsDiff", "pointsDiff", "pointsFor"];

    // 3) Tìm các bracket stage tiếp theo để xác định đội đi tiếp (qualified)
    const nextBrs = await Bracket.find({
      tournament: tourId,
      stage: (br.stage || 1) + 1,
    })
      .select("_id")
      .lean();

    const qualifiedRegIds = new Set();
    if (nextBrs.length) {
      const nextIds = nextBrs.map((b) => b._id);
      const kvalMatches = await Match.find({
        tournament: tourId,
        bracket: { $in: nextIds },
      })
        .select("pairA pairB")
        .lean();

      for (const m of kvalMatches) {
        if (m.pairA) qualifiedRegIds.add(String(m.pairA));
        if (m.pairB) qualifiedRegIds.add(String(m.pairB));
      }
    }

    // 4) Lấy danh sách Registration của riêng group này để map userId
    const regs = await Registration.find({
      _id: { $in: uniqueGroupRegIds },
    })
      .select("player1.user player2.user")
      .populate({
        path: "player1.user",
        select: "nickname nickName fullName name",
      })
      .populate({
        path: "player2.user",
        select: "nickname nickName fullName name",
      })
      .lean();

    const regMap = new Map();
    for (const r of regs) regMap.set(String(r._id), r);

    // 5) Load toàn bộ match của group này
    const groupMatches = await Match.find({
      tournament: tourId,
      bracket: bracketId,
      "pool.id": group._id,
    })
      .select("pool pairA pairB winner gameScores status")
      .lean();

    const stats = new Map();

    // Init stats cho từng đội trong group
    for (const rid of uniqueGroupRegIds) {
      stats.set(rid, {
        regId: rid,
        played: 0,
        wins: 0,
        losses: 0,
        rrPoints: 0,
        setsFor: 0,
        setsAgainst: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      });
    }

    // Tính toán dựa trên các match đã finished
    for (const m of groupMatches) {
      if (m.status !== "finished") continue;
      const aId = asStr(m.pairA);
      const bId = asStr(m.pairB);
      if (!aId || !bId) continue;
      if (!stats.has(aId) || !stats.has(bId)) continue;

      const sA = stats.get(aId);
      const sB = stats.get(bId);

      sA.played += 1;
      sB.played += 1;

      let setsA = 0;
      let setsB = 0;
      let ptsA = 0;
      let ptsB = 0;

      for (const gsc of m.gameScores || []) {
        const ga = Number(gsc.a) || 0;
        const gb = Number(gsc.b) || 0;
        ptsA += ga;
        ptsB += gb;
        if (ga > gb) setsA += 1;
        else if (gb > ga) setsB += 1;
      }

      sA.setsFor += setsA;
      sA.setsAgainst += setsB;
      sB.setsFor += setsB;
      sB.setsAgainst += setsA;
      sA.pointsFor += ptsA;
      sA.pointsAgainst += ptsB;
      sB.pointsFor += ptsB;
      sB.pointsAgainst += ptsA;

      if (m.winner === "A") {
        sA.wins += 1;
        sB.losses += 1;
        sA.rrPoints += winPts;
        sB.rrPoints += lossPts;
      } else if (m.winner === "B") {
        sB.wins += 1;
        sA.losses += 1;
        sB.rrPoints += winPts;
        sA.rrPoints += lossPts;
      }
    }

    const rows = Array.from(stats.values()).map((row) => ({
      ...row,
      setsDiff: row.setsFor - row.setsAgainst,
      pointsDiff: row.pointsFor - row.pointsAgainst,
    }));

    // Base sort: điểm, setsDiff, pointsDiff, pointsFor
    rows.sort((a, b) => {
      if (a.rrPoints !== b.rrPoints) return b.rrPoints - a.rrPoints;
      if (a.setsDiff !== b.setsDiff) return b.setsDiff - a.setsDiff;
      if (a.pointsDiff !== b.pointsDiff) return b.pointsDiff - a.pointsDiff;
      if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
      return 0;
    });

    // H2H đơn giản cho cụm 2 đội nếu có config "h2h"
    const gmList = groupMatches || [];

    const applyHeadToHead = (cluster) => {
      if (cluster.length <= 1) return cluster;
      if (cluster.length === 2 && tiebreakers.includes("h2h")) {
        const [r1, r2] = cluster;
        const r1id = r1.regId;
        const r2id = r2.regId;
        let r1wins = 0;
        let r2wins = 0;

        for (const m of gmList) {
          const a = asStr(m.pairA);
          const b = asStr(m.pairB);
          if (!a || !b) continue;
          if ((a === r1id && b === r2id) || (a === r2id && b === r1id)) {
            if (m.winner === "A") {
              if (a === r1id) r1wins += 1;
              if (a === r2id) r2wins += 1;
            } else if (m.winner === "B") {
              if (b === r1id) r1wins += 1;
              if (b === r2id) r2wins += 1;
            }
          }
        }

        if (r1wins !== r2wins) {
          return r1wins > r2wins ? [r1, r2] : [r2, r1];
        }
      }
      return cluster;
    };

    // Áp H2H theo cluster có cùng key (rrPoints, setsDiff, pointsDiff)
    if (tiebreakers.includes("h2h")) {
      const finalRows = [];
      let buf = [];
      let prevKey = null;

      const flush = () => {
        if (!buf.length) return;
        finalRows.push(...applyHeadToHead(buf));
        buf = [];
      };

      for (const row of rows) {
        const key = `${row.rrPoints}|${row.setsDiff}|${row.pointsDiff}`;
        if (prevKey === null || key === prevKey) {
          buf.push(row);
        } else {
          flush();
          buf.push(row);
        }
        prevKey = key;
      }
      flush();
      rows.splice(0, rows.length, ...finalRows);
    }

    const totalTeams = rows.length;
    const notifications = [];

    // Build ctx & gửi notif cho từng registration trong group
    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      const rank = idx + 1;
      const qualified = qualifiedRegIds.has(row.regId);
      const reg = regMap.get(row.regId);
      if (!reg) continue;

      const uids = [];
      if (reg.player1?.user) {
        uids.push(asStr(reg.player1.user._id || reg.player1.user));
      }
      if (reg.player2?.user) {
        uids.push(asStr(reg.player2.user._id || reg.player2.user));
      }

      const uniqueUserIds = [...new Set(uids.filter(Boolean))];
      if (!uniqueUserIds.length) continue;
      const ctx = {
        tournamentId: String(tourId),
        bracketId: String(bracketId),
        groupId: groupIdStr,
        groupName: group.name,
        registrationId: row.regId,
        rank,
        totalTeams,
        qualified,
        topicType: "tournament",
        topicId: tourId, // giờ luôn là id string, không phải document
        category: "result",
        overrideAudience: uniqueUserIds,
      };
      notifications.push(ctx);
    }

    // Gửi notif kết quả vòng bảng (song song, không block từng cái)
    if (notifications.length) {
      await Promise.allSettled(
        notifications.map((ctx) =>
          publishNotification(EVENTS.GROUP_STAGE_RESULT, ctx).catch((e) => {
            console.error(
              "[notifyGroupStageResults] result error reg#",
              ctx.registrationId,
              e?.message || e
            );
            return null;
          })
        )
      );
    }

    return { ok: true, count: notifications.length };
  } catch (e) {
    console.error("[notifyGroupStageResults] fatal:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function notifyGroupNextOpponents({ tournamentId, bracketId }) {
  try {
    if (!tournamentId || !bracketId) {
      console.warn(
        "[notifyGroupNextOpponents] missing tournamentId/bracketId, skip."
      );
      return { count: 0 };
    }

    const tourIdStr = String(tournamentId);

    // Dynamic import để tránh circular
    const [{ default: Bracket }, { default: Match }] = await Promise.all([
      import("../../models/bracketModel.js"),
      import("../../models/matchModel.js"),
    ]);

    // ===== Chuẩn hoá bracketId (có thể là ObjectId / string / doc) =====
    let groupBracketId = null;

    // Trường hợp là ObjectId thật
    if (mongoose.isValidObjectId(bracketId)) {
      groupBracketId = bracketId;
    }
    // Trường hợp là doc Bracket (có _id)
    else if (
      bracketId &&
      typeof bracketId === "object" &&
      bracketId._id &&
      mongoose.isValidObjectId(bracketId._id)
    ) {
      groupBracketId = bracketId._id;
    }
    // Trường hợp là string nhưng là 24-hex hợp lệ
    else if (
      typeof bracketId === "string" &&
      mongoose.isValidObjectId(bracketId.trim())
    ) {
      groupBracketId = bracketId.trim();
    } else {
      console.warn(
        "[notifyGroupNextOpponents] invalid bracketId, skip. bracketId=",
        bracketId
      );
      return { count: 0 };
    }

    const bracketIdStr = String(groupBracketId);

    // 1) Lấy bracket vòng bảng
    const groupBracket = await Bracket.findById(groupBracketId)
      .select("_id stage type")
      .lean();

    if (!groupBracket) {
      console.warn(
        "[notifyGroupNextOpponents] groupBracket not found, skip.",
        bracketIdStr
      );
      return { count: 0 };
    }

    if (groupBracket.type !== "group") {
      console.warn(
        "[notifyGroupNextOpponents] bracket is not group, skip.",
        bracketIdStr
      );
      return { count: 0 };
    }

    const stageIndex = groupBracket.stage;
    if (stageIndex === undefined || stageIndex === null) {
      console.warn(
        "[notifyGroupNextOpponents] missing stageIndex on groupBracket, skip."
      );
      return { count: 0 };
    }

    // 2) Tìm các bracket knockout (hoặc tương đương) cùng stage
    const koBrackets = await Bracket.find({
      tournament: tournamentId,
      // stage: stageIndex,
      type: { $in: ["knockout"] },
    })
      .select("_id type name")
      .lean();

    if (!koBrackets.length) {
      console.log(
        "[notifyGroupNextOpponents] no KO brackets for this stage, skip."
      );
      return { count: 0 };
    }

    const koBracketIds = koBrackets.map((b) => b._id);

    // 3) Lấy các trận knockout cùng stage, đã có đủ 2 đội
    const matches = await Match.find({
      tournament: tournamentId,
      bracket: { $in: koBracketIds },
      stageIndex,
      format: { $ne: "group" },
      status: { $in: ["scheduled", "queued", "assigned"] },
      pairA: { $ne: null },
      pairB: { $ne: null },
    })
      .populate({
        path: "pairA",
        select: "teamName label player1.user player2.user",
        populate: [
          {
            path: "player1.user",
            select: "name fullName nickname nickName",
          },
          {
            path: "player2.user",
            select: "name fullName nickname nickName",
          },
        ],
      })
      .populate({
        path: "pairB",
        select: "teamName label player1.user player2.user",
        populate: [
          {
            path: "player1.user",
            select: "name fullName nickname nickName",
          },
          {
            path: "player2.user",
            select: "name fullName nickname nickName",
          },
        ],
      })
      .select("_id bracket pairA pairB")
      .lean();

    if (!matches.length) {
      console.log(
        "[notifyGroupNextOpponents] no KO matches with both pairs ready, skip."
      );
      return { count: 0 };
    }

    const notifications = [];

    const extractTeamInfo = (reg) => {
      if (!reg) return { users: [], label: "" };
      const users = [];
      if (reg.player1?.user) users.push(String(reg.player1.user));
      if (reg.player2?.user) users.push(String(reg.player2.user));
      const label = reg.teamName || reg.label || "Đội của bạn";
      return { users, label };
    };

    for (const m of matches) {
      if (!m.pairA || !m.pairB) continue;

      const { users: pairAUsers, label: teamALabel } = extractTeamInfo(m.pairA);
      const { users: pairBUsers, label: teamBLabel } = extractTeamInfo(m.pairB);

      // A: báo đối thủ là B
      if (pairAUsers.length && teamBLabel) {
        notifications.push({
          tournamentId: tourIdStr,
          bracketId: bracketIdStr, // bracket vòng bảng
          nextBracketId: String(m.bracket), // bracket knockout
          nextMatchId: String(m._id),
          registrationId: String(m.pairA._id),
          myTeamName: teamALabel,
          opponentName: teamBLabel,
          topicType: "tournament",
          topicId: tourIdStr,
          category: "result",
          overrideAudience: pairAUsers,
        });
      }

      // B: báo đối thủ là A
      if (pairBUsers.length && teamALabel) {
        notifications.push({
          tournamentId: tourIdStr,
          bracketId: bracketIdStr,
          nextBracketId: String(m.bracket),
          nextMatchId: String(m._id),
          registrationId: String(m.pairB._id),
          myTeamName: teamBLabel,
          opponentName: teamALabel,
          topicType: "tournament",
          topicId: tourIdStr,
          category: "result",
          overrideAudience: pairBUsers,
        });
      }
    }

    if (!notifications.length) {
      console.log("[notifyGroupNextOpponents] nothing to notify after filter.");
      return { count: 0 };
    }

    await publishNotification(EVENTS.GROUP_STAGE_NEXT_OPPONENT, notifications);

    console.log(
      "[notifyGroupNextOpponents] queued notifications:",
      notifications.length
    );

    return { count: notifications.length };
  } catch (err) {
    console.error("[notifyGroupNextOpponents] error:", err?.message || err);
    return { count: 0, error: err?.message || String(err) };
  }
}
