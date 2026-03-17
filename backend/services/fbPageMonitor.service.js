import FbToken from "../models/fbTokenModel.js";
import Match from "../models/matchModel.js";
import UserMatch from "../models/userMatchModel.js";
import LiveSessionLease from "../models/liveSessionLeaseModel.js";
import { listScheduledFacebookPageReleases } from "./facebookPagePool.service.js";
import { getFbPageMonitorMeta } from "./fbPageMonitorEvents.service.js";

function pickPersonName(person) {
  return (
    person?.nickname ||
    person?.nickName ||
    person?.fullName ||
    person?.name ||
    person?.shortName ||
    person?.displayName ||
    ""
  );
}

function buildPairLabel(pair) {
  if (!pair) return "";
  if (pair.teamName) return pair.teamName;
  const p1 = pickPersonName(pair.player1?.user || pair.player1);
  const p2 = pickPersonName(pair.player2?.user || pair.player2);
  return [p1, p2].filter(Boolean).join(" / ") || pair.label || "";
}

function buildParticipantsLabel(doc) {
  const sideA = buildPairLabel(doc?.pairA);
  const sideB = buildPairLabel(doc?.pairB);
  return [sideA, sideB].filter(Boolean).join(" vs ");
}

function buildCourtLabel(doc) {
  if (doc?.courtLabel) return doc.courtLabel;
  if (doc?.court?.name) return doc.court.name;
  if (doc?.court?.label) return doc.court.label;
  if (Number.isFinite(doc?.court?.number)) return `Sân ${doc.court.number}`;
  return "";
}

function compactLabel(parts) {
  return parts.filter(Boolean).join(" • ");
}

function computeLocalStatusCode(doc) {
  const now = Date.now();
  const userExpired =
    doc.longUserExpiresAt && new Date(doc.longUserExpiresAt).getTime() < now;
  const pageExpired =
    doc.pageTokenExpiresAt && new Date(doc.pageTokenExpiresAt).getTime() < now;

  if (doc.disabled) return "DISABLED";
  if (doc.needsReauth) return "NEEDS_REAUTH";
  if (!doc.pageToken) return "MISSING_PAGE_TOKEN";
  if (pageExpired) return "EXPIRED";
  if (userExpired) return "USER_EXPIRED";
  return doc.lastStatusCode || "UNKNOWN";
}

function toTargetLabel(doc, fallback = "Match") {
  if (!doc) return fallback;
  return (
    doc.facebookLive?.title ||
    doc.title ||
    doc.displayName ||
    doc.code ||
    doc.roundCode ||
    doc.roundName ||
    fallback
  );
}

function buildTargetInfo(doc, matchKind) {
  if (!doc?._id) return null;
  const tournamentName =
    doc?.tournament?.name || doc?.customLeague?.name || doc?.location?.name || "";
  const bracketName = doc?.bracket?.name || "";
  const bracketStage = doc?.bracket?.stage || "";
  const roundLabel = doc?.roundName || doc?.roundCode || "";
  const courtLabel = buildCourtLabel(doc);
  const participantsLabel = buildParticipantsLabel(doc);
  const competitionLabel = compactLabel([
    tournamentName,
    compactLabel([bracketName, bracketStage]),
    roundLabel,
    courtLabel,
  ]);
  return {
    matchKind,
    targetId: String(doc._id),
    label:
      participantsLabel ||
      toTargetLabel(doc, matchKind === "userMatch" ? "User match" : "Match"),
    status: doc.status || null,
    code: doc.code || null,
    tournamentName: tournamentName || null,
    bracketName: bracketName || null,
    bracketStage: bracketStage || null,
    roundLabel: roundLabel || null,
    courtLabel: courtLabel || null,
    participantsLabel: participantsLabel || null,
    competitionLabel: competitionLabel || null,
  };
}

function buildMonitorState({ doc, activeLeaseCount, releasePending, statusCode }) {
  if (activeLeaseCount > 0) {
    return {
      code: "LIVE",
      label: "Đang giữ lease",
      color: "error",
      note: "Page đang có live session lease hoạt động.",
    };
  }
  if (doc.isBusy && releasePending) {
    return {
      code: "COOLING_DOWN",
      label: "Đang cooldown",
      color: "warning",
      note: "Page đã được lên lịch nhả về pool sau khi end live.",
    };
  }
  if (doc.isBusy) {
    return {
      code: "BUSY",
      label: "Busy",
      color: "warning",
      note: "Page đang bị đánh dấu bận nhưng chưa có lease active.",
    };
  }
  if (doc.disabled) {
    return {
      code: "DISABLED",
      label: "Disabled",
      color: "default",
      note: "Page đang bị tắt khỏi pool tự động.",
    };
  }
  if (statusCode === "NEEDS_REAUTH") {
    return {
      code: "NEEDS_REAUTH",
      label: "Cần reauth",
      color: "error",
      note: "Token/page state đang yêu cầu re-auth.",
    };
  }
  if (statusCode !== "OK" && statusCode !== "UNKNOWN") {
    return {
      code: "ATTENTION",
      label: "Cần kiểm tra",
      color: "warning",
      note: "Page có cảnh báo token hoặc permission gần nhất.",
    };
  }
  return {
    code: "IDLE",
    label: "Sẵn sàng",
    color: "success",
    note: "Page đang rảnh và không có lease active.",
  };
}

function serializeReleasePending(entry) {
  if (!entry?.dueAt) return null;
  const dueAt = new Date(entry.dueAt);
  const dueAtMs = dueAt.getTime();
  return {
    dueAt,
    delayMs: entry.delayMs || 0,
    reason: entry.reason || "free_requested",
    remainingMs: Number.isFinite(dueAtMs) ? Math.max(0, dueAtMs - Date.now()) : 0,
  };
}

function serializeLease(lease, targetInfo) {
  if (!lease?._id) return null;
  return {
    leaseId: String(lease._id),
    clientSessionId: lease.clientSessionId,
    status: lease.status,
    startedAt: lease.startedAt,
    lastHeartbeatAt: lease.lastHeartbeatAt,
    expiresAt: lease.expiresAt,
    pageId: lease.pageId || null,
    liveVideoId: lease.liveVideoId || null,
    target: targetInfo,
  };
}

function sortRows(rows) {
  const priority = {
    LIVE: 0,
    COOLING_DOWN: 1,
    BUSY: 2,
    NEEDS_REAUTH: 3,
    ATTENTION: 4,
    IDLE: 5,
    DISABLED: 6,
  };

  return [...rows].sort((a, b) => {
    const pa = priority[a.monitorState?.code] ?? 99;
    const pb = priority[b.monitorState?.code] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.pageName || a.pageId).localeCompare(String(b.pageName || b.pageId));
  });
}

export async function buildFbPageMonitorSnapshot() {
  const [docs, activeLeases] = await Promise.all([
    FbToken.find({})
      .sort({ disabled: 1, isBusy: -1, pageName: 1, updatedAt: -1 })
      .lean(),
    LiveSessionLease.find({ platform: "facebook", status: "active" })
      .sort({ lastHeartbeatAt: -1, createdAt: -1 })
      .lean(),
  ]);

  const releaseSchedules = listScheduledFacebookPageReleases();
  const releaseMap = new Map(
    releaseSchedules.map((item) => [String(item.pageId), serializeReleasePending(item)])
  );

  const matchIds = new Set();
  const userMatchIds = new Set();

  for (const doc of docs) {
    if (doc.busyMatch) matchIds.add(String(doc.busyMatch));
  }
  for (const lease of activeLeases) {
    if (lease.matchKind === "userMatch" && lease.userMatchId) {
      userMatchIds.add(String(lease.userMatchId));
    } else if (lease.matchId) {
      matchIds.add(String(lease.matchId));
    }
  }

  const [matches, userMatches] = await Promise.all([
    matchIds.size
      ? Match.find({ _id: { $in: Array.from(matchIds) } })
          .populate({
            path: "pairA",
            select: "player1 player2 teamName label",
            populate: [
              {
                path: "player1",
                select: "fullName name shortName nickname nickName user",
                populate: { path: "user", select: "name fullName nickname nickName" },
              },
              {
                path: "player2",
                select: "fullName name shortName nickname nickName user",
                populate: { path: "user", select: "name fullName nickname nickName" },
              },
            ],
          })
          .populate({
            path: "pairB",
            select: "player1 player2 teamName label",
            populate: [
              {
                path: "player1",
                select: "fullName name shortName nickname nickName user",
                populate: { path: "user", select: "name fullName nickname nickName" },
              },
              {
                path: "player2",
                select: "fullName name shortName nickname nickName user",
                populate: { path: "user", select: "name fullName nickname nickName" },
              },
            ],
          })
          .populate({ path: "tournament", select: "name" })
          .populate({ path: "bracket", select: "name stage" })
          .populate({ path: "court", select: "name number label" })
          .select(
            "code roundCode roundName status facebookLive courtLabel tournament bracket court pairA pairB"
          )
          .lean()
      : Promise.resolve([]),
    userMatchIds.size
      ? UserMatch.find({ _id: { $in: Array.from(userMatchIds) } })
          .populate({ path: "tournament", select: "name" })
          .populate({ path: "court", select: "name number label" })
          .select(
            "code title displayName status facebookLive customLeague location courtLabel tournament court pairA pairB"
          )
          .lean()
      : Promise.resolve([]),
  ]);

  const matchMap = new Map(matches.map((item) => [String(item._id), item]));
  const userMatchMap = new Map(userMatches.map((item) => [String(item._id), item]));
  const leasesByPageId = new Map();

  for (const lease of activeLeases) {
    if (!lease.pageId) continue;
    const key = String(lease.pageId);
    const current = leasesByPageId.get(key) || [];
    current.push(lease);
    leasesByPageId.set(key, current);
  }

  const rows = docs.map((doc) => {
    const pageId = String(doc.pageId);
    const statusCode = computeLocalStatusCode(doc);
    const pageLeases = leasesByPageId.get(pageId) || [];
    const latestLease = pageLeases[0] || null;
    const latestTarget =
      latestLease?.matchKind === "userMatch"
        ? buildTargetInfo(
            userMatchMap.get(String(latestLease.userMatchId || "")),
            "userMatch"
          )
        : buildTargetInfo(matchMap.get(String(latestLease?.matchId || "")), "match");
    const busyTarget = doc.busyMatch
      ? buildTargetInfo(matchMap.get(String(doc.busyMatch)), "match")
      : latestTarget;
    const releasePending = releaseMap.get(pageId) || null;
    const monitorState = buildMonitorState({
      doc,
      activeLeaseCount: pageLeases.length,
      releasePending,
      statusCode,
    });

    return {
      _id: String(doc._id),
      pageId,
      pageName: doc.pageName || "",
      category: doc.category || "",
      tasks: Array.isArray(doc.tasks) ? doc.tasks : [],
      disabled: Boolean(doc.disabled),
      needsReauth: Boolean(doc.needsReauth),
      isBusy: Boolean(doc.isBusy),
      busySince: doc.busySince || null,
      busyLiveVideoId: doc.busyLiveVideoId || null,
      busyTarget,
      lastCheckedAt: doc.lastCheckedAt || null,
      lastError: doc.lastError || "",
      lastStatusCode: doc.lastStatusCode || null,
      localStatusCode: statusCode,
      longUserExpiresAt: doc.longUserExpiresAt || null,
      pageTokenExpiresAt: doc.pageTokenExpiresAt || null,
      pageTokenIsNever: Boolean(doc.pageTokenIsNever),
      monitorState,
      releasePending,
      activeLeaseCount: pageLeases.length,
      activeLeases: pageLeases.map((lease) =>
        serializeLease(
          lease,
          lease.matchKind === "userMatch"
            ? buildTargetInfo(
                userMatchMap.get(String(lease.userMatchId || "")),
                "userMatch"
              )
            : buildTargetInfo(matchMap.get(String(lease.matchId || "")), "match")
        )
      ),
      latestLease: serializeLease(latestLease, latestTarget),
      updatedAt: doc.updatedAt || null,
    };
  });

  const summary = {
    totalPages: rows.length,
    busyPages: rows.filter((row) => row.isBusy).length,
    disabledPages: rows.filter((row) => row.disabled).length,
    needsReauthPages: rows.filter((row) => row.needsReauth).length,
    activeLeasePages: rows.filter((row) => row.activeLeaseCount > 0).length,
    activeLeases: activeLeases.length,
    releasePendingPages: rows.filter((row) => row.releasePending).length,
    healthyPages: rows.filter((row) => row.monitorState.code === "IDLE").length,
    statusCounts: rows.reduce((acc, row) => {
      acc[row.localStatusCode] = (acc[row.localStatusCode] || 0) + 1;
      return acc;
    }, {}),
    monitorStateCounts: rows.reduce((acc, row) => {
      acc[row.monitorState.code] = (acc[row.monitorState.code] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    ts: new Date(),
    meta: getFbPageMonitorMeta(),
    summary,
    rows: sortRows(rows),
  };
}
