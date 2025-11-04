// controllers/fbTokenController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import FbToken from "../models/fbTokenModel.js";
import {
  debugAnyToken,
  testPageReadable,
  testPageLiveCapable,
  NOW_UTC,
  pickUsefulDebug,
} from "../services/fbGraph.js";

const isId = (s) => mongoose.Types.ObjectId.isValid(String(s));

const REQUIRED_PAGE_SCOPES = [
  "pages_read_engagement",
  "pages_manage_posts", // tạo live video yêu cầu quyền tạo nội dung (manage_posts) + read_engagement
];

function buildStatus({ dbgUser, dbgPage, canRead, canLive, doc }) {
  const problems = [];
  const hints = [];

  // user token
  if (doc.longUserToken) {
    if (!dbgUser?.is_valid) problems.push("USER_TOKEN_INVALID");
    else if (dbgUser?.expires_at && dbgUser.expires_at * 1000 < Date.now())
      problems.push("USER_TOKEN_EXPIRED");
  }

  // page token
  if (!doc.pageToken) problems.push("PAGE_TOKEN_MISSING");
  else if (!dbgPage?.is_valid) problems.push("PAGE_TOKEN_INVALID");

  // scopes
  const scopes = new Set(dbgPage?.scopes || dbgUser?.scopes || []);
  const missingScopes = REQUIRED_PAGE_SCOPES.filter((s) => !scopes.has(s));
  if (missingScopes.length) {
    problems.push("MISSING_SCOPES:" + missingScopes.join(","));
    hints.push("Thiếu quyền: " + missingScopes.join(", "));
  }

  // permissions tests
  if (doc.pageToken) {
    if (!canRead.ok) problems.push(canRead.reason || "PAGE_READ_DENIED");
    if (!canLive.ok) problems.push(canLive.reason || "LIVE_NOT_ALLOWED");
  }

  // checkpoint / revoked heuristics
  const sub = dbgUser?.error_subcode || dbgPage?.error_subcode;
  if (sub === 490 || sub === 459) problems.push("CHECKPOINT");

  let code = "OK";
  if (problems.length) {
    if (problems.includes("CHECKPOINT")) code = "CHECKPOINT";
    else if (problems.some((p) => p.includes("EXPIRED"))) code = "EXPIRED";
    else if (problems.some((p) => p.includes("INVALID"))) code = "INVALID";
    else if (problems.some((p) => p.startsWith("MISSING_SCOPES")))
      code = "MISSING_SCOPES";
    else code = "ISSUE";
  }
  if (doc.needsReauth) code = "NEEDS_REAUTH";
  if (doc.isBusy) hints.push(`Đang bận (live:${doc.busyLiveVideoId || "-"})`);

  return { code, problems, hints, missingScopes };
}

/**
 * GET /api/fb-tokens
 * Query: q, status, busy
 * Trả về rows với computed:
 *  - code: ưu tiên cảnh báo tức thời; nếu không có thì lấy kết quả check gần nhất (lastStatusCode) nếu đã có.
 *  - hasNever: dựa vào pageTokenIsNever
 */
export const listFbTokens = asyncHandler(async (req, res) => {
  const { q = "", status = "", busy = "" } = req.query || {};
  const cond = {};
  if (q) {
    cond.$or = [
      { pageId: new RegExp(q.trim(), "i") },
      { pageName: new RegExp(q.trim(), "i") },
      { category: new RegExp(q.trim(), "i") },
    ];
  }
  if (busy === "1") cond.isBusy = true;
  if (busy === "0") cond.isBusy = false;

  const docs = await FbToken.find(cond).sort({ updatedAt: -1 }).lean();

  const rows = docs
    .map((d) => {
      const now = Date.now();
      const userExpired =
        d.longUserExpiresAt && d.longUserExpiresAt.getTime() < now;
      const pageExpired =
        d.pageTokenExpiresAt && d.pageTokenExpiresAt.getTime() < now;

      // mức độ cảnh báo tức thời (không gọi remote)
      let dynamic = "UNKNOWN";
      if (d.needsReauth) dynamic = "NEEDS_REAUTH";
      else if (!d.pageToken) dynamic = "MISSING_PAGE_TOKEN";
      else if (pageExpired) dynamic = "EXPIRED";
      else if (userExpired) dynamic = "USER_EXPIRED";

      // Nếu chưa có cảnh báo tức thời → dùng kết quả check gần nhất
      const code =
        dynamic !== "UNKNOWN" ? dynamic : d.lastStatusCode || "UNKNOWN";

      return {
        ...d,
        computed: {
          code,
          hasNever: d.pageTokenIsNever === true,
          lastStatusAt: d.lastCheckedAt || null,
        },
      };
    })
    .filter((r) => (status ? r.computed.code === status : true));

  res.json({ rows, total: rows.length });
});

/**
 * POST /api/fb-tokens/:id/check
 * id có thể là Mongo _id hoặc pageId
 * Gọi debug + test quyền, lưu kết quả gần nhất (lastStatus*) và normalize expires.
 */
export const checkOneFbToken = asyncHandler(async (req, res) => {
  const idOrPage = String(req.params.id);
  const doc = isId(idOrPage)
    ? await FbToken.findById(idOrPage)
    : await FbToken.findOne({ pageId: idOrPage });

  if (!doc) {
    res.status(404);
    throw new Error("Page token not found");
  }

  const [dbgUser, dbgPage] = await Promise.all([
    doc.longUserToken
      ? debugAnyToken(doc.longUserToken)
      : Promise.resolve(null),
    doc.pageToken ? debugAnyToken(doc.pageToken) : Promise.resolve(null),
  ]);

  const [canRead, canLive] = doc.pageToken
    ? await Promise.all([
        testPageReadable(doc.pageId, doc.pageToken),
        testPageLiveCapable(doc.pageId, doc.pageToken),
      ])
    : [
        { ok: false, reason: "NO_PAGE_TOKEN" },
        { ok: false, reason: "NO_PAGE_TOKEN" },
      ];

  const status = buildStatus({ dbgUser, dbgPage, canRead, canLive, doc });

  // persist last check (và kết quả gần nhất)
  doc.lastCheckedAt = NOW_UTC();
  doc.lastError =
    status.code === "OK"
      ? ""
      : dbgPage?.message || dbgUser?.message || status.problems.join("; ");
  doc.needsReauth = [
    "CHECKPOINT",
    "EXPIRED",
    "INVALID",
    "MISSING_SCOPES",
    "ISSUE",
  ].includes(status.code);

  // ✅ lưu kết quả health check gần nhất để list ưu tiên hiển thị
  // (đảm bảo schema có các field này để không bị strict bỏ qua)
  doc.lastStatusCode = status.code;
  doc.lastStatusProblems = status.problems;
  doc.lastStatusHints = status.hints;

  // normalize expires từ debug (nếu có)
  if (dbgUser?.expires_at) {
    doc.longUserExpiresAt = new Date(dbgUser.expires_at * 1000);
  }
  if (dbgPage?.expires_at !== undefined) {
    // expires_at === 0 => never
    doc.pageTokenExpiresAt =
      dbgPage.expires_at === 0 ? null : new Date(dbgPage.expires_at * 1000);
    doc.pageTokenIsNever = dbgPage.expires_at === 0;
  }

  await doc.save();

  res.json({
    ok: status.code === "OK",
    status,
    dbgUser: pickUsefulDebug(dbgUser),
    dbgPage: pickUsefulDebug(dbgPage),
    canRead,
    canLive,
    saved: {
      lastCheckedAt: doc.lastCheckedAt,
      lastError: doc.lastError,
      needsReauth: doc.needsReauth,
      lastStatusCode: doc.lastStatusCode,
      longUserExpiresAt: doc.longUserExpiresAt,
      pageTokenExpiresAt: doc.pageTokenExpiresAt,
      pageTokenIsNever: doc.pageTokenIsNever,
    },
  });
});

/**
 * POST /api/fb-tokens/~batch/check-all
 * Chạy lần lượt theo cụm nhỏ để tránh rate limit
 */
export const checkAllFbTokens = asyncHandler(async (req, res) => {
  const docs = await FbToken.find({}).lean();
  const ids = docs.map((d) => d._id);
  const limit = 3; // gentle concurrency

  const chunks = [];
  for (let i = 0; i < ids.length; i += limit)
    chunks.push(ids.slice(i, i + limit));

  let ok = 0,
    bad = 0;
  const results = [];

  for (const batch of chunks) {
    const outs = await Promise.allSettled(
      batch.map((id) =>
        fetch(
          `${req.protocol}://${req.get("host")}/api/fb-tokens/${id}/check`,
          {
            method: "POST",
            headers: { cookie: req.headers.cookie || "" }, // reuse session
          }
        ).then((r) => r.json())
      )
    );
    for (const r of outs) {
      if (r.status === "fulfilled" && r.value?.ok) ok++;
      else bad++;
      results.push(
        r.status === "fulfilled"
          ? r.value
          : { ok: false, error: String(r.reason) }
      );
    }
  }

  res.json({ ok, bad, resultsCount: results.length });
});

/**
 * POST /api/fb-tokens/:id/mark-reauth
 */
export const markNeedsReauth = asyncHandler(async (req, res) => {
  const doc = await FbToken.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Not found");
  }
  doc.needsReauth = true;
  doc.lastCheckedAt = NOW_UTC();
  await doc.save();
  res.json({ ok: true });
});

/**
 * POST /api/fb-tokens/:id/clear-busy
 */
export const clearBusyFlag = asyncHandler(async (req, res) => {
  const doc = await FbToken.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Not found");
  }
  doc.isBusy = false;
  doc.busyMatch = null;
  doc.busyLiveVideoId = null;
  doc.busySince = null;
  await doc.save();
  res.json({ ok: true });
});
