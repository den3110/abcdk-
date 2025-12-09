import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import RadarPresence from "../models/radarPresenceModel.js";
import RadarIntent from "../models/radarIntentModel.js";

// Helper function (giữ nguyên, không cần export trừ khi muốn test riêng)
const clamp = (v, min, max) => Math.max(min, Math.min(max, v || 0));

/**
 * GET /api/radar/settings
 * Lấy radarSettings + radarProfile hiện tại
 */
export const getRadarSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "radarSettings radarProfile"
  );
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  res.json({
    radarSettings: user.radarSettings,
    radarProfile: user.radarProfile,
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
    if (radarProfile.playStyle) {
      rp.playStyle = radarProfile.playStyle;
    }
    if (radarProfile.handedness) {
      rp.handedness = radarProfile.handedness;
    }
    update.radarProfile = rp;
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, {
    new: true,
  }).select("radarSettings radarProfile");

  // Nếu tắt radar thì xoá luôn presence + intent
  if (enabled === false) {
    await RadarPresence.deleteOne({ user: req.user._id });
    await RadarIntent.deleteOne({ user: req.user._id });
  }

  res.json({
    radarSettings: user.radarSettings,
    radarProfile: user.radarProfile,
  });
});

/**
 * POST /api/radar/presence
 * body: { lat, lng, status?, visibility?, source? }
 * Yêu cầu radarSettings.enabled = true
 */
export const updateRadarPresence = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "radarSettings lastKnownLocation rating mainClubName"
  );

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (!user.radarSettings?.enabled) {
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
    preferredRadiusKm: user.radarSettings?.radiusKm || 5,
    expiresAt,
  };

  const presence = await RadarPresence.findOneAndUpdate(
    { user: req.user._id },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  user.lastKnownLocation = {
    type: "Point",
    coordinates: [longitude, latitude],
    updatedAt: now,
  };
  await user.save();

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
 */
const computeScore = (player, currentUser, currentIntent) => {
  let score = 0;

  const distKm = (player.distance || 0) / 1000;
  if (distKm <= 2) score += 40;
  else if (distKm <= 5) score += 30;
  else if (distKm <= 10) score += 20;
  else score += 10;

  if (player.rating && currentUser.rating) {
    const diff = Math.abs(player.rating - currentUser.rating);
    if (diff <= 50) score += 30;
    else if (diff <= 100) score += 20;
    else if (diff <= 200) score += 10;
  }

  if (player.mainClubName && currentUser.mainClubName) {
    if (player.mainClubName === currentUser.mainClubName) {
      score += 10;
    }
  }

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
    "radarSettings lastKnownLocation rating mainClubName"
  );
  if (!currentUser) {
    res.status(404);
    throw new Error("User not found");
  }

  if (
    !Number.isFinite(centerLat) ||
    !Number.isFinite(centerLng) ||
    Math.abs(centerLat) > 90 ||
    Math.abs(centerLng) > 180
  ) {
    if (
      currentUser.lastKnownLocation?.coordinates &&
      Array.isArray(currentUser.lastKnownLocation.coordinates)
    ) {
      centerLng = currentUser.lastKnownLocation.coordinates[0];
      centerLat = currentUser.lastKnownLocation.coordinates[1];
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

        displayName: {
          $ifNull: ["$user.displayName", "$user.fullName"],
        },
        avatarUrl: "$user.avatar",
        rating: "$user.rating",
        ratingSingles: "$user.ratingSingles",
        ratingDoubles: "$user.ratingDoubles",
        mainClubName: "$user.mainClubName",
        gender: "$user.gender",
        birthYear: "$user.birthYear",

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
    score: computeScore(p, currentUser, currentIntent),
  }));

  enriched.sort((a, b) => b.score - a.score || a.distance - b.distance);

  res.json({
    center: { lat: centerLat, lng: centerLng },
    radiusKm,
    players: enriched,
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
 * -> tuỳ bạn hook vào NotificationHub / push
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

  // ở đây bạn thay bằng logic notification hiện tại (Mongo + RabbitMQ + Expo push…)
  // ví dụ:
  // await Notification.create({
  //   user: targetUserId,
  //   type: "radar_ping",
  //   payload: { fromUserId: req.user._id },
  // });

  res.json({ ok: true });
});
