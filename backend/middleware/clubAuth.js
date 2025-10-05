// middleware/clubAuth.js
import mongoose from "mongoose";
import Club from "../models/clubModel.js";
import ClubMember from "../models/clubMemberModel.js";

/**
 * Nạp club vào req.club
 * - Hỗ trợ :id là ObjectId hoặc slug (lowercase)
 */
export const loadClub = async (req, res, next) => {
  try {
    const idOrSlug = String(req.params.id || req.params.clubId || "").trim();
    if (!idOrSlug) return res.status(400).json({ message: "Invalid club id" });

    const isId = mongoose.isValidObjectId(idOrSlug);
    const club = await Club.findOne(
      isId ? { _id: idOrSlug } : { slug: idOrSlug.toLowerCase() }
    );
    if (!club) return res.status(404).json({ message: "Club not found" });

    req.club = club;
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Lấy membership hiện tại (nếu có) vào req.clubMembership
 * - chỉ lấy status=active
 * - chọn trường gọn
 */
export const loadMembership = async (req, _res, next) => {
  try {
    if (!req.user?._id || !req.club?._id) {
      req.clubMembership = null;
      return next();
    }
    const mem = await ClubMember.findOne({
      club: req.club._id,
      user: req.user._id,
      status: "active",
    })
      .select("role status user club")
      .lean();

    req.clubMembership = mem || null;
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Ẩn CLB "hidden" với người lạ:
 * - Nếu club.visibility === "hidden" và user KHÔNG phải member/admin/owner -> trả 404 để che sự tồn tại
 * - Private/Public: cho qua, controller tự giảm/sanitize dữ liệu nếu cần
 */
export const ensureClubVisibleToUser = async (req, res, next) => {
  try {
    if (!req.club?._id)
      return res.status(400).json({ message: "Club is not loaded" });

    const isOwner =
      req.user?._id && String(req.club.owner) === String(req.user._id);

    // membership có thể chưa nạp -> tự nạp để chắc
    let membership = req.clubMembership;
    if (!membership && req.user?._id) {
      membership = await ClubMember.findOne({
        club: req.club._id,
        user: req.user._id,
        status: "active",
      })
        .select("role status")
        .lean();
      req.clubMembership = membership || null;
    }

    const isAdmin = isOwner || (membership && membership.role === "admin");
    const isMember = !!membership;

    if (req.club.visibility === "hidden" && !(isOwner || isAdmin || isMember)) {
      return res.status(404).json({ message: "Club not found" });
    }

    return next();
  } catch (e) {
    next(e);
  }
};

/** Chỉ owner */
export const requireOwner = (req, res, next) => {
  if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });
  if (!req.club?._id)
    return res.status(400).json({ message: "Club is not loaded" });

  if (String(req.club.owner) !== String(req.user._id)) {
    return res.status(403).json({ message: "Owner permission required" });
  }
  next();
};

/** Cần là member active (owner coi như member) */
export const requireMember = async (req, res, next) => {
  try {
    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthorized" });
    if (!req.club?._id)
      return res.status(400).json({ message: "Club is not loaded" });

    const isOwner = String(req.club.owner) === String(req.user._id);
    if (isOwner) return next();

    let membership = req.clubMembership;
    if (!membership) {
      membership = await ClubMember.findOne({
        club: req.club._id,
        user: req.user._id,
        status: "active",
      })
        .select("role status")
        .lean();
      req.clubMembership = membership || null;
    }
    if (!membership) {
      return res.status(403).json({ message: "Membership required" });
    }
    return next();
  } catch (e) {
    next(e);
  }
};

/** Admin (owner hoặc role=admin). Tự nạp membership nếu thiếu */
export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthorized" });
    if (!req.club?._id)
      return res.status(400).json({ message: "Club is not loaded" });

    const isOwner = String(req.club.owner) === String(req.user._id);
    if (isOwner) return next();

    let membership = req.clubMembership;
    if (!membership) {
      membership = await ClubMember.findOne({
        club: req.club._id,
        user: req.user._id,
        status: "active",
      })
        .select("role status")
        .lean();
      req.clubMembership = membership || null;
    }

    const isAdmin = !!membership && ["admin"].includes(membership.role);
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin permission required" });
    }
    return next();
  } catch (e) {
    next(e);
  }
};
