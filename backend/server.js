import path from "path";
import express from "express";
import http from "http";
import connectDB from "./config/db.js";
import cookieParser from "cookie-parser";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import userRoutes from "./routes/userRoutes.js";
import tournamentRoute from "./routes/tournamentRoutes.js";
import registrationRoutes from "./routes/registrationRoutes.js";
import rankingRoutes from "./routes/rankingRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import refereeRoutes from "./routes/refereeRoutes.js";
import assessmentRoutes from "./routes/assessmentRoutes.js";
import overlayApiRoutes from "./routes/overlayApiRoutes.js";
import drawRoutes from "./routes/drawRoutes.js";
import bracketRoutes from "./routes/bracketRoutes.js";
import drawSettingsRoutes from "./routes/drawSettingsRoutes.js";
import progressionRoutes from "./routes/progressionRoutes.js";
import matchRoutes from "./routes/matchesRoutes.js";
import pushTokenRoutes from "./routes/pushTokenRoutes.js";
import subscriptionsRoutes from "./routes/subscriptionsRoutes.js";
import notifyRoutes from "./routes/notifyRoutes.js";
import cmsRoutes from "./routes/cmsRoutes.js";
import { initSocket } from "./socket/index.js";
import cors from "cors";
import dotenv from "dotenv";
import { startTournamentCrons } from "./jobs/tournamentCron.js";
import { agenda, startAgenda } from "./jobs/agenda.js";
import { initKycBot } from "./bot/telegramBot.js";
import { initEmail } from "./services/emailService.js";
import Agendash from "agendash";
import { versionGate } from "./middleware/versionGate.js";
import appVersionRouter from "./routes/appVersion.route.js";
import { attachJwtIfPresent } from "./middleware/authMiddleware.js";
import { maintainanceTrigger } from "./middleware/maintainance.js";
import sportconnectRoutes from "./routes/sportconnect.routes.js";
import telegramRoutes from "./routes/telegramRoutes.js";
import cccdRoutes from "./routes/cccd.routes.js";
import fileRoutes from "./routes/fileRoutes.js";
import FileAsset from "./models/fileAssetModel.js";
import { loadSettings } from "./middleware/settings.middleware.js";
import fs from "fs"

dotenv.config();
const port = process.env.PORT;
const WHITELIST = [
  "https://abcdk.vercel.app",
  "https://abcde-xi.vercel.app",
  "https://admin.pickletour.vn",
  "http://localhost:3001",
];

connectDB();

const app = express();

// body limit rộng hơn cho HTML/JSON dài
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.set("trust proxy", 1);
app.use("/admin/agendash", Agendash(agenda, { middleware: "express" }));

app.use(loadSettings);
app.use(attachJwtIfPresent);
app.use(maintainanceTrigger);
app.use(versionGate);

// HTTP + Socket.IO
const server = http.createServer(app);

// 👇 Khởi tạo socket tách riêng
const io = initSocket(server, { whitelist: WHITELIST, path: "/socket.io" });

// Cho controllers dùng io: req.app.get('io')
app.set("io", io);
// app.set("trust proxy", true);

// CORS whitelist

app.use(
  cors({
    origin: WHITELIST, // ✅ KHÔNG dùng '*'
    credentials: true, // ✅ Phải bật
  })
);
app.use("/uploads", express.static("uploads"));
app.use("/api/users", userRoutes);
app.use("/api/tournaments", tournamentRoute);
app.use("/api/brackets", bracketRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/rankings", rankingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/referee", refereeRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/overlay", overlayApiRoutes);
app.use("/api/draw", drawRoutes);
app.use("/api/d", drawSettingsRoutes);
app.use("/api/progression", progressionRoutes);
app.use("/api/cms", cmsRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/push", pushTokenRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/events", notifyRoutes);
app.use("/api/app", appVersionRouter);
app.use("/api/telegram", telegramRoutes);
app.use("/api/sportconnect", sportconnectRoutes);
app.use("/api/cccd", cccdRoutes);
app.use("/api/files", fileRoutes);

// Public download by id -> always attachment with original filename
app.get("/dl/file/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await FileAsset.findById(id);
    if (!doc) return res.status(404).send("File không tồn tại");

    if (!doc.isPublic) return res.status(403).send("File chưa public");

    const filePath = doc.path || path.resolve("uploads/public", doc.fileName);
    if (!fs.existsSync(filePath))
      return res.status(404).send("Không tìm thấy file trên máy chủ");

    // Force download with the original file name
    res.download(filePath, doc.originalName || doc.fileName);
  } catch (e) {
    console.error("/dl/file error", e);
    res.status(500).send("Lỗi tải file");
  }
});

if (process.env.NODE_ENV === "production") {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, "/frontend/dist")));

  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname, "frontend", "dist", "index.html"))
  );
} else {
  app.get("/", (req, res) => {
    res.send("API is running....");
  });
}

app.use(notFound);
app.use(errorHandler);

if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    console.log("✅ Running KYC bot...");
    initKycBot(app); // polling
  } catch (error) {
    console.log("❌ Failed to start KYC bot:", error.message);
  }
}

server.listen(port, async () => {
  try {
    console.log(`✅ Server started on port ${port}`);
    startTournamentCrons();
    initEmail();
    await startAgenda();
  } catch (error) {
    console.error(`❌ Error starting server: ${error.message}`);
  }
});
