// controllers/announcementController.js
import ClubAnnouncement from "../models/clubAnnouncementModel.js";
import ClubMember from "../models/clubMemberModel.js";
import {
  canReadClubContent,
  itemVisibleToUser,
} from "../utils/clubVisibility.js";

export const listAnnouncements = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const isMember =
    !!req.clubMembership || String(req.club.owner) === String(req.user?._id);

  if (!canReadClubContent(req.club, req.user?._id, isMember)) {
    return res
      .status(403)
      .json({ message: "Không có quyền xem nội dung CLB này." });
  }

  const filter = { club: req.club._id };
  // nếu không phải member ở CLB private/public → chỉ lấy 'public'
  if (!isMember) filter.visibility = "public";

  const total = await ClubAnnouncement.countDocuments(filter);
  const items = await ClubAnnouncement.find(filter)
    .sort({ pinned: -1, createdAt: -1 })
    .skip((+page - 1) * +limit)
    .limit(+limit)
    .populate("author", "fullName nickname avatar");

  res.json({ items, total, page: +page, limit: +limit });
};

export const createAnnouncement = async (req, res) => {
  const {
    title,
    content,
    pinned = false,
    visibility = "public",
  } = req.body || {};
  const doc = await ClubAnnouncement.create({
    club: req.club._id,
    author: req.user._id,
    title: String(title || "").trim(),
    content: String(content || ""),
    pinned: !!pinned,
    visibility,
  });
  res.status(201).json(doc);
};

export const updateAnnouncement = async (req, res) => {
  const patch = {};
  ["title", "content", "pinned", "visibility"].forEach((k) => {
    if (k in req.body) patch[k] = req.body[k];
  });
  const doc = await ClubAnnouncement.findOneAndUpdate(
    { _id: req.params.annId, club: req.club._id },
    { $set: patch },
    { new: true }
  );
  if (!doc) return res.status(404).json({ message: "Không tìm thấy bài" });
  res.json(doc);
};

export const deleteAnnouncement = async (req, res) => {
  const del = await ClubAnnouncement.deleteOne({
    _id: req.params.annId,
    club: req.club._id,
  });
  if (!del.deletedCount)
    return res.status(404).json({ message: "Không tìm thấy bài" });
  res.json({ ok: true });
};
