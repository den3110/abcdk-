// src/controllers/newsAdminController.js
import NewsSettings from "../models/newsSettingsModel.js";
import NewsLinkCandidate from "../models/newsLinkCandicateModel.js";

/**
 * GET /api/admin/news/settings
 * Lấy config hệ thống tin tức
 */
export const getNewsSettings = async (req, res) => {
  const settings =
    (await NewsSettings.findOne({ key: "default" }).lean()) ||
    (await NewsSettings.create({}));
  res.json(settings);
};

/**
 * PUT /api/admin/news/settings
 * Cập nhật config hệ thống tin tức
 */
export const updateNewsSettings = async (req, res) => {
  const body = req.body || {};

  const settings = await NewsSettings.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        enabled: body.enabled,
        intervalMinutes: body.intervalMinutes,
        allowedDomains: body.allowedDomains,
        blockedDomains: body.blockedDomains,
        mainKeywords: body.mainKeywords,
        extraKeywords: body.extraKeywords,
        minAiScore: body.minAiScore,
        autoPublish: body.autoPublish,
        maxArticlesPerRun: body.maxArticlesPerRun,
        maxArticlesPerDay: body.maxArticlesPerDay,
        useAiNormalize: body.useAiNormalize,
      },
    },
    { new: true, upsert: true }
  ).lean();

  res.json(settings);
};

/**
 * GET /api/admin/news/candidates
 * Xem danh sách link candidate (debug / monitoring)
 */
export const getNewsCandidates = async (req, res) => {
  const items = await NewsLinkCandidate.find()
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  res.json(items);
};
