// services/aiTournamentPlanner.js
import OpenAI from "openai";

/* ---------- Helpers (đồng bộ với FE) ---------- */
const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
const nextPow2 = ceilPow2;
const RR_MATCHES = (size) => (size >= 2 ? (size * (size - 1)) / 2 : 0);

const maxPoRoundsFor = (N) => {
  const losers1 = Math.floor(Math.max(0, N) / 2);
  return Math.max(1, 1 + (losers1 > 0 ? Math.floor(Math.log2(losers1)) : 0));
};
const poMatchesForRound = (N, r) => {
  const n = Math.max(0, Number(N) || 0);
  const R = Math.max(1, Number(r) || 1);
  if (R === 1) return Math.max(1, Math.ceil(n / 2));
  let losersPool = Math.floor(n / 2);
  for (let k = 2; k < R; k++) losersPool = Math.floor(losersPool / 2);
  return Math.max(1, Math.ceil(losersPool / 2));
};

/* Build KO from PO winners W-Vr-Ti theo thứ tự tuyến tính */
function buildKoSeedsFromPO(
  poDrawSize,
  poMaxRounds,
  poStageIndex /* 1-based */
) {
  const list = [];
  for (let r = 1; r <= poMaxRounds; r++) {
    const pairs = poMatchesForRound(poDrawSize, r);
    for (let i = 1; i <= pairs; i++) {
      list.push({
        type: "stageMatchWinner",
        ref: { stageIndex: poStageIndex, round: r, order: i - 1 },
        label: `W-V${r}-T${i}`,
      });
    }
  }
  const size = nextPow2(Math.max(2, list.length || 2));
  const firstPairs = size / 2;
  const capacity = firstPairs * 2;
  const linear = list.slice(0, capacity);
  while (linear.length < capacity)
    linear.push({ type: "bye", ref: null, label: "BYE" });

  const seeds = [];
  for (let i = 0; i < firstPairs; i++) {
    seeds.push({
      pair: i + 1,
      A: linear[2 * i] || { type: "bye", ref: null, label: "BYE" },
      B: linear[2 * i + 1] || { type: "bye", ref: null, label: "BYE" },
    });
  }
  return { drawSize: size, seeds };
}

/* Build KO từ Group (A1–B2, B1–A2, ...), groupStageIndex = 1 nếu có group */
function buildKoSeedsFromGroups(
  groupCount,
  groupTopN,
  groupStageIndex /* 1-based */
) {
  const groups = Array.from({ length: groupCount }, (_, i) => String(i + 1));
  // winners, runners, others...
  const winners = groups.map((g) => ({
    type: "groupRank",
    ref: { stage: groupStageIndex, groupCode: g, rank: 1 },
    label: `V${groupStageIndex}-B${g}-#1`,
    __group: g,
  }));
  const runners =
    groupTopN >= 2
      ? groups.map((g) => ({
          type: "groupRank",
          ref: { stage: groupStageIndex, groupCode: g, rank: 2 },
          label: `V${groupStageIndex}-B${g}-#2`,
          __group: g,
        }))
      : [];
  const others = [];
  for (let r = 3; r <= groupTopN; r++) {
    for (const g of groups) {
      others.push({
        type: "groupRank",
        ref: { stage: groupStageIndex, groupCode: g, rank: r },
        label: `V${groupStageIndex}-B${g}-#${r}`,
        __group: g,
      });
    }
  }

  // Cross: A1–B2, B1–A2 theo cặp (G1,G2), (G3,G4)...
  const linear = [];
  for (let i = 0; i < groups.length; i += 2) {
    const gA = groups[i];
    const gB = groups[i + 1];

    const A1 = winners.find((x) => x.__group === gA);
    const B1 = gB ? winners.find((x) => x.__group === gB) : null;
    const A2 = runners.find((x) => x.__group === gA) || null;
    const B2 = gB ? runners.find((x) => x.__group === gB) : null;

    if (gB) {
      if (A1) linear.push(A1);
      if (B2) linear.push(B2);
      if (B1) linear.push(B1);
      if (A2) linear.push(A2);
    } else {
      if (A1) linear.push(A1);
      if (A2) linear.push(A2);
    }
  }
  linear.push(...others);

  const size = nextPow2(Math.max(2, linear.length || 2));
  const firstPairs = size / 2;
  const capacity = firstPairs * 2;
  const pool = linear.slice(0, capacity);
  while (pool.length < capacity)
    pool.push({ type: "bye", ref: null, label: "BYE" });

  const seeds = [];
  for (let i = 0; i < firstPairs; i++) {
    seeds.push({
      pair: i + 1,
      A: pool[2 * i] || { type: "bye", ref: null, label: "BYE" },
      B: pool[2 * i + 1] || { type: "bye", ref: null, label: "BYE" },
    });
  }
  return { drawSize: size, seeds };
}

/* Ước lượng số trận & thời lượng tổng quan (để chấm phương án) */
function estimateMetrics({ groups, po, ko, avgMinutesPerMatch = 25 }) {
  let groupMatches = 0;
  if (
    groups?.count &&
    (groups.size || groups.totalTeams || groups.groupSizes)
  ) {
    const sizes = Array.isArray(groups.groupSizes)
      ? groups.groupSizes
      : Array.from({ length: groups.count }, () => Number(groups.size || 0));
    groupMatches = sizes.reduce(
      (acc, s) => acc + RR_MATCHES(Number(s) || 0),
      0
    );
  }

  const poMatches = po?.drawSize
    ? poMatchesForRound(po.drawSize, 1) +
      Array.from({ length: Math.max(1, po.maxRounds || 1) - 1 }, (_, i) =>
        poMatchesForRound(po.drawSize, i + 2)
      ).reduce((a, b) => a + b, 0)
    : 0;

  const koMatches = ko?.drawSize ? Math.max(0, ko.drawSize - 1) : 0;

  const totalMatches = groupMatches + poMatches + koMatches;
  const minutes = totalMatches * avgMinutesPerMatch;
  return {
    groupMatches,
    poMatches,
    koMatches,
    totalMatches,
    estMinutes: minutes,
  };
}

/* ----------------- AI core ----------------- */
export async function planWithAI({ tournament, preferences = {} }) {
  // Chuẩn bị input đơn giản, không lộ dữ liệu nhạy cảm
  const {
    expected = 0,
    eventType = "double",
    timezone = "Asia/Ho_Chi_Minh",
    drawSettings = {},
  } = tournament || {};

  // Gọi OpenAI — optional. Nếu lỗi thì fallback.
  let ai;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const system = `
Bạn là trợ lý lập kế hoạch giải đấu. Trả về JSON THUẦN theo schema:
{
  "plan": { "groups": {...} | null, "po": {...} | null, "ko": {...} },
  "variants": [
    {
      "key": "balanced" | "fast" | "fairness",
      "label": "string",
      "rationale": "string ngắn",
      "plan": { "groups": {...} | null, "po": {...} | null, "ko": {...} }
    }
  ]
}
YÊU CẦU:
- Chỉ dùng 3 stage loại: group, po (roundElim), ko (knockout).
- Seed phải dùng đúng các type: "groupRank", "stageMatchWinner", "bye", "registration".
- Stage index quy ước: Group=1 khi có; PO tiếp theo; KO là cuối.
- Nếu không chắc, để seeds trống [] và để FE tự seed.
- Gợi ý RULES (bestOf, pointsToWin, winByTwo, cap {mode, points}) ngắn gọn & hợp lý.
- Po "maxRounds" không vượt quá maxPoRoundsFor(drawSize).
`;
    const user = {
      tournament: {
        expected,
        eventType,
        timezone,
        drawSettings,
      },
      preferences, // weight & constraints từ FE (có hoặc không)
    };

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      temperature: 0.2,
    });

    ai = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
  } catch (_) {
    ai = null;
  }

  if (ai?.plan?.ko?.drawSize) {
    // Tính metric để FE hiển thị
    const m = estimateMetrics(ai.plan);
    return { ...ai, metrics: m };
  }

  // --------- Fallback: dựng 3 phương án cơ bản ----------
  const E = Number(expected) || 0;
  const hasGroup = E >= 9; // mặc định: >=9 thì nên có vòng bảng
  const groupCount = hasGroup
    ? Math.min(8, Math.max(2, Math.round(Math.sqrt(E))))
    : 0;
  const baseSize = hasGroup ? Math.floor(E / groupCount) : 0;
  const remainder = hasGroup ? E - baseSize * groupCount : 0;
  const groupSizes = hasGroup
    ? Array.from(
        { length: groupCount },
        (_, i) => baseSize + (i === groupCount - 1 ? remainder : 0)
      )
    : [];

  const koFromGroup = hasGroup
    ? buildKoSeedsFromGroups(groupCount, 2, 1) /* top2/bảng mặc định */
    : { drawSize: nextPow2(Math.max(2, E)), seeds: [] };

  const balanced = {
    groups: hasGroup
      ? {
          count: groupCount,
          totalTeams: E,
          groupSizes,
          qualifiersPerGroup: 2,
          rules: {
            bestOf: 3,
            pointsToWin: 11,
            winByTwo: true,
            cap: { mode: "none", points: null },
          },
        }
      : null,
    po: null,
    ko: {
      ...koFromGroup,
      rules: {
        bestOf: 3,
        pointsToWin: 11,
        winByTwo: true,
        cap: { mode: "none", points: null },
      },
      finalRules: {
        bestOf: 5,
        pointsToWin: 11,
        winByTwo: true,
        cap: { mode: "none", points: null },
      },
    },
  };

  // Fast: bỏ group, nếu không phải 2^n thì thêm PO cắt xuống 2^n gần nhất
  const K = nextPow2(Math.max(2, E));
  const fastPlan = (() => {
    if (E === K) {
      return {
        groups: null,
        po: null,
        ko: {
          drawSize: K,
          seeds: [],
          rules: {
            bestOf: 1,
            pointsToWin: 11,
            winByTwo: true,
            cap: { mode: "soft", points: 15 },
          },
        },
      };
    }
    const poDraw = E;
    const poR = maxPoRoundsFor(poDraw);
    const koFromPO = buildKoSeedsFromPO(poDraw, poR, /* poStageIndex */ 1);
    return {
      groups: null,
      po: {
        drawSize: poDraw,
        maxRounds: poR,
        seeds: [], // để registration hoặc bốc sau
        rules: {
          bestOf: 1,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "soft", points: 15 },
        },
      },
      ko: {
        ...koFromPO,
        rules: {
          bestOf: 3,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
        finalRules: {
          bestOf: 5,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
      },
    };
  })();

  // Fairness: có group nhỏ hơn (nhiều bảng hơn), top2 vào KO; nếu còn lẻ thì thêm PO rất ngắn
  const fairness = (() => {
    const gCount = hasGroup
      ? Math.min(12, Math.max(3, Math.round(groupCount * 1.3)))
      : 0;
    const base = hasGroup ? Math.max(3, Math.floor(E / gCount)) : 0;
    const rem = hasGroup ? E - base * gCount : 0;
    const sizes = hasGroup
      ? Array.from(
          { length: gCount },
          (_, i) => base + (i === gCount - 1 ? rem : 0)
        )
      : [];
    const koFromG = hasGroup
      ? buildKoSeedsFromGroups(gCount, 2, 1)
      : { drawSize: nextPow2(Math.max(2, E)), seeds: [] };
    return {
      groups: hasGroup
        ? {
            count: gCount,
            totalTeams: E,
            groupSizes: sizes,
            qualifiersPerGroup: 2,
            rules: {
              bestOf: 3,
              pointsToWin: 11,
              winByTwo: true,
              cap: { mode: "none", points: null },
            },
          }
        : null,
      po: null,
      ko: {
        ...koFromG,
        rules: {
          bestOf: 3,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
        finalRules: {
          bestOf: 5,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
      },
    };
  })();

  const variants = [
    {
      key: "balanced",
      label: "Cân bằng",
      rationale: "Có vòng bảng, KO vừa phải.",
      plan: balanced,
    },
    {
      key: "fast",
      label: "Nhanh gọn",
      rationale: "Bỏ vòng bảng; nếu lẻ dùng PO cắt.",
      plan: fastPlan,
    },
    {
      key: "fairness",
      label: "Công bằng",
      rationale: "Tăng số bảng để công bằng seed.",
      plan: fairness,
    },
  ];
  const plan = balanced; // mặc định

  return { plan, variants, metrics: estimateMetrics(plan) };
}
