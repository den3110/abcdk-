// scripts/seedRankings.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./backend/models/userModel.js";
import Ranking from "./backend/models/rankingModel.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const BATCH_SIZE = 500;

async function main() {
  if (!MONGO_URI) {
    console.error("❌ Missing MONGO_URI in .env");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // Đảm bảo unique index cho { user: 1 }
  await Ranking.syncIndexes();

  let totalUsers = 0;
  let created = 0;
  let failed = 0;

  const cursor = User.find({}, { _id: 1 }).cursor();
  let ops = [];

  for await (const u of cursor) {
    totalUsers++;
    ops.push({
      updateOne: {
        filter: { user: u._id },
        update: {
          $setOnInsert: {
            user: u._id,
            single: 0,
            double: 0,
            mix: 0,
            points: 0,
            lastUpdated: new Date(),
          },
        },
        upsert: true,
      },
    });

    if (ops.length >= BATCH_SIZE) {
      created += await flush(ops);
      ops = [];
    }
  }
  if (ops.length) created += await flush(ops);

  const existed = totalUsers - created - failed;

  console.log("—");
  console.log(`👥 Users scanned:      ${totalUsers}`);
  console.log(`🆕 Rankings created:   ${created}`);
  console.log(`✓ Already had ranking: ${existed < 0 ? 0 : existed}`);
  console.log(`⚠️  Failed:            ${failed}`);

  await mongoose.disconnect();

  async function flush(bulkOps) {
    try {
      const res = await Ranking.bulkWrite(bulkOps, { ordered: false });
      // upsertedCount = số bản ghi mới tạo
      return res.upsertedCount || 0;
    } catch (err) {
      // Duplicate key (11000) có thể phát sinh khi race condition — bỏ qua
      if (err?.code === 11000) return 0;
      console.error("Bulk error:", err?.message || err);
      failed += bulkOps.length;
      return 0;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
