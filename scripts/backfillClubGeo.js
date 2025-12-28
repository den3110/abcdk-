// scripts/backfillClubGeo.js
import "dotenv/config";
import mongoose from "mongoose";
import Club from "../backend/models/clubModel.js";
import { geocodeClubLocation } from "../backend/services/openaiGeocode.js";
// import { geocodeClubLocation } from "../backend/services/geocodeTournamentLocation.js";

// ---------- CLI ARGS ----------
const args = process.argv.slice(2);
const getArg = (name, def = null) => {
  const idx = args.findIndex((a) => a === `--${name}`);
  if (idx === -1) return def;
  const val = args[idx + 1];
  if (!val || val.startsWith("--")) return true; // flag
  return val;
};

const DRY = Boolean(getArg("dry", false));
const LIMIT = Number(getArg("limit", 200)) || 200; // tổng tối đa
const BATCH = Number(getArg("batch", 25)) || 25; // mỗi lần fetch DB
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", 2)) || 2);
const ONLY_PUBLIC =
  String(getArg("onlyPublic", "false")).toLowerCase() === "true";
const RE_GEO_LOW = String(getArg("reLow", "false")).toLowerCase() === "true"; // re-geocode nếu accuracy low/confidence thấp

const MONGO_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error("❌ Missing MONGO_URI / MONGODB_URI / DATABASE_URL in env");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "⚠️ OPENAI_API_KEY missing. Script will NOT be able to geocode."
  );
}

// ---------- HELPERS ----------
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const buildClubLocationText = (club) => {
  const lt = String(club.locationText || "").trim();
  if (lt) return lt;

  const addr = String(club.address || "").trim();
  if (addr) return addr;

  const city = String(club.city || "").trim();
  const province = String(club.province || "").trim();
  const country = String(club.country || "VN").trim();

  const combined = [city, province, country].filter(Boolean).join(", ").trim();
  return combined || "";
};

const shouldReGeocode = (club) => {
  if (!RE_GEO_LOW) return false;
  const acc = String(club.locationGeo?.accuracy || "").toLowerCase();
  const conf = toNum(club.locationGeo?.confidence);
  // bạn có thể chỉnh điều kiện này tuỳ ý
  if (acc === "low") return true;
  if (Number.isFinite(conf) && conf > 0 && conf < 0.35) return true; // nếu bạn dùng confidence 0-1
  if (Number.isFinite(conf) && conf >= 1 && conf < 35) return true; // nếu bạn dùng 0-100
  return false;
};

const hasGeo = (club) =>
  Array.isArray(club.location?.coordinates) &&
  club.location.coordinates.length === 2;

// simple concurrency runner
async function runPool(items, worker, concurrency) {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        await worker(it);
      } catch (e) {
        // worker tự log
      }
    }
  });
  await Promise.all(workers);
}

// ---------- MAIN ----------
async function main() {
  console.log("== Club Geo Backfill ==");
  console.log({
    DRY,
    LIMIT,
    BATCH,
    CONCURRENCY,
    ONLY_PUBLIC,
    RE_GEO_LOW,
  });

  await mongoose.connect(MONGO_URI);
  console.log("✅ Mongo connected");

  // đảm bảo index 2dsphere (nếu bạn muốn)
  try {
    await Club.syncIndexes();
    console.log("✅ Index synced");
  } catch (e) {
    console.warn("⚠️ syncIndexes failed (can ignore):", e?.message || e);
  }

  let processed = 0;
  let updated = 0;
  let skippedNoText = 0;
  let failed = 0;

  const baseFilter = ONLY_PUBLIC ? { visibility: "public" } : {};

  // ưu tiên lấy CLB chưa có location hoặc cần re-geocode
  const filter = RE_GEO_LOW
    ? {
        ...baseFilter,
        $or: [
          { "location.coordinates": { $exists: false } },
          { "location.coordinates": { $size: 0 } },
          { location: { $exists: false } },
          // re-geocode low
          { "locationGeo.accuracy": "low" },
        ],
      }
    : {
        ...baseFilter,
        $or: [
          { "location.coordinates": { $exists: false } },
          { "location.coordinates": { $size: 0 } },
          { location: { $exists: false } },
        ],
      };

  while (processed < LIMIT) {
    const remain = LIMIT - processed;

    const docs = await Club.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(BATCH, remain))
      .lean();

    if (!docs.length) break;

    await runPool(
      docs,
      async (club) => {
        processed += 1;

        // nếu đã có geo và không bật reLow -> skip
        if (hasGeo(club) && !shouldReGeocode(club)) {
          return;
        }

        const locationText = buildClubLocationText(club);
        if (!locationText) {
          skippedNoText += 1;
          console.log(`- skip(no locationText): ${club._id} "${club.name}"`);
          return;
        }

        const countryHint = club.country || "VN";

        let geo;
        try {
          geo = await geocodeClubLocation({
            location: locationText,
            countryHint,
          });
        } catch (e) {
          failed += 1;
          console.log(
            `❌ geocode error: ${club._id} "${club.name}"`,
            e?.message || e
          );
          return;
        }

        if (!Number.isFinite(geo?.lat) || !Number.isFinite(geo?.lon)) {
          failed += 1;
          console.log(
            `❌ no coords: ${club._id} "${club.name}" text="${locationText}"`,
            { lat: geo?.lat, lon: geo?.lon, formatted: geo?.formatted }
          );
          return;
        }

        const patch = {
          address: club.address || "",
          locationText: club.locationText?.trim()
            ? club.locationText
            : locationText,
          location: { type: "Point", coordinates: [geo.lon, geo.lat] },
          locationGeo: {
            lat: geo.lat,
            lon: geo.lon,
            countryCode: geo.countryCode,
            countryName: geo.countryName,
            locality: geo.locality,
            admin1: geo.admin1,
            admin2: geo.admin2,
            displayName: geo.formatted || locationText,
            accuracy: geo.accuracy || "low",
            confidence: geo.confidence || 0,
            provider: geo.provider || "openai-geocode",
            raw: geo.raw || locationText,
            updatedAt: new Date(),
          },
        };

        if (DRY) {
          console.log(
            `DRY ✅ ${club._id} "${club.name}" ->`,
            patch.location.coordinates,
            patch.locationGeo.displayName
          );
          return;
        }

        await Club.updateOne({ _id: club._id }, { $set: patch });
        updated += 1;
        console.log(
          `✅ updated ${club._id} "${club.name}" ->`,
          patch.location.coordinates,
          patch.locationGeo.displayName
        );
      },
      CONCURRENCY
    );
  }

  console.log("== DONE ==");
  console.log({ processed, updated, skippedNoText, failed });

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
