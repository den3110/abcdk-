// scripts/reindexUsersToEs.js
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../backend/models/userModel.js";
import { es, ES_USER_INDEX } from "../backend/services/esClient.js";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("[reindex-users] Mongo connected");

  const indexName = ES_USER_INDEX || "users";

  const cursor = User.find({ isDeleted: { $ne: true } })
    .select("name nickname province avatar email phone isDeleted createdAt")
    .cursor();

  const body = [];
  let count = 0;

  for await (const u of cursor) {
    body.push(
      {
        index: {
          _index: indexName,
          _id: String(u._id), // 👈 dùng _id meta của ES, không field userId
        },
      },
      {
        name: u.name || "",
        nickname: u.nickname || "",
        province: u.province || "",
        avatar: u.avatar || "",
        email: u.email || "",
        phone: u.phone || "",
        isDeleted: !!u.isDeleted,
        createdAt: u.createdAt || new Date(),
      }
    );

    if (body.length >= 1000) {
      await es.bulk({ refresh: true, body });
      count += body.length / 2;
      body.length = 0;
      console.log("[reindex-users] indexed:", count);
    }
  }

  if (body.length) {
    await es.bulk({ refresh: true, body });
    count += body.length / 2;
  }

  console.log("[reindex-users] done, total:", count);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[reindex-users] error:", err);
  process.exit(1);
});
