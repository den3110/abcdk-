// controllers/sportconnect.controller.js
import asyncHandler from "express-async-handler";
import SportConnectService from "../services/sportconnect.service.js";

/**
 * GET /api/sportconnect/levelpoint
 * Query: searchCriterial | phone | q, sportId?, page?, waitingInformation?
 * Header optional: x-sc-cookie (override cookie nếu muốn)
 */
export const getLevelPoint = asyncHandler(async (req, res) => {
  const searchCriterial =
    String(req.query.searchCriterial ?? req.query.phone ?? req.query.q ?? "").trim();

  if (!searchCriterial) {
    return res.status(400).json({ message: "Thiếu searchCriterial/phone/q" });
  }

  const sportId = req.query.sportId ?? 2;
  const page = req.query.page ?? 0;
  const waitingInformation = req.query.waitingInformation ?? "";
  const cookie = req.headers["x-sc-cookie"] || process.env.SPORTCONNECT_COOKIE;

  const { status, data, proxyUrl } = await SportConnectService.listLevelPoint({
    searchCriterial, sportId, page, waitingInformation, cookie,
  });

  // Optional: trả proxy sử dụng qua header debug (không bắt buộc)
  if (req.query.debug === "1") {
    res.setHeader("x-proxy-used", proxyUrl || "");
  }

  return res.status(status || 502).json(
    data ?? { message: "No response from upstream" }
  );
});

/**
 * POST /api/sportconnect/levelpoint
 * Body: { searchCriterial, sportId?, page?, waitingInformation? }
 * Header optional: x-sc-cookie (override cookie nếu muốn)
 */
export const postLevelPoint = asyncHandler(async (req, res) => {
  const searchCriterial = String(req.body?.searchCriterial ?? "").trim();
  if (!searchCriterial) {
    return res.status(400).json({ message: "Thiếu searchCriterial" });
  }

  const sportId = req.body?.sportId ?? 2;
  const page = req.body?.page ?? 0;
  const waitingInformation = req.body?.waitingInformation ?? "";
  const cookie = req.headers["x-sc-cookie"] || process.env.SPORTCONNECT_COOKIE;

  const { status, data, proxyUrl } = await SportConnectService.listLevelPoint({
    searchCriterial, sportId, page, waitingInformation, cookie,
  });

  if (req.query?.debug === "1") {
    res.setHeader("x-proxy-used", proxyUrl || "");
  }

  return res.status(status || 502).json(
    data ?? { message: "No response from upstream" }
  );
});
