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

import { initSocket } from "./socket/index.js";
import cors from "cors";
import dotenv from "dotenv";
import { startTournamentCrons } from "./jobs/tournamentCron.js";
dotenv.config();
const port = process.env.PORT || 5000;
const WHITELIST = [
  "https://abcdk.vercel.app",
  "https://abcde-xi.vercel.app",
  "https://admin.pickletour.vn",
  "http://localhost:3001",
];

connectDB();

const app = express();
// HTTP + Socket.IO
const server = http.createServer(app);

// 👇 Khởi tạo socket tách riêng
const io = initSocket(server, { whitelist: WHITELIST, path: "/socket.io" });

// Cho controllers dùng io: req.app.get('io')
app.set("io", io);
// app.set("trust proxy", true);

// body limit rộng hơn cho HTML/JSON dài
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
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
app.use("/api/registrations", registrationRoutes);
app.use("/api/rankings", rankingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/referee", refereeRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/overlay", overlayApiRoutes);

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

server.listen(port, () => {
  try {
    console.log(`✅ Server started on port ${port}`);
    startTournamentCrons();
  } catch (error) {
    console.error(`❌ Error starting server: ${error.message}`);
  }
});
