import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Ranking from "../../models/rankingModel.js";
import ScoreHistory from "../../models/scoreHistoryModel.js";

const STAFF_SCORE_BY = ["admin", "mod", "moderator"];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const parsePositiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const escapeRegex = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasPositiveScoreExpr = {
  $or: [
    { $gt: [{ $ifNull: ["$single", 0] }, 0] },
    { $gt: [{ $ifNull: ["$double", 0] }, 0] },
    { $gt: [{ $ifNull: ["$mix", 0] }, 0] },
    { $gt: [{ $ifNull: ["$points", 0] }, 0] },
  ],
};

const baseSelfOnlyPipeline = ({ keyword = "" } = {}) => {
  const pipeline = [
    {
      $match: {
        hasStaffAssessment: { $ne: true },
        $or: [
          { tierColor: "red" },
          { single: { $gt: 0 } },
          { double: { $gt: 0 } },
          { mix: { $gt: 0 } },
          { points: { $gt: 0 } },
        ],
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            hasPositiveScoreExpr,
            { $lte: [{ $ifNull: ["$totalFinishedTours", 0] }, 0] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          {
            $match: {
              $or: [
                { "meta.scoreBy": { $in: STAFF_SCORE_BY } },
                { "meta.selfScored": false },
              ],
            },
          },
          { $limit: 1 },
        ],
        as: "staffAssessments",
      },
    },
    {
      $lookup: {
        from: "assessments",
        let: { uid: "$user" },
        pipeline: [
          { $match: { $expr: { $eq: ["$user", "$$uid"] } } },
          {
            $match: {
              $or: [
                { "meta.selfScored": true },
                { "meta.scoreBy": "self" },
                { $expr: { $eq: ["$scorer", "$$uid"] } },
              ],
            },
          },
          { $sort: { scoredAt: -1, createdAt: -1 } },
          { $limit: 1 },
          {
            $project: {
              singleLevel: 1,
              doubleLevel: 1,
              singleScore: 1,
              doubleScore: 1,
              note: 1,
              scoredAt: 1,
              meta: 1,
            },
          },
        ],
        as: "selfAssessments",
      },
    },
    {
      $match: {
        staffAssessments: { $size: 0 },
        $or: [{ selfAssessments: { $ne: [] } }, { tierColor: "red" }],
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    { $unwind: "$userDoc" },
  ];

  const kw = String(keyword || "").trim();
  if (kw) {
    const rx = new RegExp(escapeRegex(kw), "i");
    pipeline.push({
      $match: {
        $or: [
          { "userDoc.name": rx },
          { "userDoc.nickname": rx },
          { "userDoc.phone": rx },
          { "userDoc.email": rx },
        ],
      },
    });
  }

  return pipeline;
};

export const listSelfAssessments = asyncHandler(async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE),
  );
  const keyword = String(req.query.keyword || "").trim();
  const skip = (page - 1) * pageSize;

  const [result] = await Ranking.aggregate([
    ...baseSelfOnlyPipeline({ keyword }),
    { $sort: { lastAssessmentAt: -1, lastUpdated: -1, updatedAt: -1 } },
    {
      $facet: {
        rows: [
          { $skip: skip },
          { $limit: pageSize },
          {
            $project: {
              _id: 0,
              user: {
                _id: "$userDoc._id",
                name: "$userDoc.name",
                nickname: "$userDoc.nickname",
                phone: "$userDoc.phone",
                email: "$userDoc.email",
                province: "$userDoc.province",
                avatar: "$userDoc.avatar",
              },
              ranking: {
                _id: "$_id",
                single: "$single",
                double: "$double",
                mix: "$mix",
                points: "$points",
                tierColor: "$tierColor",
                tierLabel: "$tierLabel",
                totalFinishedTours: "$totalFinishedTours",
                hasStaffAssessment: "$hasStaffAssessment",
                lastAssessmentAt: "$lastAssessmentAt",
                lastUpdated: "$lastUpdated",
              },
              selfAssessment: { $arrayElemAt: ["$selfAssessments", 0] },
            },
          },
        ],
        total: [{ $count: "count" }],
        summary: [
          {
            $group: {
              _id: null,
              users: { $sum: 1 },
              avgSingle: { $avg: "$single" },
              avgDouble: { $avg: "$double" },
            },
          },
        ],
      },
    },
  ]);

  res.json({
    users: result?.rows || [],
    total: result?.total?.[0]?.count || 0,
    page,
    pageSize,
    summary: result?.summary?.[0] || {
      users: 0,
      avgSingle: null,
      avgDouble: null,
    },
  });
});

export const resetSelfAssessments = asyncHandler(async (req, res) => {
  const rawUserIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
  const dryRun = req.body?.dryRun === true || req.query?.dryRun === "1";
  const keyword = String(req.body?.keyword || req.query?.keyword || "").trim();

  const scopedUserIds = rawUserIds
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const pipeline = baseSelfOnlyPipeline({ keyword });
  if (scopedUserIds.length) {
    pipeline.unshift({ $match: { user: { $in: scopedUserIds } } });
  }
  pipeline.push({ $project: { user: 1 } });

  const targets = await Ranking.aggregate(pipeline);
  const userIds = targets.map((r) => r.user).filter(Boolean);

  if (dryRun || !userIds.length) {
    return res.json({
      ok: true,
      dryRun: true,
      matched: userIds.length,
      reset: 0,
    });
  }

  const now = new Date();
  const session = await mongoose.startSession();

  try {
    let modifiedCount = 0;
    await session.withTransaction(async () => {
      const updated = await Ranking.updateMany(
        { user: { $in: userIds } },
        {
          $set: {
            single: 0,
            double: 0,
            mix: 0,
            points: 0,
            hasStaffAssessment: false,
            lastAssessmentAt: null,
            lastStaffAssessmentAt: null,
            lastUpdated: now,
            tierUpdatedAt: now,
            tierColor: "grey",
            tierLabel: "0 điểm / Chưa đấu",
            colorRank: 3,
          },
        },
        { session },
      );
      modifiedCount = updated.modifiedCount ?? updated.nModified ?? 0;

      await ScoreHistory.insertMany(
        userIds.map((userId) => ({
          user: userId,
          scorer: req.user?._id || null,
          single: 0,
          double: 0,
          note: "Admin reset điểm tự chấm chưa được chấm chính thức",
          scoredAt: now,
        })),
        { session, ordered: false },
      );
    });

    return res.json({
      ok: true,
      dryRun: false,
      matched: userIds.length,
      reset: modifiedCount,
    });
  } finally {
    session.endSession();
  }
});
