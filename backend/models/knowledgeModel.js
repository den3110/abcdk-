// models/knowledgeModel.js
// MongoDB model cho Knowledge Base (RAG)

import mongoose from "mongoose";

const knowledgeSchema = new mongoose.Schema(
  {
    // Tiêu đề bài viết / FAQ
    title: { type: String, required: true },

    // Nội dung chi tiết
    content: { type: String, required: true },

    // Danh mục: faq, guide, feature, policy, ...
    category: {
      type: String,
      enum: ["faq", "guide", "feature", "policy", "other"],
      default: "faq",
    },

    // Keywords để tìm kiếm fallback (nếu không dùng vector search)
    keywords: [String],

    // Embedding vector (cho vector search sau này)
    embedding: [Number],

    // Metadata
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Text index cho full-text search (fallback khi chưa có vector search)
knowledgeSchema.index({ title: "text", content: "text", keywords: "text" });

const Knowledge =
  mongoose.models.Knowledge || mongoose.model("Knowledge", knowledgeSchema);

export default Knowledge;
