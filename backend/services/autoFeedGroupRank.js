// services/autoFeedGroupRank.js
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";

/** Normalize token nhóm: "a"->"A", "A"->"A", "1"->"1", "...1" -> "1" nếu có số ở cuối */
function normGroupToken(x) {
  if (x === 0) return "0";
  if (!x) return "";
  const s = String(x).trim().toUpperCase();
  const m = s.match(/(\d+)\s*$/); // ưu tiên số thứ tự ở cuối
  if (m) return m[1];
  if (/^[A-Z]+$/.test(s)) return s;
  return s;
}

/**
 * Tính BXH tạm thời cho 1 bracket group-like.
 * Trả về Map với nhiều alias cho mỗi bảng:
 *  - theo chữ (A/B/C…)
 *  - theo số thứ tự 1/2/3… (thứ tự trong mảng groups)
 *  - thêm alias "B{n}","G{n}"
 * 👉 CHỈ đưa vào BXH những đội đã thi đấu (gp > 0).
 */
async function computeGroupTables({ bracketId, groups, log }) {
  // Lấy toàn bộ trận group-like trong bracket
  const matches = await Match.find({
    bracket: bracketId,
    format: { $in: ["group", "round_robin", "gsl"] },
  })
    .select("_id pool.name pairA pairB winner gameScores")
    .lean();

  // Chuẩn hoá nhóm
  const groupsNorm = (groups || []).map((g, idx) => {
    const code = String(g.name || g.code || "").trim();
    const order = Number.isFinite(g.order) ? g.order : idx + 1; // 1-based
    return {
      code,
      order,
      regSet: new Set((g.regIds || []).map(String)),
      stats: new Map(), // regId -> { wins, losses, pf, pa, gp }
    };
  });

  // Init stats
  for (const g of groupsNorm) {
    for (const rid of g.regSet) {
      g.stats.set(rid, { wins: 0, losses: 0, pf: 0, pa: 0, gp: 0 });
    }
  }

  // Cộng dồn thống kê
  for (const m of matches) {
    const gkey = String(m?.pool?.name || "").trim(); // pool.name = "A"/"B"/"1"/...
    if (!gkey) continue;
    const g = groupsNorm.find(
      (it) =>
        it.code.toUpperCase() === gkey.toUpperCase() ||
        String(it.order) === gkey
    );
    if (!g) continue;

    const a = m.pairA ? String(m.pairA) : null;
    const b = m.pairB ? String(m.pairB) : null;
    if (!a || !b) continue;
    if (!g.stats.has(a) || !g.stats.has(b)) continue;

    const sa = g.stats.get(a);
    const sb = g.stats.get(b);

    // đã thi đấu → +1 trận cho cả hai
    sa.gp += 1;
    sb.gp += 1;

    // cộng điểm “for/against” nhờ gameScores (nếu có)
    if (Array.isArray(m.gameScores) && m.gameScores.length) {
      let sumA = 0,
        sumB = 0;
      for (const gs of m.gameScores) {
        sumA += Number(gs?.a || 0);
        sumB += Number(gs?.b || 0);
      }
      sa.pf += sumA;
      sa.pa += sumB;
      sb.pf += sumB;
      sb.pa += sumA;
    }

    if (m.winner === "A") {
      sa.wins += 1;
      sb.losses += 1;
    } else if (m.winner === "B") {
      sb.wins += 1;
      sa.losses += 1;
    }
  }

  // Xếp hạng từng bảng:
  //  - CHỈ lấy các đội gp > 0 (đã thi đấu)
  //  - sort: wins desc -> (pf-pa) desc -> pf desc
  //  - build alias keys
  const tableMap = new Map(); // key -> [regId hạng 1..n]
  for (const g of groupsNorm) {
    const arr = [...g.stats.entries()]
      .map(([rid, s]) => ({
        rid,
        gp: s.gp,
        wins: s.wins,
        losses: s.losses,
        diff: s.pf - s.pa,
        pf: s.pf,
      }))
      .filter((r) => r.gp > 0); // 🔒 chỉ đội đã thi đấu

    arr.sort((x, y) => y.wins - x.wins || y.diff - x.diff || y.pf - x.pf);
    const rankList = arr.map((r) => r.rid);

    const codeUp = g.code ? g.code.toUpperCase() : "";
    const orderStr = String(g.order);

    const keys = new Set([
      codeUp,
      orderStr,
      `B${orderStr}`,
      `G${orderStr}`,
      normGroupToken(codeUp),
      normGroupToken(orderStr),
    ]);
    for (const k of keys) {
      if (!k) continue;
      tableMap.set(k, rankList);
    }

    if (log)
      console.log(
        `[feed] table ${codeUp || orderStr}:`,
        rankList,
        "(only teams with gp>0)"
      );
  }

  return tableMap;
}

/**
 * Auto-feed seeds type 'groupRank' từ bracket vòng bảng sang các trận ở stage sau.
 * - KHÔNG unset seedA/seedB để có thể cập nhật liên tục khi BXH thay đổi (lock sớm).
 * - Chỉ fill nếu đội ở vị trí rank đã THI ĐẤU (gp>0). Nếu chưa, giữ nguyên placeholder.
 */
export async function autoFeedGroupRank({
  tournamentId,
  bracketId,
  stageIndex,
  provisional = true,
  log = false,
}) {
  const br = await Bracket.findById(bracketId).lean();
  if (!br) throw new Error("Group bracket not found");
  if (!["group", "round_robin", "gsl"].includes(br.type)) {
    if (log) {
      console.log(
        `[feed] bracket ${bracketId} type=${br.type} is not group-like, skip.`
      );
    }
    return { updated: 0, touchedMatches: 0, reason: "not-group" };
  }

  const groups = Array.isArray(br.groups) ? br.groups : [];
  if (!groups.length) {
    if (log) console.log("[feed] no groups in bracket");
    return { updated: 0, touchedMatches: 0, reason: "no-groups" };
  }

  // 1) BXH tạm thời (đã lọc gp>0)
  const tables = await computeGroupTables({ bracketId, groups, log });

  // 2) Tìm các trận có seed groupRank tham chiếu stageIndex này
  const st = Number(stageIndex || br.stage || 1);

  const stageFilter = [
    { "seedA.ref.stageIndex": st },
    { "seedA.ref.stage": st },
    { "seedA.ref.stageIndex": String(st) },
    { "seedA.ref.stage": String(st) },
    { "seedB.ref.stageIndex": st },
    { "seedB.ref.stage": st },
    { "seedB.ref.stageIndex": String(st) },
    { "seedB.ref.stage": String(st) },
  ];

  const matches = await Match.find({
    tournament: tournamentId,
    $or: [{ "seedA.type": "groupRank" }, { "seedB.type": "groupRank" }],
    $and: [{ $or: stageFilter }],
  })
    .select("_id seedA seedB pairA pairB labelKey")
    .lean();

  let targets = 0;
  let updated = 0;

  // 3) Resolve từng side
  for (const m of matches) {
    for (const side of ["A", "B"]) {
      const seed = m[`seed${side}`];
      if (!seed || seed.type !== "groupRank") continue;

      const ref = seed.ref || {};
      const rawToken =
        ref.groupCode ??
        ref.group ??
        ref.pool ??
        ref.groupName ??
        ref.code ??
        "";
      const token = normGroupToken(rawToken);
      const rank = Number(ref.rank || ref.place || 0);
      if (!token || !rank) continue;

      targets++;

      const list = tables.get(token); // đã lọc chỉ có đội gp>0
      const regId = Array.isArray(list) ? list[rank - 1] : null;

      if (!regId) {
        if (log)
          console.log(
            `[feed] ${
              m.labelKey || m._id
            } ${side}: waiting ${rawToken}#${rank} (no team with gp>0)`
          );
        continue; // chưa có đội đã thi đấu cho rank này ⇒ giữ placeholder
      }

      const field = side === "A" ? "pairA" : "pairB";
      const cur = String(m[field] || "");
      if (cur === String(regId)) {
        if (log)
          console.log(`[feed] ${m.labelKey || m._id} no change ${field}`);
        continue;
      }

      const res = await Match.updateOne(
        { _id: m._id },
        { $set: { [field]: regId } } // KHÔNG unset seed → tiếp tục sync khi BXH đổi
      );
      if (res.modifiedCount > 0) {
        updated++;
        if (log)
          console.log(
            `[feed] ${
              m.labelKey || m._id
            } set ${field} <- ${regId} (from ${rawToken}#${rank})`
          );
      }
    }
  }

  if (log)
    console.log(
      `[feed] groupRank targets: ${targets} updated: ${updated} (stage=${st})`
    );

  return { updated, touchedMatches: targets, stageIndex: st };
}
