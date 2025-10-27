// server/controllers/admin/spc.controller.js
import asyncHandler from "express-async-handler";
import createError from "http-errors";
import { getMeta, loadAll, writeSpcFile } from "../../services/spcStore.js";

// (tùy chọn) cài deps nếu chưa có:
// npm i express-async-handler http-errors

function assertTxtFile(file) {
  if (!file) throw createError(400, "Thiếu file .txt");
  const okName = /\.txt$/i.test(file.originalname || "");
  const okMime = /text\/plain|application\/json/.test(file.mimetype || "");
  if (!okName && !okMime) {
    throw createError(415, "File không hợp lệ, chỉ nhận .txt chứa JSON");
  }
}

export const uploadSpc = asyncHandler(async (req, res) => {
  assertTxtFile(req.file);
  const meta = await writeSpcFile(req.file.buffer, true); // validate JSON array
  res.json({ ok: true, meta });
});

export const getSpcMeta = asyncHandler(async (_req, res) => {
  const meta = await getMeta();
  res.json(meta);
});

export const getSpcSample = asyncHandler(async (req, res) => {
  try {
    const raw = req.query.limit;
    const n = Number.parseInt(String(raw ?? "20"), 10);
    const limit = Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 1000);
  
    const all = await loadAll();
    res.json({ total: all.length, items: all.slice(0, limit) });
    
  } catch (error) {
    console.log(error)
    return res.status(500).json({message: error?.message})
  }
});
