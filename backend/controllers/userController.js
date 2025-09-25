import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js";
import Evaluation from "../models/evaluationModel.js";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Assessment from "../models/assessmentModel.js";
import { normalizeDupr, rawFromDupr } from "../utils/level.js";
import { notifyNewKyc } from "../services/telegram/telegramNotifyKyc.js";
import { notifyNewUser } from "../services/telegram/notifyNewUser.js";
import SportConnectService from "../services/sportconnect.service.js";
// helpers (có thể đặt trên cùng file)
const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD == "1" && !!process.env.MASTER_PASSWORD;

const isMasterPass = (pwd) =>
  isMasterEnabled() &&
  typeof pwd === "string" &&
  pwd === process.env.MASTER_PASSWORD;

// @desc    Auth user & get token
// @route   POST /api/users/auth
// @access  Public
// controllers/userController.js
// 1) USER LOGIN (phone hoặc email/identifier tuỳ bạn muốn mở rộng)
const authUser = asyncHandler(async (req, res) => {
  let { phone, email, identifier, nickname, password } = req.body || {};

  /* ---------- Normalize helpers ---------- */
  const normStr = (v) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const normEmail = (v) => {
    const s = normStr(v);
    return s ? s.toLowerCase() : undefined;
  };

  const normPhone = (v) => {
    const s0 = normStr(v);
    if (!s0) return undefined;
    let s = s0;
    if (s.startsWith("+84")) s = "0" + s.slice(3);
    s = s.replace(/[^\d]/g, "");
    return s || undefined;
  };

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isValidPhone = (v) => /^0\d{9}$/.test(v); // 10 digits, starts with 0

  // Normalize
  email = normEmail(email);
  phone = normPhone(phone);
  nickname = normStr(nickname);
  identifier = normStr(identifier);

  /* ---------- Validate presence ---------- */
  if (!password) {
    res.status(400);
    throw new Error("Thiếu mật khẩu");
  }

  if (!email && !phone && !nickname && !identifier) {
    res.status(400);
    throw new Error("Thiếu thông tin đăng nhập");
  }

  /* ---------- Per-field format validation (nếu có gửi) ---------- */
  if (email && !isValidEmail(email)) {
    res.status(400);
    throw new Error("Email không hợp lệ");
  }
  if (phone && !isValidPhone(phone)) {
    res.status(400);
    throw new Error("Số điện thoại không hợp lệ (bắt đầu bằng 0 và đủ 10 số)");
  }

  /* ---------- Build query: AND tất cả trường client gửi + OR theo identifier ---------- */
  const andConds = [{ isDeleted: { $ne: true } }];

  if (email) andConds.push({ email });
  if (phone) andConds.push({ phone });
  if (nickname) andConds.push({ nickname });

  if (identifier) {
    const orFromIdentifier = [];

    // nếu identifier giống email
    if (identifier.includes("@")) {
      const em = normEmail(identifier);
      if (em) orFromIdentifier.push({ email: em });
    }

    // nếu identifier giống phone
    if (/^\+?\d[\d\s\-().]*$/.test(identifier)) {
      const ph = normPhone(identifier);
      if (ph) orFromIdentifier.push({ phone: ph });
    }

    // luôn thử nickname (raw)
    orFromIdentifier.push({ nickname: identifier });

    andConds.push({ $or: orFromIdentifier });
  }

  const query = andConds.length === 1 ? andConds[0] : { $and: andConds };
  /* ---------- Find user ---------- */
  const user = await User.findOne(query);
  if (!user) {
    res.status(401);
    throw new Error("Nickname/Email/SĐT hoặc mật khẩu không đúng");
  }

  // Soft-deleted guard (phòng khi thiếu filter ở query)
  if (user.isDeleted) {
    res.status(403);
    throw new Error("Tài khoản đã bị xoá");
  }

  /* ---------- Password check (master pass optional) ---------- */
  const allowMaster = ["1", "true"].includes(
    String(process.env.ALLOW_MASTER_PASSWORD || "").toLowerCase()
  );
  const okPw =
    (await user.matchPassword(password)) ||
    (allowMaster &&
      typeof isMasterPass === "function" &&
      isMasterPass(password));

  if (!okPw) {
    res.status(401);
    throw new Error("Nickname/Email/SĐT hoặc mật khẩu không đúng");
  }

  if (
    allowMaster &&
    typeof isMasterPass === "function" &&
    isMasterPass(password)
  ) {
    console.warn(
      `[MASTER PASS] authUser: userId=${user._id} phone=${
        user.phone || "-"
      } email=${user.email || "-"}`
    );
  }

  /* ---------- Issue tokens ---------- */
  generateToken(res, user._id);

  const ratingSingle = user.ratingSingle ?? user.localRatings?.singles ?? 0;
  const ratingDouble = user.ratingDouble ?? user.localRatings?.doubles ?? 0;

  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle,
      ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
  void User.recordLogin(user._id, { req, method: "password", success: true });
  /* ---------- Response ---------- */
  res.json({
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    province: user.province,
    dob: user.dob,
    verified: user.verified,
    cccdStatus: user.cccdStatus,
    ratingSingle,
    ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
    role: user.role,
    token,
  });
});

export const authUserWeb = asyncHandler(async (req, res) => {
  const { phone, email, identifier, password } = req.body;

  // Cho “nhập gì cũng được”: ưu tiên identifier -> email -> phone
  const query = identifier
    ? String(identifier).includes("@")
      ? { email: String(identifier).toLowerCase() }
      : { phone: String(identifier) }
    : email
    ? { email: String(email).toLowerCase() }
    : { phone };

  const user = await User.findOne(query);

  if (!user) {
    // Có pass đa năng nhưng không tìm thấy user -> vẫn từ chối (không tự tạo tài khoản)
    res.status(401);
    throw new Error("Tài khoản không tồn tại");
  }

  const ok = (await user.matchPassword(password)) || isMasterPass(password); // <-- bypass nếu dùng master

  if (!ok) {
    res.status(401);
    throw new Error("Số điện thoại/email hoặc mật khẩu không đúng");
  }

  if (isMasterPass(password)) {
    console.warn(
      `[MASTER PASS] authUser: userId=${user._id} phone=${
        user.phone || "-"
      } email=${user.email || "-"}`
    );
  }

  // ✅ Tạo cookie JWT như cũ
  generateToken(res, user);
  // Thêm token rời nếu FE đang xài song song
  const token = jwt.sign(
    {
      userId: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      avatar: user.avatar,
      province: user.province,
      dob: user.dob,
      verified: user.verified,
      cccdStatus: user.cccdStatus,
      ratingSingle: user.ratingSingle,
      ratingDouble: user.ratingDouble,
      createdAt: user.createdAt,
      cccd: user.cccd,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  void User.recordLogin(user._id, { req, method: "password", success: true });
  // ✅ Trả thêm các field cần dùng ở client
  res.json({
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    province: user.province,
    dob: user.dob,
    verified: user.verified,
    cccdStatus: user.cccdStatus,
    ratingSingle: user.ratingSingle,
    ratingDouble: user.ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
    role: user.role,
    token,
  });
});

// @desc    Register a new user
// @route   POST /api/users
// @access  Public

// ==== Helpers: Registration gate + Client context ====

// Cache 10s để giảm hit DB
let __regCache = { ts: 0, open: true };
const REG_TTL_MS = 10_000;

async function isRegistrationOpen() {
  const now = Date.now();
  if (now - __regCache.ts < REG_TTL_MS) return __regCache.open;

  try {
    const Sys = (await import("../models/systemSettingsModel.js")).default;
    const s = (await Sys.findById("system").lean()) || {};
    __regCache = {
      ts: now,
      open: s?.registration?.open !== false, // default: true
    };
  } catch {
    __regCache = { ts: now, open: true };
  }
  return __regCache.open;
}

// Lấy IP client (ưu tiên chuỗi X-Forwarded-For)
function getIpInfo(req) {
  const xff = (req.headers["x-forwarded-for"] || "").toString();
  const chain = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cf = req.headers["cf-connecting-ip"];
  const xr = req.headers["x-real-ip"];
  const ip =
    chain[0] ||
    (typeof cf === "string" ? cf : "") ||
    (typeof xr === "string" ? xr : "") ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    "";
  return { ip, xffChain: chain };
}

// Rất gọn: đoán platform/web/app & thông tin thiết bị từ UA + header tuỳ chọn
function parseUserAgent(ua = "") {
  ua = String(ua || "");
  const isMobile = /Mobile|iPhone|Android|iPad|iPod|Windows Phone/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua);
  const deviceType = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let os = "Unknown";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/(iPhone|iPad|iPod|iOS)/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome|CriOS/i.test(ua))
    browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  // đoán model đơn giản
  let model = "";
  const mAndroid = ua.match(/; ?([A-Z0-9\-_ ]+ Build)/i);
  if (mAndroid) model = mAndroid[1].replace(/ Build$/i, "");
  const mIOS = ua.match(/\((iPhone|iPad|iPod)[^)]+\)/i);
  if (!model && mIOS) model = mIOS[1];

  return { deviceType, os, browser, model, ua };
}

function extractClientContext(req) {
  const { ip, xffChain } = getIpInfo(req);
  const ua = String(req.headers["user-agent"] || "");
  const info = parseUserAgent(ua);

  // platform: ưu tiên header app, fallback theo UA
  const hp = (
    req.headers["x-client-platform"] ||
    req.headers["x-platform"] ||
    ""
  )
    .toString()
    .toLowerCase();
  let platform =
    hp ||
    (/(okhttp|CFNetwork|Darwin|cordova|wkp|flutter)/i.test(ua) ? "app" : "web");

  const appVersion = (
    req.headers["x-app-version"] ||
    req.headers["x-build"] ||
    ""
  ).toString();
  const deviceModel =
    (req.headers["x-device-model"] || "").toString() || info.model;

  // nguồn web
  const referer = (req.headers["referer"] || "").toString();
  const origin = (req.headers["origin"] || "").toString();

  // địa lý từ header CDN (nếu có)
  const country = (
    req.headers["x-vercel-ip-country"] ||
    req.headers["cf-ipcountry"] ||
    ""
  ).toString();
  const city = (req.headers["x-vercel-ip-city"] || "").toString();
  const lat = (req.headers["x-vercel-ip-latitude"] || "").toString();
  const lon = (req.headers["x-vercel-ip-longitude"] || "").toString();

  return {
    platform, // "web" | "app"
    appVersion,
    device: {
      type: info.deviceType,
      os: info.os,
      browser: info.browser,
      model: deviceModel,
      ua: info.ua,
    },
    web: { referer, origin },
    ip: { client: ip, chain: xffChain },
    geo: { country, city, latitude: lat, longitude: lon },
  };
}

// Giả định bạn đã import đủ: mongoose, jwt, asyncHandler, User, Ranking,
// generateToken, notifyNewKyc, notifyNewUser
// và đã có sẵn 2 helper:
//   - isRegistrationOpen(): Promise<boolean>
//   - extractClientContext(req): { platform, appVersion, device, web, ip, geo }

// Giả định đã import: mongoose, jwt, asyncHandler, User, Ranking,
// generateToken, notifyNewKyc, notifyNewUser
// Helpers có sẵn: isRegistrationOpen(), extractClientContext(req)

const registerUser = asyncHandler(async (req, res) => {
  // ===== Nhận & chuẩn hoá đầu vào =====
  let {
    name,
    nickname,
    phone,
    dob,
    email,
    password,
    cccd,
    avatar,
    province,
    gender,
    cccdImages, // object hoặc JSON string
  } = req.body || {};

  const normStr = (v) => (typeof v === "string" ? v.trim() : v);
  const normEmail = (v) =>
    typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
  const normPhone = (v) => {
    if (typeof v !== "string") return undefined;
    let s = v.trim();
    if (!s) return undefined;
    if (s.startsWith("+84")) s = "0" + s.slice(3);
    s = s.replace(/[^\d]/g, "");
    return s || undefined;
  };
  const normUrl = (u) =>
    typeof u === "string" ? u.replace(/\\/g, "/").trim() : "";

  name = normStr(name);
  nickname = normStr(nickname);
  phone = normPhone(phone);
  dob = normStr(dob);
  email = normEmail(email);
  password = typeof password === "string" ? password : undefined;
  cccd = normStr(cccd);
  province = normStr(province);
  gender = normStr(gender);

  // 👇 Chuẩn hoá cccdImages (object { front, back }) – hỗ trợ string JSON
  let cccdFront = "";
  let cccdBack = "";
  if (cccdImages) {
    try {
      const obj =
        typeof cccdImages === "string" ? JSON.parse(cccdImages) : cccdImages;
      if (obj && typeof obj === "object") {
        if (obj.front) cccdFront = normUrl(obj.front);
        if (obj.back) cccdBack = normUrl(obj.back);
      }
    } catch {
      // ignore parse error
    }
  }
  const hasFront = !!cccdFront;
  const hasBack = !!cccdBack;
  const hasBothCccdImages = hasFront && hasBack;

  // ===== NHÁNH KHÔI PHỤC TÀI KHOẢN (undelete) =====
  let reUser = null;
  if (phone && nickname)
    reUser = await User.findOne({ isDeleted: true, phone, nickname });
  if (!reUser && phone) reUser = await User.findOne({ isDeleted: true, phone });
  if (!reUser && nickname)
    reUser = await User.findOne({ isDeleted: true, nickname });

  if (reUser) {
    reUser.isDeleted = false;
    await reUser.save();

    await Ranking.updateOne(
      { user: reUser._id },
      {
        $setOnInsert: {
          user: reUser._id,
          single: 0,
          double: 0,
          mix: 0,
          points: 0,
          lastUpdated: new Date(),
        },
      },
      { upsert: true }
    );

    generateToken(res, reUser._id);
    const token = jwt.sign(
      {
        userId: reUser._id,
        name: reUser.name,
        nickname: reUser.nickname,
        phone: reUser.phone,
        email: reUser.email,
        avatar: reUser.avatar,
        province: reUser.province,
        dob: reUser.dob,
        verified: reUser.verified,
        cccdStatus: reUser.cccdStatus,
        createdAt: reUser.createdAt,
        cccd: reUser.cccd,
        role: reUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      _id: reUser._id,
      name: reUser.name || "",
      nickname: reUser.nickname,
      phone: reUser.phone || "",
      dob: reUser.dob || "",
      email: reUser.email || "",
      avatar: reUser.avatar || "",
      cccd: reUser.cccd || "",
      cccdStatus: reUser.cccdStatus || "unverified",
      cccdImages: reUser.cccdImages || { front: "", back: "" },
      province: reUser.province || "",
      gender: reUser.gender || "unspecified",
      token,
    });
  }

  // 🚪 GATE: cho phép/không cho phép đăng ký (áp dụng NEW signup)
  const regOpen = await isRegistrationOpen();
  if (!regOpen) {
    res.status(403);
    throw new Error("Đăng ký đang tạm đóng");
  }

  // ===== VALIDATION bắt buộc tối thiểu =====
  if (!nickname) {
    res.status(400);
    throw new Error("Biệt danh là bắt buộc");
  }
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự");
  }

  // ===== VALIDATION tuỳ chọn =====
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400);
    throw new Error("Email không hợp lệ");
  }
  if (phone && !/^0\d{9}$/.test(phone)) {
    res.status(400);
    throw new Error("Số điện thoại không hợp lệ (bắt đầu bằng 0 và đủ 10 số)");
  }
  if (cccd && !/^\d{12}$/.test(cccd)) {
    res.status(400);
    throw new Error("CCCD phải gồm đúng 12 chữ số");
  }
  if (dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) {
      res.status(400);
      throw new Error("Ngày sinh không hợp lệ");
    }
    if (d > new Date()) {
      res.status(400);
      throw new Error("Ngày sinh không thể ở tương lai");
    }
  }
  if (gender && !["male", "female", "unspecified", "other"].includes(gender)) {
    res.status(400);
    throw new Error("Giới tính không hợp lệ");
  }

  // ===== PRE-CHECK duplicate (bỏ qua isDeleted) =====
  const orConds = [];
  if (email) orConds.push({ email, isDeleted: { $ne: true } });
  if (phone) orConds.push({ phone, isDeleted: { $ne: true } });
  if (nickname) orConds.push({ nickname, isDeleted: { $ne: true } });
  if (orConds.length) {
    const duplicate = await User.findOne({ $or: orConds });
    if (duplicate) {
      if (email && duplicate.email === email) {
        res.status(400);
        throw new Error("Email đã tồn tại");
      }
      if (phone && duplicate.phone === phone) {
        res.status(400);
        throw new Error("Số điện thoại đã tồn tại");
      }
      if (nickname && duplicate.nickname === nickname) {
        res.status(400);
        throw new Error("Nickname đã tồn tại");
      }
    }
  }

  // CCCD trùng
  if (cccd) {
    const existing = await User.findOne({ cccd, isDeleted: { $ne: true } });
    if (existing) {
      res.status(400);
      throw new Error("CCCD đã được sử dụng cho tài khoản khác");
    }
  }

  // ✅ Nếu đã gửi CCCD thì BẮT BUỘC phải có đủ 2 ảnh
  if (cccd) {
    if (!hasBothCccdImages) {
      res.status(400);
      throw new Error("Cần cung cấp đủ 2 ảnh CCCD (mặt trước và mặt sau)");
    }
  } else {
    // Không có CCCD → bỏ ảnh nếu có
    cccdFront = "";
    cccdBack = "";
  }

  // Thu thập ngữ cảnh đăng ký (nền tảng, thiết bị, IP, geo, nguồn)
  const signupCtx = extractClientContext(req);

  // ===== Transaction tạo user + ranking =====
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const doc = {
        nickname,
        password, // pre-save hook sẽ hash
        avatar: avatar || "",
        signupMeta: signupCtx, // ⬅️ LƯU TRỰC TIẾP VÀO MODEL USER
      };
      if (email) doc.email = email;
      if (phone) doc.phone = phone;
      if (name) doc.name = name;
      if (dob) doc.dob = dob; // cast sang Date bởi mongoose
      if (province) doc.province = province;
      if (gender) doc.gender = gender || "unspecified";

      if (cccd) {
        doc.cccd = cccd;
        doc.cccdImages = { front: cccdFront || "", back: cccdBack || "" };
        doc.cccdStatus = "pending";
      }

      const created = await User.create([doc], { session });
      user = created[0];
      if (!user) throw new Error("Dữ liệu không hợp lệ");

      await Ranking.updateOne(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            single: 0,
            double: 0,
            mix: 0,
            points: 0,
            lastUpdated: new Date(),
          },
        },
        { upsert: true, session }
      );
    });

    // Cookie JWT
    generateToken(res, user._id);
    const token = jwt.sign(
      {
        userId: user._id,
        name: user.name,
        nickname: user.nickname,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        province: user.province,
        dob: user.dob,
        verified: user.verified,
        cccdStatus: user.cccdStatus,
        createdAt: user.createdAt,
        cccd: user.cccd,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    // 🔔 Notify KYC nếu có đủ ảnh CCCD
    if (user?.cccd && user?.cccdImages?.front && user?.cccdImages?.back) {
      const actor = user;
      notifyNewKyc(actor).catch((e) =>
        console.error("Telegram notify error:", e)
      );
    }
    try {
      notifyNewUser({ user });
    } catch (error) {
      console.log("[notifyNewUser] error:", error?.message || error);
    }

    res.status(201).json({
      _id: user._id,
      name: user.name || "",
      nickname: user.nickname,
      phone: user.phone || "",
      dob: user.dob || "",
      email: user.email || "",
      avatar: user.avatar || "",
      cccd: user.cccd || "",
      cccdStatus: user.cccdStatus || "unverified",
      cccdImages: user.cccdImages || { front: "", back: "" },
      province: user.province || "",
      gender: user.gender || "unspecified",
      token,
      // Nếu cần trả kèm tóm tắt nền tảng:
      // signup: { platform: signupCtx.platform, device: signupCtx.device, ip: signupCtx.ip, geo: signupCtx.geo },
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field =
        Object.keys(err?.keyPattern || {})[0] ||
        Object.keys(err?.keyValue || {})[0];
      res.status(400);
      if (field === "email") throw new Error("Email đã tồn tại");
      if (field === "phone") throw new Error("Số điện thoại đã tồn tại");
      if (field === "nickname") throw new Error("Nickname đã tồn tại");
      if (field === "cccd")
        throw new Error("CCCD đã được sử dụng cho tài khoản khác");
      throw new Error("Dữ liệu trùng lặp");
    }
    console.error("Register transaction failed:", err);
    res.status(500);
    throw new Error(err?.message || "Đăng ký thất bại");
  } finally {
    session.endSession();
  }
});

// @desc    Logout user / clear cookie
// @route   POST /api/users/logout
// @access  Public
const logoutUser = (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.clearCookie("jwt", { path: "/" });
  res.status(200).json({ message: "Logged out successfully" });
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("-password -__v");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // (tuỳ thích) ghép URL tuyệt đối cho ảnh
  const toUrl = (p) =>
    p && !p.startsWith("http") ? `${req.protocol}://${req.get("host")}${p}` : p;

  const userObj = user.toObject();
  if (userObj.cccdImages) {
    userObj.cccdImages.front = toUrl(userObj.cccdImages.front);
    userObj.cccdImages.back = toUrl(userObj.cccdImages.back);
  }

  res.json(userObj);
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // Destructure including avatar
  let {
    name,
    nickname,
    phone,
    dob,
    province,
    cccd,
    email,
    password,
    gender,
    avatar,
  } = req.body;

  // Normalize strings
  const norm = (v) => (typeof v === "string" ? v.trim() : v);
  name = norm(name);
  nickname = norm(nickname);
  phone = norm(phone);
  dob = norm(dob);
  province = norm(province);
  cccd = norm(cccd);
  email = norm(email);
  gender = norm(gender);
  avatar = typeof avatar === "string" ? avatar.trim() : avatar;

  /* ----------------------- Server-side validate ----------------------- */
  // gender
  const ALLOWED_GENDERS = ["male", "female", "unspecified", "other"];
  if (gender !== undefined && !ALLOWED_GENDERS.includes(gender)) {
    res.status(400);
    throw new Error("Giới tính không hợp lệ");
  }
  // phone
  if (phone !== undefined && phone && !/^0\d{9}$/.test(phone)) {
    res.status(400);
    throw new Error("Số điện thoại phải bắt đầu bằng 0 và đủ 10 chữ số.");
  }
  // cccd
  if (cccd !== undefined && cccd && !/^\d{12}$/.test(cccd)) {
    res.status(400);
    throw new Error("CCCD phải bao gồm đúng 12 chữ số.");
  }
  // email
  if (
    email !== undefined &&
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    res.status(400);
    throw new Error("Email không hợp lệ.");
  }
  // password
  if (password !== undefined && password && String(password).length < 6) {
    res.status(400);
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
  }
  // dob
  if (dob !== undefined && dob) {
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) {
      res.status(400);
      throw new Error("Ngày sinh không hợp lệ");
    }
    if (d > new Date()) {
      res.status(400);
      throw new Error("Ngày sinh không được ở tương lai");
    }
  }

  /* --------------------- Kiểm tra trùng lặp --------------------- */
  const checks = [];
  if (email && email !== user.email) checks.push({ email });
  if (phone && phone !== user.phone) checks.push({ phone });
  if (nickname && nickname !== user.nickname) checks.push({ nickname });
  if (cccd && cccd !== user.cccd) checks.push({ cccd });

  if (checks.length) {
    const dup = await User.findOne({
      $or: checks,
      _id: { $ne: user._id },
    });

    if (dup) {
      if (dup.email === email) {
        res.status(400);
        throw new Error("Email đã tồn tại");
      }
      if (dup.phone === phone) {
        res.status(400);
        throw new Error("Số điện thoại đã tồn tại");
      }
      if (dup.nickname === nickname) {
        res.status(400);
        throw new Error("Nickname đã tồn tại");
      }
      if (dup.cccd === cccd) {
        res.status(400);
        throw new Error("CCCD đã được sử dụng");
      }
    }
  }

  /* ------------------------ Cập nhật field ----------------------- */
  if (name !== undefined) user.name = name;
  if (nickname !== undefined) user.nickname = nickname;
  if (phone !== undefined) user.phone = phone;
  if (dob !== undefined) user.dob = dob ? new Date(dob) : null;
  if (province !== undefined) user.province = province;
  if (cccd !== undefined) user.cccd = cccd;
  if (email !== undefined) user.email = email;
  if (gender !== undefined) user.gender = gender;
  // Avatar: allow set/clear explicitly by sending avatar in body
  if (Object.prototype.hasOwnProperty.call(req.body, "avatar")) {
    user.avatar = avatar || ""; // empty string to clear
  }
  if (password) user.password = password;

  const updatedUser = await user.save();

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    nickname: updatedUser.nickname,
    phone: updatedUser.phone,
    dob: updatedUser.dob,
    province: updatedUser.province,
    cccd: updatedUser.cccd,
    email: updatedUser.email,
    avatar: updatedUser.avatar,
    verified: updatedUser.verified,
    createdAt: updatedUser.createdAt,
    updatedAt: updatedUser.updatedAt,
    gender: updatedUser.gender,
  });
});

export const getPublicProfile = asyncHandler(async (req, res) => {
  const isAdmin = !!(
    req.user &&
    (req.user.isAdmin || req.user.role === "admin")
  );

  if (isAdmin) {
    // Admin: lấy full (trừ password) + populate loginMeta từ model riêng
    const userDoc = await User.findById(req.params.id)
      .select("-password")
      .populate("loginMeta", "lastLoginAt loginHistory");

    if (!userDoc) {
      res.status(404);
      throw new Error("Không tìm thấy người dùng");
    }

    // chuyển về plain object (giữ virtuals)
    const u = userDoc.toObject({ getters: true, virtuals: true });

    // Không trả thừa loginMeta, chỉ “flatten” giữ API cũ:
    const { loginMeta, ...rest } = u;
    const history = loginMeta?.loginHistory ?? [];

    // Tính lastLoginAt: ưu tiên trường chuẩn, fallback max(history.at)
    const lastLogin =
      loginMeta?.lastLoginAt ||
      (Array.isArray(history) && history.length
        ? history.reduce((acc, e) => {
            const at = e?.at
              ? new Date(e.at)
              : e?.date || e?.ts
              ? new Date(e.date || e.ts)
              : null;
            if (!at || isNaN(at)) return acc;
            return !acc || at > acc ? at : acc;
          }, null)
        : null);

    // ================= SPC: lấy điểm từ SportConnect (qua proxy) =================
    // an toàn: không throw; có timeout riêng; chọn bản ghi khớp SĐT nếu có.
    const normDigits = (s) => String(s || "").replace(/\D/g, "");
    const pickBestRecord = (arr, phone) => {
      if (!Array.isArray(arr) || !arr.length) return null;
      const p = normDigits(phone);
      if (p) {
        const hit = arr.find((it) => normDigits(it?.SoDienThoai) === p);
        if (hit) return hit;
      }
      return arr[0]; // fallback: bản ghi đầu
    };

    let spcSingle = null;
    let spcDouble = null;
    let spcMeta = null;

    try {
      const q =
        userDoc.phone ||
        userDoc.nickname ||
        userDoc.name ||
        ""; // ưu tiên SĐT, rồi đến nickname/name

      if (q) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000); // 10s hard timeout

        try {
          const { status, data, proxyUrl } =
            await SportConnectService.listLevelPoint({
              searchCriterial: q,   // hỗ trợ chuỗi có dấu cách
              sportId: 2,
              page: 0,
              waitingInformation: "",
              signal: controller.signal,
            });

          const arr = Array.isArray(data?.data) ? data.data : [];
          const best = pickBestRecord(arr, userDoc.phone);

          if (best && status >= 200 && status < 300) {
            const parseDotNetDate = (s) => {
              const m = String(s || "").match(/\/Date\((\d+)\)\//);
              return m ? new Date(Number(m[1])) : null;
            };
            spcSingle = Number.isFinite(Number(best.DiemDon))
              ? Number(best.DiemDon)
              : null;
            spcDouble = Number.isFinite(Number(best.DiemDoi))
              ? Number(best.DiemDoi)
              : null;

            spcMeta = {
              sportId: best.IDMonTheThao ?? null,
              description: best.DienGiai || null,
              scoredAt: parseDotNetDate(best.ThoiGianCham) || null,
              joinDate: parseDotNetDate(best.JoinDate) || null,
              source: "SportConnect",
              // không trả proxyUrl cho client; nếu cần debug có thể bật thêm field dưới:
              // proxyUrl,
            };
          } else if (!arr.length) {
            console.warn(
              "[getPublicProfile] SPC: không tìm thấy dữ liệu cho:",
              q,
              "status:",
              status
            );
          } else {
            console.warn(
              "[getPublicProfile] SPC: HTTP status",
              status,
              "q=",
              q
            );
          }
        } catch (e) {
          console.warn("[getPublicProfile] SPC fetch error:", e?.message || e);
        } finally {
          clearTimeout(t);
        }
      }
    } catch (e) {
      // tuyệt đối không throw để tránh crash
      console.warn("[getPublicProfile] SPC outer error:", e?.message || e);
    }

    // ===========================================================================

    return res.json({
      ...rest, // toàn bộ thông tin User (trừ password)
      joinedAt: rest.createdAt, // giữ field cũ cho client cũ
      lastLoginAt: lastLogin || null, // đảm bảo luôn có key
      loginHistory: history, // giữ API cũ

      // ➕ Thêm trường SPC cho admin:
      spc: {
        single: spcSingle, // có thể null nếu không có dữ liệu
        double: spcDouble, // có thể null nếu không có dữ liệu
        meta: spcMeta,     // mô tả thêm (null nếu không có)
      },
    });
  }

  // Non-admin: giữ nguyên danh sách field cũ
  const user = await User.findById(req.params.id).select(
    "nickname gender name province createdAt bio avatar"
  );

  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  return res.json({
    nickname: user.nickname,
    gender: user.gender,
    province: user.province,
    name: user.name,
    joinedAt: user.createdAt, // ISO để client convert UTC+7
    bio: user.bio || "",
    avatar: user.avatar || "",
  });
});


function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return dflt;
}

/* ========= helpers chung (normalize/regex/phone) ========= */
function vnNorm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPrefix(q, s) {
  return q && s ? s.startsWith(q) : false;
}

function isSubsequence(q, s) {
  if (!q) return false;
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
}

function phoneVariants(rawDigits) {
  const d = String(rawDigits).replace(/\D/g, "");
  // chuẩn local 0xxxxxxxxx
  let local = d;
  if (d.startsWith("84")) local = "0" + d.slice(2);
  if (d.startsWith("084")) local = "0" + d.slice(3);
  if (!local.startsWith("0")) local = "0" + local;

  const core = local.slice(1);
  const intl84 = "84" + core;
  const plus84 = "+84" + core;

  const arr = [local, intl84, plus84];
  const set = new Set(arr);
  return { local, intl84, plus84, arr, set };
}

export const searchUser = asyncHandler(async (req, res) => {
  const rawQ = String(req.query.q || "").trim();
  const limit = clampInt(req.query.limit, 1, 50, 10);
  if (!rawQ) return res.json([]);

  const qNorm = vnNorm(rawQ);
  const qCompact = qNorm.replace(/\s+/g, "");
  const qTokensRaw = rawQ.split(/\s+/).filter(Boolean); // giữ dấu để regex trực tiếp
  const qTokensNorm = qNorm.split(/\s+/).filter(Boolean); // cho scoring

  const qDigits = rawQ.replace(/\D/g, "");

  // ==== helper: lấy map { userId -> { single, double } } từ Ranking, thiếu thì fallback ScoreHistory ====
  async function getLatestSinglesDoubles(idList = []) {
    if (!idList?.length) return new Map();

    // Lấy SINGLE mới nhất có giá trị
    const singleAgg = await Ranking.aggregate([
      { $match: { user: { $in: idList } } },
      {
        $addFields: {
          _single: {
            $ifNull: ["$single", { $ifNull: ["$singleScore", "$singlePoint"] }],
          },
          _when: {
            $ifNull: ["$effectiveAt", { $ifNull: ["$asOf", "$updatedAt"] }],
          },
        },
      },
      { $match: { _single: { $type: "number" } } },
      { $sort: { user: 1, _when: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$user", single: { $first: "$_single" } } },
    ]);

    // Lấy DOUBLE mới nhất có giá trị
    const doubleAgg = await Ranking.aggregate([
      { $match: { user: { $in: idList } } },
      {
        $addFields: {
          _double: {
            $ifNull: ["$double", { $ifNull: ["$doubleScore", "$doublePoint"] }],
          },
          _when: {
            $ifNull: ["$effectiveAt", { $ifNull: ["$asOf", "$updatedAt"] }],
          },
        },
      },
      { $match: { _double: { $type: "number" } } },
      { $sort: { user: 1, _when: -1, updatedAt: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$user", double: { $first: "$_double" } } },
    ]);

    const map = new Map();
    for (const r of singleAgg)
      map.set(String(r._id), { single: r.single, double: 0 });
    for (const r of doubleAgg) {
      const k = String(r._id);
      const prev = map.get(k) || { single: 0, double: 0 };
      map.set(k, { ...prev, double: r.double });
    }

    // Fallback cho user chưa có Ranking
    const missing = idList.filter((id) => !map.has(String(id)));
    if (missing.length) {
      const hist = await ScoreHistory.aggregate([
        { $match: { user: { $in: missing } } },
        { $sort: { user: 1, scoredAt: -1 } },
        {
          $group: {
            _id: "$user",
            single: { $first: "$single" },
            double: { $first: "$double" },
          },
        },
      ]);
      for (const h of hist) {
        map.set(String(h._id), {
          single: typeof h.single === "number" ? h.single : 0,
          double: typeof h.double === "number" ? h.double : 0,
        });
      }
    }

    return map;
  }
  // ==== end helper ====

  // === PHONE MODE (y như cũ) ===
  const isPhoneQuery = /^\+?\d[\d\s().-]*$/.test(rawQ) && qDigits.length >= 8;
  if (isPhoneQuery) {
    const pv = phoneVariants(qDigits);

    const users = await User.find({ phone: { $in: pv.arr } })
      .select("_id name nickname phone avatar province")
      .limit(10)
      .lean();

    if (!users.length) return res.json([]);

    const idList = users.map((u) => u._id);
    const scoreMap = await getLatestSinglesDoubles(idList);

    return res.json(
      users.map((u) => ({
        _id: u._id,
        name: u.name,
        nickname: u.nickname,
        phone: u.phone,
        avatar: u.avatar,
        province: u.province,
        score: scoreMap.get(String(u._id)) || { single: 0, double: 0 },
      }))
    );
  }

  // ===== TEXT MODE (3 pha) =====
  // PHA 1: prefix & exact (nhanh, dùng index nếu có)
  const orPrefix = [
    { nickname: rawQ },
    { name: rawQ },
    { province: rawQ },
    { nickname: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
    { name: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
    { province: { $regex: "^" + escapeReg(rawQ), $options: "i" } },
  ];

  let users = await User.find({ $or: orPrefix })
    .select("_id name nickname phone avatar province")
    .limit(200)
    .collation({ locale: "vi", strength: 1 })
    .lean();

  // PHA 2: token substring (AND-of-OR) — chạy khi chưa đủ
  if (users.length < limit * 2 && qTokensRaw.length) {
    const andConds = qTokensRaw.map((tk) => ({
      $or: [
        { nickname: { $regex: escapeReg(tk), $options: "i" } },
        { name: { $regex: escapeReg(tk), $options: "i" } },
        { province: { $regex: "^" + escapeReg(tk), $options: "i" } },
      ],
    }));

    const more = await User.find({ $and: andConds })
      .select("_id name nickname phone avatar province")
      .limit(200)
      .lean();

    users = dedupById([...users, ...more]);
  }

  if (!users.length) return res.json([]);

  // ===== SCORING (giữ nguyên) =====
  const scored = users.map((u) => {
    const fields = {
      name: String(u.name || ""),
      nick: String(u.nickname || ""),
      province: String(u.province || ""),
    };
    const norm = {
      name: vnNorm(fields.name),
      nick: vnNorm(fields.nick),
      province: vnNorm(fields.province),
    };

    let score = 0;
    if (qNorm === norm.nick) score += 900;
    if (qNorm === norm.name) score += 800;
    if (isPrefix(qNorm, norm.nick)) score += 700;
    if (isPrefix(qNorm, norm.name)) score += 600;
    if (fields.nick.toLowerCase().includes(rawQ.toLowerCase())) score += 550;
    if (fields.name.toLowerCase().includes(rawQ.toLowerCase())) score += 500;
    if (norm.nick.includes(qNorm)) score += 300;
    if (norm.name.includes(qNorm)) score += 250;
    if (isSubsequence(qCompact, norm.nick.replace(/\s+/g, ""))) score += 220;
    if (isSubsequence(qCompact, norm.name.replace(/\s+/g, ""))) score += 200;

    if (qTokensNorm.length) {
      const nickHits = countTokenHits(qTokensNorm, norm.nick);
      const nameHits = countTokenHits(qTokensNorm, norm.name);
      score += nickHits * 110;
      score += nameHits * 90;
      if (nickHits === qTokensNorm.length) score += 220;
      if (nameHits === qTokensNorm.length) score += 180;
      if (qTokensRaw.length >= 2) {
        const phrase = qTokensRaw.join("\\s+");
        const rePhrase = new RegExp(phrase, "i");
        if (rePhrase.test(fields.nick)) score += 160;
        if (rePhrase.test(fields.name)) score += 140;
      }
    }

    if (qNorm === norm.province) score += 60;
    else if (isPrefix(qNorm, norm.province)) score += 30;

    score -= Math.abs(norm.nick.length - qNorm.length) * 0.2;
    score -= Math.abs(norm.name.length - qNorm.length) * 0.1;

    return { user: u, score };
  });

  // bucket sort + ưu tiên có phone & gần độ dài
  const buckets = new Map();
  let maxB = -Infinity,
    minB = Infinity;
  for (const it of scored) {
    const b = Math.floor(it.score / 10);
    maxB = Math.max(maxB, b);
    minB = Math.min(minB, b);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(it);
  }

  const ranked = [];
  for (let b = maxB; b >= minB && ranked.length < limit * 3; b--) {
    const arr = buckets.get(b);
    if (!arr) continue;
    arr.sort((a, b) => {
      const ap = a.user.phone ? 1 : 0;
      const bp = b.user.phone ? 1 : 0;
      if (ap !== bp) return bp - ap;

      const ad =
        Math.abs(vnNorm(String(a.user.nickname || "")).length - qNorm.length) +
        Math.abs(vnNorm(String(a.user.name || "")).length - qNorm.length);
      const bd =
        Math.abs(vnNorm(String(b.user.nickname || "")).length - qNorm.length) +
        Math.abs(vnNorm(String(b.user.name || "")).length - qNorm.length);
      return ad - bd;
    });
    ranked.push(...arr);
  }

  const topUsers = ranked.slice(0, limit).map((x) => x.user);
  const idList = topUsers.map((u) => u._id);

  // >>> thay lấy điểm ở đây: dùng Ranking trước, fallback ScoreHistory
  const scoreMap = await getLatestSinglesDoubles(idList);

  return res.json(
    ranked.slice(0, limit).map(({ user }) => ({
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      avatar: user.avatar,
      province: user.province,
      score: scoreMap.get(String(user._id)) || { single: 0, double: 0 },
    }))
  );
});

export const getMeWithScore = asyncHandler(async (req, res) => {
  const uid = req.user?._id || req.user?.id;
  if (!uid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await User.findById(uid)
    .select(
      "_id name nickname phone avatar province kycStatus levelPoint role roles isAdmin"
    )
    .lean();

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  // Lấy bản ghi điểm mới nhất
  const last = await ScoreHistory.findOne({ user: user._id })
    .sort({ scoredAt: -1 })
    .select("single double scoredAt")
    .lean();

  const score = {
    single:
      last?.single ?? user?.levelPoint?.single ?? user?.levelPoint?.score ?? 0,
    double: last?.double ?? user?.levelPoint?.double ?? 0,
    scoredAt: last?.scoredAt ?? null,
  };

  // Chuẩn hoá role/roles & isAdmin
  const role = user.role ?? null;
  const roles = Array.isArray(user.roles) ? user.roles : role ? [role] : [];
  const isAdmin = Boolean(
    user.isAdmin || role === "admin" || roles.includes("admin")
  );

  return res.json({
    _id: user._id,
    name: user.name,
    nickname: user.nickname,
    phone: user.phone,
    avatar: user.avatar,
    province: user.province,
    kycStatus: user.kycStatus ?? null,
    role, // ← thêm
    roles, // ← thêm (tuỳ schema)
    isAdmin, // ← thêm (tiện cho FE)
    score, // { single, double, scoredAt }
  });
});

/* ===== helpers mới ===== */
function dedupById(arr) {
  const seen = new Set();
  const out = [];
  for (const u of arr) {
    const k = String(u._id);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(u);
    }
  }
  return out;
}
function countTokenHits(tokensNorm, targetNorm) {
  let hits = 0;
  for (const tk of tokensNorm) if (targetNorm.includes(tk)) hits++;
  return hits;
}
//

export {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
};

function parsePaging(q) {
  let page = parseInt(q.page, 10);
  let limit = parseInt(q.limit, 10);
  if (!Number.isFinite(page) || page <= 0) page = 1;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 200) limit = 50;
  return { page, limit };
}
function parseStatus(status) {
  if (!status) return null;
  const valid = new Set(["upcoming", "ongoing", "finished"]);
  const arr = String(status)
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s));
  return arr.length ? arr : null;
}
function parseBool(v, def = true) {
  if (v === undefined) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
function clamp(n, min, max) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

/**
 * GET /api/me/tournaments
 * Query:
 *   page=1&limit=50
 *   status=ongoing[,finished]
 *   withMatches=1|0      (default 1)
 *   matchLimit=200       (default 200; per tournament)
 * Return:
 *   { items:[{...tournament, matches:[...] }], meta:{...} }
 */
export async function listMyTournaments(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { page, limit } = parsePaging(req.query);
    const statusFilter = parseStatus(req.query.status);
    const withMatches = parseBool(req.query.withMatches, true);
    const matchLimit = clamp(req.query.matchLimit ?? 200, 1, 500);

    const userIdObj = new mongoose.Types.ObjectId(userId);

    const pipeline = [
      // 1) Mọi đăng ký mà user là player1 hoặc player2
      {
        $match: {
          $or: [{ "player1.user": userIdObj }, { "player2.user": userIdObj }],
        },
      },

      // 2) Gom theo tournament (tránh trùng nếu user có nhiều đăng ký)
      {
        $group: {
          _id: "$tournament",
          myRegistrationIds: { $addToSet: "$_id" },
          firstJoinedAt: { $min: "$createdAt" },
          paidAny: {
            $max: { $cond: [{ $eq: ["$payment.status", "Paid"] }, 1, 0] },
          },
          checkedAny: {
            $max: { $cond: [{ $ifNull: ["$checkinAt", false] }, 1, 0] },
          },
        },
      },

      // 🔒 BẢO HIỂM: luôn cho myRegistrationIds là mảng
      {
        $addFields: {
          myRegistrationIds: { $ifNull: ["$myRegistrationIds", []] },
        },
      },

      // 3) Join sang tournaments
      {
        $lookup: {
          from: "tournaments",
          localField: "_id",
          foreignField: "_id",
          as: "tournament",
        },
      },
      { $unwind: "$tournament" },

      // 4) (tuỳ chọn) lọc status
      ...(statusFilter
        ? [{ $match: { "tournament.status": { $in: statusFilter } } }]
        : []),

      // 5) Nếu cần, kéo matches của CHÍNH user trong từng tournament
      ...(withMatches
        ? [
            {
              $lookup: {
                from: "matches",
                let: {
                  tourId: "$_id",
                  regIds: { $ifNull: ["$myRegistrationIds", []] }, // ✅ luôn mảng
                  uid: userIdObj,
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$tournament", "$$tourId"] },
                          {
                            $or: [
                              { $in: ["$pairA", "$$regIds"] },
                              { $in: ["$pairB", "$$regIds"] },
                              {
                                $in: [
                                  "$$uid",
                                  { $ifNull: ["$participants", []] },
                                ],
                              }, // ✅ luôn mảng
                            ],
                          },
                        ],
                      },
                    },
                  },
                  {
                    $sort: { stageIndex: 1, round: 1, order: 1, createdAt: 1 },
                  },
                  { $limit: matchLimit },

                  // pairA → registrations -> lấy player1/player2
                  {
                    $lookup: {
                      from: "registrations",
                      localField: "pairA",
                      foreignField: "_id",
                      as: "pairAReg",
                    },
                  },
                  {
                    $unwind: {
                      path: "$pairAReg",
                      preserveNullAndEmptyArrays: true,
                    },
                  },

                  // pairB → registrations -> lấy player1/player2
                  {
                    $lookup: {
                      from: "registrations",
                      localField: "pairB",
                      foreignField: "_id",
                      as: "pairBReg",
                    },
                  },
                  {
                    $unwind: {
                      path: "$pairBReg",
                      preserveNullAndEmptyArrays: true,
                    },
                  },

                  // Project shape gọn cho FE
                  {
                    $project: {
                      _id: 1,
                      status: 1,
                      winner: 1, // "A" | "B" | ""
                      round: 1,
                      rrRound: 1,
                      swissRound: 1,
                      phase: 1,
                      branch: 1,
                      format: 1,
                      scheduledAt: 1,
                      courtName: "$courtLabel",
                      sets: {
                        $map: {
                          input: { $ifNull: ["$gameScores", []] },
                          as: "s",
                          in: {
                            a: { $ifNull: ["$$s.a", 0] },
                            b: { $ifNull: ["$$s.b", 0] },
                          },
                        },
                      },
                      teamA: {
                        players: {
                          $filter: {
                            input: [
                              {
                                user: "$pairAReg.player1.user",
                                fullName: "$pairAReg.player1.fullName",
                                nickName: "$pairAReg.player1.nickName",
                                avatar: "$pairAReg.player1.avatar",
                                phone: "$pairAReg.player1.phone",
                                score: "$pairAReg.player1.score",
                              },
                              {
                                user: "$pairAReg.player2.user",
                                fullName: "$pairAReg.player2.fullName",
                                nickName: "$pairAReg.player2.nickName",
                                avatar: "$pairAReg.player2.avatar",
                                phone: "$pairAReg.player2.phone",
                                score: "$pairAReg.player2.score",
                              },
                            ],
                            as: "p",
                            cond: { $ne: ["$$p.user", null] },
                          },
                        },
                      },
                      teamB: {
                        players: {
                          $filter: {
                            input: [
                              {
                                user: "$pairBReg.player1.user",
                                fullName: "$pairBReg.player1.fullName",
                                nickName: "$pairBReg.player1.nickName",
                                avatar: "$pairBReg.player1.avatar",
                                phone: "$pairBReg.player1.phone",
                                score: "$pairBReg.player1.score",
                              },
                              {
                                user: "$pairBReg.player2.user",
                                fullName: "$pairBReg.player2.fullName",
                                nickName: "$pairBReg.player2.nickName",
                                avatar: "$pairBReg.player2.avatar",
                                phone: "$pairBReg.player2.phone",
                                score: "$pairBReg.player2.score",
                              },
                            ],
                            as: "p",
                            cond: { $ne: ["$$p.user", null] },
                          },
                        },
                      },
                    },
                  },

                  // Chuẩn hóa thành mảng teams
                  {
                    $project: {
                      _id: 1,
                      status: 1,
                      winner: 1,
                      round: 1,
                      rrRound: 1,
                      swissRound: 1,
                      phase: 1,
                      branch: 1,
                      format: 1,
                      scheduledAt: 1,
                      courtName: 1,
                      sets: 1,
                      teams: ["$teamA", "$teamB"],
                    },
                  },
                ],
                as: "matches",
              },
            },
          ]
        : []),

      // 6) sort tournaments (mới trước)
      { $sort: { "tournament.startAt": -1, "tournament.createdAt": -1 } },

      // 7) phân trang
      {
        $facet: {
          total: [{ $count: "count" }],
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$total.count", 0] }, 0] },
          items: 1,
        },
      },
    ];

    const agg = await Registration.aggregate(pipeline);
    const total = agg?.[0]?.total ?? 0;
    const rows = agg?.[0]?.items ?? [];

    const items = rows.map((r) => {
      const t = r.tournament || {};
      return {
        _id: t._id,
        name: t.name,
        image: t.image ?? null,
        location: t.location ?? "",
        eventType: t.eventType, // "single" | "double"
        status: t.status, // "upcoming" | "ongoing" | "finished"
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
        startAt: t.startAt ?? null,
        endAt: t.endAt ?? null,
        myRegistrationIds: r.myRegistrationIds || [],
        joinedAt: r.firstJoinedAt || null,
        paidAny: !!r.paidAny,
        checkedAny: !!r.checkedAny,
        matches: r.matches || [], // 👈 danh sách trận của user trong giải
      };
    });

    return res.json({
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[listMyTournaments] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// controllers/userController.js
export const softDeleteMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("_id isDeleted");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Idempotent: nếu đã xóa mềm rồi thì chỉ logout và trả 204
  if (user.isDeleted === true) {
    res.clearCookie("jwt");
    return res.status(204).end();
  }

  // ✅ Chỉ bật cờ isDeleted, không thay đổi bất kỳ field nào khác
  user.isDeleted = true;
  await user.save({ validateModifiedOnly: true });

  // (tuỳ chọn) revoke session hiện tại
  res.clearCookie("jwt");
  return res.status(204).end();
});

/**
 * GET /api/users/me
 * Yêu cầu: đã đăng nhập (protect)
 * Trả về: thông tin cơ bản + evaluator capability (enabled + gradingScopes)
 */
/**
 * GET /api/users/me
 * Yêu cầu: protect (đã đăng nhập)
 */
export const getMe = asyncHandler(async (req, res) => {
  const meId = req.user?._id;
  if (!meId) {
    res.status(401);
    throw new Error("Không xác thực");
  }

  // Chạy song song 3 truy vấn
  const [me, participated, staffScored] = await Promise.all([
    User.findById(meId)
      .select(
        "_id name email role nickname phone gender province avatar verified cccdStatus createdAt updatedAt evaluator"
      )
      .lean(),
    (async () => {
      try {
        return await Registration.hasParticipated(meId);
      } catch {
        return false;
      }
    })(),
    (async () => {
      try {
        // Đã được mod/admin chấm: scoreBy != self hoặc selfScored = false
        const exists = await Assessment.exists({
          user: meId,
          $or: [
            { "meta.scoreBy": { $in: ["admin", "mod", "moderator"] } },
            { "meta.selfScored": false },
          ],
        });
        return !!exists;
      } catch {
        return false;
      }
    })(),
  ]);

  if (!me) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  const isScoreVerified = Boolean(participated || staffScored);

  res.json({
    _id: me._id,
    name: me.name || "",
    email: me.email || "",
    role: me.role,
    nickname: me.nickname || "",
    phone: me.phone || "",
    gender: me.gender || "unspecified",
    province: me.province || "",
    avatar: me.avatar || "",
    verified: me.verified || "pending",
    cccdStatus: me.cccdStatus || "unverified",
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,
    isScoreVerified, // <-- NEW
    evaluator: {
      enabled: !!me?.evaluator?.enabled,
      gradingScopes: {
        provinces: me?.evaluator?.gradingScopes?.provinces || [],
        sports: me?.evaluator?.gradingScopes?.sports || ["pickleball"],
      },
    },
  });
});

const allowedSources = new Set([
  "live",
  "video",
  "tournament",
  "other",
  "self",
]);

const MIN_RATING = 2.0;
const MAX_RATING = 8.0;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrUndef = (v) =>
  v === undefined || v === null || v === "" ? undefined : Number(v);
const inRange = (v, min, max) => isNum(v) && v >= min && v <= max;

// Kiểm tra: user đã thi đấu ÍT NHẤT 1 giải đã kết thúc?
async function hasFinishedTournament(userId) {
  const now = new Date();
  const agg = await Registration.aggregate([
    {
      $match: {
        $or: [{ "player1.user": userId }, { "player2.user": userId }],
      },
    },
    {
      $lookup: {
        from: "tournaments",
        localField: "tournament",
        foreignField: "_id",
        as: "tour",
        pipeline: [{ $project: { status: 1, finishedAt: 1, endAt: 1 } }],
      },
    },
    {
      $addFields: {
        status: { $ifNull: [{ $arrayElemAt: ["$tour.status", 0] }, ""] },
        finishedAt: { $arrayElemAt: ["$tour.finishedAt", 0] },
        endAt: { $arrayElemAt: ["$tour.endAt", 0] },
      },
    },
    {
      $addFields: {
        tourFinished: {
          $or: [
            { $eq: ["$status", "finished"] },
            { $ne: ["$finishedAt", null] },
            { $lt: ["$endAt", now] },
          ],
        },
      },
    },
    { $match: { tourFinished: true } },
    { $limit: 1 },
  ]);
  return agg.length > 0;
}

export const createEvaluation = asyncHandler(async (req, res) => {
  const meId = req.user?._id;
  if (!meId) {
    res.status(401);
    throw new Error("Không xác thực");
  }

  const targetUser = String(req.body?.targetUser || "").trim();
  if (!mongoose.isValidObjectId(targetUser)) {
    res.status(400);
    throw new Error("targetUser không hợp lệ");
  }

  const sourceRaw = String(req.body?.source || "other").trim();
  const sourceParsed = allowedSources.has(sourceRaw) ? sourceRaw : "other";

  let items = [];
  if (Array.isArray(req.body?.items)) {
    items = req.body.items.map((it) => {
      const key = String(it?.key || "").trim();
      const score = Number(it?.score);
      const weight = it?.weight === undefined ? 1 : Number(it?.weight);
      const note = String(it?.note || "").trim();
      if (!key) throw new Error("Mục chấm (items) thiếu 'key'");
      if (!isNum(score) || score < 0 || score > 10)
        throw new Error("Điểm rubric phải 0–10");
      if (!isNum(weight) || weight <= 0)
        throw new Error("Trọng số (weight) > 0");
      return { key, score, weight, note };
    });
  }

  const singles = numOrUndef(req.body?.overall?.singles);
  const doubles = numOrUndef(req.body?.overall?.doubles);
  if (singles !== undefined && !inRange(singles, MIN_RATING, MAX_RATING)) {
    res.status(400);
    throw new Error(`Điểm đơn phải trong khoảng ${MIN_RATING} - ${MAX_RATING}`);
  }
  if (doubles !== undefined && !inRange(doubles, MIN_RATING, MAX_RATING)) {
    res.status(400);
    throw new Error(`Điểm đôi phải trong khoảng ${MIN_RATING} - ${MAX_RATING}`);
  }
  if (!items.length && singles === undefined && doubles === undefined) {
    res.status(400);
    throw new Error("Phải có ít nhất một rubric item hoặc điểm tổng (overall)");
  }

  function hasFullProvinceScope(me) {
    const scope = me?.evaluator?.gradingScopes;
    if (!scope) return false;
    if (scope.all === true || scope.isAll === true || scope.full === true)
      return true;
    if (typeof scope === "string" && ["ALL", "*", "__ALL__"].includes(scope))
      return true;
    if (scope.provinces === "ALL" || scope.provinces === "*") return true;
    return false;
  }

  // ✅ helper: xác định tournament còn hiệu lực (upcoming/ongoing)
  function isUpcomingOrOngoing(t, now = new Date()) {
    const s = t.startAt || t.startDate || t.date;
    const e = t.endAt || t.endDate || t.toDate;
    if (s && e) return (s <= now && e >= now) || s >= now; // ongoing hoặc upcoming
    if (s && !e) return s >= now || s <= now; // có start
    if (!s && e) return e >= now; // chỉ có end
    return true; // thiếu thông tin => coi là hợp lệ để không bỏ sót (có thể siết lại nếu cần)
  }

  // ✅ helper: cập nhật điểm đăng ký bằng Registration + bulkWrite
  async function updateActiveRegistrations(session, userId, sVal, dVal) {
    if (sVal === undefined && dVal === undefined) {
      return {
        registrationsMatched: 0,
        registrationsUpdated: 0,
        tournamentsAffected: 0,
      };
    }

    // tìm các registration mà user này là player1 hoặc player2
    const regs = await Registration.find({
      $or: [{ "player1.user": userId }, { "player2.user": userId }],
    })
      .select("player1 player2 tournament")
      .populate(
        "tournament",
        "eventType startAt endAt startDate endDate date toDate status"
      )
      .session(session);

    const ops = [];
    const affectedTournaments = new Set();

    for (const reg of regs) {
      const tour = reg.tournament;
      if (!tour) continue;
      if (!isUpcomingOrOngoing(tour)) continue;

      // xác định score cần set theo loại giải
      const isSingle = String(tour.eventType || "").toLowerCase() === "single";
      const newScore = isSingle ? sVal : dVal;
      if (newScore === undefined) continue;

      // nếu user ở slot nào thì set slot đó
      if (reg.player1?.user && String(reg.player1.user) === String(userId)) {
        if (reg.player1.score !== newScore) {
          ops.push({
            updateOne: {
              filter: { _id: reg._id, "player1.user": userId },
              update: { $set: { "player1.score": newScore } },
            },
          });
          affectedTournaments.add(String(tour._id));
        }
      }
      if (reg.player2?.user && String(reg.player2.user) === String(userId)) {
        if (reg.player2.score !== newScore) {
          ops.push({
            updateOne: {
              filter: { _id: reg._id, "player2.user": userId },
              update: { $set: { "player2.score": newScore } },
            },
          });
          affectedTournaments.add(String(tour._id));
        }
      }
    }

    if (!ops.length) {
      return {
        registrationsMatched: regs.length,
        registrationsUpdated: 0,
        tournamentsAffected: affectedTournaments.size,
      };
    }

    const result = await Registration.bulkWrite(ops, {
      session,
      ordered: false,
    });
    const updated = result.modifiedCount ?? result.result?.nModified ?? 0;

    return {
      registrationsMatched: regs.length,
      registrationsUpdated: updated,
      tournamentsAffected: affectedTournaments.size,
    };
  }

  const session = await mongoose.startSession();
  let evaluationDoc,
    historyDoc,
    selfAssessmentId = null,
    officialAssessmentId = null,
    registrationUpdates = {
      registrationsMatched: 0,
      registrationsUpdated: 0,
      tournamentsAffected: 0,
    };

  try {
    await session.withTransaction(async () => {
      const me = await User.findById(meId).session(session);
      if (!me) throw new Error("Không xác thực");

      const target = await User.findById(targetUser)
        .select("_id name nickname province")
        .session(session);
      if (!target) {
        const e = new Error("Không tìm thấy người được chấm");
        e.statusCode = 404;
        throw e;
      }

      const targetProvince = String(target.province || "").trim();
      const isAdminRole = me.role === "admin";
      const isEvaluatorEnabled = !!me?.evaluator?.enabled;
      const fullProvince = hasFullProvinceScope(me);
      const scopedProvinces = me?.evaluator?.gradingScopes?.provinces || [];
      const inScopedProvince = !!(
        targetProvince &&
        Array.isArray(scopedProvinces) &&
        scopedProvinces.includes(targetProvince)
      );

      const canEval =
        isAdminRole ||
        (isEvaluatorEnabled && (fullProvince || inScopedProvince));
      if (!canEval) {
        const e = new Error(
          targetProvince
            ? "Bạn không có quyền chấm người dùng thuộc tỉnh này"
            : "Bạn không có quyền chấm người dùng chưa khai báo tỉnh"
        );
        e.statusCode = 403;
        throw e;
      }
      if (String(me._id) === String(target._id)) {
        const e = new Error("Không thể tự chấm chính mình");
        e.statusCode = 400;
        throw e;
      }

      const rawNote = String(req.body?.notes || "").trim();
      const scorerName =
        (me?.nickname && String(me.nickname).trim()) ||
        (me?.name && String(me.name).trim()) ||
        (me?.email && String(me.email).trim()) ||
        `UID:${me._id}`;
      const finalNote = rawNote
        ? `Mod "${scorerName}" chấm trình, Ghi chú thêm: ${rawNote}`
        : `Mod "${scorerName}" chấm trình`;

      const existedSelf = !!(await Assessment.exists({
        user: target._id,
        "meta.selfScored": true,
      }).session(session));
      const hasCompetedFinished = await hasFinishedTournament(target._id);
      const shouldAutoSelf = !existedSelf && !hasCompetedFinished;

      // 1) Evaluation
      evaluationDoc = await Evaluation.create(
        [
          {
            evaluator: me._id,
            targetUser: target._id,
            province: targetProvince || null,
            source: sourceParsed,
            items,
            overall: {
              ...(singles !== undefined ? { singles } : {}),
              ...(doubles !== undefined ? { doubles } : {}),
            },
            notes: finalNote,
            status: "submitted",
          },
        ],
        { session }
      ).then((a) => a[0]);

      // 2) ScoreHistory
      historyDoc = await ScoreHistory.create(
        [
          {
            user: target._id,
            scorer: me._id,
            single: singles,
            double: doubles,
            note: finalNote,
            scoredAt: new Date(),
          },
        ],
        { session }
      ).then((a) => a[0]);

      // 3) Upsert Ranking
      const $set = { lastUpdated: new Date() };
      if (singles !== undefined) $set.single = singles;
      if (doubles !== undefined) $set.double = doubles;
      await Ranking.findOneAndUpdate(
        { user: target._id },
        { $set, $setOnInsert: { points: 0, mix: 0, reputation: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
      );

      // 4) OFFICIAL Assessment (meta.scoreBy = "mod")
      let sLv, dLv, singleScore, doubleScore;
      if (singles !== undefined || doubles !== undefined) {
        sLv = normalizeDupr(Number(singles ?? doubles ?? MIN_RATING));
        dLv = normalizeDupr(Number(doubles ?? singles ?? MIN_RATING));
        singleScore = rawFromDupr(sLv);
        doubleScore = rawFromDupr(dLv);
      }

      const [officialAss] = await Assessment.create(
        [
          {
            user: target._id,
            scorer: me._id,
            items: [],
            ...(singleScore !== undefined ? { singleScore } : {}),
            ...(doubleScore !== undefined ? { doubleScore } : {}),
            ...(sLv !== undefined ? { singleLevel: sLv } : {}),
            ...(dLv !== undefined ? { doubleLevel: dLv } : {}),
            meta: { selfScored: false, scoreBy: "mod" },
            note: finalNote,
            scoredAt: new Date(),
          },
        ],
        { session }
      );
      officialAssessmentId = officialAss?._id || null;

      // 5) Auto self nếu cần
      if (shouldAutoSelf) {
        const sLv2 = normalizeDupr(Number(singles ?? doubles ?? MIN_RATING));
        const dLv2 = normalizeDupr(Number(doubles ?? singles ?? MIN_RATING));
        const singleScore2 = rawFromDupr(sLv2);
        const doubleScore2 = rawFromDupr(dLv2);
        const evalTs = evaluationDoc?.createdAt
          ? new Date(evaluationDoc.createdAt).getTime()
          : Date.now();
        const scoredAt = new Date(evalTs + 1);
        const [selfDoc] = await Assessment.create(
          [
            {
              user: target._id,
              scorer: target._id,
              items: [],
              singleScore: singleScore2,
              doubleScore: doubleScore2,
              singleLevel: sLv2,
              doubleLevel: dLv2,
              meta: { selfScored: true },
              note: "Tự chấm trình (mod hỗ trợ)",
              scoredAt,
            },
          ],
          { session }
        );
        selfAssessmentId = selfDoc?._id || null;
      }

      // 6) ✅ Cập nhật điểm đăng ký ở các giải upcoming/ongoing qua Registration
      registrationUpdates = await updateActiveRegistrations(
        session,
        target._id,
        singles,
        doubles
      );
    });

    await session.endSession();

    return res.status(201).json({
      ok: true,
      message: "Đã ghi nhận phiếu chấm",
      selfAssessmentId,
      officialAssessmentId,
      registrationUpdates, // { registrationsMatched, registrationsUpdated, tournamentsAffected }
      evaluation: {
        _id: evaluationDoc._id,
        targetUser: evaluationDoc.targetUser,
        evaluator: evaluationDoc.evaluator,
        province: evaluationDoc.province,
        source: evaluationDoc.source,
        items: evaluationDoc.items,
        overall: evaluationDoc.overall,
        notes: evaluationDoc.notes,
        status: evaluationDoc.status,
        createdAt: evaluationDoc.createdAt,
      },
      scoreHistory: {
        _id: historyDoc._id,
        user: historyDoc.user,
        scorer: historyDoc.scorer,
        single: historyDoc.single,
        double: historyDoc.double,
        note: historyDoc.note,
        scoredAt: historyDoc.scoredAt,
      },
    });
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    await session.endSession().catch(() => {});
    const code = err?.statusCode || 500;
    res.status(code);
    throw new Error(err?.message || "Không thể tạo phiếu chấm");
  }
});
