// utils/liveServeUtils.js
export function decorateServeAndSlots(match) {
  const m = match || {};
  const clone = { ...m };

  const idOf = (p) =>
    String(p?.user?._id || p?.user || p?._id || p?.id || "") || "";

  const pA = m?.pairA || {};
  const pB = m?.pairB || {};
  const idsA = [idOf(pA.player1), idOf(pA.player2)].filter(Boolean);
  const idsB = [idOf(pB.player1), idOf(pB.player2)].filter(Boolean);

  const slotsRaw =
    m?.slots && typeof m.slots === "object" ? m.slots : m?.meta?.slots || {};

  const baseA = { ...(slotsRaw?.base?.A || {}) };
  const baseB = { ...(slotsRaw?.base?.B || {}) };

  // mặc định p1→ô1, p2→ô2 nếu thiếu
  if (idsA[0] && !baseA[idsA[0]]) baseA[idsA[0]] = 1;
  if (idsA[1] && !baseA[idsA[1]]) baseA[idsA[1]] = 2;
  if (idsB[0] && !baseB[idsB[0]]) baseB[idsB[0]] = 1;
  if (idsB[1] && !baseB[idsB[1]]) baseB[idsB[1]] = 2;

  // điểm ván hiện tại
  const gs = Array.isArray(m?.gameScores) ? m.gameScores : [];
  const last = gs.length ? gs[gs.length - 1] : { a: 0, b: 0 };
  const curA = Number(last?.a || 0);
  const curB = Number(last?.b || 0);

  const flip = (n) => (n === 1 ? 2 : 1);
  const slotNow = (base, score) => (score % 2 === 0 ? base : flip(base));

  // chuẩn hoá serve + suy luận id
  const serve = { ...(m?.serve || {}) };
  if (!serve.side) serve.side = "A";

  let serverId = String(serve?.serverId || slotsRaw?.serverId || "") || "";
  let receiverId =
    String(serve?.receiverId || slotsRaw?.receiverId || "") || "";

  // nếu chưa có serverId nhưng có số người giao (#1/#2) → suy luận theo base + điểm
  if (!serverId && (serve.server === 1 || serve.server === 2)) {
    const side = serve.side === "B" ? "B" : "A";
    const ids = side === "B" ? idsB : idsA;
    const base = side === "B" ? baseB : baseA;
    const score = side === "B" ? curB : curA;
    for (const uid of ids) {
      const b = Number(base[uid] || 1);
      if (slotNow(b, score) === Number(serve.server)) {
        serverId = uid;
        break;
      }
    }
  }

  // nếu chưa có receiverId nhưng đã biết serverId → tìm người đội kia đứng cùng ô hiện tại
  if (!receiverId && serverId) {
    const side = serve.side === "B" ? "B" : "A";
    const srvNow =
      side === "B"
        ? slotNow(Number(baseB[serverId] || 1), curB)
        : slotNow(Number(baseA[serverId] || 1), curA);

    const idsOther = side === "B" ? idsA : idsB;
    const baseOther = side === "B" ? baseA : baseB;
    const scoreOther = side === "B" ? curA : curB;

    for (const uid of idsOther) {
      const b = Number(baseOther[uid] || 1);
      if (slotNow(b, scoreOther) === srvNow) {
        receiverId = uid;
        break;
      }
    }
  }

  // gắn vào response
  clone.serve = {
    ...(serve || {}),
    serverId: serverId || undefined,
    receiverId: receiverId || undefined,
  };

  clone.slots = {
    ...slotsRaw,
    base: { A: baseA, B: baseB },
    serverId: serverId || slotsRaw?.serverId,
    receiverId: receiverId || slotsRaw?.receiverId,
  };

  return clone;
}
