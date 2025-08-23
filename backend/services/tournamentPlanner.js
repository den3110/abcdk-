// services/tournamentPlanner.js
// Gợi ý sơ đồ dựa trên expectedTeams + option allowGroup/PO/KO

const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
const floorPow2 = (n) => (n <= 1 ? 1 : 1 << Math.floor(Math.log2(n)));

export function autoPlan({ expectedTeams = 0, allowGroup = true, allowPO = true, allowKO = true }) {
  const n = Number(expectedTeams || 0);

  const plan = { groups: null, po: null, ko: null };

  if (!n || n < 2) {
    plan.ko = { drawSize: 2, seeds: [] };
    return plan;
  }

  // Heuristic:
  // - N lớn (>=24) và allowGroup → Group 4-6 người, lấy top 2 → KO
  if (allowGroup && n >= 24) {
    // Chọn size ~ 4-6
    const targetSize = n % 6 === 0 ? 6 : 4;
    const groupCount = Math.max(2, Math.round(n / targetSize));
    const groupSize = Math.ceil(n / groupCount);
    const qualifiersPerGroup = 2;
    const qualifiers = groupCount * qualifiersPerGroup;

    plan.groups = { count: groupCount, size: groupSize, qualifiersPerGroup };

    // KO: scale theo số đội đi tiếp
    plan.ko = { drawSize: ceilPow2(qualifiers), seeds: [] };

    // Seed map mặc định: A1 vs B2, B1 vs A2, C1 vs D2, ...
    const letters = Array.from({ length: groupCount }, (_, i) => String.fromCharCode(65 + i));
    const firstRoundPairs = plan.ko.drawSize / 2;

    let pairs = [];
    const buckets = [];
    // tạo các cặp nhóm (A,B), (C,D), ...
    for (let i = 0; i < letters.length; i += 2) {
      const A = letters[i];
      const B = letters[i + 1] || letters[0]; // nếu lẻ, ghép với A
      buckets.push([A, B]);
    }
    // đổ A1-B2, B1-A2 theo từng bucket; nếu thiếu → thêm BYE
    for (const [G1, G2] of buckets) {
      pairs.push({ A: { type: "groupRank", ref: { groupCode: G1, rank: 1 } },
                   B: { type: "groupRank", ref: { groupCode: G2, rank: 2 } } });
      pairs.push({ A: { type: "groupRank", ref: { groupCode: G2, rank: 1 } },
                   B: { type: "groupRank", ref: { groupCode: G1, rank: 2 } } });
    }
    // cắt/đệm BYE để đúng firstRoundPairs
    if (pairs.length > firstRoundPairs) pairs = pairs.slice(0, firstRoundPairs);
    while (pairs.length < firstRoundPairs) {
      pairs.push({ A: { type: "bye", ref: null, label: "BYE" }, B: { type: "bye", ref: null, label: "BYE" }});
    }

    plan.ko.seeds = pairs.map((p, i) => ({ pair: i + 1, A: p.A, B: p.B }));

    // Nếu bạn muốn PO thay BYE: cho phép PO và qualifiers không là power-of-two
    if (allowPO) {
      const down = floorPow2(qualifiers);
      const needCut = qualifiers - down;
      if (needCut > 0) {
        // PO giữa nhì bảng: đơn giản – tất cả "rank 2" đấu nhau, top 1 bảng BYE
        plan.po = {
          drawSize: needCut * 2,
          seeds: [], // tuỳ bạn muốn seed thêm (VD: A2 vs B2, C2 vs D2, ...)
        };
      }
    }
    return plan;
  }

  // - Không group: nếu N không phải power-of-two:
  //   + allowPO → tạo PO cắt bớt về pow2
  //   + else → KO với BYE
  if (![2, 4, 8, 16, 32, 64, 128, 256].includes(n)) {
    if (allowPO) {
      const down = floorPow2(n);
      const need = n - down; // số đội cần loại qua PO
      const poDraw = need * 2;
      plan.po = { drawSize: poDraw, seeds: [] };
      plan.ko = { drawSize: down, seeds: [] };
    } else {
      plan.ko = { drawSize: ceilPow2(n), seeds: [] };
    }
    return plan;
  }

  // - Chuẩn pow2 → KO trực tiếp
  plan.ko = { drawSize: n, seeds: [] };
  return plan;
}
