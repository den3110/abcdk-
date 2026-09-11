// controllers/admin/fbLiveTestController.js
import expressAsyncHandler from "express-async-handler";
import {
  startFbLiveTests,
  listFbLiveTestSessions,
  stopFbLiveTestSession,
  stopAllFbLiveTestSessions,
} from "../../services/fbLiveTest.service.js";

// POST /admin/fb/live-test/start  { count }
export const startFbLiveTest = expressAsyncHandler(async (req, res) => {
  const count = Number(req.body?.count) || 3;
  const result = await startFbLiveTests({
    count,
    startedBy: req.user?.email || "admin",
  });
  res.json({ ok: true, ...result });
});

// GET /admin/fb/live-test/sessions?active=1
export const listFbLiveTest = expressAsyncHandler(async (req, res) => {
  const activeOnly = String(req.query.active || "") === "1";
  const items = await listFbLiveTestSessions({ activeOnly });
  res.json({
    items,
    liveCount: items.filter((i) => ["starting", "live"].includes(i.status)).length,
  });
});

// POST /admin/fb/live-test/stop-all
export const stopAllFbLiveTest = expressAsyncHandler(async (req, res) => {
  const result = await stopAllFbLiveTestSessions();
  res.json(result);
});

// POST /admin/fb/live-test/:sessionId/stop
export const stopFbLiveTest = expressAsyncHandler(async (req, res) => {
  const result = await stopFbLiveTestSession(String(req.params.sessionId || ""));
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});
