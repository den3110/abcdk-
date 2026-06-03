// controllers/cccd.controller.js
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { createCanvas, loadImage } from "canvas";
import jsQR from "jsqr";
import os from "os";
import crypto from "crypto";
import { parseQRPayload, mapQRToFields } from "../utils/cccdParsing.js";
import { CLAUDE_CCCD_MODEL } from "../lib/anthropicClient.js";
import { openaiExtractFromDataUrl } from "../services/telegram/telegramNotifyKyc.js";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const QUEUE_NAME = process.env.CCCD_QUEUE_NAME || "cccd-ocr";

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ yêu cầu
  // enableReadyCheck: false, // mở nếu Redis managed có ready check chậm
});
const queue = new Queue(QUEUE_NAME, { connection });

/* ===== Helpers ===== */
async function decodeQR(buffer) {
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
  const code = jsQR(data, width, height);
  return code?.data || null;
}

async function writeTmp(buffer, ext = ".jpg") {
  const fname = `cccd_${crypto.randomUUID()}${ext || ".jpg"}`;
  const tmpPath = path.join(os.tmpdir(), fname);
  await fs.writeFile(tmpPath, buffer);
  return tmpPath;
}

/* ===== Controllers ===== */
export async function extractCCCD(req, res) {
  if (!req.file) return res.status(400).json({ message: "Thiếu file ảnh" });

  try {
    // 1) Thử QR trước (nhanh, nhẹ)
    try {
      const qrRaw = await decodeQR(req.file.buffer);
      if (qrRaw) {
        const fields = mapQRToFields(parseQRPayload(qrRaw));
        if (fields.fullName || fields.dob || fields.hometown) {
          return res.json({
            source: "qr",
            payload: qrRaw,
            ...fields,
            queued: false,
          });
        }
      }
    } catch {
      // bỏ qua, fallback OCR
    }

    // 2) Đưa vào hàng đợi OCR (nặng)
    const tmpPath = await writeTmp(
      req.file.buffer,
      path.extname(req.file.originalname || ".jpg"),
    );

    const job = await queue.add(
      "cccd_ocr",
      { tmpPath },
      {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 3600, count: 1000 },
        attempts: 2,
        backoff: { type: "exponential", delay: 1000 },
      },
    );

    return res.status(202).json({
      message: "Đã đưa vào hàng đợi OCR",
      jobId: job.id,
      statusUrl: `/api/cccd/result/${job.id}`,
      queued: true,
    });
  } catch (err) {
    console.error("[cccd] extract error:", err);
    return res
      .status(500)
      .json({ message: "Lỗi xử lý", error: String(err?.message || err) });
  }
}

export async function getCCCDResult(req, res) {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Không tìm thấy job" });

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    if (state === "completed") {
      const result = await job.returnvalue;
      return res.json({ state, result });
    }
    if (state === "failed") {
      return res
        .status(500)
        .json({ state, reason: job.failedReason || "Job failed" });
    }
    return res.json({ state });
  } catch (err) {
    console.error("[cccd] result error:", err);
    return res
      .status(500)
      .json({ message: "Lỗi đọc kết quả", error: String(err?.message || err) });
  }
}

function normalizeDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return s;
  const d = +m[1],
    mo = +m[2],
    y = +m[3];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return s;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function extractCCCDOpenAI(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: "Thiếu file ảnh" });

    // ảnh -> data URL
    const dataUrl = `data:${
      req.file.mimetype
    };base64,${req.file.buffer.toString("base64")}`;

    const extracted = await openaiExtractFromDataUrl(dataUrl, "low");
    const data = extracted.raw || {};

    data.dob = normalizeDate(data.dob);
    data.expiry = normalizeDate(data.expiry);

    return res.json({
      source: "claude",
      model: CLAUDE_CCCD_MODEL,
      ...data,
      idNumber: extracted.idNumber || data.idNumber || null,
      fullName: data.fullName || extracted.fullName || null,
      dob: data.dob || extracted.dob || null,
      _usage: extracted._usage || null,
    });
  } catch (err) {
    console.error("[cccd-claude] extract error:", err);
    return res.status(500).json({
      message: "Ảnh extract lỗi",
      error: String(err?.message || err),
    });
  }
}

export async function extractKycCCCD(req, res) {
  try {
    const payloads = [];

    if (req.files && Array.isArray(req.files)) {
      for (const file of req.files) {
        payloads.push(`data:${file.mimetype};base64,${file.buffer.toString("base64")}`);
      }
    } else if (req.file) {
      payloads.push(`data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`);
    }

    if (req.body.imageUrl) payloads.push(req.body.imageUrl);
    if (req.body.imageUrlBack) payloads.push(req.body.imageUrlBack);

    if (payloads.length === 0) {
      return res.status(400).json({ message: "Thiếu file ảnh hoặc tham số imageUrl/imageUrlBack" });
    }
    
    // Call the exact same function used by the Telegram bot
    const extracted = await openaiExtractFromDataUrl(payloads, "auto");
    
    return res.json({ source: "claude-kyc", model: CLAUDE_CCCD_MODEL, ...extracted });
  } catch (err) {
    console.error("[extractKycCCCD] error:", err);
    return res.status(500).json({
      message: "Lỗi extract KYC qua Claude",
      error: String(err?.message || err),
    });
  }
}


