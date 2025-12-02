// show-test-users.js - Xem chi tiết users nhận notification
import dotenv from "dotenv";
import mongoose from "mongoose";
import Tournament from "./models/tournamentModel.js";
import Registration from "./models/registrationModel.js";
import User from "./models/userModel.js";
import PushToken from "./models/pushTokenModel.js";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/sportconnect?replicaSet=rs0";

async function showTestUsers() {
  try {
    console.log("🔍 Trích xuất thông tin users...\n");

    await mongoose.connect(MONGO_URI);

    // Tìm tournament
    const tournament = await Tournament.findOne()
      .select("_id name startDate")
      .lean();

    if (!tournament) {
      console.log("❌ No tournament found!");
      process.exit(1);
    }

    console.log("=".repeat(70));
    console.log("📋 TOURNAMENT INFO");
    console.log("=".repeat(70));
    console.log(`Name: ${tournament.name}`);
    console.log(`ID: ${tournament._id}`);
    console.log(`Start Date: ${tournament.startDate}\n`);

    // Tìm tất cả registrations
    const regs = await Registration.find({ tournament: tournament._id })
      .select("code player1 player2 createdAt")
      .populate({
        path: "player1.user",
        select: "name nickname email phone",
      })
      .populate({
        path: "player2.user",
        select: "name nickname email phone",
      })
      .lean();

    console.log("=".repeat(70));
    console.log("👥 REGISTRATIONS & USERS");
    console.log("=".repeat(70));
    console.log(`Total Registrations: ${regs.length}\n`);

    // Collect all unique user IDs
    const userIds = new Set();

    regs.forEach((reg, idx) => {
      console.log(`\n📝 Registration #${idx + 1} (Code: ${reg.code || "N/A"})`);
      console.log("─".repeat(70));

      if (reg.player1?.user) {
        const u = reg.player1.user;
        userIds.add(String(u._id));
        console.log(`  Player 1:`);
        console.log(`    • ID: ${u._id}`);
        console.log(`    • Name: ${u.name || u.nickname || "N/A"}`);
        console.log(`    • Email: ${u.email || "N/A"}`);
        console.log(`    • Phone: ${u.phone || "N/A"}`);
      }

      if (reg.player2?.user) {
        const u = reg.player2.user;
        userIds.add(String(u._id));
        console.log(`  Player 2:`);
        console.log(`    • ID: ${u._id}`);
        console.log(`    • Name: ${u.name || u.nickname || "N/A"}`);
        console.log(`    • Email: ${u.email || "N/A"}`);
        console.log(`    • Phone: ${u.phone || "N/A"}`);
      }
    });

    // Check push tokens
    const userIdArray = Array.from(userIds);
    console.log("\n");
    console.log("=".repeat(70));
    console.log("📱 PUSH TOKENS STATUS");
    console.log("=".repeat(70));
    console.log(`Total Unique Users: ${userIdArray.length}\n`);

    const tokens = await PushToken.find({
      user: { $in: userIdArray.map((id) => mongoose.Types.ObjectId(id)) },
    })
      .select("user token platform createdAt")
      .populate({
        path: "user",
        select: "name nickname email",
      })
      .lean();

    if (tokens.length > 0) {
      console.log(`✅ Users WITH Push Tokens: ${tokens.length}`);
      tokens.forEach((t, idx) => {
        console.log(
          `\n${idx + 1}. ${t.user?.name || t.user?.nickname || "Unknown"}`
        );
        console.log(`   User ID: ${t.user._id}`);
        console.log(`   Token: ${t.token.substring(0, 30)}...`);
        console.log(`   Platform: ${t.platform || "unknown"}`);
        console.log(`   Created: ${t.createdAt}`);
      });
    } else {
      console.log("❌ NO users have push tokens yet!\n");
    }

    const usersWithoutTokens = userIdArray.filter(
      (uid) => !tokens.find((t) => String(t.user._id) === uid)
    );

    if (usersWithoutTokens.length > 0) {
      console.log(
        `\n⚠️  Users WITHOUT Push Tokens: ${usersWithoutTokens.length}`
      );

      const usersDetails = await User.find({
        _id: {
          $in: usersWithoutTokens.map((id) => mongoose.Types.ObjectId(id)),
        },
      })
        .select("name nickname email phone")
        .lean();

      usersDetails.forEach((u, idx) => {
        console.log(`\n${idx + 1}. ${u.name || u.nickname || "Unknown"}`);
        console.log(`   User ID: ${u._id}`);
        console.log(`   Email: ${u.email || "N/A"}`);
        console.log(`   Phone: ${u.phone || "N/A"}`);
        console.log(`   ℹ️  Needs to login to mobile app to get push token`);
      });
    }

    console.log("\n");
    console.log("=".repeat(70));
    console.log("📊 SUMMARY");
    console.log("=".repeat(70));
    console.log(`✅ Total Users: ${userIdArray.length}`);
    console.log(`✅ Have Push Tokens: ${tokens.length}`);
    console.log(`❌ Missing Push Tokens: ${usersWithoutTokens.length}`);
    console.log("");
    console.log("💡 Conclusion:");
    if (tokens.length > 0) {
      console.log(
        `   → Notifications WILL BE SENT to ${tokens.length} user(s) 🎉`
      );
    } else {
      console.log(`   → NO notifications will be sent (no push tokens) ⚠️`);
      console.log(`   → Users need to login to mobile app first 📱`);
    }
    console.log("");

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

showTestUsers();
