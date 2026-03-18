import asyncHandler from "express-async-handler";
import {
  commitAiRegistrationImport,
  getAiImportUserBatch,
  listAiImportUserBatches,
  previewAiRegistrationImport,
} from "../../services/aiRegistrationImport.service.js";

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseComment(res, comment = "keepalive") {
  res.write(`: ${comment}\n\n`);
}

export const previewRegistrationImport = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const { sheetUrl = "", rawText = "", adminPrompt = "" } = req.body || {};

  const result = await previewAiRegistrationImport({
    tournamentId: tourId,
    sheetUrl,
    rawText,
    adminPrompt,
    actorMeta: {
      actorId: req.user?._id || null,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
    },
  });

  res.json(result);
});

export const previewRegistrationImportStream = async (req, res) => {
  const { tourId } = req.params;
  const { sheetUrl = "", rawText = "", adminPrompt = "" } = req.body || {};
  let closed = false;
  let heartbeat = null;

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const markClosed = () => {
    closed = true;
    stopHeartbeat();
  };

  req.on("close", markClosed);
  req.on("aborted", markClosed);

  req.setTimeout?.(0);
  res.setTimeout?.(0);
  req.socket?.setKeepAlive?.(true, 15_000);
  req.socket?.setTimeout?.(0);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  heartbeat = setInterval(() => {
    if (closed || res.writableEnded || res.destroyed) {
      stopHeartbeat();
      return;
    }

    try {
      writeSseComment(res, "keepalive");
    } catch (error) {
      console.warn("[AI Import] preview stream heartbeat stopped:", error.message);
      markClosed();
    }
  }, 15_000);

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
      actorMeta: {
        actorId: req.user?._id || null,
        ip: req.ip || "",
        userAgent: req.headers["user-agent"] || "",
      },
      onProgress: (payload) => {
        if (closed) return;
        writeSse(res, "progress", payload);
      },
    });

    if (!closed) {
      writeSse(res, "complete", result);
      stopHeartbeat();
      res.end();
    }
  } catch (error) {
    console.error("[AI Import] preview stream error:", error.message);
    if (!closed) {
      writeSse(res, "error", {
        message: error.message || "Không thể xem trước danh sách này",
        aiDiagnostics: error.aiDiagnostics || null,
      });
      stopHeartbeat();
      res.end();
    }
  }
};

export const commitRegistrationImport = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const { rows = [], paidRowIds } = req.body || {};

  const result = await commitAiRegistrationImport({
    tournamentId: tourId,
    rows,
    paidRowIds,
    actorId: req.user?._id,
    actorMeta: {
      actorId: req.user?._id || null,
      ip: req.ip || "",
      userAgent: req.headers["user-agent"] || "",
    },
  });

  res.status(201).json(result);
});

export const listImportUserBatches = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const { limit = 20 } = req.query || {};

  const result = await listAiImportUserBatches({
    tournamentId: tourId,
    limit,
  });

  res.json(result);
});

export const getImportUserBatch = asyncHandler(async (req, res) => {
  const { tourId, batchId } = req.params;

  const result = await getAiImportUserBatch({
    tournamentId: tourId,
    batchId,
  });

  res.json(result);
});
