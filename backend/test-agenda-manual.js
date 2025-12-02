// test-agenda-manual.js - Manual test để trigger job ngay lập tức
import dotenv from "dotenv";
import mongoose from "mongoose";
import {
  publishNotification,
  EVENTS,
  CATEGORY,
} from "./services/notifications/notificationHub.js";
import Tournament from "./models/tournamentModel.js";
import Match from "./models/matchModel.js";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/sportconnect?replicaSet=rs0";

async function testNotifications() {
  try {
    console.log("🚀 Testing Notifications Manually...\n");

    // Connect MongoDB
    console.log("📦 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected\n");

    // Test 1: Tournament Countdown Notification
    console.log("=".repeat(60));
    console.log("TEST 1: TOURNAMENT COUNTDOWN NOTIFICATION");
    console.log("=".repeat(60));

    const tournament = await Tournament.findOne().select("_id name").lean();

    if (tournament) {
      console.log(`📣 Sending countdown notification for: ${tournament.name}`);

      const result = await publishNotification(EVENTS.TOURNAMENT_COUNTDOWN, {
        tournamentId: String(tournament._id),
        topicType: "tournament",
        topicId: String(tournament._id),
        category: CATEGORY.COUNTDOWN,
        phase: "TEST",
      });

      console.log("\n✅ Result:");
      console.log(`   Audience: ${result.audience} users`);
      console.log(`   Sent to: ${result.sentToNew} users`);
      console.log(`   Tokens used: ${result.tokensUsed}`);
      console.log(`   Tickets OK: ${result.ticketsOk}\n`);
    } else {
      console.log("❌ No tournament found!\n");
    }

    // Test 2: Match Start Soon Notification
    console.log("=".repeat(60));
    console.log("TEST 2: MATCH START SOON NOTIFICATION");
    console.log("=".repeat(60));

    const match = await Match.findOne().select("_id label").lean();

    if (match) {
      console.log(
        `📣 Sending match start notification for match: ${match._id}`
      );

      const result = await publishNotification(EVENTS.MATCH_START_SOON, {
        matchId: String(match._id),
        topicType: "match",
        topicId: String(match._id),
        category: CATEGORY.SCHEDULE,
        label: match.label || "Test Match",
        eta: "TEST",
      });

      console.log("\n✅ Result:");
      console.log(`   Audience: ${result.audience} users`);
      console.log(`   Sent to: ${result.sentToNew} users`);
      console.log(`   Tokens used: ${result.tokensUsed}`);
      console.log(`   Tickets OK: ${result.ticketsOk}\n`);
    } else {
      console.log("❌ No match found!\n");
    }

    console.log("=".repeat(60));
    console.log("✅ ALL TESTS COMPLETED!");
    console.log("=".repeat(60));
    console.log("\n📱 Check your mobile app for notifications!");

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testNotifications();
