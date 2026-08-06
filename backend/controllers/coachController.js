// controllers/coachController.js
// Danh sách HLV public: user role=coach + coachProfile.isPublic, join Ranking
// sort theo max(double, single) desc. Trả kèm bio, phone, province, avatar.
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import CoachApplication from "../models/coachApplicationModel.js";
import CoachAchievement from "../models/coachAchievementModel.js";
import { encodeCursor, decodeCursor } from "../utils/cursor.js";

const isAdmin = (u) => u?.role === "admin" || u?.isAdmin || u?.isSuperUser;
const ACH_LEVELS = ["national", "regional", "local", "club", "other"];

const escapeRegex = (s = "") => String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

// GET /api/coaches?q=&province=&sort=rating&cursor=&limit=
export const listCoaches = asyncHandler(async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 20, 1),
    50,
  );
  const q = String(req.query.q || "").trim();
  const province = String(req.query.province || "").trim();
  const sort = String(req.query.sort || "rating");
  const cursor = decodeCursor(req.query.cursor);

  const userMatch = {
    isCoach: true,
    isDeleted: { $ne: true },
    "coachProfile.isPublic": { $ne: false },
  };
  if (province) userMatch.province = province;
  if (q) {
    const re = new RegExp(escapeRegex(q), "i");
    userMatch.$or = [{ name: re }, { nickname: re }];
  }

  const pipeline = [
    { $match: userMatch },
    {
      $lookup: {
        from: "rankings",
        localField: "_id",
        foreignField: "user",
        as: "ranking",
      },
    },
    { $unwind: { path: "$ranking", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        single: { $ifNull: ["$ranking.single", 0] },
        double: { $ifNull: ["$ranking.double", 0] },
        reputation: { $ifNull: ["$ranking.reputation", 0] },
        tierColor: "$ranking.tierColor",
        tierLabel: "$ranking.tierLabel",
        maxRating: {
          $max: [
            { $ifNull: ["$ranking.double", 0] },
            { $ifNull: ["$ranking.single", 0] },
          ],
        },
      },
    },
  ];

  // Cursor sort trên (maxRating desc, _id desc) — tie-break bằng _id để stable
  if (sort === "rating") {
    if (cursor?.payload?.lastRating != null && cursor?.payload?.lastId) {
      pipeline.push({
        $match: {
          $or: [
            { maxRating: { $lt: Number(cursor.payload.lastRating) } },
            {
              maxRating: Number(cursor.payload.lastRating),
              _id: { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) },
            },
          ],
        },
      });
    }
    pipeline.push({ $sort: { maxRating: -1, _id: -1 } });
  } else {
    // Sort mặc định theo createdAt (mới lên trước)
    if (cursor?.payload?.lastId) {
      pipeline.push({
        $match: {
          _id: { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) },
        },
      });
    }
    pipeline.push({ $sort: { _id: -1 } });
  }

  pipeline.push({ $limit: limit + 1 });
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      nickname: 1,
      avatar: 1,
      bio: 1,
      phone: 1,
      gender: 1,
      province: 1,
      single: 1,
      double: 1,
      reputation: 1,
      tierColor: 1,
      tierLabel: 1,
      coachProfile: 1,
      maxRating: 1,
    },
  });

  const docs = await User.aggregate(pipeline);
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          sort === "rating"
            ? { lastRating: last.maxRating, lastId: String(last._id) }
            : { lastId: String(last._id) },
        )
      : null;

  res.json({ items, nextCursor, hasMore });
});

// GET /api/coaches/provinces — list các tỉnh có HLV để filter dropdown
export const listCoachProvinces = asyncHandler(async (req, res) => {
  const provinces = await User.distinct("province", {
    isCoach: true,
    isDeleted: { $ne: true },
    "coachProfile.isPublic": { $ne: false },
    province: { $exists: true, $ne: "" },
  });
  res.json({ items: provinces.filter(Boolean).sort() });
});

/* ─────────────────── APPLICATION ─────────────────── */

// POST /api/coaches/apply — user submit đơn đăng ký làm HLV
// body: { headline, experienceYears, specialties, hourlyRate, bio, phone, note, achievements: [...] }
export const applyToBeCoach = asyncHandler(async (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(401);
    throw new Error("Cần đăng nhập");
  }

  // Nếu đã là HLV → không cần đăng ký nữa
  const currentUser = await User.findById(viewer._id);
  if (!currentUser) {
    res.status(404);
    throw new Error("Không tìm thấy user");
  }
  if (currentUser.isCoach) {
    res.status(400);
    throw new Error("Bạn đã là huấn luyện viên");
  }

  // Kiểm tra đơn pending đang tồn tại
  const existingPending = await CoachApplication.findOne({
    user: viewer._id,
    status: "pending",
  });
  if (existingPending) {
    res.status(400);
    throw new Error("Bạn đã có đơn đăng ký đang chờ duyệt");
  }

  const {
    headline = "",
    experienceYears = 0,
    specialties = [],
    hourlyRate = 0,
    bio = "",
    phone = "",
    note = "",
    achievements = [],
  } = req.body || {};

  const app = await CoachApplication.create({
    user: viewer._id,
    status: "pending",
    headline: String(headline).slice(0, 200),
    experienceYears: Math.max(0, Math.min(100, Number(experienceYears) || 0)),
    specialties: Array.isArray(specialties)
      ? specialties.slice(0, 10).map((s) => String(s).slice(0, 60))
      : [],
    hourlyRate: Math.max(0, Number(hourlyRate) || 0),
    bio: String(bio).slice(0, 2000),
    phone: String(phone).slice(0, 40),
    note: String(note).slice(0, 1000),
    proposedAchievements: Array.isArray(achievements)
      ? achievements.slice(0, 30).map((a) => ({
          title: String(a?.title || "").slice(0, 200),
          year:
            Number.isFinite(Number(a?.year)) && Number(a?.year) >= 1900
              ? Number(a.year)
              : undefined,
          level: ACH_LEVELS.includes(a?.level) ? a.level : "other",
          description: String(a?.description || "").slice(0, 1000),
        }))
      : [],
  });

  res.status(201).json(app);
});

// GET /api/coaches/my-application — check status đơn của mình
export const getMyCoachApplication = asyncHandler(async (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(401);
    throw new Error("Cần đăng nhập");
  }
  const app = await CoachApplication.findOne({ user: viewer._id })
    .sort({ createdAt: -1 })
    .populate("reviewedBy", "_id name nickname avatar")
    .lean();
  res.json(app || null);
});

// DELETE /api/coaches/my-application — huỷ đơn pending của mình
export const cancelMyCoachApplication = asyncHandler(async (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(401);
    throw new Error("Cần đăng nhập");
  }
  const app = await CoachApplication.findOneAndUpdate(
    { user: viewer._id, status: "pending" },
    { $set: { status: "cancelled" } },
    { new: true },
  );
  if (!app) {
    res.status(404);
    throw new Error("Không có đơn đang chờ duyệt");
  }
  res.json({ success: true });
});

/* ─────────────────── ACHIEVEMENTS ─────────────────── */

// GET /api/coaches/:userId/achievements  — public list (approved only for guests;
// owner + admin thấy cả pending/rejected)
export const listCoachAchievements = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("userId không hợp lệ");
  }
  const viewer = req.user;
  const isSelf = String(viewer?._id) === String(userId);
  const canSeeAll = isSelf || isAdmin(viewer);

  const q = { coach: userId };
  if (!canSeeAll) q.status = "approved";
  const items = await CoachAchievement.find(q)
    .sort({ status: 1, year: -1, createdAt: -1 })
    .populate("createdBy", "_id name nickname avatar")
    .populate("reviewedBy", "_id name nickname avatar")
    .lean();
  res.json({ items });
});

// POST /api/coaches/achievements — HLV tự bổ sung thành tích mới (pending)
// body: { title, year, level, description, imageUrl?, tournamentRef? }
export const createCoachAchievement = asyncHandler(async (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(401);
    throw new Error("Cần đăng nhập");
  }
  const currentUser = await User.findById(viewer._id);
  if (!currentUser?.isCoach) {
    res.status(403);
    throw new Error("Chỉ HLV mới được bổ sung thành tích");
  }

  const { title, year, level, description, imageUrl, tournamentRef } =
    req.body || {};
  if (!title || !String(title).trim()) {
    res.status(400);
    throw new Error("Thiếu tiêu đề thành tích");
  }

  const doc = await CoachAchievement.create({
    coach: viewer._id,
    title: String(title).slice(0, 200),
    year:
      Number.isFinite(Number(year)) && Number(year) >= 1900
        ? Number(year)
        : undefined,
    level: ACH_LEVELS.includes(level) ? level : "other",
    description: String(description || "").slice(0, 1000),
    imageUrl: String(imageUrl || "").slice(0, 500),
    tournamentRef:
      tournamentRef && mongoose.isValidObjectId(tournamentRef)
        ? tournamentRef
        : null,
    status: "pending",
    createdBy: viewer._id,
  });
  res.status(201).json(doc);
});

// DELETE /api/coaches/achievements/:id  — HLV xoá thành tích pending của mình
export const deleteMyCoachAchievement = asyncHandler(async (req, res) => {
  const viewer = req.user;
  if (!viewer) {
    res.status(401);
    throw new Error("Cần đăng nhập");
  }
  const doc = await CoachAchievement.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  const isOwner = String(doc.coach) === String(viewer._id);
  if (!isOwner && !isAdmin(viewer)) {
    res.status(403);
    throw new Error("Không có quyền xoá");
  }
  // Chỉ owner được xoá khi vẫn pending; admin có thể xoá bất kỳ status nào
  if (isOwner && !isAdmin(viewer) && doc.status !== "pending") {
    res.status(400);
    throw new Error("Chỉ xoá được thành tích đang chờ duyệt");
  }
  await doc.deleteOne();
  res.json({ success: true });
});

/* ─────────────────── ADMIN: APPLICATIONS ─────────────────── */

// GET /api/admin/coach-applications?status=pending&cursor=&limit=
export const adminListCoachApplications = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const status = req.query.status;
  const cursor = decodeCursor(req.query.cursor);

  const q = {};
  if (status && ["pending", "approved", "rejected", "cancelled"].includes(status))
    q.status = status;
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }

  const docs = await CoachApplication.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("user", "_id name nickname avatar phone email province")
    .populate("reviewedBy", "_id name nickname avatar");

  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// POST /api/admin/coach-applications/:id/approve — duyệt: set isCoach + import achievements
export const adminApproveCoachApplication = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const app = await CoachApplication.findById(req.params.id);
  if (!app || app.status !== "pending") {
    res.status(404);
    throw new Error("Đơn không tồn tại hoặc đã xử lý");
  }
  const user = await User.findById(app.user);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy user");
  }

  // Set isCoach + copy coachProfile fields
  user.isCoach = true;
  user.coachProfile = user.coachProfile || {};
  user.coachProfile.headline = app.headline || user.coachProfile.headline || "";
  user.coachProfile.experienceYears =
    app.experienceYears || user.coachProfile.experienceYears || 0;
  user.coachProfile.specialties =
    app.specialties?.length > 0
      ? app.specialties
      : user.coachProfile.specialties || [];
  user.coachProfile.hourlyRate =
    app.hourlyRate || user.coachProfile.hourlyRate || 0;
  user.coachProfile.isPublic = true;
  if (app.bio && !user.bio) user.bio = app.bio;
  if (app.phone && !user.phone) user.phone = app.phone;
  await user.save();

  // Import proposed achievements → CoachAchievement approved
  const bulkOps = (app.proposedAchievements || []).map((a) => ({
    insertOne: {
      document: {
        coach: user._id,
        title: a.title,
        year: a.year,
        level: a.level || "other",
        description: a.description || "",
        status: "approved",
        createdBy: user._id,
        sourceApplication: app._id,
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
      },
    },
  }));
  if (bulkOps.length) await CoachAchievement.bulkWrite(bulkOps);

  app.status = "approved";
  app.adminNote = String(req.body?.adminNote || "").slice(0, 1000);
  app.reviewedBy = req.user._id;
  app.reviewedAt = new Date();
  await app.save();

  res.json({ success: true, application: app });
});

// POST /api/admin/coach-applications/:id/reject
export const adminRejectCoachApplication = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const app = await CoachApplication.findById(req.params.id);
  if (!app || app.status !== "pending") {
    res.status(404);
    throw new Error("Đơn không tồn tại hoặc đã xử lý");
  }
  app.status = "rejected";
  app.adminNote = String(req.body?.adminNote || "").slice(0, 1000);
  app.reviewedBy = req.user._id;
  app.reviewedAt = new Date();
  await app.save();
  res.json({ success: true, application: app });
});

/* ─────────────────── ADMIN: ACHIEVEMENTS ─────────────────── */

// GET /api/admin/coach-achievements?status=pending&coach=&cursor=&limit=
export const adminListCoachAchievements = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const status = req.query.status;
  const coach = req.query.coach;
  const cursor = decodeCursor(req.query.cursor);

  const q = {};
  if (status && ["pending", "approved", "rejected"].includes(status))
    q.status = status;
  if (coach && mongoose.isValidObjectId(coach)) q.coach = coach;
  if (cursor?.payload?.lastId && mongoose.isValidObjectId(cursor.payload.lastId)) {
    q._id = { $lt: new mongoose.Types.ObjectId(cursor.payload.lastId) };
  }

  const docs = await CoachAchievement.find(q)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate("coach", "_id name nickname avatar phone province")
    .populate("createdBy", "_id name nickname avatar")
    .populate("reviewedBy", "_id name nickname avatar");
  const hasMore = docs.length > limit;
  const items = docs.slice(0, limit);
  const nextCursor = hasMore
    ? encodeCursor({ lastId: String(docs[limit - 1]._id) })
    : null;
  res.json({ items, nextCursor, hasMore });
});

// POST /api/admin/coach-achievements/:id/approve
export const adminApproveCoachAchievement = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const doc = await CoachAchievement.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        status: "approved",
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        adminNote: String(req.body?.adminNote || "").slice(0, 500),
      },
    },
    { new: true },
  );
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  res.json({ success: true, achievement: doc });
});

// POST /api/admin/coach-achievements/:id/reject
export const adminRejectCoachAchievement = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const doc = await CoachAchievement.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        status: "rejected",
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        adminNote: String(req.body?.adminNote || "").slice(0, 500),
      },
    },
    { new: true },
  );
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  res.json({ success: true, achievement: doc });
});

// PATCH /api/admin/coach-achievements/:id — admin edit
export const adminUpdateCoachAchievement = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const { title, year, level, description, imageUrl, status } = req.body || {};
  const $set = {};
  if (title != null) $set.title = String(title).slice(0, 200);
  if (year != null && Number.isFinite(Number(year)))
    $set.year = Number(year);
  if (level && ACH_LEVELS.includes(level)) $set.level = level;
  if (description != null)
    $set.description = String(description).slice(0, 1000);
  if (imageUrl != null) $set.imageUrl = String(imageUrl).slice(0, 500);
  if (status && ["pending", "approved", "rejected"].includes(status)) {
    $set.status = status;
    $set.reviewedBy = req.user._id;
    $set.reviewedAt = new Date();
  }
  const doc = await CoachAchievement.findByIdAndUpdate(
    req.params.id,
    { $set },
    { new: true },
  );
  if (!doc) {
    res.status(404);
    throw new Error("Không tìm thấy");
  }
  res.json({ success: true, achievement: doc });
});

// POST /api/admin/coach-achievements — admin tạo trực tiếp cho 1 coach (auto-approved)
export const adminCreateCoachAchievement = asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin");
  }
  const { coachId, title, year, level, description, imageUrl } = req.body || {};
  if (!coachId || !mongoose.isValidObjectId(coachId)) {
    res.status(400);
    throw new Error("coachId không hợp lệ");
  }
  if (!title) {
    res.status(400);
    throw new Error("Thiếu title");
  }
  const doc = await CoachAchievement.create({
    coach: coachId,
    title: String(title).slice(0, 200),
    year:
      Number.isFinite(Number(year)) && Number(year) >= 1900
        ? Number(year)
        : undefined,
    level: ACH_LEVELS.includes(level) ? level : "other",
    description: String(description || "").slice(0, 1000),
    imageUrl: String(imageUrl || "").slice(0, 500),
    status: "approved",
    createdBy: req.user._id,
    reviewedBy: req.user._id,
    reviewedAt: new Date(),
  });
  res.status(201).json(doc);
});
