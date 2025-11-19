// scripts/cleanupOrphanMatches.js
import mongoose from "mongoose";
import Match from "../backend/models/matchModel.js";
import dotenv from "dotenv"
dotenv.config()

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const { deletedCount } = await Match.cleanupOrphanMatches();
  console.log("DONE cleanup. Deleted:", deletedCount);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
