import mongoose from "mongoose";
import CheckpointMandate from "../models/checkpointMandateModel.js";
import User from "../models/userModel.js";

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

const ensureContactableUser = (user) => {
  if (user?.email || user?.phone) return;
  const error = new Error("User chưa có email hoặc số điện thoại để gửi checkpoint.");
  error.statusCode = 400;
  throw error;
};

export const normalizeCheckpointMandateForAdmin = (mandate = {}) => ({
  _id: String(mandate._id || ""),
  user: mandate.user
    ? {
        _id: String(mandate.user._id || mandate.user.id || mandate.user),
        name: mandate.user.name || "",
        nickname: mandate.user.nickname || "",
        email: mandate.user.email || "",
        phone: mandate.user.phone || "",
        avatar: mandate.user.avatar || "",
        role: mandate.user.role || "",
      }
    : null,
  level: Number(mandate.level || 1),
  status: mandate.status || "active",
  scope: mandate.scope || "next_login",
  reason: mandate.reason || "",
  note: mandate.note || "",
  expiresAt: mandate.expiresAt || null,
  createdBy: mandate.createdBy
    ? {
        _id: String(mandate.createdBy._id || mandate.createdBy.id || mandate.createdBy),
        name: mandate.createdBy.name || "",
        email: mandate.createdBy.email || "",
      }
    : null,
  cancelledBy: mandate.cancelledBy
    ? {
        _id: String(mandate.cancelledBy._id || mandate.cancelledBy.id || mandate.cancelledBy),
        name: mandate.cancelledBy.name || "",
        email: mandate.cancelledBy.email || "",
      }
    : null,
  cancelledAt: mandate.cancelledAt || null,
  consumedAt: mandate.consumedAt || null,
  consumedBySession: mandate.consumedBySession
    ? String(mandate.consumedBySession._id || mandate.consumedBySession)
    : "",
  createdAt: mandate.createdAt || null,
  updatedAt: mandate.updatedAt || null,
});

export async function resolveMandateUser({ identifier = "", userId = "" } = {}) {
  const cleanUserId = String(userId || "").trim();
  const cleanIdentifier = String(identifier || "").trim();
  if (cleanUserId && mongoose.isValidObjectId(cleanUserId)) {
    return User.findById(cleanUserId).select("-password");
  }

  if (!cleanIdentifier) return null;
  if (mongoose.isValidObjectId(cleanIdentifier)) {
    return User.findById(cleanIdentifier).select("-password");
  }

  const rx = new RegExp(`^${escapeRegex(cleanIdentifier)}$`, "i");
  return User.findOne({
    $or: [
      { email: rx },
      { phone: cleanIdentifier },
      { nickname: rx },
      { name: rx },
    ],
  }).select("-password");
}

export async function createCheckpointMandate({
  userId = "",
  identifier = "",
  level = 1,
  reason = "",
  note = "",
  expiresInHours = 72,
  expiresAt = null,
  createdBy = null,
} = {}) {
  const user = await resolveMandateUser({ userId, identifier });
  if (!user || user.isDeleted) {
    const error = new Error("Không tìm thấy user để áp checkpoint.");
    error.statusCode = 404;
    throw error;
  }
  ensureContactableUser(user);

  const resolvedLevel = clampInt(level, 1, 1, 3);
  const now = Date.now();
  const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;
  const finalExpiresAt =
    parsedExpiresAt && Number.isFinite(parsedExpiresAt.getTime()) && parsedExpiresAt.getTime() > now
      ? parsedExpiresAt
      : new Date(now + clampInt(expiresInHours, 72, 1, 24 * 30) * 60 * 60 * 1000);

  await CheckpointMandate.updateMany(
    {
      user: user._id,
      status: "active",
    },
    {
      $set: {
        status: "cancelled",
        cancelledBy: createdBy || null,
        cancelledAt: new Date(),
        note: "Được thay thế bởi manual checkpoint mới.",
      },
    }
  );

  const mandate = await CheckpointMandate.create({
    user: user._id,
    level: resolvedLevel,
    status: "active",
    scope: "next_login",
    reason: String(reason || "").trim() || `Admin yêu cầu checkpoint level ${resolvedLevel}`,
    note: String(note || "").trim(),
    expiresAt: finalExpiresAt,
    createdBy,
  });

  return CheckpointMandate.findById(mandate._id)
    .populate("user", "name nickname email phone avatar role")
    .populate("createdBy", "name email")
    .lean();
}

export async function getActiveCheckpointMandateForUser(userId) {
  if (!mongoose.isValidObjectId(String(userId || ""))) return null;
  const now = new Date();
  const expired = await CheckpointMandate.updateMany(
    {
      user: userId,
      status: "active",
      expiresAt: { $lte: now },
    },
    { $set: { status: "expired" } }
  );
  void expired;

  return CheckpointMandate.findOne({
    user: userId,
    status: "active",
    expiresAt: { $gt: now },
  })
    .sort({ level: -1, createdAt: -1 })
    .lean();
}

export async function listCheckpointMandates({
  page = 1,
  pageSize = 20,
  status = "",
  level = "",
  q = "",
} = {}) {
  const safePage = clampInt(page, 1, 1, 10000);
  const safePageSize = clampInt(pageSize, 20, 1, 100);
  const filter = {};
  if (["active", "consumed", "cancelled", "expired"].includes(status)) {
    filter.status = status;
  }
  const parsedLevel = Number.parseInt(level, 10);
  if ([1, 2, 3].includes(parsedLevel)) filter.level = parsedLevel;

  if (q) {
    const clean = String(q).trim();
    const rx = new RegExp(escapeRegex(clean), "i");
    const userFilter = {
      $or: [{ name: rx }, { nickname: rx }, { email: rx }, { phone: rx }],
    };
    if (mongoose.isValidObjectId(clean)) {
      userFilter.$or.push({ _id: new mongoose.Types.ObjectId(clean) });
    }
    const users = await User.find(userFilter).select("_id").limit(80).lean();
    filter.$or = [
      { reason: rx },
      { note: rx },
      ...(users.length ? [{ user: { $in: users.map((user) => user._id) } }] : []),
    ];
  }

  const [total, mandates] = await Promise.all([
    CheckpointMandate.countDocuments(filter),
    CheckpointMandate.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .populate("user", "name nickname email phone avatar role")
      .populate("createdBy", "name email")
      .populate("cancelledBy", "name email")
      .lean(),
  ]);

  return {
    mandates: mandates.map(normalizeCheckpointMandateForAdmin),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function cancelCheckpointMandate({ id, actorId = null, note = "" } = {}) {
  if (!mongoose.isValidObjectId(String(id || ""))) {
    const error = new Error("Mandate id không hợp lệ.");
    error.statusCode = 400;
    throw error;
  }

  const mandate = await CheckpointMandate.findById(id);
  if (!mandate) {
    const error = new Error("Không tìm thấy manual checkpoint.");
    error.statusCode = 404;
    throw error;
  }
  if (mandate.status !== "active") return mandate.toObject();

  mandate.status = "cancelled";
  mandate.cancelledBy = actorId || null;
  mandate.cancelledAt = new Date();
  if (note) mandate.note = note;
  await mandate.save();

  return CheckpointMandate.findById(mandate._id)
    .populate("user", "name nickname email phone avatar role")
    .populate("createdBy", "name email")
    .populate("cancelledBy", "name email")
    .lean();
}

export async function cancelActiveCheckpointMandatesForUser({
  userId,
  actorId = null,
  note = "",
} = {}) {
  if (!mongoose.isValidObjectId(String(userId || ""))) {
    return { matchedCount: 0, modifiedCount: 0 };
  }

  return CheckpointMandate.updateMany(
    {
      user: userId,
      status: "active",
    },
    {
      $set: {
        status: "cancelled",
        cancelledBy: actorId || null,
        cancelledAt: new Date(),
        note: String(note || "").trim() || "Admin mở checkpoint cho user.",
      },
    }
  );
}

export async function consumeCheckpointMandate({ id, sessionId = null } = {}) {
  if (!mongoose.isValidObjectId(String(id || ""))) return null;
  return CheckpointMandate.findOneAndUpdate(
    { _id: id, status: "active" },
    {
      $set: {
        status: "consumed",
        consumedAt: new Date(),
        consumedBySession: sessionId || null,
      },
    },
    { new: true }
  ).lean();
}
