import asyncHandler from "express-async-handler";
import { getPublicStatusSnapshot } from "../services/publicStatus.service.js";

export const getPublicStatus = asyncHandler(async (_req, res) => {
  const payload = await getPublicStatusSnapshot();
  res.status(200).json(payload);
});
