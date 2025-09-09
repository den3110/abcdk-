// scripts/createAdmin.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import promptSync from "prompt-sync";
import User from "../backend/models/userModel.js";

dotenv.config();
const prompt = promptSync({ sigint: true });

// 🔑 Chọn URI theo NODE_ENV
const isProd = process.env.NODE_ENV === "production";
const MONGO_URI = isProd ? process.env.MONGO_URI_PROD : process.env.MONGO_URI;

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`🔗  Đã kết nối MongoDB (${isProd ? "PROD" : "DEV"})`);

    /* ---------- Hỏi thông tin ---------- */
    const email = prompt("Nhập email admin: ").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log("🛑  Email không hợp lệ");
      process.exit(1);
    }

    const existed = await User.findOne({ email });
    if (existed) {
      console.log("🛑  Email đã tồn tại:", email);
      process.exit(1);
    }

    const password = prompt.hide("Nhập password: ");
    const confirm = prompt.hide("Xác nhận password: ");
    if (password !== confirm) {
      console.log("🛑  Password không khớp");
      process.exit(1);
    }
    if (password.length < 6) {
      console.log("🛑  Password tối thiểu 6 ký tự");
      process.exit(1);
    }

    /* ---------- Tạo admin ---------- */
    const admin = await User.create({
      name: "Super Admin",
      email,
      password,
      phone: `000${Date.now()}`,
      role: "admin",
    });

    console.log("✅  Đã tạo admin :", admin.email);
    process.exit(0);
  } catch (err) {
    console.error("❌  Lỗi:", err);
    process.exit(1);
  }
})();
