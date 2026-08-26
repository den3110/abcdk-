// controllers/galleryController.js
// Thư viện ảnh CLB
import ClubPhoto from "../models/clubPhotoModel.js";
import ClubMember from "../models/clubMemberModel.js";
import { canReadClubContent } from "../utils/clubVisibility.js";

const UPLOADER_FIELDS = "fullName nickname avatar";

async function resolveIsMember(req) {
  const meId = req.user?._id ? String(req.user._id) : null;
  if (!meId) return false;
  if (String(req.club.owner) === meId) return true;
  if (req.clubMembership?.status === "active") return true;
  const exists = await ClubMember.exists({
    club: req.club._id,
    user: meId,
    status: "active",
  });
  return !!exists;
}
function isAdminReq(req) {
  const isOwner =
    req.user?._id && String(req.club.owner) === String(req.user._id);
  return isOwner || req.clubMembership?.role === "admin";
}

/** GET /clubs/:id/photos */
export const listPhotos = async (req, res) => {
  try {
    const meId = req.user?._id ? String(req.user._id) : null;
    const isMember = await resolveIsMember(req);
    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem thư viện." });
    }
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const filter = { club: req.club._id };
    const [items, total] = await Promise.all([
      ClubPhoto.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("uploadedBy", UPLOADER_FIELDS)
        .lean(),
      ClubPhoto.countDocuments(filter),
    ]);
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listPhotos error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/photos — thành viên thêm ảnh (1 hoặc nhiều) */
export const addPhotos = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới được thêm ảnh." });
    }
    // chấp nhận { url, caption } hoặc { photos: [{url, caption}] } hoặc { urls: [..] }
    let list = [];
    if (Array.isArray(req.body?.photos)) list = req.body.photos;
    else if (Array.isArray(req.body?.urls))
      list = req.body.urls.map((u) => ({ url: u }));
    else if (req.body?.url) list = [{ url: req.body.url, caption: req.body.caption }];

    const docs = list
      .map((p) => ({
        club: req.club._id,
        uploadedBy: req.user._id,
        url: String(p?.url || "").trim(),
        caption: String(p?.caption || "").slice(0, 500),
      }))
      .filter((p) => p.url);

    if (!docs.length) {
      return res.status(400).json({ message: "Thiếu ảnh hợp lệ." });
    }
    const created = await ClubPhoto.insertMany(docs);
    const populated = await ClubPhoto.find({
      _id: { $in: created.map((c) => c._id) },
    })
      .sort({ createdAt: -1 })
      .populate("uploadedBy", UPLOADER_FIELDS)
      .lean();
    return res.status(201).json({ items: populated });
  } catch (err) {
    console.error("addPhotos error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/photos/:photoId — người tải hoặc admin */
export const deletePhoto = async (req, res) => {
  try {
    const photo = await ClubPhoto.findOne({
      _id: req.params.photoId,
      club: req.club._id,
    });
    if (!photo)
      return res.status(404).json({ message: "Không tìm thấy ảnh." });
    const isUploader =
      String(photo.uploadedBy) === String(req.user._id);
    if (!isUploader && !isAdminReq(req)) {
      return res.status(403).json({ message: "Không có quyền xoá ảnh này." });
    }
    await ClubPhoto.deleteOne({ _id: photo._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deletePhoto error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
