// Dev-only: tạo admin non-interactive cho local. Xoá sau khi setup xong nếu muốn.
// Chạy: node scripts/createAdminDev.js [email] [password]
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../backend/models/userModel.js";

dotenv.config();

const email = (process.argv[2] || "admin@pickletour.local").trim().toLowerCase();
const password = process.argv[3] || "admin123";

const MONGO_URI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGO_URI_PROD
    : process.env.MONGO_URI;

try {
  await mongoose.connect(MONGO_URI);
  const existed = await User.findOne({ email });
  if (existed) {
    console.log("ALREADY_EXISTS", email);
  } else {
    const admin = await User.create({
      name: "Super Admin",
      email,
      password,
      phone: `000${Date.now()}`,
      role: "admin",
    });
    console.log("CREATED", admin.email, admin._id.toString());
  }
  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error("ERR", err.message);
  process.exit(1);
}
