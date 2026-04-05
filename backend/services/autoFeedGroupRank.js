import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";

const GROUP_LIKE_TYPES = new Set(["group", "round_robin", "gsl"]);

function normGroupToken(value) {
  if (value === 0) return "0";
  if (!value) return "";
  const text = String(value).trim().toUpperCase();
  const tailNumber = text.match(/(\d+)\s*$/);
  if (tailNumber) return tailNumber[1];
  if (/^[A-Z]+$/.test(text)) return text;
  return text;
}

function groupOrderOf(group, index) {
  const explicit = Number(group?.order);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : index + 1;
}

function buildGroupAliases(group, index) {
  const code = String(group?.name || group?.code || "").trim();
  const order = groupOrderOf(group, index);
  const aliases = new Set([
    code ? code.toUpperCase() : "",
    String(order),
    `B${order}`,
    `G${order}`,
    normGroupToken(code),
    normGroupToken(order),
  ]);
  aliases.delete("");
  return aliases;
}

function readSeedGroupToken(ref = {}) {
  const groupField =
    typeof ref.group === "string"
      ? ref.group
      : ref.group?.name || ref.group?.code || "";
  const poolField =
    typeof ref.pool === "string"
      ? ref.pool
      : ref.pool?.name || ref.pool?.code || "";

  const candidates = [
    ref.groupCode,
    groupField,
    poolField,
    ref.groupName,
    ref.code,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }

  return "";
}

function groupSizeOf(bracket, group) {
  const regCount = Array.isArray(group?.regIds) ? group.regIds.length : 0;
  if (regCount > 0) return regCount;

  const expectedSize = Number(group?.expectedSize || 0);
  if (expectedSize > 0) return expectedSize;

  if (String(bracket?.type || "").toLowerCase() === "gsl") {
    const gslSize = Number(bracket?.config?.gsl?.groupSize || 0);
    if (gslSize > 0) return gslSize;
  }

  const rrSize = Number(bracket?.config?.roundRobin?.groupSize || 0);
  if (rrSize > 0) return rrSize;

  return 0;
}

function expectedGroupMatches(bracket, group) {
  const type = String(bracket?.type || "").toLowerCase();
  const teamCount = groupSizeOf(bracket, group);
  if (teamCount < 2) return 0;

  if (type === "group" || type === "round_robin") {
    const roundsPerPair =
      Number(bracket?.config?.roundRobin?.roundsPerPair ?? 1) || 1;
    return ((teamCount * (teamCount - 1)) / 2) * roundsPerPair;
  }

  return 0;
}

function resolveGroupMatches(groupMatchMap, aliases) {
  const byId = new Map();
  for (const alias of aliases) {
    const hits = groupMatchMap.get(alias);
    if (!Array.isArray(hits)) continue;
    for (const match of hits) {
      const id = String(match?._id || "");
      if (!id || byId.has(id)) continue;
      byId.set(id, match);
    }
  }
  return [...byId.values()];
}

function computeGroupCompletion({ bracket, groups, matches, log }) {
  const byGroup = new Map();

  for (const match of matches) {
    const rawKey = match?.pool?.name || match?.pool?.key || "";
    const key = normGroupToken(rawKey);
    if (!key) continue;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(match);
  }

  const completionMap = new Map();
  let allGroupsComplete = groups.length > 0;

  groups.forEach((group, index) => {
    const aliases = buildGroupAliases(group, index);
    const groupMatches = resolveGroupMatches(byGroup, aliases);
    const finishedCount = groupMatches.filter(
      (match) => String(match?.status || "").toLowerCase() === "finished"
    ).length;
    const anyUnfinished = groupMatches.some(
      (match) => String(match?.status || "").toLowerCase() !== "finished"
    );
    const expected = expectedGroupMatches(bracket, group);
    const size = groupSizeOf(bracket, group);
    const type = String(bracket?.type || "").toLowerCase();

    let done = false;
    if (size < 2) {
      done = true;
    } else if (expected > 0) {
      done =
        groupMatches.length >= expected &&
        finishedCount >= expected &&
        !anyUnfinished;
    } else if (type === "gsl") {
      done = groupMatches.length > 0 && !anyUnfinished;
    } else {
      done = groupMatches.length > 0 && !anyUnfinished;
    }

    if (!done) allGroupsComplete = false;

    for (const alias of aliases) {
      completionMap.set(alias, done);
    }

    if (log) {
      console.log(
        `[feed] group ${group?.name || group?.code || index + 1}: done=${done} finished=${finishedCount}/${expected || groupMatches.length}`
      );
    }
  });

  return { completionMap, allGroupsComplete };
}

function computeGroupTables({ groups, matches, provisional, log }) {
  const groupsNorm = (groups || []).map((group, index) => {
    const code = String(group?.name || group?.code || "").trim();
    const order = groupOrderOf(group, index);
    return {
      code,
      order,
      aliases: buildGroupAliases(group, index),
      regSet: new Set((group?.regIds || []).map(String)),
      stats: new Map(),
    };
  });

  const groupByAlias = new Map();
  for (const group of groupsNorm) {
    for (const alias of group.aliases) {
      if (!alias || groupByAlias.has(alias)) continue;
      groupByAlias.set(alias, group);
    }
  }

  for (const group of groupsNorm) {
    for (const regId of group.regSet) {
      group.stats.set(regId, { wins: 0, losses: 0, pf: 0, pa: 0, gp: 0 });
    }
  }

  for (const match of matches) {
    const rawKey = match?.pool?.name || match?.pool?.key || "";
    const group = groupByAlias.get(normGroupToken(rawKey));
    if (!group) continue;

    const pairA = match?.pairA ? String(match.pairA) : null;
    const pairB = match?.pairB ? String(match.pairB) : null;
    if (!pairA || !pairB) continue;
    if (!group.stats.has(pairA) || !group.stats.has(pairB)) continue;

    const statsA = group.stats.get(pairA);
    const statsB = group.stats.get(pairB);

    statsA.gp += 1;
    statsB.gp += 1;

    if (Array.isArray(match.gameScores) && match.gameScores.length) {
      let sumA = 0;
      let sumB = 0;
      for (const gameScore of match.gameScores) {
        sumA += Number(gameScore?.a || 0);
        sumB += Number(gameScore?.b || 0);
      }
      statsA.pf += sumA;
      statsA.pa += sumB;
      statsB.pf += sumB;
      statsB.pa += sumA;
    }

    if (match.winner === "A") {
      statsA.wins += 1;
      statsB.losses += 1;
    } else if (match.winner === "B") {
      statsB.wins += 1;
      statsA.losses += 1;
    }
  }

  const tableMap = new Map();
  const wildcardMap = new Map();

  for (const group of groupsNorm) {
    const rows = [...group.stats.entries()]
      .map(([regId, stats]) => ({
        regId,
        gp: stats.gp,
        wins: stats.wins,
        losses: stats.losses,
        diff: stats.pf - stats.pa,
        pf: stats.pf,
      }))
      .filter((row) => (provisional ? row.gp > 0 : true));

    rows.sort(
      (left, right) =>
        right.wins - left.wins ||
        right.diff - left.diff ||
        right.pf - left.pf
    );

    const rankList = rows.map((row) => row.regId);
    const codeUp = group.code ? group.code.toUpperCase() : "";
    const orderStr = String(group.order);
    for (const alias of group.aliases) {
      if (!alias) continue;
      tableMap.set(alias, rankList);
    }

    rows.forEach((row, index) => {
      const rank = index + 1;
      if (!wildcardMap.has(rank)) wildcardMap.set(rank, []);
      wildcardMap.get(rank).push({
        ...row,
        groupCode: codeUp || orderStr,
        groupOrder: Number(group.order || 0) || Number(orderStr || 0) || 0,
      });
    });

    if (log) {
      console.log(
        `[feed] table ${codeUp || orderStr}:`,
        rankList,
        provisional ? "(started teams only)" : "(final mode)"
      );
    }
  }

  for (const [rank, entries] of wildcardMap.entries()) {
    entries.sort(
      (left, right) =>
        right.wins - left.wins ||
        right.diff - left.diff ||
        right.pf - left.pf ||
        left.groupOrder - right.groupOrder ||
        String(left.groupCode || "").localeCompare(String(right.groupCode || ""))
    );
    wildcardMap.set(
      rank,
      entries.map((entry) => entry.regId)
    );
  }

  return { tableMap, wildcardMap };
}

export async function autoFeedGroupRank({
  tournamentId,
  bracketId,
  stageIndex,
  provisional = false,
  finalizeOnComplete = true,
  log = false,
}) {
  const bracket = await Bracket.findById(bracketId).lean();
  if (!bracket) throw new Error("Group bracket not found");

  const type = String(bracket?.type || "").toLowerCase();
  if (!GROUP_LIKE_TYPES.has(type)) {
    if (log) {
      console.log(
        `[feed] bracket ${bracketId} type=${bracket?.type} is not group-like, skip.`
      );
    }
    return { updated: 0, touchedMatches: 0, reason: "not-group" };
  }

  const groups = Array.isArray(bracket?.groups) ? bracket.groups : [];
  if (!groups.length) {
    if (log) console.log("[feed] no groups in bracket");
    return { updated: 0, touchedMatches: 0, reason: "no-groups" };
  }

  const sourceMatches = await Match.find({
    bracket: bracketId,
    format: { $in: [...GROUP_LIKE_TYPES] },
  })
    .select("_id status pool.name pool.key pairA pairB winner gameScores")
    .lean();

  const { completionMap, allGroupsComplete } = computeGroupCompletion({
    bracket,
    groups,
    matches: sourceMatches,
    log,
  });
  const { tableMap, wildcardMap } = computeGroupTables({
    groups,
    matches: sourceMatches,
    provisional,
    log,
  });

  const stage = Number(stageIndex || bracket.stage || 1);
  const stageFilter = [
    { "seedA.ref.stageIndex": stage },
    { "seedA.ref.stage": stage },
    { "seedA.ref.stageIndex": String(stage) },
    { "seedA.ref.stage": String(stage) },
    { "seedB.ref.stageIndex": stage },
    { "seedB.ref.stage": stage },
    { "seedB.ref.stageIndex": String(stage) },
    { "seedB.ref.stage": String(stage) },
  ];

  const targetMatches = await Match.find({
    tournament: tournamentId,
    $or: [{ "seedA.type": "groupRank" }, { "seedB.type": "groupRank" }],
    $and: [{ $or: stageFilter }],
  })
    .select("_id seedA seedB pairA pairB labelKey")
    .lean();

  let targets = 0;
  let updated = 0;

  for (const match of targetMatches) {
    for (const side of ["A", "B"]) {
      const seed = match[`seed${side}`];
      if (!seed || seed.type !== "groupRank") continue;

      const ref = seed.ref || {};
      const rawToken = readSeedGroupToken(ref);
      const token = normGroupToken(rawToken);
      const rank = Number(ref.rank || ref.place || 0);
      const wildcardOrder = Number(
        ref.wildcardOrder || ref.pick || ref.index || 0
      );
      if (!rank) continue;

      targets += 1;

      const slotLabel = token
        ? `${rawToken}#${rank}`
        : `best rank #${rank} wildcard ${Math.max(1, wildcardOrder || 1)}`;
      const field = side === "A" ? "pairA" : "pairB";
      const currentValue = match[field] ? String(match[field]) : "";

      const canResolve = provisional
        ? true
        : token
          ? completionMap.get(token) === true
          : allGroupsComplete;

      let nextRegId = null;
      if (canResolve) {
        const list = token ? tableMap.get(token) : wildcardMap.get(rank);
        const pickIndex = token
          ? rank - 1
          : Math.max(0, (wildcardOrder || 1) - 1);
        nextRegId = Array.isArray(list) ? list[pickIndex] || null : null;
      }

      if (!canResolve || !nextRegId) {
        if (!currentValue) {
          if (log) {
            console.log(
              `[feed] ${match.labelKey || match._id} ${side}: waiting ${slotLabel}`
            );
          }
          continue;
        }

        const res = await Match.updateOne(
          { _id: match._id },
          { $set: { [field]: null } }
        );
        if (res.modifiedCount > 0) {
          updated += 1;
          if (log) {
            console.log(
              `[feed] ${match.labelKey || match._id} cleared ${field} for ${slotLabel} (finalize=${finalizeOnComplete}, provisional=${provisional})`
            );
          }
        }
        continue;
      }

      if (currentValue === String(nextRegId)) {
        if (log) {
          console.log(`[feed] ${match.labelKey || match._id} no change ${field}`);
        }
        continue;
      }

      const res = await Match.updateOne(
        { _id: match._id },
        { $set: { [field]: nextRegId } }
      );
      if (res.modifiedCount > 0) {
        updated += 1;
        if (log) {
          console.log(
            `[feed] ${match.labelKey || match._id} set ${field} <- ${nextRegId} (from ${slotLabel})`
          );
        }
      }
    }
  }

  if (log) {
    console.log(
      `[feed] groupRank targets: ${targets} updated: ${updated} (stage=${stage}, provisional=${provisional})`
    );
  }

  return {
    updated,
    touchedMatches: targets,
    stageIndex: stage,
    provisional,
    allGroupsComplete,
  };
}
