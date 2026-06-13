#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../backend/models/userModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const API = process.env.E2E_API_URL || "http://127.0.0.1:5001";
const ADMIN_EMAIL = String(process.env.E2E_ADMIN_EMAIL || "").trim();
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";
const ARTIFACT_DIR =
  process.env.E2E_ARTIFACT_DIR || path.join(os.tmpdir(), "mern-auth-e2e-artifacts");

const runId = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto
  .randomBytes(3)
  .toString("hex")}`;
const generatedPassword = `CodexRefSync-${runId}-Pass1`;

const report = {
  runId,
  startedAt: new Date().toISOString(),
  api,
  steps: [],
  data: {},
};

let token = "";
let eventCounter = 0;

function idOf(value) {
  return String(value?._id || value?.id || value || "");
}

function stripQuotes(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function toLocalIsoNoMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    "-",
    pad(d.getMonth() + 1),
    "-",
    pad(d.getDate()),
    "T",
    pad(d.getHours()),
    ":",
    pad(d.getMinutes()),
    ":",
    pad(d.getSeconds()),
  ].join("");
}

function futureHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function safeError(error) {
  return {
    message: error?.message || String(error),
    status: error?.status || undefined,
    body: error?.body ? String(error.body).slice(0, 2000) : undefined,
  };
}

async function timed(name, fn) {
  const started = Date.now();
  const row = { name, status: "running", startedAt: new Date().toISOString() };
  report.steps.push(row);
  try {
    const result = await fn();
    row.status = "ok";
    row.durationMs = Date.now() - started;
    return result;
  } catch (error) {
    row.status = "failed";
    row.durationMs = Date.now() - started;
    row.error = safeError(error);
    throw error;
  }
}

async function api(method, route, body, options = {}) {
  const headers = {
    accept: "application/json",
    ...(options.headers || {}),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (options.auth !== false && token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
  });

  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const expected = options.expected || [200, 201];
  if (!expected.includes(response.status)) {
    const message =
      typeof data === "string" ? data.slice(0, 400) : data?.message || "request failed";
    const error = new Error(`${method} ${route} returned ${response.status}: ${message}`);
    error.status = response.status;
    error.body = typeof data === "string" ? data : JSON.stringify(data);
    throw error;
  }

  return data;
}

async function connectDb() {
  const mongoUri = stripQuotes(process.env.MONGO_URI);
  assert.ok(mongoUri, "MONGO_URI is missing");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
}

function phoneFor(index) {
  const digest = crypto.createHash("sha1").update(`${runId}:${index}`).digest("hex");
  return `09${String(parseInt(digest.slice(0, 8), 16)).slice(-8).padStart(8, "0")}`;
}

async function upsertPlayer(index) {
  const email = `codex.refsync.${runId}.${index}@example.test`.toLowerCase();
  const hash = await bcrypt.hash(generatedPassword, 10);
  return User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        name: `Codex RefSync Player ${index}`,
        nickname: `refsync_${runId.replace(/-/g, "_")}_${index}`,
        email,
        phone: phoneFor(index),
        password: hash,
        role: "user",
        verified: "verified",
        cccdStatus: "verified",
        province: "Ho Chi Minh",
        gender: "unspecified",
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        isDeleted: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
}

async function createTournament() {
  const codeSeed = runId.replace(/[^0-9a-z]/gi, "").slice(-14).toUpperCase();
  return api("POST", "/api/admin/tournaments", {
    name: `Codex RefSync ${runId}`,
    code: `REF${codeSeed}`.slice(0, 32),
    image: "https://placehold.co/1200x675/png",
    sportType: 1,
    groupId: 0,
    eventType: "single",
    tournamentMode: "standard",
    nameDisplayMode: "nickname",
    regOpenDate: toLocalIsoNoMs(futureHours(-24)),
    registrationDeadline: toLocalIsoNoMs(futureHours(24)),
    startDate: toLocalIsoNoMs(futureHours(48)),
    endDate: toLocalIsoNoMs(futureHours(72)),
    scoreCap: 0,
    scoreGap: 0,
    singleCap: 0,
    maxPairs: 2,
    location: "Codex RefSync Court",
    contactHtml: "",
    contentHtml: "",
    noRankDelta: true,
    allowExceedMaxRating: true,
    requireKyc: false,
    scoringScope: { type: "national" },
    bankShortName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    registrationFee: 0,
    isFreeRegistration: true,
    allowedCourtClusterIds: [],
    teamConfig: {
      factions: [
        { name: "A", order: 0, isActive: true },
        { name: "B", order: 1, isActive: true },
      ],
    },
    ageRestriction: { enabled: false, minAge: 0, maxAge: 100 },
  });
}

async function createRegistration(tournamentId, player, index) {
  return api("POST", `/api/admin/tournaments/${tournamentId}/registrations`, {
    player1Id: String(player._id),
    paymentStatus: "Paid",
    message: `referee live sync e2e ${index}`,
  });
}

async function createMatchFixture(bracketId, regs, order, rules = {}) {
  const nextRules = {
    bestOf: 1,
    pointsToWin: 11,
    winByTwo: true,
    cap: { mode: "none", points: null },
    ...rules,
  };
  return api("POST", `/api/admin/brackets/${bracketId}/matches`, {
    pairA: idOf(regs[0]),
    pairB: idOf(regs[1]),
    round: 1,
    order,
    rules: nextRules,
  });
}

function liveEvent(type, payload = {}, baseVersion = 0) {
  eventCounter += 1;
  return {
    clientEventId: `${runId}:${String(eventCounter).padStart(3, "0")}:${type}`,
    type,
    payload,
    clientCreatedAt: new Date().toISOString(),
    clientBaseVersion: Number(baseVersion || 0),
  };
}

function gameScore(snapshot) {
  const current = Array.isArray(snapshot?.gameScores) ? snapshot.gameScores[0] : null;
  return { a: Number(current?.a || 0), b: Number(current?.b || 0) };
}

function compactGameScores(snapshot) {
  return (Array.isArray(snapshot?.gameScores) ? snapshot.gameScores : []).map((score) => ({
    a: Number(score?.a || 0),
    b: Number(score?.b || 0),
  }));
}

function pointEvents(team, count, baseVersion = 0) {
  return Array.from({ length: count }, () =>
    liveEvent("point", { team, step: 1 }, baseVersion),
  );
}

function deviceHeaders(name) {
  return {
    "X-Device-Id": `codex-refsync-${runId}-${name}`,
    "X-Device-Name": `Codex RefSync ${name}`,
  };
}

async function testAbortableNetworkTimeout() {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }, 500);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      () => fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(50) }),
      (error) => error?.name === "TimeoutError" || error?.name === "AbortError",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function bootstrapAndClaim(matchId, headers, label) {
  const bootstrap = await timed(`${label}: bootstrap`, () =>
    api("GET", `/api/referee/matches/${matchId}/live-sync/bootstrap`, undefined, {
      headers,
    }),
  );
  const claim = await timed(`${label}: claim`, () =>
    api("POST", `/api/referee/matches/${matchId}/live-sync/claim`, {}, { headers }),
  );
  assert.equal(claim?.owner?.isSelf, true, `${label}: owner mismatch`);
  return { bootstrap, claim };
}

async function syncEvents(matchId, headers, lastKnownServerVersion, events, label) {
  return timed(label, () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion, events },
      { headers },
    ),
  );
}

async function main() {
  assert.ok(ADMIN_EMAIL, "E2E_ADMIN_EMAIL is required");
  assert.ok(ADMIN_PASSWORD, "E2E_ADMIN_PASSWORD is required");

  await timed("service health", async () => {
    const result = await fetch(`${API}/`, { signal: AbortSignal.timeout(5000) });
    assert.ok(result.status < 500, `API health returned ${result.status}`);
  });

  await timed("client timeout primitive", testAbortableNetworkTimeout);

  await timed("admin login", async () => {
    const login = await api(
      "POST",
      "/api/admin/login",
      { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      { auth: false, expected: [200] },
    );
    token = login?.token || login?.user?.token || "";
    assert.ok(token, "Admin login did not return token");
  });

  await timed("connect db", connectDb);

  const players = await timed("prepare players", () =>
    Promise.all([upsertPlayer(1), upsertPlayer(2)]),
  );

  const tournament = await timed("create tournament", createTournament);
  const tournamentId = idOf(tournament);
  assert.ok(mongoose.isValidObjectId(tournamentId), "Tournament id is invalid");

  const regs = [];
  for (const [index, player] of players.entries()) {
    regs.push(
      await timed(`create registration ${index + 1}`, () =>
        createRegistration(tournamentId, player, index + 1),
      ),
    );
  }

  const bracket = await timed("create bracket", () =>
    api("POST", `/api/admin/tournaments/${tournamentId}/brackets`, {
      name: "RefSync KO",
      type: "knockout",
      stage: 1,
      order: 0,
      drawRounds: 1,
      meta: { drawSize: 2 },
      config: {
        rules: {
          bestOf: 1,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
      },
      noRankDelta: true,
    }),
  );
  const bracketId = idOf(bracket);

  const match = await timed("create match", () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      pairA: idOf(regs[0]),
      pairB: idOf(regs[1]),
      round: 1,
      order: 0,
      rules: {
        bestOf: 1,
        pointsToWin: 11,
        winByTwo: true,
        cap: { mode: "none", points: null },
      },
    }),
  );
  const matchId = idOf(match);
  report.data = { tournamentId, bracketId, matchId };

  let nextMatchOrder = 1;
  const deviceA = deviceHeaders("A");
  const deviceB = deviceHeaders("B");

  const bootstrap = await timed("bootstrap live sync", () =>
    api("GET", `/api/referee/matches/${matchId}/live-sync/bootstrap`, undefined, {
      headers: deviceA,
    }),
  );
  assert.equal(idOf(bootstrap?.snapshot), matchId, "Bootstrap snapshot mismatch");

  const race = await timed("device A/B concurrent claim race", () =>
    Promise.allSettled([
      api("POST", `/api/referee/matches/${matchId}/live-sync/claim`, {}, { headers: deviceA }),
      api("POST", `/api/referee/matches/${matchId}/live-sync/claim`, {}, { headers: deviceB }),
    ]),
  );
  const raceFulfilled = race.filter((item) => item.status === "fulfilled");
  const raceRejected = race.filter((item) => item.status === "rejected");
  assert.equal(raceFulfilled.length, 1, "Concurrent claim must have exactly one winner");
  assert.equal(raceRejected.length, 1, "Concurrent claim must reject exactly one device");
  assert.equal(raceRejected[0]?.reason?.status, 409, "Concurrent loser must receive 409");

  await timed("device B takeover after claim race", () =>
    api("POST", `/api/referee/matches/${matchId}/live-sync/takeover`, {}, { headers: deviceB }),
  );

  const claimA = await timed("device A takeover before scoring", () =>
    api("POST", `/api/referee/matches/${matchId}/live-sync/takeover`, {}, { headers: deviceA }),
  );
  assert.equal(claimA?.owner?.isSelf, true, "Device A did not own the match");

  const baseVersion = Number(bootstrap?.serverVersion || 0);
  const batchA = [
    liveEvent("start", {}, baseVersion),
    liveEvent("point", { team: "A", step: 1 }, baseVersion),
    liveEvent("point", { team: "B", step: 1 }, baseVersion),
    liveEvent("point", { team: "A", step: 1 }, baseVersion),
    liveEvent("undo", {}, baseVersion),
    liveEvent("point", { team: "A", step: 1 }, baseVersion),
  ];

  const syncA = await timed("device A sync start/points/undo", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: baseVersion, events: batchA },
      { headers: deviceA },
    ),
  );
  assert.deepEqual(syncA?.ackedClientEventIds, batchA.map((item) => item.clientEventId));
  assert.deepEqual(syncA?.rejectedEvents || [], []);
  assert.equal(syncA?.snapshot?.status, "live");
  assert.deepEqual(gameScore(syncA?.snapshot), { a: 2, b: 1 });

  const duplicateA = await timed("device A resend same batch idempotently", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: syncA.serverVersion, events: batchA },
      { headers: deviceA },
    ),
  );
  assert.deepEqual(gameScore(duplicateA?.snapshot), { a: 2, b: 1 });

  const conflictEvent = liveEvent("point", { team: "B", step: 1 }, syncA.serverVersion);
  const conflict = await timed("device B sync rejected while A owns", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: syncA.serverVersion, events: [conflictEvent] },
      { headers: deviceB },
    ),
  );
  assert.equal(conflict?.ackedClientEventIds?.length || 0, 0);
  assert.equal(conflict?.rejectedEvents?.[0]?.code, "ownership_conflict");
  assert.deepEqual(gameScore(conflict?.snapshot), { a: 2, b: 1 });

  const takeoverB = await timed("device B takeover", () =>
    api("POST", `/api/referee/matches/${matchId}/live-sync/takeover`, {}, { headers: deviceB }),
  );
  assert.equal(takeoverB?.owner?.isSelf, true, "Device B takeover did not own the match");

  const pointB = liveEvent("point", { team: "B", step: 1 }, takeoverB.serverVersion);
  const syncB = await timed("device B sync after takeover", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: takeoverB.serverVersion, events: [pointB] },
      { headers: deviceB },
    ),
  );
  assert.deepEqual(syncB?.ackedClientEventIds, [pointB.clientEventId]);
  assert.deepEqual(gameScore(syncB?.snapshot), { a: 2, b: 2 });

  const forfeit = liveEvent(
    "forfeit",
    { winner: "A", reason: "forfeit", forfeitedSide: "B" },
    syncB.serverVersion,
  );
  const forfeited = await timed("device B forfeit", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: syncB.serverVersion, events: [forfeit] },
      { headers: deviceB },
    ),
  );
  assert.deepEqual(forfeited?.ackedClientEventIds, [forfeit.clientEventId]);
  assert.equal(forfeited?.snapshot?.status, "finished");
  assert.equal(forfeited?.snapshot?.winner, "A");
  assert.deepEqual(compactGameScores(forfeited?.snapshot), [{ a: 11, b: 0 }]);
  assert.equal(Number(forfeited?.snapshot?.ratingDelta || 0), 0);
  assert.equal(forfeited?.snapshot?.ratingApplied, true);
  assert.equal(forfeited?.snapshot?.meta?.resultType, "forfeit");
  assert.equal(forfeited?.snapshot?.meta?.forfeitedSide, "B");

  const latePoint = liveEvent("point", { team: "B", step: 1 }, forfeited.serverVersion);
  const lateRejected = await timed("point after finished rejected", () =>
    api(
      "POST",
      `/api/referee/matches/${matchId}/live-sync/sync`,
      { lastKnownServerVersion: forfeited.serverVersion, events: [latePoint] },
      { headers: deviceB },
    ),
  );
  assert.equal(lateRejected?.ackedClientEventIds?.length || 0, 0);
  assert.equal(lateRejected?.rejectedEvents?.[0]?.code, "invalid_transition");
  assert.deepEqual(compactGameScores(lateRejected?.snapshot), [{ a: 11, b: 0 }]);

  const finalMatch = await timed("verify final match detail", () =>
    api("GET", `/api/admin/matches/${matchId}`),
  );
  assert.equal(finalMatch?.status, "finished");
  assert.equal(finalMatch?.winner, "A");
  assert.deepEqual(compactGameScores(finalMatch), [{ a: 11, b: 0 }]);

  const validationMatch = await timed("create finish validation match", () =>
    createMatchFixture(bracketId, regs, nextMatchOrder++),
  );
  const validationMatchId = idOf(validationMatch);
  const validation = await bootstrapAndClaim(validationMatchId, deviceA, "finish validation");
  const validationBase = Number(validation.bootstrap?.serverVersion || 0);
  const earlyFinish = liveEvent("finish", { winner: "A", reason: "finish" }, validationBase);
  const earlyRejected = await syncEvents(
    validationMatchId,
    deviceA,
    validationBase,
    [earlyFinish],
    "finish validation: reject finish before score done",
  );
  assert.equal(earlyRejected?.ackedClientEventIds?.length || 0, 0);
  assert.equal(earlyRejected?.rejectedEvents?.[0]?.code, "invalid_transition");

  const validationScoreEvents = [
    liveEvent("start", {}, validationBase),
    ...pointEvents("A", 11, validationBase),
  ];
  const validationScored = await syncEvents(
    validationMatchId,
    deviceA,
    validationBase,
    validationScoreEvents,
    "finish validation: score game to 11-0",
  );
  assert.deepEqual(compactGameScores(validationScored?.snapshot), [{ a: 11, b: 0 }]);

  const wrongFinish = liveEvent(
    "finish",
    { winner: "B", reason: "finish" },
    validationScored.serverVersion,
  );
  const wrongRejected = await syncEvents(
    validationMatchId,
    deviceA,
    validationScored.serverVersion,
    [wrongFinish],
    "finish validation: reject wrong winner",
  );
  assert.equal(wrongRejected?.ackedClientEventIds?.length || 0, 0);
  assert.equal(wrongRejected?.rejectedEvents?.[0]?.code, "invalid_transition");
  assert.equal(wrongRejected?.snapshot?.status, "live");

  const correctFinish = liveEvent(
    "finish",
    { winner: "A", reason: "finish" },
    validationScored.serverVersion,
  );
  const validationFinished = await syncEvents(
    validationMatchId,
    deviceA,
    validationScored.serverVersion,
    [correctFinish],
    "finish validation: accept correct winner",
  );
  assert.equal(validationFinished?.snapshot?.status, "finished");
  assert.equal(validationFinished?.snapshot?.winner, "A");

  const breakMatch = await timed("create break guard match", () =>
    createMatchFixture(bracketId, regs, nextMatchOrder++),
  );
  const breakMatchId = idOf(breakMatch);
  const breakOwned = await bootstrapAndClaim(breakMatchId, deviceA, "break guard");
  const breakBase = Number(breakOwned.bootstrap?.serverVersion || 0);
  const breakStarted = await syncEvents(
    breakMatchId,
    deviceA,
    breakBase,
    [liveEvent("start", {}, breakBase)],
    "break guard: start match",
  );
  await timed("break guard: set timeout active", () =>
    api(
      "PUT",
      `/api/referee/matches/${breakMatchId}/break`,
      {
        active: true,
        note: "timeout:A",
        type: "timeout",
        afterGame: 0,
        expectedResumeAt: new Date(Date.now() + 60000).toISOString(),
      },
      { headers: deviceA },
    ),
  );
  const breakPoint = liveEvent("point", { team: "A", step: 1 }, breakStarted.serverVersion);
  const breakBlocked = await syncEvents(
    breakMatchId,
    deviceA,
    breakStarted.serverVersion,
    [breakPoint],
    "break guard: reject point during break",
  );
  assert.equal(breakBlocked?.ackedClientEventIds?.length || 0, 0);
  assert.equal(breakBlocked?.rejectedEvents?.[0]?.code, "break_active");
  await timed("break guard: clear timeout", () =>
    api(
      "PUT",
      `/api/referee/matches/${breakMatchId}/break`,
      { active: false, note: "", afterGame: 0 },
      { headers: deviceA },
    ),
  );
  const afterBreakPoint = liveEvent("point", { team: "A", step: 1 }, breakStarted.serverVersion);
  const breakAccepted = await syncEvents(
    breakMatchId,
    deviceA,
    breakStarted.serverVersion,
    [afterBreakPoint],
    "break guard: accept point after break cleared",
  );
  assert.deepEqual(breakAccepted?.ackedClientEventIds, [afterBreakPoint.clientEventId]);
  assert.deepEqual(gameScore(breakAccepted?.snapshot), { a: 1, b: 0 });

  const partialMatch = await timed("create partial rejection match", () =>
    createMatchFixture(bracketId, regs, nextMatchOrder++),
  );
  const partialMatchId = idOf(partialMatch);
  const partialOwned = await bootstrapAndClaim(partialMatchId, deviceA, "partial batch");
  const partialBase = Number(partialOwned.bootstrap?.serverVersion || 0);
  const partialEvents = [
    liveEvent("start", {}, partialBase),
    liveEvent("point", { team: "A", step: 1 }, partialBase),
    liveEvent(
      "serve",
      { side: "A", server: 1, serverId: "000000000000000000000000" },
      partialBase,
    ),
    liveEvent("point", { team: "A", step: 1 }, partialBase),
  ];
  const partialResult = await syncEvents(
    partialMatchId,
    deviceA,
    partialBase,
    partialEvents,
    "partial batch: ack before invalid event and reject remainder",
  );
  assert.deepEqual(
    partialResult?.ackedClientEventIds,
    partialEvents.slice(0, 2).map((event) => event.clientEventId),
  );
  assert.equal(partialResult?.rejectedEvents?.length, 2);
  assert.equal(partialResult?.rejectedEvents?.[0]?.code, "invalid_transition");
  assert.deepEqual(gameScore(partialResult?.snapshot), { a: 1, b: 0 });

  const bestOfThreeMatch = await timed("create best-of-3 next-game match", () =>
    createMatchFixture(bracketId, regs, nextMatchOrder++, { bestOf: 3 }),
  );
  const bestOfThreeMatchId = idOf(bestOfThreeMatch);
  const bestOfThreeOwned = await bootstrapAndClaim(
    bestOfThreeMatchId,
    deviceA,
    "best-of-3",
  );
  const bestBase = Number(bestOfThreeOwned.bootstrap?.serverVersion || 0);
  const firstGameEvents = [
    liveEvent("start", {}, bestBase),
    ...pointEvents("A", 11, bestBase),
  ];
  const firstGame = await syncEvents(
    bestOfThreeMatchId,
    deviceA,
    bestBase,
    firstGameEvents,
    "best-of-3: score first game",
  );
  assert.deepEqual(compactGameScores(firstGame?.snapshot), [{ a: 11, b: 0 }]);
  const nextGame = await timed("best-of-3: open next game", () =>
    api(
      "PATCH",
      `/api/referee/matches/${bestOfThreeMatchId}/score`,
      { op: "nextGame", autoNext: true },
      { headers: deviceA },
    ),
  );
  assert.equal(nextGame?.status, "live");
  assert.equal(nextGame?.currentGame, 1);
  assert.deepEqual(compactGameScores(nextGame), [
    { a: 11, b: 0 },
    { a: 0, b: 0 },
  ]);
  const secondGameEvents = pointEvents("A", 11, firstGame.serverVersion);
  const secondGame = await syncEvents(
    bestOfThreeMatchId,
    deviceA,
    firstGame.serverVersion,
    secondGameEvents,
    "best-of-3: score second game",
  );
  assert.deepEqual(compactGameScores(secondGame?.snapshot), [
    { a: 11, b: 0 },
    { a: 11, b: 0 },
  ]);
  const bestFinish = liveEvent(
    "finish",
    { winner: "A", reason: "finish" },
    secondGame.serverVersion,
  );
  const bestFinished = await syncEvents(
    bestOfThreeMatchId,
    deviceA,
    secondGame.serverVersion,
    [bestFinish],
    "best-of-3: finish after two games",
  );
  assert.equal(bestFinished?.snapshot?.status, "finished");
  assert.equal(bestFinished?.snapshot?.winner, "A");

  report.finishedAt = new Date().toISOString();
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const reportPath = path.join(ARTIFACT_DIR, `${runId}-referee-live-sync-report.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        tournamentId,
        bracketId,
        matchId,
        reportPath,
        steps: report.steps.map((step) => ({
          name: step.name,
          status: step.status,
          durationMs: step.durationMs,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    report.failedAt = new Date().toISOString();
    report.error = safeError(error);
    await fs.mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
    const reportPath = path.join(ARTIFACT_DIR, `${runId}-referee-live-sync-report.failed.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8").catch(() => {});
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
