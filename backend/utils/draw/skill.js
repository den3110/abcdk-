// utils/draw/skill.js
import Registration from "../../models/registrationModel.js";
import Ranking from "../../models/rankingModel.js";
import Match from "../../models/matchModel.js";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

// Chuẩn hoá rank (giả định 0..10 là dải phổ biến của bạn; nếu lớn hơn, tự co về 0..1)
function normRank(val) {
  const v = Number(val ?? 0);
  const n = v <= 0 ? 0 : v >= 10 ? 1 : v / 10;
  return clamp01(n);
}

// Hợp nhất rating của đội (đơn/đôi)
function teamBaseRating(reg, eventType, rankByUser) {
  const u1 = reg?.player1?.user ? String(reg.player1.user) : null;
  const u2 = reg?.player2?.user ? String(reg.player2.user) : null;
  const r1 = u1 ? rankByUser.get(u1) : null;
  const r2 = u2 ? rankByUser.get(u2) : null;

  if (eventType === "single") {
    return normRank(r1?.single ?? reg?.player1?.score ?? 0);
  }
  // doubles: trung bình — có thể nâng lên logit-mean khi muốn
  const a = normRank(r1?.double ?? reg?.player1?.score ?? 0);
  const b = u2 ? normRank(r2?.double ?? reg?.player2?.score ?? 0) : a;
  return (a + b) / 2;
}

/**
 * Tính "skill" giàu tín hiệu cho mỗi registration:
 *  - r_norm: từ Ranking (single/double) hoặc snapshot score lúc đăng ký
 *  - setWinPct: tỉ lệ thắng set
 *  - pointMargin: chênh điểm trung bình mỗi set (chuẩn hoá z-ish đơn giản)
 *  - SOS: strength of schedule (đối thủ mạnh yếu)
 *  - recentForm: phong độ gần đây (30–90 ngày)
 *  - sigmaPenalty: phạt độ bất định khi ít trận
 *
 * @param {string[]} regIds
 * @param {"single"|"double"} eventType
 * @param {{recentDays?:number}} opts
 * @returns Map<regId, {skill:number, matches:number, setWinPct:number, pointMargin:number, recentForm:number, meta:{province?:string, seed?:number}}>
 */
export async function getSkillMap(regIds, eventType = "double", opts = {}) {
  const ids = (regIds || []).map(String);
  if (!ids.length) return new Map();

  // 1) Load registrations
  const regs = await Registration.find({ _id: { $in: ids } })
    .select("_id player1 player2")
    .lean();

  // 2) Load rankings của các user liên quan
  const userIds = new Set();
  for (const r of regs) {
    if (r?.player1?.user) userIds.add(String(r.player1.user));
    if (eventType !== "single" && r?.player2?.user)
      userIds.add(String(r.player2.user));
  }
  const ranks = await Ranking.find({ user: { $in: [...userIds] } })
    .select("user single double")
    .lean();
  const rankByUser = new Map(ranks.map((r) => [String(r.user), r]));

  // 3) Thống kê match cho các regIds
  const recentDays = Number.isFinite(opts.recentDays)
    ? Math.max(1, opts.recentDays)
    : 120;
  const since = new Date(Date.now() - recentDays * 24 * 3600 * 1000);

  const matches = await Match.find({
    status: "finished",
    $or: [{ pairA: { $in: ids } }, { pairB: { $in: ids } }],
  })
    .select("pairA pairB gameScores finishedAt updatedAt")
    .lean();

  const stat = new Map(); // regId -> {matches,setW,setL, ptsFor, ptsAgainst, recentW, recentN, oppIds:Set}
  for (const m of matches) {
    const a = m.pairA ? String(m.pairA) : null;
    const b = m.pairB ? String(m.pairB) : null;
    if (!a || !b) continue;

    let setA = 0,
      setB = 0,
      pA = 0,
      pB = 0;
    for (const g of m.gameScores || []) {
      const ga = Number(g?.a ?? 0),
        gb = Number(g?.b ?? 0);
      if (ga > gb) setA++;
      else if (gb > ga) setB++;
      pA += ga;
      pB += gb;
    }

    const upd = (id, wSets, lSets, pf, pa) => {
      const s = stat.get(id) || {
        matches: 0,
        setW: 0,
        setL: 0,
        ptsFor: 0,
        ptsAgainst: 0,
        recentW: 0,
        recentN: 0,
        oppIds: new Set(),
      };
      s.matches += 1;
      s.setW += wSets;
      s.setL += lSets;
      s.ptsFor += pf;
      s.ptsAgainst += pa;
      if ((m.finishedAt || m.updatedAt || new Date()) >= since) {
        s.recentN += 1;
        if (wSets > lSets) s.recentW += 1;
      }
      stat.set(id, s);
    };

    upd(a, setA, setB, pA, pB);
    upd(b, setB, setA, pB, pA);

    // đối thủ để tính SOS
    (stat.get(a)?.oppIds || new Set()).add(b);
    (stat.get(b)?.oppIds || new Set()).add(a);
  }

  // 4) Tính S cho từng reg
  const map = new Map();
  // Precompute base rating cho SOS
  const baseMap = new Map();
  for (const r of regs) {
    const base = teamBaseRating(r, eventType, rankByUser); // 0..1
    baseMap.set(String(r._id), base);
  }

  for (const r of regs) {
    const id = String(r._id);
    const s = stat.get(id) || {
      matches: 0,
      setW: 0,
      setL: 0,
      ptsFor: 0,
      ptsAgainst: 0,
      recentW: 0,
      recentN: 0,
      oppIds: new Set(),
    };

    const r_norm = baseMap.get(id) ?? 0.5;

    const setTotal = s.setW + s.setL;
    const setWinPct = setTotal > 0 ? s.setW / setTotal : 0.5;

    const ptsTotal = s.ptsFor + s.ptsAgainst;
    const pointMargin =
      ptsTotal > 0
        ? (s.ptsFor - s.ptsAgainst) / Math.max(1, s.matches || 1)
        : 0;
    // chuẩn hoá biên độ điểm (thô → 0..1): giả định ±10 điểm/ trận ~ biên phổ biến
    const zMargin = clamp01(0.5 + pointMargin / 20);

    // SOS: trung bình base rating của đối thủ đã gặp
    let SOS = 0.5;
    if (s.oppIds && s.oppIds.size) {
      let sum = 0;
      for (const oid of s.oppIds) sum += baseMap.get(String(oid)) ?? 0.5;
      SOS = sum / s.oppIds.size;
    }

    const recentForm = s.recentN > 0 ? s.recentW / s.recentN : 0.5;
    const volume = s.matches;
    const volumeBonus = Math.min(1, volume / 20); // 20 trận trở lên coi như ổn định
    const sigmaPenalty = 1 - volumeBonus; // ít trận → phạt lớn

    // Hợp nhất
    const skill =
      0.45 * r_norm +
      0.2 * setWinPct +
      0.15 * zMargin +
      0.1 * SOS +
      0.07 * recentForm +
      0.03 * volumeBonus -
      0.1 * sigmaPenalty;

    map.set(id, {
      skill: round3(clamp01(skill)),
      matches: volume,
      setWinPct: round3(setWinPct),
      pointMargin: round3(pointMargin),
      recentForm: round3(recentForm),
      meta: {
        // bạn có thể nhét thêm seed/province nếu có — ở đây để trống
      },
    });
  }

  return map;
}
