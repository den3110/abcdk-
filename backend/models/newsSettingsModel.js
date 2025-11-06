import mongoose from "mongoose";

const NewsSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "default" },

    enabled: {
      type: Boolean,
      default: process.env.NEWS_DISCOVERY_ENABLED === "false" ? false : true,
    },
    intervalMinutes: {
      type: Number,
      default: Number(process.env.NEWS_DISCOVERY_INTERVAL_MINUTES) || 30,
    },

    allowedDomains: [{ type: String }], // vd: ["espn.com", "usapickleball.org"]
    blockedDomains: [{ type: String }],

    mainKeywords: {
      type: [String],
      default: ["PickleTour", "pickleball"],
    },
    extraKeywords: { type: [String], default: [] },

    minAiScore: {
      type: Number,
      default: Number(process.env.NEWS_MIN_AI_SCORE) || 0.7,
    },
    autoPublish: {
      type: Boolean,
      default: process.env.NEWS_AUTO_PUBLISH === "false" ? false : true,
    },
    maxArticlesPerRun: {
      type: Number,
      default: Number(process.env.NEWS_MAX_ARTICLES_PER_RUN) || 20,
    },
    maxArticlesPerDay: {
      type: Number,
      default: 60,
    },

    useAiNormalize: {
      type: Boolean,
      default: true, // nếu muốn engine crawl thuần, set false ở admin
    },
  },
  { timestamps: true }
);

export default mongoose.model("NewsSettings", NewsSettingsSchema);
