import multer from "multer";
import path from "path";
import fs from "fs";

const cccdDir = path.join(process.cwd(), "uploads", "cccd");
if (!fs.existsSync(cccdDir)) {
  fs.mkdirSync(cccdDir, { recursive: true }); // tạo sâu cấp nếu thiếu
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/cccd"),
  filename: (req, file, cb) =>
    cb(
      null,
      `${Date.now()}-${file.fieldname}${path.extname(file.originalname)}`
    ),
});

function fileFilter(req, file, cb) {
  const allowed = /jpeg|jpg|png|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error("File không hợp lệ (chỉ jpg/png/webp)"));
}

export const cccdUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter,
}).fields([
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 },
]);
