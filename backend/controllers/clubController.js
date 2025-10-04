// controllers/clubController.js
import mongoose from "mongoose";
import Club, { CLUB_JOIN_POLICY } from "../models/clubModel.js";
import ClubMember from "../models/clubMemberModel.js";
import ClubJoinRequest from "../models/clubJoinRequestModel.js";

const ensureSlugUnique = async (name) => {
  const base = Club.slugify(name);
  let slug = base;
  let i = 1;
  while (await Club.findOne({ slug })) {
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
};

/** CREATE */
export const createClub = async (req, res) => {
  const {
    name,
    description,
    visibility,
    joinPolicy,
    sportTypes,
    province,
    city,
    logoUrl,
    coverUrl,
    shortCode,
    website,
    facebook,
    zalo,
    tags,
  } = req.body || {};

  if (!name?.trim())
    return res.status(400).json({ message: "Name is required" });

  const slug = await ensureSlugUnique(name);
  const club = await Club.create({
    name: name.trim(),
    slug,
    description: description?.trim() || "",
    visibility: visibility || "public",
    joinPolicy: joinPolicy || "approval",
    sportTypes:
      Array.isArray(sportTypes) && sportTypes.length
        ? sportTypes
        : ["pickleball"],
    province: province || "",
    city: city || "",
    logoUrl: logoUrl || "",
    coverUrl: coverUrl || "",
    shortCode: shortCode || "",
    website: website || "",
    facebook: facebook || "",
    zalo: zalo || "",
    tags: tags || [],
    owner: req.user._id,
    admins: [],
    stats: { memberCount: 1 },
  });

  await ClubMember.create({
    club: club._id,
    user: req.user._id,
    role: "owner",
    status: "active",
  });

  res.status(201).json(club);
};

/** UPDATE (owner/admin) */
export const updateClub = async (req, res) => {
  const allowed = [
    "name",
    "description",
    "visibility",
    "joinPolicy",
    "sportTypes",
    "province",
    "city",
    "logoUrl",
    "coverUrl",
    "shortCode",
    "website",
    "facebook",
    "zalo",
    "tags",
    "isVerified",
  ];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

  const club = await Club.findByIdAndUpdate(
    req.club._id,
    { $set: patch },
    { new: true }
  );
  res.json(club);
};

/** LIST (public) + filter */
export const listClubs = async (req, res) => {
  const {
    q,
    sport,
    province,
    visibility,
    mine,
    page = 1,
    limit = 20,
  } = req.query;
  const filter = {};
  if (visibility) filter.visibility = visibility;
  if (sport) filter.sportTypes = sport;
  if (province) filter.province = province;
  if (q) filter.$text = { $search: q };

  if (mine === "true" && req.user?._id) {
    const memberClubIds = await ClubMember.find({
      user: req.user._id,
    }).distinct("club");
    filter._id = { $in: memberClubIds };
  }

  const cursor = Club.find(filter).sort({ createdAt: -1 });
  const total = await Club.countDocuments(filter);
  const items = await cursor.skip((+page - 1) * +limit).limit(+limit);
  res.json({ items, total, page: +page, limit: +limit });
};

/** DETAIL */
export const getClub = async (req, res) => res.json(req.club);

/** MEMBERS: list */
export const listMembers = async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const filter = { club: req.club._id };
  const cursor = ClubMember.find(filter).populate(
    "user",
    "fullName nickname avatar email"
  );
  const total = await ClubMember.countDocuments(filter);
  const items = await cursor.skip((+page - 1) * +limit).limit(+limit);
  res.json({ items, total, page: +page, limit: +limit });
};

/** JOIN flow */
export const requestJoin = async (req, res) => {
  const club = req.club;

  const exists = await ClubMember.findOne({
    club: club._id,
    user: req.user._id,
  });
  if (exists) return res.status(409).json({ message: "Already a member" });

  if (club.joinPolicy === "invite_only") {
    return res.status(403).json({ message: "This club is invite-only" });
  }

  if (club.joinPolicy === "open") {
    await ClubMember.create({
      club: club._id,
      user: req.user._id,
      role: "member",
      status: "active",
    });
    await Club.updateOne(
      { _id: club._id },
      { $inc: { "stats.memberCount": 1 } }
    );
    return res.status(201).json({ joined: true });
  }

  const msg = (req.body?.message || "").slice(0, 2000);
  const jr = await ClubJoinRequest.create({
    club: club._id,
    user: req.user._id,
    message: msg,
    status: "pending",
  });
  res.status(201).json(jr);
};

export const cancelMyJoin = async (req, res) => {
  const jr = await ClubJoinRequest.findOne({
    club: req.club._id,
    user: req.user._id,
    status: "pending",
  });
  if (!jr) return res.status(404).json({ message: "No pending request" });
  jr.status = "cancelled";
  jr.decidedAt = new Date();
  jr.decidedBy = req.user._id;
  await jr.save();
  res.json(jr);
};

export const listJoinRequests = async (req, res) => {
  const { page = 1, limit = 50, status = "pending" } = req.query;
  const filter = { club: req.club._id };
  if (status) filter.status = status;
  const total = await ClubJoinRequest.countDocuments(filter);
  const items = await ClubJoinRequest.find(filter)
    .sort({ createdAt: -1 })
    .skip((+page - 1) * +limit)
    .limit(+limit)
    .populate("user", "fullName nickname avatar email");
  res.json({ items, total, page: +page, limit: +limit });
};

export const acceptJoin = async (req, res) => {
  const jr = await ClubJoinRequest.findOne({
    _id: req.params.reqId,
    club: req.club._id,
    status: "pending",
  });
  if (!jr) return res.status(404).json({ message: "Join request not found" });

  const exists = await ClubMember.findOne({
    club: req.club._id,
    user: jr.user,
  });
  if (!exists) {
    await ClubMember.create({
      club: req.club._id,
      user: jr.user,
      role: "member",
      status: "active",
    });
    await Club.updateOne(
      { _id: req.club._id },
      { $inc: { "stats.memberCount": 1 } }
    );
  }
  jr.status = "accepted";
  jr.decidedAt = new Date();
  jr.decidedBy = req.user._id;
  await jr.save();

  res.json(jr);
};

export const rejectJoin = async (req, res) => {
  const jr = await ClubJoinRequest.findOne({
    _id: req.params.reqId,
    club: req.club._id,
    status: "pending",
  });
  if (!jr) return res.status(404).json({ message: "Join request not found" });
  jr.status = "rejected";
  jr.decidedAt = new Date();
  jr.decidedBy = req.user._id;
  await jr.save();
  res.json(jr);
};

/** Members: add/remove/setRole */
export const addMember = async (req, res) => {
  const { userId, role = "member" } = req.body || {};
  if (!mongoose.isValidObjectId(userId))
    return res.status(400).json({ message: "Invalid userId" });

  const exist = await ClubMember.findOne({ club: req.club._id, user: userId });
  if (exist) return res.status(409).json({ message: "Already a member" });

  await ClubMember.create({
    club: req.club._id,
    user: userId,
    role,
    status: "active",
  });
  await Club.updateOne(
    { _id: req.club._id },
    { $inc: { "stats.memberCount": 1 } }
  );
  res.status(201).json({ ok: true });
};

export const setRole = async (req, res) => {
  const { role } = req.body || {};
  if (!["admin", "member"].includes(role))
    return res.status(400).json({ message: "Invalid role" });

  const target = await ClubMember.findOne({
    club: req.club._id,
    user: req.params.userId,
  });
  if (!target) return res.status(404).json({ message: "Member not found" });
  if (target.role === "owner")
    return res.status(403).json({ message: "Cannot modify owner role" });

  target.role = role;
  await target.save();
  res.json(target);
};

export const kickMember = async (req, res) => {
  const target = await ClubMember.findOne({
    club: req.club._id,
    user: req.params.userId,
  });
  if (!target) return res.status(404).json({ message: "Member not found" });
  if (target.role === "owner")
    return res.status(403).json({ message: "Cannot remove owner" });

  await ClubMember.deleteOne({ _id: target._id });
  await Club.updateOne(
    { _id: req.club._id },
    { $inc: { "stats.memberCount": -1 } }
  );
  res.json({ ok: true });
};

export const leaveClub = async (req, res) => {
  const me = await ClubMember.findOne({
    club: req.club._id,
    user: req.user._id,
  });
  if (!me) return res.status(404).json({ message: "Not a member" });
  if (me.role === "owner")
    return res
      .status(403)
      .json({ message: "Owner cannot leave. Transfer ownership first." });

  await ClubMember.deleteOne({ _id: me._id });
  await Club.updateOne(
    { _id: req.club._id },
    { $inc: { "stats.memberCount": -1 } }
  );
  res.json({ ok: true });
};

export const transferOwnership = async (req, res) => {
  const { newOwnerId } = req.body || {};
  const target = await ClubMember.findOne({
    club: req.club._id,
    user: newOwnerId,
    status: "active",
  });
  if (!target)
    return res.status(404).json({ message: "Target must be an active member" });

  await ClubMember.updateOne(
    { club: req.club._id, user: req.club.owner },
    { $set: { role: "admin" } }
  );
  await ClubMember.updateOne(
    { club: req.club._id, user: newOwnerId },
    { $set: { role: "owner" } }
  );
  await Club.updateOne({ _id: req.club._id }, { $set: { owner: newOwnerId } });

  res.json({ ok: true });
};
