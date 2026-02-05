// scripts/ensureIndexes.js
// Script để tạo indexes cần thiết cho performance
// Usage: node scripts/ensureIndexes.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI;

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected!");

  const db = mongoose.connection.db;
  const rankingsCollection = db.collection("rankings");

  console.log("\n📋 Current indexes on rankings collection:");
  const existingIndexes = await rankingsCollection.indexes();
  existingIndexes.forEach((idx, i) => {
    console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
  });

  console.log("\n🔧 Creating/ensuring compound index for V2 API...");

  try {
    // Index chính cho sorting rankings
    await rankingsCollection.createIndex(
      {
        colorRank: 1,
        double: -1,
        single: -1,
        points: -1,
        updatedAt: -1,
        _id: 1,
      },
      { name: "ranking_sort_v2_idx", background: true },
    );
    console.log("✅ Index 'ranking_sort_v2_idx' created successfully!");
  } catch (e) {
    if (e.code === 85 || e.code === 86) {
      console.log("✅ Index already exists (equivalent index found)");
    } else {
      throw e;
    }
  }

  // Index cho colorRank filter
  try {
    await rankingsCollection.createIndex(
      { colorRank: 1 },
      { name: "colorRank_idx", background: true },
    );
    console.log("✅ Index 'colorRank_idx' created successfully!");
  } catch (e) {
    if (e.code === 85 || e.code === 86) {
      console.log("✅ Index 'colorRank_idx' already exists");
    } else {
      throw e;
    }
  }

  console.log("\n📋 Final indexes on rankings collection:");
  const finalIndexes = await rankingsCollection.indexes();
  finalIndexes.forEach((idx, i) => {
    console.log(`  ${i + 1}. ${idx.name}: ${JSON.stringify(idx.key)}`);
  });

  await mongoose.disconnect();
  console.log("\n✅ Done! Disconnected from MongoDB");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
