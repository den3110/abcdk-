import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Assessment from "../../models/assessmentModel.js";

const STAFF_SCORE_BY = ["admin", "mod", "moderator"];
const SCORE_BY_VALUES = ["admin", "mod", "moderator", "self", "unknown"];
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const parseDateBoundary = (value, endOfDay = false) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toObjectId = (value) => {
  const raw = String(value || "").trim();
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const normalizeScoreByFilter = (value) => {
  const values = parseCsv(value);
  if (!values.length || values.includes("all")) return [];
  const expanded = new Set();
  values.forEach((item) => {
    if (item === "staff") {
      STAFF_SCORE_BY.forEach((staffValue) => expanded.add(staffValue));
    } else if (SCORE_BY_VALUES.includes(item)) {
      expanded.add(item);
    }
  });
  return Array.from(expanded);
};

const buildScoreByMatch = (scoreByValues) => {
  if (!scoreByValues.length) return null;
  const known = scoreByValues.filter((item) => item !== "unknown" && item !== "self");
  const wantsSelf = scoreByValues.includes("self");
  const wantsUnknown = scoreByValues.includes("unknown");
  const clauses = [];
  if (known.length) clauses.push({ "meta.scoreBy": { $in: known } });
  if (wantsSelf) {
    clauses.push({
      $or: [
        { "meta.scoreBy": "self" },
        { "meta.selfScored": true },
        { $expr: { $eq: ["$user", "$scorer"] } },
      ],
    });
  }
  if (wantsUnknown) {
    clauses.push({
      $or: [
        { "meta.scoreBy": { $exists: false } },
        { "meta.scoreBy": null },
        { "meta.scoreBy": "" },
      ],
    });
  }
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

const buildSort = (sortBy, sortDir) => {
  const direction = String(sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;
  const map = {
    scoredAt: "scoredAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    singleLevel: "singleLevel",
    doubleLevel: "doubleLevel",
    scoreBy: "sourceKey",
    targetName: "targetSortName",
    scorerName: "scorerSortName",
    province: "targetUser.province",
  };
  const field = map[String(sortBy || "scoredAt")] || "scoredAt";
  return { [field]: direction, _id: -1 };
};

const userProjection = {
  _id: 1,
  name: 1,
  nickname: 1,
  phone: 1,
  email: 1,
  avatar: 1,
  province: 1,
  role: 1,
  roles: 1,
  isAdmin: 1,
  evaluator: 1,
};

export const listAssessmentHistory = asyncHandler(async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    parsePositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE)
  );
  const skip = (page - 1) * pageSize;
  const keyword = String(req.query.keyword || "").trim();
  const scoreByValues = normalizeScoreByFilter(req.query.scoreBy);
  const sourceType = String(req.query.sourceType || "").trim().toLowerCase();
  const scorerRole = String(req.query.scorerRole || "").trim().toLowerCase();
  const province = String(req.query.province || "").trim();
  const targetUserId = toObjectId(req.query.targetUserId);
  const scorerId = toObjectId(req.query.scorerId);
  const dateFrom = parseDateBoundary(req.query.dateFrom, false);
  const dateTo = parseDateBoundary(req.query.dateTo, true);
  const singleMin = parseNumber(req.query.singleMin);
  const singleMax = parseNumber(req.query.singleMax);
  const doubleMin = parseNumber(req.query.doubleMin);
  const doubleMax = parseNumber(req.query.doubleMax);

  const baseMatch = {};
  const scoreByMatch = buildScoreByMatch(scoreByValues);
  if (scoreByMatch) Object.assign(baseMatch, scoreByMatch);
  if (targetUserId) baseMatch.user = targetUserId;
  if (scorerId) baseMatch.scorer = scorerId;
  if (dateFrom || dateTo) {
    baseMatch.scoredAt = {};
    if (dateFrom) baseMatch.scoredAt.$gte = dateFrom;
    if (dateTo) baseMatch.scoredAt.$lte = dateTo;
  }
  if (singleMin !== null || singleMax !== null) {
    baseMatch.singleLevel = {};
    if (singleMin !== null) baseMatch.singleLevel.$gte = singleMin;
    if (singleMax !== null) baseMatch.singleLevel.$lte = singleMax;
  }
  if (doubleMin !== null || doubleMax !== null) {
    baseMatch.doubleLevel = {};
    if (doubleMin !== null) baseMatch.doubleLevel.$gte = doubleMin;
    if (doubleMax !== null) baseMatch.doubleLevel.$lte = doubleMax;
  }

  const pipeline = [];
  if (Object.keys(baseMatch).length) pipeline.push({ $match: baseMatch });

  pipeline.push(
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "targetUser",
        pipeline: [{ $project: userProjection }],
      },
    },
    { $unwind: { path: "$targetUser", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "scorer",
        foreignField: "_id",
        as: "scorerUser",
        pipeline: [{ $project: userProjection }],
      },
    },
    { $unwind: { path: "$scorerUser", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        sourceKey: {
          $switch: {
            branches: [
              {
                case: { $in: ["$meta.scoreBy", ["admin", "mod", "moderator", "self"]] },
                then: "$meta.scoreBy",
              },
              {
                case: {
                  $and: [
                    { $ne: ["$user", null] },
                    { $ne: ["$scorer", null] },
                    { $eq: ["$user", "$scorer"] },
                  ],
                },
                then: "self",
              },
            ],
            default: "unknown",
          },
        },
        targetSortName: {
          $toLower: {
            $ifNull: [
              "$targetUser.nickname",
              { $ifNull: ["$targetUser.name", ""] },
            ],
          },
        },
        scorerSortName: {
          $toLower: {
            $ifNull: [
              "$scorerUser.nickname",
              { $ifNull: ["$scorerUser.name", ""] },
            ],
          },
        },
      },
    }
  );

  const postLookupClauses = [];
  if (sourceType === "self") {
    postLookupClauses.push({
      $or: [
        { sourceKey: "self" },
        { "meta.selfScored": true },
        { $expr: { $eq: ["$user", "$scorer"] } },
      ],
    });
  } else if (sourceType === "staff") {
    postLookupClauses.push({ sourceKey: { $in: STAFF_SCORE_BY } });
  } else if (sourceType === "unknown") {
    postLookupClauses.push({ sourceKey: "unknown" });
  }
  if (province) postLookupClauses.push({ "targetUser.province": province });
  if (scorerRole) {
    if (scorerRole === "evaluator") {
      postLookupClauses.push({ "scorerUser.evaluator.enabled": true });
    } else if (scorerRole === "admin") {
      postLookupClauses.push({
        $or: [
          { "scorerUser.role": "admin" },
          { "scorerUser.roles": "admin" },
          { "scorerUser.isAdmin": true },
        ],
      });
    } else if (["mod", "moderator", "user", "referee"].includes(scorerRole)) {
      postLookupClauses.push({
        $or: [
          { "scorerUser.role": scorerRole },
          { "scorerUser.roles": scorerRole },
        ],
      });
    }
  }
  if (keyword) {
    const rx = new RegExp(escapeRegex(keyword), "i");
    postLookupClauses.push({
      $or: [
        { "targetUser.name": rx },
        { "targetUser.nickname": rx },
        { "targetUser.phone": rx },
        { "targetUser.email": rx },
        { "targetUser.province": rx },
        { "scorerUser.name": rx },
        { "scorerUser.nickname": rx },
        { "scorerUser.phone": rx },
        { "scorerUser.email": rx },
        { note: rx },
      ],
    });
  }
  if (postLookupClauses.length === 1) {
    pipeline.push({ $match: postLookupClauses[0] });
  } else if (postLookupClauses.length > 1) {
    pipeline.push({ $match: { $and: postLookupClauses } });
  }

  const sort = buildSort(req.query.sortBy, req.query.sortDir);
  const [result] = await Assessment.aggregate([
    ...pipeline,
    { $sort: sort },
    {
      $facet: {
        rows: [
          { $skip: skip },
          { $limit: pageSize },
          {
            $project: {
              _id: 1,
              user: {
                _id: "$targetUser._id",
                name: "$targetUser.name",
                nickname: "$targetUser.nickname",
                phone: "$targetUser.phone",
                email: "$targetUser.email",
                avatar: "$targetUser.avatar",
                province: "$targetUser.province",
              },
              scorer: {
                _id: "$scorerUser._id",
                name: "$scorerUser.name",
                nickname: "$scorerUser.nickname",
                phone: "$scorerUser.phone",
                email: "$scorerUser.email",
                avatar: "$scorerUser.avatar",
                province: "$scorerUser.province",
                role: "$scorerUser.role",
                roles: "$scorerUser.roles",
                isAdmin: "$scorerUser.isAdmin",
                evaluatorEnabled: "$scorerUser.evaluator.enabled",
              },
              sourceKey: 1,
              isStaff: { $in: ["$sourceKey", STAFF_SCORE_BY] },
              isSelf: {
                $or: [
                  { $eq: ["$sourceKey", "self"] },
                  { $eq: ["$meta.selfScored", true] },
                  { $eq: ["$user", "$scorer"] },
                ],
              },
              singleLevel: 1,
              doubleLevel: 1,
              singleScore: 1,
              doubleScore: 1,
              meta: 1,
              note: 1,
              scoredAt: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        total: [{ $count: "count" }],
        summary: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              staff: {
                $sum: { $cond: [{ $in: ["$sourceKey", STAFF_SCORE_BY] }, 1, 0] },
              },
              self: { $sum: { $cond: [{ $eq: ["$sourceKey", "self"] }, 1, 0] } },
              admin: { $sum: { $cond: [{ $eq: ["$sourceKey", "admin"] }, 1, 0] } },
              mod: { $sum: { $cond: [{ $eq: ["$sourceKey", "mod"] }, 1, 0] } },
              moderator: {
                $sum: { $cond: [{ $eq: ["$sourceKey", "moderator"] }, 1, 0] },
              },
              unknown: {
                $sum: { $cond: [{ $eq: ["$sourceKey", "unknown"] }, 1, 0] },
              },
              avgSingle: { $avg: "$singleLevel" },
              avgDouble: { $avg: "$doubleLevel" },
            },
          },
        ],
      },
    },
  ]).collation({ locale: "vi", strength: 1 });

  const total = result?.total?.[0]?.count || 0;
  res.json({
    rows: result?.rows || [],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary: result?.summary?.[0] || {
      total: 0,
      staff: 0,
      self: 0,
      admin: 0,
      mod: 0,
      moderator: 0,
      unknown: 0,
      avgSingle: null,
      avgDouble: null,
    },
    filters: {
      scoreBy: scoreByValues,
      sourceType,
      scorerRole,
      province,
      keyword,
    },
  });
});
