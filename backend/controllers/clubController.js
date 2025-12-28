// controllers/clubController.js
import mongoose from "mongoose";
import Club, {
  CLUB_JOIN_POLICY,
  CLUB_VISIBILITY,
} from "../models/clubModel.js";
import ClubMember from "../models/clubMemberModel.js";
import ClubJoinRequest from "../models/clubJoinRequestModel.js";
import User from "../models/userModel.js";
import { geocodeTournamentLocation } from "../services/openaiGeocode.js";

// ✅ import thẳng

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

const MAX_CLUBS_PER_USER = 3;
const countActiveClubs = (userId) =>
  ClubMember.countDocuments({ user: userId, status: "active" });

/** Helper: validate combo visibility + joinPolicy (VIETNAMESE) */
const validateVisibilityJoin = (visibility, joinPolicy) => {
  if (!CLUB_VISIBILITY.includes(visibility)) {
    return "Giá trị visibility không hợp lệ.";
  }
  if (!CLUB_JOIN_POLICY.includes(joinPolicy)) {
    return "Giá trị joinPolicy không hợp lệ.";
  }
  if (visibility === "hidden" && joinPolicy !== "invite_only") {
    return "CLB ẩn chỉ được phép chế độ mời (invite_only).";
  }
  if (visibility === "private" && joinPolicy === "open") {
    return "CLB riêng tư không thể để chế độ mở (open).";
  }
  return null;
};

// controllers/clubController.js (đặt trên cùng file)
const validateMemberVisibility = (clubVisibility, memberVisibility) => {
  // hidden: không lộ danh sách ra ngoài → chỉ "admins"
  if (clubVisibility === "hidden" && memberVisibility !== "admins") {
    return 'CLB "ẩn" chỉ cho phép memberVisibility = "admins".';
  }
  // private: không public danh sách → cho phép "admins" | "members"
  if (clubVisibility === "private" && memberVisibility === "public") {
    return 'CLB "riêng tư" không thể đặt memberVisibility = "public".';
  }
  return null;
};

/** CREATE (limit 3 clubs per user + visibility/join constraints) */
export const createClub = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Bạn cần đăng nhập để tạo CLB." });
    }

    const {
      name,
      description,
      visibility = "public",
      joinPolicy = "approval",
      sportTypes,
      country = "VN", // ⬅️ NEW
      province,
      city,
      address = "", // ⬅️ NEW
      locationText = "", // ⬅️ NEW
      logoUrl,
      coverUrl,
      shortCode,
      website,
      facebook,
      zalo,
      tags,
      memberVisibility = "admins", // ⬅️ mới
      showRolesToMembers = false, // ⬅️ mới
    } = req.body || {};

    if (!name?.trim()) {
      return res.status(400).json({ message: "Vui lòng nhập tên CLB." });
    }

    // limit membership
    const activeCount = await countActiveClubs(req.user._id);
    if (activeCount >= MAX_CLUBS_PER_USER) {
      return res.status(409).json({
        message: `Bạn chỉ được tham gia tối đa ${MAX_CLUBS_PER_USER} CLB.`,
      });
    }

    // validate visibility/joinPolicy cũ (nếu bạn đã có)
    const errJoin = validateVisibilityJoin?.(visibility, joinPolicy);
    if (errJoin) return res.status(400).json({ message: errJoin });

    // validate memberVisibility mới
    const errMV = validateMemberVisibility(visibility, memberVisibility);
    if (errMV) return res.status(400).json({ message: errMV });

    // --- NEW: build locationText + geocode best-effort ---
    const buildLocationText = () => {
      const lt = String(locationText || "").trim();
      if (lt) return lt;

      const addr = String(address || "").trim();
      if (addr) return addr;

      const c = String(city || "").trim();
      const p = String(province || "").trim();
      const co = String(country || "VN").trim();

      const combined = [c, p, co].filter(Boolean).join(", ").trim();
      return combined || "";
    };

    const finalLocationText = buildLocationText();
    const geoPatch = {};

    if (finalLocationText) {
      try {
        const geo = await geocodeTournamentLocation({
          location: finalLocationText,
          countryHint: country || "VN",
        });

        if (Number.isFinite(geo?.lat) && Number.isFinite(geo?.lon)) {
          geoPatch.location = {
            type: "Point",
            coordinates: [geo.lon, geo.lat],
          };
          geoPatch.locationGeo = {
            lat: geo.lat,
            lon: geo.lon,
            countryCode: geo.countryCode || null,
            countryName: geo.countryName || null,
            locality: geo.locality || null,
            admin1: geo.admin1 || null,
            admin2: geo.admin2 || null,
            displayName: geo.formatted || finalLocationText,
            accuracy: geo.accuracy || "low",
            confidence: geo.confidence || 0,
            provider: geo.provider || "openai-geocode",
            raw: geo.raw || finalLocationText,
            updatedAt: new Date(),
          };
        }
      } catch (e) {
        console.warn("[createClub] geocode failed:", e?.message || e);
      }
    }

    const slug = await ensureSlugUnique(name);
    const club = await Club.create({
      name: name.trim(),
      slug,
      description: description?.trim() || "",
      visibility,
      joinPolicy,
      sportTypes:
        Array.isArray(sportTypes) && sportTypes.length
          ? sportTypes
          : ["pickleball"],

      country: country || "VN", // ⬅️ NEW
      province: province || "",
      city: city || "",
      address: address || "", // ⬅️ NEW
      locationText: finalLocationText || "", // ⬅️ NEW

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
      memberVisibility, // ⬅️ mới
      showRolesToMembers, // ⬅️ mới

      ...geoPatch, // ⬅️ NEW
    });

    await ClubMember.create({
      club: club._id,
      user: req.user._id,
      role: "owner",
      status: "active",
    });

    return res.status(201).json(club);
  } catch (err) {
    console.error("createClub error:", err);
    return res.status(500).json({ message: err.message || "Lỗi máy chủ." });
  }
};

/** UPDATE (owner/admin) + enforce visibility/join constraints */
export const updateClub = async (req, res) => {
  try {
    const allowed = [
      "name",
      "description",
      "visibility",
      "joinPolicy",
      "sportTypes",
      "country", // ⬅️ NEW
      "province",
      "city",
      "address", // ⬅️ NEW
      "locationText", // ⬅️ NEW
      "logoUrl",
      "coverUrl",
      "shortCode",
      "website",
      "facebook",
      "zalo",
      "tags",
      "isVerified",
      "memberVisibility",
      "showRolesToMembers", // ⬅️ thêm
    ];

    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    // validate visibility/joinPolicy nếu có thay đổi
    const nextVisibility = patch.visibility ?? req.club.visibility;
    const nextJoin = patch.joinPolicy ?? req.club.joinPolicy;
    const errJoin = validateVisibilityJoin?.(nextVisibility, nextJoin);
    if (errJoin) return res.status(400).json({ message: errJoin });

    // nếu có chỉnh visibility/memberVisibility thì validate combo
    const nextMV = patch.memberVisibility ?? req.club.memberVisibility;
    const errMV = validateMemberVisibility(nextVisibility, nextMV);
    if (errMV) return res.status(400).json({ message: errMV });

    // --- NEW: geocode best-effort nếu thay đổi dữ liệu địa chỉ hoặc CLB chưa có location ---
    const hasGeo =
      Array.isArray(req.club?.location?.coordinates) &&
      req.club.location.coordinates.length === 2;

    const touchedLocationFields =
      "locationText" in patch ||
      "address" in patch ||
      "city" in patch ||
      "province" in patch ||
      "country" in patch;

    const shouldGeocode =
      touchedLocationFields || (!hasGeo && !("location" in patch));

    const buildLocationText = (src) => {
      const lt = String(src.locationText || "").trim();
      if (lt) return lt;

      const addr = String(src.address || "").trim();
      if (addr) return addr;

      const c = String(src.city || "").trim();
      const p = String(src.province || "").trim();
      const co = String(src.country || "VN").trim();

      const combined = [c, p, co].filter(Boolean).join(", ").trim();
      return combined || "";
    };

    if (shouldGeocode) {
      const merged = {
        country: patch.country ?? req.club.country ?? "VN",
        province: patch.province ?? req.club.province ?? "",
        city: patch.city ?? req.club.city ?? "",
        address: patch.address ?? req.club.address ?? "",
        locationText: patch.locationText ?? req.club.locationText ?? "",
      };

      const finalLocationText = buildLocationText(merged);

      // nếu user chủ động clear locationText và không còn gì để geocode -> clear geo
      if ("locationText" in patch && !String(finalLocationText || "").trim()) {
        patch.locationText = "";
        patch.location = null;
        patch.locationGeo = null;
      } else if (finalLocationText) {
        patch.locationText = finalLocationText;

        try {
          const geo = await geocodeTournamentLocation({
            location: finalLocationText,
            countryHint: merged.country || "VN",
          });

          if (Number.isFinite(geo?.lat) && Number.isFinite(geo?.lon)) {
            patch.location = {
              type: "Point",
              coordinates: [geo.lon, geo.lat],
            };
            patch.locationGeo = {
              lat: geo.lat,
              lon: geo.lon,
              countryCode: geo.countryCode || null,
              countryName: geo.countryName || null,
              locality: geo.locality || null,
              admin1: geo.admin1 || null,
              admin2: geo.admin2 || null,
              displayName: geo.formatted || finalLocationText,
              accuracy: geo.accuracy || "low",
              confidence: geo.confidence || 0,
              provider: geo.provider || "openai-geocode",
              raw: geo.raw || finalLocationText,
              updatedAt: new Date(),
            };
          }
        } catch (e) {
          console.warn("[updateClub] geocode failed:", e?.message || e);
        }
      }
    }

    const club = await Club.findByIdAndUpdate(
      req.club._id,
      { $set: patch },
      { new: true }
    );
    res.json(club);
  } catch (err) {
    console.error("updateClub error:", err);
    return res.status(500).json({ message: err.message || "Lỗi máy chủ." });
  }
};

// ======= phần dưới giữ nguyên y như bạn gửi =======

/** LIST (explore) — by default only PUBLIC unless mine=true or explicit visibility */
export const listClubs = async (req, res) => {
  try {
    const {
      q,
      sport,
      province,
      visibility,
      mine,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const wantMine = String(mine).toLowerCase() === "true";

    // resolve "my clubs"
    let memberClubIds = null;
    if (wantMine) {
      if (!req.user?._id) {
        return res.status(401).json({ message: "Bạn cần đăng nhập." });
      }
      memberClubIds = await ClubMember.find({
        user: req.user._id,
        status: "active",
      }).distinct("club");
      if (!memberClubIds || memberClubIds.length === 0) {
        return res.json({
          items: [],
          total: 0,
          page: pageNum,
          limit: limitNum,
        });
      }
    }

    const hasQ = !!String(q || "").trim();
    const useAtlas = process.env.USE_ATLAS_SEARCH === "true" && hasQ;

    // ===== Atlas Search (fuzzy) =====
    if (useAtlas) {
      const fuzzy = { maxEdits: 2, prefixLength: 1, maxExpansions: 50 };
      const indexName = process.env.ATLAS_SEARCH_INDEX || "club_fuzzy";

      const compound = {
        should: [
          {
            autocomplete: {
              query: q,
              path: ["name", "shortCode", "province", "city", "tags"],
              fuzzy,
            },
          },
          { text: { query: q, path: ["description"], fuzzy } },
        ],
        minimumShouldMatch: 1,
      };

      const searchFilters = [];
      // default to public if not mine & no explicit visibility filter
      if (!wantMine && !visibility) {
        searchFilters.push({ equals: { path: "visibility", value: "public" } });
      }
      if (visibility)
        searchFilters.push({
          equals: { path: "visibility", value: visibility },
        });
      if (sport)
        searchFilters.push({ equals: { path: "sportTypes", value: sport } });
      if (province)
        searchFilters.push({ equals: { path: "province", value: province } });
      if (wantMine)
        searchFilters.push({ in: { path: "_id", value: memberClubIds } });

      if (searchFilters.length) compound.filter = searchFilters;

      const pipeline = [
        { $search: { index: indexName, compound } },
        { $addFields: { _score: { $meta: "searchScore" } } },
        { $sort: { _score: -1, createdAt: -1 } },
        {
          $facet: {
            items: [{ $skip: skip }, { $limit: limitNum }],
            total: [{ $count: "value" }],
          },
        },
      ];

      const [agg] = await Club.aggregate(pipeline);
      const items = agg?.items || [];
      const total = agg?.total?.[0]?.value || 0;
      return res.json({ items, total, page: pageNum, limit: limitNum });
    }

    // ===== Fallback: Regex =====
    const filter = {};
    if (!wantMine && !visibility) filter.visibility = "public"; // ⬅️ default
    if (visibility) filter.visibility = visibility;
    if (sport) filter.sportTypes = sport;
    if (province) filter.province = province;
    if (wantMine) filter._id = { $in: memberClubIds };

    if (hasQ) {
      const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escapeReg(q), "i");
      filter.$or = [
        { name: rx },
        { description: rx },
        { shortCode: rx },
        { province: rx },
        { city: rx },
        { tags: rx },
      ];
    }

    const cursor = Club.find(filter).sort({ createdAt: -1 });
    const total = await Club.countDocuments(filter);
    const items = await cursor.skip(skip).limit(limitNum);
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listClubs error:", err);
    return res.status(500).json({ message: err.message || "Lỗi máy chủ." });
  }
};

/** DETAIL — sanitize for private (non-members); 404 cho hidden non-members (đang để 500 theo yêu cầu trước) */
export const getClub = async (req, res) => {
  const { id } = req.params;
  const club = await Club.findById(id).lean();
  if (!club) return res.status(500).json({ message: "Không tìm thấy CLB." });

  let _my = {
    isMember: false,
    membershipRole: null,
    pendingRequest: false,
    isOwner: false,
    isAdmin: false,
    canManage: false,
    _canViewMembers: false, // ⬅️ mới
  };

  if (req.user?._id) {
    const meId = String(req.user._id);
    const isOwner = String(club.owner) === meId;

    const membership = await ClubMember.findOne({
      club: club._id,
      user: req.user._id,
      status: "active",
    })
      .select("role status joinedAt")
      .lean();

    const adminByArray = (club.admins || []).map(String).includes(meId);
    const role =
      membership?.role ||
      (isOwner ? "owner" : null) ||
      (adminByArray ? "admin" : null);
    const isAdmin = isOwner || role === "admin" || adminByArray;

    const pending = await ClubJoinRequest.exists({
      club: club._id,
      user: req.user._id,
      status: "pending",
    });

    // tính quyền xem danh sách theo policy
    const mv = club.memberVisibility || "admins";
    let canView = false;
    if (club.visibility === "hidden") {
      canView = isAdmin; // hidden → chỉ admins
    } else if (club.visibility === "private") {
      canView = isAdmin || !!membership; // private → >= members
    } else {
      // public
      if (mv === "public") canView = true;
      else if (mv === "members") canView = isAdmin || !!membership;
      else canView = isAdmin; // admins
    }

    _my = {
      isMember: Boolean(isOwner || membership),
      membershipRole: role,
      pendingRequest: Boolean(pending),
      isOwner,
      isAdmin,
      canManage: Boolean(isOwner || isAdmin),
      _canViewMembers: canView,
    };
  } else {
    // chưa đăng nhập
    const mv = club.memberVisibility || "admins";
    _my._canViewMembers = club.visibility === "public" && mv === "public";
  }

  return res.json({
    ...club,
    _my,
    _policy: {
      memberVisibility: club.memberVisibility || "admins",
      showRolesToMembers: !!club.showRolesToMembers,
    },
  });
};

/** MEMBERS: list (admin only in route) */
export const listMembers = async (req, res) => {
  const club = req.club;

  // ai được xem danh sách?
  const mv = club.memberVisibility || "admins";
  const isOwner = req.user && String(club.owner) === String(req.user._id);
  const actorRole = req.clubMembership?.role || (isOwner ? "owner" : null);
  const isAdmin = isOwner || actorRole === "admin";
  const isMember = !!req.clubMembership;

  let canView = false;
  if (club.visibility === "hidden") {
    canView = isAdmin; // ẩn → chỉ admin/owner
  } else if (club.visibility === "private") {
    canView = isAdmin || isMember; // riêng tư → >= member
  } else {
    // public
    if (mv === "public") canView = true;
    else if (mv === "members") canView = isAdmin || isMember;
    else canView = isAdmin;
  }

  if (!canView) {
    return res
      .status(403)
      .json({ message: "Bạn không có quyền xem danh sách thành viên." });
  }

  const { page = 1, limit = 50 } = req.query;
  const filter = { club: club._id };

  // role có được hiển thị không?
  const canSeeRoles = isAdmin || (club.showRolesToMembers && isMember);

  const cursor = ClubMember.find(filter)
    .sort({ joinedAt: -1 })
    .populate("user", "fullName nickname avatar email");

  const total = await ClubMember.countDocuments(filter);
  const rows = await cursor
    .skip((+page - 1) * +limit)
    .limit(+limit)
    .lean();

  const items = rows.map((m) => {
    if (canSeeRoles) return m; // giữ nguyên role
    // ẩn role với viewer không đủ quyền
    const { role, ...rest } = m;
    return rest;
  });

  res.json({ items, total, page: +page, limit: +limit, canSeeRoles });
};

// đặt gần đầu file clubController.js
const buildPhoneRegexes = (raw) => {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (!digits || digits.length < 8) return []; // tránh match linh tinh
  const pats = new Set();

  // cho phép ký tự không phải số xen giữa (dấu cách, -, . , +)
  const flex = (s) => new RegExp(`^\\D*${s.split("").join("\\D*")}\\D*$`);

  // bản gốc
  pats.add(flex(digits));

  // 0xxxxxxxxx ↔ 84xxxxxxxxx chuyển qua lại
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    pats.add(flex(`84${rest}`));
  }
  if (digits.startsWith("84")) {
    const rest = digits.slice(2);
    if (rest) pats.add(flex(`0${rest}`));
  }

  return Array.from(pats);
};

/** JOIN flow */
export const requestJoin = async (req, res) => {
  const club = req.club;

  // Hidden: chỉ mời
  if (club.visibility === "hidden") {
    return res.status(403).json({
      message: "CLB này ở chế độ ẩn và chỉ nhận thành viên qua lời mời.",
    });
  }

  const exists = await ClubMember.findOne({
    club: club._id,
    user: req.user._id,
  });
  if (exists)
    return res
      .status(409)
      .json({ message: "Bạn đã là thành viên của CLB này." });

  // limit 3 CLB — chặn cả gửi request để tránh pending vô nghĩa
  const activeCount = await countActiveClubs(req.user._id);
  if (activeCount >= MAX_CLUBS_PER_USER) {
    return res
      .status(409)
      .json({ message: `Bạn đã đạt giới hạn ${MAX_CLUBS_PER_USER} CLB.` });
  }

  if (club.joinPolicy === "invite_only") {
    return res
      .status(403)
      .json({ message: "CLB này chỉ nhận thành viên qua lời mời." });
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
  if (!jr)
    return res
      .status(500)
      .json({ message: "Không có yêu cầu gia nhập đang chờ xử lý." });
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
  if (!jr)
    return res
      .status(500)
      .json({ message: "Không tìm thấy yêu cầu gia nhập." });

  // limit 3 CLB cho user được accept
  const activeCount = await countActiveClubs(jr.user);
  if (activeCount >= MAX_CLUBS_PER_USER) {
    return res.status(409).json({
      message: `Người dùng đã đạt giới hạn ${MAX_CLUBS_PER_USER} CLB.`,
    });
  }

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
  if (!jr)
    return res
      .status(500)
      .json({ message: "Không tìm thấy yêu cầu gia nhập." });
  jr.status = "rejected";
  jr.decidedAt = new Date();
  jr.decidedBy = req.user._id;
  await jr.save();
  res.json(jr);
};

/** Members: add/remove/setRole */
export const addMember = async (req, res) => {
  try {
    const { userId, nickname, role = "member" } = req.body || {};
    let targetUserId = userId;

    if (!targetUserId) {
      const key = String(nickname || "").trim();
      if (!key) {
        return res
          .status(400)
          .json({ message: "Vui lòng nhập nickname hoặc userId" });
      }

      const orConds = [
        { nickname: new RegExp(`^${key}$`, "i") },
        { email: new RegExp(`^${key}$`, "i") },
      ];

      // ✅ thêm tìm theo SĐT ở các field phổ biến
      const phoneRegexes = buildPhoneRegexes(key);
      const phoneFields = ["phone", "phoneNumber", "mobile", "tel"];
      for (const f of phoneFields) {
        for (const rx of phoneRegexes) {
          orConds.push({ [f]: { $regex: rx } });
        }
      }

      const user = await User.findOne({ $or: orConds }).select("_id");
      if (!user) {
        return res.status(500).json({
          message: "Không tìm thấy người dùng theo nickname/email/SĐT",
        });
      }
      targetUserId = user._id;
    }

    if (!mongoose.isValidObjectId(targetUserId)) {
      return res.status(400).json({ message: "userId không hợp lệ" });
    }

    const exist = await ClubMember.findOne({
      club: req.club._id,
      user: targetUserId,
    });
    if (exist)
      return res.status(409).json({ message: "Người dùng đã là thành viên" });

    const activeCount = await countActiveClubs(targetUserId);
    if (activeCount >= MAX_CLUBS_PER_USER) {
      return res.status(409).json({
        message: `Người dùng đã đạt giới hạn ${MAX_CLUBS_PER_USER} CLB.`,
      });
    }

    await ClubMember.create({
      club: req.club._id,
      user: targetUserId,
      role,
      status: "active",
    });
    await Club.updateOne(
      { _id: req.club._id },
      { $inc: { "stats.memberCount": 1 } }
    );

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("addMember error:", err);
    return res.status(500).json({ message: err.message || "Lỗi máy chủ." });
  }
};

/** Only owner can change admin roles; admin can only toggle member */
export const setRole = async (req, res) => {
  const { role } = req.body || {};
  if (!["admin", "member"].includes(role)) {
    return res.status(400).json({ message: "Vai trò không hợp lệ." });
  }

  const target = await ClubMember.findOne({
    club: req.club._id,
    user: req.params.userId,
  });
  if (!target)
    return res.status(500).json({ message: "Không tìm thấy thành viên." });
  if (target.role === "owner")
    return res
      .status(403)
      .json({ message: "Không thể thay đổi vai trò của chủ sở hữu." });

  const isOwner = String(req.club.owner) === String(req.user._id);
  const actorRole = req.clubMembership?.role || (isOwner ? "owner" : null);

  // admin chỉ được set role cho member; chỉ owner mới đổi role của admin hoặc phong admin
  if (!isOwner) {
    if (actorRole !== "admin") {
      return res.status(403).json({ message: "Cần quyền quản trị viên." });
    }
    if (target.role !== "member" || role === "admin") {
      // admin không được phong admin, cũng không được đụng admin khác
      return res.status(403).json({
        message: "Chỉ chủ sở hữu mới có thể chỉnh sửa vai trò quản trị viên.",
      });
    }
  }

  target.role = role;
  await target.save();
  res.json(target);
};

export const kickMember = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "userId không hợp lệ" });
    }

    const target = await ClubMember.findOne({
      club: req.club._id,
      user: userId,
    });
    if (!target)
      return res.status(500).json({ message: "Không tìm thấy thành viên." });
    if (target.role === "owner")
      return res.status(403).json({ message: "Không thể xoá chủ sở hữu." });

    const isOwner = String(req.club.owner) === String(req.user._id);
    const actorRole = req.clubMembership?.role || (isOwner ? "owner" : null);

    if (!isOwner) {
      if (actorRole !== "admin") {
        return res.status(403).json({ message: "Cần quyền quản trị viên." });
      }
      if (target.role !== "member") {
        return res
          .status(403)
          .json({ message: "Chỉ chủ sở hữu mới có thể xoá quản trị viên." });
      }
      if (String(target.user) === String(req.user._id)) {
        return res.status(409).json({
          message: "Hãy dùng DELETE /clubs/:id/members/me để rời CLB.",
        });
      }
    }

    const del = await ClubMember.deleteOne({ _id: target._id });
    if (del.deletedCount > 0) {
      await Club.updateOne(
        { _id: req.club._id },
        { $inc: { "stats.memberCount": -1 } }
      );
    }
    return res.json({
      ok: true,
      removedUserId: userId,
      removedRole: target.role,
    });
  } catch (err) {
    console.error("kickMember error:", err);
    return res.status(500).json({ message: err.message || "Lỗi máy chủ." });
  }
};

export const leaveClub = async (req, res) => {
  const me = await ClubMember.findOne({
    club: req.club._id,
    user: req.user._id,
  });
  if (!me) return res.status(500).json({ message: "Bạn chưa là thành viên." });
  if (me.role === "owner") {
    return res.status(403).json({
      message:
        "Chủ sở hữu không thể rời đi; vui lòng chuyển quyền sở hữu trước.",
    });
  }
  await ClubMember.deleteOne({ _id: me._id });
  await Club.updateOne(
    { _id: req.club._id },
    { $inc: { "stats.memberCount": -1 } }
  );
  res.json({ ok: true });
};

export const transferOwnership = async (req, res) => {
  const { newOwnerId } = req.body || {};
  if (!mongoose.isValidObjectId(newOwnerId)) {
    return res.status(400).json({ message: "newOwnerId không hợp lệ." });
  }
  if (String(newOwnerId) === String(req.club.owner)) {
    return res.status(400).json({ message: "Người này đã là chủ sở hữu." });
  }

  const target = await ClubMember.findOne({
    club: req.club._id,
    user: newOwnerId,
    status: "active",
  });
  if (!target)
    return res.status(500).json({
      message: "Người được chuyển quyền phải là thành viên đang hoạt động.",
    });

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
