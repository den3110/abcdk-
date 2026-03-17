import FbLiveConfig from "../models/fbLiveConfigModel.js";
import { getCfgInt, setCfg } from "../services/config.service.js";
import { FACEBOOK_PAGE_POOL_DELAYS } from "../services/facebookPagePool.service.js";
import { LIVE_SESSION_LEASE_CONFIG } from "../services/liveSessionLease.service.js";

const PAGE_POOL_FIELDS = {
  safeFreeDelayMs: {
    key: "LIVE_FB_POOL_SAFE_FREE_DELAY_MS",
    def: FACEBOOK_PAGE_POOL_DELAYS.SAFE_FREE_DELAY_MS,
  },
  fastFreeDelayMs: {
    key: "LIVE_FB_POOL_FAST_FREE_DELAY_MS",
    def: FACEBOOK_PAGE_POOL_DELAYS.FAST_FREE_DELAY_MS,
  },
  staleIdleFreeDelayMs: {
    key: "LIVE_FB_POOL_STALE_IDLE_FREE_DELAY_MS",
    def: FACEBOOK_PAGE_POOL_DELAYS.STALE_IDLE_FREE_DELAY_MS,
  },
  staleBusyMs: {
    key: "LIVE_FB_POOL_STALE_BUSY_MS",
    def: FACEBOOK_PAGE_POOL_DELAYS.STALE_BUSY_MS,
  },
  leaseHeartbeatMs: {
    key: "LIVE_FB_LEASE_HEARTBEAT_MS",
    def: LIVE_SESSION_LEASE_CONFIG.HEARTBEAT_INTERVAL_DEFAULT_MS,
  },
  leaseTimeoutMs: {
    key: "LIVE_FB_LEASE_TIMEOUT_MS",
    def: LIVE_SESSION_LEASE_CONFIG.LEASE_TIMEOUT_DEFAULT_MS,
  },
};

async function readPagePoolFields() {
  const entries = await Promise.all(
    Object.entries(PAGE_POOL_FIELDS).map(async ([field, meta]) => [
      field,
      await getCfgInt(meta.key, meta.def),
    ])
  );
  return Object.fromEntries(entries);
}

async function writePagePoolFields(body, updatedBy = "") {
  for (const [field, meta] of Object.entries(PAGE_POOL_FIELDS)) {
    if (!(field in body)) continue;
    const raw = Number(body[field]);
    if (!Number.isFinite(raw) || raw < 0) {
      throw new Error(`${field} must be >= 0`);
    }
    await setCfg({
      key: meta.key,
      value: String(Math.round(raw)),
      updatedBy,
    });
  }
}

export async function getConfig(req, res) {
  const cfg =
    (await FbLiveConfig.findOne({ key: "fb_live_config" }).lean()) ||
    (await FbLiveConfig.create({})).toObject();
  const pagePool = await readPagePoolFields();
  res.json({ ...cfg, ...pagePool });
}

export async function updateConfig(req, res) {
  const body = req.body || {};
  // Only allow these fields:
  const patch = {};
  if (body.status) patch.status = body.status;
  if (body.privacyValueOnCreate)
    patch.privacyValueOnCreate = body.privacyValueOnCreate;
  if (typeof body.embeddable === "boolean") patch.embeddable = body.embeddable;
  if (body.ensurePrivacyAfterEnd)
    patch.ensurePrivacyAfterEnd = body.ensurePrivacyAfterEnd;

  const cfg = await FbLiveConfig.findOneAndUpdate(
    { key: "fb_live_config" },
    { $set: patch },
    { upsert: true, new: true }
  ).lean();
  await writePagePoolFields(body, req.user?._id ? String(req.user._id) : "admin");
  const pagePool = await readPagePoolFields();
  res.json({ ...cfg, ...pagePool });
}
