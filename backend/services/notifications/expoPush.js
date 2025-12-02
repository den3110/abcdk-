// src/services/expoPush.js
import { Expo } from "expo-server-sdk";
import PushToken from "../../models/pushTokenModel.js";
import dotenv from "dotenv";
dotenv.config();

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

const DEBUG = String(process.env.PUSH_DEBUG || "").trim() === "1";

/* ========================= Helpers ========================= */

function maskToken(t) {
  if (!t || typeof t !== "string") return t;
  if (t.length <= 12) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function log(level, msg, extra) {
  // level: debug|info|warn|error
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = DEBUG ? 10 : 20; // khi không debug: bỏ qua debug
  if (levels[level] < threshold) return;
  const prefix = `[push][${level}]`;
  if (extra !== undefined) {
    // In gọn gàng, tránh dump payload quá dài
    try {
      // console.log(prefix, msg, JSON.stringify(extra));
    } catch {
      // console.log(prefix, msg, extra);
    }
  } else {
    // console.log(prefix, msg);
  }
}

/** Build 1 message từ 1 row (hoặc token string) */
function buildMessage(row, base = {}, opts = {}) {
  const to = typeof row === "string" ? row : row?.token;
  if (!to) return null;

  if (!Expo.isExpoPushToken(to)) {
    log("warn", "Invalid Expo token, disabling", { token: maskToken(to) });
    // Token không phải dạng Expo => disable luôn (fire & forget)
    void PushToken.updateOne(
      { token: to },
      {
        $set: {
          enabled: false,
          lastError: "InvalidExpoToken",
          updatedAt: new Date(),
        },
      }
    ).catch((e) =>
      log("error", "DB update failed (InvalidExpoToken)", { error: String(e) })
    );
    return null;
  }

  // In ngắn gọn nội dung message ở mức debug
  log("debug", "Build message", {
    to: maskToken(to),
    title: base?.title,
    hasData: !!base?.data,
  });

  return {
    to,
    sound: "default",
    ...base, // { title, body, data }
    ...opts, // { badge, ttl, expiration, priority }
  };
}

/** Tạo key gom nhóm theo "project" để không trộn DEV/PROD/white-label */
function projectKeyOf(row) {
  if (typeof row === "string") {
    // Không có metadata: để chắc chắn không trộn, tách riêng từng token
    return `unknown:${row}`;
  }
  const {
    easProjectId,
    projectId,
    experienceId,
    appId,
    bundleId,
    androidPackage,
    buildChannel,
    platform,
    token,
  } = row || {};

  const key =
    easProjectId ||
    projectId ||
    experienceId ||
    appId ||
    bundleId ||
    androidPackage ||
    null;

  if (!key) return `unknown:${token}`;
  return [key, platform || "", buildChannel || ""].filter(Boolean).join("|");
}

/** Gom theo project key, đồng thời dedup token trong từng nhóm */
function groupByProject(rows = []) {
  const groups = new Map();
  for (const r of rows) {
    const key = projectKeyOf(r);
    if (!groups.has(key)) groups.set(key, new Map()); // Map token -> row
    const token = typeof r === "string" ? r : r?.token;
    if (token) groups.get(key).set(token, r);
  }
  // Log tóm tắt
  for (const [key, map] of groups.entries()) {
    const sample = Array.from(map.keys()).slice(0, 5).map(maskToken);
    log("info", "Group summary", {
      projectKey: key,
      count: map.size,
      sampleTokens: sample,
    });
    if (key.startsWith("unknown:")) {
      log("warn", "Token group without metadata (sending individually)", {
        projectKey: key,
      });
    }
  }
  // Chuyển về mảng
  const result = [];
  for (const [key, map] of groups.entries()) {
    result.push({ key, rows: Array.from(map.values()) });
  }
  return result;
}

// 🆕 lấy receipts theo ticket ids
async function fetchReceipts(ticketIds = []) {
  const receipts = [];
  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  log("debug", "Fetch receipts", {
    batches: chunks.length,
    ids: ticketIds.length,
  });
  for (const c of chunks) {
    const res = await expo.getPushNotificationReceiptsAsync(c);
    receipts.push(res);
  }
  return receipts;
}

/* ========================= Core Send ========================= */

async function sendChunkWithFallback(projectKey, chunk, messages, offset) {
  try {
    log("info", "Sending chunk", {
      projectKey,
      size: chunk.length,
      tokens: chunk.slice(0, 5).map((m) => maskToken(m.to)),
    });
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    const results = [];
    for (let i = 0; i < ticketChunk.length; i++) {
      results.push({
        token: messages[offset + i].to,
        ticket: ticketChunk[i],
      });
    }
    return results;
  } catch (err) {
    const msg = String(err?.message || "");
    log("warn", "Chunk send failed", {
      projectKey,
      error: msg,
      size: chunk.length,
    });

    // Fallback khi trộn project (hoặc nghi ngờ)
    if (
      msg.includes(
        "All push notification messages in the same request must be for the same project"
      )
    ) {
      log("info", "Fallback to single-send", {
        projectKey,
        size: chunk.length,
      });
      const results = [];
      for (let i = 0; i < chunk.length; i++) {
        try {
          const single = await expo.sendPushNotificationsAsync([chunk[i]]);
          results.push({ token: chunk[i].to, ticket: single?.[0] });
        } catch (e2) {
          results.push({
            token: chunk[i].to,
            ticket: {
              status: "error",
              message: e2?.message || "sendSingleError",
              details: e2?.details || null,
            },
          });
        }
      }
      return results;
    }

    // Các lỗi khác: mark lỗi cho cả chunk
    return chunk.map((m) => ({
      token: m.to,
      ticket: {
        status: "error",
        message: err?.message || "sendChunkError",
        details: err?.details || null,
      },
    }));
  }
}

/** Gửi 1 nhóm (cùng project) các rows */
async function sendGroup(projectKey, rows = [], basePayload = {}, opts = {}) {
  const messages = [];
  for (const r of rows) {
    const m = buildMessage(r, basePayload, opts);
    if (m) messages.push(m);
  }
  if (!messages.length) {
    log("info", "Empty message group, skip", { projectKey });
    return { tickets: [], ticketResults: [], receiptResults: [] };
  }

  const ticketResults = [];
  const chunks = expo.chunkPushNotifications(messages);
  log("debug", "Group chunked", { projectKey, chunks: chunks.length });

  let offset = 0;
  for (const chunk of chunks) {
    const results = await sendChunkWithFallback(
      projectKey,
      chunk,
      messages,
      offset
    );
    for (const r of results) {
      const status = r.ticket?.status || "unknown";
      if (status === "ok") {
        log("debug", "Ticket OK", {
          token: maskToken(r.token),
          id: r.ticket?.id,
        });
      } else {
        log("warn", "Ticket error", {
          token: maskToken(r.token),
          message: r.ticket?.message,
          details: r.ticket?.details,
        });
      }
      ticketResults.push(r);
    }
    offset += chunk.length;
  }

  // Dọn theo ticket ngay lập tức
  for (const r of ticketResults) {
    if (r.ticket?.status === "error") {
      const err = r.ticket?.details?.error;
      if (err === "DeviceNotRegistered" || err === "InvalidCredentials") {
        log("info", "Disable token by ticket error", {
          token: maskToken(r.token),
          error: err,
        });
        await PushToken.updateOne(
          { token: r.token },
          { $set: { enabled: false, lastError: err, updatedAt: new Date() } }
        );
      }
    }
  }

  // 🧾 Receipts
  const okIds = ticketResults.map((r) => r.ticket?.id).filter(Boolean);
  const receiptBulks = okIds.length ? await fetchReceipts(okIds) : [];
  if (okIds.length) {
    log("debug", "Receipts fetched", {
      projectKey,
      okIds: okIds.length,
      packs: receiptBulks.length,
    });
  }

  // Dọn theo receipts
  for (const pack of receiptBulks) {
    for (const [id, rec] of Object.entries(pack)) {
      if (rec.status === "error") {
        const hit = ticketResults.find((t) => t.ticket?.id === id);
        const err = rec.details?.error;
        log("warn", "Receipt error", {
          id,
          token: hit ? maskToken(hit.token) : undefined,
          error: err,
          details: rec.details,
        });
        if (hit && err === "DeviceNotRegistered") {
          await PushToken.updateOne(
            { token: hit.token },
            {
              $set: {
                enabled: false,
                lastError: err,
                updatedAt: new Date(),
              },
            }
          );
          log("info", "Disable token by receipt error", {
            token: maskToken(hit.token),
          });
        }
      } else {
        log("debug", "Receipt OK", { id });
      }
    }
  }

  return {
    tickets: ticketResults.map((r) => r.ticket),
    ticketResults,
    receiptResults: receiptBulks,
  };
}

/** ===== Public APIs ===== */

export async function sendToTokens(
  tokensOrRows = [],
  basePayload = {},
  opts = {}
) {
  if (!tokensOrRows.length)
    return { tickets: [], ticketResults: [], receiptResults: [] };

  log("info", "sendToTokens: start", { count: tokensOrRows.length });

  // Nhóm theo project để không trộn DEV/PROD/white-label trong cùng request
  const groups = groupByProject(tokensOrRows);

  const all = { tickets: [], ticketResults: [], receiptResults: [] };
  for (const g of groups) {
    log("info", "Sending group", { projectKey: g.key, count: g.rows.length });
    const res = await sendGroup(g.key, g.rows, basePayload, opts);
    all.tickets.push(...res.tickets);
    all.ticketResults.push(...res.ticketResults);
    all.receiptResults.push(...res.receiptResults);
  }

  log("info", "sendToTokens: done", {
    groups: groups.length,
    tickets: all.tickets.length,
  });

  return all;
}

export async function sendToUserIds(userIds = [], basePayload = {}, opts = {}) {
  if (!userIds.length)
    return { tokens: 0, tickets: [], ticketResults: [], receiptResults: [] };

  log("info", "sendToUserIds: load tokens", { users: userIds.length });

  // Lấy kèm metadata để group theo project
  const rows = await PushToken.find({
    user: { $in: userIds },
    enabled: true,
  })
    .select(
      "token platform easProjectId projectId experienceId appId bundleId androidPackage buildChannel"
    )
    .lean();

  // Dedup theo token
  const seen = new Set();
  const uniqueRows = [];
  for (const r of rows) {
    if (!r?.token || seen.has(r.token)) continue;
    seen.add(r.token);
    uniqueRows.push(r);
  }

  log("info", "sendToUserIds: tokens ready", {
    users: userIds.length,
    tokens: uniqueRows.length,
  });

  if (!uniqueRows.length)
    return { tokens: 0, tickets: [], ticketResults: [], receiptResults: [] };

  const res = await sendToTokens(uniqueRows, basePayload, opts);
  return { tokens: uniqueRows.length, ...res };
}

export async function sendToUser(userId, basePayload = {}, opts = {}) {
  return sendToUserIds([userId], basePayload, opts);
}
