// migrate.js
import mongoose from "mongoose";

await mongoose.connect("mongodb://127.0.0.1:27017/sportconnect");

const Tournament = mongoose.connection.collection("tournaments");

await Tournament.updateMany(
  { status: "Sắp diễn ra" },
  { $set: { status: "upcoming" } }
);
await Tournament.updateMany(
  { status: "Đang diễn ra" },
  { $set: { status: "ongoing" } }
);
await Tournament.updateMany(
  { status: "Đã diễn ra" },
  { $set: { status: "finished" } }
);

console.log("✅ Migration done");
process.exit(0);
