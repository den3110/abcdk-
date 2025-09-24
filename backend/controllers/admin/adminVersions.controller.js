// controllers/adminVersions.controller.js
import DeviceInstallation from "../../models/deviceInstallationModel.js";
import AppConfig from "../../models/appConfigModel.js";
import User from "../../models/userModel.js";

/** ------------------------------ Helpers ------------------------------ */

function escapeRegex(s = "") {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lấy AppConfig theo platform với thứ tự ưu tiên: exact -> all -> cái còn lại
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

/** ------------------------------ GET /admin/versions/stats ------------------------------
 *  Query: ?platform=ios|android (optional)
 *  Trả về:
 *  {
 *    ok, platform, config, summary: { totalDevices, uniqueUsersCount, behind, force, blocked },
 *    platformBreakdown: { ios, android },
 *    topBuilds: [{ buildNumber, count }],
 *    topAppVersions: [{ appVersion, count }]
 *  }
 *  ---------------------------------------------------------------------- */
export async function getVersionStats(req, res) {
  const platform = String(req.query.platform || "").toLowerCase();
  const match = {};
  if (platform === "ios" || platform === "android") match.platform = platform;

  const cfg = await getCfg(platform);
  const latestBuild = cfg?.latestBuild ?? 0;
  const minSupportedBuild = cfg?.minSupportedBuild ?? 0;
  const blockedBuilds = Array.isArray(cfg?.blockedBuilds)
    ? cfg.blockedBuilds
    : [];

  const [aggSummary, topBuildsAgg, topAppVersionsAgg, platformSplit] =
    await Promise.all([
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
            blocked: {
              $sum: { $cond: [{ $in: ["$buildNumber", blockedBuilds] }, 1, 0] },
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
            blocked: 1,
          },
        },
      ]),
      DeviceInstallation.aggregate([
        { $match: match },
        { $group: { _id: "$buildNumber", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: -1 } },
        { $limit: 5 },
      ]),
      DeviceInstallation.aggregate([
        { $match: match },
        { $group: { _id: "$appVersion", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
      DeviceInstallation.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$platform",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  const summary = aggSummary[0] || {
    totalDevices: 0,
    uniqueUsersCount: 0,
    behind: 0,
    force: 0,
    blocked: 0,
  };

  const platformBreakdown = { ios: 0, android: 0 };
  for (const p of platformSplit) {
    if (p._id === "ios") platformBreakdown.ios = p.count;
    if (p._id === "android") platformBreakdown.android = p.count;
  }

  res.json({
    ok: true,
    platform: platform || "all",
    config: {
      latestBuild,
      minSupportedBuild,
      blockedBuilds,
      rollout: cfg?.rollout || { percentage: 100, cohortKey: "deviceId" },
    },
    summary,
    platformBreakdown,
    topBuilds: topBuildsAgg.map((x) => ({
      buildNumber: x._id,
      count: x.count,
    })),
    topAppVersions: topAppVersionsAgg.map((x) => ({
      appVersion: x._id || "0.0.0",
      count: x.count,
    })),
  });
}

/** ------------------------------ GET /admin/versions/by-user ------------------------------
 * Query:
 *  - platform= "" | ios | android
 *  - type= all | soft | force
 *  - q= text search (user name/email, device model/brand/id/appVersion, deviceId, buildNumber)
 *  - limit= number (<=200)
 *  - includeDevices= "true" | "false" (default "true")
 *
 * Mỗi row:
 *  {
 *    userId, userName, userEmail, role,
 *    deviceCount, iosCount, androidCount, platforms: ["ios","android"],
 *    firstSeenAt, lastSeenAt,
 *    newestBuild, newestAppVersion, newestPlatform, newestDeviceId,
 *    newestModelName, newestModelId, newestBrand, newestHasPush,
 *    oldestBuild,
 *    hasPush, blockedDevices,
 *    status: "ok"|"soft"|"force"|"blocked",
 *    behindBy,
 *    devices: [...] // optional theo includeDevices
 *  }
 * ---------------------------------------------------------------------- */
export async function getUsersVersion(req, res) {
  const platform = String(req.query.platform || "").toLowerCase(); // ""|"ios"|"android"
  const type = String(req.query.type || "all"); // all | soft | force
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const q = String(req.query.q || "").trim();
  const includeDevices =
    String(req.query.includeDevices ?? "true").toLowerCase() !== "false";

  const cfg = await getCfg(platform);
  if (!cfg) return res.status(404).json({ message: "AppConfig not found" });

  const latestBuild = cfg.latestBuild ?? 0;
  const minSupportedBuild = cfg.minSupportedBuild ?? 0;
  const blockedBuilds = Array.isArray(cfg.blockedBuilds)
    ? cfg.blockedBuilds
    : [];
  const rollout = cfg.rollout || { percentage: 100, cohortKey: "deviceId" };

  /** Match cơ bản */
  const match = { user: { $ne: null } };
  if (platform === "ios" || platform === "android") match.platform = platform;

  if (type === "soft") {
    match.buildNumber = { $lt: latestBuild, $gte: minSupportedBuild };
  } else if (type === "force") {
    match.buildNumber = { $lt: minSupportedBuild };
  }

  /** Pipeline */
  const pipeline = [
    { $match: match },

    // Sort trước để lúc lấy "newestDevice" (lọc bằng newestBuild) thì $first là cái mới nhất theo lastSeenAt
    { $sort: { buildNumber: -1, lastSeenAt: -1 } },

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
            firstSeenAt: "$firstSeenAt",
            pushToken: "$pushToken",
            deviceName: "$deviceName",
            deviceBrand: "$deviceBrand",
            deviceModel: "$deviceModel",
            deviceModelName: "$deviceModelName",
            deviceModelId: "$deviceModelId",
          },
        },
        newestBuild: { $max: "$buildNumber" },
        oldestBuild: { $min: "$buildNumber" },
        lastSeenAt: { $max: "$lastSeenAt" },
        firstSeenAt: { $min: "$firstSeenAt" },
        deviceCount: { $sum: 1 },
        iosCount: { $sum: { $cond: [{ $eq: ["$platform", "ios"] }, 1, 0] } },
        androidCount: {
          $sum: { $cond: [{ $eq: ["$platform", "android"] }, 1, 0] },
        },
        platforms: { $addToSet: "$platform" },
        hasPushCount: {
          $sum: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ["$pushToken", ""] } }, 0] },
              1,
              0,
            ],
          },
        },
        blockedDevices: {
          $sum: { $cond: [{ $in: ["$buildNumber", blockedBuilds] }, 1, 0] },
        },
      },
    },

    // Lấy "newestDevice" = device có build == newestBuild, ưu tiên cái lastSeenAt mới nhất
    {
      $set: {
        newestDevice: {
          $first: {
            $filter: {
              input: "$devices",
              as: "d",
              cond: { $eq: ["$$d.buildNumber", "$newestBuild"] },
            },
          },
        },
      },
    },

    // JOIN user
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

  // Tìm kiếm q mở rộng
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const num = Number(q);
    const isNum = Number.isFinite(num);

    pipeline.push({
      $match: {
        $or: [
          { "user.name": rx },
          { "user.email": rx },
          { "devices.deviceModelName": rx },
          { "devices.deviceModelId": rx },
          { "devices.deviceBrand": rx },
          { "devices.deviceName": rx },
          { "devices.deviceId": rx },
          { "devices.appVersion": rx },
          ...(isNum ? [{ "devices.buildNumber": num }] : []),
        ],
      },
    });
  }

  // Tính các field tiện dụng & status
  pipeline.push({
    $set: {
      newestAppVersion: { $ifNull: ["$newestDevice.appVersion", null] },
      newestPlatform: { $ifNull: ["$newestDevice.platform", null] },
      newestDeviceId: { $ifNull: ["$newestDevice.deviceId", null] },
      newestModelName: { $ifNull: ["$newestDevice.deviceModelName", null] },
      newestModelId: { $ifNull: ["$newestDevice.deviceModelId", null] },
      newestBrand: { $ifNull: ["$newestDevice.deviceBrand", null] },
      newestHasPush: {
        $gt: [{ $strLenCP: { $ifNull: ["$newestDevice.pushToken", ""] } }, 0],
      },
      hasPush: { $gt: ["$hasPushCount", 0] },
      status: {
        $switch: {
          branches: [
            { case: { $in: ["$newestBuild", blockedBuilds] }, then: "blocked" },
            {
              case: { $lt: ["$newestBuild", minSupportedBuild] },
              then: "force",
            },
            { case: { $lt: ["$newestBuild", latestBuild] }, then: "soft" },
          ],
          default: "ok",
        },
      },
      behindBy: {
        $max: [{ $subtract: [latestBuild, "$newestBuild"] }, 0],
      },
      // sortKey để sort theo mức độ: blocked(0) -> force(1) -> soft(2) -> ok(3)
      sortKey: {
        $switch: {
          branches: [
            { case: { $eq: ["$status", "blocked"] }, then: 0 },
            { case: { $eq: ["$status", "force"] }, then: 1 },
            { case: { $eq: ["$status", "soft"] }, then: 2 },
          ],
          default: 3,
        },
      },
    },
  });

  // Sắp xếp & hạn chế số dòng
  pipeline.push({ $sort: { sortKey: 1, lastSeenAt: -1 } });
  pipeline.push({ $limit: limit });

  // Project cuối
  pipeline.push({
    $project: {
      _id: 0,
      userId: "$_id",
      userName: "$user.name",
      userEmail: "$user.email",
      role: "$user.role",

      deviceCount: 1,
      iosCount: 1,
      androidCount: 1,
      platforms: 1,

      firstSeenAt: 1,
      lastSeenAt: 1,

      newestBuild: 1,
      newestAppVersion: 1,
      newestPlatform: 1,
      newestDeviceId: 1,
      newestModelName: 1,
      newestModelId: 1,
      newestBrand: 1,
      newestHasPush: 1,

      oldestBuild: 1,
      hasPush: 1,
      blockedDevices: 1,

      status: 1,
      behindBy: 1,

      devices: 1, // có thể bỏ sau tuỳ includeDevices
    },
  });

  const rows = await DeviceInstallation.aggregate(pipeline);

  // Nếu includeDevices=false thì loại mảng devices để giảm payload
  const finalRows = includeDevices ? rows : rows.map(({ devices, ...r }) => r);

  res.json({
    ok: true,
    config: {
      latestBuild,
      minSupportedBuild,
      blockedBuilds,
      rollout,
    },
    count: finalRows.length,
    rows: finalRows,
  });
}
