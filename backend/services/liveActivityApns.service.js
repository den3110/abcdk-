import * as http2 from "node:http2";
import jwt from "jsonwebtoken";
import LiveActivityRegistration from "../models/liveActivityRegistrationModel.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";

const {
  APNS_TEAM_ID = "",
  APNS_KEY_ID = "",
  APNS_PRIVATE_KEY = "",
  APNS_BUNDLE_ID = "com.pkt.pickletour",
  APNS_ENV = process.env.NODE_ENV === "production" ? "production" : "sandbox",
} = process.env;

let cachedProviderToken = null;
let cachedProviderTokenExpiresAt = 0;

const normalizeId = (value) =>
  String(value?._id ?? value?.id ?? value ?? "").trim();

const toInt = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : fallback;
};

const toBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

const toDateSeconds = (value) => {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) return Math.round(value / 1000);
    if (value > 1_000_000_000) return Math.round(value);
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return toDateSeconds(asNumber);
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed / 1000);
    }
  }

  if (value instanceof Date) {
    return Math.round(value.getTime() / 1000);
  }

  return null;
};

const normalizeServeSide = (value) =>
  String(value || "").toUpperCase() === "B" ? "B" : "A";

const normalizeWinnerSide = (value) => {
  const winner = String(value || "").toUpperCase();
  return winner === "B" ? "B" : winner === "A" ? "A" : "";
};

const needWins = (bestOf = 1) => Math.floor(Math.max(1, bestOf) / 2) + 1;

const isGameWin = (a = 0, b = 0, pointsToWin = 11, winByTwo = true) => {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  if (high < pointsToWin) return false;
  return winByTwo ? high - low >= 2 : high - low >= 1;
};

const deriveSetWins = (gameScores = [], pointsToWin = 11, winByTwo = true) => {
  let setsA = 0;
  let setsB = 0;

  for (const game of gameScores) {
    const scoreA = Math.max(0, toInt(game?.a, 0));
    const scoreB = Math.max(0, toInt(game?.b, 0));
    if (!isGameWin(scoreA, scoreB, pointsToWin, winByTwo)) continue;
    if (scoreA > scoreB) setsA += 1;
    if (scoreB > scoreA) setsB += 1;
  }

  return { setsA, setsB };
};

const shortNameForSide = (value, fallback) => {
  const trimmed = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) return fallback;

  const words = trimmed.split(" ").filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("");
  }

  return trimmed.slice(0, 3).toUpperCase();
};

const playerName = (player) =>
  String(
    player?.displayName ||
      player?.fullName ||
      player?.name ||
      player?.nickName ||
      player?.nickname ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();

const pairDisplayName = (pair, fallback) => {
  const explicit = String(
    pair?.displayName || pair?.teamName || pair?.label || pair?.title || ""
  )
    .replace(/\s+/g, " ")
    .trim();

  if (explicit) return explicit;

  const names = [playerName(pair?.player1), playerName(pair?.player2)].filter(Boolean);
  return names.join(" & ") || fallback;
};

const matchCourtName = (match) =>
  String(
    match?.courtLabel ||
      match?.courtStationLabel ||
      match?.courtClusterLabel ||
      match?.court?.label ||
      match?.court?.name ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();

const getBreakState = (match) => {
  const raw = match?.isBreak;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      active: false,
      afterGame: null,
      type: "",
      side: "",
      note: "",
      expectedResumeAt: null,
    };
  }

  const rawNote = String(raw.note || "").trim();
  const rawType = String(raw.type || "").trim().toLowerCase();
  const notePrefix = rawNote.split(":")[0]?.trim().toLowerCase() || "";
  const type =
    rawType === "timeout" || rawType === "medical"
      ? rawType
      : notePrefix === "timeout" || notePrefix === "medical"
      ? notePrefix
      : "";
  const sideToken = rawNote.split(":")[1]?.trim().toUpperCase() || "";
  const side = sideToken === "A" || sideToken === "B" ? sideToken : "";

  return {
    active: Boolean(raw.active),
    afterGame: typeof raw.afterGame === "number" ? raw.afterGame : null,
    type,
    side,
    note: rawNote,
    expectedResumeAt: toDateSeconds(raw.expectedResumeAt),
  };
};

const normalizeStatus = (match) => {
  const status = String(
    match?.status || match?.state || match?.match_status || "scheduled"
  )
    .trim()
    .toLowerCase();

  if (status === "assigned") return "assigned";
  if (status === "queued") return "queued";
  if (status === "live") return "live";
  if (status === "finished") return "finished";
  return "scheduled";
};

const phaseLabelForStatus = (status, isBreakActive) => {
  if (status === "live" && isBreakActive) return "Tạm nghỉ";
  switch (status) {
    case "live":
      return "Đang diễn ra";
    case "assigned":
      return "Đã vào sân";
    case "queued":
      return "Đang chờ";
    case "finished":
      return "Kết thúc";
    default:
      return "Sắp đấu";
  }
};

function buildBreakPresentation(breakState, gameIndex) {
  if (!breakState?.active) {
    return {
      phaseLabel: "",
      note: "",
    };
  }

  const sideShort = breakState.side ? ` ${breakState.side}` : "";
  const sideLong = breakState.side ? ` đội ${breakState.side}` : "";
  const normalizedNote = String(breakState.note || "").trim().toLowerCase();
  const normalizedType = String(breakState.type || "").trim().toLowerCase();
  const systemNote =
    normalizedNote &&
    (normalizedNote === normalizedType ||
      normalizedNote === `${normalizedType}:${String(breakState.side || "").toLowerCase()}`);
  const customNote = systemNote ? "" : String(breakState.note || "").trim();

  if (normalizedType === "timeout") {
    return {
      phaseLabel: `Timeout${sideShort}`,
      note: customNote || `Timeout${sideLong}`.trim(),
    };
  }

  if (normalizedType === "medical") {
    return {
      phaseLabel: `Y tế${sideShort}`,
      note: customNote || `Nghỉ y tế${sideLong}`.trim(),
    };
  }

  if (!customNote) {
    const nextGame =
      typeof breakState.afterGame === "number"
        ? Math.max(1, breakState.afterGame + 2)
        : Math.max(1, Number(gameIndex || 0) + 1);
    return {
      phaseLabel: `Chờ game ${nextGame}`,
      note: `Chờ bắt đầu game ${nextGame}`,
    };
  }

  return {
    phaseLabel: "Tạm nghỉ",
    note: customNote,
  };
}

const isUserMatch = (match) =>
  Boolean(
    match?.isUserMatch ||
      match?.userMatch ||
      String(match?.type || "").toLowerCase() === "usermatch" ||
      String(match?.stageType || "").toLowerCase() === "usermatch"
  );

function isApnsConfigured() {
  return Boolean(
    APNS_TEAM_ID.trim() &&
      APNS_KEY_ID.trim() &&
      APNS_PRIVATE_KEY.trim() &&
      APNS_BUNDLE_ID.trim()
  );
}

function remotePushHost() {
  return String(APNS_ENV || "").trim().toLowerCase() === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
}

function apnsTopic() {
  return `${String(APNS_BUNDLE_ID || "").trim()}.push-type.liveactivity`;
}

function apnsPrivateKey() {
  return String(APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function providerToken() {
  if (cachedProviderToken && Date.now() < cachedProviderTokenExpiresAt) {
    return cachedProviderToken;
  }

  cachedProviderToken = jwt.sign({}, apnsPrivateKey(), {
    algorithm: "ES256",
    issuer: APNS_TEAM_ID,
    header: {
      alg: "ES256",
      kid: APNS_KEY_ID,
    },
  });
  cachedProviderTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedProviderToken;
}

function buildLiveActivityState(matchInput = {}) {
  const match = matchInput && typeof matchInput === "object" ? matchInput : {};
  const matchId = normalizeId(match?._id || match?.matchId || match?.id);
  if (!matchId) return null;

  const status = normalizeStatus(match);
  const breakState = getBreakState(match);
  const rules = {
    bestOf: Math.max(1, toInt(match?.rules?.bestOf, 1)),
    pointsToWin: Math.max(1, toInt(match?.rules?.pointsToWin, 11)),
    winByTwo: toBool(match?.rules?.winByTwo, true),
  };

  const gameScores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  const lastIndex = Math.max(0, gameScores.length - 1);
  const currentIndex = Math.min(
    lastIndex,
    Math.max(0, toInt(match?.currentGame, lastIndex))
  );
  const currentGame = gameScores[currentIndex] || {};
  const breakPresentation = buildBreakPresentation(breakState, currentIndex);
  const derivedSets = deriveSetWins(
    gameScores,
    rules.pointsToWin,
    rules.winByTwo
  );
  const setsA = Math.max(0, toInt(match?.setsA ?? derivedSets.setsA, 0));
  const setsB = Math.max(0, toInt(match?.setsB ?? derivedSets.setsB, 0));
  const fallbackWinner =
    setsA >= needWins(rules.bestOf)
      ? "A"
      : setsB >= needWins(rules.bestOf)
      ? "B"
      : "";
  const codePayload = buildMatchCodePayload(match);
  const teamAName = pairDisplayName(match?.pairA, "Đội A");
  const teamBName = pairDisplayName(match?.pairB, "Đội B");

  return {
    matchId,
    status,
    phaseLabel: breakState.active
      ? breakPresentation.phaseLabel
      : phaseLabelForStatus(status, breakState.active),
    isBreakActive: breakState.active,
    breakNote: breakPresentation.note,
    breakExpectedResumeAt: breakState.expectedResumeAt,
    matchCode:
      codePayload?.displayCode ||
      codePayload?.code ||
      String(match?.code || `MATCH-${matchId.slice(-6).toUpperCase()}`),
    courtName: matchCourtName(match),
    source: isUserMatch(match) ? "backend-user-match" : "backend-match",
    teamAName,
    teamBName,
    teamAShortName: shortNameForSide(teamAName, "A"),
    teamBShortName: shortNameForSide(teamBName, "B"),
    scoreA: Math.max(0, toInt(match?.scoreA ?? currentGame?.a, 0)),
    scoreB: Math.max(0, toInt(match?.scoreB ?? currentGame?.b, 0)),
    setsA,
    setsB,
    gameIndex: currentIndex,
    bestOf: rules.bestOf,
    pointsToWin: rules.pointsToWin,
    winByTwo: rules.winByTwo,
    servingSide: normalizeServeSide(
      match?.serve?.side ?? match?.serveSide ?? "A"
    ),
    serverNumber: Math.max(
      1,
      Math.min(
        2,
        toInt(match?.serve?.order ?? match?.serve?.server ?? 1, 1)
      )
    ),
    winnerSide: normalizeWinnerSide(match?.winner || fallbackWinner),
    isUserMatch: isUserMatch(match),
    startedAt:
      status === "live"
        ? toDateSeconds(match?.startedAt ?? match?.liveStartedAt ?? match?.updatedAt)
        : null,
    updatedAt:
      toDateSeconds(match?.updatedAt ?? match?.updated_at ?? Date.now()) ??
      Math.round(Date.now() / 1000),
  };
}

function buildApnsPayload(state, { event } = {}) {
  const timestamp = Math.round(Date.now() / 1000);
  const resolvedEvent = event || (state.status === "finished" ? "end" : "update");
  const aps = {
    timestamp,
    event: resolvedEvent,
    "content-state": {
      status: state.status,
      phaseLabel: state.phaseLabel,
      isBreakActive: state.isBreakActive,
      breakNote: state.breakNote,
      breakExpectedResumeAt: state.breakExpectedResumeAt,
      matchCode: state.matchCode,
      courtName: state.courtName,
      source: state.source,
      teamAName: state.teamAName,
      teamBName: state.teamBName,
      teamAShortName: state.teamAShortName,
      teamBShortName: state.teamBShortName,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      setsA: state.setsA,
      setsB: state.setsB,
      gameIndex: state.gameIndex,
      bestOf: state.bestOf,
      pointsToWin: state.pointsToWin,
      winByTwo: state.winByTwo,
      servingSide: state.servingSide,
      serverNumber: state.serverNumber,
      winnerSide: state.winnerSide,
      isUserMatch: state.isUserMatch,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
    },
  };

  if (resolvedEvent === "update") {
    aps["stale-date"] = timestamp + (state.status === "live" ? 120 : 900);
  } else if (resolvedEvent === "end") {
    aps["dismissal-date"] = timestamp;
  }

  return {
    event: resolvedEvent,
    body: JSON.stringify({ aps }),
  };
}

function sendApnsRequest(pushToken, payloadBody) {
  const session = http2.connect(`https://${remotePushHost()}`);

  return new Promise((resolve, reject) => {
    let responseBody = "";
    let statusCode = 0;

    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${pushToken}`,
      authorization: `bearer ${providerToken()}`,
      "apns-topic": apnsTopic(),
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      statusCode = Number(headers?.[":status"] || 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      session.close();
      let parsed = null;
      try {
        parsed = responseBody ? JSON.parse(responseBody) : null;
      } catch {
        parsed = responseBody || null;
      }
      resolve({
        statusCode,
        body: parsed,
      });
    });
    request.on("error", (error) => {
      session.close();
      reject(error);
    });
    request.end(payloadBody);
  });
}

function shouldDisableRegistration(statusCode, reason = "") {
  return (
    statusCode === 410 ||
    ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(
      String(reason || "")
    )
  );
}

export async function dispatchMatchLiveActivityUpdate(
  matchInput,
  options = {}
) {
  if (!isApnsConfigured()) {
    return { ok: false, reason: "not-configured", sent: 0 };
  }

  const state = buildLiveActivityState(matchInput);
  if (!state?.matchId) {
    return { ok: false, reason: "invalid-match", sent: 0 };
  }

  const registrations = await LiveActivityRegistration.find({
    matchId: state.matchId,
    platform: "ios",
    enabled: true,
    pushToken: { $type: "string", $ne: "" },
  })
    .select("_id pushToken activityId")
    .lean();

  if (!registrations.length) {
    return { ok: true, sent: 0, skipped: true, matchId: state.matchId };
  }

  const payload = buildApnsPayload(state, options);
  const now = new Date();
  const results = [];

  for (const registration of registrations) {
    try {
      const response = await sendApnsRequest(
        registration.pushToken,
        payload.body
      );
      const reason = String(response?.body?.reason || "").trim();
      results.push({
        activityId: registration.activityId,
        statusCode: response.statusCode,
        reason,
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await LiveActivityRegistration.updateOne(
          { _id: registration._id },
          {
            $set: {
              lastError: null,
              lastActiveAt: now,
              status: state.status,
              matchCode: state.matchCode,
              ...(payload.event === "end"
                ? { endedAt: now }
                : {}),
            },
          }
        );
        continue;
      }

      if (response.statusCode === 403 && reason === "ExpiredProviderToken") {
        cachedProviderToken = null;
        cachedProviderTokenExpiresAt = 0;
      }

      const shouldDisable = shouldDisableRegistration(response.statusCode, reason);
      await LiveActivityRegistration.updateOne(
        { _id: registration._id },
        {
          $set: {
            lastError:
              reason ||
              `apns-${String(response.statusCode || "unknown")}`,
            lastActiveAt: now,
            status: state.status,
            matchCode: state.matchCode,
            ...(shouldDisable
              ? { enabled: false, endedAt: now }
              : payload.event === "end"
              ? { endedAt: now }
              : {}),
          },
        }
      );
    } catch (error) {
      results.push({
        activityId: registration.activityId,
        statusCode: 0,
        reason: error?.message || "request-failed",
      });
      await LiveActivityRegistration.updateOne(
        { _id: registration._id },
        {
          $set: {
            lastError: error?.message || "request-failed",
            lastActiveAt: now,
            status: state.status,
            matchCode: state.matchCode,
          },
        }
      );
    }
  }

  return {
    ok: true,
    event: payload.event,
    sent: results.length,
    matchId: state.matchId,
    results,
  };
}
