import mongoose from "mongoose";

const SeoNewsSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "default" },

    enabled: {
      type: Boolean,
      default: process.env.SEO_NEWS_ENABLED === "false" ? false : true,
    },
    intervalMinutes: {
      type: Number,
      default: Number(process.env.SEO_NEWS_INTERVAL_MINUTES) || 180,
    },

    cronStatus: {
      type: String,
      enum: ["idle", "running", "success", "error", "disabled"],
      default: "idle",
    },
    cronRunning: {
      type: Boolean,
      default: false,
    },
    lastCronRunAt: {
      type: Date,
      default: null,
    },
    lastCronSuccessAt: {
      type: Date,
      default: null,
    },
    nextCronRunAt: {
      type: Date,
      default: null,
    },
    lastCronRunId: {
      type: String,
      default: null,
    },
    lastCronError: {
      type: String,
      default: null,
    },
    lastCronStats: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    allowedDomains: [{ type: String }],
    blockedDomains: [{ type: String }],

    competitorDomains: {
      type: [String],
      default: ["alobo.vn", "vpickleball.com"],
    },
    competitorKeywords: {
      type: [String],
      default: ["alobo", "vpickleball"],
    },

    mainKeywords: {
      type: [String],
      default: ["pickleball", "pickletour", "giai pickleball"],
    },
    extraKeywords: { type: [String], default: [] },

    minAiScore: {
      type: Number,
      default: Number(process.env.SEO_NEWS_MIN_AI_SCORE) || 0.75,
    },

    reviewPassScore: {
      type: Number,
      default: Number(process.env.SEO_NEWS_REVIEW_PASS_SCORE) || 0.78,
    },

    autoPublish: {
      type: Boolean,
      default: process.env.SEO_NEWS_AUTO_PUBLISH === "false" ? false : true,
    },

    maxArticlesPerRun: {
      type: Number,
      default: Number(process.env.SEO_NEWS_MAX_PER_RUN) || 8,
    },

    targetArticlesPerDay: {
      type: Number,
      default: Number(process.env.SEO_NEWS_TARGET_PER_DAY) || 6,
    },

    maxArticlesPerDay: {
      type: Number,
      default: Number(process.env.SEO_NEWS_MAX_PER_DAY) || 8,
    },

    discoveryProvider: {
      type: String,
      enum: ["auto", "gemini", "openai"],
      default: "auto",
    },

    imageSearchEnabled: {
      type: Boolean,
      default:
        process.env.SEO_NEWS_IMAGE_SEARCH_ENABLED === "false" ? false : true,
    },

    imageFallbackEnabled: {
      type: Boolean,
      default:
        process.env.SEO_NEWS_IMAGE_FALLBACK_ENABLED === "false" ? false : true,
    },

    imageGenerationModel: {
      type: String,
      default: "",
      trim: true,
    },

    articleGenerationModel: {
      type: String,
      default: "",
      trim: true,
    },

    imageGenerationDelaySeconds: {
      type: Number,
      default: Math.max(
        15,
        Math.floor(
          (Number(process.env.SEO_NEWS_AI_REGEN_INTERVAL_MS) || 120000) / 1000
        )
      ),
    },

    imageRegenerationPaused: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("SeoNewsSettings", SeoNewsSettingsSchema);
