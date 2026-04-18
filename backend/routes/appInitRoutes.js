// routes/appInitRoutes.js
import express from "express";
import {
  createAppSessionToken,
  verifyAppSessionToken,
  APP_SESSION_TTL,
} from "../utils/appSession.js";
import { getSystemSettingsRuntime } from "../services/systemSettingsRuntime.service.js";

const router = express.Router();

async function buildPublicUiPayload() {
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    const frontendVersion = String(settings?.frontendUi?.version || "v1")
      .trim()
      .toLowerCase();

    return {
      frontendVersion: ["v1", "v2", "v3"].includes(frontendVersion)
        ? frontendVersion
        : "v1",
    };
  } catch (error) {
    console.error("[appInit] Cannot load frontend UI settings:", error);
    return {
      frontendVersion: "v1",
    };
  }
}

router.get("/", async (req, res) => {
  try {
    const ua = req.get("user-agent") || "";
    const publicUi = await buildPublicUiPayload();

    // Nếu đã có session hợp lệ -> trả lại (không spam tạo mới)
    const existingToken =
      (req.cookies && req.cookies.pt_ses) || req.header("x-pt-ses");
    const existing = verifyAppSessionToken(existingToken, { ua });

    if (existing) {
      return res.json({
        sessionId: existing.sid,
        publicUi,
        // expiresIn: APP_SESSION_TTL,
        // chỗ này có thể trả thêm public config/flags nếu muốn
      });
    }

    // Tạo session mới
    const { sid, token, iat, ttl } = createAppSessionToken({ ua });

    res.cookie("pt_ses", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: ttl * 1000,
    });

    return res.json({
      sessionId: sid,
      issuedAt: iat,
      publicUi,
      // expiresIn: ttl,
      // có thể trả:
      // publicConfig: { env: process.env.APP_ENV || "prod" },
      // flags: { enableLiveOverlay: true, ... }
    });
  } catch (err) {
    console.error("[appInit] Error:", err);
    return res.status(500).json({ message: "Init failed" });
  }
});

export default router;
