import asyncHandler from "express-async-handler";
import { buildLiveAppBootstrapForUser } from "../services/liveAppAccess.service.js";

const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};

export const getLiveAppBootstrap = asyncHandler(async (req, res) => {
  setNoStoreHeaders(res);
  const bootstrap = await buildLiveAppBootstrapForUser(req.user);

  if (!bootstrap.authenticated) {
    return res.status(401).json(bootstrap);
  }
  return res.json(bootstrap);
});
