import asyncHandler from "express-async-handler";
import Registration from "../../models/registrationModel.js";
import Tournament from "../../models/tournamentModel.js";
import User from "../../models/userModel.js";
import Ranking from "../../models/rankingModel.js";
import ScoreHistory from "../../models/scoreHistoryModel.js";
import AuditLog from "../../models/auditLogModel.js";
import { writeAuditLog } from "../../services/audit.service.js";

function isSinglesEvent(eventType) {
  const normalized = String(eventType || "").trim().toLowerCase();
  return normalized === "single" || normalized === "singles";
}

function getActorMeta(req) {
  return {
    actorId: req.user?._id || null,
    actorKind: req.user?.role || "user",
    ip: req.ip || "",
    userAgent: req.get("user-agent") || "",
  };
}

function buildDuplicateFilter({ tournamentId, playerIds, excludeRegId = null }) {
  const ids = (playerIds || []).filter(Boolean).map(String);
  const filter = {
    tournament: tournamentId,
    $or: [
      { "player1.user": { $in: ids } },
      { "player2.user": { $in: ids } },
    ],
  };

  if (excludeRegId) filter._id = { $ne: excludeRegId };
  return filter;
}

async function getCurrentScore(userId, eventType) {
  const scoreField = isSinglesEvent(eventType) ? "single" : "double";

  const latestScore = await ScoreHistory.findOne({
    user: userId,
    [scoreField]: { $ne: null },
  })
    .sort({ scoredAt: -1, createdAt: -1, _id: -1 })
    .select(scoreField)
    .lean();

  if (latestScore && typeof latestScore?.[scoreField] === "number") {
    return latestScore[scoreField];
  }

  const ranking = await Ranking.findOne({ user: userId }).select(scoreField).lean();
  if (ranking && typeof ranking?.[scoreField] === "number") {
    return ranking[scoreField];
  }

  return 0;
}

async function buildPlayerSnapshot(userId, eventType) {
  const user = await User.findById(userId)
    .select("name nickname nickName phone avatar")
    .lean();

  if (!user) {
    const error = new Error("Không tìm thấy vận động viên");
    error.statusCode = 400;
    throw error;
  }

  const score = await getCurrentScore(user._id, eventType);

  return {
    user: user._id,
    phone: user.phone || "",
    fullName: user.name || user.nickname || user.nickName || "",
    nickName: user.nickName || user.nickname || "",
    avatar: user.avatar || "",
    score,
  };
}

async function validateRegistrationInput({
  tournament,
  player1Id,
  player2Id,
  excludeRegId = null,
}) {
  if (!player1Id) {
    const error = new Error("Thiếu vận động viên 1");
    error.statusCode = 400;
    throw error;
  }

  const singles = isSinglesEvent(tournament?.eventType);
  if (singles) {
    if (player2Id) {
      const error = new Error("Giải đơn chỉ được phép chọn 1 vận động viên");
      error.statusCode = 400;
      throw error;
    }
  } else {
    if (!player2Id) {
      const error = new Error("Giải đôi cần 2 vận động viên");
      error.statusCode = 400;
      throw error;
    }
    if (String(player1Id) === String(player2Id)) {
      const error = new Error("Hai vận động viên phải khác nhau");
      error.statusCode = 400;
      throw error;
    }
  }

  const playerIds = singles ? [player1Id] : [player1Id, player2Id];
  const duplicate = await Registration.findOne(
    buildDuplicateFilter({
      tournamentId: tournament._id,
      playerIds,
      excludeRegId,
    })
  )
    .select("_id player1 player2")
    .lean();

  if (duplicate) {
    const error = new Error("Một trong các vận động viên đã có đăng ký ở giải này");
    error.statusCode = 400;
    throw error;
  }

  const player1 = await buildPlayerSnapshot(player1Id, tournament.eventType);
  const player2 = singles
    ? null
    : await buildPlayerSnapshot(player2Id, tournament.eventType);

  return { player1, player2, singles };
}

async function writeRegistrationAudit({
  req,
  registrationId,
  action,
  before = {},
  after = {},
  note = "",
}) {
  try {
    const actor = getActorMeta(req);
    await writeAuditLog({
      entityType: "Registration",
      entityId: registrationId,
      action,
      before,
      after,
      note,
      ...actor,
    });
  } catch (error) {
    console.error("AUDIT_LOG_ERROR(registration):", error?.message || error);
  }
}

/**
 * @desc    Create registration from admin
 * @route   POST /admin/tournaments/:id/registrations
 */
export const adminCreateRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    player1Id,
    player2Id = null,
    message = "",
    paymentStatus = "Unpaid",
  } = req.body || {};

  const tournament = await Tournament.findById(id);
  if (!tournament) {
    return res.status(404).json({ message: "Tournament not found" });
  }

  if (tournament.maxPairs && tournament.maxPairs > 0) {
    const currentCount = await Registration.countDocuments({ tournament: id });
    if (currentCount >= tournament.maxPairs) {
      return res.status(400).json({ message: "Giải đã đủ số cặp đăng ký" });
    }
  }

  if (!["Paid", "Unpaid"].includes(paymentStatus)) {
    return res.status(400).json({ message: "Invalid payment status" });
  }

  const { player1, player2 } = await validateRegistrationInput({
    tournament,
    player1Id,
    player2Id,
  });

  const registration = await Registration.create({
    tournament: id,
    player1,
    player2,
    message: String(message || "").trim(),
    payment: {
      status: paymentStatus,
      paidAt: paymentStatus === "Paid" ? new Date() : null,
    },
    createdBy: req.user?._id || null,
  });

  await Tournament.findByIdAndUpdate(id, {
    $inc: { registered: 1 },
    $set: { updatedAt: new Date() },
  });

  await writeRegistrationAudit({
    req,
    registrationId: registration._id,
    action: "CREATE",
    before: {},
    after: registration.toObject({ depopulate: true }),
    note: "adminCreateRegistration",
  });

  return res.status(201).json(registration);
});

/**
 * @desc    Update registration from admin
 * @route   PATCH /admin/tournaments/registrations/:regId
 */
export const adminUpdateRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const {
    player1Id,
    player2Id = null,
    message,
    paymentStatus,
  } = req.body || {};

  const registration = await Registration.findById(regId);
  if (!registration) {
    return res.status(404).json({ message: "Registration not found" });
  }

  const tournament = await Tournament.findById(registration.tournament);
  if (!tournament) {
    return res.status(404).json({ message: "Tournament not found" });
  }

  const before = registration.toObject({ depopulate: true });

  const nextPlayer1Id = player1Id || registration.player1?.user;
  const nextPlayer2Id = isSinglesEvent(tournament.eventType)
    ? null
    : player2Id || registration.player2?.user;

  const { player1, player2 } = await validateRegistrationInput({
    tournament,
    player1Id: nextPlayer1Id,
    player2Id: nextPlayer2Id,
    excludeRegId: registration._id,
  });

  registration.player1 = player1;
  registration.player2 = player2;

  if (typeof message === "string") {
    registration.message = message.trim();
  }

  if (paymentStatus !== undefined) {
    if (!["Paid", "Unpaid"].includes(paymentStatus)) {
      return res.status(400).json({ message: "Invalid payment status" });
    }
    registration.payment.status = paymentStatus;
    registration.payment.paidAt =
      paymentStatus === "Paid" ? registration.payment.paidAt || new Date() : null;
  }

  await registration.save();

  await writeRegistrationAudit({
    req,
    registrationId: registration._id,
    action: "UPDATE",
    before,
    after: registration.toObject({ depopulate: true }),
    note: "adminUpdateRegistration",
  });

  return res.json(registration);
});

/**
 * @desc    Approve or undo a registration payment (Admin)
 * @route   PUT /admin/tournaments/registrations/:regId/payment
 */
export const adminUpdatePayment = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { status } = req.body;

  if (!["Paid", "Unpaid"].includes(status)) {
    return res.status(400).json({ message: "Invalid payment status" });
  }

  const registration = await Registration.findById(regId);
  if (!registration) {
    return res.status(404).json({ message: "Registration not found" });
  }

  const before = registration.toObject({ depopulate: true });
  registration.payment.status = status;
  registration.payment.paidAt =
    status === "Paid" ? registration.payment.paidAt || new Date() : null;
  await registration.save();

  await writeRegistrationAudit({
    req,
    registrationId: registration._id,
    action: "UPDATE",
    before,
    after: registration.toObject({ depopulate: true }),
    note: "adminUpdatePayment",
  });

  return res.json(registration);
});

/**
 * @desc    Check-in a registration (Admin)
 * @route   PUT /admin/tournaments/registrations/:regId/checkin
 */
export const adminCheckin = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  reg.checkinAt = new Date();
  await reg.save();

  res.json(reg);
});

/**
 * @desc    Registration history (Admin)
 * @route   GET /admin/tournaments/registrations/:regId/history
 */
export const adminGetRegistrationHistory = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const [total, items] = await Promise.all([
    AuditLog.countDocuments({ entityType: "Registration", entityId: regId }),
    AuditLog.find({ entityType: "Registration", entityId: regId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("actor.id", "name nickname phone email")
      .lean(),
  ]);

  res.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    items,
  });
});

/**
 * @route   DELETE /admin/tournaments/registrations/:regId
 */
export const adminDeleteRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const before = reg.toObject({ depopulate: true });

  await Tournament.findByIdAndUpdate(reg.tournament, {
    $inc: { registered: -1 },
    $set: { updatedAt: new Date() },
  });

  await reg.deleteOne();

  await writeRegistrationAudit({
    req,
    registrationId: before._id,
    action: "DELETE",
    before,
    after: {},
    note: "adminDeleteRegistration",
  });

  res.json({ message: "Deleted", tournament: reg.tournament });
});

export const getRegistrationsAdmin = asyncHandler(async (req, res) => {
  const regs = await Registration.find({ tournament: req.params.id })
    .sort({ createdAt: -1 })
    .lean();

  const out = regs.map((r) => ({
    ...r,
    player1: r.player1 ? { ...r.player1 } : r.player1,
    player2: r.player2 ? { ...r.player2 } : r.player2,
  }));

  res.json(out);
});
