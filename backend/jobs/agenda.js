// jobs/agenda.js
import Agenda from "agenda";
import dotenv from "dotenv";
// 🆕 dùng được kết nối mongoose hiện có nếu bạn đã connect ở nơi khác
import mongoose from "mongoose";
dotenv.config();

// 🆕 xác định môi trường
const isProd = process.env.NODE_ENV === "production";

// 🆕 tách hàm tạo instance để ưu tiên xài kết nối có sẵn
function buildAgendaInstance() {
  const collection = process.env.AGENDA_COLLECTION || "jobs";
  const processEvery = process.env.AGENDA_PROCESS_EVERY || "1 minute";
  const defaultLockLifetime =
    Number(process.env.AGENDA_DEFAULT_LOCK_LIFETIME_MS) || 10 * 60 * 1000;

  // 🆕 Nếu Mongoose đã connect thì dùng native db đó, tránh tạo kết nối Mongo mới
  const hasMongoose =
    mongoose?.connection?.readyState === 1 && mongoose?.connection?.db;

  if (hasMongoose) {
    console.log(
      `[agenda] Using existing mongoose connection (${isProd ? "PROD" : "DEV"})`
    );
    return new Agenda({
      // Agenda chấp nhận native Db của driver
      mongo: mongoose.connection.db,
      db: { collection },
      processEvery,
      defaultLockLifetime,
    });
  }

  // 🆕 Fallback: tự kết nối theo NODE_ENV
  //    production -> MONGO_URI_PROD
  //    development (hoặc khác) -> MONGO_URI
  const address = isProd ? process.env.MONGO_URI_PROD : process.env.MONGO_URI;

  if (!address) {
    throw new Error(
      "[agenda] Mongo URI not set. Expected " +
        (isProd ? "MONGO_URI_PROD" : "MONGO_URI") +
        " for current NODE_ENV."
    );
  }

  console.log(
    `[agenda] Creating standalone Agenda connection -> ${isProd ? "MONGO_URI_PROD" : "MONGO_URI"}`
  );

  return new Agenda({
    db: { address, collection },
    processEvery,
    defaultLockLifetime,
  });
}

export const agenda = buildAgendaInstance();

// 🆕 cờ idempotent để không start nhiều lần khi hot-reload
let started = false;

export async function startAgenda() {
  if (started) return agenda;
  console.log("✅ Starting Agenda...");
  await import("./notifyJobs.js");
  console.log("✅ notifyJobs handlers registered");
  await import("./eventLiveNotifyJob.js");
  console.log("✅ eventLiveNotifyJob handler registered");

  // 🆕 logging tiện debug
  agenda.on("start", (job) => {
    console.log(`[agenda] ▶︎ ${job.attrs.name}`, job.attrs.data || {});
  });
  agenda.on("success", (job) => {
    console.log(`[agenda] ✓ ${job.attrs.name}`, {
      nextRunAt: job.attrs.nextRunAt,
      finished: job.attrs.lastFinishedAt,
    });
  });
  agenda.on("fail", (err, job) => {
    console.error(`[agenda] ✗ ${job?.attrs?.name}: ${err?.message}`);
  });

  await agenda.start();
  started = true;

  // 🆕 Auto-push khi giải bắt đầu LIVE trên kênh YouTube đã cấu hình (mỗi 5 phút).
  //    Job tự no-op nếu eventLive.autoNotify tắt. every() idempotent theo tên.
  try {
    await agenda.every("5 minutes", "event-live.auto-notify");
    console.log("✅ event-live.auto-notify scheduled (5m)");
  } catch (e) {
    console.error("[agenda] schedule event-live.auto-notify error:", e?.message);
  }

  // 🆕 graceful shutdown để release lock & đóng clean
  const shutdown = async (sig) => {
    try {
      console.log(`\n[agenda] Received ${sig}. Stopping...`);
      await agenda.stop();
    } catch (e) {
      console.error("[agenda] stop error:", e?.message);
    } finally {
      process.exit(0);
    }
  };

  if (!process.env.AGENDA_DISABLE_SIGNAL_HANDLERS) {
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }

  return agenda;
}

// 🆕 optional: cho phép dừng thủ công (test/unload)
export async function stopAgenda() {
  if (!started) return;
  await agenda.stop();
  started = false;
}
