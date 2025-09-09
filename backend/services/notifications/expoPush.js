// src/services/expoPush.js
import { Expo } from "expo-server-sdk";
import PushToken from "../../models/pushTokenModel.js";
import dotenv from "dotenv";
dotenv.config();

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

function asMessages(tokens = [], base = {}, opts = {}) {
  return tokens.map((to) => ({
    to,
    sound: "default",
    ...base, // { title, body, data }
    ...opts, // { badge, ttl, expiration, priority }
  }));
}

// 🆕 lấy receipts theo ticket ids
async function fetchReceipts(ticketIds = []) {
  const receipts = [];
  const chunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  for (const c of chunks) {
    const res = await expo.getPushNotificationReceiptsAsync(c);
    receipts.push(res);
  }
  return receipts;
}

/** Gửi thẳng theo danh sách tokens; dọn token lỗi từ ticket + receipts */
export async function sendToTokens(tokens = [], basePayload = {}, opts = {}) {
  if (!tokens.length)
    return { tickets: [], ticketResults: [], receiptResults: [] };

  const messages = asMessages(tokens, basePayload, opts);
  const ticketResults = []; // [{ token, ticket }]
  const chunks = expo.chunkPushNotifications(messages);
  let offset = 0;

  for (const chunk of chunks) {
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    for (let i = 0; i < ticketChunk.length; i++) {
      ticketResults.push({
        token: messages[offset + i].to,
        ticket: ticketChunk[i],
      });
    }
    offset += chunk.length;
  }

  // Dọn theo ticket ngay lập tức
  for (const r of ticketResults) {
    if (r.ticket?.status === "error") {
      const err = r.ticket?.details?.error;
      if (err === "DeviceNotRegistered") {
        await PushToken.updateOne(
          { token: r.token },
          { $set: { enabled: false, lastError: err, updatedAt: new Date() } }
        );
      }
    }
  }

  // 🆕 Lấy receipts (vì nhiều lỗi chỉ lộ ra ở receipts)
  const okIds = ticketResults.map((r) => r.ticket?.id).filter((id) => !!id);
  const receiptBulks = await fetchReceipts(okIds);

  // Dọn theo receipts
  for (const pack of receiptBulks) {
    for (const [id, rec] of Object.entries(pack)) {
      if (rec.status === "error") {
        // tìm token tương ứng (ticket.id)
        const hit = ticketResults.find((t) => t.ticket?.id === id);
        if (hit) {
          const err = rec.details?.error;
          if (err === "DeviceNotRegistered") {
            await PushToken.updateOne(
              { token: hit.token },
              {
                $set: { enabled: false, lastError: err, updatedAt: new Date() },
              }
            );
          }
        }
      }
    }
  }

  return {
    tickets: ticketResults.map((r) => r.ticket),
    ticketResults,
    receiptResults: receiptBulks,
  };
}

export async function sendToUserIds(userIds = [], basePayload = {}, opts = {}) {
  if (!userIds.length)
    return { tokens: 0, tickets: [], ticketResults: [], receiptResults: [] };

  const rows = await PushToken.find({ user: { $in: userIds }, enabled: true })
    .select("token")
    .lean();
  const tokens = [...new Set(rows.map((x) => x.token))];
  if (!tokens.length)
    return { tokens: 0, tickets: [], ticketResults: [], receiptResults: [] };

  return {
    tokens: tokens.length,
    ...(await sendToTokens(tokens, basePayload, opts)),
  };
}

export async function sendToUser(userId, basePayload = {}, opts = {}) {
  return sendToUserIds([userId], basePayload, opts);
}
