// middlewares/optimizeImage.js
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Middleware tối ưu ảnh với sharp
 *
 * - Yêu cầu: đã có req.file (multer.single('image'))
 * - Mặc định:
 *    + Resize fit trong khung 800x800
 *    + Convert sang webp quality 80
 * - Có thể override qua:
 *    + query/body: format, width, height, quality
 *    + options khi khởi tạo middleware
 *
 * @param {Object} options
 * @param {number} options.maxWidth    - width tối đa (default 800)
 * @param {number} options.maxHeight   - height tối đa (default 800)
 * @param {string} options.defaultFormat - định dạng default: 'webp' | 'jpeg' | 'png'
 * @param {number} options.quality     - quality 1-100 (default 80)
 * @param {string} options.outputDir   - thư mục output (default: cùng thư mục với file upload)
 * @param {boolean} options.keepOriginal - giữ lại file gốc hay không (default: false)
 */
export function optimizeImage(options = {}) {
  const {
    maxWidth = 800,
    maxHeight = 800,
    defaultFormat = "webp",
    quality: defaultQuality = 80,
    outputDir, // optional
    keepOriginal = false,
  } = options;

  const allowedFormats = ["webp", "jpeg", "jpg", "png"];

  return async function optimizeImageMiddleware(req, res, next) {
    if (!req.file) {
      // Không có file thì bỏ qua
      return next();
    }

    const inputPath = req.file.path;

    try {
      // --- 1. Lấy format / width / height / quality từ request hoặc options ---
      const body = req.body || {};
      const query = req.query || {};

      let format = (body.format || query.format || defaultFormat || "webp")
        .toString()
        .toLowerCase();

      if (!allowedFormats.includes(format)) {
        format = "webp";
      }
      if (format === "jpg") format = "jpeg"; // sharp dùng 'jpeg'

      const width = Number(body.width || query.width || maxWidth) || null; // null = không set
      const height = Number(body.height || query.height || maxHeight) || null;

      let quality =
        Number(body.quality || query.quality || defaultQuality) || 80;
      if (quality < 1) quality = 1;
      if (quality > 100) quality = 100;

      // --- 2. Tạo đường dẫn output ---
      const outDir =
        outputDir || path.join(__dirname, "..", "uploads", "optimized"); // tùy cấu trúc project

      await fs.mkdir(outDir, { recursive: true });

      const baseName =
        path
          .basename(req.file.filename || req.file.originalname || "image")
          .split(".")
          .slice(0, -1)
          .join(".") || "image";

      const ext = format === "jpeg" ? "jpg" : format; // để user dễ nhìn
      const outputFileName = `${baseName}-${Date.now()}.${ext}`;
      const outputPath = path.join(outDir, outputFileName);

      // --- 3. Build pipeline sharp ---
      let transformer = sharp(inputPath).rotate(); // auto rotate theo EXIF

      if (width || height) {
        transformer = transformer.resize({
          width,
          height,
          fit: "inside", // giữ tỉ lệ, không bị méo
          withoutEnlargement: true, // không phóng to ảnh nhỏ
        });
      }

      switch (format) {
        case "png":
          transformer = transformer.png({
            quality, // chỉ ảnh hưởng một phần với png
            compressionLevel: 9,
          });
          break;
        case "jpeg":
          transformer = transformer.jpeg({
            quality,
            progressive: true,
            mozjpeg: true,
          });
          break;
        case "webp":
        default:
          transformer = transformer.webp({
            quality,
          });
          break;
      }

      // --- 4. Ghi file output ---
      await transformer.toFile(outputPath);

      // --- 5. Xử lý file gốc (xóa nếu không cần) ---
      if (!keepOriginal) {
        try {
          await fs.unlink(inputPath);
        } catch (err) {
          // không quan trọng, log nhẹ
          console.warn("Cannot delete original file:", err.message);
        }
      }

      // --- 6. Gắn thông tin file mới vào req.file ---
      req.file.optimized = true;
      req.file.format = format;
      req.file.quality = quality;
      req.file.optimizedPath = outputPath;
      req.file.optimizedFilename = outputFileName;

      // Nếu muốn dùng luôn path mới:
      req.file.path = outputPath;
      req.file.filename = outputFileName;
      // tùy hệ thống static, bạn tự map sang URL:
      // req.file.url = `${process.env.BASE_URL}/uploads/optimized/${outputFileName}`;

      return next();
    } catch (err) {
      console.error("optimizeImage error:", err);
      return next(err);
    }
  };
}
