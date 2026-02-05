// scripts/syncRankingsOnce.js
// Script chạy 1 lần để sync toàn bộ rankings
// Usage: node scripts/syncRankingsOnce.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { syncAllRankings } from "../services/syncRankingService.js";

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

  try {
    const result = await syncAllRankings();
    console.log("Sync completed:", result);
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
  process.exit(0);
}

main();
