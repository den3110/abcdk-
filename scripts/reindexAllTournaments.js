// scripts/reindexAllTournaments.js
import dotenv from "dotenv";
dotenv.config(); // nếu bạn dùng .env

import mongoose from "mongoose";
import Tournament from "../backend/models/tournamentModel.js"; // chỉnh path cho đúng

async function main() {
  console.log("[reindex] Connecting Mongo...");
  await mongoose.connect(process.env.MONGO_URI);

  console.log("[reindex] Connected. Start reindex...");
  await Tournament.reindexAllToSearch(); // ✅ gọi static

  console.log("[reindex] Script done. Closing Mongo.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[reindex] ERROR:", err);
  process.exit(1);
});
