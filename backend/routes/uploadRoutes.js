// routes/uploadRoute.js hoặc trong controller riêng
import express from 'express';
import multer from 'multer';
import path from 'path';

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

export default router;
