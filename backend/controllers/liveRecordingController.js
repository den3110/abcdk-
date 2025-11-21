// controllers/liveRecordingController.js
import fs from "fs";
import path from "path";
import LiveRecording from "../models/liveRecordingModel.js";
import LiveRecordingChunk from "../models/liveRecordingChunkModel.js";
import Match from "../models/matchModel.js";

const __dirname = path.resolve();

// helper: parse bool từ string
const toBool = (v, def = false) => {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(s);
};

export const uploadChunk = async (req, res, next) => {
  try {
    // file do multer gắn vào
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

    const idx = Number(chunkIndex ?? 0);
    const isFinalBool = toBool(isFinal, false);

    // ensure matchId là ObjectId hợp lệ (nếu sai vẫn cho qua nhưng không populate được)
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
    }

    const filePath = file.path.replace(/\\/g, "/");
    const fileSizeBytes = file.size || 0;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);

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
      recording.totalSizeMB =
        agg[0].totalSizeBytes / (1024 * 1024);
    }

    if (isFinalBool) {
      recording.hasFinalChunk = true;
      // tuỳ bạn: có thể chuyển trạng thái sang "merging" để worker xử lý
      recording.status = "merging";
    }

    await recording.save();

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
    console.error("uploadChunk error", err);
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
