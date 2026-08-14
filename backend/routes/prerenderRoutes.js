// routes/prerenderRoutes.js — Public prerender endpoint cho SEO crawler.
// Nginx cần map crawler UA → proxy /path → /prerender/path (rewrite).
import express from "express";
import {
  prerenderHandler,
  prerenderHealth,
} from "../controllers/prerenderController.js";

const router = express.Router();

router.get("/_health", prerenderHealth);
// Catch-all — /prerender/anything/here?q=1
router.get(/.*/, prerenderHandler);

export default router;
