#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import crypto from "crypto";

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "../backend/models/userModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const API = process.env.E2E_API_URL || "http://127.0.0.1:5001";
const WEB = process.env.E2E_WEB_URL || "http://localhost:3000";
const ADMIN = process.env.E2E_ADMIN_URL || "http://127.0.0.1:3001";
const ARTIFACT_DIR = path.join(ROOT, "tmp", "e2e-artifacts");

const runId = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto
  .randomBytes(3)
  .toString("hex")}`;
const generatedPassword = `CodexE2E-${runId}-Pass1`;
const providedAdminEmail = String(process.env.E2E_ADMIN_EMAIL || "").trim();
const providedAdminPassword = process.env.E2E_ADMIN_PASSWORD || "";
const useProvidedAdmin = Boolean(providedAdminEmail && providedAdminPassword);

const report = {
  runId,
  startedAt: new Date().toISOString(),
  services: [],
  apiSteps: [],
  uiSmoke: [],
  data: {},
  warnings: [],
  failures: [],
};

let adminToken = "";
let adminUserInfo = null;

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

async function timed(bucket, name, fn) {
  const started = Date.now();
  const row = { name, status: "running", startedAt: new Date().toISOString() };
  report[bucket].push(row);
  try {
    const result = await fn();
    row.status = "ok";
    row.durationMs = Date.now() - started;
    return result;
  } catch (error) {
    row.status = "failed";
    row.durationMs = Date.now() - started;
    row.error = safeError(error);
    report.failures.push({ bucket, name, ...row.error });
    throw error;
  }
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  return { res, text };
}

async function api(method, route, body, options = {}) {
  const headers = {
    accept: "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (options.auth !== false && adminToken) {
    headers.authorization = `Bearer ${adminToken}`;
  }

  const res = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
  });

  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const expected = options.expected || [200, 201];
  if (!expected.includes(res.status)) {
    const error = new Error(
      `${method} ${route} returned ${res.status}: ${
        typeof data === "string" ? data.slice(0, 300) : data?.message || "request failed"
      }`,
    );
    error.status = res.status;
    error.body = typeof data === "string" ? data : JSON.stringify(data);
    throw error;
  }

  return data;
}

async function connectDb() {
  const mongoUri = stripQuotes(process.env.MONGO_URI);
  if (!mongoUri) throw new Error("MONGO_URI is missing");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
}

function phoneFor(index) {
  const seed = Number(String(Date.now()).slice(-8));
  return `09${String(seed + index).padStart(8, "0").slice(-8)}`;
}

async function upsertTestUser({ index, role = "user", isSuperUser = false }) {
  const suffix = `${runId}-${index}`;
  const email = `codex.e2e.${role}.${suffix}@example.test`.toLowerCase();
  const nickname = role === "user" ? `codex_${runId.replace(/-/g, "_")}_${index}` : undefined;
  const hash = await bcrypt.hash(generatedPassword, 10);

  const doc = {
    name: `Codex E2E ${role} ${index}`,
    email,
    phone: phoneFor(index),
    password: hash,
    role,
    isSuperUser,
    verified: "verified",
    cccdStatus: "verified",
    province: "Ho Chi Minh",
    gender: "unspecified",
    phoneVerified: true,
    phoneVerifiedAt: new Date(),
    isDeleted: false,
    ...(nickname ? { nickname } : {}),
  };

  return User.findOneAndUpdate(
    { email },
    { $setOnInsert: doc },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ).lean();
}

async function setupAdminSession() {
  let preparedAdmin = null;
  let login;

  if (useProvidedAdmin) {
    login = await timed("apiSteps", "admin login with provided account", () =>
      api(
        "POST",
        "/api/admin/login",
        { email: providedAdminEmail, password: providedAdminPassword },
        { auth: false, expected: [200] },
      ),
    );
  } else {
    preparedAdmin = await timed("apiSteps", "prepare test admin", () =>
      upsertTestUser({ index: 0, role: "admin", isSuperUser: true }),
    );
    login = await timed("apiSteps", "admin login with generated account", () =>
      api(
        "POST",
        "/api/admin/login",
        { email: preparedAdmin.email, password: generatedPassword },
        { auth: false, expected: [200] },
      ),
    );
  }

  adminToken = login?.token || login?.user?.token;
  assert(adminToken, "Admin login did not return a token");

  const loginUser = login?.user || {};
  const fallbackRoles = loginUser.role ? [loginUser.role] : ["admin"];
  adminUserInfo = {
    ...loginUser,
    _id: String(loginUser?._id || preparedAdmin?._id || ""),
    name: loginUser?.name || preparedAdmin?.name || "Codex E2E Admin",
    email: loginUser?.email || preparedAdmin?.email || providedAdminEmail,
    role: loginUser?.role || preparedAdmin?.role || "admin",
    roles: Array.isArray(loginUser?.roles) ? loginUser.roles : fallbackRoles,
    isSuperUser: Boolean(loginUser?.isSuperUser || preparedAdmin?.isSuperUser),
    isSuperAdmin: Boolean(loginUser?.isSuperAdmin || loginUser?.isSuperUser || preparedAdmin?.isSuperUser),
    token: adminToken,
  };

  report.data.adminAuth = {
    mode: useProvidedAdmin ? "provided-account" : "generated-account",
    userId: adminUserInfo._id || null,
    role: adminUserInfo.role,
    roles: adminUserInfo.roles,
  };
}

async function preparePlayers({ startIndex, count }) {
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const index = startIndex + i;
    players.push(
      await timed("apiSteps", `prepare player ${index}`, () =>
        upsertTestUser({ index, role: "user" }),
      ),
    );
  }
  return players;
}

async function createTournament({
  label = "Singles",
  sequence = 1,
  eventType = "single",
  maxPairs = 4,
  hoursOffset = 48,
  isFreeRegistration = true,
  registrationFee = 0,
} = {}) {
  const baseName = `Codex E2E ${label} ${runId}`;
  const codeSeed = runId.replace(/[^0-9a-z]/gi, "").slice(-14).toUpperCase();
  return api("POST", "/api/admin/tournaments", {
    name: baseName,
    code: `E2E${codeSeed}${String(sequence).padStart(2, "0")}`.slice(0, 32),
    image: "https://placehold.co/1200x675/png",
    sportType: 1,
    groupId: 0,
    eventType,
    tournamentMode: "standard",
    nameDisplayMode: "nickname",
    regOpenDate: toLocalIsoNoMs(futureHours(-24)),
    registrationDeadline: toLocalIsoNoMs(futureHours(24)),
    startDate: toLocalIsoNoMs(futureHours(hoursOffset)),
    endDate: toLocalIsoNoMs(futureHours(hoursOffset + 24)),
    scoreCap: 0,
    scoreGap: 0,
    singleCap: 0,
    maxPairs,
    location: "Codex E2E Court",
    contactHtml: "",
    contentHtml: "",
    noRankDelta: true,
    allowExceedMaxRating: true,
    requireKyc: false,
    scoringScope: { type: "national" },
    bankShortName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    registrationFee,
    isFreeRegistration,
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

async function createRegistration(tournamentId, player, options = {}) {
  const body = {
    player1Id: String(player._id),
    paymentStatus: options.paymentStatus || "Paid",
    message: options.message || "codex e2e",
  };
  if (options.player2) body.player2Id = String(options.player2._id);
  return api("POST", `/api/admin/tournaments/${tournamentId}/registrations`, {
    ...body,
  });
}

async function finishMatch(matchId, winner, score) {
  return api("PATCH", `/api/admin/matches/${matchId}/score`, {
    gameScores: [score],
    status: "finished",
    winner,
    note: `codex e2e ${winner}`,
  });
}

function asArrayMatches(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  return [];
}

function idOf(value) {
  return String(value?._id || value?.id || value || "");
}

async function verifyTournamentReadEndpoints({
  label,
  tournamentId,
  bracketId,
  finalId,
  expectedRegistrations,
  searchPlayer,
}) {
  const adminRegs = await timed("apiSteps", `${label}: verify admin registrations`, () =>
    api("GET", `/api/admin/tournaments/${tournamentId}/registrations`),
  );
  assert(
    Array.isArray(adminRegs) && adminRegs.length === expectedRegistrations,
    `${label}: admin registrations count mismatch`,
  );
  assert(adminRegs.every((item) => item.checkinAt), `${label}: not all registrations are checked in`);
  assert(adminRegs.every((item) => item.payment?.status === "Paid"), `${label}: not all registrations are paid`);

  const adminBrackets = await timed("apiSteps", `${label}: verify admin brackets`, () =>
    api("GET", `/api/admin/tournaments/${tournamentId}/brackets`),
  );
  assert(
    Array.isArray(adminBrackets) && adminBrackets.some((item) => String(item._id) === bracketId),
    `${label}: admin bracket list does not include created bracket`,
  );

  const bracketStructure = await timed("apiSteps", `${label}: verify bracket structure`, () =>
    api("GET", `/api/admin/tournaments/${tournamentId}/brackets/structure`),
  );
  assert(
    Array.isArray(bracketStructure) || Array.isArray(bracketStructure?.brackets) || bracketStructure,
    `${label}: bracket structure response is empty`,
  );

  const adminMatches = await timed("apiSteps", `${label}: verify admin bracket matches`, () =>
    api("GET", `/api/admin/brackets/${bracketId}/matches`),
  );
  assert(Array.isArray(adminMatches) && adminMatches.length >= 3, `${label}: admin match list missing matches`);
  const finalAfter = adminMatches.find((item) => String(item._id) === String(finalId));
  assert(finalAfter?.status === "finished" && finalAfter?.winner === "A", `${label}: final is not finished`);
  assert(finalAfter?.finishedAt, `${label}: finished match is missing finishedAt`);

  const adminMatch = await timed("apiSteps", `${label}: verify admin match detail`, () =>
    api("GET", `/api/admin/matches/${finalId}`),
  );
  assert(String(adminMatch?._id || adminMatch?.id) === String(finalId), `${label}: admin match detail mismatch`);

  await timed("apiSteps", `${label}: verify match logs`, () =>
    api("GET", `/api/admin/matches/${finalId}/logs`),
  );
  await timed("apiSteps", `${label}: verify rating changes`, () =>
    api("GET", `/api/admin/matches/${finalId}/rating-changes`),
  );

  const publicTournament = await timed("apiSteps", `${label}: verify public tournament`, () =>
    api("GET", `/api/tournaments/${tournamentId}`, undefined, { auth: false, expected: [200] }),
  );
  assert(String(publicTournament?._id || publicTournament?.id) === tournamentId, `${label}: public tournament mismatch`);

  const publicList = await timed("apiSteps", `${label}: verify public tournament search`, () =>
    api("GET", `/api/tournaments?keyword=${encodeURIComponent("Codex E2E")}&limit=10`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(firstList(publicList).length > 0, `${label}: public tournament search returned no items`);

  const publicRegs = await timed("apiSteps", `${label}: verify public registrations`, () =>
    api("GET", `/api/tournaments/${tournamentId}/registrations`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(Array.isArray(publicRegs) && publicRegs.length >= expectedRegistrations, `${label}: public registrations missing`);

  const publicBrackets = await timed("apiSteps", `${label}: verify public brackets`, () =>
    api("GET", `/api/tournaments/${tournamentId}/brackets`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(Array.isArray(publicBrackets), `${label}: public brackets did not return an array`);

  const publicMatches = await timed("apiSteps", `${label}: verify public matches`, () =>
    api("GET", `/api/tournaments/${tournamentId}/matches?limit=20`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(asArrayMatches(publicMatches).length >= 3, `${label}: public matches missing created matches`);

  const publicScheduleMatches = await timed("apiSteps", `${label}: verify public schedule matches`, () =>
    api("GET", `/api/tournaments/${tournamentId}/matches?view=schedule&page=1&limit=20`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(asArrayMatches(publicScheduleMatches).length >= 3, `${label}: public schedule matches missing`);

  const publicBracketMatches = await timed("apiSteps", `${label}: verify public bracket matches`, () =>
    api("GET", `/api/tournaments/${tournamentId}/matches?view=bracket&page=1&limit=20`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(asArrayMatches(publicBracketMatches).length >= 3, `${label}: public bracket matches missing`);

  const publicMatch = await timed("apiSteps", `${label}: verify public match detail`, () =>
    api("GET", `/api/tournaments/matches/${finalId}`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(String(publicMatch?._id || publicMatch?.id) === String(finalId), `${label}: public match detail mismatch`);

  await timed("apiSteps", `${label}: verify check-in matches`, () =>
    api("GET", `/api/tournaments/${tournamentId}/checkin-matches`, undefined, {
      auth: false,
      expected: [200],
    }),
  );

  const q = searchPlayer?.phone || searchPlayer?.nickname || searchPlayer?.email;
  if (q) {
    const checkinSearch = await timed("apiSteps", `${label}: verify check-in search`, () =>
      api(
        "GET",
        `/api/tournaments/checkin/search?tournamentId=${tournamentId}&q=${encodeURIComponent(q)}`,
        undefined,
        { auth: false, expected: [200] },
      ),
    );
    assert(firstList(checkinSearch).length > 0, `${label}: check-in search returned no results`);
  }

  await timed("apiSteps", `${label}: verify bracket story snapshot`, () =>
    api("GET", `/api/admin/tournaments/${tournamentId}/bracket-story`),
  );
}

async function runKnockoutTournamentFlow({
  label,
  sequence,
  eventType,
  playerStartIndex,
  hoursOffset,
}) {
  const neededPlayers = eventType === "double" ? 8 : 4;
  const players = await preparePlayers({ startIndex: playerStartIndex, count: neededPlayers });

  const tournament = await timed("apiSteps", `${label}: create tournament`, () =>
    createTournament({
      label,
      sequence,
      eventType,
      maxPairs: 4,
      hoursOffset,
    }),
  );
  const tournamentId = String(tournament?._id || tournament?.id);
  assert(mongoose.isValidObjectId(tournamentId), "Tournament id is invalid");
  report.data[label] = {
    id: tournamentId,
    name: tournament.name,
    code: tournament.code,
    eventType,
  };

  const registrations = [];
  if (eventType === "double") {
    for (let i = 0; i < players.length; i += 2) {
      const reg = await timed("apiSteps", `${label}: create doubles registration ${registrations.length + 1}`, () =>
        createRegistration(tournamentId, players[i], {
          player2: players[i + 1],
          message: `codex e2e ${label} doubles`,
        }),
      );
      registrations.push(reg);
    }
  } else {
    for (const [idx, player] of players.entries()) {
      const reg = await timed("apiSteps", `${label}: create registration ${idx + 1}`, () =>
        createRegistration(tournamentId, player, { message: `codex e2e ${label} singles` }),
      );
      registrations.push(reg);
    }
  }

  for (const [idx, reg] of registrations.entries()) {
    await timed("apiSteps", `${label}: check in registration ${idx + 1}`, () =>
      api("PUT", `/api/admin/tournaments/registrations/${reg._id}/checkin`, {}),
    );
  }

  const bracket = await timed("apiSteps", `${label}: create knockout bracket`, () =>
    api("POST", `/api/admin/tournaments/${tournamentId}/brackets`, {
      name: `${label} Main KO`,
      type: "knockout",
      stage: 1,
      order: 0,
      drawRounds: 2,
      meta: { drawSize: 4 },
      config: {
        rules: {
          bestOf: 1,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
        seeding: { method: "random", ratingKey: "single", protectSameClub: false },
      },
      noRankDelta: true,
    }),
  );
  const bracketId = String(bracket?._id || bracket?.id);
  report.data[label].bracket = { id: bracketId, name: bracket.name, type: bracket.type };

  const rules = {
    bestOf: 1,
    pointsToWin: 11,
    winByTwo: true,
    cap: { mode: "none", points: null },
  };

  const semi1 = await timed("apiSteps", `${label}: create semifinal 1`, () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      pairA: registrations[0]._id,
      pairB: registrations[1]._id,
      round: 1,
      order: 0,
      rules,
    }),
  );
  const semi2 = await timed("apiSteps", `${label}: create semifinal 2`, () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      pairA: registrations[2]._id,
      pairB: registrations[3]._id,
      round: 1,
      order: 1,
      rules,
    }),
  );

  await timed("apiSteps", `${label}: finish semifinal 1`, () =>
    finishMatch(semi1._id, "A", { a: 11, b: 5 }),
  );
  await timed("apiSteps", `${label}: finish semifinal 2`, () =>
    finishMatch(semi2._id, "B", { a: 8, b: 11 }),
  );

  const final = await timed("apiSteps", `${label}: create final from semifinal winners`, () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      seedA: { type: "matchWinner", ref: { matchId: semi1._id } },
      seedB: { type: "matchWinner", ref: { matchId: semi2._id } },
      round: 2,
      order: 0,
      rules,
    }),
  );
  assert(final?.pairA && final?.pairB, `${label}: final did not resolve semifinal winners`);

  const finishedFinal = await timed("apiSteps", `${label}: finish final`, () =>
    finishMatch(final._id, "A", { a: 11, b: 9 }),
  );

  report.data[label].matches = {
    semifinal1: String(semi1._id),
    semifinal2: String(semi2._id),
    final: String(final._id),
    championRegistration: String(finishedFinal.pairA?._id || finishedFinal.pairA),
  };

  await verifyTournamentReadEndpoints({
    label,
    tournamentId,
    bracketId,
    finalId: String(final._id),
    expectedRegistrations: 4,
    searchPlayer: players[0],
  });

  return {
    label,
    tournamentId,
    bracketId,
    finalId: String(final._id),
    registrations,
    players,
  };
}

async function exerciseOverlayFlow(target) {
  const overlay = await timed("apiSteps", "overlay: update tournament overlay", () =>
    api("PATCH", `/api/admin/tournaments/${target.tournamentId}/overlay`, {
      theme: "light",
      accentA: "#1D4ED8",
      accentB: "#F59E0B",
      corner: "tr",
      rounded: 10,
      shadow: false,
      showSets: true,
      nameScale: 1.05,
      scoreScale: 1.1,
      customCss: "",
      logoUrl: "https://placehold.co/256x256/png",
    }),
  );
  assert(overlay?.ok && overlay?.overlay?.theme === "light", "Overlay update did not persist");

  const tournament = await timed("apiSteps", "overlay: verify tournament overlay", () =>
    api("GET", `/api/admin/tournaments/${target.tournamentId}`),
  );
  assert(tournament?.overlay?.corner === "tr", "Overlay corner did not persist on tournament");
}

async function exerciseRegistrationCrudFlow() {
  const [player] = await preparePlayers({ startIndex: 50, count: 1 });
  const tournament = await timed("apiSteps", "registration crud: create tournament", () =>
    createTournament({
      label: "Registration CRUD",
      sequence: 3,
      eventType: "single",
      maxPairs: 2,
      hoursOffset: 120,
      isFreeRegistration: false,
      registrationFee: 10000,
    }),
  );
  const tournamentId = idOf(tournament);
  report.data.registrationCrud = { tournamentId };

  const reg = await timed("apiSteps", "registration crud: create unpaid registration", () =>
    createRegistration(tournamentId, player, {
      paymentStatus: "Unpaid",
      message: "codex e2e registration crud",
    }),
  );
  assert(reg?.payment?.status === "Unpaid", "Registration CRUD create did not keep Unpaid status");

  const updated = await timed("apiSteps", "registration crud: patch registration", () =>
    api("PATCH", `/api/admin/tournaments/registrations/${reg._id}`, {
      player1Id: String(player._id),
      message: "codex e2e registration crud updated",
      paymentStatus: "Paid",
    }),
  );
  assert(updated?.message === "codex e2e registration crud updated", "Registration message did not update");
  assert(updated?.payment?.status === "Paid", "Registration paymentStatus patch did not update");

  const unpaid = await timed("apiSteps", "registration crud: mark unpaid", () =>
    api("PUT", `/api/admin/tournaments/registrations/${reg._id}/payment`, {
      status: "Unpaid",
    }),
  );
  assert(unpaid?.payment?.status === "Unpaid", "Registration payment PUT Unpaid failed");

  const paid = await timed("apiSteps", "registration crud: mark paid", () =>
    api("PUT", `/api/admin/tournaments/registrations/${reg._id}/payment`, {
      status: "Paid",
    }),
  );
  assert(paid?.payment?.status === "Paid", "Registration payment PUT Paid failed");

  const history = await timed("apiSteps", "registration crud: verify history", () =>
    api("GET", `/api/admin/tournaments/registrations/${reg._id}/history?page=1&limit=20`),
  );
  assert(Array.isArray(history?.items) && history.items.length >= 2, "Registration history did not include audit rows");

  await timed("apiSteps", "registration crud: delete registration", () =>
    api("DELETE", `/api/admin/tournaments/registrations/${reg._id}`),
  );
  const regsAfterDelete = await timed("apiSteps", "registration crud: verify delete", () =>
    api("GET", `/api/admin/tournaments/${tournamentId}/registrations`),
  );
  assert(
    Array.isArray(regsAfterDelete) && !regsAfterDelete.some((item) => String(item._id) === String(reg._id)),
    "Deleted registration is still returned",
  );
}

async function exerciseMatchCrudFlow() {
  const players = await preparePlayers({ startIndex: 60, count: 2 });
  const tournament = await timed("apiSteps", "match crud: create tournament", () =>
    createTournament({
      label: "Match CRUD",
      sequence: 4,
      eventType: "single",
      maxPairs: 2,
      hoursOffset: 144,
    }),
  );
  const tournamentId = idOf(tournament);
  const regs = [];
  for (const [idx, player] of players.entries()) {
    regs.push(
      await timed("apiSteps", `match crud: create registration ${idx + 1}`, () =>
        createRegistration(tournamentId, player, { message: "codex e2e match crud" }),
      ),
    );
  }
  const bracket = await timed("apiSteps", "match crud: create bracket", () =>
    api("POST", `/api/admin/tournaments/${tournamentId}/brackets`, {
      name: "Match CRUD KO",
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
  const match = await timed("apiSteps", "match crud: create match", () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      pairA: regs[0]._id,
      pairB: regs[1]._id,
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
  report.data.matchCrud = { tournamentId, bracketId, matchId };

  const patched = await timed("apiSteps", "match crud: patch live/video/rules", () =>
    api("PATCH", `/api/admin/matches/${matchId}`, {
      status: "live",
      video: "https://example.test/codex-e2e.mp4",
      rules: {
        bestOf: 1,
        pointsToWin: 15,
        winByTwo: false,
        cap: { mode: "hard", points: 21 },
      },
    }),
  );
  assert(patched?.status === "live", "Match status did not update to live");
  assert(patched?.rules?.pointsToWin === 15, "Match rules did not update");

  const finished = await timed("apiSteps", "match crud: finish via score endpoint", () =>
    finishMatch(matchId, "B", { a: 12, b: 15 }),
  );
  assert(finished?.status === "finished" && finished?.winner === "B", "Match score endpoint did not finish match");
  assert(finished?.finishedAt, "Match score endpoint did not set finishedAt");

  await timed("apiSteps", "match crud: reset scores", () =>
    api("POST", `/api/admin/matches/${matchId}/reset-scores`),
  );
  const resetMatch = await timed("apiSteps", "match crud: verify reset scores", () =>
    api("GET", `/api/admin/matches/${matchId}`),
  );
  assert(Array.isArray(resetMatch?.gameScores) && resetMatch.gameScores.length === 0, "Reset scores did not clear games");

  await timed("apiSteps", "match crud: delete match", () =>
    api("DELETE", `/api/admin/matches/${matchId}`),
  );
  await timed("apiSteps", "match crud: verify match deleted", () =>
    api("GET", `/api/admin/matches/${matchId}`, undefined, { expected: [404] }),
  );

  await timed("apiSteps", "match crud: delete bracket cascade", () =>
    api("DELETE", `/api/admin/tournaments/${tournamentId}/brackets/${bracketId}`),
  );
}

async function runApiFlow() {
  await setupAdminSession();
  const singles = await runKnockoutTournamentFlow({
    label: "singles",
    sequence: 1,
    eventType: "single",
    playerStartIndex: 1,
    hoursOffset: 48,
  });
  const doubles = await runKnockoutTournamentFlow({
    label: "doubles",
    sequence: 2,
    eventType: "double",
    playerStartIndex: 10,
    hoursOffset: 72,
  });
  await exerciseOverlayFlow(singles);
  await exerciseRegistrationCrudFlow();
  await exerciseMatchCrudFlow();

  report.data.tournament = report.data.singles;
  report.data.tournaments = {
    singles: report.data.singles,
    doubles: report.data.doubles,
  };

  return { tournamentId: singles.tournamentId, bracketId: singles.bracketId, finalId: singles.finalId, doubles };
}

async function smokeWithPuppeteer({ tournamentId, bracketId, finalId, doubles }) {
  let puppeteer;
  try {
    puppeteer = await import("puppeteer");
  } catch (error) {
    report.warnings.push({
      name: "puppeteer unavailable",
      message: error?.message || String(error),
    });
    return;
  }

  let browser;
  try {
    browser = await puppeteer.default.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: 1366, height: 900 },
    });
  } catch (error) {
    report.warnings.push({
      name: "puppeteer launch failed",
      message: error?.message || String(error),
    });
    return;
  }

  const pages = [
    { label: "web home desktop", url: `${WEB}/`, viewport: { width: 1366, height: 900 } },
    {
      label: "web tournaments list desktop",
      url: `${WEB}/pickle-ball/tournaments`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web tournament overview desktop",
      url: `${WEB}/tournament/${tournamentId}`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web tournament overview mobile",
      url: `${WEB}/tournament/${tournamentId}`,
      viewport: { width: 390, height: 844, isMobile: true },
    },
    {
      label: "web tournament register",
      url: `${WEB}/tournament/${tournamentId}/register`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web tournament checkin",
      url: `${WEB}/tournament/${tournamentId}/checkin`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web bracket desktop",
      url: `${WEB}/tournament/${tournamentId}/bracket`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web bracket mobile",
      url: `${WEB}/tournament/${tournamentId}/bracket`,
      viewport: { width: 390, height: 844, isMobile: true },
    },
    {
      label: "web schedule desktop",
      url: `${WEB}/tournament/${tournamentId}/schedule`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "web draw live desktop",
      url: `${WEB}/tournament/${tournamentId}/draw/live`,
      viewport: { width: 1366, height: 900 },
      waitUntil: "domcontentloaded",
    },
    {
      label: "web overlay score",
      url: `${WEB}/overlay/score?matchId=${finalId}`,
      viewport: { width: 1280, height: 720 },
    },
    {
      label: "web doubles bracket desktop",
      url: `${WEB}/tournament/${doubles?.tournamentId}/bracket`,
      viewport: { width: 1366, height: 900 },
    },
    {
      label: "admin dashboard",
      url: `${ADMIN}/dashboard`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournaments list",
      url: `${ADMIN}/admin/tournaments`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournament registrations",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/registrations`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournament brackets",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/brackets`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournament matches",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/matches`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournament bracket",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/bracket`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin tournament edit",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/edit`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin bracket story",
      url: `${ADMIN}/admin/tournaments/${tournamentId}/bracket-story`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin match detail",
      url: `${ADMIN}/admin/matches/${finalId}`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
    {
      label: "admin doubles tournament bracket",
      url: `${ADMIN}/admin/tournaments/${doubles?.tournamentId}/bracket`,
      viewport: { width: 1440, height: 900 },
      admin: true,
    },
  ];

  try {
    for (const spec of pages) {
      const row = {
        label: spec.label,
        url: spec.url,
        status: "running",
        errors: [],
        failedRequests: [],
      };
      report.uiSmoke.push(row);

      const page = await browser.newPage();
      await page.setViewport(spec.viewport);
      if ((spec.admin || spec.auth) && adminUserInfo) {
        await page.evaluateOnNewDocument((info) => {
          window.localStorage.setItem("userInfo", JSON.stringify(info));
        }, adminUserInfo);
      }

      page.on("pageerror", (error) => {
        row.errors.push(`pageerror: ${error?.message || String(error)}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          const text = message.text();
          if (
            !/favicon|Download the React DevTools|^Warning:|Failed to load resource|Manifest fetch|google-analytics|MUI X: Missing license key/i.test(
              text,
            )
          ) {
            row.errors.push(`console: ${text}`.slice(0, 1000));
          }
        }
      });
      page.on("requestfailed", (request) => {
        const failure = request.failure();
        const url = request.url();
        if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url) && !/favicon|sockjs-node|hot-update/i.test(url)) {
          row.failedRequests.push(`${request.method()} ${url} ${failure?.errorText || ""}`.slice(0, 1000));
        }
      });
      page.on("response", (response) => {
        const status = response.status();
        if (status >= 500 && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(response.url())) {
          row.failedRequests.push(`${status} ${response.url()}`.slice(0, 1000));
        }
      });

      try {
        const mainResponse = await page.goto(spec.url, {
          waitUntil: spec.waitUntil || "networkidle2",
          timeout: spec.timeoutMs || 45000,
        });
        if (mainResponse?.status() >= 400) {
          row.errors.push(`main document status: ${mainResponse.status()}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const bodyText = await page.evaluate(() => document.body?.innerText || "");
        row.title = await page.title();
        row.bodySample = bodyText.replace(/\s+/g, " ").trim().slice(0, 300);
        if (/Unexpected Application Error|ReferenceError|TypeError/i.test(bodyText)) {
          row.errors.push(`visible error text: ${row.bodySample}`);
        }
        if (!spec.admin && /kh.ng c. quy.n truy c.p/i.test(bodyText)) {
          row.errors.push(`visible permission denial: ${row.bodySample}`);
        }
        const slug = spec.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const screenshot = path.join(ARTIFACT_DIR, `${runId}-${slug}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        row.screenshot = path.relative(ROOT, screenshot);
      } catch (error) {
        row.errors.push(error?.message || String(error));
      } finally {
        row.status = row.errors.length || row.failedRequests.length ? "failed" : "ok";
        if (row.status === "failed") {
          report.failures.push({
            bucket: "uiSmoke",
            name: spec.label,
            message: [...row.errors, ...row.failedRequests].join(" | ").slice(0, 2000),
          });
        }
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  await timed("services", "api health", async () => {
    const { res, text } = await fetchText(`${API}/`);
    assert(res.ok && /API is running/i.test(text), "API health check failed");
    return text;
  });
  await timed("services", "web health", async () => {
    const { res, text } = await fetchText(`${WEB}/`);
    assert(res.status < 500, `Web app returned ${res.status}`);
    if (!res.ok || !/<html|<!doctype/i.test(text)) {
      report.warnings.push({
        name: "web health non-html",
        message: `Web health returned ${res.status}; UI smoke will verify concrete routes.`,
      });
    }
    return text;
  });
  await timed("services", "admin health", async () => {
    const { res, text } = await fetchText(`${ADMIN}/`);
    assert(res.status < 500, `Admin app returned ${res.status}`);
    if (!res.ok || !/<html|<!doctype/i.test(text)) {
      report.warnings.push({
        name: "admin health non-html",
        message: `Admin health returned ${res.status}; UI smoke will verify concrete routes.`,
      });
    }
    return text;
  });

  await timed("apiSteps", "connect mongodb", connectDb);
  const ids = await runApiFlow();
  await smokeWithPuppeteer(ids);
}

try {
  await run();
} catch (error) {
  process.exitCode = 1;
  console.error(`[e2e] failed: ${error?.message || error}`);
} finally {
  report.finishedAt = new Date().toISOString();
  report.ok = report.failures.length === 0;
  const reportPath = path.join(ARTIFACT_DIR, `${runId}-report.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mongoose.disconnect().catch(() => {});

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        runId: report.runId,
        tournamentId: report.data.tournament?.id || null,
        failures: report.failures.length,
        warnings: report.warnings.length,
        report: path.relative(ROOT, reportPath),
      },
      null,
      2,
    ),
  );
}
