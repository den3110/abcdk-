// services/designGraph.js
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import { buildProgressivePO } from "./poPlanner.js";

const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));

export function makeLabelWinner(stage, round, order) {
  return `winnerV${stage}#R${round}#${order}`;
}
export function makeLabelTop(stage, groupCode, rank) {
  return `topV${stage}#${groupCode}#${rank}`;
}

export async function buildDesignGraph({ tournament, input }) {
  // input: { expectedTeams?, stages: { group?: {groups?, size?}, po?: {entrants?, targetQualifiers?}, ko: {drawSize?} } }
  const expected =
    Number(input?.expectedTeams ?? tournament.maxPairs ?? 0) || 0;

  // ---- V1: Group (nếu yêu cầu)
  let V1 = null;
  if (input?.group?.enabled) {
    const groupCount = Number(input.group.count);
    const groupSize = Number(input.group.size);
    const letters = Array.from({ length: groupCount }, (_, i) =>
      String.fromCharCode(65 + i)
    );
    V1 = {
      key: "V1",
      type: "group",
      rounds: [
        { r: 1, groups: letters.map((g) => ({ code: g, size: groupSize })) },
      ],
      selectable: false,
    };
  }

  // ---- V2: PO progressive (nếu yêu cầu)
  let V2 = null;
  if (input?.po?.enabled) {
    const entrants = Number(input.po.entrants ?? expected);
    const targetQ =
      input.po.targetQualifiers != null
        ? Number(input.po.targetQualifiers)
        : null;
    const po = buildProgressivePO({
      entrants,
      maxRounds: 10,
      targetQualifiers: targetQ,
    });
    V2 = {
      key: "V2",
      type: "roundElim",
      rounds: po.rounds.map((r) => ({
        r: r.r,
        pairs: r.pairs,
        qualifiers: r.qualifiers,
      })),
      selectable: true,
    };
  }

  // ---- V3: KO
  const koSize = ceilPow2(Number(input?.ko?.drawSize ?? expected) || 2);
  const koRounds = Math.round(Math.log2(koSize));
  const ko = {
    key: "V3",
    type: "knockout",
    rounds: Array.from({ length: koRounds }, (_, i) => {
      const r = i + 1;
      const pairs = koSize >> (i + 1);
      return { r, pairs };
    }),
    selectable: true,
    seeds: Array.from({ length: koSize / 2 }, (_, i) => ({
      slot: `R1#${i + 1}`, // trong slot có A/B ở FE
      A: { options: [], disabled: false },
      B: { options: [], disabled: false },
    })),
  };

  // ---- Xây “nguồn” có thể feed vào KO.R1:
  const sourceOptions = [];

  // (1) top từ Group: topV1#A#1 ...
  if (V1) {
    for (const g of V1.rounds[0].groups) {
      // tối đa rank = size (đã yêu cầu)
      for (let rank = 1; rank <= g.size; rank++) {
        sourceOptions.push({
          kind: "groupRank",
          stage: 1,
          code: makeLabelTop(1, g.code, rank),
          source: {
            type: "groupRank",
            ref: { stage: 1, groupCode: g.code, rank },
            label: `Top ${rank} ${g.code}`,
          },
          available: g.size >= rank, // nếu bảng chưa đủ đội (sau này FE có thể cập nhật thực tế)
        });
      }
    }
  }

  // (2) winner từ PO (V2) – tất cả trận ở mỗi round
  if (V2) {
    for (const r of V2.rounds) {
      for (let i = 1; i <= r.pairs; i++) {
        sourceOptions.push({
          kind: "stageMatchWinner",
          stage: 2,
          code: makeLabelWinner(2, r.r, i),
          source: {
            type: "stageMatchWinner",
            ref: { stageIndex: 2, round: r.r, order: i },
            label: `Winner V2 R${r.r} #${i}`,
          },
          available: r.pairs >= i, // luôn true khi đã vẽ
        });
      }
    }
  }

  // (3) BYE
  sourceOptions.push({
    kind: "bye",
    stage: 0,
    code: "BYE",
    source: { type: "bye", ref: null, label: "BYE" },
    available: true,
  });

  return {
    expectedTeams: expected,
    stages: [V1, V2, ko].filter(Boolean),
    sourceOptions,
  };
}

/** Đánh dấu disable theo “thực trạng hiện hữu” (groups thực, matches thực) */
export async function computeAvailability({ tournamentId, design }) {
  // Nếu bạn cần lấy từ DB để disable chính xác (ví dụ group A đang có 0 đội)
  // có thể đọc Bracket V1 (type=group, stage=1) và đếm regIds
  const out = design;
  // (demo giữ nguyên available như đã set ở buildDesignGraph)
  return out;
}
