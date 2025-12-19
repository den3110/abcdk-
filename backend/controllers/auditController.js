import asyncHandler from "express-async-handler";
import AuditLog from "../models/auditLogModel.js";
import User from "../models/userModel.js"; // ✅ chỉnh đúng path model User của bạn nếu khác

/* ================= Helpers ================= */
const clampInt = (v, min, max, def) => {
  const n = parseInt(v || "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
};

const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const escapeRegex = (s) =>
  String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * category -> match theo changes.field
 * (có thể đổi sang tags sau này để query nhanh hơn)
 */
const buildCategoryMatch = (category) => {
  const c = String(category || "")
    .trim()
    .toLowerCase();
  if (!c || c === "all") return null;

  const rx = (r) => new RegExp(r, "i");

  switch (c) {
    case "profile":
      return {
        $or: [
          { "changes.field": rx("^name$") },
          { "changes.field": rx("^nickname$") },
          { "changes.field": rx("^avatar$") },
          { "changes.field": rx("^cover$") },
          { "changes.field": rx("^dob$") },
          { "changes.field": rx("^gender$") },
          { "changes.field": rx("^province$") },
          { "changes.field": rx("^phone$") },
          { "changes.field": rx("^email$") },
          { "changes.field": rx("^profile\\.") },
        ],
      };

    case "kyc":
      return {
        $or: [
          { "changes.field": rx("cccd") },
          { "changes.field": rx("kyc") },
          { "changes.field": rx("verified") },
          { "changes.field": rx("cccdStatus") },
          { "changes.field": rx("cccdImages") },
        ],
      };

    case "security":
      return {
        $or: [
          { "changes.field": rx("^password$") },
          { "changes.field": rx("refreshToken") },
          { "changes.field": rx("accessToken") },
          { "changes.field": rx("tokens") },
        ],
      };

    case "ranking":
      return {
        $or: [
          { "changes.field": rx("^single$") },
          { "changes.field": rx("^double$") },
          { "changes.field": rx("rankingSearch") },
          { "changes.field": rx("ranking") },
        ],
      };

    case "permission":
      return {
        $or: [
          { "changes.field": rx("^role$") },
          { "changes.field": rx("^isSuperUser$") },
          { "changes.field": rx("^evaluator") },
        ],
      };

    default:
      return null;
  }
};

/* =========================================================
 * GET /api/audit/users/:userId
 * Admin/SuperUser: xem lịch sử chỉnh sửa của 1 user
 * Query:
 * - page (default 1)
 * - limit (default 30, max 100)
 * - actorId (lọc theo người sửa)
 * - field (lọc theo field, vd: "avatar", "province")
 * - action (lọc action: UPDATE/CREATE/DELETE/OTHER)
 * - category (profile/kyc/security/ranking/permission/all)
 * - from, to (YYYY-MM-DD hoặc ISO)
 * ========================================================= */
export const getUserProfileAudit = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const page = clampInt(req.query.page, 1, 100000, 1);
  const limit = clampInt(req.query.limit, 1, 100, 30);

  const actorId = String(req.query.actorId || "").trim();
  const field = String(req.query.field || "").trim();
  const action = String(req.query.action || "UPDATE").trim(); // giữ default như cũ
  const category = String(req.query.category || "").trim();

  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  const filter = {
    entityType: "User",
    entityId: userId,
  };

  // ✅ vẫn giữ hành vi cũ: mặc định chỉ UPDATE
  if (action) filter.action = action;

  if (actorId) filter["actor.id"] = actorId;
  if (field) filter["changes.field"] = field;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const catMatch = buildCategoryMatch(category);
  if (catMatch) Object.assign(filter, catMatch);

  const total = await AuditLog.countDocuments(filter);

  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/* =========================================================
 * GET /api/audit/users/summary
 * Nhóm theo user (entityId)
 * Query:
 * - page, limit
 * - q: tìm theo user name/email/phone/nickname hoặc userId
 * - action, category, from, to, actorId
 * ========================================================= */
export const getAuditUsersSummary = asyncHandler(async (req, res) => {
  const page = clampInt(req.query.page, 1, 100000, 1);
  const limit = clampInt(req.query.limit, 1, 100, 20);

  const q = String(req.query.q || "").trim();
  const action = String(req.query.action || "").trim(); // nếu rỗng => tất cả
  const category = String(req.query.category || "").trim();
  const actorId = String(req.query.actorId || "").trim();

  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  const match = { entityType: "User" };
  if (action) match.action = action;
  if (actorId) match["actor.id"] = actorId;

  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }

  const catMatch = buildCategoryMatch(category);
  if (catMatch) Object.assign(match, catMatch);

  // ✅ search theo user (name/email/phone/nickname) => lấy ids trước
  if (q) {
    const isObjectId = /^[a-f\d]{24}$/i.test(q);
    if (isObjectId) {
      match.entityId = q;
    } else {
      const rx = new RegExp(escapeRegex(q), "i");
      const found = await User.find(
        { $or: [{ name: rx }, { email: rx }, { phone: rx }, { nickname: rx }] },
        { _id: 1 }
      )
        .limit(500)
        .lean();

      const ids = found.map((x) => x._id);
      if (!ids.length) {
        return res.json({ page, limit, total: 0, pages: 0, items: [] });
      }
      match.entityId = { $in: ids };
    }
  }

  const skip = (page - 1) * limit;

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1 } }, // để lấy log mới nhất bằng $first
    {
      $group: {
        _id: "$entityId",
        total: { $sum: 1 },
        lastAt: { $first: "$createdAt" },
        lastAction: { $first: "$action" },
        lastChanges: { $first: "$changes" },

        updateCount: {
          $sum: { $cond: [{ $eq: ["$action", "UPDATE"] }, 1, 0] },
        },
        createCount: {
          $sum: { $cond: [{ $eq: ["$action", "CREATE"] }, 1, 0] },
        },
        deleteCount: {
          $sum: { $cond: [{ $eq: ["$action", "DELETE"] }, 1, 0] },
        },
        otherCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$action", "UPDATE"] },
                  { $ne: ["$action", "CREATE"] },
                  { $ne: ["$action", "DELETE"] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { lastAt: -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "users", // collection name default
              localField: "_id",
              foreignField: "_id",
              as: "user",
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              userId: "$_id",
              total: 1,
              lastAt: 1,
              lastAction: 1,
              updateCount: 1,
              createCount: 1,
              deleteCount: 1,
              otherCount: 1,
              lastFields: {
                $slice: [
                  {
                    $map: {
                      input: { $ifNull: ["$lastChanges", []] },
                      as: "c",
                      in: "$$c.field",
                    },
                  },
                  3,
                ],
              },
              user: {
                _id: "$user._id",
                name: "$user.name",
                email: "$user.email",
                role: "$user.role",
                phone: "$user.phone",
              },
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
  ];

  const agg = await AuditLog.aggregate(pipeline);
  const items = agg?.[0]?.items || [];
  const total = agg?.[0]?.meta?.[0]?.total || 0;

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/**
 * GET /api/audit/me
 * User tự xem lịch sử chỉnh sửa của chính mình
 * (bổ sung action/category/from/to y như bên admin để sau mở rộng)
 */
export const getMyProfileAudit = asyncHandler(async (req, res) => {
  const page = clampInt(req.query.page, 1, 100000, 1);
  const limit = clampInt(req.query.limit, 1, 100, 30);

  const action = String(req.query.action || "UPDATE").trim();
  const category = String(req.query.category || "").trim();

  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);

  const filter = {
    entityType: "User",
    entityId: req.user._id,
  };

  if (action) filter.action = action;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  const catMatch = buildCategoryMatch(category);
  if (catMatch) Object.assign(filter, catMatch);

  const total = await AuditLog.countDocuments(filter);

  const items = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/**
 * GET /api/audit/:id
 * Xem chi tiết 1 log (để hiển thị UI đẹp)
 */
export const getAuditDetail = asyncHandler(async (req, res) => {
  const log = await AuditLog.findById(req.params.id).lean();
  if (!log) {
    res.status(404);
    throw new Error("Không tìm thấy audit log");
  }
  res.json(log);
});
