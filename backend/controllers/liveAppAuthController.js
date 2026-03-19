import asyncHandler from "express-async-handler";
import { buildLiveAppBootstrapForUser } from "../services/liveAppAccess.service.js";

export const getLiveAppBootstrap = asyncHandler(async (req, res) => {
  const bootstrap = await buildLiveAppBootstrapForUser(req.user);
  if (!bootstrap.authenticated) {
    return res.status(401).json(bootstrap);
  }
  return res.json(bootstrap);
});
