import express from "express";
import {
  checkUpdate,
  downloadFile,
  dbGetBundleById,
  dbGetBundles,
  dbGetChannels,
  dbCommit,
  storageUpload,
  storageDelete,
} from "../controllers/hotUpdaterController.js";

const router = express.Router();

// ---- Public (app gọi, không auth) ----
router.get("/check-update", checkUpdate);
router.get("/file/*", downloadFile);

// ---- Deploy plugin API (bảo vệ bằng header x-hotupdater-key) ----
router.get("/_db/channels", dbGetChannels);
router.get("/_db/bundles", dbGetBundles);
router.get("/_db/bundles/:id", dbGetBundleById);
router.post("/_db/commit", express.json({ limit: "5mb" }), dbCommit);
router.post(
  "/_storage/upload",
  express.raw({ type: "*/*", limit: "300mb" }),
  storageUpload,
);
router.delete("/_storage", express.json(), storageDelete);

export default router;
