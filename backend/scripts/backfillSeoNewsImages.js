import dotenv from "dotenv";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import { backfillSeoNewsArticleImages } from "../services/seoNewsImageService.js";

dotenv.config();

function parseArgs(argv = []) {
  const options = {
    origin: "generated",
    limit: 12,
    force: false,
    statuses: ["published", "draft"],
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg.startsWith("--origin=")) {
      options.origin = arg.split("=")[1] || options.origin;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      continue;
    }

    if (arg.startsWith("--statuses=")) {
      options.statuses = arg
        .split("=")[1]
        .split(",")
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await connectDB();

  try {
    const result = await backfillSeoNewsArticleImages(options);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[backfillSeoNewsImages] failed:", error?.message || error);
  process.exitCode = 1;
});
