import dotenv from "dotenv";
import express from "express";
import http from "http";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import connectDB from "./config/db.js";
import observerRoutes from "./routes/observerRoutes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.OBSERVER_PORT || process.env.PORT || 8787);
const host = String(process.env.OBSERVER_BIND_HOST || "127.0.0.1").trim() || "127.0.0.1";

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

app.get("/", (_req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "observer-dashboard", "index.html")
  );
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "pickletour-observer",
    port,
    host,
    now: new Date().toISOString(),
  });
});

app.use("/api/observer", observerRoutes);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: "Observer route not found",
    path: req.originalUrl || req.url || "",
  });
});

app.use((error, _req, res, _next) => {
  console.error("[observer] request error:", error);
  res.status(Number(error?.statusCode) || 500).json({
    ok: false,
    message: error?.message || "Observer server error",
  });
});

const server = http.createServer(app);

async function startObserverServer() {
  await connectDB();

  return server.listen(port, host, () => {
    console.log(`[observer] listening on http://${host}:${port}`);
  });
}

let activeServer = null;

let shutdownInFlight = false;

async function shutdown(signal) {
  if (shutdownInFlight) return;
  shutdownInFlight = true;

  console.log(`[observer] received ${signal}, shutting down...`);

  if (!activeServer?.listening) {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
    return;
  }

  await new Promise((resolve) => {
    activeServer.close(() => resolve());
  }).catch(() => {});

  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

startObserverServer()
  .then((serverInstance) => {
    activeServer = serverInstance;
  })
  .catch(async (error) => {
    console.error("[observer] failed to start:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
