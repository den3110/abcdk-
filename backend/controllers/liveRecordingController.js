// controllers/liveRecordingController.js
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import LiveRecording from "../models/liveRecordingModel.js";
import LiveRecordingChunk from "../models/liveRecordingChunkModel.js";
import Match from "../models/matchModel.js";

const __dirname = path.resolve();

// ✅ Go upload service URL
const UPLOAD_SERVICE_URL = process.env.UPLOAD_SERVICE_URL || "http://127.0.0.1:8004";

// helper: parse bool từ string
const toBool = (v, def = false) => {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
};

export const uploadChunk = async (req, res, next) => {
  let tempFilePath = null; // Track temp file để cleanup
  
  try {
    // file do multer gắn vào (temp file in /tmp)
    const file = req.file;
    const {
      matchId,
      chunkIndex,   
      isFinal,
      fileSizeMB: fileSizeMBBody,
    } = req.body;

    if (!matchId) {
      return res.status(400).json({ message: "matchId is required" });
    }
    if (!file) {
      return res.status(400).json({ message: "file is required" });
    }

    tempFilePath = file.path; // Save for cleanup
    const idx = Number(chunkIndex ?? 0);
    const isFinalBool = toBool(isFinal, false);

    console.log(`📤 [Upload] match=${matchId}, chunk=${idx}, size=${(file.size / 1024 / 1024).toFixed(2)}MB`);

    // ✅ GỬI FILE SANG GO SERVICE
    const formData = new FormData();
    formData.append("file", fs.createReadStream(file.path));
    formData.append("matchId", matchId);
    formData.append("chunkIndex", String(idx));
    formData.append("isFinal", isFinalBool ? "1" : "0");

    let goResponse;
    try {
      goResponse = await axios.post(
        `${UPLOAD_SERVICE_URL}/save-chunk`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 60000, // 60s timeout
        }
      );
    } catch (goErr) {
      console.error("❌ [Upload] Go service error:", goErr.message);
      
      // ✅ Cleanup temp file
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {}
      
      return res.status(500).json({
        message: "Upload to Go service failed",
        error: goErr.response?.data || goErr.message,
      });
    }

    const goData = goResponse.data;
    console.log(`✅ [Upload] Go saved: ${goData.filePath} (${goData.fileSizeMB.toFixed(2)}MB in ${goData.durationMs}ms)`);

    // ✅ XÓA FILE TẠM (multer đã lưu vào /tmp)
    try {
      fs.unlinkSync(tempFilePath);
      console.log(`🗑️ [Upload] Temp file deleted: ${tempFilePath}`);
    } catch (delErr) {
      console.warn(`⚠️ [Upload] Cannot delete temp file: ${tempFilePath}`, delErr.message);
    }

    // ✅ NODE.JS TIẾP TỤC XỬ LÝ MONGODB (LOGIC CŨ)
    
    // ensure matchId là ObjectId hợp lệ
    let matchObjectId = matchId;
    try {
      matchObjectId = matchId.match(/^[0-9a-fA-F]{24}$/)
        ? matchId
        : null;
    } catch (_) {
      matchObjectId = null;
    }

    // tạo / tìm LiveRecording cho match
    let recording = await LiveRecording.findOne({
      match: matchObjectId ?? matchId,
    });

    if (!recording) {
      recording = await LiveRecording.create({
        match: matchObjectId ?? matchId,
        status: "recording",
      });
      console.log(`📝 [Upload] Created recording doc: ${recording._id}`);
    }

    // ✅ DÙNG DATA TỪ GO SERVICE
    const filePath = goData.filePath;
    const fileSizeBytes = goData.fileSizeBytes;
    const fileSizeMB = goData.fileSizeMB;

    // upsert chunk (nếu chunkIndex trùng thì cập nhật path)
    const chunkDoc = await LiveRecordingChunk.findOneAndUpdate(
      { recording: recording._id, match: recording.match, chunkIndex: idx },
      {
        $set: {
          filePath,
          fileSizeBytes,
          fileSizeMB,
          isFinal: isFinalBool,
          status: "uploaded",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`💾 [Upload] Chunk saved to DB: ${chunkDoc._id}`);

    // cập nhật tổng số chunk + size trên LiveRecording
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
      console.log(`🏁 [Upload] Final chunk received for match ${matchId}`);
    }

    await recording.save();

    console.log(`✅ [Upload] Complete: match=${matchId}, chunk=${idx}, total=${recording.totalChunks} chunks, ${recording.totalSizeMB.toFixed(2)}MB`);

    return res.status(200).json({
      ok: true,
      recordingId: recording._id,
      matchId: recording.match,
      chunk: {
        id: chunkDoc._id,
        chunkIndex: chunkDoc.chunkIndex,
        isFinal: chunkDoc.isFinal,
        filePath: chunkDoc.filePath,
        fileSizeMB: chunkDoc.fileSizeMB,
      },
      recording: {
        totalChunks: recording.totalChunks,
        totalSizeMB: recording.totalSizeMB,
        status: recording.status,
        hasFinalChunk: recording.hasFinalChunk,
      },
    });
  } catch (err) {
    console.error("❌ [Upload] Controller error:", err);
    
    // ✅ Cleanup temp file nếu còn
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {}
    }
    
    return res.status(500).json({
      message: "Upload chunk failed",
      error: err.message || String(err),
    });
  }
};

// debug: lấy list chunk theo matchId
export const getRecordingByMatch = async (req, res) => {
  try {
    const { matchId } = req.params;
    if (!matchId) {
      return res.status(400).json({ message: "matchId is required" });
    }

    const recording = await LiveRecording.findOne({
      match: matchId,
    }).lean();

    if (!recording) {
      return res.status(404).json({ message: "No recording for this match" });
    }

    const chunks = await LiveRecordingChunk.find({
      recording: recording._id,
    })
      .sort({ chunkIndex: 1 })
      .lean();

    return res.json({
      recording,
      chunks,
    });
  } catch (err) {
    console.error("getRecordingByMatch error", err);
    return res.status(500).json({
      message: "Get recording failed",
      error: err.message || String(err),
    });
  }
};