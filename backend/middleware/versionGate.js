// middlewares/versionGate.js
import AppConfig from "../models/appConfigModel.js";
import DeviceInstallation from "../models/deviceInstallationModel.js";
import crypto from "crypto";

const MEMO_TTL = 30_000;
let _memo = { ts: 0, cfg: null };

function hashToPercent(s) {
  const h = crypto.createHash("sha1").update(String(s)).digest();
  // map 0..255 của byte đầu thành 0..100 (xấp xỉ)
  return Math.floor((h[0] / 255) * 100);
}

async function loadConfig() {
  const now = Date.now();
  if (_memo.cfg && now - _memo.ts < MEMO_TTL) return _memo.cfg;

  const [all, ios, android] = await Promise.all([
    AppConfig.findOne({ platform: "all" }).lean(),
    AppConfig.findOne({ platform: "ios" }).lean(),
    AppConfig.findOne({ platform: "android" }).lean(),
  ]);
  _memo = { ts: now, cfg: { all, ios, android } };
  return _memo.cfg;
}

function pickCfg(cfg, platform) {
  if (platform === "ios" && cfg.ios) return cfg.ios;
  if (platform === "android" && cfg.android) return cfg.android;
  return cfg.all || cfg.ios || cfg.android || null;
}

export async function versionGate(req, res, next) {
  // 👉 Chỉ áp dụng cho app mobile: yêu cầu đủ “dấu hiệu” từ app
  const platform = String(req.header("X-Platform") || "").toLowerCase(); // ios|android
  const appVersion = String(req.header("X-App-Version") || "0.0.0");
  const buildStr = String(req.header("X-Build") || "0");
  const buildNumber = parseInt(buildStr, 10) || 0;
  const deviceId = String(req.header("X-Device-Id") || "");
  const pushToken = req.header("X-Push-Token") || "";
  const userId = req.user?._id || null;

  // ❗ Guard: chỉ chạy gate nếu đúng request từ app
  const isMobilePlatform = platform === "ios" || platform === "android";
  const hasValidBuild = Number.isFinite(buildNumber) && buildNumber > 0;
  const hasDeviceId = !!deviceId;

  // (Tuỳ chọn) chặn theo path: bỏ qua các route admin/web nếu muốn
  const skipPathPrefixes = ["/admin", "/cms"]; // chỉnh theo API của bạn
  const isAdminPath = skipPathPrefixes.some((p) => req.path.startsWith(p));

  if (!isMobilePlatform || !hasValidBuild || !hasDeviceId || isAdminPath) {
    // → Không phải app mobile → bỏ qua gate
    return next();
  }

  // chặn cache ở proxy/browser (chỉ set khi là request app)
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  // lấy config
  const cfgAll = await loadConfig();
  const cfg = pickCfg(cfgAll, platform);
  if (!cfg) return next(); // không có config -> fail-open

  // kill-switch build lỗi
  if (cfg.blockedBuilds?.includes(buildNumber)) {
    return res.status(426).json({
      code: "UPGRADE_REQUIRED",
      reason: "BLOCKED_BUILD",
      storeUrl: cfg.storeUrl,
      latestVersion: cfg.latestVersion,
      minSupportedBuild: cfg.minSupportedBuild,
      changelog: cfg.changelog || "",
    });
  }

  // rollout theo % (ổn định theo cohort)
  let underRollout = true;
  if (cfg.rollout && cfg.rollout.percentage < 100) {
    const key =
      cfg.rollout.cohortKey === "userId" ? userId || deviceId : deviceId;
    const pct = hashToPercent(key || "anon");
    underRollout = pct < cfg.rollout.percentage;
  }

  // force theo minSupportedBuild + rollout
  if (underRollout && buildNumber < cfg.minSupportedBuild) {
    return res.status(426).json({
      code: "UPGRADE_REQUIRED",
      storeUrl: cfg.storeUrl,
      latestVersion: cfg.latestVersion,
      minSupportedBuild: cfg.minSupportedBuild,
      changelog: cfg.changelog || "",
      message: "Phiên bản quá cũ. Vui lòng cập nhật để tiếp tục.",
    });
  }

  // log thiết bị (non-blocking) — chỉ log cho app
  (async () => {
    await DeviceInstallation.findOneAndUpdate(
      { deviceId, platform },
      {
        $set: {
          user: userId,
          appVersion,
          buildNumber,
          lastSeenAt: new Date(),
          ...(pushToken ? { pushToken } : {}),
        },
        $setOnInsert: { firstSeenAt: new Date() },
      },
      { upsert: true }
    );
  })().catch(() => {});

  // gắn flag “behind” để controller tuỳ thích trả kèm
  req.clientVersionInfo = {
    behind: buildNumber < (cfg.latestBuild || cfg.minSupportedBuild),
    latestVersion: cfg.latestVersion,
    latestBuild: cfg.latestBuild,
    minSupportedBuild: cfg.minSupportedBuild,
  };

  return next();
}
