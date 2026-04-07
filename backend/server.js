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
import azureAdminRoutes from "./routes/azureAdminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import refereeRoutes from "./routes/refereeRoutes.js";
import assessmentRoutes from "./routes/assessmentRoutes.js";
import overlayApiRoutes from "./routes/overlayApiRoutes.js";
import drawRoutes from "./routes/drawRoutes.js";
import bracketRoutes from "./routes/bracketRoutes.js";
import drawSettingsRoutes from "./routes/drawSettingsRoutes.js";
import progressionRoutes from "./routes/progressionRoutes.js";
import matchRoutes from "./routes/matchesRoutes.js";
import liveAppRoutes from "./routes/liveAppRoutes.js";
import pushTokenRoutes from "./routes/pushTokenRoutes.js";
import subscriptionsRoutes from "./routes/subscriptionsRoutes.js";
import notifyRoutes from "./routes/notifyRoutes.js";
import cmsRoutes from "./routes/cmsRoutes.js";
import { initSocket } from "./socket/index.js";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { startTournamentCrons } from "./jobs/tournamentCron.js";
import { agenda, startAgenda } from "./jobs/agenda.js";
import { initKycBot } from "./bot/telegramBot.js";
import { initEmail } from "./services/emailService.js";
import Agendash from "agendash";
import { versionGate } from "./middleware/versionGate.js";
import appVersionRouter from "./routes/appVersion.route.js";
import chatBotRoutes from "./routes/chatBotRoutes.js";

import {
  attachJwtIfPresent,
  authorize,
  protect,
} from "./middleware/authMiddleware.js";
import { maintainanceTrigger } from "./middleware/maintainance.js";
import sportconnectRoutes from "./routes/sportconnect.routes.js";
import telegramRoutes from "./routes/telegramRoutes.js";
import cccdRoutes from "./routes/cccd.routes.js";
import fileRoutes from "./routes/fileRoutes.js";
import aiTtsAdapterRoutes from "./routes/aiTtsAdapterRoutes.js";
import FileAsset from "./models/fileAssetModel.js";
import { loadSettings } from "./middleware/settings.middleware.js";
import clubRoutes from "./routes/clubRoutes.js";
import captureRoutes from "./routes/captureRoutes.js";
import { startFbRefreshCron } from "./jobs/fbRefreshCron.js";
import adminSponsorRoutes from "./routes/adminSponsorRoutes.js";
import publicSponsorRoutes from "./routes/publicSponsorRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import liveRoutes from "./routes/live.routes.js";
import courtRoutes from "./routes/courtRoutes.js";
import spcRoutes from "./routes/spc.routes.js";
import fbTokenRoutes from "./routes/fbTokenRoutes.js";
import publicOverlayRoutes from "./routes/publicOverlayRoutes.js";
import publicHomeRoutes from "./routes/publicHomeRoutes.js";
import newsRoutes from "./routes/newsPublicRoutes.js";
import seoNewsRoutes from "./routes/seoNewsPublicRoutes.js";
import appInitRoutes from "./routes/appInitRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";
import scheduleRoutes from "./routes/scheduleRoutes.js";
import liveRecordingRoutes from "./routes/liveRecordingRoutes.js";
import liveRecordingV2Routes from "./routes/liveRecordingV2Routes.js";
import facebookRoutes from "./routes/facebookRoutes.js";
import userMatchRoutes from "./routes/userMatchRoutes.js";
import { startFacebookBusyCron } from "./services/facebookPagePool.service.js";
import { startLiveSessionLeaseCron } from "./services/liveSessionLease.service.js";
import { startCourtLivePresenceSweep } from "./services/courtLivePresence.service.js";
import { startUserAvatarOptimizationCron } from "./jobs/userAvatarOptimizationCron.js";
import { initNewsCron } from "./jobs/newsCron.js";
import { initSeoNewsCron } from "./jobs/seoNewsCron.js";
import { startOptimizedImageCleanupCron } from "./jobs/optimizedImageCleanupCron.js";
import { startSeoNewsImageRegenerationWorker } from "./services/seoNewsImageQueue.service.js";
import { startSeoNewsPipelineWorker } from "./services/seoNewsPipelineQueue.service.js";
import { startLiveRecordingAiCommentaryWorker } from "./services/liveRecordingAiCommentaryQueue.service.js";
import { startLiveRecordingAutoExportSweep } from "./services/liveRecordingMonitor.service.js";
// 🔹 GraphQL layer
import { setupGraphQL } from "./graphql/index.js";
import { timezoneMiddleware } from "./middleware/timezoneMiddleware.js";
import { normalizeRequestDates } from "./middleware/normalizeRequestDates.js";
import { convertResponseDates } from "./middleware/convertResponseDates.js";
import { prerenderMiddleware } from "./middleware/prerender.middleware.js";
import { createProxyMiddleware } from "http-proxy-middleware";
import { registerAutoHealJobs } from "./utils/scheduleNotifications.js";
import weatherRoutes from "./routes/weatherRoutes.js";
import Tournament from "./models/tournamentModel.js";
import radarRoutes from "./routes/radarRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import slackEventsRoutes from "./routes/slackEventsRoutes.js";
import sentryRoutes from "./routes/sentryRoutes.js";
import head2headRoutes from "./routes/head2headRoutes.js";
import otaRoutes from "./routes/otaRoutes.js";
import expoUpdatesRoutes from "./routes/expoUpdatesRoutes.js";
import openaiRoutes from "./routes/openaiRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import commandPaletteRoutes from "./routes/commandPaletteRoutes.js";
import voiceRoutes from "./routes/voiceRoutes.js";
import Match from "./models/matchModel.js";
import { httpLogger } from "./middleware/httpLogger.js";
import { loadLiveMultiSourceConfig } from "./services/liveMultiSourceConfig.service.js";
import { loadLiveRecordingStorageTargetsConfig } from "./services/liveRecordingStorageTargetsConfig.service.js";

dotenv.config();
const port = process.env.PORT;
const WHITELIST = [
  "https://abcdk.vercel.app",
  "https://abcde-xi.vercel.app",
  "https://admin.pickletour.vn",
  "http://localhost:3001",
  "http://localhost:3000",
  "https://pickletour.vn",
];

// connectDB(); // ❌ Moved inside startServer for async await for async await

const app = express();

// Security headers - chặn Clickjacking, XSS, MIME sniffing, etc.
app.use(
  helmet({
    crossOriginResourcePolicy: false, // tắt mặc định same-origin
  }),
);

app.use(
  cors({
    origin: WHITELIST, // ✅ KHÔNG dùng '*'
    credentials: true, // ✅ Phải bật
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use(httpLogger);

app.use(
  "/api/admin/system",
  protect,
  authorize("admin"),
  createProxyMiddleware({
    target: "http://127.0.0.1:8003/api/admin/system", // ❌ Bỏ phần /api/admin/system ở target
    changeOrigin: true,

    pathRewrite: {
      "^/api/admin/system": "/api/admin/system", // ✅ Giữ nguyên hoặc map sang path Go service expect
    },
    onProxyReq: (proxyReq, req, res) => {
      if (req.body && Object.keys(req.body).length > 0) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader("Content-Type", "application/json");
        proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      }
    },
    onError: (err, req, res) => {
      console.error("❌ Proxy error:", err);
      res.status(500).json({ error: "Go service unavailable" });
    },
  }),
);
app.use("/api/live/recordings", liveRecordingRoutes);
app.use("/api/live/recordings/v2", liveRecordingV2Routes);

// body limit rộng hơn cho HTML/JSON dài
app.use(timezoneMiddleware);
app.use(normalizeRequestDates);
app.use(convertResponseDates);

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

// giữ như bạn đang làm, nhưng set thêm CORS nếu cần
app.use(
  "/uploads",
  express.static("uploads", {
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // hoặc same-site
      res.setHeader("Access-Control-Allow-Origin", "*"); // optional
    },
  }),
);
app.use("/api/users", userRoutes);
app.use("/api/tournaments", tournamentRoute);
app.use("/api/brackets", bracketRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/rankings", rankingRoutes);
app.use("/api/v1/rankings", rankingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/azure", azureAdminRoutes);
app.use("/api/setting", adminRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/referee", refereeRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/overlay", overlayApiRoutes);
app.use("/api/draw", drawRoutes);
app.use("/api/d", drawSettingsRoutes);
app.use("/api/progression", progressionRoutes);
app.use("/api/cms", cmsRoutes);
app.use("/api/live-app", liveAppRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/push", pushTokenRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/events", notifyRoutes);
app.use("/api/app", appVersionRouter);
app.use("/api/telegram", telegramRoutes);
app.use("/api/sportconnect", sportconnectRoutes);
app.use("/api/cccd", cccdRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/ai-tts/v1", aiTtsAdapterRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/capture", captureRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/seo-news", seoNewsRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/admin/sponsors", adminSponsorRoutes);
app.use("/api/sponsors", publicSponsorRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/courts", courtRoutes);
app.use("/api/admin/spc", spcRoutes);
app.use("/api/public", publicOverlayRoutes);
app.use("/api/public", publicHomeRoutes);
app.use("/api/fb-tokens", fbTokenRoutes);
app.use("/api/app/init", appInitRoutes);
app.use("/api/leaderboards", leaderboardRoutes);
app.use("/api/schedule", scheduleRoutes);
app.use("/api/fb", facebookRoutes);
app.use("/api/chat", chatBotRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/user-matches", userMatchRoutes);
app.use("/api/radar", radarRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/slack", slackEventsRoutes);
app.use("/api/sentry", sentryRoutes);
app.use("/api/head2head", head2headRoutes);
app.use("/api/ota", otaRoutes);
app.use("/api/expo-updates", expoUpdatesRoutes);
app.use("/api/openai", openaiRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/command-palette", commandPaletteRoutes);

// ===== Geo proxy for language detection (avoids browser CORS issues) =====
const geoCache = new Map();
const GEO_CACHE_TTL = 60 * 60 * 1000; // 1 hour
app.get("/api/geo", async (req, res) => {
  try {
    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "";
    // Determine if IP is local/private (dev mode)
    const isLocal =
      !clientIp ||
      /^(127\.|::1|::ffff:127\.|localhost|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(
        clientIp,
      );
    // Use the client IP for production, omit for local (auto-detect server public IP)
    const lookupUrl = isLocal
      ? "https://api.country.is/"
      : `https://api.country.is/${clientIp}`;
    // Return cached result
    const cacheKey = isLocal ? "__local__" : clientIp;
    const cached = geoCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < GEO_CACHE_TTL) {
      return res.json({ country: cached.country, cached: true });
    }
    // Query external API server-side (no CORS issue)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const geoRes = await fetch(lookupUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!geoRes.ok) throw new Error(`geo status ${geoRes.status}`);
    const data = await geoRes.json();
    const country = data?.country || "UNKNOWN";
    geoCache.set(cacheKey, { country, ts: Date.now() });
    res.json({ country });
  } catch {
    res.json({ country: "UNKNOWN" });
  }
});

app.get("/dl/file/:id", async (req, res) => {
  try {
    const doc = await FileAsset.findById(req.params.id);
    if (!doc) return res.status(404).send("File không tồn tại");

    // Tên file hiển thị khi tải về
    const downloadName = doc.originalName || doc.fileName || "download.bin";

    // Header nội dung + ép tải
    res.setHeader("Content-Type", doc.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(downloadName)}"`,
    );

    // Chuyển nội bộ cho Nginx đọc file từ đĩa (KHÔNG qua Node)
    // "fileName" là tên đã lưu trong uploads/public
    const accelPath = `/_protected_uploads/${encodeURIComponent(doc.fileName)}`;
    res.setHeader("X-Accel-Redirect", accelPath);

    // (tuỳ chọn) cho resume/caching
    res.setHeader("Accept-Ranges", "bytes");

    res.end();
  } catch (e) {
    console.error("/dl/file error", e);
    res.status(500).send("Lỗi tải file");
  }
});

// 🔹 gom phần start server + GraphQL vào 1 hàm async
const startServer = async () => {
  try {
    // 🔹 Connect DB first
    await connectDB();
    await loadLiveMultiSourceConfig();
    await loadLiveRecordingStorageTargetsConfig();

    // 🔹 mount GraphQL trước fallback routes (*)
    await setupGraphQL(app);

    // if (process.env.NODE_ENV === "production") {
    //   const __dirname = path.resolve();
    //   app.use(prerenderMiddleware);
    //   // Fix: serve from sibling frontend directory
    //   app.use(express.static(path.join(__dirname, "../frontend/dist")));

    //   app.get("*", (req, res) =>
    //     res.sendFile(
    //       path.resolve(__dirname, "../frontend", "dist", "index.html")
    //     )
    //   );
    // } else {
    //   // app.get("/", (req, res) => {
    //   //   res.send("API is running....");
    //   // });
    // }
    // Test endpoint để kiểm tra server có chạy không (đặt sau GraphQL để không bị chặn)
    app.get("/", (req, res) => {
      res.send("API is running....");
    });

    app.use(notFound);
    app.use(errorHandler);

    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        console.log("✅ Running KYC bot...");
        initKycBot(app)
          .then((bot) => {
            if (bot) {
              console.log("✅ KYC bot initialized successfully");
            } else {
              console.warn("⚠️ĩ KYC bot returned null");
            }
          })
          .catch((e) => {
            console.error("❌ KYC bot initialization failed:");
            console.error("Error name:", e?.name);
            console.error("Error message:", e?.message);
            console.error("Error stack:", e?.stack);
          });
      } catch (error) {
        console.log("❌ Failed to start KYC bot:", error.message);
      }
    }

    server.listen(port, "0.0.0.0", async () => {
      try {
        console.log(`✅ Server started on port ${port}`);
        startTournamentCrons();
        startFbRefreshCron();
        startFacebookBusyCron();
        startLiveSessionLeaseCron();
        startCourtLivePresenceSweep();
        startLiveRecordingAutoExportSweep();
        startUserAvatarOptimizationCron();
        startOptimizedImageCleanupCron();
        startSeoNewsImageRegenerationWorker();
        startSeoNewsPipelineWorker();
        startLiveRecordingAiCommentaryWorker();
        initEmail();
        initNewsCron();
        initSeoNewsCron();
        initEmail();
        initNewsCron();
        await startAgenda(); // ✅ Await agenda start
        registerAutoHealJobs({ Tournament, Match });
      } catch (error) {
        console.error(`❌ Error starting server: ${error.message}`);
      }
    });
  } catch (err) {
    console.error("❌ Failed to start server", err);
    process.exit(1);
  }
};

startServer();
