import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import UserRadar from "../models/userRadarModel.js";
import RadarPresence from "../models/radarPresenceModel.js";
import RadarIntent from "../models/radarIntentModel.js";

// ✅ NEW: thêm các model đa dạng entity
import Tournament from "../models/tournamentModel.js";
import Club from "../models/clubModel.js";

// Helper clamp
const clamp = (v, min, max) => Math.max(min, Math.min(max, v || 0));

// Helper: tính rating base từ localRatings
const getBaseRating = (localRatings) => {
  if (!localRatings) return null;
  const vals = [
    typeof localRatings.singles === "number" ? localRatings.singles : null,
    typeof localRatings.doubles === "number" ? localRatings.doubles : null,
  ].filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// ✅ NEW: helpers cho explore đa dạng
const toNum = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseTypes = (raw) => {
  const s = String(raw || "user,tournament,club");
  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return new Set(arr.length ? arr : ["user", "tournament", "club"]);
};

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const bboxFromRadius = (lat, lon, radiusKm) => {
  const latDelta = radiusKm / 111.0;
  const lonDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
};

const kindToEmoji = (kind) => {
  switch (kind) {
    case "practice":
      return "🔥";
    case "tournament":
      return "🏆";
    case "friendly":
      return "🤝";
    case "coffee_chat":
      return "☕️";
    default:
      return "📍";
  }
};

/**
 * GET /api/radar/settings
 * Lấy radarSettings + radarProfile hiện tại
 */
export const getRadarSettings = asyncHandler(async (req, res) => {
  let radar = await UserRadar.findOne({ user: req.user._id }).select(
    "radarSettings radarProfile"
  );

  if (!radar) {
    // tạo doc mặc định nếu chưa có
    radar = await UserRadar.create({ user: req.user._id });
  }

  res.json({
    radarSettings: radar.radarSettings,
    radarProfile: radar.radarProfile,
  });
});

/**
 * PATCH /api/radar/settings
 * body: { enabled, radiusKm, preferredPlayType, preferredGender, radarProfile? }
 */
export const updateRadarSettings = asyncHandler(async (req, res) => {
  const {
    enabled,
    radiusKm,
    preferredPlayType,
    preferredGender,
    radarProfile,
  } = req.body || {};

  const update = {};

  if (typeof enabled === "boolean") {
    update["radarSettings.enabled"] = enabled;
  }
  if (radiusKm != null) {
    update["radarSettings.radiusKm"] = clamp(Number(radiusKm), 1, 50);
  }
  if (preferredPlayType) {
    update["radarSettings.preferredPlayType"] = preferredPlayType;
  }
  if (preferredGender) {
    update["radarSettings.preferredGender"] = preferredGender;
  }

  if (radarProfile && typeof radarProfile === "object") {
    const rp = {};
    if (radarProfile.playYears != null) {
      rp.playYears = Math.max(0, Number(radarProfile.playYears) || 0);
    }
    if (radarProfile.playingFrequency) {
      rp.playingFrequency = radarProfile.playingFrequency;
    }
    if (Array.isArray(radarProfile.typicalDays)) {
      rp.typicalDays = radarProfile.typicalDays;
    }
    if (Array.isArray(radarProfile.typicalTimeSlots)) {
      rp.typicalTimeSlots = radarProfile.typicalTimeSlots;
    }
    if (Array.isArray(radarProfile.preferredVenues)) {
      rp.preferredVenues = radarProfile.preferredVenues;
    }
    if (radarProfile.playStyle) {
      rp.playStyle = radarProfile.playStyle;
    }
    if (radarProfile.handedness) {
      rp.handedness = radarProfile.handedness;
    }
    update.radarProfile = rp;
  }

  const radar = await UserRadar.findOneAndUpdate(
    { user: req.user._id },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).select("radarSettings radarProfile");

  // Nếu tắt radar thì xoá luôn presence + intent
  if (enabled === false) {
    await RadarPresence.deleteOne({ user: req.user._id });
    await RadarIntent.deleteOne({ user: req.user._id });
  }

  res.json({
    radarSettings: radar.radarSettings,
    radarProfile: radar.radarProfile,
  });
});

/**
 * POST /api/radar/presence
 * body: { lat, lng, status?, visibility?, source? }
 * Yêu cầu radarSettings.enabled = true
 */
export const updateRadarPresence = asyncHandler(async (req, res) => {
  const radar = await UserRadar.findOne({ user: req.user._id }).select(
    "radarSettings lastKnownLocation"
  );

  if (!radar) {
    res.status(409);
    throw new Error("Radar settings not initialized for this user");
  }

  if (!radar.radarSettings?.enabled) {
    res.status(409);
    throw new Error("Radar is disabled for this user");
  }

  const { lat, lng, status, visibility, source } = req.body || {};

  const latitude = Number(lat);
  const longitude = Number(lng);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    res.status(400);
    throw new Error("Invalid coordinates");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 phút

  const doc = {
    user: req.user._id,
    location: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
    status: status || "looking_partner",
    visibility: visibility || "venue_only",
    source: source || "gps",
    preferredRadiusKm: radar.radarSettings?.radiusKm || 5,
    expiresAt,
  };

  const presence = await RadarPresence.findOneAndUpdate(
    { user: req.user._id },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Cập nhật lastKnownLocation trong UserRadar (không còn trên User)
  radar.lastKnownLocation = {
    type: "Point",
    coordinates: [longitude, latitude],
    updatedAt: now,
  };
  await radar.save();

  res.json({
    ok: true,
    presence: {
      user: presence.user,
      status: presence.status,
      visibility: presence.visibility,
      location: presence.location,
      preferredRadiusKm: presence.preferredRadiusKm,
      expiresAt: presence.expiresAt,
    },
  });
});

/**
 * Helper tính score gợi ý (0–100)
 * player: doc đã aggregate từ RadarPresence + User + RadarIntent
 * currentUserRatings: currentUser.localRatings
 */
const computeScore = (player, currentUserRatings, currentIntent) => {
  let score = 0;

  // 1) Khoảng cách
  const distKm = (player.distance || 0) / 1000;
  if (distKm <= 2) score += 40;
  else if (distKm <= 5) score += 30;
  else if (distKm <= 10) score += 20;
  else score += 10;

  // 2) Rating chênh lệch ít thì cộng điểm
  const userBaseRating = getBaseRating(currentUserRatings);
  const playerBaseRating = getBaseRating({
    singles: player.ratingSingles,
    doubles: player.ratingDoubles,
  });

  if (userBaseRating != null && playerBaseRating != null) {
    const diff = Math.abs(playerBaseRating - userBaseRating);
    if (diff <= 0.25) score += 30;
    else if (diff <= 0.5) score += 20;
    else if (diff <= 1) score += 10;
  }

  // 3) Intent khớp nhau
  if (player.intentKind && currentIntent?.kind) {
    if (player.intentKind === currentIntent.kind) {
      score += 20;
    }
  }

  return Math.max(0, Math.min(score, 100));
};

/**
 * GET /api/radar/nearby?lat=&lng=&radiusKm=
 * Lấy danh sách người chơi quanh đây
 */
export const getNearbyPlayers = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  let { lat, lng, radiusKm } = req.query || {};
  radiusKm = clamp(Number(radiusKm) || 5, 1, 30);

  let centerLat = Number(lat);
  let centerLng = Number(lng);

  const currentUser = await User.findById(userId).select(
    "name nickname avatar gender province localRatings"
  );
  if (!currentUser) {
    res.status(404);
    throw new Error("User not found");
  }

  const currentRadar = await UserRadar.findOne({ user: userId }).select(
    "lastKnownLocation"
  );

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    Math.abs(centerLat) > 90 ||
    Math.abs(centerLng) > 180
  ) {
    if (
      currentRadar?.lastKnownLocation?.coordinates &&
      Array.isArray(currentRadar.lastKnownLocation.coordinates)
    ) {
      centerLng = currentRadar.lastKnownLocation.coordinates[0];
      centerLat = currentRadar.lastKnownLocation.coordinates[1];
    } else {
      res.status(400);
      throw new Error("Missing or invalid center coordinates");
    }
  }

  const radiusMeters = radiusKm * 1000;

  const pipeline = [
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [centerLng, centerLat],
        },
        distanceField: "distance",
        maxDistance: radiusMeters,
        spherical: true,
        key: "location",
        query: {
          user: { $ne: userId },
        },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $lookup: {
        from: "radarintents",
        localField: "user._id",
        foreignField: "user",
        as: "intent",
      },
    },
    {
      $unwind: {
        path: "$intent",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        userId: "$user._id",
        distance: 1,
        status: 1,
        visibility: 1,
        location: 1,
        preferredRadiusKm: 1,

        // tên hiển thị: nickname > name
        displayName: {
          $ifNull: ["$user.nickname", "$user.name"],
        },
        avatarUrl: "$user.avatar",

        // rating mới
        ratingSingles: "$user.localRatings.singles",
        ratingDoubles: "$user.localRatings.doubles",
        // dùng doubles làm rating chung (app đang đọc item.rating)
        rating: "$user.localRatings.doubles",

        gender: "$user.gender",
        province: "$user.province",

        // để app không phải sửa, map province vào mainClubName tạm
        mainClubName: "$user.province",

        intentKind: "$intent.kind",
        intentNote: "$intent.note",
      },
    },
    {
      $limit: 200,
    },
  ];

  const docs = await RadarPresence.aggregate(pipeline);

  const currentIntent = await RadarIntent.findOne({ user: userId });

  const enriched = docs.map((p) => ({
    ...p,
    score: computeScore(p, currentUser.localRatings, currentIntent),
  }));

  enriched.sort((a, b) => b.score - a.score || a.distance - b.distance);

  let isHiddenInfo = false;
  if(typeof shouldHideUserRatings === "function") isHiddenInfo = await shouldHideUserRatings(req.user, null);
  if (isHiddenInfo) { enriched.forEach(p => { p.ratingSingles = null; p.ratingDoubles = null; p.rating = null; p._ratingsHidden = true; }); }
  res.json({
    center: { lat: centerLat, lng: centerLng },
    radiusKm,
    players: enriched,
  });
});

/**
 * ✅ NEW
 * GET /api/radar/explore?lat=&lng=&radiusKm=&types=user,tournament,club
 * Trả về items đa dạng: user / tournament / club (court bạn thêm sau)
 *
 * items[] format (gợi ý):
 * - type: "user" | "tournament" | "club" | "court"
 * - id
 * - title, subtitle
 * - distanceMeters
 * - location: GeoJSON Point { type:"Point", coordinates:[lng,lat] } hoặc null
 * - payload tùy type (rating, imageUrl, status...)
 */
export const getRadarExplore = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  let { lat, lng, radiusKm, types } = req.query || {};
  const typeSet = parseTypes(types);

  // radius rộng hơn nearby, cho “explore”
  radiusKm = clamp(Number(radiusKm) || 5, 1, 50);

  let centerLat = Number(lat);
  let centerLng = Number(lng);

  // current user + fallback lastKnownLocation
  const currentUser = await User.findById(userId).select(
    "name nickname avatar gender province localRatings"
  );
  if (!currentUser) {
    res.status(404);
    throw new Error("User not found");
  }

  const currentRadar = await UserRadar.findOne({ user: userId }).select(
    "lastKnownLocation"
  );

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    Math.abs(centerLat) > 90 ||
    Math.abs(centerLng) > 180
  ) {
    if (
      currentRadar?.lastKnownLocation?.coordinates &&
      Array.isArray(currentRadar.lastKnownLocation.coordinates)
    ) {
      centerLng = currentRadar.lastKnownLocation.coordinates[0];
      centerLat = currentRadar.lastKnownLocation.coordinates[1];
    } else {
      res.status(400);
      throw new Error("Missing or invalid center coordinates");
    }
  }

  const radiusMeters = radiusKm * 1000;
  const now = new Date();
  const currentIntent = await RadarIntent.findOne({ user: userId });

  const items = [];

  // ✅ helper: location phải là Point + đủ coords hợp lệ
  const isValidPoint = (loc) => {
    if (!loc || loc.type !== "Point") return false;
    const c = loc.coordinates;
    if (!Array.isArray(c) || c.length !== 2) return false;
    const [x, y] = c;
    return Number.isFinite(Number(x)) && Number.isFinite(Number(y));
  };

  // ---------------- USERS ----------------
  if (typeSet.has("user")) {
    const pipeline = [
      {
        $geoNear: {
          near: { type: "Point", coordinates: [centerLng, centerLat] },
          distanceField: "distance",
          maxDistance: radiusMeters,
          spherical: true,
          key: "location",
          query: {
            user: { $ne: userId },
            // presence TTL chưa chắc xoá kịp -> filter luôn
            expiresAt: { $gt: now },
          },
        },
      },
      { $limit: 120 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $lookup: {
          from: "radarintents",
          localField: "user._id",
          foreignField: "user",
          as: "intent",
        },
      },
      {
        $unwind: {
          path: "$intent",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          distance: 1,
          location: 1,

          displayName: { $ifNull: ["$user.nickname", "$user.name"] },
          avatarUrl: "$user.avatar",
          province: "$user.province",

          ratingSingles: "$user.localRatings.singles",
          ratingDoubles: "$user.localRatings.doubles",
          rating: "$user.localRatings.doubles",

          intentKind: "$intent.kind",
          intentNote: "$intent.note",
        },
      },
    ];

    const docs = await RadarPresence.aggregate(pipeline);

    const enriched = docs
      .map((p) => {
        // ✅ nếu location null/invalid -> bỏ luôn
        if (!isValidPoint(p.location)) return null;

        const score = computeScore(p, currentUser.localRatings, currentIntent);
        const statusEmoji = kindToEmoji(p.intentKind);
        const statusMessage = p.intentNote || "";

        return {
          type: "user",
          id: String(p.userId),
          title: p.displayName || "Người chơi",
          subtitle: p.province || "",
          distanceMeters: Math.round(p.distance || 0),
          location: p.location,
          avatarUrl: p.avatarUrl || "",
          rating: Number.isFinite(p.rating) ? p.rating : null,
          intentKind: p.intentKind || "practice",
          statusEmoji,
          statusMessage,
          score,

          // backward-compat fields (nếu app còn dùng format cũ)
          mainClubName: p.province || "",
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters);

    items.push(...enriched);
  }

  // ---------------- TOURNAMENTS ----------------
  if (typeSet.has("tournament")) {
    // Tournament đang dùng locationGeo.lat/lon => query bbox + haversine lọc
    const bbox = bboxFromRadius(centerLat, centerLng, radiusKm);

    const tdocs = await Tournament.find({
      "locationGeo.lat": { $ne: null, $gte: bbox.minLat, $lte: bbox.maxLat },
      "locationGeo.lon": { $ne: null, $gte: bbox.minLon, $lte: bbox.maxLon },
    })
      .select(
        "name image status eventType location locationGeo startDate endDate"
      )
      .lean();

    const tournaments = [];
    for (const t of tdocs) {
      const tLat = toNum(t?.locationGeo?.lat);
      const tLng = toNum(t?.locationGeo?.lon);
      if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) continue;

      const d = haversineMeters(centerLat, centerLng, tLat, tLng);
      if (d > radiusMeters) continue;

      const loc = { type: "Point", coordinates: [tLng, tLat] };
      if (!isValidPoint(loc)) continue; // ✅ phòng hờ

      tournaments.push({
        type: "tournament",
        id: String(t._id),
        title: t.name || "Giải đấu",
        subtitle: t.locationGeo?.displayName || t.location || "",
        distanceMeters: Math.round(d),
        location: loc,
        imageUrl: t.image || "",
        status: t.status || "upcoming",
        eventType: t.eventType || "",
        startDate: t.startDate || null,
        endDate: t.endDate || null,
      });
    }

    tournaments.sort((a, b) => a.distanceMeters - b.distanceMeters);
    items.push(...tournaments.slice(0, 60));
  }

  // ---------------- CLUBS ----------------
  if (typeSet.has("club")) {
    // ✅ chỉ trả club có location hợp lệ (không còn location=null)
    const clubQuery = {};
    if (currentUser?.province) {
      clubQuery.province = currentUser.province;
    }

    const clubs = await Club.find(clubQuery)
      .sort({ isVerified: -1, createdAt: -1 })
      .limit(60)
      .select("name logoUrl city province country location locationGeo")
      .lean();

    const clubItems = [];
    for (const c of clubs) {
      // ưu tiên location (Point), fallback qua locationGeo
      let cLng = c?.location?.coordinates?.[0];
      let cLat = c?.location?.coordinates?.[1];

      if (!Number.isFinite(Number(cLat)) || !Number.isFinite(Number(cLng))) {
        cLat = toNum(c?.locationGeo?.lat);
        cLng = toNum(c?.locationGeo?.lon);
      }
      if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;

      const loc = { type: "Point", coordinates: [cLng, cLat] };
      if (!isValidPoint(loc)) continue;

      const d = haversineMeters(centerLat, centerLng, cLat, cLng);
      if (d > radiusMeters) continue;

      clubItems.push({
        type: "club",
        id: String(c._id),
        title: c.name || "CLB",
        subtitle: [c.city, c.province, c.country].filter(Boolean).join(", "),
        distanceMeters: Math.round(d),
        location: loc,
        imageUrl: c.logoUrl || "",
        isVerified: !!c.isVerified,
      });
    }

    clubItems.sort((a, b) => a.distanceMeters - b.distanceMeters);
    items.push(...clubItems.slice(0, 12));
  }

  // ✅ chốt hạ: item nào location null/invalid thì loại
  const safeItems = items.filter((it) => isValidPoint(it?.location));

  let isHiddenInfoItems = false;
  if(typeof shouldHideUserRatings === "function") isHiddenInfoItems = await shouldHideUserRatings(req.user, null);
  if (isHiddenInfoItems) { safeItems.forEach(p => { if(p.type === "user") { p.rating = null; p._ratingsHidden = true; } }); }
  res.json({
    center: { lat: centerLat, lng: centerLng },
    radiusKm,
    items: safeItems,
  });
});

/**
 * PUT /api/radar/intent
 * body: { kind, note?, minRating?, maxRating?, maxDistanceKm? }
 */
export const upsertRadarIntent = asyncHandler(async (req, res) => {
  const { kind, note, minRating, maxRating, maxDistanceKm } = req.body || {};
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4h

  const doc = {
    user: req.user._id,
    kind: kind || "practice",
    note: note ? String(note).slice(0, 200) : undefined,
    minRating: minRating != null ? Number(minRating) : undefined,
    maxRating: maxRating != null ? Number(maxRating) : undefined,
    maxDistanceKm:
      maxDistanceKm != null ? clamp(Number(maxDistanceKm), 1, 50) : 10,
    expiresAt,
  };

  const intent = await RadarIntent.findOneAndUpdate(
    { user: req.user._id },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ intent });
});

/**
 * DELETE /api/radar/intent
 */
export const deleteRadarIntent = asyncHandler(async (req, res) => {
  await RadarIntent.deleteOne({ user: req.user._id });
  res.json({ ok: true });
});

/**
 * POST /api/radar/ping
 * body: { targetUserId }
 * -> hook vào NotificationHub / push tuỳ bạn
 */
export const pingUser = asyncHandler(async (req, res) => {
  const { targetUserId } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    res.status(400);
    throw new Error("Invalid targetUserId");
  }
  if (String(targetUserId) === String(req.user._id)) {
    res.status(400);
    throw new Error("Cannot ping yourself");
  }

  res.json({ ok: true });
});
