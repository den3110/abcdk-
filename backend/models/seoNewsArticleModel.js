import mongoose from "mongoose";

const SeoNewsReviewSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "pass", "fail"],
      default: "pending",
    },
    score: { type: Number, default: 0 },
    reasons: [{ type: String }],
    criticalFlags: [{ type: String }],
    checkedAt: Date,
    checkerModel: String,
  },
  { _id: false }
);

const SeoNewsWorkflowSchema = new mongoose.Schema(
  {
    generatorModel: String,
    reviewerModel: String,
    runId: String,
  },
  { _id: false }
);

const SeoNewsArticleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    summary: String,
    contentHtml: { type: String, required: true },
    contentText: String,

    sourceName: String,
    sourceUrl: { type: String, default: null },
    originalPublishedAt: Date,
    fetchedAt: { type: Date, default: Date.now },

    tags: [String],
    language: { type: String, default: "vi" },

    heroImageUrl: String,
    thumbImageUrl: String,

    relevanceScore: { type: Number, default: 0 },

    origin: {
      type: String,
      enum: ["external", "generated"],
      default: "external",
      index: true,
    },

    status: {
      type: String,
      enum: ["draft", "published", "hidden"],
      default: "draft",
      index: true,
    },

    contentHash: { type: String, index: true },

    review: { type: SeoNewsReviewSchema, default: () => ({}) },
    workflow: { type: SeoNewsWorkflowSchema, default: () => ({}) },
  },
  { timestamps: true }
);

SeoNewsArticleSchema.index({ status: 1, originalPublishedAt: -1, createdAt: -1 });
SeoNewsArticleSchema.index({ origin: 1, createdAt: -1 });
SeoNewsArticleSchema.index({ "review.status": 1, createdAt: -1 });

SeoNewsArticleSchema.index(
  { sourceUrl: 1 },
  {
    unique: true,
    partialFilterExpression: {
      origin: "external",
      sourceUrl: { $type: "string" },
    },
  }
);

export default mongoose.model("SeoNewsArticle", SeoNewsArticleSchema);
