#!/usr/bin/env node
import fs from "fs/promises";
import os from "os";
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
const ARTIFACT_DIR =
  process.env.E2E_ARTIFACT_DIR || path.join(os.tmpdir(), "mern-auth-e2e-artifacts");

const runId = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto
  .randomBytes(3)
  .toString("hex")}`;
const generatedPassword = `CodexHumanE2E-${runId}-Pass1`;
const drawSeed = Number(runId.replace(/\D/g, "").slice(-9));
const providedAdminEmail = String(process.env.E2E_ADMIN_EMAIL || "").trim();
const providedAdminPassword = process.env.E2E_ADMIN_PASSWORD || "";

const report = {
  runId,
  startedAt: new Date().toISOString(),
  services: [],
  uiActions: [],
  apiSteps: [],
  uiChecks: [],
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function idOf(value) {
  return String(value?._id || value?.id || value || "");
}

function asArrayMatches(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function phoneFor(index) {
  const digest = crypto
    .createHash("sha1")
    .update(`${runId}:${index}`)
    .digest("hex")
    .slice(0, 8);
  return `09${String(parseInt(digest, 16)).slice(-8).padStart(8, "0")}`;
}

async function timed(bucket, name, fn) {
  const started = Date.now();
  const row = { name, status: "running", startedAt: new Date().toISOString() };
  report[bucket].push(row);
  try {
    const result = await fn(row);
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
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (options.auth !== false && adminToken) headers.authorization = `Bearer ${adminToken}`;

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

async function upsertTestUser(index) {
  const email = `codex.human.e2e.${runId}.${index}@example.test`.toLowerCase();
  const hash = await bcrypt.hash(generatedPassword, 10);
  return User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        name: `Codex Human Player ${index}`,
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
        nickname: `human_${runId.replace(/-/g, "_")}_${index}`,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
}

async function preparePlayers(count) {
  const players = [];
  for (let i = 1; i <= count; i += 1) {
    players.push(await timed("apiSteps", `prepare player ${i}`, () => upsertTestUser(i)));
  }
  return players;
}

async function createTournament() {
  const codeSeed = runId.replace(/[^0-9a-z]/gi, "").slice(-14).toUpperCase();
  return api("POST", "/api/admin/tournaments", {
    name: `Codex Human Draw ${runId}`,
    code: `HUM${codeSeed}`.slice(0, 32),
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
    maxPairs: 4,
    location: "Codex Human Court",
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
    message: `human e2e registration ${index}`,
  });
}

async function finishMatch(matchId, winner, score, note) {
  return api("PATCH", `/api/admin/matches/${matchId}/score`, {
    gameScores: [score],
    status: "finished",
    winner,
    note,
  });
}

async function loginThroughAdminUi(page) {
  assert(providedAdminEmail && providedAdminPassword, "E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required");
  await page.goto(`${ADMIN}/authentication/sign-in`, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.click('input[type="email"]');
  await page.keyboard.type(providedAdminEmail, { delay: 15 });
  await page.click('input[type="password"]');
  await page.keyboard.type(providedAdminPassword, { delay: 15 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem("userInfo");
      if (!raw) return false;
      try {
        return Boolean(JSON.parse(raw)?.token);
      } catch {
        return false;
      }
    },
    { timeout: 30000 },
  );
  await page.waitForFunction(() => !location.pathname.includes("/authentication/sign-in"), {
    timeout: 30000,
  });
  const info = await page.evaluate(() => JSON.parse(window.localStorage.getItem("userInfo") || "null"));
  adminUserInfo = info;
  adminToken = info?.token || "";
  assert(adminToken, "Admin UI login did not persist a token");
  return info;
}

async function capturePage(browser, spec) {
  const row = {
    label: spec.label,
    url: spec.url,
    status: "running",
    errors: [],
    failedRequests: [],
  };
  report.uiChecks.push(row);

  const page = await browser.newPage();
  await page.setViewport(spec.viewport || { width: 1440, height: 900 });
  if (spec.admin && adminUserInfo) {
    await page.evaluateOnNewDocument((info) => {
      window.localStorage.setItem("userInfo", JSON.stringify(info));
    }, adminUserInfo);
  }

  page.on("pageerror", (error) => {
    row.errors.push(`pageerror: ${error?.message || String(error)}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      /favicon|Download the React DevTools|^Warning:|Failed to load resource|Manifest fetch|google-analytics|MUI X: Missing license key|ERR_BLOCKED_BY_CLIENT/i.test(
        text,
      )
    ) {
      return;
    }
    row.errors.push(`console: ${text}`.slice(0, 1000));
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure();
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
    if (mainResponse?.status() >= 400) row.errors.push(`main document status: ${mainResponse.status()}`);
    await new Promise((resolve) => setTimeout(resolve, spec.settleMs || 1500));
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    row.title = await page.title();
    row.bodySample = bodyText.replace(/\s+/g, " ").trim().slice(0, 400);
    if (/Unexpected Application Error|ReferenceError|TypeError|Cannot read properties/i.test(bodyText)) {
      row.errors.push(`visible error text: ${row.bodySample}`);
    }
    if (/khong co quyen|không có quyền|access denied|forbidden/i.test(bodyText)) {
      row.errors.push(`visible permission denial: ${row.bodySample}`);
    }
    if (spec.expectText) {
      const expectations = Array.isArray(spec.expectText) ? spec.expectText : [spec.expectText];
      for (const expected of expectations) {
        if (!bodyText.toLowerCase().includes(String(expected).toLowerCase())) {
          row.errors.push(`missing expected text: ${expected}`);
        }
      }
    }
    const slug = spec.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const screenshot = path.join(ARTIFACT_DIR, `${runId}-human-${slug}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    row.screenshot = path.relative(ROOT, screenshot);
  } catch (error) {
    row.errors.push(error?.message || String(error));
  } finally {
    row.status = row.errors.length || row.failedRequests.length ? "failed" : "ok";
    if (row.status === "failed") {
      report.failures.push({
        bucket: "uiChecks",
        name: spec.label,
        message: [...row.errors, ...row.failedRequests].join(" | ").slice(0, 2000),
      });
    }
    await page.close().catch(() => {});
  }
}

async function runDrawFlow(browser) {
  const players = await preparePlayers(4);

  const tournament = await timed("apiSteps", "create tournament", createTournament);
  const tournamentId = idOf(tournament);
  assert(mongoose.isValidObjectId(tournamentId), "Tournament id is invalid");

  const registrations = [];
  for (const [idx, player] of players.entries()) {
    const reg = await timed("apiSteps", `create paid registration ${idx + 1}`, () =>
      createRegistration(tournamentId, player, idx + 1),
    );
    registrations.push(reg);
  }

  for (const [idx, reg] of registrations.entries()) {
    await timed("apiSteps", `check in registration ${idx + 1}`, () =>
      api("PUT", `/api/admin/tournaments/registrations/${idOf(reg)}/checkin`, {}),
    );
  }

  const bracket = await timed("apiSteps", "create empty knockout bracket", () =>
    api("POST", `/api/admin/tournaments/${tournamentId}/brackets`, {
      name: "Human Draw Main KO",
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
  const bracketId = idOf(bracket);

  report.data.tournament = {
    id: tournamentId,
    name: tournament.name,
    code: tournament.code,
    bracketId,
    registrations: registrations.map((reg) => idOf(reg)),
  };

  await capturePage(browser, {
    label: "admin bracket before draw",
    url: `${ADMIN}/admin/tournaments/${tournamentId}/brackets`,
    admin: true,
    expectText: "Human Draw Main KO",
  });

  await capturePage(browser, {
    label: "public draw live idle",
    url: `${WEB}/tournament/${tournamentId}/draw/live`,
    viewport: { width: 1366, height: 900 },
    waitUntil: "domcontentloaded",
  });

  const drawStart = await timed("apiSteps", "start knockout draw session", () =>
    api("POST", `/api/draw/${bracketId}/start`, {
      mode: "knockout",
      round: "SF",
      seed: drawSeed,
      settings: {},
    }),
  );
  const drawId = String(drawStart?.drawId || "");
  assert(mongoose.isValidObjectId(drawId), "Draw session id is invalid");
  report.data.tournament.drawId = drawId;

  await capturePage(browser, {
    label: "public draw live running",
    url: `${WEB}/tournament/${tournamentId}/draw/live`,
    viewport: { width: 1366, height: 900 },
    waitUntil: "domcontentloaded",
  });

  const reveals = [];
  for (let i = 0; i < registrations.length; i += 1) {
    const picked = await timed("apiSteps", `draw next entrant ${i + 1}`, () =>
      api("POST", `/api/draw/${drawId}/next`, { socketId: "" }),
    );
    assert(picked?.next?.regId, `Draw reveal ${i + 1} did not return a registration`);
    reveals.push({
      regId: String(picked.next.regId),
      name: picked.next.name || null,
      pairIndex: picked.next.pairIndex,
      side: picked.next.side,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  report.data.tournament.reveals = reveals;

  await capturePage(browser, {
    label: "public draw live all revealed",
    url: `${WEB}/tournament/${tournamentId}/draw/live`,
    viewport: { width: 1366, height: 900 },
    waitUntil: "domcontentloaded",
  });

  const committed = await timed("apiSteps", "commit draw into semifinal matches", () =>
    api("POST", `/api/draw/${drawId}/commit`, { socketId: "" }),
  );
  assert(committed?.ok, "Draw commit did not return ok");
  report.data.tournament.drawCommit = {
    created: committed.created,
    status: committed.session?.status,
  };

  let matches = await timed("apiSteps", "load matches after draw commit", () =>
    api("GET", `/api/admin/brackets/${bracketId}/matches`),
  );
  matches = asArrayMatches(matches).sort((a, b) => (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0));
  const semis = matches.filter((match) => Number(match.round) === 1);
  assert(semis.length === 2, `Expected 2 semifinals after draw commit, got ${semis.length}`);
  assert(semis.every((match) => match.pairA && match.pairB), "A semifinal is missing a player");

  await capturePage(browser, {
    label: "admin bracket after draw commit",
    url: `${ADMIN}/admin/tournaments/${tournamentId}/brackets`,
    admin: true,
    expectText: ["Human Draw Main KO", "Trận"],
  });

  await timed("apiSteps", "finish semifinal 1 by score", () =>
    finishMatch(idOf(semis[0]), "A", { a: 11, b: 6 }, "human e2e semifinal 1"),
  );
  await timed("apiSteps", "finish semifinal 2 by score", () =>
    finishMatch(idOf(semis[1]), "B", { a: 9, b: 11 }, "human e2e semifinal 2"),
  );

  const rules = {
    bestOf: 1,
    pointsToWin: 11,
    winByTwo: true,
    cap: { mode: "none", points: null },
  };
  const final = await timed("apiSteps", "create final from semifinal winners", () =>
    api("POST", `/api/admin/brackets/${bracketId}/matches`, {
      seedA: { type: "matchWinner", ref: { matchId: idOf(semis[0]) } },
      seedB: { type: "matchWinner", ref: { matchId: idOf(semis[1]) } },
      round: 2,
      order: 0,
      rules,
    }),
  );
  assert(final?.pairA && final?.pairB, "Final did not resolve semifinal winners");

  const finalId = idOf(final);
  const finishedFinal = await timed("apiSteps", "finish final by score", () =>
    finishMatch(finalId, "A", { a: 11, b: 8 }, "human e2e final"),
  );
  assert(finishedFinal?.status === "finished", "Final is not finished");
  assert(finishedFinal?.winner === "A", "Final winner mismatch");
  assert(finishedFinal?.finishedAt, "Final finishedAt missing");

  report.data.tournament.matches = {
    semifinal1: idOf(semis[0]),
    semifinal2: idOf(semis[1]),
    final: finalId,
    championRegistration: idOf(finishedFinal.pairA?._id || finishedFinal.pairA),
  };

  const publicMatches = await timed("apiSteps", "verify public tournament matches", () =>
    api("GET", `/api/tournaments/${tournamentId}/matches?limit=20`, undefined, {
      auth: false,
      expected: [200],
    }),
  );
  assert(asArrayMatches(publicMatches).length >= 3, "Public match list is missing played matches");

  await timed("apiSteps", "verify admin final detail", () => api("GET", `/api/admin/matches/${finalId}`));
  await timed("apiSteps", "verify final score logs", () => api("GET", `/api/admin/matches/${finalId}/logs`));
  await timed("apiSteps", "verify final rating changes", () =>
    api("GET", `/api/admin/matches/${finalId}/rating-changes`),
  );

  await capturePage(browser, {
    label: "admin matches after played",
    url: `${ADMIN}/admin/tournaments/${tournamentId}/matches`,
    admin: true,
  });
  await capturePage(browser, {
    label: "admin final detail",
    url: `${ADMIN}/admin/matches/${finalId}`,
    admin: true,
    expectText: "11",
  });
  await capturePage(browser, {
    label: "public bracket desktop after played",
    url: `${WEB}/tournament/${tournamentId}/bracket`,
    viewport: { width: 1366, height: 900 },
    expectText: "11",
  });
  await capturePage(browser, {
    label: "public bracket mobile after played",
    url: `${WEB}/tournament/${tournamentId}/bracket`,
    viewport: { width: 390, height: 844, isMobile: true },
    expectText: "11",
  });
  await capturePage(browser, {
    label: "public schedule after played",
    url: `${WEB}/tournament/${tournamentId}/schedule`,
    viewport: { width: 1366, height: 900 },
  });
  await capturePage(browser, {
    label: "public overview after played",
    url: `${WEB}/tournament/${tournamentId}`,
    viewport: { width: 1366, height: 900 },
    expectText: tournament.name,
  });
}

async function run() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  await timed("services", "api health", async () => {
    const { res, text } = await fetchText(`${API}/`);
    assert(res.ok && /API is running/i.test(text), "API health check failed");
  });
  await timed("services", "web health", async () => {
    const { res, text } = await fetchText(`${WEB}/`);
    assert(res.status < 500, `Web app returned ${res.status}`);
    if (!res.ok || !/<html|<!doctype/i.test(text)) {
      report.warnings.push({
        name: "web health non-html",
        message: `Web health returned ${res.status}; concrete UI pages will be checked.`,
      });
    }
  });
  await timed("services", "admin health", async () => {
    const { res, text } = await fetchText(`${ADMIN}/`);
    assert(res.status < 500, `Admin app returned ${res.status}`);
    if (!res.ok || !/<html|<!doctype/i.test(text)) {
      report.warnings.push({
        name: "admin health non-html",
        message: `Admin health returned ${res.status}; concrete UI pages will be checked.`,
      });
    }
  });

  await timed("apiSteps", "connect mongodb", connectDb);

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const loginPage = await browser.newPage();
    loginPage.on("pageerror", (error) => {
      report.failures.push({
        bucket: "uiActions",
        name: "admin ui login",
        message: error?.message || String(error),
      });
    });
    await timed("uiActions", "admin ui login", async (row) => {
      const info = await loginThroughAdminUi(loginPage);
      row.userId = idOf(info);
      row.role = info?.role || null;
      const screenshot = path.join(ARTIFACT_DIR, `${runId}-human-admin-login.png`);
      await loginPage.screenshot({ path: screenshot, fullPage: true });
      row.screenshot = path.relative(ROOT, screenshot);
    });
    await loginPage.close().catch(() => {});

    await runDrawFlow(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  await run();
} catch (error) {
  process.exitCode = 1;
  console.error(`[human-e2e] failed: ${error?.message || error}`);
} finally {
  report.finishedAt = new Date().toISOString();
  report.ok = report.failures.length === 0;
  const reportPath = path.join(ARTIFACT_DIR, `${runId}-human-report.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mongoose.disconnect().catch(() => {});
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        runId: report.runId,
        tournamentId: report.data.tournament?.id || null,
        tournamentName: report.data.tournament?.name || null,
        bracketId: report.data.tournament?.bracketId || null,
        drawId: report.data.tournament?.drawId || null,
        finalId: report.data.tournament?.matches?.final || null,
        failures: report.failures.length,
        warnings: report.warnings.length,
        report: path.relative(ROOT, reportPath),
      },
      null,
      2,
    ),
  );
}
