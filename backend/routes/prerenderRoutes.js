// routes/prerenderRoutes.js — Public prerender endpoint cho SEO crawler.
// Nginx cần map crawler UA → proxy /path → /prerender/path (rewrite).
import express from "express";
import {
  prerenderHandler,
  prerenderHealth,
} from "../controllers/prerenderController.js";

const router = express.Router();

router.get("/_health", prerenderHealth);
// Catch-all cho MỌI path còn lại — dùng router.use() thay vì router.get()
// với wildcard vì `/*` trong express 4.x + path-to-regexp gây edge case.
router.use((req, res) => {
  if (req.method !== "GET") {
    res.status(405).type("text/plain").send("Prerender: GET only");
    return;
  }
  return prerenderHandler(req, res);
});

export default router;
