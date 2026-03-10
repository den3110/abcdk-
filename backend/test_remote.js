import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  normalize_for_search,
  build_vietnamese_regex,
} from "./utils/vnSearchNormalizer.js";

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const User = mongoose.model(
    "User",
    new mongoose.Schema({ name: String, nickname: String }),
    "users",
  );

  const testQueries = ["quang hoà trần", "quang hòa trần", "quang hof"];

  for (const kw of testQueries) {
    const { folded } = normalize_for_search(kw, {
      fold_case: true,
      fold_accents: true,
    });
    const namePattern = folded
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => build_vietnamese_regex(t))
      .join(".*");

    console.log(`\n--- Query: '${kw}' ---`);
    console.log("Regex:", namePattern);

    const orConds = [
      { name: { $regex: namePattern, $options: "i" } },
      { nickname: { $regex: namePattern, $options: "i" } },
    ];

    const users = await User.find({ $or: orConds }).limit(5).lean();
    console.log(`Found ${users.length} users:`);
    for (const u of users) {
      console.log(` - ID: ${u._id}, Name: ${u.name}, Nickname: ${u.nickname}`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
