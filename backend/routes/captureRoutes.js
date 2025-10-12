import express from "express";
import { captureService } from "../services/captureService.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Start capture session
router.post("/start", async (req, res) => {
  try {
    const { overlayUrl, streamKey, width, height, fps, videoBitrate } =
      req.body;

    if (!overlayUrl) {
      return res.status(400).json({ error: "overlayUrl is required" });
    }

    if (!streamKey) {
      return res.status(400).json({ error: "streamKey is required" });
    }

    const sessionId = uuidv4();

    const result = await captureService.startCapture(
      sessionId,
      overlayUrl,
      streamKey,
      {
        width: width || 1920,
        height: height || 1080,
        fps: fps || 30,
        videoBitrate: videoBitrate || "4000k",
      }
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Start capture error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stop capture session
router.post("/stop/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await captureService.stopCapture(sessionId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Stop capture error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get session status
router.get("/status/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = captureService.getSessionStatus(sessionId);

    res.json({
      success: true,
      sessionId,
      ...status,
    });
  } catch (error) {
    console.error("Get status error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// List all active sessions
router.get("/sessions", (req, res) => {
  try {
    const sessions = captureService.getAllSessions();

    res.json({
      success: true,
      sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error("List sessions error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stop all sessions
router.post("/stop-all", async (req, res) => {
  try {
    await captureService.stopAll();

    res.json({
      success: true,
      message: "All sessions stopped",
    });
  } catch (error) {
    console.error("Stop all error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
