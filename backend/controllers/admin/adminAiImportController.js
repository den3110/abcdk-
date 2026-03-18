import asyncHandler from "express-async-handler";
import {
  commitAiRegistrationImport,
  previewAiRegistrationImport,
} from "../../services/aiRegistrationImport.service.js";

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const previewRegistrationImport = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const { sheetUrl = "", rawText = "", adminPrompt = "" } = req.body || {};

  const result = await previewAiRegistrationImport({
    tournamentId: tourId,
    sheetUrl,
    rawText,
    adminPrompt,
  });

  res.json(result);
});

export const previewRegistrationImportStream = async (req, res) => {
  const { tourId } = req.params;
  const { sheetUrl = "", rawText = "", adminPrompt = "" } = req.body || {};
  let closed = false;

  req.on("close", () => {
    closed = true;
  });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  writeSse(res, "progress", {
    step: "connected",
    progress: 1,
    message: "Đã kết nối, bắt đầu xử lý xem trước.",
  });

  try {
    const result = await previewAiRegistrationImport({
      tournamentId: tourId,
      sheetUrl,
      rawText,
      adminPrompt,
      onProgress: (payload) => {
        if (closed) return;
        writeSse(res, "progress", payload);
      },
    });

    if (!closed) {
      writeSse(res, "complete", result);
      res.end();
    }
  } catch (error) {
    console.error("[AI Import] preview stream error:", error.message);
    if (!closed) {
      writeSse(res, "error", {
        message: error.message || "Không thể xem trước danh sách này",
      });
      res.end();
    }
  }
};

export const commitRegistrationImport = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const { rows = [] } = req.body || {};

  const result = await commitAiRegistrationImport({
    tournamentId: tourId,
    rows,
    actorId: req.user?._id,
  });

  res.status(201).json(result);
});
