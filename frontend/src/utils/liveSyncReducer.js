function cloneSnapshot(value) {
  if (!value) return value;
  return JSON.parse(JSON.stringify(value));
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function validSide(side) {
  return side === "A" || side === "B" ? side : "A";
}

function validServer(server) {
  return server === 1 || server === 2 ? server : 1;
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

function applyServeState(snapshot, serve) {
  const server = validServer(serve?.server);
  snapshot.serve = {
    side: validSide(serve?.side),
    server,
    serverId: serve?.serverId || null,
    opening: server === 1 && Boolean(serve?.opening),
  };
  if (!snapshot.slots || typeof snapshot.slots !== "object") {
    snapshot.slots = {};
  }
  snapshot.slots.serverId = snapshot.serve.serverId || null;
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
    next.status = "live";
    if (!next.startedAt) next.startedAt = new Date().toISOString();
    if (!Array.isArray(next.gameScores) || !next.gameScores.length) {
      next.gameScores = [{ a: 0, b: 0 }];
      next.currentGame = 0;
    }
    next.serve = {
      side: validSide(next.serve?.side),
      server: 1,
      serverId: next.serve?.serverId || null,
      opening: true,
    };
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
    if (team === "A") score.a += step;
    else score.b += step;
    next.gameScores[gameIndex] = score;

    const prevServe = {
      side: validSide(next.serve?.side),
      server: validServer(next.serve?.server),
      serverId: next.serve?.serverId || null,
      opening: Boolean(next.serve?.opening),
    };
    if (team !== prevServe.side) {
      next.serve = onLostRallyNextServe(prevServe);
      const base = next?.meta?.slots?.base || next?.slots?.base;
      if (base && base[next.serve.side]) {
        const entry = Object.entries(base[next.serve.side]).find(
          ([, slot]) => Number(slot) === Number(next.serve.server)
        );
        next.serve.serverId = entry ? entry[0] : null;
      }
    } else if (!next.serve) {
      next.serve = prevServe;
    }

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
