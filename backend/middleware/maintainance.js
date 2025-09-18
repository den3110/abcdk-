// middlewares/versionGate.js
export async function maintainanceTrigger(req, res, next) {
  return res.status(503).json({
    ok: false,
  });
}
