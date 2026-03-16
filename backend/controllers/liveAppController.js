import { createFacebookLiveForMatch } from "./adminMatchLiveController.js";

export const createLiveSessionForLiveApp = async (req, res) => {
  let statusCode = 200;
  let payload = null;

  const captureRes = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(obj) {
      payload = obj;
      return obj;
    },
  };

  await createFacebookLiveForMatch(req, captureRes);

  if (!payload) {
    return res.status(500).json({ message: "Create live failed" });
  }
  if (statusCode !== 200) {
    return res.status(statusCode).json(payload);
  }

  const fb = payload?.platforms?.facebook?.live || null;
  const primary = payload?.primary || null;

  const secure_stream_url = fb?.secure_stream_url || null;
  const server_url = fb?.server_url || primary?.server_url || null;
  const stream_key = fb?.stream_key || primary?.stream_key || null;

  if (!server_url || !stream_key) {
    return res.status(409).json({
      message: "Không nhận được RTMP URL từ server",
      detail: { hasFacebook: !!fb, primary: primary?.platform || null },
    });
  }

  return res.json({
    facebook: {
      secure_stream_url,
      server_url,
      stream_key,
      pageId: fb?.pageId || null,
      pageName: fb?.pageName || null,
    },
  });
};

