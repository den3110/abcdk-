// controllers/clipController.js
// API cho tính năng "cắt clip camera sân" (user đặt sân → yêu cầu cắt clip).
// Worker xử lý TUẦN TỰ: services/clip/clipWorker.service.js.

import fs from "fs";
import path from "path";
import mongoose from "mongoose";

import ClipJob from "../models/clipJobModel.js";
import Booking from "../models/bookingModel.js";
import VenueCourt from "../models/venueCourtModel.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { canManageVenue } from "../utils/venueAuth.js";
import { pushToUsers, venueStaffIds } from "../services/venueNotify.js";

const CLIP_MAX_MINUTES = Number(process.env.CLIP_MAX_MINUTES) || 30;
const CLIP_MAX_ACTIVE_PER_USER = Number(process.env.CLIP_MAX_ACTIVE_PER_USER) || 3;
// Camera Imou chạy giờ LOCAL VN (UTC+7). Cho phép override qua env nếu cam khác múi giờ.
const CAM_TZ_OFFSET_MIN = Number(process.env.CLIP_CAM_TZ_OFFSET_MIN) || 420;

/** Date (UTC) → giờ LOCAL camera dạng "yyyy_MM_dd_HH_mm_ss" (format cloud Imou dùng). */
function toImouLocal(date) {
  const d = new Date(date.getTime() + CAM_TZ_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}_${p(d.getUTCMonth() + 1)}_${p(d.getUTCDate())}_` +
    `${p(d.getUTCHours())}_${p(d.getUTCMinutes())}_${p(d.getUTCSeconds())}`;
}

/** fileUrl tương đối (/uploads/...) → URL tuyệt đối (host gốc, giống proofUrl) để app phát trực tiếp. */
function withAbsoluteFileUrl(req, job) {
  if (!job) return job;
  return { ...job, fileUrl: job.fileUrl ? toPublicUrl(req, job.fileUrl) : "" };
}

/** Danh sách cam Imou của 1 court (imouCams mới, fallback imou legacy). */
function courtCams(court) {
  if (Array.isArray(court?.imouCams) && court.imouCams.length) return court.imouCams;
  if (court?.imou?.deviceId) return [court.imou];
  return [];
}

/**
 * GET /api/clips/cams?bookingId=<id>
 * Trả danh sách camera của sân trong lượt đặt (để app chọn nguồn cắt).
 * Kèm khung giờ đặt để UI giới hạn thanh chọn thời gian.
 */
export async function listBookingCams(req, res) {
  try {
    const { bookingId } = req.query || {};
    if (!bookingId || !mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({ message: "Thiếu/không hợp lệ bookingId." });
    }
    const booking = await Booking.findById(bookingId).lean();
    if (!booking) return res.status(404).json({ message: "Không tìm thấy lượt đặt sân." });
    if (String(booking.user || "") !== String(req.user?._id)) {
      return res.status(403).json({ message: "Bạn không sở hữu lượt đặt sân này." });
    }
    const court = await VenueCourt.findById(booking.court).lean();
    const cams = courtCams(court || {}).map((c) => ({
      deviceId: c.deviceId,
      name: c.name || "Camera",
    }));
    return res.json({
      cams,
      startAt: booking.startAt,
      endAt: booking.endAt,
      courtName: court?.name || "",
      maxMinutes: CLIP_MAX_MINUTES,
    });
  } catch (e) {
    console.error("[clipController.listBookingCams]", e);
    return res.status(500).json({ message: "Lỗi tải danh sách camera." });
  }
}

/**
 * POST /api/clips
 * Body: { bookingId, deviceId, startAt, endAt }  (startAt/endAt: ISO trong giờ đặt sân)
 * Tạo yêu cầu cắt clip; worker sẽ xử lý lần lượt.
 */
export async function createClip(req, res) {
  try {
    const userId = req.user?._id;
    const { bookingId, deviceId, startAt, endAt } = req.body || {};
    if (!bookingId || !deviceId || !startAt || !endAt) {
      return res.status(400).json({ message: "Thiếu bookingId/deviceId/startAt/endAt." });
    }
    if (!mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({ message: "bookingId không hợp lệ." });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Không tìm thấy lượt đặt sân." });
    if (String(booking.user || "") !== String(userId)) {
      return res.status(403).json({ message: "Bạn không sở hữu lượt đặt sân này." });
    }
    if (!["confirmed", "completed"].includes(booking.status)) {
      return res.status(400).json({ message: "Chỉ cắt clip cho lượt đặt đã xác nhận/hoàn tất." });
    }

    const begin = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime()) || end <= begin) {
      return res.status(400).json({ message: "Khoảng thời gian không hợp lệ." });
    }
    // Chỉ cắt được cảnh QUÁ KHỨ (thẻ SD chưa ghi tương lai).
    if (end.getTime() > Date.now() + 60000) {
      return res.status(400).json({ message: "Chỉ cắt được cảnh đã diễn ra." });
    }
    const durationSec = Math.round((end - begin) / 1000);
    if (durationSec < 1) return res.status(400).json({ message: "Clip quá ngắn." });
    if (durationSec > CLIP_MAX_MINUTES * 60) {
      return res.status(400).json({ message: `Clip tối đa ${CLIP_MAX_MINUTES} phút.` });
    }

    // NẰM TRONG giờ đã đặt → tự chạy. NGOÀI giờ → cần chủ sân duyệt.
    const withinBooking = begin >= booking.startAt && end <= booking.endAt;

    // Court của booking phải có đúng cam deviceId này.
    const court = await VenueCourt.findById(booking.court).lean();
    if (!court) return res.status(404).json({ message: "Không tìm thấy sân." });
    const cam = courtCams(court).find((c) => String(c.deviceId) === String(deviceId));
    if (!cam) {
      return res.status(400).json({ message: "Camera này không thuộc sân bạn đã đặt." });
    }

    // Chống spam: tối đa N job đang chờ/đang chạy/chờ duyệt mỗi user.
    const activeCount = await ClipJob.countDocuments({
      requestedBy: userId, status: { $in: ["pending_approval", "queued", "processing"] },
    });
    if (activeCount >= CLIP_MAX_ACTIVE_PER_USER) {
      return res.status(429).json({
        message: `Bạn đang có ${activeCount} yêu cầu clip chờ xử lý. Vui lòng đợi hoàn tất rồi tạo thêm.`,
      });
    }

    const job = await ClipJob.create({
      venue: booking.venue,
      court: booking.court,
      courtName: court.name || "",
      booking: booking._id,
      requestedBy: userId,
      requesterRole: "user",
      deviceId: cam.deviceId,
      productId: cam.productId || "",
      camName: cam.name || "",
      beginLocal: toImouLocal(begin),
      endLocal: toImouLocal(end),
      durationSec,
      withinBooking,
      status: withinBooking ? "queued" : "pending_approval",
    });

    // Ngoài giờ đặt → báo chủ sân / nhân viên có quyền duyệt booking.
    if (!withinBooking) {
      try {
        const staff = await venueStaffIds(booking.venue, "bookings.manage");
        await pushToUsers({
          recipients: staff,
          actorId: userId,
          type: "BOOKING",
          title: "✂️ Yêu cầu cắt clip cần duyệt",
          body: `${req.user?.name || "Khách"} xin cắt clip NGOÀI giờ đặt tại ${court.name || "sân"} (${Math.round(durationSec / 60)} phút).`,
          url: `/owner/clip-approvals?venueId=${booking.venue}`,
          data: { kind: "clip_approval_request", clipJobId: String(job._id), venueId: String(booking.venue) },
        });
      } catch (err) { console.error("[clip approval notify]", err?.message || err); }
    }

    if (!withinBooking) {
      return res.status(201).json({ job, requiresApproval: true, queueAhead: 0 });
    }

    // Số job xếp trước (để hiển thị "đang chờ #N").
    const queueAhead = await ClipJob.countDocuments({
      status: { $in: ["queued", "processing"] },
      createdAt: { $lt: job.createdAt },
    });

    return res.status(201).json({ job, requiresApproval: false, queueAhead });
  } catch (e) {
    console.error("[clipController.createClip]", e);
    return res.status(500).json({ message: "Lỗi tạo yêu cầu cắt clip." });
  }
}

/** GET /api/clips/mine?bookingId= — danh sách clip của user (mới nhất trước). */
export async function listMyClips(req, res) {
  try {
    const q = { requestedBy: req.user?._id };
    if (req.query.bookingId && mongoose.isValidObjectId(req.query.bookingId)) {
      q.booking = req.query.bookingId;
    }
    const jobs = await ClipJob.find(q).sort({ createdAt: -1 }).limit(30).lean();
    return res.json({ jobs: jobs.map((j) => withAbsoluteFileUrl(req, j)) });
  } catch (e) {
    console.error("[clipController.listMyClips]", e);
    return res.status(500).json({ message: "Lỗi tải danh sách clip." });
  }
}

/** GET /api/clips/:id — trạng thái 1 clip (chỉ chủ yêu cầu). */
export async function getClip(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "id không hợp lệ." });
    }
    const job = await ClipJob.findOne({ _id: req.params.id, requestedBy: req.user?._id }).lean();
    if (!job) return res.status(404).json({ message: "Không tìm thấy clip." });
    return res.json({ job: withAbsoluteFileUrl(req, job) });
  } catch (e) {
    console.error("[clipController.getClip]", e);
    return res.status(500).json({ message: "Lỗi tải clip." });
  }
}

/**
 * DELETE /api/clips/:id
 * - queued → huỷ (cancelled). processing → chặn (đang chạy). done/failed → xoá doc + file.
 */
export async function deleteClip(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "id không hợp lệ." });
    }
    const job = await ClipJob.findOne({ _id: req.params.id, requestedBy: req.user?._id });
    if (!job) return res.status(404).json({ message: "Không tìm thấy clip." });

    if (job.status === "processing") {
      return res.status(409).json({ message: "Clip đang được xử lý, không thể xoá lúc này." });
    }
    if (job.status === "queued" || job.status === "pending_approval") {
      job.status = "cancelled";
      await job.save();
      return res.json({ ok: true, cancelled: true });
    }
    // done/failed/cancelled → xoá hẳn + file
    if (job.fileUrl) {
      const p = path.resolve(process.cwd(), "." + job.fileUrl);
      try { fs.unlinkSync(p); } catch { /* file có thể đã bị TTL xoá */ }
    }
    await ClipJob.deleteOne({ _id: job._id });
    return res.json({ ok: true, deleted: true });
  } catch (e) {
    console.error("[clipController.deleteClip]", e);
    return res.status(500).json({ message: "Lỗi xoá clip." });
  }
}

/* ═══════════════ CHỦ SÂN DUYỆT clip ngoài giờ ═══════════════ */

/** GET /api/clips/pending?venueId= — danh sách yêu cầu chờ duyệt của 1 venue (chủ sân). */
export async function listPendingApprovals(req, res) {
  try {
    const { venueId } = req.query || {};
    if (!venueId || !mongoose.isValidObjectId(venueId)) {
      return res.status(400).json({ message: "Thiếu/không hợp lệ venueId." });
    }
    if (!(await canManageVenue(req.user, venueId))) {
      return res.status(403).json({ message: "Bạn không có quyền quản lý sân này." });
    }
    const jobs = await ClipJob.find({ venue: venueId, status: "pending_approval" })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate("requestedBy", "name phone avatar")
      .lean();
    return res.json({ jobs });
  } catch (e) {
    console.error("[clipController.listPendingApprovals]", e);
    return res.status(500).json({ message: "Lỗi tải yêu cầu chờ duyệt." });
  }
}

/** POST /api/clips/:id/approve — chủ sân duyệt → đưa vào hàng đợi xử lý. */
export async function approveClip(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "id không hợp lệ." });
    }
    const job = await ClipJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Không tìm thấy yêu cầu." });
    if (!(await canManageVenue(req.user, job.venue))) {
      return res.status(403).json({ message: "Bạn không có quyền duyệt yêu cầu này." });
    }
    if (job.status !== "pending_approval") {
      return res.status(409).json({ message: "Yêu cầu không còn ở trạng thái chờ duyệt." });
    }
    job.status = "queued";
    job.approvedBy = req.user._id;
    job.approvedAt = new Date();
    job.error = "";
    await job.save();

    try {
      await pushToUsers({
        recipients: [String(job.requestedBy)],
        actorId: req.user._id,
        type: "BOOKING",
        title: "✅ Yêu cầu cắt clip đã được duyệt",
        body: `Clip ${job.camName || ""} (${Math.round(job.durationSec / 60)} phút) đang được xử lý.`,
        url: `/clips/${job._id}`,
        data: { kind: "clip_approved", clipJobId: String(job._id) },
      });
    } catch (err) { console.error("[clip approve notify]", err?.message || err); }

    return res.json({ ok: true, job });
  } catch (e) {
    console.error("[clipController.approveClip]", e);
    return res.status(500).json({ message: "Lỗi duyệt yêu cầu." });
  }
}

/** POST /api/clips/:id/reject — chủ sân từ chối (kèm lý do). */
export async function rejectClip(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "id không hợp lệ." });
    }
    const job = await ClipJob.findById(req.params.id);
    if (!job) return res.status(404).json({ message: "Không tìm thấy yêu cầu." });
    if (!(await canManageVenue(req.user, job.venue))) {
      return res.status(403).json({ message: "Bạn không có quyền từ chối yêu cầu này." });
    }
    if (job.status !== "pending_approval") {
      return res.status(409).json({ message: "Yêu cầu không còn ở trạng thái chờ duyệt." });
    }
    const reason = String(req.body?.reason || "").slice(0, 300);
    job.status = "rejected";
    job.rejectedBy = req.user._id;
    job.rejectReason = reason;
    job.finishedAt = new Date();
    await job.save();

    try {
      await pushToUsers({
        recipients: [String(job.requestedBy)],
        actorId: req.user._id,
        type: "BOOKING",
        title: "❌ Yêu cầu cắt clip bị từ chối",
        body: reason || "Chủ sân đã từ chối yêu cầu cắt clip ngoài giờ.",
        url: `/clips/${job._id}`,
        data: { kind: "clip_rejected", clipJobId: String(job._id) },
      });
    } catch (err) { console.error("[clip reject notify]", err?.message || err); }

    return res.json({ ok: true, job });
  } catch (e) {
    console.error("[clipController.rejectClip]", e);
    return res.status(500).json({ message: "Lỗi từ chối yêu cầu." });
  }
}
