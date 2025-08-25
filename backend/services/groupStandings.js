// services/groupStandings.js
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";

/**
 * Tính bảng xếp hạng cho 1 bracket GROUP.
 * Return: { byGroup: { [groupKey]: { complete, standings: [regId,...], stats: Map(regId=>{wins,losses,pointsFor,pointsAgainst}) } } }
 */
export async function computeGroupStandings(bracketId) {
  const bracket = await Bracket.findById(bracketId).lean();
  if (!bracket) throw new Error("Bracket not found");
  if (bracket.type !== "group") throw new Error("Bracket is not 'group'");

  // Map groupId/name -> list regIds (chuẩn từ bracket.groups)
  const groups = Array.isArray(bracket.groups) ? bracket.groups : [];
  const groupById = new Map();
  const groupByName = new Map();
  for (const g of groups) {
    const keyName = (g.name || "").trim().toUpperCase();
    groupById.set(String(g._id), g);
    if (keyName) groupByName.set(keyName, g);
  }

  // Lấy toàn bộ match thuộc bracket này
  const matches = await Match.find({ bracket: bracketId }).lean();

  // Gom theo group (dựa trên pool.id hoặc pool.name)
  const finishedByGroup = new Map(); // key: groupKey → array of matches finished
  const allByGroup = new Map(); // key: groupKey → array of all matches (scheduled+finished)
  const regSetByGroup = new Map(); // key: groupKey → Set of regIds xuất hiện

  function pushMap(map, key, val) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  }

  // helper lấy key group: ưu tiên id rồi tới name
  function groupKeyOf(m) {
    const gid = m?.pool?.id ? String(m.pool.id) : "";
    if (gid && groupById.has(gid)) return `ID:${gid}`;
    const gname = (m?.pool?.name || "").trim().toUpperCase();
    if (gname && groupByName.has(gname)) return `N:${gname}`;
    return null;
  }

  for (const m of matches) {
    const key = groupKeyOf(m);
    if (!key) continue; // trận ko thuộc pool nào (không phải group)
    pushMap(allByGroup, key, m);
    if (m.status === "finished" && (m.winner === "A" || m.winner === "B")) {
      pushMap(finishedByGroup, key, m);
    }
    // collect regs để xác định pool participants
    const set = regSetByGroup.get(key) || new Set();
    if (m.pairA) set.add(String(m.pairA));
    if (m.pairB) set.add(String(m.pairB));
    regSetByGroup.set(key, set);
  }

  // Tính standings từng group
  const byGroup = {};
  for (const [key, allList] of allByGroup.entries()) {
    const finishedList = finishedByGroup.get(key) || [];
    const complete =
      allList.length > 0 && finishedList.length === allList.length;

    const stats = new Map(); // regId -> { wins, losses, pointsFor, pointsAgainst }
    const ensure = (id) => {
      const k = String(id);
      if (!stats.has(k))
        stats.set(k, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 });
      return stats.get(k);
    };

    // init tất cả reg xuất hiện trong pool (kể cả chưa đấu xong)
    const regSet = regSetByGroup.get(key) || new Set();
    for (const rid of regSet) ensure(rid);

    // Tính từ các trận đã hoàn thành
    for (const m of finishedList) {
      const a = m.pairA ? String(m.pairA) : null;
      const b = m.pairB ? String(m.pairB) : null;
      if (!a || !b) continue;

      // Điểm (nếu có)
      const pfA = (m.gameScores || []).reduce((s, g) => s + (g?.a ?? 0), 0);
      const pfB = (m.gameScores || []).reduce((s, g) => s + (g?.b ?? 0), 0);

      const sa = ensure(a),
        sb = ensure(b);
      sa.pointsFor += pfA;
      sa.pointsAgainst += pfB;
      sb.pointsFor += pfB;
      sb.pointsAgainst += pfA;

      if (m.winner === "A") {
        sa.wins++;
        sb.losses++;
      } else if (m.winner === "B") {
        sb.wins++;
        sa.losses++;
      }
    }

    // sort: wins desc → pointsDiff desc → pointsFor desc → id asc
    const standings = [...stats.entries()]
      .sort(([, A], [, B]) => {
        if (A.wins !== B.wins) return B.wins - A.wins;
        const dA = A.pointsFor - A.pointsAgainst;
        const dB = B.pointsFor - B.pointsAgainst;
        if (dA !== dB) return dB - dA;
        if (A.pointsFor !== B.pointsFor) return B.pointsFor - A.pointsFor;
        return 0;
      })
      .map(([rid]) => rid);

    byGroup[key] = { complete, standings, stats };
  }

  return { bracket, byGroup };
}

/** Tiện ích: tra groupKey từ (stageIndex|bracketId) và group name|id */
export function mkGroupKeyFromRef({ bracket, ref }) {
  // ưu tiên id nếu có
  if (ref?.group?.id) return `ID:${String(ref.group.id)}`;
  // fallback theo name
  const nm = (ref?.group?.name || "").trim().toUpperCase();
  if (!nm) return null;
  // xác thực name có trong bracket.groups
  const exists = (bracket.groups || []).some(
    (g) => (g.name || "").trim().toUpperCase() === nm
  );
  return exists ? `N:${nm}` : null;
}
