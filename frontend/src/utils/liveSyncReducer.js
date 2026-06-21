function cloneSnapshot(value) {
  if (!value) return value;
  return JSON.parse(JSON.stringify(value));
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isFinitePos(value) {
  return Number.isFinite(value) && value > 0;
}

function buildNormalizedRules(snapshot) {
  return {
    pointsToWin: toNum(snapshot?.rules?.pointsToWin, 11),
    winByTwo:
      snapshot?.rules?.winByTwo === undefined
        ? true
        : Boolean(snapshot.rules.winByTwo),
    cap: {
      mode: String(snapshot?.rules?.cap?.mode ?? "none"),
      points:
        snapshot?.rules?.cap?.points === undefined
          ? null
          : Number(snapshot.rules.cap.points),
    },
  };
}

function evaluateGameFinish(aRaw, bRaw, rules) {
  const a = Number(aRaw) || 0;
  const b = Number(bRaw) || 0;
  const base = Number(rules?.pointsToWin ?? 11);
  const byTwo = rules?.winByTwo !== false;
  const mode = String(rules?.cap?.mode ?? "none");
  const capPoints =
    rules?.cap?.points != null ? Number(rules.cap.points) : null;

  if ((mode === "hard" || mode === "soft") && isFinitePos(capPoints)) {
    if (a >= capPoints || b >= capPoints) {
      if (a === b) return { finished: false, winner: null };
      return { finished: true, winner: a > b ? "A" : "B" };
    }
  }

  if (byTwo) {
    if ((a >= base || b >= base) && Math.abs(a - b) >= 2) {
      return { finished: true, winner: a > b ? "A" : "B" };
    }
  } else if ((a >= base || b >= base) && a !== b) {
    return { finished: true, winner: a > b ? "A" : "B" };
  }

  return { finished: false, winner: null };
}

function validSide(side) {
  return side === "A" || side === "B" ? side : "A";
}

function oppositeSide(side) {
  return side === "A" ? "B" : "A";
}

function buildForfeitGameScores(snapshot, winnerSide) {
  const pointsToWin = Math.max(1, toNum(snapshot?.rules?.pointsToWin, 11));
  const bestOf = Math.max(1, toNum(snapshot?.rules?.bestOf, 1));
  const gamesToWin = Math.max(1, Math.floor(bestOf / 2) + 1);
  return Array.from({ length: gamesToWin }, () =>
    winnerSide === "A"
      ? { a: pointsToWin, b: 0 }
      : { a: 0, b: pointsToWin },
  );
}

function resolveForfeitedSide(winnerSide, payload = {}) {
  const raw = String(payload?.forfeitedSide || "").toUpperCase();
  if (raw === "A" || raw === "B") return raw;
  return oppositeSide(winnerSide);
}

function validServer(server) {
  return server === 1 || server === 2 ? server : 1;
}

const OPENING_DOUBLES_SERVER = 2;

function isDoublesSnapshot(snapshot) {
  return (
    String(snapshot?.tournament?.eventType || snapshot?.eventType || "").toLowerCase() !==
    "single"
  );
}

function onLostRallyNextServe(prev) {
  if (prev?.opening) {
    return { side: prev.side === "A" ? "B" : "A", server: 1, opening: false };
  }
  if (prev.server === 1) return { side: prev.side, server: 2, opening: false };
  return { side: prev.side === "A" ? "B" : "A", server: 1, opening: false };
}

function normalizeRefereeLayout(layout) {
  if (layout?.left === "B" || layout?.right === "A") {
    return { left: "B", right: "A" };
  }
  return { left: "A", right: "B" };
}

function userIdOfPlayer(player) {
  return String(player?.user?._id || player?.user || player?._id || player?.id || "").trim();
}

function getTeamPlayerIds(snapshot, team) {
  const pair = team === "B" ? snapshot?.pairB : snapshot?.pairA;
  return [pair?.player1, pair?.player2].map(userIdOfPlayer).filter(Boolean);
}

function currentGameScoreOf(snapshot) {
  const scores = Array.isArray(snapshot?.gameScores) ? snapshot.gameScores : [];
  const index = Number.isInteger(snapshot?.currentGame)
    ? Math.max(0, snapshot.currentGame)
    : Math.max(0, scores.length - 1);
  const score = scores[index] || {};
  return {
    a: toNum(score.a, 0),
    b: toNum(score.b, 0),
  };
}

function currentSlotFromBaseSlot(baseSlot, teamScore) {
  const base = Number(baseSlot) === 2 ? 2 : 1;
  return Number(teamScore || 0) % 2 === 0 ? base : base === 1 ? 2 : 1;
}

function oppositeSlot(slot) {
  return Number(slot) === 1 ? 2 : 1;
}

function preStartRightSlotForSide(side, layout) {
  return normalizeRefereeLayout(layout).left === side ? 2 : 1;
}

function normalizedSlotsBaseForSnapshot(snapshot, inputBase = null) {
  const rawBase =
    inputBase && typeof inputBase === "object"
      ? inputBase
      : snapshot?.slots?.base || snapshot?.meta?.slots?.base || {};
  const base = {
    A: { ...(rawBase?.A || {}) },
    B: { ...(rawBase?.B || {}) },
  };

  for (const team of ["A", "B"]) {
    const ids = getTeamPlayerIds(snapshot, team);
    if (ids[0] && ![1, 2].includes(Number(base[team][ids[0]]))) {
      base[team][ids[0]] = 1;
    }
    if (ids[1] && ![1, 2].includes(Number(base[team][ids[1]]))) {
      base[team][ids[1]] = 2;
    }
  }

  return base;
}

function findPlayerIdByBaseSlot(snapshot, side, slot, base = null) {
  const normalizedBase = base || normalizedSlotsBaseForSnapshot(snapshot);
  return (
    Object.entries(normalizedBase?.[side] || {}).find(
      ([, value]) => Number(value) === Number(slot),
    )?.[0] || ""
  );
}

function findPlayerIdByCurrentSlot(snapshot, side, slot, base = null, score = null) {
  const normalizedBase = base || normalizedSlotsBaseForSnapshot(snapshot);
  const currentScore = score || currentGameScoreOf(snapshot);
  const teamScore = side === "A" ? currentScore.a : currentScore.b;
  return (
    Object.entries(normalizedBase?.[side] || {}).find(
      ([, value]) => currentSlotFromBaseSlot(value, teamScore) === Number(slot),
    )?.[0] || ""
  );
}

function isServeServerIdValid(snapshot, side, serverId) {
  const normalizedId = String(serverId || "").trim();
  if (!normalizedId) return false;
  return new Set(getTeamPlayerIds(snapshot, side)).has(normalizedId);
}

function resolveReceiverIdForServe(snapshot, serve, base, score) {
  const serverId = String(serve?.serverId || "").trim();
  if (!serverId) return null;
  const side = validSide(serve?.side);
  const otherSide = side === "A" ? "B" : "A";
  const currentScore = score || currentGameScoreOf(snapshot);
  const serverBaseSlot = Number(base?.[side]?.[serverId] || serve?.server || 1);
  const serverTeamScore = side === "A" ? currentScore.a : currentScore.b;
  const serverCurrentSlot = currentSlotFromBaseSlot(serverBaseSlot, serverTeamScore);
  return findPlayerIdByCurrentSlot(snapshot, otherSide, serverCurrentSlot, base, currentScore) || null;
}

function normalizeServeForSnapshot(snapshot, serve = {}, options = {}) {
  const side = validSide(serve?.side);
  let server = validServer(Number(serve?.server));
  const opening = Boolean(serve?.opening);
  const base = normalizedSlotsBaseForSnapshot(snapshot, options.base);
  const score = currentGameScoreOf(snapshot);
  const teamIds = getTeamPlayerIds(snapshot, side);
  let serverId = String(serve?.serverId || "").trim();
  const isOpeningDoubles = isDoublesSnapshot(snapshot) && opening;
  if (isOpeningDoubles) {
    server = OPENING_DOUBLES_SERVER;
  }

  if (serverId && !isServeServerIdValid(snapshot, side, serverId)) {
    serverId = "";
  }
  const existingServerId = String(snapshot?.serve?.serverId || "").trim();
  const canKeepExistingServer =
    !serverId &&
    existingServerId &&
    snapshot?.serve?.side === side &&
    validServer(snapshot?.serve?.server) === server &&
    Boolean(snapshot?.serve?.opening) === opening &&
    isServeServerIdValid(snapshot, side, existingServerId);

  if (
    isOpeningDoubles &&
    opening &&
    toNum(score.a, 0) === 0 &&
    toNum(score.b, 0) === 0
  ) {
    server = OPENING_DOUBLES_SERVER;
    const rightSlot = preStartRightSlotForSide(side, snapshot?.meta?.refereeLayout);
    serverId =
      findPlayerIdByCurrentSlot(snapshot, side, rightSlot, base, score) ||
      findPlayerIdByCurrentSlot(snapshot, side, oppositeSlot(rightSlot), base, score) ||
      serverId ||
      teamIds[0] ||
      "";
  } else if (canKeepExistingServer) {
    serverId = existingServerId;
  } else if (!serverId) {
    serverId =
      (options.preferCurrentSlot
        ? findPlayerIdByCurrentSlot(snapshot, side, server, base, score)
        : "") ||
      findPlayerIdByBaseSlot(snapshot, side, server, base) ||
      findPlayerIdByCurrentSlot(snapshot, side, server, base, score) ||
      teamIds[0] ||
      "";
  }

  const normalized = {
    side,
    server,
    serverId: serverId || null,
    receiverId: null,
    opening,
  };
  normalized.receiverId = resolveReceiverIdForServe(snapshot, normalized, base, score);
  return normalized;
}

function applyServeState(snapshot, serve, options = {}) {
  const normalizedServe = normalizeServeForSnapshot(snapshot, serve, options);
  snapshot.serve = {
    side: normalizedServe.side,
    server: normalizedServe.server,
    serverId: normalizedServe.serverId || null,
    receiverId: normalizedServe.receiverId || null,
    opening: normalizedServe.opening,
  };
  if (!snapshot.slots || typeof snapshot.slots !== "object") {
    snapshot.slots = {};
  }
  snapshot.slots.serverId = snapshot.serve.serverId || null;
  snapshot.slots.receiverId = snapshot.serve.receiverId || null;
}

function findUndoableLiveLogEntry(snapshot) {
  const entries = Array.isArray(snapshot?.liveLog) ? snapshot.liveLog : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const type = String(entry?.type || "").trim().toLowerCase();
    if (["finish", "forfeit", "start"].includes(type)) {
      return null;
    }
    if (["point", "serve", "slots"].includes(type)) {
      return { index, entry, type };
    }
  }
  return null;
}

function ensureLiveLog(snapshot) {
  if (!Array.isArray(snapshot.liveLog)) snapshot.liveLog = [];
}

export function createClientLiveSyncEvent(type, payload = {}, baseVersion = 0) {
  return {
    clientEventId: `${type}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 10)}`,
    type,
    payload,
    clientCreatedAt: new Date().toISOString(),
    clientBaseVersion: Number(baseVersion || 0),
  };
}

export function applyLiveSyncEventLocally(snapshot, input) {
  const next = cloneSnapshot(snapshot) || {};
  const type = String(input?.type || "").trim().toLowerCase();
  const payload =
    input?.payload && typeof input.payload === "object" ? input.payload : {};

  if (!["start", "point", "undo", "finish", "forfeit", "serve", "slots"].includes(type)) {
    return next;
  }

  if (type === "start") {
    const opening = isDoublesSnapshot(next);
    next.status = "live";
    if (!next.startedAt) next.startedAt = new Date().toISOString();
    if (!Array.isArray(next.gameScores) || !next.gameScores.length) {
      next.gameScores = [{ a: 0, b: 0 }];
      next.currentGame = 0;
    }
    applyServeState(next, {
      side: validSide(next.serve?.side),
      server: opening ? OPENING_DOUBLES_SERVER : 1,
      serverId: next.serve?.serverId || null,
      opening,
    });
    ensureLiveLog(next);
    next.liveLog.push({ type: "start", at: new Date().toISOString() });
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
    return next;
  }

  if (type === "point") {
    if (next.status !== "live") return next;
    const team = String(payload.team || "").toUpperCase();
    const step = Math.max(1, toNum(payload.step, 1));
    if (!["A", "B"].includes(team)) return next;

    if (!Array.isArray(next.gameScores)) next.gameScores = [];
    let gameIndex = Number.isInteger(next.currentGame) ? next.currentGame : 0;
    if (gameIndex < 0) gameIndex = 0;
    while (next.gameScores.length <= gameIndex) {
      next.gameScores.push({ a: 0, b: 0 });
    }

    const current = next.gameScores[gameIndex] || {};
    const score = {
      a: toNum(current.a, 0),
      b: toNum(current.b, 0),
    };
    if (evaluateGameFinish(score.a, score.b, buildNormalizedRules(next)).finished) {
      return next;
    }

    const prevServe = {
      side: validSide(next.serve?.side),
      server: validServer(next.serve?.server),
      serverId: next.serve?.serverId || null,
      opening: Boolean(next.serve?.opening),
    };
    if (team !== prevServe.side) return next;

    if (team === "A") score.a += step;
    else score.b += step;
    next.gameScores[gameIndex] = score;
    applyServeState(next, prevServe);

    ensureLiveLog(next);
    next.liveLog.push({
      type: "point",
      payload: { team, step, prevServe },
      at: new Date().toISOString(),
    });
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
    return next;
  }

  if (type === "serve") {
    const prevServe = {
      side: validSide(next.serve?.side),
      server: validServer(next.serve?.server),
      serverId: next.serve?.serverId || null,
      opening: Boolean(next.serve?.opening),
    };
    applyServeState(next, payload);
    ensureLiveLog(next);
    next.liveLog.push({
      type: "serve",
      payload: {
        prevServe,
        nextServe: cloneSnapshot(next.serve),
      },
      at: new Date().toISOString(),
    });
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
    return next;
  }

  if (type === "slots") {
    const prevBase = cloneSnapshot(next?.slots?.base || { A: {}, B: {} });
    const prevLayout = normalizeRefereeLayout(next?.meta?.refereeLayout);
    const prevServe = {
      side: validSide(next.serve?.side),
      server: validServer(next.serve?.server),
      serverId: next.serve?.serverId || null,
      opening: Boolean(next.serve?.opening),
    };
    if (!next.slots || typeof next.slots !== "object") {
      next.slots = {};
    }
    next.slots.base = cloneSnapshot(payload.base || { A: {}, B: {} });
    if (payload.layout) {
      next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
      next.meta.refereeLayout = normalizeRefereeLayout(payload.layout);
    }
    if (payload.serve) {
      applyServeState(next, payload.serve);
    }
    ensureLiveLog(next);
    next.liveLog.push({
      type: "slots",
      payload: {
        prevBase,
        nextBase: cloneSnapshot(next.slots.base),
        prevLayout,
        nextLayout: payload.layout
          ? normalizeRefereeLayout(payload.layout)
          : null,
        prevServe: payload.serve ? prevServe : null,
        nextServe: payload.serve ? cloneSnapshot(next.serve) : null,
      },
      at: new Date().toISOString(),
    });
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
    return next;
  }

  if (type === "undo") {
    const found = findUndoableLiveLogEntry(next);
    if (!found) return next;
    const { index, entry, type: undoType } = found;

    if (undoType === "point") {
      if (next.status === "finished") {
        next.status = "live";
        next.winner = "";
        next.finishedAt = null;
      }

      if (next.currentGame > 0) {
        const currentGame = next.gameScores?.[next.currentGame];
        if (currentGame?.a === 0 && currentGame?.b === 0) {
          next.gameScores.pop();
          next.currentGame -= 1;
        }
      }

      const current = next.gameScores?.[next.currentGame || 0];
      if (!current) return next;
      const step = toNum(entry?.payload?.step, 1);
      if (entry?.payload?.team === "A") {
        current.a = Math.max(0, toNum(current.a, 0) - step);
      }
      if (entry?.payload?.team === "B") {
        current.b = Math.max(0, toNum(current.b, 0) - step);
      }
      if (entry?.payload?.prevServe) {
        applyServeState(next, entry.payload.prevServe);
      }
    } else if (undoType === "serve") {
      if (entry?.payload?.prevServe) {
        applyServeState(next, entry.payload.prevServe);
      }
    } else if (undoType === "slots") {
      if (!next.slots || typeof next.slots !== "object") {
        next.slots = {};
      }
      next.slots.base = cloneSnapshot(entry?.payload?.prevBase || { A: {}, B: {} });
      if (entry?.payload?.prevLayout) {
        next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
        next.meta.refereeLayout = normalizeRefereeLayout(entry.payload.prevLayout);
      }
      if (entry?.payload?.prevServe) {
        applyServeState(next, entry.payload.prevServe);
      }
    }

    next.liveLog.splice(index, 1);
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
    return next;
  }

  if (type === "finish" || type === "forfeit") {
    if (!payload?.winner) return next;
    next.status = "finished";
    next.winner = payload.winner;
    next.finishedAt = new Date().toISOString();
    if (type === "forfeit") {
      const winnerSide = validSide(payload.winner);
      const forfeitedSide = resolveForfeitedSide(winnerSide, payload);
      next.gameScores = buildForfeitGameScores(next, winnerSide);
      next.currentGame = Math.max(0, next.gameScores.length - 1);
      next.ratingDelta = 0;
      next.ratingApplied = true;
      next.ratingAppliedAt = new Date().toISOString();
      next.meta = next.meta && typeof next.meta === "object" ? next.meta : {};
      next.meta.resultType = "forfeit";
      next.meta.forfeitedSide = forfeitedSide;
    }
    if (payload.reason) {
      next.note = `[${payload.reason}] ${next.note || ""}`.trim();
    }
    ensureLiveLog(next);
    next.liveLog.push({
      type,
      payload,
      at: new Date().toISOString(),
    });
    next.liveVersion = toNum(next.liveVersion, 0) + 1;
    next.version = next.liveVersion;
  }

  return next;
}

export function rebuildLiveSyncSnapshot(snapshot, queue = []) {
  return (Array.isArray(queue) ? queue : []).reduce(
    (acc, event) => applyLiveSyncEventLocally(acc, event),
    cloneSnapshot(snapshot)
  );
}
