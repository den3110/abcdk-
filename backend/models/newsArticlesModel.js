import mongoose from "mongoose";

const NewsArticleSchema = new mongoose.Schema(
  {
    slug: { type: String, unique: true, index: true },
    title: { type: String, required: true },
    summary: String,
    contentHtml: { type: String, required: true },
    contentText: String,

    sourceName: String,
    sourceUrl: { type: String, required: true, unique: true },
    originalPublishedAt: Date,
    fetchedAt: { type: Date, default: Date.now },

    tags: [String],
    language: { type: String, default: "vi" },

    heroImageUrl: String,
    thumbImageUrl: String,

    relevanceScore: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["draft", "published", "hidden"],
      default: "published",
    },

    contentHash: { type: String, index: true },
  },
  { timestamps: true }
);

NewsArticleSchema.index({ status: 1, originalPublishedAt: -1 });
NewsArticleSchema.index({ relevanceScore: -1 });

export default mongoose.model("NewsArticle", NewsArticleSchema);
