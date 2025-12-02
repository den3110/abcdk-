// test-agenda.js - Script test Agenda notifications
import dotenv from "dotenv";
import mongoose from "mongoose";
import { agenda } from "./jobs/agenda.js";
import Tournament from "./models/tournamentModel.js";
import Match from "./models/matchModel.js";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/sportconnect?replicaSet=rs0";

async function testAgenda() {
  try {
    console.log("🚀 Starting Agenda Test...\n");

    // 1. Connect MongoDB
    console.log("📦 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected\n");

    // 2. Start Agenda
    console.log("⚙️  Starting Agenda...");
    await import("./jobs/notifyJobs.js");
    await agenda.start();
    console.log("✅ Agenda started\n");

    // 3. Find một tournament bất kỳ để test
    console.log("🔍 Finding test tournament...");
    const tournament = await Tournament.findOne()
      .select("_id name startDate")
      .lean();

    if (!tournament) {
      console.log("❌ No tournament found! Please create a tournament first.");
      process.exit(1);
    }

    console.log(`✅ Found: ${tournament.name} (ID: ${tournament._id})\n`);

    // 4. Schedule test countdown notification (chạy sau 30 giây)
    const testTime = new Date(Date.now() + 30 * 1000); // 30 giây sau

    console.log("📅 Scheduling TEST tournament countdown notification...");
    console.log(`   Tournament: ${tournament.name}`);
    console.log(`   Will run at: ${testTime.toLocaleString("vi-VN")}`);
    console.log(`   (in 30 seconds)\n`);

    const job = await agenda.schedule(testTime, "notify.tournament.countdown", {
      tournamentId: String(tournament._id),
      phase: "TEST",
    });

    console.log(`✅ Job scheduled! Job ID: ${job.attrs._id}`);
    console.log(`   Next run: ${job.attrs.nextRunAt}\n`);

    // 5. Find một match bất kỳ để test
    console.log("🔍 Finding test match...");
    const match = await Match.findOne()
      .select("_id tournament pairA pairB")
      .lean();

    if (match) {
      console.log(`✅ Found match ID: ${match._id}\n`);

      // Schedule test match notification (chạy sau 1 phút)
      const matchTestTime = new Date(Date.now() + 60 * 1000); // 1 phút sau

      console.log("📅 Scheduling TEST match start soon notification...");
      console.log(`   Match: ${match._id}`);
      console.log(`   Will run at: ${matchTestTime.toLocaleString("vi-VN")}`);
      console.log(`   (in 1 minute)\n`);

      const matchJob = await agenda.schedule(
        matchTestTime,
        "notify.match.startSoon",
        {
          matchId: String(match._id),
          etaLabel: "TEST",
        }
      );

      console.log(`✅ Match job scheduled! Job ID: ${matchJob.attrs._id}`);
      console.log(`   Next run: ${matchJob.attrs.nextRunAt}\n`);
    } else {
      console.log("⚠️  No match found, skipping match notification test\n");
    }

    // 6. Show all scheduled jobs
    console.log("📋 Current scheduled jobs:");
    const jobs = await agenda.jobs({});
    console.log(`   Total jobs in queue: ${jobs.length}`);

    jobs.slice(0, 5).forEach((j, i) => {
      console.log(
        `   ${i + 1}. ${j.attrs.name} - Next run: ${j.attrs.nextRunAt}`
      );
    });

    console.log("\n");
    console.log("=".repeat(60));
    console.log("✅ TEST SETUP COMPLETED!");
    console.log("=".repeat(60));
    console.log("");
    console.log("📌 Next Steps:");
    console.log("   1. Keep server running (don't stop this script)");
    console.log("   2. Watch console logs for job execution");
    console.log("   3. Check /admin/agendash to see jobs");
    console.log("   4. Check your mobile app for notifications");
    console.log("");
    console.log("⏰ Countdown:");
    console.log("   - Tournament notification in 30 seconds");
    if (match) {
      console.log("   - Match notification in 1 minute");
    }
    console.log("");
    console.log("🔍 Monitoring jobs... (Press Ctrl+C to stop)");
    console.log("");

    // Keep script running to process jobs
    let countdown = 30;
    const interval = setInterval(() => {
      if (countdown > 0) {
        process.stdout.write(`\r⏳ Tournament job in ${countdown}s...`);
        countdown--;
      } else if (countdown === 0) {
        console.log("\n🎉 Tournament job should be running now!");
        countdown--;
      } else if (match && countdown === -30) {
        console.log("🎉 Match job should be running now!");
        clearInterval(interval);

        // Wait a bit more then exit
        setTimeout(() => {
          console.log("\n✅ Test complete! Stopping...");
          agenda.stop().then(() => {
            mongoose.connection.close();
            process.exit(0);
          });
        }, 10000);
      }
    }, 1000);
  } catch (error) {
    console.error("❌ Error:", error);
    await agenda.stop();
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run test
testAgenda();
