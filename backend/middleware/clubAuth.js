// middleware/clubAuth.js
import Club from "../models/clubModel.js";
import ClubMember from "../models/clubMemberModel.js";

export const requireAuth = (req, _res, next) => {
  if (!req.user?._id) return next({ status: 401, message: "Unauthorized" });
  next();
};

// nạp club vào req.club
export const loadClub = async (req, res, next) => {
  const clubId = req.params.id || req.params.clubId;
  const club = await Club.findById(clubId);
  if (!club) return res.status(404).json({ message: "Club not found" });
  req.club = club;
  next();
};

// lấy membership hiện tại (nếu có)
export const loadMembership = async (req, _res, next) => {
  if (!req.user?._id || !req.club?._id) return next();
  const mem = await ClubMember.findOne({
    club: req.club._id,
    user: req.user._id,
  });
  req.clubMembership = mem || null;
  next();
};

export const requireOwner = (req, res, next) => {
  if (String(req.club.owner) !== String(req.user._id)) {
    return res.status(403).json({ message: "Owner permission required" });
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  const isOwner = String(req.club.owner) === String(req.user._id);
  const isAdmin =
    !!req.clubMembership &&
    ["owner", "admin"].includes(req.clubMembership.role);
  if (!isOwner && !isAdmin)
    return res.status(403).json({ message: "Admin permission required" });
  next();
};
