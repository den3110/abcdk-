// controllers/adminVersions.controller.js
import DeviceInstallation from "../../models/deviceInstallationModel.js";
import AppConfig from "../../models/appConfigModel.js";
import User from "../../models/userModel.js";

// Helper: lấy AppConfig theo platform (ưu tiên platform, fallback "all")
async function getCfg(platform) {
  const [all, ios, android] = await Promise.all([
    AppConfig.findOne({ platform: "all" }).lean(),
    AppConfig.findOne({ platform: "ios" }).lean(),
    AppConfig.findOne({ platform: "android" }).lean(),
  ]);
  if (platform === "ios" && ios) return ios;
  if (platform === "android" && android) return android;
  return all || ios || android || null;
}

// GET /admin/versions/stats?platform=ios|android
export async function getVersionStats(req, res) {
  const platform = String(req.query.platform || "").toLowerCase();
  const match = {};
  if (platform === "ios" || platform === "android") match.platform = platform;

  const cfg = await getCfg(platform);
  const latestBuild = cfg?.latestBuild ?? 0;
  const minSupportedBuild = cfg?.minSupportedBuild ?? 0;

  const [agg, topBuilds] = await Promise.all([
    DeviceInstallation.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalDevices: { $sum: 1 },
          uniqueUsers: { $addToSet: "$user" },
          behind: {
            $sum: { $cond: [{ $lt: ["$buildNumber", latestBuild] }, 1, 0] },
          },
          force: {
            $sum: {
              $cond: [{ $lt: ["$buildNumber", minSupportedBuild] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalDevices: 1,
          uniqueUsersCount: { $size: "$uniqueUsers" },
          behind: 1,
          force: 1,
        },
      },
    ]),
    DeviceInstallation.aggregate([
      { $match: match },
      { $group: { _id: "$buildNumber", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const summary = agg[0] || {
    totalDevices: 0,
    uniqueUsersCount: 0,
    behind: 0,
    force: 0,
  };

  res.json({
    ok: true,
    platform: platform || "all",
    config: { latestBuild, minSupportedBuild },
    summary,
    topBuilds: topBuilds.map((x) => ({ buildNumber: x._id, count: x.count })),
  });
}

// GET /admin/versions/by-user?platform=ios|android&type=all|soft|force&q=&limit=50
export async function getUsersVersion(req, res) {
  const platform = String(req.query.platform || "").toLowerCase(); // ""|"ios"|"android"
  const type = String(req.query.type || "all"); // all | soft | force
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const q = String(req.query.q || "").trim();

  const cfg = await getCfg(platform);
  if (!cfg) return res.status(404).json({ message: "AppConfig not found" });
  const latestBuild = cfg.latestBuild ?? 0;
  const minSupportedBuild = cfg.minSupportedBuild ?? 0;

  const match = { user: { $ne: null } };
  if (platform === "ios" || platform === "android") match.platform = platform;

  if (type === "soft") {
    match.buildNumber = { $lt: latestBuild, $gte: minSupportedBuild };
  } else if (type === "force") {
    match.buildNumber = { $lt: minSupportedBuild };
  }

  const pipeline = [
    { $match: match },
    { $sort: { lastSeenAt: -1 } },
    {
      $group: {
        _id: "$user",
        devices: {
          $push: {
            deviceId: "$deviceId",
            platform: "$platform",
            appVersion: "$appVersion",
            buildNumber: "$buildNumber",
            lastSeenAt: "$lastSeenAt",
            pushToken: "$pushToken",
          },
        },
        newestBuild: { $max: "$buildNumber" },
        oldestBuild: { $min: "$buildNumber" },
        lastSeenAt: { $max: "$lastSeenAt" },
        deviceCount: { $sum: 1 },
      },
    },
    { $sort: { lastSeenAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "user",
        pipeline: [{ $project: { name: 1, email: 1, role: 1 } }],
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
  ];

  // Lọc theo q (name/email) nếu có
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: {
        $or: [{ "user.name": regex }, { "user.email": regex }],
      },
    });
  }

  pipeline.push({
    $project: {
      _id: 0,
      userId: "$_id",
      userName: "$user.name",
      userEmail: "$user.email",
      role: "$user.role",
      deviceCount: 1,
      newestBuild: 1,
      oldestBuild: 1,
      lastSeenAt: 1,
      devices: 1,
    },
  });

  const rows = await DeviceInstallation.aggregate(pipeline);

  res.json({
    ok: true,
    config: { latestBuild, minSupportedBuild },
    count: rows.length,
    rows,
  });
}
