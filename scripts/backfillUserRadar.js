// scripts/backfillUserRadar.js
import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../backend/models/userModel.js";
import UserRadar from "../backend/models/userRadarModel.js";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";

let MONGO_URI;

// development -> dùng MONGO_URI
if (NODE_ENV === "development") {
  MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
} else if (NODE_ENV === "production") {
  // production -> dùng MONGO_URI_PROD
  MONGO_URI = process.env.MONGO_URI_PROD || process.env.MONGODB_URI;
} else {
  // các env khác (staging, test, ...) tuỳ bạn muốn fallback về đâu
  MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGO_URI_PROD ||
    process.env.MONGODB_URI;
}

if (!MONGO_URI) {
  console.error(
    "❌ Missing Mongo URI. Expected MONGO_URI (dev) or MONGO_URI_PROD (prod) or MONGODB_URI in env"
  );
  process.exit(1);
}

async function main() {
  console.log("NODE_ENV =", NODE_ENV);
  console.log("🔄 Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected");

  // Lấy list user đã có UserRadar
  const radarUserIds = await UserRadar.distinct("user");
  console.log("📊 Existing UserRadar count:", radarUserIds.length);

  // Tìm user chưa có UserRadar
  const usersWithoutRadar = await User.find({
    _id: { $nin: radarUserIds },
    isDeleted: { $ne: true },
  })
    .select("_id")
    .lean();

  console.log("👉 Users without UserRadar:", usersWithoutRadar.length);

  if (!usersWithoutRadar.length) {
    console.log("✅ Nothing to backfill, all good.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Dùng bulkWrite để tạo hàng loạt
  const ops = usersWithoutRadar.map((u) => ({
    updateOne: {
      filter: { user: u._id },
      update: {
        $setOnInsert: {
          user: u._id,
          radarSettings: {
            enabled: false,
            radiusKm: 5,
            preferredPlayType: "any",
            preferredGender: "any",
          },
        },
      },
      upsert: true,
    },
  }));

  console.log("🚀 Running bulkWrite for", ops.length, "users...");

  const result = await UserRadar.bulkWrite(ops, { ordered: false });

  console.log("✅ Backfill done.");
  console.log("   upsertedCount:", result.upsertedCount);
  if (result.insertedCount != null) {
    console.log("   insertedCount:", result.insertedCount);
  }

  await mongoose.disconnect();
  console.log("🔌 Disconnected");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Backfill error:", err);
  process.exit(1);
});
