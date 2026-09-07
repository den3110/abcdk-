// controllers/venueStaffController.js — Quản lý nhân viên & phân quyền cụm sân
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../models/venueModel.js";
import VenueStaff from "../models/venueStaffModel.js";
import User from "../models/userModel.js";
import { resolveVenueAccess, venueCan } from "../utils/venueAuth.js";
import { notifyStaffAssigned } from "../services/venueNotify.js";
import {
  VENUE_PERMISSIONS,
  VENUE_STAFF_ROLES,
  VENUE_ROLE_LABEL,
  VENUE_ROLE_PRESETS,
  effectivePermissions,
  sanitizePermissions,
} from "../utils/venuePermissions.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const STAFF_USER_FIELDS = "name nickname phone email avatar";

async function loadVenue(req, res) {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const venue = await Venue.findById(id);
  if (!venue) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  return venue;
}

/** Đồng bộ Venue.managers theo role: manager+active ⇒ có trong managers, còn lại ⇒ bỏ ra. */
async function syncManager(venue, userId, isManagerActive) {
  const uid = String(userId);
  const has = (venue.managers || []).some((m) => String(m) === uid);
  if (isManagerActive && !has) {
    venue.managers.push(userId);
    await venue.save();
  } else if (!isManagerActive && has) {
    venue.managers = venue.managers.filter((m) => String(m) !== uid);
    await venue.save();
  }
}

/** GET /api/venues/:id/staff — danh sách nhân viên (cần quyền staff.manage) */
export const listStaff = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenue(req, res);
  if (!(await venueCan(req.user, venue, "staff.manage"))) {
    res.status(403);
    throw new Error("Không có quyền quản lý nhân viên");
  }
  const staff = await VenueStaff.find({ venue: venue._id })
    .populate("user", STAFF_USER_FIELDS)
    .sort({ createdAt: 1 })
    .lean();
  const owner = await User.findById(venue.owner).select(STAFF_USER_FIELDS).lean();
  res.json({
    owner: owner ? { user: owner, role: "owner" } : null,
    staff: staff.map((s) => ({
      ...s,
      permissions: effectivePermissions(s.role, s.permissions),
      roleLabel: VENUE_ROLE_LABEL[s.role] || s.role,
    })),
    roles: VENUE_STAFF_ROLES.map((r) => ({
      key: r,
      label: VENUE_ROLE_LABEL[r],
      preset: VENUE_ROLE_PRESETS[r],
    })),
    permissions: VENUE_PERMISSIONS,
  });
});

/** POST /api/venues/:id/staff  { userId, role, permissions? } */
export const addStaff = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenue(req, res);
  if (!(await venueCan(req.user, venue, "staff.manage"))) {
    res.status(403);
    throw new Error("Không có quyền quản lý nhân viên");
  }
  const { userId } = req.body || {};
  if (!isId(userId)) {
    res.status(400);
    throw new Error("Thiếu người dùng");
  }
  if (String(userId) === String(venue.owner)) {
    res.status(400);
    throw new Error("Người này là chủ sân");
  }
  const user = await User.findById(userId).select(STAFF_USER_FIELDS).lean();
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }
  const role = VENUE_STAFF_ROLES.includes(req.body?.role) ? req.body.role : "staff";
  const permissions =
    role === "manager"
      ? []
      : req.body?.permissions
        ? sanitizePermissions(req.body.permissions)
        : [...VENUE_ROLE_PRESETS[role]];

  const doc = await VenueStaff.findOneAndUpdate(
    { venue: venue._id, user: userId },
    {
      $set: { role, permissions, active: true, note: String(req.body?.note || "").slice(0, 200) },
      $setOnInsert: { addedBy: req.user._id },
    },
    { new: true, upsert: true },
  );
  await syncManager(venue, userId, role === "manager");
  notifyStaffAssigned(venue, userId, role, req.user._id).catch(() => {});

  res.status(201).json({
    ...doc.toObject(),
    user,
    permissions: effectivePermissions(role, permissions),
    roleLabel: VENUE_ROLE_LABEL[role],
  });
});

/** PATCH /api/venues/:id/staff/:staffId  { role?, permissions?, active? } */
export const updateStaff = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenue(req, res);
  if (!(await venueCan(req.user, venue, "staff.manage"))) {
    res.status(403);
    throw new Error("Không có quyền quản lý nhân viên");
  }
  const { staffId } = req.params;
  if (!isId(staffId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const staff = await VenueStaff.findOne({ _id: staffId, venue: venue._id });
  if (!staff) {
    res.status(404);
    throw new Error("Không tìm thấy nhân viên");
  }
  if (VENUE_STAFF_ROLES.includes(req.body?.role)) staff.role = req.body.role;
  if (Array.isArray(req.body?.permissions)) staff.permissions = sanitizePermissions(req.body.permissions);
  if (typeof req.body?.active === "boolean") staff.active = req.body.active;
  if (req.body?.note !== undefined) staff.note = String(req.body.note).slice(0, 200);
  if (staff.role === "manager") staff.permissions = [];
  await staff.save();
  await syncManager(venue, staff.user, staff.role === "manager" && staff.active);

  const user = await User.findById(staff.user).select(STAFF_USER_FIELDS).lean();
  res.json({
    ...staff.toObject(),
    user,
    permissions: effectivePermissions(staff.role, staff.permissions),
    roleLabel: VENUE_ROLE_LABEL[staff.role],
  });
});

/** DELETE /api/venues/:id/staff/:staffId */
export const removeStaff = expressAsyncHandler(async (req, res) => {
  const venue = await loadVenue(req, res);
  if (!(await venueCan(req.user, venue, "staff.manage"))) {
    res.status(403);
    throw new Error("Không có quyền quản lý nhân viên");
  }
  const { staffId } = req.params;
  if (!isId(staffId)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const staff = await VenueStaff.findOne({ _id: staffId, venue: venue._id });
  if (staff) {
    await VenueStaff.deleteOne({ _id: staff._id });
    await syncManager(venue, staff.user, false);
  }
  res.json({ ok: true });
});

/** GET /api/venues/:id/my-access — quyền của user hiện tại với venue (để FE ẩn/hiện menu) */
export const getMyVenueAccess = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const access = await resolveVenueAccess(req.user, id);
  res.json({
    role: access.role,
    roleLabel: access.role ? VENUE_ROLE_LABEL[access.role] || access.role : null,
    permissions: access.permissions,
    canManage: access.canManage,
  });
});
