// scripts/reindexAllTournaments.js
import dotenv from "dotenv";
dotenv.config(); // load .env

import mongoose from "mongoose";
import Tournament from "../backend/models/tournamentModel.js"; // chỉnh path cho đúng

const NODE_ENV = process.env.NODE_ENV || "development";

// Nếu là production -> ưu tiên MONGO_URI_PROD, fallback về MONGO_URI
// Ngược lại (dev/staging) -> dùng MONGO_URI
const mongoUri =
  NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD || process.env.MONGO_URI
    : process.env.MONGO_URI;

if (!mongoUri) {
  console.error(
    "[reindex] ERROR: Missing Mongo URI. Please set MONGO_URI (and/or MONGO_URI_PROD for production)."
  );
  process.exit(1);
}

async function main() {
  console.log(`[reindex] NODE_ENV = ${NODE_ENV}`);
  console.log("[reindex] Connecting Mongo...");

  await mongoose.connect(mongoUri);

  console.log("[reindex] Connected. Start reindex...");
  await Tournament.reindexAllToSearch(); // ✅ static method trên model

  console.log("[reindex] Script done. Closing Mongo.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[reindex] ERROR:", err);
  process.exit(1);
});
