// migrate.js
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD || process.env.MONGODB_URI_PROD
    : process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      "mongodb://127.0.0.1:27017/sportconnect";

async function run() {
  try {
    if (!MONGO_URI)
      throw new Error(
        `Missing MongoDB URI for ${process.env.NODE_ENV || "development"}`
      );

    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`✅ Connected (${process.env.NODE_ENV || "development"})`);

    const Tournament = mongoose.connection.collection("tournaments");

    const r1 = await Tournament.updateMany(
      { status: "Sắp diễn ra" },
      { $set: { status: "upcoming" } }
    );
    const r2 = await Tournament.updateMany(
      { status: "Đang diễn ra" },
      { $set: { status: "ongoing" } }
    );
    const r3 = await Tournament.updateMany(
      { status: "Đã diễn ra" },
      { $set: { status: "finished" } }
    );

    console.log("— Migration result —");
    console.log(
      `"Sắp diễn ra"  -> "upcoming": matched=${r1.matchedCount}, modified=${r1.modifiedCount}`
    );
    console.log(
      `"Đang diễn ra" -> "ongoing" : matched=${r2.matchedCount}, modified=${r2.modifiedCount}`
    );
    console.log(
      `"Đã diễn ra"   -> "finished": matched=${r3.matchedCount}, modified=${r3.modifiedCount}`
    );

    console.log("✅ Migration done");
  } catch (err) {
    console.error("❌ Migration failed:", err?.message || err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
