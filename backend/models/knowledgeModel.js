// models/knowledgeModel.js
// MongoDB model cho Knowledge Base (RAG)

import mongoose from "mongoose";

const knowledgeSchema = new mongoose.Schema(
  {
    // Tiêu đề bài viết / FAQ
    title: { type: String, required: true },

    // Nội dung chi tiết
    content: { type: String, required: true },

    // Danh mục: faq, guide, feature, policy, learned, ...
    category: {
      type: String,
      enum: ["faq", "guide", "feature", "policy", "learned", "other"],
      default: "faq",
    },

    // Keywords để tìm kiếm fallback (nếu không dùng vector search)
    keywords: [String],

    // Embedding vector (cho vector search sau này)
    embedding: [Number],

    // Source: manual (admin tạo) hoặc bot-learned (bot tự học)
    source: {
      type: String,
      enum: ["manual", "bot-learned"],
      default: "manual",
    },

    // Tools đã dùng để tạo câu trả lời này
    toolsUsed: [String],

    // Số lần knowledge entry này được reuse
    usageCount: { type: Number, default: 0 },

    // TTL: tự xóa sau 30 ngày (chỉ cho bot-learned)
    expiresAt: { type: Date, default: null },

    // Metadata
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Text index cho full-text search (fallback khi chưa có vector search)
knowledgeSchema.index({ title: "text", content: "text", keywords: "text" });

// TTL index: auto-delete khi expiresAt đến hạn
knowledgeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Knowledge =
  mongoose.models.Knowledge || mongoose.model("Knowledge", knowledgeSchema);

export default Knowledge;
