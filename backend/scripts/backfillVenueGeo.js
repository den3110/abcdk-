// scripts/backfillVenueGeo.js — geocode các cụm sân chưa có toạ độ để hiện lên bản đồ.
// Chạy trên VPS: cd /abcdk- && NODE_ENV=production node backend/scripts/backfillVenueGeo.js
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Venue from "../models/venueModel.js";
import { geocodeAddressVN } from "../utils/geocode.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  await connectDB();
  const venues = await Venue.find({
    $or: [
      { "locationGeo.lat": null },
      { "locationGeo.lat": { $exists: false } },
      { locationGeo: null },
    ],
  });
  console.log(`Cụm sân chưa có toạ độ: ${venues.length}`);
  let ok = 0;
  for (const v of venues) {
    const location = [v.address, v.province].map((s) => String(s || "").trim()).filter(Boolean).join(", ");
    if (!location) { console.log("- bỏ qua (thiếu địa chỉ):", v.name); continue; }
    const geo = await geocodeAddressVN(location);
    if (geo) {
      v.locationGeo = geo;
      await v.save();
      ok += 1;
      console.log(`✓ ${v.name} → ${geo.lat}, ${geo.lon}`);
    } else {
      console.log(`✗ không định vị được: ${v.name} (${location})`);
    }
    await sleep(1100); // tôn trọng rate-limit Nominatim
  }
  console.log(`Xong. Cập nhật ${ok}/${venues.length}.`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });
