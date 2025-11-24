// scripts/cleanupOrphanMatches.js
import mongoose from "mongoose";
import Match from "../backend/models/matchModel.js";
import dotenv from "dotenv"
dotenv.config()

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD || process.env.MONGODB_URI_PROD
    : process.env.MONGO_URI || process.env.MONGODB_URI;


async function main() {
  await mongoose.connect(MONGO_URI);

  const { deletedCount } = await Match.cleanupOrphanMatches();
  console.log("DONE cleanup. Deleted:", deletedCount);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
