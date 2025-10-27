import express from "express";
import multer from "multer";
import {
  getSpcMeta,
  getSpcSample,
  uploadSpc,
} from "../controllers/admin/spc.controller.js";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /text\/plain|application\/json/.test(file.mimetype || "") ||
      /\.txt$/i.test(file.originalname || "");
    cb(ok ? null : new Error("Chỉ nhận file .txt"), ok);
  },
});

router.get("/meta", protect, authorize("admin"), getSpcMeta);
router.get("/sample", protect, authorize("admin"), getSpcSample);
router.post("/upload", protect, authorize("admin"), upload.single("file"), uploadSpc);

export default router;
