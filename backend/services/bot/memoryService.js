// services/bot/memoryService.js
// Conversation memory - load recent messages for context

import ChatBotMessage from "../../models/chatBotMessageModel.js";

/**
 * Load N tin nhắn gần nhất của user (role: user + bot)
 * Convert sang format OpenAI messages
 */
export async function getRecentMessages(userId, limit = 10) {
  if (!userId) return [];

  const docs = await ChatBotMessage.find({
    userId,
    role: { $in: ["user", "bot"] },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Reverse để đúng thứ tự thời gian (cũ → mới)
  docs.reverse();

  return docs.map((d) => ({
    role: d.role === "bot" ? "assistant" : "user",
    content: d.message,
  }));
}
