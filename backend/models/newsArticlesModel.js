import mongoose from "mongoose";
import { clearNewsPresentationCaches } from "../services/cacheInvalidation.service.js";

let newsCacheClearScheduled = false;

function scheduleNewsCacheClear() {
  if (newsCacheClearScheduled) return;
  newsCacheClearScheduled = true;

  const run =
    typeof setImmediate === "function"
      ? setImmediate
      : (callback) => setTimeout(callback, 0);

  run(async () => {
    newsCacheClearScheduled = false;
    try {
      await clearNewsPresentationCaches();
    } catch (error) {
      console.warn(
        "[NewsArticle] clear news cache failed:",
        error?.message || error,
      );
    }
  });
}

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

NewsArticleSchema.post("save", scheduleNewsCacheClear);
NewsArticleSchema.post("insertMany", scheduleNewsCacheClear);
NewsArticleSchema.post("findOneAndUpdate", scheduleNewsCacheClear);
NewsArticleSchema.post("updateOne", scheduleNewsCacheClear);
NewsArticleSchema.post("updateMany", scheduleNewsCacheClear);
NewsArticleSchema.post("bulkWrite", scheduleNewsCacheClear);

export default mongoose.model("NewsArticle", NewsArticleSchema);
