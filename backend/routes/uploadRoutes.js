// routes/uploadRoute.js hoặc trong controller riêng
import express from 'express';
import multer from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import { cccdUpload } from '../middleware/cccdUpload.js';
import { uploadCccd } from '../controllers/uploadController.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/avatars/');
  },
  filename(req, file, cb) {
    cb(
      null,
      `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`
    );
  },
});

const upload = multer({ storage });

router.post('/avatar', upload.single('avatar'), (req, res) => {
  const fullUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${req.file.filename}`;
  res.status(200).json({ url: fullUrl });
});

router.post("/cccd", protect, cccdUpload, uploadCccd);

export default router;
