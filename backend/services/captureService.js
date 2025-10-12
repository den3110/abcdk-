import puppeteer from "puppeteer";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

class CaptureService {
  constructor() {
    this.activeSessions = new Map(); // sessionId -> { browser, page, ffmpeg }
  }

  async startCapture(sessionId, overlayUrl, streamKey, options = {}) {
    if (this.activeSessions.has(sessionId)) {
      throw new Error("Session already active");
    }

    const {
      width = 1920,
      height = 1080,
      fps = 30,
      videoBitrate = "4000k",
    } = options;

    console.log(`🎬 Starting capture session: ${sessionId}`);
    console.log(`📺 Overlay URL: ${overlayUrl}`);

    // Launch browser
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", // đường dẫn Chrome của anh
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Navigate to overlay
    console.log("🌐 Loading overlay page...");
    await page.goto(overlayUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    console.log("✅ Overlay loaded");

    // Start FFmpeg process
    const rtmpsUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${streamKey}`;
    console.log(`🎥 Starting FFmpeg to: ${rtmpsUrl}`);

    const ffmpegProcess = spawn(ffmpegStatic, [
      // Input: raw video from stdin
      "-f",
      "image2pipe",
      "-framerate",
      fps.toString(),
      "-i",
      "pipe:0",

      // Video encoding
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-maxrate",
      videoBitrate,
      "-bufsize",
      "8000k",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "60",
      "-keyint_min",
      "60",

      // No audio for now (can add later)
      "-an",

      // Output
      "-f",
      "flv",
      rtmpsUrl,
    ]);

    ffmpegProcess.stderr.on("data", (data) => {
      const log = data.toString();
      if (log.includes("frame=")) {
        console.log(`FFmpeg: ${log.trim()}`);
      }
    });

    ffmpegProcess.on("error", (error) => {
      console.error("❌ FFmpeg error:", error);
    });

    ffmpegProcess.on("close", (code) => {
      console.log(`FFmpeg exited with code ${code}`);
    });

    // Capture loop
    const intervalMs = Math.floor(1000 / fps);
    let frameCount = 0;

    const captureInterval = setInterval(async () => {
      try {
        const screenshot = await page.screenshot({
          type: "jpeg",
          quality: 90,
          encoding: "binary",
        });

        if (ffmpegProcess.stdin.writable) {
          ffmpegProcess.stdin.write(screenshot);
          frameCount++;

          if (frameCount % (fps * 5) === 0) {
            console.log(`📸 Captured ${frameCount} frames`);
          }
        }
      } catch (err) {
        console.error("Screenshot error:", err);
      }
    }, intervalMs);

    // Store session
    this.activeSessions.set(sessionId, {
      browser,
      page,
      ffmpegProcess,
      captureInterval,
      startTime: Date.now(),
    });

    console.log(`✅ Capture session started: ${sessionId}`);

    return {
      sessionId,
      status: "started",
      overlayUrl,
    };
  }

  async stopCapture(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    console.log(`🛑 Stopping capture session: ${sessionId}`);

    // Stop capture interval
    if (session.captureInterval) {
      clearInterval(session.captureInterval);
    }

    // Close FFmpeg
    if (session.ffmpegProcess) {
      session.ffmpegProcess.stdin.end();
      session.ffmpegProcess.kill("SIGTERM");

      setTimeout(() => {
        if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
          session.ffmpegProcess.kill("SIGKILL");
        }
      }, 5000);
    }

    // Close browser
    if (session.browser) {
      await session.browser.close();
    }

    this.activeSessions.delete(sessionId);

    const duration = Math.floor((Date.now() - session.startTime) / 1000);
    console.log(`✅ Session stopped. Duration: ${duration}s`);

    return {
      sessionId,
      status: "stopped",
      duration,
    };
  }

  getSessionStatus(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { status: "not_found" };
    }

    return {
      status: "active",
      duration: Math.floor((Date.now() - session.startTime) / 1000),
    };
  }

  getAllSessions() {
    return Array.from(this.activeSessions.keys());
  }

  async stopAll() {
    console.log("🧹 Stopping all capture sessions...");
    const sessions = Array.from(this.activeSessions.keys());
    for (const sessionId of sessions) {
      try {
        await this.stopCapture(sessionId);
      } catch (err) {
        console.error(`Error stopping session ${sessionId}:`, err);
      }
    }
  }
}

// Singleton instance
export const captureService = new CaptureService();

// Cleanup on process exit
process.on("SIGINT", async () => {
  await captureService.stopAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await captureService.stopAll();
  process.exit(0);
});
