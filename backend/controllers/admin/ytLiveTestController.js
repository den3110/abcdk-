// controllers/admin/ytLiveTestController.js
import expressAsyncHandler from "express-async-handler";
import {
  startYtLiveTests,
  listYtLiveTestSessions,
  stopYtLiveTestSession,
  stopAllYtLiveTestSessions,
} from "../../services/youtubeLiveTest.service.js";

// POST /admin/youtube/live-test/start { count }
export const startYtLiveTest = expressAsyncHandler(async (req, res) => {
  const count = Number(req.body?.count) || 2;
  const result = await startYtLiveTests({ count, startedBy: req.user?.email || "admin" });
  res.json({ ok: true, ...result });
});

// GET /admin/youtube/live-test/sessions?active=1
export const listYtLiveTest = expressAsyncHandler(async (req, res) => {
  const activeOnly = String(req.query.active || "") === "1";
  const items = await listYtLiveTestSessions({ activeOnly });
  res.json({
    items,
    liveCount: items.filter((i) => ["starting", "live"].includes(i.status)).length,
  });
});

// POST /admin/youtube/live-test/stop-all
export const stopAllYtLiveTest = expressAsyncHandler(async (req, res) => {
  res.json(await stopAllYtLiveTestSessions());
});

// POST /admin/youtube/live-test/:sessionId/stop
export const stopYtLiveTest = expressAsyncHandler(async (req, res) => {
  const result = await stopYtLiveTestSession(String(req.params.sessionId || ""));
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});
