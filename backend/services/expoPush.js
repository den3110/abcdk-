// src/services/expoPush.js
import { Expo } from "expo-server-sdk";
import PushToken from "../models/pushTokenModel.js";
import dotenv from "dotenv";
dotenv.config();

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined, // bật Enhanced Push Security ⇒ bắt buộc
});

function asMessages(tokens = [], base = {}, opts = {}) {
  return tokens.map((to) => ({
    to,
    sound: "default",
    ...base, // { title, body, data }
    ...opts, // { badge, ttl, expiration, priority }
  }));
}

/** Gửi thẳng theo danh sách tokens; dọn token lỗi ngay từ ticket */
export async function sendToTokens(tokens = [], basePayload = {}, opts = {}) {
  if (!tokens.length) return { tickets: [], results: [] };

  const messages = asMessages(tokens, basePayload, opts);
  const results = []; // [{ token, ticket }]
  const chunks = expo.chunkPushNotifications(messages);
  let offset = 0;

  for (const chunk of chunks) {
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    for (let i = 0; i < ticketChunk.length; i++) {
      results.push({ token: messages[offset + i].to, ticket: ticketChunk[i] });
    }
    offset += chunk.length;
  }

  // Dọn token chết
  for (const r of results) {
    if (r.ticket?.status === "error") {
      const err = r.ticket?.details?.error;
      if (err === "DeviceNotRegistered") {
        await PushToken.updateOne(
          { token: r.token },
          { $set: { enabled: false, lastError: err } }
        );
      }
    }
  }

  return { tickets: results.map((r) => r.ticket), results };
}

/** Lấy tokens theo userIds rồi gọi sendToTokens */
export async function sendToUserIds(userIds = [], basePayload = {}, opts = {}) {
  if (!userIds.length) return { tokens: 0, tickets: [], results: [] };

  const rows = await PushToken.find({ user: { $in: userIds }, enabled: true })
    .select("token")
    .lean();

  const tokens = rows.map((x) => x.token);
  if (!tokens.length) return { tokens: 0, tickets: [], results: [] };

  const out = await sendToTokens(tokens, basePayload, opts);
  return { tokens: tokens.length, ...out };
}

/** Gửi cho 1 user */
export async function sendToUser(userId, basePayload = {}, opts = {}) {
  return sendToUserIds([userId], basePayload, opts);
}
