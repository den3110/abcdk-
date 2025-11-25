// routes/liveRecordingRoutes.js
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { getRecordingByMatch } from "../controllers/liveRecordingController.js";
import LiveRecording from "../models/liveRecordingModel.js";
import LiveRecordingChunk from "../models/liveRecordingChunkModel.js";

const router = express.Router();

const UPLOAD_SERVICE_URL = process.env.UPLOAD_SERVICE_URL || "http://127.0.0.1:8004";

// ✅ Helper: Parse bool từ string
const toBool = (v, def = false) => {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
};

// ✅ Helper: Update MongoDB async (không block response)
async function updateMongoDBAsync(reqBody, goData) {
  try {
    const { matchId, chunkIndex, isFinal } = reqBody;
    const idx = Number(chunkIndex ?? 0);
    const isFinalBool = toBool(isFinal, false);
    
    console.log(`💾 [MongoDB] Updating: match=${matchId}, chunk=${idx}`);

    // Validate matchId
    let matchObjectId = matchId;
    try {
      matchObjectId = matchId.match(/^[0-9a-fA-F]{24}$/) ? matchId : null;
    } catch (_) {
      matchObjectId = null;
    }

    // Find or create LiveRecording
    let recording = await LiveRecording.findOne({
      match: matchObjectId ?? matchId,
    });

    if (!recording) {
      recording = await LiveRecording.create({
        match: matchObjectId ?? matchId,
        status: "recording",
      });
      console.log(`📝 [MongoDB] Created recording: ${recording._id}`);
    }

    // Upsert chunk
    const chunkDoc = await LiveRecordingChunk.findOneAndUpdate(
      { recording: recording._id, match: recording.match, chunkIndex: idx },
      {
        $set: {
          filePath: goData.filePath,
          fileSizeBytes: goData.fileSizeBytes,
          fileSizeMB: goData.fileSizeMB,
          isFinal: isFinalBool,
          status: "uploaded",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`💾 [MongoDB] Chunk saved: ${chunkDoc._id}`);

    // Aggregate total stats
    const agg = await LiveRecordingChunk.aggregate([
      { $match: { recording: recording._id } },
      {
        $group: {
          _id: "$recording",
          totalChunks: { $max: "$chunkIndex" },
          countChunks: { $sum: 1 },
          totalSizeBytes: { $sum: "$fileSizeBytes" },
        },
      },
    ]);

    if (agg[0]) {
      recording.totalChunks = agg[0].countChunks;
      recording.totalSizeMB = agg[0].totalSizeBytes / (1024 * 1024);
    }

    if (isFinalBool) {
      recording.hasFinalChunk = true;
      recording.status = "merging";
      console.log(`🏁 [MongoDB] Final chunk for match ${matchId}`);
    }

    await recording.save();

    console.log(
      `✅ [MongoDB] Updated: match=${matchId}, total=${recording.totalChunks} chunks, ${recording.totalSizeMB.toFixed(2)}MB`
    );
  } catch (err) {
    console.error("❌ [MongoDB] Update failed:", err.message);
    // Không throw - MongoDB update failure không nên fail upload
  }
}

// ✅ PROXY UPLOAD TRỰC TIẾP SANG GO SERVICE
router.post(
  "/chunk",
  createProxyMiddleware({
    target: UPLOAD_SERVICE_URL,
    changeOrigin: true,
    
    // Rewrite path: /api/live/recordings/chunk → /save-chunk
    pathRewrite: {
      "^/api/live/recordings/chunk": "/save-chunk",
    },

    // Timeout config
    proxyTimeout: 90000, // 90s
    timeout: 90000,

    // Request logging
    onProxyReq: (proxyReq, req, res) => {
      const matchId = req.body?.matchId || "unknown";
      const chunkIndex = req.body?.chunkIndex || "0";
      console.log(`📤 [Proxy] Uploading: match=${matchId}, chunk=${chunkIndex}`);
    },

    // Intercept response để update MongoDB
    onProxyRes: (proxyRes, req, res) => {
      let body = "";

      // Collect response data
      proxyRes.on("data", (chunk) => {
        body += chunk.toString();
      });

      proxyRes.on("end", () => {
        try {
          const goData = JSON.parse(body);

          if (goData.ok) {
            console.log(
              `✅ [Proxy] Go saved: ${goData.filePath} (${goData.fileSizeMB?.toFixed(2)}MB)`
            );

            // ✅ Update MongoDB ASYNC - không block response
            updateMongoDBAsync(req.body, goData).catch((err) => {
              console.error("❌ [Proxy] MongoDB update error (non-blocking):", err.message);
            });
          } else {
            console.warn("⚠️ [Proxy] Go response not OK:", goData);
          }
        } catch (parseErr) {
          console.error("❌ [Proxy] Parse Go response failed:", parseErr.message);
        }
      });
    },

    // Error handling
    onError: (err, req, res) => {
      console.error("❌ [Proxy] Error:", err.message);
      
      // Check if response already sent
      if (res.headersSent) {
        return;
      }

      res.status(503).json({
        message: "Upload service unavailable",
        error: err.message,
        service: UPLOAD_SERVICE_URL,
      });
    },
  })
);

// ✅ GET recording by matchId (giữ nguyên)
router.get("/by-match/:matchId", getRecordingByMatch);

export default router;