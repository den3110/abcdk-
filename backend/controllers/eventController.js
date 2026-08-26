// controllers/eventController.js
import ClubEvent from "../models/clubEventModel.js";
import ClubEventRsvp from "../models/clubEventRsvpModel.js";
import { canReadClubContent } from "../utils/clubVisibility.js";
import { notifyClubActivity } from "../services/clubNotifier.js";

export const listEvents = async (req, res) => {
  const { from, to, page = 1, limit = 20 } = req.query;
  const isMember =
    !!req.clubMembership || String(req.club.owner) === String(req.user?._id);

  if (!canReadClubContent(req.club, req.user?._id, isMember)) {
    return res.status(403).json({ message: "Không có quyền xem sự kiện." });
  }

  const filter = { club: req.club._id };
  if (from)
    filter.startAt = { ...(filter.startAt || {}), $gte: new Date(from) };
  if (to) filter.startAt = { ...(filter.startAt || {}), $lte: new Date(to) };
  if (!isMember) filter.visibility = "public";

  const total = await ClubEvent.countDocuments(filter);
  const items = await ClubEvent.find(filter)
    .sort({ startAt: 1 })
    .skip((+page - 1) * +limit)
    .limit(+limit)
    .lean();

  // Đính kèm trạng thái RSVP của chính user hiện tại cho mỗi sự kiện
  const meId = req.user?._id ? String(req.user._id) : null;
  if (meId && items.length) {
    const rsvps = await ClubEventRsvp.find({
      event: { $in: items.map((e) => e._id) },
      user: meId,
    })
      .select("event status")
      .lean();
    const rMap = {};
    for (const r of rsvps) rMap[String(r.event)] = r.status;
    for (const e of items) e.myStatus = rMap[String(e._id)] || "none";
  } else {
    for (const e of items) e.myStatus = "none";
  }

  res.json({ items, total, page: +page, limit: +limit });
};

export const createEvent = async (req, res) => {
  const {
    title,
    description = "",
    startAt,
    endAt,
    location = "",
    visibility = "public",
    rsvp = "open",
    capacity = 0,
  } = req.body || {};
  if (!startAt || !endAt)
    return res
      .status(400)
      .json({ message: "Thiếu thời gian bắt đầu/kết thúc." });
  const doc = await ClubEvent.create({
    club: req.club._id,
    createdBy: req.user._id,
    title: title?.trim(),
    description,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    location,
    visibility,
    rsvp,
    capacity: Number(capacity || 0),
  });
  res.status(201).json(doc);

  notifyClubActivity({
    club: req.club,
    actorId: req.user._id,
    title: `📅 ${req.club.name || "CLB"}: Sự kiện mới`,
    body: doc.title,
    url: `/clubs/${req.club._id}?tab=events`,
    data: { eventId: String(doc._id) },
  });
};

export const updateEvent = async (req, res) => {
  const allowed = [
    "title",
    "description",
    "startAt",
    "endAt",
    "location",
    "visibility",
    "rsvp",
    "capacity",
  ];
  const patch = {};
  allowed.forEach((k) => k in req.body && (patch[k] = req.body[k]));
  const doc = await ClubEvent.findOneAndUpdate(
    { _id: req.params.eventId, club: req.club._id },
    { $set: patch },
    { new: true }
  );
  if (!doc) return res.status(404).json({ message: "Không tìm thấy sự kiện" });
  res.json(doc);
};

export const deleteEvent = async (req, res) => {
  const del = await ClubEvent.deleteOne({
    _id: req.params.eventId,
    club: req.club._id,
  });
  if (!del.deletedCount)
    return res.status(404).json({ message: "Không tìm thấy sự kiện" });
  await ClubEventRsvp.deleteMany({ event: req.params.eventId });
  res.json({ ok: true });
};

export const rsvpEvent = async (req, res) => {
  const { status } = req.body || {}; // 'going' | 'not_going' | 'none'
  const event = await ClubEvent.findOne({
    _id: req.params.eventId,
    club: req.club._id,
  });
  if (!event) return res.status(404).json({ message: "Sự kiện không tồn tại" });

  const isMember =
    !!req.clubMembership || String(req.club.owner) === String(req.user?._id);
  if (event.visibility === "members" && !isMember) {
    return res.status(403).json({ message: "Chỉ thành viên được RSVP." });
  }

  if (status === "none") {
    const del = await ClubEventRsvp.deleteOne({
      event: event._id,
      user: req.user._id,
    });
    if (del.deletedCount) {
      await ClubEvent.updateOne(
        { _id: event._id },
        { $inc: { attendeesCount: -1 } }
      );
    }
    return res.json({ ok: true });
  }

  if (!["going", "not_going"].includes(status)) {
    return res.status(400).json({ message: "Trạng thái RSVP không hợp lệ." });
  }

  // capacity check
  if (status === "going" && event.rsvp === "limit" && event.capacity > 0) {
    if (event.attendeesCount >= event.capacity) {
      return res.status(409).json({ message: "Sự kiện đã đủ chỗ." });
    }
  }

  const prev = await ClubEventRsvp.findOneAndUpdate(
    { event: event._id, user: req.user._id },
    { $set: { status } },
    { upsert: true, new: false }
  );

  if (!prev || prev.status !== "going") {
    if (status === "going") {
      await ClubEvent.updateOne(
        { _id: event._id },
        { $inc: { attendeesCount: 1 } }
      );
    }
  }
  if (prev && prev.status === "going" && status !== "going") {
    await ClubEvent.updateOne(
      { _id: event._id },
      { $inc: { attendeesCount: -1 } }
    );
  }

  res.json({ ok: true });
};

/** Danh sách người tham gia (RSVP "going") của 1 sự kiện */
export const listEventAttendees = async (req, res) => {
  const isMember =
    !!req.clubMembership || String(req.club.owner) === String(req.user?._id);
  if (!canReadClubContent(req.club, req.user?._id, isMember)) {
    return res.status(403).json({ message: "Không có quyền xem sự kiện." });
  }
  const event = await ClubEvent.findOne({
    _id: req.params.eventId,
    club: req.club._id,
  }).lean();
  if (!event) return res.status(404).json({ message: "Sự kiện không tồn tại" });

  const { limit = 100 } = req.query;
  const rows = await ClubEventRsvp.find({ event: event._id, status: "going" })
    .sort({ createdAt: 1 })
    .limit(Math.min(500, +limit || 100))
    .populate("user", "fullName nickname avatar")
    .lean();

  const items = rows.map((r) => r.user).filter(Boolean);
  res.json({ items, total: event.attendeesCount || items.length });
};

export const getEventIcs = async (req, res) => {
  const event = await ClubEvent.findOne({
    _id: req.params.eventId,
    club: req.club._id,
  });
  if (!event) return res.status(404).json({ message: "Sự kiện không tồn tại" });

  // simple ICS
  const dt = (d) =>
    new Date(d)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SportConnect//CLB Events//VN",
    "BEGIN:VEVENT",
    `UID:${event._id}@sportconnect`,
    `DTSTAMP:${dt(new Date())}`,
    `DTSTART:${dt(event.startAt)}`,
    `DTEND:${dt(event.endAt)}`,
    `SUMMARY:${(event.title || "").replace(/\n/g, " ")}`,
    `LOCATION:${(event.location || "").replace(/\n/g, " ")}`,
    `DESCRIPTION:${(event.description || "").replace(/\n/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="event-${event._id}.ics"`
  );
  res.send(ics);
};
