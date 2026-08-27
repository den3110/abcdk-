// controllers/playController.js — "Tìm bạn đánh" (matchmaking giao lưu)
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import PlayInvite, { PLAY_STATUSES } from "../models/playInviteModel.js";
import { postDirectMessage } from "./chatController.js";
import { createInAppNotifications } from "../services/inAppNotify.js";
import { checkActionPhoneGate, PHONE_GATE_MESSAGE } from "../utils/phoneGate.js";

const HOST_FIELDS = "_id name nickname avatar province";

const oid = (v) => {
  try {
    return new mongoose.Types.ObjectId(String(v));
  } catch {
    return null;
  }
};

const userDTO = (u) => {
  if (!u) return null;
  const o = u.toObject ? u.toObject() : u;
  return {
    _id: o._id,
    name: o.name || "",
    nickname: o.nickname || "",
    avatar: o.avatar || "",
    province: o.province || "",
  };
};

function toDTO(doc, meId) {
  const o = doc.toObject ? doc.toObject() : doc;
  const me = meId ? String(meId) : "";
  const hostId = o.host?._id ? String(o.host._id) : String(o.host);
  const isHost = me && hostId === me;

  const parts = (o.participants || []).map((p) => ({
    user: p.user?._id ? userDTO(p.user) : p.user,
    status: p.status,
    note: p.note || "",
    at: p.at,
  }));
  const myEntry = parts.find(
    (p) => String(p.user?._id || p.user) === me
  );
  let myStatus = "none";
  if (isHost) myStatus = "host";
  else if (myEntry) myStatus = myEntry.status;

  // Non-host chỉ thấy participant đã accepted (+ entry của chính mình)
  const visibleParts = isHost
    ? parts
    : parts.filter(
        (p) => p.status === "accepted" || String(p.user?._id || p.user) === me
      );

  const accepted = (o.participants || []).filter((p) => p.status === "accepted");
  const slotsLeft = Math.max(0, (o.slots || 0) - accepted.length);

  const canSeeContact = isHost || myStatus === "accepted";

  return {
    _id: o._id,
    host: userDTO(o.host),
    title: o.title || "",
    note: o.note || "",
    province: o.province || "",
    district: o.district || "",
    courtName: o.courtName || "",
    playAt: o.playAt,
    durationMin: o.durationMin || 90,
    skillMin: o.skillMin ?? null,
    skillMax: o.skillMax ?? null,
    slots: o.slots || 0,
    acceptedCount: accepted.length,
    slotsLeft,
    pendingCount: (o.participants || []).filter((p) => p.status === "pending").length,
    status: o.status,
    contactPhone: canSeeContact ? o.contactPhone || "" : "",
    participants: visibleParts,
    myStatus,
    isHost: !!isHost,
    createdAt: o.createdAt,
  };
}

/* ─────────── LIST ─────────── */
// GET /api/play
export const listInvites = asyncHandler(async (req, res) => {
  const { province, skill, status, host, mine, sort, page = 1, limit = 20 } =
    req.query;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 48);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const meId = req.user?._id;

  const filter = {};
  if (host && oid(host)) {
    filter.host = oid(host);
  } else if (mine === "1" && meId) {
    filter.$or = [{ host: meId }, { "participants.user": meId }];
  } else {
    // Mặc định: kèo đang mở HOẶC đã đủ người (vẫn hiển thị, badge "Đã đủ người"),
    // còn trong tương lai (hoặc trong 6h qua)
    filter.status =
      status && PLAY_STATUSES.includes(status)
        ? status
        : { $in: ["open", "full"] };
    filter.playAt = { $gte: new Date(Date.now() - 6 * 3600 * 1000) };
  }
  if (province) filter.province = new RegExp(String(province).trim(), "i");
  const sk = Number(skill);
  if (!Number.isNaN(sk) && skill !== "" && skill != null) {
    // Kèo phù hợp trình sk: (skillMin null hoặc <= sk) và (skillMax null hoặc >= sk)
    filter.$and = [
      { $or: [{ skillMin: null }, { skillMin: { $lte: sk } }] },
      { $or: [{ skillMax: null }, { skillMax: { $gte: sk } }] },
    ];
  }

  const sortSpec =
    sort === "newest" ? { createdAt: -1 } : { playAt: 1, createdAt: -1 };

  const [items, total] = await Promise.all([
    PlayInvite.find(filter)
      .sort(sortSpec)
      .skip((pg - 1) * lim)
      .limit(lim)
      .populate("host", HOST_FIELDS)
      .populate("participants.user", HOST_FIELDS),
    PlayInvite.countDocuments(filter),
  ]);

  res.json({
    items: items.map((it) => toDTO(it, meId)),
    page: pg,
    total,
    hasMore: pg * lim < total,
  });
});

/* ─────────── DETAIL ─────────── */
export const getInvite = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await PlayInvite.findById(id)
    .populate("host", HOST_FIELDS)
    .populate("participants.user", HOST_FIELDS);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  res.json(toDTO(doc, req.user?._id));
});

/* ─────────── CREATE ─────────── */
export const createInvite = asyncHandler(async (req, res) => {
  const gate = await checkActionPhoneGate(req.user._id);
  if (gate.required && !gate.verified) {
    res.status(403);
    throw new Error(PHONE_GATE_MESSAGE);
  }
  const b = req.body || {};
  if (!b.playAt) return res.status(400).json({ message: "Vui lòng chọn thời gian chơi" });
  const playAt = new Date(b.playAt);
  if (Number.isNaN(playAt.getTime())) {
    return res.status(400).json({ message: "Thời gian không hợp lệ" });
  }
  const doc = await PlayInvite.create({
    host: req.user._id,
    title: String(b.title || "").slice(0, 140),
    note: String(b.note || "").slice(0, 2000),
    province: String(b.province || "").slice(0, 80),
    district: String(b.district || "").slice(0, 80),
    courtName: String(b.courtName || "").slice(0, 160),
    playAt,
    durationMin: Math.max(15, Math.min(600, Number(b.durationMin) || 90)),
    skillMin: b.skillMin != null && b.skillMin !== "" ? Number(b.skillMin) : null,
    skillMax: b.skillMax != null && b.skillMax !== "" ? Number(b.skillMax) : null,
    slots: Math.max(1, Math.min(50, Number(b.slots) || 1)),
    contactPhone: String(b.contactPhone || "").slice(0, 20),
  });
  const populated = await PlayInvite.findById(doc._id).populate("host", HOST_FIELDS);
  res.status(201).json(toDTO(populated, req.user._id));
});

/* ─────────── UPDATE (host) ─────────── */
export const updateInvite = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await PlayInvite.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  if (String(doc.host) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền sửa kèo này" });
  }
  const b = req.body || {};
  if (b.title !== undefined) doc.title = String(b.title).slice(0, 140);
  if (b.note !== undefined) doc.note = String(b.note).slice(0, 2000);
  if (b.province !== undefined) doc.province = String(b.province).slice(0, 80);
  if (b.district !== undefined) doc.district = String(b.district).slice(0, 80);
  if (b.courtName !== undefined) doc.courtName = String(b.courtName).slice(0, 160);
  if (b.playAt !== undefined) {
    const d = new Date(b.playAt);
    if (!Number.isNaN(d.getTime())) doc.playAt = d;
  }
  if (b.durationMin !== undefined)
    doc.durationMin = Math.max(15, Math.min(600, Number(b.durationMin) || 90));
  if (b.skillMin !== undefined)
    doc.skillMin = b.skillMin === "" || b.skillMin == null ? null : Number(b.skillMin);
  if (b.skillMax !== undefined)
    doc.skillMax = b.skillMax === "" || b.skillMax == null ? null : Number(b.skillMax);
  if (b.slots !== undefined) doc.slots = Math.max(1, Math.min(50, Number(b.slots) || 1));
  if (b.contactPhone !== undefined) doc.contactPhone = String(b.contactPhone).slice(0, 20);
  if (b.status !== undefined && PLAY_STATUSES.includes(b.status)) doc.status = b.status;
  await doc.save();
  const populated = await PlayInvite.findById(doc._id)
    .populate("host", HOST_FIELDS)
    .populate("participants.user", HOST_FIELDS);
  res.json(toDTO(populated, req.user._id));
});

/* ─────────── CANCEL / DELETE (host) ─────────── */
export const deleteInvite = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await PlayInvite.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  const isAdmin = req.user?.role === "admin" || req.user?.isAdmin;
  if (String(doc.host) !== String(req.user._id) && !isAdmin) {
    return res.status(403).json({ message: "Bạn không có quyền xoá kèo này" });
  }
  await doc.deleteOne();
  res.json({ ok: true });
});

/* ─────────── REQUEST JOIN ─────────── */
// POST /api/play/:id/join   { note }
export const requestJoin = asyncHandler(async (req, res) => {
  const gate = await checkActionPhoneGate(req.user._id);
  if (gate.required && !gate.verified) {
    res.status(403);
    throw new Error(PHONE_GATE_MESSAGE);
  }
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await PlayInvite.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  if (String(doc.host) === String(req.user._id)) {
    return res.status(400).json({ message: "Bạn là chủ kèo" });
  }
  if (!["open", "full"].includes(doc.status)) {
    return res.status(400).json({ message: "Kèo đã đóng" });
  }
  const existing = doc.participants.find(
    (p) => String(p.user) === String(req.user._id)
  );
  if (existing && existing.status !== "declined") {
    return res.status(400).json({ message: "Bạn đã xin tham gia kèo này rồi" });
  }
  const note = String(req.body?.note || "").slice(0, 300);
  if (existing) {
    existing.status = "pending";
    existing.note = note;
    existing.at = new Date();
  } else {
    doc.participants.push({ user: req.user._id, status: "pending", note });
  }
  await doc.save();

  // Thông báo + nhắn tin cho chủ kèo
  try {
    const who = req.user.nickname || req.user.name || "Ai đó";
    await createInAppNotifications({
      recipients: doc.host,
      actorId: req.user._id,
      type: "PLAY_INVITE_JOIN",
      title: "Có người muốn tham gia kèo",
      body: `${who} xin tham gia kèo "${doc.title || doc.courtName || "giao lưu"}"`,
      url: `/play/${String(id)}`,
      data: { playId: String(id) },
    });
    await postDirectMessage({
      fromUserId: req.user._id,
      toUserId: doc.host,
      content: `🏓 Mình xin tham gia kèo "${doc.title || doc.courtName || "giao lưu"}"${note ? `: "${note}"` : ""}`,
      linkedPlay: id,
    });
  } catch {}

  const populated = await PlayInvite.findById(doc._id)
    .populate("host", HOST_FIELDS)
    .populate("participants.user", HOST_FIELDS);
  res.json(toDTO(populated, req.user._id));
});

/* ─────────── RESPOND JOIN (host) ─────────── */
// PATCH /api/play/:id/join/:userId  { action: accept|decline }
export const respondJoin = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  const uid = oid(req.params.userId);
  if (!id || !uid) return res.status(400).json({ message: "ID không hợp lệ" });
  const { action } = req.body || {};
  const doc = await PlayInvite.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  if (String(doc.host) !== String(req.user._id)) {
    return res.status(403).json({ message: "Bạn không có quyền" });
  }
  const p = doc.participants.find((x) => String(x.user) === String(uid));
  if (!p) return res.status(404).json({ message: "Không tìm thấy người tham gia" });

  if (action === "accept") {
    p.status = "accepted";
  } else if (action === "decline") {
    p.status = "declined";
  } else {
    return res.status(400).json({ message: "Hành động không hợp lệ" });
  }

  const accepted = doc.participants.filter((x) => x.status === "accepted").length;
  doc.acceptedCount = accepted;
  if (doc.status !== "cancelled" && doc.status !== "done") {
    doc.status = accepted >= doc.slots ? "full" : "open";
  }
  await doc.save();

  // Thông báo cho người xin tham gia
  try {
    const accept = action === "accept";
    await createInAppNotifications({
      recipients: uid,
      actorId: req.user._id,
      type: accept ? "PLAY_INVITE_ACCEPTED" : "SYSTEM",
      title: accept ? "Được nhận vào kèo 🎉" : "Kèo đã từ chối",
      body: accept
        ? `Bạn đã được nhận vào kèo "${doc.title || doc.courtName || "giao lưu"}"`
        : `Chủ kèo đã từ chối yêu cầu tham gia`,
      url: `/play/${String(id)}`,
      data: { playId: String(id) },
    });
    const content = accept
      ? `✅ Bạn đã được nhận vào kèo "${doc.title || doc.courtName || "giao lưu"}"! Hẹn gặp tại sân nhé.`
      : `Rất tiếc, kèo "${doc.title || doc.courtName || "giao lưu"}" đã đủ người / không phù hợp lần này.`;
    await postDirectMessage({
      fromUserId: req.user._id,
      toUserId: uid,
      content,
      linkedPlay: doc._id,
    });
  } catch {}

  const populated = await PlayInvite.findById(doc._id)
    .populate("host", HOST_FIELDS)
    .populate("participants.user", HOST_FIELDS);
  res.json(toDTO(populated, req.user._id));
});

/* ─────────── LEAVE (participant tự rời) ─────────── */
export const leaveInvite = asyncHandler(async (req, res) => {
  const id = oid(req.params.id);
  if (!id) return res.status(400).json({ message: "ID không hợp lệ" });
  const doc = await PlayInvite.findById(id);
  if (!doc) return res.status(404).json({ message: "Không tìm thấy kèo" });
  doc.participants = doc.participants.filter(
    (p) => String(p.user) !== String(req.user._id)
  );
  doc.acceptedCount = doc.participants.filter((x) => x.status === "accepted").length;
  if (doc.status === "full" && doc.acceptedCount < doc.slots) doc.status = "open";
  await doc.save();
  const populated = await PlayInvite.findById(doc._id)
    .populate("host", HOST_FIELDS)
    .populate("participants.user", HOST_FIELDS);
  res.json(toDTO(populated, req.user._id));
});
