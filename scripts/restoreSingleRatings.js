#!/usr/bin/env node
/**
 * Script khôi phục điểm đơn (single) cho users bị reset về 0
 *
 * Cách chạy:
 *   node restoreSingleRatings.js              # Dry run (xem trước)
 *   node restoreSingleRatings.js --execute    # Chạy thật
 *   node restoreSingleRatings.js --preview    # Xem chi tiết users
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Ranking from "../backend/models/rankingModel.js";
import ScoreHistory from "../backend/models/scoreHistoryModel.js";
import User from "../backend/models/userModel.js";

// Load env
dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/pickletour";

// ============== FUNCTIONS ==============

/**
 * Khôi phục điểm single cho users bị reset về 0
 */
async function restoreSingleRatings(dryRun = true) {
  console.log("=".repeat(60));
  console.log("🔧 SCRIPT KHÔI PHỤC ĐIỂM ĐƠN (SINGLE)");
  console.log("=".repeat(60));
  console.log(
    `Mode: ${dryRun ? "🔍 DRY RUN (chỉ xem, không update)" : "⚡ THỰC THI"}`
  );
  console.log("");

  const result = {
    found: 0,
    restored: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Bước 1: Tìm tất cả users có single = 0 hoặc null trong Ranking
    console.log("📋 Bước 1: Tìm users có điểm single = 0 hoặc không có...");

    const affectedRankings = await Ranking.find({
      $or: [{ single: 0 }, { single: null }, { single: { $exists: false } }],
    })
      .select("user single double")
      .lean();

    console.log(
      `   Tìm thấy ${affectedRankings.length} users có single = 0 hoặc không có`
    );
    result.found = affectedRankings.length;

    if (affectedRankings.length === 0) {
      console.log("\n✅ Không có user nào cần khôi phục!");
      return result;
    }

    // Bước 2: Với mỗi user, tìm điểm single gần nhất trong ScoreHistory
    console.log("");
    console.log("📋 Bước 2: Tìm điểm single gần nhất từ ScoreHistory...");

    const userIds = affectedRankings.map((r) => r.user);

    // Query một lần để lấy single mới nhất cho tất cả users
    const latestSingles = await ScoreHistory.aggregate([
      {
        $match: {
          user: { $in: userIds },
          single: { $exists: true, $ne: null },
        },
      },
      { $sort: { scoredAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$user",
          single: { $first: "$single" },
          scoredAt: { $first: "$scoredAt" },
          note: { $first: "$note" },
        },
      },
    ]);

    // Tạo map để lookup nhanh
    const singleMap = new Map(
      latestSingles.map((r) => [
        String(r._id),
        { single: r.single, scoredAt: r.scoredAt, note: r.note },
      ])
    );

    console.log(
      `   Tìm thấy ${latestSingles.length} users có điểm single trong ScoreHistory`
    );

    // Bước 3: Chuẩn bị bulk update
    console.log("");
    console.log("📋 Bước 3: Chuẩn bị khôi phục...");
    console.log("");

    const bulkOps = [];

    for (const ranking of affectedRankings) {
      const userId = String(ranking.user);
      const historyData = singleMap.get(userId);

      if (
        !historyData ||
        !Number.isFinite(historyData.single) ||
        historyData.single <= 0
      ) {
        result.skipped++;
        console.log(
          `   ⏭️  User ${userId.slice(
            -8
          )}: Không tìm thấy điểm single trong history - BỎ QUA`
        );
        continue;
      }

      result.restored++;
      const dateStr = new Date(historyData.scoredAt).toLocaleDateString(
        "vi-VN"
      );

      console.log(
        `   ✏️  User ${userId.slice(-8)}: ${ranking.single || 0} → ${
          historyData.single
        } (từ ${dateStr})`
      );

      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { user: new mongoose.Types.ObjectId(userId) },
            update: {
              $set: { single: historyData.single },
            },
          },
        });
      }
    }

    // Bước 4: Thực hiện update
    console.log("");
    console.log("📋 Bước 4: Thực hiện update...");

    if (dryRun) {
      console.log("   ⏭️  DRY RUN - Bỏ qua update thực tế");
    } else if (bulkOps.length > 0) {
      const writeResult = await Ranking.bulkWrite(bulkOps);
      console.log(`   ✅ Đã update ${writeResult.modifiedCount} records`);
    } else {
      console.log("   ℹ️  Không có records nào cần update");
    }

    // Tổng kết
    console.log("");
    console.log("=".repeat(60));
    console.log("📊 KẾT QUẢ:");
    console.log("=".repeat(60));
    console.log(`   Tổng users có single = 0:     ${result.found}`);
    console.log(`   Đã khôi phục:                 ${result.restored}`);
    console.log(`   Bỏ qua (không có history):    ${result.skipped}`);
    console.log("");

    if (dryRun && result.restored > 0) {
      console.log(
        "💡 Để thực hiện update thật, chạy: node restoreSingleRatings.js --execute"
      );
    }

    return result;
  } catch (error) {
    console.error("❌ Lỗi:", error);
    result.errors.push(error.message);
    return result;
  }
}

/**
 * Xem chi tiết users bị ảnh hưởng
 */
async function previewAffectedUsers() {
  console.log("=".repeat(60));
  console.log("🔍 XEM TRƯỚC USERS BỊ ẢNH HƯỞNG");
  console.log("=".repeat(60));
  console.log("");

  const zeroSingleRankings = await Ranking.find({
    $or: [{ single: 0 }, { single: null }, { single: { $exists: false } }],
  })
    .select("user single double")
    .lean();

  console.log(`Tìm thấy ${zeroSingleRankings.length} users có single = 0:\n`);

  // Lấy thông tin user
  const userIds = zeroSingleRankings.map((r) => r.user);
  const users = await User.find({ _id: { $in: userIds } })
    .select("name phone")
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  // Lấy single history
  const latestSingles = await ScoreHistory.aggregate([
    {
      $match: {
        user: { $in: userIds },
        single: { $exists: true, $ne: null },
      },
    },
    { $sort: { scoredAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        scoredAt: { $first: "$scoredAt" },
      },
    },
  ]);
  const singleMap = new Map(latestSingles.map((r) => [String(r._id), r]));

  let canRestore = 0;
  let cannotRestore = 0;

  for (const r of zeroSingleRankings) {
    const userId = String(r.user);
    const user = userMap.get(userId);
    const history = singleMap.get(userId);

    const userName = user?.name || "N/A";
    const userPhone = user?.phone || "N/A";

    if (history) {
      canRestore++;
      const dateStr = new Date(history.scoredAt).toLocaleDateString("vi-VN");
      console.log(
        `✅ ${userName.padEnd(20)} | ${userPhone.padEnd(12)} | ` +
          `double=${(r.double || 0).toFixed(2).padStart(5)} | ` +
          `→ Khôi phục single: ${history.single} (${dateStr})`
      );
    } else {
      cannotRestore++;
      console.log(
        `⚠️  ${userName.padEnd(20)} | ${userPhone.padEnd(12)} | ` +
          `double=${(r.double || 0).toFixed(2).padStart(5)} | ` +
          `→ Không có history single`
      );
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log(
    `📊 Tổng kết: ${canRestore} có thể khôi phục, ${cannotRestore} không có history`
  );
  console.log("=".repeat(60));
}

// ============== MAIN ==============

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes("--execute") || args.includes("-e");
  const isPreview = args.includes("--preview") || args.includes("-p");
  const isHelp = args.includes("--help") || args.includes("-h");

  if (isHelp) {
    console.log(`
Cách sử dụng:
  node restoreSingleRatings.js              Dry run (xem trước, không update)
  node restoreSingleRatings.js --execute    Chạy thật, update database
  node restoreSingleRatings.js --preview    Xem chi tiết từng user bị ảnh hưởng
  node restoreSingleRatings.js --help       Hiển thị help

Biến môi trường:
  MONGO_URI hoặc MONGODB_URI    Connection string MongoDB
`);
    process.exit(0);
  }

  try {
    console.log("🔌 Đang kết nối MongoDB...");
    console.log(
      `   URI: ${MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`
    );

    await mongoose.connect(MONGO_URI);
    console.log("✅ Đã kết nối!\n");

    if (isPreview) {
      await previewAffectedUsers();
    } else {
      await restoreSingleRatings(!isExecute);
    }

    await mongoose.disconnect();
    console.log("\n🔌 Đã ngắt kết nối MongoDB");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Lỗi:", error.message);
    process.exit(1);
  }
}

main();
