import asyncHandler from "express-async-handler";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import AuditLog from "../models/auditLogModel.js";
import Complaint from "../models/complaintModel.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import mongoose from "mongoose";
import Match from "../models/matchModel.js";
import { canManageTournament } from "../utils/tournamentAuth.js";
import expressAsyncHandler from "express-async-handler";
import TournamentManager from "../models/tournamentManagerModel.js";
import Ranking from "../models/rankingModel.js";
import {
  CATEGORY,
  EVENTS,
  publishNotification,
} from "../services/notifications/notificationHub.js";
import { writeAuditLog } from "../services/audit.service.js";
import { queueUserAvatarOptimizationById } from "../services/userAvatarOptimization.service.js";
import {
  canManageTeamFaction,
  findTeamFaction,
  isTeamTournament,
} from "../services/teamTournament.service.js";
import { sanitizeRatingsObj } from "../utils/privacyControl.js";

const hasPositiveScore = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};
const normalizeTournamentScore = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};
const isMaleGender = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "male" || normalized === "nam";
};
const effectiveTournamentScoreForUser = (value) => {
  return normalizeTournamentScore(value);
};

const getRegistrationActorMeta = (req) => ({
  actorId: req.user?._id || null,
  actorKind: isAdminUser(req.user) ? "admin" : req.user?.role || "user",
  ip: req.ip || "",
  userAgent: req.get("user-agent") || "",
});

async function writeRegistrationAudit(req, {
  registrationId,
  action,
  before = {},
  after = {},
  note = "",
  extraChanges = [],
}) {
  if (!registrationId) return;
  try {
    await writeAuditLog({
      entityType: "Registration",
      entityId: registrationId,
      action,
      before,
      after,
      note,
      extraChanges,
      ...getRegistrationActorMeta(req),
    });
  } catch (err) {
    console.error("AUDIT_LOG_ERROR(registration):", err?.message || err);
  }
}

const asIdString = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || value);
  return String(value);
};

const actorPayload = (value, fallbackKind = "user") => {
  const user = value && typeof value === "object" ? value : null;
  return {
    id: asIdString(user),
    kind: fallbackKind || "user",
    name: user?.nickname || user?.name || user?.email || "",
    phone: user?.phone || "",
  };
};

const auditActorPayload = (audit) => {
  const actor = audit?.actor || {};
  const user = actor?.id && typeof actor.id === "object" ? actor.id : null;
  return {
    id: asIdString(user || actor.id),
    kind: actor.kind || "user",
    name: user?.nickname || user?.name || user?.email || "",
    phone: user?.phone || "",
  };
};

const findAuditChange = (audit, field) =>
  (audit?.changes || []).find((change) => change?.field === field);

const auditValue = (audit, field, preferred = "to") => {
  const change = findAuditChange(audit, field);
  if (!change) return undefined;
  const first = preferred === "from" ? change.from : change.to;
  const second = preferred === "from" ? change.to : change.from;
  return first ?? second;
};

const auditPlayerValue = (audit, slot, preferred = "to") => {
  const direct = auditValue(audit, slot, preferred);
  if (direct) return direct;
  const fullName = auditValue(audit, `${slot}.fullName`, preferred);
  const nickName = auditValue(audit, `${slot}.nickName`, preferred);
  const nickname = auditValue(audit, `${slot}.nickname`, preferred);
  return { fullName, nickName, nickname };
};

const normalizePaymentStatusLabel = (status) => {
  if (status === "Paid") return "Đã thanh toán";
  if (status === "Unpaid") return "Chưa thanh toán";
  if (status === "Đã nộp") return "Đã nộp";
  if (status === "Chưa nộp") return "Chưa nộp";
  return status || "Chưa rõ";
};

const playerNameOf = (player) =>
  String(player?.nickName || player?.nickname || player?.fullName || player?.name || "")
    .trim();

const formatHistoryDateTime = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("vi-VN");
};

const formatShortValue = (value) => {
  if (value === undefined || value === null || value === "") return "trống";
  if (value instanceof Date) return formatHistoryDateTime(value);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") {
    const playerName = playerNameOf(value);
    if (playerName) return playerName;
    if (value._id || value.id) return String(value._id || value.id);
    return "đã cập nhật";
  }
  return String(value);
};

const changedText = (label, change, formatter = formatShortValue) => {
  const from = formatter(change?.from);
  const to = formatter(change?.to);
  if (from === to) return `${label}: ${to}`;
  return `${label}: ${from} → ${to}`;
};

const playerChangeText = (label, change) =>
  changedText(label, change, (value) => playerNameOf(value) || formatShortValue(value));

const registrationPayloadFrom = (registration, audit) => {
  const code =
    registration?.code ??
    auditValue(audit, "code", audit?.action === "DELETE" ? "from" : "to");
  const p1 =
    playerNameOf(registration?.player1) ||
    playerNameOf(auditPlayerValue(audit, "player1", audit?.action === "DELETE" ? "from" : "to")) ||
    auditValue(audit, "player1.nickName", "from") ||
    auditValue(audit, "player1.nickname", "from") ||
    auditValue(audit, "player1.fullName", "from") ||
    "";
  const p2 =
    playerNameOf(registration?.player2) ||
    playerNameOf(auditPlayerValue(audit, "player2", audit?.action === "DELETE" ? "from" : "to")) ||
    auditValue(audit, "player2.nickName", "from") ||
    auditValue(audit, "player2.nickname", "from") ||
    auditValue(audit, "player2.fullName", "from") ||
    "";
  const players = [p1, p2].filter(Boolean).join(" & ");

  return {
    id: asIdString(registration?._id || audit?.entityId),
    code: code ?? null,
    players,
  };
};

const auditTitleFor = (audit) => {
  const note = String(audit?.note || "");
  const lowerNote = note.toLowerCase();
  if (audit.action === "CREATE" || note.includes("Create")) return "Tạo đăng ký";
  if (note.includes("Payment") || findAuditChange(audit, "payment.status")) {
    return "Cập nhật thanh toán";
  }
  if (note.includes("Checkin") || note.includes("checkin")) return "Check-in";
  if (audit.action === "DELETE" || note.includes("Delete") || note.includes("Cancel")) {
    return lowerNote.includes("cancel") ? "Hủy đăng ký" : "Xóa đăng ký";
  }
  return "Cập nhật đăng ký";
};

const auditTypeFor = (audit) => {
  const note = String(audit?.note || "");
  if (audit.action === "CREATE" || note.includes("Create")) return "registration_created";
  if (note.includes("Payment") || findAuditChange(audit, "payment.status")) {
    const to = findAuditChange(audit, "payment.status")?.to;
    return to === "Paid" ? "payment_paid" : "payment_updated";
  }
  if (note.includes("Checkin") || note.includes("checkin")) return "checkin";
  if (audit.action === "DELETE" || note.includes("Delete") || note.includes("Cancel")) {
    return "registration_cancelled";
  }
  return "registration_updated";
};

const auditDetailsFor = (audit) => {
  const details = [];
  const paymentStatus = findAuditChange(audit, "payment.status");
  if (paymentStatus) {
    details.push(
      `Thanh toán: ${normalizePaymentStatusLabel(paymentStatus.from)} → ${normalizePaymentStatusLabel(paymentStatus.to)}`
    );
  }
  const paidAt = findAuditChange(audit, "payment.paidAt");
  if (paidAt?.to) details.push(`Thời điểm thanh toán: ${new Date(paidAt.to).toLocaleString("vi-VN")}`);
  const checkinAt = findAuditChange(audit, "checkinAt");
  if (checkinAt?.to) details.push(`Check-in lúc: ${new Date(checkinAt.to).toLocaleString("vi-VN")}`);
  const player1 = findAuditChange(audit, "player1");
  if (player1) {
    details.push(playerChangeText("VĐV 1", player1));
  }
  const player2 = findAuditChange(audit, "player2");
  if (player2) {
    details.push(playerChangeText("VĐV 2", player2));
  }
  const player1Name =
    findAuditChange(audit, "player1.nickName") ||
    findAuditChange(audit, "player1.nickname") ||
    findAuditChange(audit, "player1.fullName");
  if (player1Name) details.push(changedText("Tên VĐV 1", player1Name));
  const player2Name =
    findAuditChange(audit, "player2.nickName") ||
    findAuditChange(audit, "player2.nickname") ||
    findAuditChange(audit, "player2.fullName");
  if (player2Name) details.push(changedText("Tên VĐV 2", player2Name));
  const player1Score = findAuditChange(audit, "player1.score");
  if (player1Score) details.push(changedText("Điểm VĐV 1", player1Score));
  const player2Score = findAuditChange(audit, "player2.score");
  if (player2Score) details.push(changedText("Điểm VĐV 2", player2Score));
  const player1Avatar = findAuditChange(audit, "player1.avatar");
  if (player1Avatar) details.push("Ảnh VĐV 1 được cập nhật");
  const player2Avatar = findAuditChange(audit, "player2.avatar");
  if (player2Avatar) details.push("Ảnh VĐV 2 được cập nhật");
  const teamFaction = findAuditChange(audit, "teamFactionName");
  if (teamFaction) details.push(changedText("Phe/đội", teamFaction));
  const message = findAuditChange(audit, "message");
  if (message) details.push(changedText("Ghi chú", message));
  if (!details.length && audit?.changes?.length) {
    details.push(`${audit.changes.length} trường được cập nhật`);
  }
  return details;
};

/* Tạo đăng ký */
// POST /api/tournaments/:id/registrations
export const createRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message, player1Id, player2Id, teamFactionId } = req.body || {};

  /* ─ 1) Tournament ─ */
  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  if (tour.isTest === true && !isAdminUser(req.user)) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const teamMode = isTeamTournament(tour);
  const activeFaction = teamMode ? findTeamFaction(tour, teamFactionId) : null;
  if (teamMode && !activeFaction) {
    res.status(400);
    throw new Error("Giải đồng đội yêu cầu chọn phe hợp lệ");
  }
  if (teamMode) {
    const allowed = await canManageTeamFaction({
      user: req.user,
      tournament: tour,
      factionId: teamFactionId,
    });
    if (!allowed) {
      res.status(403);
      throw new Error(
        "Chỉ đội trưởng của phe này hoặc quản lý giải mới được thêm roster"
      );
    }
  }

  // chuẩn hoá eventType: singles | doubles
  const et = String(tour.eventType || "").toLowerCase();
  const isSingles = et === "single" || et === "singles";
  const isDoubles = et === "double" || et === "doubles";

  /* ─ 2) Giới hạn số cặp ─ */
  if (tour.maxPairs && tour.maxPairs > 0) {
    const currentCount = await Registration.countDocuments({ tournament: id });
    if (currentCount >= tour.maxPairs) {
      res.status(400);
      throw new Error("Giải đã đủ số cặp đăng ký");
    }
  }

  /* ─ 3) Khung thời gian đăng ký ─ */
  const now = Date.now();
  const openAt =
    tour.regOpenDate instanceof Date
      ? tour.regOpenDate.getTime()
      : +tour.regOpenDate;
  const deadline =
    tour.registrationDeadline instanceof Date
      ? tour.registrationDeadline.getTime()
      : +tour.registrationDeadline;
  if (!openAt || !deadline || now < openAt || now > deadline) {
    res.status(400);
    throw new Error("Giải chưa mở hoặc đã hết hạn đăng ký");
  }

  /* ─ 4) Validate input theo loại giải ─ */
  if (!player1Id) {
    res.status(400);
    throw new Error("Thiếu VĐV 1");
  }
  if (isSingles) {
    if (player2Id) {
      res.status(400);
      throw new Error("Giải đơn chỉ cho phép 1 VĐV");
    }
  } else if (isDoubles) {
    if (!player2Id) {
      res.status(400);
      throw new Error("Giải đôi cần 2 VĐV");
    }
    if (String(player1Id) === String(player2Id)) {
      res.status(400);
      throw new Error("Hai VĐV phải khác nhau");
    }
  }

  /* ─ 5) Lấy thông tin user ─ */
  const userIds = isSingles ? [player1Id] : [player1Id, player2Id];
  const users = await User.find({ _id: { $in: userIds } }).select(
    // cần thêm cccdStatus/cccd để kiểm tra xác thực
    "name nickname phone avatar province gender cccd cccdStatus",
  );
  if (users.length !== userIds.length) {
    res.status(400);
    throw new Error("Không tìm thấy VĐV hợp lệ");
  }

  // map theo id để lấy đúng thứ tự
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const u1 = byId.get(String(player1Id));
  const u2 = isDoubles ? byId.get(String(player2Id)) : null;

  /* ─ 6) YÊU CẦU: CCCD đã xác thực ─ */
  // const notVerified = [];
  // if (u1?.cccdStatus !== "verified") notVerified.push("VĐV 1");
  // if (isDoubles && ( u2?.cccdStatus !== "verified"))
  //   notVerified.push("VĐV 2");
  // if (notVerified.length) {
  //   // dùng 412 để FE phân biệt điều kiện tiên quyết

  //   // bạn có thể đổi message nếu muốn FE match code riêng
  //   throw new Error(
  //     notVerified.length === 1
  //       ? `${notVerified[0]} cần xác thực CCCD trước khi đăng ký`
  //       : `${notVerified.join(" và ")} cần xác thực CCCD trước khi đăng ký`
  //   );
  // }

  /* ─ 7) Kiểm tra đã đăng ký ─ */
  const orConds = isSingles
    ? [{ "player1.user": player1Id }, { "player2.user": player1Id }]
    : [
        { "player1.user": { $in: [player1Id, player2Id] } },
        { "player2.user": { $in: [player1Id, player2Id] } },
      ];

  const alreadyReg = await Registration.findOne({
    tournament: id,
    $or: orConds,
  }).lean();

  if (alreadyReg) {
    // Tìm nickname VĐV đã đăng ký để hiển thị chi tiết
    const dupeNames = [];
    const p1u = alreadyReg.player1?.user
      ? String(alreadyReg.player1.user)
      : null;
    const p2u = alreadyReg.player2?.user
      ? String(alreadyReg.player2.user)
      : null;
    const uidStrs = userIds.map(String);
    if (p1u && uidStrs.includes(p1u)) {
      dupeNames.push(
        alreadyReg.player1.nickName || alreadyReg.player1.fullName || "VĐV",
      );
    }
    if (p2u && uidStrs.includes(p2u)) {
      dupeNames.push(
        alreadyReg.player2?.nickName || alreadyReg.player2?.fullName || "VĐV",
      );
    }

    let msg;
    if (isSingles) {
      msg = "Bạn đã đăng ký giải đấu rồi";
    } else if (dupeNames.length >= 2) {
      msg = "Cả 2 VĐV đã đăng ký giải đấu rồi";
    } else {
      const who = dupeNames[0] || "VĐV";
      msg = `Vận động viên ${who} đã đăng ký giải đấu rồi`;
    }
    res.status(400);
    throw new Error(msg);
  }

  /* ─ 8) Điểm trình mới nhất ─ */
  const scores = await ScoreHistory.aggregate([
    {
      $match: {
        user: {
          $in: userIds.map((x) => new mongoose.Types.ObjectId(String(x))),
        },
      },
    },
    { $sort: { scoredAt: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);
  const map = Object.fromEntries(scores.map((s) => [String(s._id), s]));
  const ranks = await getRanksMap(userIds);
  const key = isDoubles ? "double" : "single";
  const scoreFor = (userId, user) => {
    const rankingScore = ranks.get(String(userId))?.[key];
    if (hasPositiveScore(rankingScore)) {
      return effectiveTournamentScoreForUser(rankingScore, user);
    }
    const historyScore = map[String(userId)]?.[key];
    if (hasPositiveScore(historyScore)) {
      return effectiveTournamentScoreForUser(historyScore, user);
    }
    return effectiveTournamentScoreForUser(null, user);
  };
  const s1 = scoreFor(player1Id, u1);
  const s2 = isDoubles
    ? scoreFor(player2Id, u2)
    : 0;

  /* ─ 9) Validate điểm trình ─ */
  const noPointCap = Number(tour.scoreCap) === 0;

  if (!noPointCap && !tour.allowExceedMaxRating) {
    if (typeof tour.singleCap === "number" && tour.singleCap > 0) {
      if (
        Math.round(s1 * 1000) > Math.round(tour.singleCap * 1000) ||
        (isDoubles && Math.round(s2 * 1000) > Math.round(tour.singleCap * 1000))
      ) {
        res.status(400);
        throw new Error("Điểm của 1 VĐV vượt giới hạn");
      }
    }

    if (isDoubles && Number(tour.scoreCap) > 0) {
      const gap = Number(tour.scoreGap) || 0;
      if (
        Math.round((s1 + s2) * 1000) >
        Math.round((Number(tour.scoreCap) + gap) * 1000)
      ) {
        res.status(400);
        throw new Error("Tổng điểm đôi vượt giới hạn của giải");
      }
    }
  }

  /* ─ 10) Chuẩn hoá player object & lưu ─ */
  const player1 = {
    user: u1._id,
    fullName: u1.name || u1.nickname, // fallback tránh rỗng
    nickName: u1.nickname || "",
    phone: u1.phone,
    avatar: u1.avatar,
    province: u1.province,
    score: s1,
  };
  const player2 = isDoubles
    ? {
        user: u2._id,
        fullName: u2.name || u2.nickname,
        nickName: u2.nickname || "",
        phone: u2.phone,
        avatar: u2.avatar,
        province: u2.province,
        score: s2,
      }
    : null;

  const reg = await Registration.create({
    tournament: id,
    teamFactionId: teamMode ? activeFaction._id : null,
    teamFactionName: teamMode ? activeFaction.name : "",
    message: message || "",
    player1,
    player2,
    payment:
      tour.isFreeRegistration === true
        ? { status: "Paid", paidAt: new Date() }
        : { status: "Unpaid" },
    createdBy: req.user._id,
  });

  await Tournament.updateOne(
    { _id: id },
    { $inc: { registered: 1 }, $set: { updatedAt: new Date() } },
  );

  await writeRegistrationAudit(req, {
    registrationId: reg._id,
    action: "CREATE",
    before: {},
    after: reg.toObject({ depopulate: true }),
    note: "createRegistration",
  });

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
// controllers/registrationController.js
export const getRegistrations = asyncHandler(async (req, res) => {
  const tourId = req.params.id;
  const meId = req.user?._id ? String(req.user._id) : "";

  // 0) Quyền xem full số: admin hoặc quản lý giải
  const isAdmin = isAdminUser(req.user);

  const visibilityTour = await Tournament.findById(tourId)
    .select("_id isTest eventType")
    .lean();
  if (!visibilityTour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  if (visibilityTour.isTest === true && !isAdmin) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  let canSeeFullPhone = false;
  if (isAdmin) {
    canSeeFullPhone = true;
  } else if (tourId && meId) {
    const [t, isMgr] = await Promise.all([
      Tournament.findById(tourId).select("_id createdBy").lean(),
      TournamentManager.exists({ tournament: tourId, user: meId }),
    ]);
    if (t && String(t.createdBy) === meId) canSeeFullPhone = true;
    if (isMgr) canSeeFullPhone = true;
  }

  // 1) lấy registrations
  const regs = await Registration.find({ tournament: tourId })
    .sort({ createdAt: -1 })
    .lean();

  // 1.1) Gán mã đăng ký cho bản thiếu
  const missing = regs.filter((r) => r.code == null);
  if (missing.length) {
    const maxDoc = await Registration.findOne({ code: { $type: "number" } })
      .sort({ code: -1 })
      .select("code")
      .lean();

    let next = Math.max(9999, Number(maxDoc?.code ?? 9999));
    missing.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (const r of missing) {
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      const upd = await Registration.updateOne(
        { _id: r._id, $or: [{ code: { $exists: false } }, { code: null }] },
        { $set: { code: next } },
      );
      if (upd.modifiedCount > 0) {
        r.code = next;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const fresh = await Registration.findById(r._id).select("code").lean();
        if (fresh?.code != null) r.code = fresh.code;
      }
    }
  }

  // 2) gom userId từ player1/2
  const uids = new Set();
  for (const r of regs) {
    if (r?.player1?.user) uids.add(String(r.player1.user));
    if (r?.player2?.user) uids.add(String(r.player2.user));
  }

  // 3) query User: lấy thêm verified & cccdStatus
  const users = await User.find({ _id: { $in: [...uids] } })
    .select(
      "_id avatar fullName name nickName nickname phone gender verified cccdStatus",
    )
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const rankingRows = await Ranking.find({ user: { $in: [...uids] } })
    .select(
      "user single double mix points totalFinishedTours hasStaffAssessment tierColor tierLabel colorRank updatedAt lastUpdated lastFinishedTourAt lastAssessmentAt lastStaffAssessmentAt",
    )
    .lean();
  const rankingByUserId = new Map(
    rankingRows.map((ranking) => [String(ranking.user), ranking]),
  );
  const scoreUserIds = [...uids]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  const latestScoreRows = scoreUserIds.length
    ? await ScoreHistory.aggregate([
        { $match: { user: { $in: scoreUserIds } } },
        { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: "$user",
            single: { $first: "$single" },
            double: { $first: "$double" },
          },
        },
      ])
    : [];
  const latestScoreByUserId = new Map(
    latestScoreRows.map((row) => [String(row._id), row]),
  );

  // Helper quyết định trạng thái xác thực cuối cùng (ưu tiên cccdStatus)
  const finalKycStatusOf = (u) => {
    const c = String(u?.cccdStatus || "").toLowerCase();
    if (["verified", "pending", "rejected"].includes(c)) return c;
    // cccdStatus = 'unverified' hoặc không có -> fallback verified legacy
    const v = String(u?.verified || "").toLowerCase(); // 'verified' | 'pending'
    if (v === "verified") return "verified";
    if (v === "pending") return "pending";
    return "unverified";
  };

  // 4) helper ẩn số (tùy quyền)
  const maskPhone = (val) => {
    if (!val) return val;
    const s = String(val);
    if (canSeeFullPhone) return s;

    if (s.length <= 6) {
      const keepHead = Math.min(1, s.length);
      const keepTail = s.length > 2 ? 1 : 0;
      const head = s.slice(0, keepHead);
      const tail = keepTail ? s.slice(-keepTail) : "";
      const stars = "*".repeat(Math.max(0, s.length - keepHead - keepTail));
      return `${head}${stars}${tail}`;
    }
    return `${s.slice(0, 3)}****${s.slice(-3)}`;
  };

  const eventType = String(visibilityTour?.eventType || "").toLowerCase();
  const registrationScoreField =
    eventType === "single" || eventType === "singles" ? "single" : "double";

  const displayScoreOf = (pl, user) => {
    const uid = String(pl?.user || "");
    const ranking = rankingByUserId.get(uid);
    const rankingValue = ranking?.[registrationScoreField];
    if (hasPositiveScore(rankingValue)) return effectiveTournamentScoreForUser(rankingValue);

    const latestScore = latestScoreByUserId.get(uid);
    const latestValue = latestScore?.[registrationScoreField];
    if (hasPositiveScore(latestValue)) return effectiveTournamentScoreForUser(latestValue);

    const snapshot = Number(pl?.score);
    const isOldMaleFallback =
      isMaleGender(user?.gender) && Math.abs(snapshot - 2.1) < 0.0005;
    if (isOldMaleFallback) return 0;

    return effectiveTournamentScoreForUser(snapshot);
  };

  const scoreTierOf = (pl) => {
    const uid = String(pl?.user || "");
    const ranking = rankingByUserId.get(uid);
    const hasAnyRankingScore = [
      ranking?.single,
      ranking?.double,
      ranking?.mix,
      ranking?.points,
    ].some(hasPositiveScore);
    const hasAnyScore = hasAnyRankingScore || hasPositiveScore(pl?.score);
    const totalTours = Number(
      ranking?.totalFinishedTours || ranking?.totalTours || 0,
    );
    const tierColor = String(ranking?.tierColor || "").toLowerCase();
    const hasStaffAssessment = Boolean(ranking?.hasStaffAssessment);

    if (!hasAnyScore) {
      return {
        scoreTierColor: "grey",
        scoreTierLabel: "Chưa có điểm",
        scoreColorRank: 3,
        scoreHasStaffAssessment: hasStaffAssessment,
        scoreTotalTours: totalTours,
      };
    }

    if (tierColor === "blue" || totalTours >= 3) {
      return {
        scoreTierColor: "blue",
        scoreTierLabel: "Đã tham gia 3 giải",
        scoreColorRank: 0,
        scoreHasStaffAssessment: hasStaffAssessment,
        scoreTotalTours: totalTours,
      };
    }

    if (tierColor === "yellow" || totalTours > 0 || hasStaffAssessment) {
      return {
        scoreTierColor: "yellow",
        scoreTierLabel: "Mod/Admin chấm trình",
        scoreColorRank: 1,
        scoreHasStaffAssessment: hasStaffAssessment,
        scoreTotalTours: totalTours,
      };
    }

    return {
      scoreTierColor: "red",
      scoreTierLabel: "Tự chấm / chưa được admin chấm",
      scoreColorRank: 2,
      scoreHasStaffAssessment: hasStaffAssessment,
      scoreTotalTours: totalTours,
    };
  };

  // 5) hợp nhất từ User + gán kycStatus
  const enrichPlayer = (pl) => {
    if (!pl) return pl;
    const u = userById.get(String(pl.user));

    const nickFromUser =
      (u?.nickName && String(u.nickName).trim()) ||
      (u?.nickname && String(u.nickname).trim()) ||
      "";
    const fullNameFromUser =
      (u?.fullName && String(u.fullName).trim()) ||
      (u?.name && String(u.name).trim()) ||
      "";

    const phoneSource = u?.phone ?? pl.phone ?? "";
    const maskedPhone = maskPhone(phoneSource);
    const score = displayScoreOf(pl, u);
    const scoreMeta = scoreTierOf({ ...pl, score });

    // ✅ Trạng thái xác thực cuối cùng
    const kycStatus = finalKycStatusOf(u);
    const isVerified = kycStatus === "verified";

    return {
      ...pl,
      avatar: u?.avatar ?? pl?.avatar ?? null,
      fullName: fullNameFromUser || pl.fullName || "",
      nickName:
        nickFromUser ||
        (pl.nickName && String(pl.nickName).trim()) ||
        (pl.nickname && String(pl.nickname).trim()) ||
        "",
      phone: maskedPhone,
      score,

      // 👇 Thêm các field để FE dùng hiển thị badge
      cccdStatus: u?.cccdStatus || "unverified",
      verifiedLegacy: u?.verified || "pending",
      kycStatus, // 'verified' | 'pending' | 'rejected' | 'unverified'
      ...scoreMeta,
      isVerified, // boolean nhanh gọn
    };
  };

  // 6) build output
  const out = [];
  for (const r of regs) {
    const p1 = enrichPlayer(r.player1);
    const p2 = enrichPlayer(r.player2);
    out.push({
      ...r,
      player1: await sanitizeRatingsObj(req.user, p1?.user, p1),
      player2: await sanitizeRatingsObj(req.user, p2?.user, p2),
    });
  }

  res.json(out);
});

export const getTournamentRegistrationHistory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("ID giải đấu không hợp lệ");
  }

  if (!isAdminUser(req.user)) {
    res.status(403);
    throw new Error("Chỉ admin mới được xem lịch sử đăng ký giải này");
  }

  const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 200));
  const tournamentObjectId = new mongoose.Types.ObjectId(id);

  const registrations = await Registration.find({ tournament: id })
    .sort({ createdAt: -1 })
    .populate("createdBy", "_id name nickname phone email")
    .lean();
  const registrationIds = registrations.map((reg) => reg._id);
  const registrationById = new Map(
    registrations.map((reg) => [String(reg._id), reg])
  );

  const auditFilters = [
    {
      entityType: "Registration",
      changes: {
        $elemMatch: {
          field: "tournament",
          $or: [
            { from: tournamentObjectId },
            { to: tournamentObjectId },
            { from: id },
            { to: id },
          ],
        },
      },
    },
  ];
  if (registrationIds.length) {
    auditFilters.push({
      entityType: "Registration",
      entityId: { $in: registrationIds },
    });
  }

  const [audits, complaints] = await Promise.all([
    AuditLog.find({ $or: auditFilters })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("actor.id", "_id name nickname phone email")
      .lean(),
    Complaint.find({ tournament: id })
      .sort({ createdAt: -1 })
      .populate("registration", "_id code player1 player2")
      .populate("createdBy", "_id name nickname phone email")
      .lean(),
  ]);

  const items = [];
  const createAuditIds = new Set();
  const paymentAuditIds = new Set();

  for (const audit of audits) {
    const regId = asIdString(audit.entityId);
    const reg = registrationById.get(regId);
    if (audit.action === "CREATE" || String(audit.note || "").includes("Create")) {
      createAuditIds.add(regId);
    }
    if (
      findAuditChange(audit, "payment.status") ||
      findAuditChange(audit, "payment.paidAt")
    ) {
      paymentAuditIds.add(regId);
    }

    const registration = registrationPayloadFrom(reg, audit);
    items.push({
      id: String(audit._id),
      type: auditTypeFor(audit),
      title: auditTitleFor(audit),
      at: audit.createdAt,
      actor: auditActorPayload(audit),
      registration,
      note: audit.note || "",
      details: auditDetailsFor(audit),
      source: "audit",
    });
  }

  for (const reg of registrations) {
    const regId = String(reg._id);
    const registration = registrationPayloadFrom(reg);
    if (!createAuditIds.has(regId)) {
      items.push({
        id: `registration-created-${regId}`,
        type: "registration_created",
        title: "Tạo đăng ký",
        at: reg.createdAt,
        actor: actorPayload(reg.createdBy, "user"),
        registration,
        note: "",
        details: ["Dữ liệu lấy từ thời điểm tạo đăng ký"],
        source: "registration",
      });
    }

    if (reg?.payment?.status === "Paid" && reg?.payment?.paidAt && !paymentAuditIds.has(regId)) {
      items.push({
        id: `registration-payment-${regId}`,
        type: "payment_paid",
        title: "Đã thanh toán",
        at: reg.payment.paidAt,
        actor: { id: "", kind: "system", name: "", phone: "" },
        registration,
        note: "",
        details: ["Chưa có dữ liệu người thao tác cho mốc thanh toán cũ"],
        source: "registration",
      });
    }
  }

  for (const complaint of complaints) {
    const registration = registrationPayloadFrom(complaint.registration);
    items.push({
      id: `complaint-created-${complaint._id}`,
      type: "complaint_created",
      title: "Gửi khiếu nại",
      at: complaint.createdAt,
      actor: actorPayload(complaint.createdBy, "user"),
      registration,
      note: "",
      details: [
        complaint.content ? `Nội dung: ${complaint.content}` : "",
        `Trạng thái: ${complaint.status || "open"}`,
      ].filter(Boolean),
      source: "complaint",
    });

    if (
      complaint.updatedAt &&
      complaint.status &&
      complaint.status !== "open" &&
      new Date(complaint.updatedAt).getTime() >
        new Date(complaint.createdAt).getTime() + 1000
    ) {
      items.push({
        id: `complaint-status-${complaint._id}`,
        type: "complaint_updated",
        title: "Cập nhật khiếu nại",
        at: complaint.updatedAt,
        actor: { id: "", kind: "system", name: "BTC", phone: "" },
        registration,
        note: "",
        details: [`Trạng thái: ${complaint.status}`],
        source: "complaint",
      });
    }
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  res.json({
    tournamentId: id,
    total: items.length,
    registrationCount: registrations.length,
    complaintCount: complaints.length,
    items: items.slice(0, limit),
  });
});

/* Cập nhật trạng thái lệ phí */
export const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { status } = req.body; // 'Đã nộp' | 'Chưa nộp'

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const before = reg.toObject({ depopulate: true });
  reg.payment.status = status;
  reg.payment.paidAt = status === "Đã nộp" ? new Date() : undefined;
  await reg.save();
  await writeRegistrationAudit(req, {
    registrationId: reg._id,
    action: "UPDATE",
    before,
    after: reg.toObject({ depopulate: true }),
    note: "updatePaymentStatus",
  });

  res.json(reg);
});

/* Check‑in */
export const checkinRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const before = reg.toObject({ depopulate: true });
  reg.checkinAt = new Date();
  await reg.save();
  await writeRegistrationAudit(req, {
    registrationId: reg._id,
    action: "UPDATE",
    before,
    after: reg.toObject({ depopulate: true }),
    note: "checkinRegistration",
  });

  res.json(reg);
});

/**
 * POST /api/registrations/:regId/cancel
 * Chỉ cho phép: người tạo (createdBy) hoặc 1 trong 2 VĐV trong registration
 * Điều kiện: chưa thanh toán & chưa được xếp vào bất kỳ trận nào
 */
export const cancelRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId).lean();
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  // Quyền huỷ: ưu tiên createdBy; fallback nếu dữ liệu cũ không có createdBy
  const uid = String(req.user?._id || "");
  const isOwner = reg.createdBy ? String(reg.createdBy) === uid : false;
  const isMember = [reg?.player1?.user, reg?.player2?.user]
    .filter(Boolean)
    .map(String)
    .includes(uid);

  if (!isOwner && !isMember) {
    res.status(403);
    throw new Error("Bạn không có quyền huỷ đăng ký này");
  }

  const tournament = reg.tournament
    ? await Tournament.findById(reg.tournament).select("isFreeRegistration").lean()
    : null;

  // Chỉ khi chưa thanh toán, trừ trường hợp giải miễn phí
  if (
    tournament?.isFreeRegistration !== true &&
    reg?.payment?.status === "Paid"
  ) {
    res.status(400);
    throw new Error("Đăng ký đã thanh toán, không thể huỷ");
  }

  // Không cho huỷ nếu đã được xếp vào bất kỳ trận nào
  const usedIn = await Match.countDocuments({
    $or: [{ pairA: regId }, { pairB: regId }],
  });
  if (usedIn > 0) {
    res.status(400);
    throw new Error("Đăng ký đã được xếp vào trận đấu, không thể huỷ");
  }

  // Xoá registration
  await Registration.deleteOne({ _id: regId });
  await writeRegistrationAudit(req, {
    registrationId: reg._id,
    action: "DELETE",
    before: reg,
    after: {},
    note: "cancelRegistration",
  });

  // Giảm counter registered của giải (nếu có)
  if (reg.tournament) {
    const tour = await Tournament.findById(reg.tournament);
    if (tour && typeof tour.registered === "number") {
      tour.registered = Math.max(0, (tour.registered || 0) - 1);
      await tour.save();
    }
  }

  res.json({ ok: true, message: "Đã huỷ đăng ký" });
});

/**
 * PATCH /api/registrations/:id/payment
 * body: { status: 'Paid' | 'Unpaid' }
 */
export const updateRegistrationPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!["Paid", "Unpaid"].includes(status)) {
    res.status(400);
    throw new Error("Invalid status");
  }

  const reg = await Registration.findById(id).lean();
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const allowed = await canManageTournament(req.user, reg.tournament);
  if (!allowed) {
    res.status(403);
    throw new Error("Forbidden");
  }
  const tournament = await Tournament.findById(reg.tournament).select(
    "isFreeRegistration"
  );
  if (tournament?.isFreeRegistration === true && status !== "Paid") {
    res.status(400);
    throw new Error("Giải miễn phí luôn ở trạng thái đã thanh toán");
  }

  const update = {
    "payment.status": status,
    "payment.paidAt": status === "Paid" ? new Date() : null,
  };

  await Registration.updateOne({ _id: id }, { $set: update });
  await writeRegistrationAudit(req, {
    registrationId: id,
    action: "UPDATE",
    before: reg,
    after: {
      ...reg,
      payment: {
        ...(reg.payment || {}),
        status,
        paidAt: update["payment.paidAt"],
      },
    },
    note: "updateRegistrationPayment",
  });

  // 🆕 Nếu đổi sang Paid thì bắn notification
  if (status === "Paid") {
    try {
      const p1Id = reg.player1?.user && String(reg.player1.user);
      const p2Id = reg.player2?.user && String(reg.player2.user);
      const createdId = reg.createdBy && String(reg.createdBy);

      // 1) VĐV (player1 + player2): "Bạn đã thanh toán thành công phí đăng ký..."
      publishNotification(EVENTS.REGISTRATION_PAYMENT_PAID, {
        registrationId: id,
        tournamentId: reg.tournament,
        category: CATEGORY.STATUS,
        isCreator: false, // để payloadBuilder biết là case VĐV
        // không truyền overrideAudience -> resolver sẽ tự lấy player1/player2
      });

      // 2) Nếu createdBy tồn tại và KHÁC VĐV -> gửi riêng cho người tạo
      if (createdId && createdId !== p1Id && createdId !== p2Id) {
        publishNotification(EVENTS.REGISTRATION_PAYMENT_PAID, {
          registrationId: id,
          tournamentId: reg.tournament,
          category: CATEGORY.STATUS,
          isCreator: true, // để payloadBuilder render câu cho người tạo
          overrideAudience: [createdId], // resolver dùng danh sách này thay vì VĐV
        });
      }
    } catch (e) {
      console.error(
        "[notify] REGISTRATION_PAYMENT_PAID failed for registration",
        String(id),
        e,
      );
      // không throw: tránh làm fail API trả về, chỉ log lỗi gửi notif
    }
  }

  res.json({
    message: "Payment updated",
    status,
    paidAt: update["payment.paidAt"],
  });
});

/**
 * DELETE /api/registrations/:id
 * - Chủ sở hữu (createdBy) được xoá đăng ký của mình
 * - Admin hoặc Manager của giải có thể xoá bất kỳ đăng ký nào
 */
export const deleteRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reg = await Registration.findById(id);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  const isOwner = String(reg.createdBy || "") === String(req.user?._id || "");
  const allowedManager = await canManageTournament(req.user, reg.tournament);
  let allowedCaptain = false;
  if (!allowedManager) {
    const tournament = await Tournament.findById(reg.tournament).select(
      "_id tournamentMode teamConfig createdBy managers"
    );
    if (isTeamTournament(tournament)) {
      allowedCaptain = await canManageTeamFaction({
        user: req.user,
        tournament,
        factionId: reg.teamFactionId,
      });
    }
  }

  if (!isOwner && !allowedManager && !allowedCaptain) {
    res.status(403);
    throw new Error("Forbidden");
  }

  const before = reg.toObject({ depopulate: true });
  await reg.deleteOne();
  await writeRegistrationAudit(req, {
    registrationId: before._id,
    action: "DELETE",
    before,
    after: {},
    note: "deleteRegistration",
  });
  res.json({ message: "Registration deleted" });
});

function isAdminUser(user) {
  return (
    user?.isAdmin === true ||
    user?.isSuperUser === true ||
    user?.isSuperAdmin === true ||
    user?.role === "admin" ||
    (Array.isArray(user?.roles) &&
      (user.roles.includes("admin") ||
        user.roles.includes("superadmin") ||
        user.roles.includes("superuser")))
  );
}

function toMs(value) {
  if (!value) return null;
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function isTournamentFinished(tour) {
  if (!tour) return false;
  if (tour.finishedAt) return true;
  if (String(tour.status || "").toLowerCase() === "finished") return true;
  const endTs = toMs(tour.endAt || tour.endDate);
  return endTs !== null && endTs < Date.now();
}

/* Check quyền: owner → legacy managers (nếu có) → TournamentManager */
async function isTourManager(userId, tour) {
  if (!tour || !userId) return false;

  // 1) Chủ giải
  if (String(tour.createdBy) === String(userId)) return true;

  // 2) Legacy: nếu doc có mảng managers (để tương thích dữ liệu cũ)
  if (Array.isArray(tour.managers) && tour.managers.length) {
    const ok = tour.managers.some((m) => {
      const mid =
        typeof m === "object" && m !== null ? (m.user ?? m._id ?? m) : m;
      return String(mid) === String(userId);
    });
    if (ok) return true;
  }

  // 3) Bảng liên kết TournamentManager (hiện tại)
  const exists = await TournamentManager.exists({
    tournament: tour._id,
    user: userId,
  });
  return !!exists;
}

export const managerUpdateRegPlayerAvatar = expressAsyncHandler(
  async (req, res) => {
    const { regId } = req.params;
    const { slot, avatar } = req.body || {};
    const avatarUrl = typeof avatar === "string" ? avatar.trim() : "";

    if (!["p1", "p2"].includes(slot)) {
      res.status(400);
      throw new Error("slot phải là 'p1' hoặc 'p2'");
    }
    if (!avatarUrl) {
      res.status(400);
      throw new Error("Thiếu avatar");
    }

    const reg = await Registration.findById(regId);
    if (!reg) {
      res.status(404);
      throw new Error("Không tìm thấy đăng ký");
    }

    const tour = await Tournament.findById(reg.tournament).select(
      "eventType createdBy managers status finishedAt endDate endAt"
    );
    if (!tour) {
      res.status(404);
      throw new Error("Không tìm thấy giải đấu");
    }

    const authedUserId = req.user?._id || req.user?.id;
    if (!authedUserId) {
      res.status(401);
      throw new Error("Chưa đăng nhập");
    }

    const isAdmin = isAdminUser(req.user);
    const isManager = await isTourManager(authedUserId, tour);

    if (!(isAdmin || isManager)) {
      res.status(403);
      throw new Error("Bạn không có quyền sửa avatar cho đăng ký này");
    }
    if (!isAdmin && isTournamentFinished(tour)) {
      res.status(403);
      throw new Error(
        "Quản lý chỉ được sửa avatar ở giải sắp diễn ra hoặc đang diễn ra"
      );
    }

    const evType = String(tour.eventType || "").toLowerCase();
    const isSingles = evType === "single" || evType === "singles";
    if (isSingles && slot === "p2") {
      res.status(400);
      throw new Error("Giải đơn chỉ có VĐV 1 (p1)");
    }

    const targetUserId =
      slot === "p1" ? reg.player1?.user?.toString?.() : reg.player2?.user?.toString?.();
    if (!targetUserId) {
      res.status(404);
      throw new Error("Không tìm thấy VĐV ở vị trí này");
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      res.status(404);
      throw new Error("Không tìm thấy User");
    }

    const before = user.toObject({ depopulate: true });
    const previousAvatar = user.avatar || "";

    user.avatar = avatarUrl;
    const updatedUser = await user.save();
    if (String(previousAvatar || "") !== String(updatedUser.avatar || "")) {
      await writeRegistrationAudit(req, {
        registrationId: reg._id,
        action: "UPDATE",
        before: {},
        after: {},
        note: "managerUpdateRegPlayerAvatar",
        extraChanges: [
          {
            field: slot === "p1" ? "player1.avatar" : "player2.avatar",
            from: previousAvatar || "",
            to: updatedUser.avatar || "",
          },
        ],
      });
    }

    if (
      String(previousAvatar || "") !== String(updatedUser.avatar || "") &&
      updatedUser.avatar
    ) {
      queueUserAvatarOptimizationById(updatedUser._id);
    }

    try {
      const after = updatedUser.toObject({ depopulate: true });
      await writeAuditLog({
        entityType: "User",
        entityId: updatedUser._id,
        action: "UPDATE",
        actorId: authedUserId,
        actorKind: "user",
        ip: req.ip,
        userAgent: req.get("user-agent") || "",
        before,
        after,
        note: "managerUpdateRegPlayerAvatar",
        ignoreFields: [
          "_id",
          "__v",
          "password",
          "updatedAt",
          "createdAt",
          "resetPasswordToken",
          "resetPasswordExpire",
          "refreshToken",
          "accessToken",
          "tokens",
        ],
      });
    } catch (err) {
      console.error(
        "AUDIT_LOG_ERROR(managerUpdateRegPlayerAvatar):",
        err?.message || err
      );
    }

    res.json({
      ok: true,
      regId,
      slot,
      userId: updatedUser._id,
      avatar: updatedUser.avatar || "",
    });
  }
);

/* Snapshot user → subdoc player */
function toPlayerSubdoc(u) {
  const score =
    typeof u.score === "number"
      ? u.score
      : typeof u.skillScore === "number"
        ? u.skillScore
        : 0;

  return {
    user: u._id,
    phone: u.phone || "",
    fullName: u.fullName || u.name || u.displayName || "",
    nickName: u.nickName || u.nickname || "",
    avatar: u.avatar || u.photo || u.photoURL || "",
    score, // snapshot tại thời điểm thay
  };
}

/**
 * PATCH /api/registrations/:regId/manager/replace-player
 * body: { slot: 'p1'|'p2', userId }
 */

// Helper: lấy rank cho list userId -> Map(userIdStr -> snapshot)
async function getRanksMap(userIds = []) {
  const ids = userIds.filter(Boolean).map(String);
  if (!ids.length) return new Map();

  const rows = await Ranking.find({ user: { $in: ids } })
    .select("user single double points reputation updatedAt")
    .lean();

  const m = new Map();
  for (const r of rows) {
    m.set(String(r.user), {
      single: Number(r?.single ?? 0),
      double: Number(r?.double ?? 0),
      points: Number(r?.points ?? 0),
      reputation: Number(r?.reputation ?? 0),
      updatedAt: r?.updatedAt || null,
    });
  }
  return m;
}

// Lấy score hiện tại cho user theo loại giải (single/double).
async function getCurrentScore(userId, eventType, userSnapshot = null) {
  const isSingles =
    String(eventType || "").toLowerCase() === "single" ||
    String(eventType || "").toLowerCase() === "singles";
  const field = isSingles ? "single" : "double";
  const user =
    userSnapshot ||
    (await User.findById(userId).select("gender").lean());

  const rankingScore = await Ranking.findOne({ user: userId }).select(field).lean();
  if (hasPositiveScore(rankingScore?.[field])) {
    return effectiveTournamentScoreForUser(rankingScore[field], user);
  }

  // Ranking là nguồn hiển thị chính; ScoreHistory chỉ là fallback.
  const sh = await ScoreHistory.findOne({
    user: userId,
    [field]: { $ne: null },
  })
    .sort({ scoredAt: -1, createdAt: -1, _id: -1 })
    .select(field)
    .lean();

  if (hasPositiveScore(sh?.[field])) {
    return effectiveTournamentScoreForUser(sh[field], user);
  }

  return effectiveTournamentScoreForUser(null, user);
}

function buildDuplicateRegistrationMessage(
  existingReg,
  userIds,
  { isSingles = false } = {},
) {
  const ids = (userIds || []).filter(Boolean).map(String);
  const dupeNames = [];

  const addNameIfMatched = (player) => {
    const playerUserId = player?.user ? String(player.user) : null;
    if (!playerUserId || !ids.includes(playerUserId)) return;
    const name = player?.nickName || player?.nickname || player?.fullName || "VĐV";
    if (!dupeNames.includes(name)) dupeNames.push(name);
  };

  addNameIfMatched(existingReg?.player1);
  addNameIfMatched(existingReg?.player2);

  if (isSingles) {
    const who = dupeNames[0] || "này";
    return `Vận động viên ${who} đã đăng ký giải đấu rồi`;
  }

  if (dupeNames.length >= 2) {
    return "Cả 2 VĐV đã đăng ký giải đấu rồi";
  }

  const who = dupeNames[0] || "VĐV";
  return `Vận động viên ${who} đã đăng ký giải đấu rồi`;
}

async function findDuplicateRegistration({
  tournamentId,
  userIds,
  excludeRegId = null,
}) {
  const ids = (userIds || []).filter(Boolean).map(String);
  if (!ids.length) return null;

  const filter = {
    tournament: tournamentId,
    $or: [
      { "player1.user": { $in: ids } },
      { "player2.user": { $in: ids } },
    ],
  };

  if (excludeRegId) {
    filter._id = { $ne: excludeRegId };
  }

  return Registration.findOne(filter).select("_id player1 player2").lean();
}

export const managerReplacePlayer = expressAsyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { slot, userId } = req.body || {};

  if (!["p1", "p2"].includes(slot)) {
    res.status(400);
    throw new Error("slot phải là 'p1' hoặc 'p2'");
  }
  if (!userId) {
    res.status(400);
    throw new Error("Thiếu userId");
  }

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Không tìm thấy đăng ký");
  }

  const tour = await Tournament.findById(reg.tournament).select(
    "eventType createdBy managers status finishedAt endDate endAt",
  );
  if (!tour) {
    res.status(404);
    throw new Error("Không tìm thấy giải đấu");
  }

  // --- Quyền: admin hoặc manager của giải ---
  const authedUserId = req.user?._id || req.user?.id;
  if (!authedUserId) {
    res.status(401);
    throw new Error("Chưa đăng nhập");
  }

  const isAdmin = isAdminUser(req.user);
  const isManager = await isTourManager(authedUserId, tour);

  if (!(isAdmin || isManager)) {
    res.status(403);
    throw new Error("Bạn không có quyền thay VĐV cho đăng ký này");
  }

  // Validate theo loại giải
  if (!isAdmin && isTournamentFinished(tour)) {
    res.status(403);
    throw new Error(
      "Quản lý chỉ được thay VĐV ở giải sắp diễn ra hoặc đang diễn ra"
    );
  }
  const before = reg.toObject({ depopulate: true });

  const evType = String(tour.eventType || "").toLowerCase();
  const isSingles = evType === "single" || evType === "singles";
  if (isSingles && slot === "p2") {
    res.status(400);
    throw new Error("Giải đơn chỉ có VĐV 1 (p1)");
  }

  // Lấy user và tính score hiện tại
  const user = await User.findById(userId)
    .select("name nickname phone avatar gender")
    .lean();
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy User");
  }

  const newScore = await getCurrentScore(user._id, tour.eventType, user);

  // Không cho 2 VĐV trùng nhau theo userId
  const otherUserId =
    slot === "p1"
      ? reg.player2?.user?.toString?.()
      : reg.player1?.user?.toString?.();
  if (otherUserId && String(otherUserId) === String(user._id)) {
    res.status(400);
    throw new Error("Hai VĐV trong cùng 1 cặp không thể là cùng một người");
  }

  // Nếu không đổi người: (tuỳ chọn) bạn có muốn refresh score luôn không?
  const currentUserId =
    slot === "p1"
      ? reg.player1?.user?.toString?.()
      : reg.player2?.user?.toString?.();
  if (currentUserId && String(currentUserId) === String(user._id)) {
    // 👉 Nếu muốn cập nhật score cả khi không đổi người, uncomment khối sau:
    if (slot === "p1") reg.player1.score = newScore;
    else reg.player2.score = newScore;
    await reg.save();
    await writeRegistrationAudit(req, {
      registrationId: reg._id,
      action: "UPDATE",
      before,
      after: reg.toObject({ depopulate: true }),
      note: "managerReplacePlayerScoreRefresh",
    });
    return res.json({ message: "Không có thay đổi", registration: reg });
  }

  const nextUserIds = [
    slot === "p1" ? user._id : reg.player1?.user,
    isSingles ? null : slot === "p2" ? user._id : reg.player2?.user,
  ].filter(Boolean);

  const duplicateReg = await findDuplicateRegistration({
    tournamentId: reg.tournament,
    userIds: nextUserIds,
    excludeRegId: reg._id,
  });
  if (duplicateReg) {
    res.status(400);
    throw new Error(
      buildDuplicateRegistrationMessage(duplicateReg, nextUserIds, {
        isSingles,
      }),
    );
  }

  // --- Tạo subdoc đúng playerSchema và GÁN SCORE MỚI ---
  const subdoc = {
    user: user._id,
    phone: user.phone || "", // playerSchema.required
    fullName: user.name || user.nickname || "", // playerSchema.required
    nickName: user.nickname || "",
    avatar: user.avatar || "",
    score: newScore, // ⬅️ CẬP NHẬT SCORE TẠI ĐÂY
  };

  if (slot === "p1") reg.player1 = subdoc;
  else reg.player2 = subdoc;

  await reg.save();
  await writeRegistrationAudit(req, {
    registrationId: reg._id,
    action: "UPDATE",
    before,
    after: reg.toObject({ depopulate: true }),
    note: "managerReplacePlayer",
  });
  res.json({ message: "Đã thay VĐV", registration: reg });
});

const { ObjectId } = mongoose.Types;

const escapeRegExp = (s = "") => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ====== SEARCH (GET /api/tournaments/:id/registrations/search?q=...) ======
export const searchRegistrations = async (req, res, next) => {
  try {
    const { id } = req.params; // tournament id
    let rawQ = String(req.query.q ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 200), 500);

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Tournament id không hợp lệ" });
    }

    // ===== Quyền xem số điện thoại đầy đủ (giống getRegistrations) =====
    const meId = req.user?._id ? String(req.user._id) : "";
    const isAdmin = isAdminUser(req.user);

    let canSeeFullPhone = false;
    if (isAdmin) {
      canSeeFullPhone = true;
    } else if (meId) {
      const [t, isMgr] = await Promise.all([
        Tournament.findById(id).select("_id createdBy").lean(),
        TournamentManager.exists({ tournament: id, user: meId }),
      ]);
      if (t && String(t.createdBy) === meId) canSeeFullPhone = true;
      if (isMgr) canSeeFullPhone = true;
    }

    const scoreTour = await Tournament.findById(id)
      .select("_id eventType")
      .lean();
    if (!scoreTour) {
      return res.status(404).json({ message: "Tournament not found" });
    }
    const eventType = String(scoreTour?.eventType || "").toLowerCase();
    const registrationScoreField =
      eventType === "single" || eventType === "singles" ? "single" : "double";

    // ===== Helpers giống getRegistrations =====
    const maskPhone = (val) => {
      if (!val) return val;
      const s = String(val);
      if (canSeeFullPhone) return s;

      if (s.length <= 6) {
        const keepHead = Math.min(1, s.length);
        const keepTail = s.length > 2 ? 1 : 0;
        const head = s.slice(0, keepHead);
        const tail = keepTail ? s.slice(-keepTail) : "";
        const stars = "*".repeat(Math.max(0, s.length - keepHead - keepTail));
        return `${head}${stars}${tail}`;
      }
      return `${s.slice(0, 3)}****${s.slice(-3)}`;
    };

    const finalKycStatusOf = (u) => {
      const c = String(u?.cccdStatus || "").toLowerCase();
      if (["verified", "pending", "rejected"].includes(c)) return c;
      const v = String(u?.verified || "").toLowerCase(); // 'verified' | 'pending'
      if (v === "verified") return "verified";
      if (v === "pending") return "pending";
      return "unverified";
    };

    let currentScoreByUserId = new Map();

    const enrichPlayerAfterAgg = (pl, uMeta = {}) => {
      if (!pl) return pl;
      // pl: { avatar, fullName, nickName, phone, score, user }
      // uMeta: { cccdStatus, verified }
      const kycStatus = finalKycStatusOf(uMeta);
      const isVerified = kycStatus === "verified";
      const uid = String(pl?.user || "");
      const currentScore = currentScoreByUserId.get(uid);

      return {
        ...pl,
        score: hasPositiveScore(currentScore)
          ? currentScore
          : effectiveTournamentScoreForUser(pl.score),
        phone: maskPhone(pl.phone ?? ""), // mask sau khi đã merge phone (user > snapshot)
        cccdStatus: uMeta?.cccdStatus || "unverified",
        verifiedLegacy: uMeta?.verified || "pending",
        kycStatus,
        isVerified,
      };
    };

    const buildCurrentScoreMapForRows = async (rows = []) => {
      const ids = [
        ...new Set(
          rows
            .flatMap((row) => [row?.player1?.user, row?.player2?.user])
            .filter(Boolean)
            .map(String),
        ),
      ];
      if (!ids.length) return new Map();

      const validObjectIds = ids
        .filter((uid) => mongoose.isValidObjectId(uid))
        .map((uid) => new mongoose.Types.ObjectId(uid));

      const [rankingRows, latestScoreRows] = await Promise.all([
        Ranking.find({ user: { $in: ids } })
          .select("user single double")
          .lean(),
        validObjectIds.length
          ? ScoreHistory.aggregate([
              { $match: { user: { $in: validObjectIds } } },
              { $sort: { scoredAt: -1, createdAt: -1, _id: -1 } },
              {
                $group: {
                  _id: "$user",
                  single: { $first: "$single" },
                  double: { $first: "$double" },
                },
              },
            ])
          : Promise.resolve([]),
      ]);

      const scoreMap = new Map();
      for (const ranking of rankingRows) {
        const value = ranking?.[registrationScoreField];
        if (hasPositiveScore(value)) {
          scoreMap.set(String(ranking.user), effectiveTournamentScoreForUser(value));
        }
      }
      for (const row of latestScoreRows) {
        const uid = String(row._id);
        if (scoreMap.has(uid)) continue;
        const value = row?.[registrationScoreField];
        if (hasPositiveScore(value)) {
          scoreMap.set(uid, effectiveTournamentScoreForUser(value));
        }
      }

      return scoreMap;
    };

    // Helper
    const escapeRegExp = (s = "") =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // === Nếu không có q: trả tất cả trong giải (giới hạn limit) ===
    if (!rawQ) {
      const rows = await Registration.aggregate([
        { $match: { tournament: new ObjectId(id) } },

        // Join users for player1 and player2
        {
          $lookup: {
            from: "users",
            localField: "player1.user",
            foreignField: "_id",
            as: "u1",
          },
        },
        { $unwind: { path: "$u1", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "users",
            localField: "player2.user",
            foreignField: "_id",
            as: "u2",
          },
        },
        { $unwind: { path: "$u2", preserveNullAndEmptyArrays: true } },

        // Trả player mixed + kèm meta user để tính KYC ở ngoài
        {
          $addFields: {
            player1Mixed: {
              user: "$player1.user",
              phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
              fullName: {
                $ifNull: [
                  "$u1.fullName",
                  { $ifNull: ["$u1.name", "$player1.fullName"] },
                ],
              },
              nickName: {
                $ifNull: [
                  "$u1.nickname",
                  { $ifNull: ["$u1.nickName", "$player1.nickName"] },
                ],
              },
              avatar: { $ifNull: ["$u1.avatar", "$player1.avatar"] },
              score: "$player1.score",
            },
            player2Mixed: {
              $cond: [
                { $ifNull: ["$player2", false] },
                {
                  user: "$player2.user",
                  phone: { $ifNull: ["$u2.phone", "$player2.phone"] },
                  fullName: {
                    $ifNull: [
                      "$u2.fullName",
                      { $ifNull: ["$u2.name", "$player2.fullName"] },
                    ],
                  },
                  nickName: {
                    $ifNull: [
                      "$u2.nickname",
                      { $ifNull: ["$u2.nickName", "$player2.nickName"] },
                    ],
                  },
                  avatar: { $ifNull: ["$u2.avatar", "$player2.avatar"] },
                  score: "$player2.score",
                },
                null,
              ],
            },

            // Meta để tính KYC phía Node
            _u1cccdStatus: "$u1.cccdStatus",
            _u1verified: "$u1.verified",
            _u2cccdStatus: "$u2.cccdStatus",
            _u2verified: "$u2.verified",
          },
        },

        {
          $project: {
            _id: 1,
            tournament: 1,
            createdBy: 1,
            createdAt: 1,
            code: 1,
            checkinAt: 1,
            payment: 1,

            player1: "$player1Mixed",
            player2: "$player2Mixed",

            // giữ snapshot nếu cần
            player1Snapshot: "$player1",
            player2Snapshot: "$player2",

            // giữ meta user để xử lý KYC ở ngoài
            _u1cccdStatus: 1,
            _u1verified: 1,
            _u2cccdStatus: 1,
            _u2verified: 1,
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
      ]).collation({ locale: "vi", strength: 1 });

      // Post-process: mask phone + gán KYC
      currentScoreByUserId = await buildCurrentScoreMapForRows(rows);
      const out = rows.map((r) => ({
        ...r,
        player1: enrichPlayerAfterAgg(r.player1, {
          cccdStatus: r._u1cccdStatus,
          verified: r._u1verified,
        }),
        player2: r.player2
          ? enrichPlayerAfterAgg(r.player2, {
              cccdStatus: r._u2cccdStatus,
              verified: r._u2verified,
            })
          : null,
        // xoá meta tạm
        _u1cccdStatus: undefined,
        _u1verified: undefined,
        _u2cccdStatus: undefined,
        _u2verified: undefined,
      }));

      return res.json(out);
    }

    // === Có q: build điều kiện tìm kiếm theo từng VĐV (tên & nickname) ===
    const quoted = /^["“].*["”]$/.test(rawQ);
    if (quoted) rawQ = rawQ.replace(/^["“]|["”]$/g, "").trim();

    const tokens = rawQ.split(/\s+/).filter(Boolean);
    const tokensLen = tokens.length;
    const exactMode = quoted || tokensLen >= 2;

    const qUpper = rawQ.toUpperCase();
    const qDigits = (rawQ.match(/\d/g) || []).join("");

    const phoneRegex = qDigits.length >= 6 ? new RegExp(qDigits) : null;
    const codeExact = /^\d+$/.test(rawQ) ? Number(rawQ) : undefined;
    const codePrefixRegex =
      qDigits.length >= 2 ? new RegExp("^" + escapeRegExp(qDigits)) : null;

    const short5Prefix =
      !exactMode && tokensLen === 1
        ? new RegExp("^" + escapeRegExp(tokens[0].toUpperCase()))
        : null;

    const tokenPrefixRegexes = tokens.map(
      (t) => new RegExp("(?:^|\\s)" + escapeRegExp(t), "i"),
    );
    const tokenAnyRegexes = tokens.map((t) => new RegExp(escapeRegExp(t), "i"));

    const pipeline = [
      { $match: { tournament: new ObjectId(id) } },

      // Join users for player1 and player2
      {
        $lookup: {
          from: "users",
          localField: "player1.user",
          foreignField: "_id",
          as: "u1",
        },
      },
      { $unwind: { path: "$u1", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "player2.user",
          foreignField: "_id",
          as: "u2",
        },
      },
      { $unwind: { path: "$u2", preserveNullAndEmptyArrays: true } },

      // Các field chuẩn hoá để so sánh
      {
        $addFields: {
          n1: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ["$u1.fullName", { $ifNull: ["$u1.name", ""] }],
                },
                chars: " ",
              },
            },
          },
          n1Nick: {
            $toUpper: {
              $ifNull: ["$u1.nickname", { $ifNull: ["$u1.nickName", ""] }],
            },
          },
          n2: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ["$u2.fullName", { $ifNull: ["$u2.name", ""] }],
                },
                chars: " ",
              },
            },
          },
          n2Nick: {
            $toUpper: {
              $ifNull: ["$u2.nickname", { $ifNull: ["$u2.nickName", ""] }],
            },
          },

          // fallback phone: user > snapshot
          p1Phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
          p2Phone: { $ifNull: ["$u2.phone", "$player2.phone"] },

          _idStr: { $toString: "$_id" },
          codeStr: { $toString: "$code" },
        },
      },
      {
        $addFields: {
          short5: {
            $toUpper: {
              $substrCP: [
                "$_idStr",
                { $subtract: [{ $strLenCP: "$_idStr" }, 5] },
                5,
              ],
            },
          },
        },
      },

      // HIT FLAGS / SCORES
      {
        $addFields: {
          exactNameHit: {
            $or: [
              { $eq: ["$n1", qUpper] },
              { $eq: ["$n1Nick", qUpper] },
              { $eq: ["$n2", qUpper] },
              { $eq: ["$n2Nick", qUpper] },
            ],
          },

          tokenPrefixHits: {
            $add: [
              0,
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1Nick", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2", regex: rx } }, 1, 0],
              })),
              ...tokenPrefixRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2Nick", regex: rx } }, 1, 0],
              })),
            ],
          },

          tokenAnyHits: {
            $add: [
              0,
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n1Nick", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2", regex: rx } }, 1, 0],
              })),
              ...tokenAnyRegexes.map((rx) => ({
                $cond: [{ $regexMatch: { input: "$n2Nick", regex: rx } }, 1, 0],
              })),
            ],
          },

          codeOrPhoneHit: {
            $or: [
              ...(Number.isFinite(codeExact)
                ? [{ $eq: ["$code", codeExact] }]
                : []),
              ...(codePrefixRegex
                ? [
                    {
                      $regexMatch: {
                        input: "$codeStr",
                        regex: codePrefixRegex,
                      },
                    },
                  ]
                : []),
              ...(phoneRegex
                ? [
                    { $regexMatch: { input: "$p1Phone", regex: phoneRegex } },
                    { $regexMatch: { input: "$p2Phone", regex: phoneRegex } },
                  ]
                : []),
              ...(short5Prefix
                ? [{ $regexMatch: { input: "$short5", regex: short5Prefix } }]
                : []),
            ],
          },
        },
      },

      // Lọc theo chế độ
      {
        $match: exactMode
          ? {
              $or: [
                { exactNameHit: true },
                { codeOrPhoneHit: true },
                ...(tokensLen
                  ? [{ tokenPrefixHits: { $gte: tokensLen } }]
                  : []),
              ],
            }
          : {
              $or: [
                { codeOrPhoneHit: true },
                { exactNameHit: true },
                { tokenPrefixHits: { $gt: 0 } },
                { tokenAnyHits: { $gt: 0 } },
              ],
            },
      },

      // Xếp hạng
      {
        $addFields: {
          rank: {
            $switch: {
              branches: [
                { case: "$codeOrPhoneHit", then: 0 },
                { case: "$exactNameHit", then: 1 },
                ...(tokensLen
                  ? [
                      {
                        case: { $gte: ["$tokenPrefixHits", tokensLen] },
                        then: 2,
                      },
                    ]
                  : []),
                { case: { $gt: ["$tokenAnyHits", 0] }, then: 3 },
              ],
              default: 9,
            },
          },
        },
      },

      { $sort: { rank: 1, createdAt: -1 } },
      { $limit: limit },

      // Trả player mixed (gộp user + snapshot) + meta KYC
      {
        $addFields: {
          player1Mixed: {
            user: "$player1.user",
            phone: { $ifNull: ["$u1.phone", "$player1.phone"] },
            fullName: {
              $ifNull: [
                "$u1.fullName",
                { $ifNull: ["$u1.name", "$player1.fullName"] },
              ],
            },
            nickName: {
              $ifNull: [
                "$u1.nickname",
                { $ifNull: ["$u1.nickName", "$player1.nickName"] },
              ],
            },
            avatar: { $ifNull: ["$u1.avatar", "$player1.avatar"] },
            score: "$player1.score",
          },
          player2Mixed: {
            $cond: [
              { $ifNull: ["$player2", false] },
              {
                user: "$player2.user",
                phone: { $ifNull: ["$u2.phone", "$player2.phone"] },
                fullName: {
                  $ifNull: [
                    "$u2.fullName",
                    { $ifNull: ["$u2.name", "$player2.fullName"] },
                  ],
                },
                nickName: {
                  $ifNull: [
                    "$u2.nickname",
                    { $ifNull: ["$u2.nickName", "$player2.nickName"] },
                  ],
                },
                avatar: { $ifNull: ["$u2.avatar", "$player2.avatar"] },
                score: "$player2.score",
              },
              null,
            ],
          },

          _u1cccdStatus: "$u1.cccdStatus",
          _u1verified: "$u1.verified",
          _u2cccdStatus: "$u2.cccdStatus",
          _u2verified: "$u2.verified",
        },
      },

      {
        $project: {
          _id: 1,
          tournament: 1,
          createdBy: 1,
          createdAt: 1,
          code: 1,
          checkinAt: 1,
          payment: 1,

          player1: "$player1Mixed",
          player2: "$player2Mixed",

          player1Snapshot: "$player1",
          player2Snapshot: "$player2",

          _u1cccdStatus: 1,
          _u1verified: 1,
          _u2cccdStatus: 1,
          _u2verified: 1,
        },
      },
    ];

    const rows = await Registration.aggregate(pipeline).collation({
      locale: "vi",
      strength: 1,
    });

    // Post-process: mask phone + gán KYC (giống nhánh không-q)
    currentScoreByUserId = await buildCurrentScoreMapForRows(rows);
    const out = rows.map((r) => ({
      ...r,
      player1: enrichPlayerAfterAgg(r.player1, {
        cccdStatus: r._u1cccdStatus,
        verified: r._u1verified,
      }),
      player2: r.player2
        ? enrichPlayerAfterAgg(r.player2, {
            cccdStatus: r._u2cccdStatus,
            verified: r._u2verified,
          })
        : null,
      _u1cccdStatus: undefined,
      _u1verified: undefined,
      _u2cccdStatus: undefined,
      _u2verified: undefined,
    }));

    return res.json(out);
  } catch (err) {
    return next(err);
  }
};
