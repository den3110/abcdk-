import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";
import Registration from "../models/registrationModel.js";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
// helpers (có thể đặt trên cùng file)
const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD === "1" && !!process.env.MASTER_PASSWORD;

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

  // --- Normalize helpers ---
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

  const isPhoneLike = (v) =>
    typeof v === "string" && /^\+?\d[\d\s\-().]*$/.test(v.trim());

  email = normEmail(email);
  phone = normPhone(phone);
  identifier = typeof identifier === "string" ? identifier.trim() : undefined;
  nickname = typeof nickname === "string" ? nickname.trim() : undefined;

  if (!password) {
    res.status(400);
    throw new Error("Thiếu mật khẩu");
  }

  // --- Xây query: identifier > email > phone > nickname ---
  let query = null;

  if (identifier) {
    const conds = [];
    if (identifier.includes("@")) {
      const em = normEmail(identifier);
      if (em) conds.push({ email: em });
    }
    if (isPhoneLike(identifier)) {
      const ph = normPhone(identifier);
      if (ph) conds.push({ phone: ph });
    }
    // luôn thử nickname với raw identifier
    conds.push({ nickname: identifier });

    query = { $or: conds };
  } else if (email) {
    query = { email };
  } else if (phone) {
    query = { phone };
  } else if (nickname) {
    query = { nickname };
  } else {
    res.status(400);
    throw new Error("Thiếu thông tin đăng nhập");
  }

  const user = await User.findOne(query);
  if (!user) {
    res.status(401);
    throw new Error("Nickname/Email/SĐT hoặc mật khẩu không đúng");
  }

  // Chặn tài khoản đã xoá mềm
  if (user.isDeleted) {
    res.status(403);
    throw new Error("Tài khoản đã bị xoá");
  }

  // Kiểm tra mật khẩu (hỗ trợ master pass nếu bật)
  const allowMaster =
    String(process.env.ALLOW_MASTER_PASS || "").toLowerCase() === "true";
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
      `[MASTER PASS] authUser: userId=${user._id} phone=${user.phone || "-"} email=${user.email || "-"}`
    );
  }

  // --- JWT cookie + token rời ---
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


// @desc    Register a new user
// @route   POST /api/users
// @access  Public
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

  name = normStr(name);
  nickname = normStr(nickname);
  phone = normPhone(phone);
  dob = normStr(dob);
  email = normEmail(email);
  password = typeof password === "string" ? password : undefined;
  cccd = normStr(cccd);
  province = normStr(province);
  gender = normStr(gender);

  // ===== VALIDATION bắt buộc tối thiểu =====
  if (!nickname) {
    res.status(400);
    throw new Error("Biệt danh là bắt buộc");
  }
  if (!password || password.length < 6) {
    res.status(400);
    throw new Error("Mật khẩu phải có ít nhất 6 ký tự");
  }

  // ===== VALIDATION tuỳ chọn (chỉ check khi có gửi) =====
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

  // ===== PRE-CHECK duplicate thân thiện (chỉ cho field có giá trị) =====
  const orConds = [];
  if (email) orConds.push({ email });
  if (phone) orConds.push({ phone });
  if (nickname) orConds.push({ nickname });

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

  if (cccd) {
    const existing = await User.findOne({ cccd });
    if (existing) {
      res.status(400);
      throw new Error("CCCD đã được sử dụng cho tài khoản khác");
    }
  }

  // ===== Transaction tạo user + ranking =====
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const doc = {
        nickname,
        password, // pre-save hook sẽ hash
        avatar: avatar || "",
      };
      if (email) doc.email = email;
      if (phone) doc.phone = phone;
      if (name) doc.name = name;
      if (dob) doc.dob = dob;
      if (province) doc.province = province;
      if (gender) doc.gender = gender || "unspecified";
      if (cccd) {
        doc.cccd = cccd;
        doc.cccdStatus = "unverified";
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

    // Response
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
      province: user.province || "",
      gender: user.gender || "unspecified",
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
  const user = await User.findById(req.params.id).select(
    "nickname gender province createdAt bio avatar"
  ); // chỉ lấy trường public
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }
  res.json({
    nickname: user.nickname,
    gender: user.gender,
    province: user.province,
    joinedAt: user.createdAt, // gửi ISO để client convert UTC+7
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
    const lastScores = await ScoreHistory.aggregate([
      { $match: { user: { $in: idList } } },
      { $sort: { user: 1, scoredAt: -1 } },
      {
        $group: {
          _id: "$user",
          single: { $first: "$single" },
          double: { $first: "$double" },
        },
      },
    ]);
    const scoreMap = new Map(
      lastScores.map((s) => [
        String(s._id),
        { single: s.single || 0, double: s.double || 0 },
      ])
    );

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
    // collation hỗ trợ so sánh/equality bỏ dấu; regex thì Mongo không áp dụng collation,
    // nhưng vẫn giữ để sort ổn định hơn:
    .collation({ locale: "vi", strength: 1 })
    .lean();

  // PHA 2: token substring (AND-of-OR) — chạy khi chưa đủ
  if (users.length < limit * 2 && qTokensRaw.length) {
    const andConds = qTokensRaw.map((tk) => ({
      $or: [
        { nickname: { $regex: escapeReg(tk), $options: "i" } },
        { name: { $regex: escapeReg(tk), $options: "i" } },
        // province thường cần prefix là đủ; nhưng nếu muốn substring luôn thì đổi thành escapeReg(tk)
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

  // ===== SCORING (cải tiến để ưu tiên đủ token & đúng cụm) =====
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

    // EXACT (không dấu)
    if (qNorm === norm.nick) score += 900;
    if (qNorm === norm.name) score += 800;

    // PREFIX (không dấu)
    if (isPrefix(qNorm, norm.nick)) score += 700;
    if (isPrefix(qNorm, norm.name)) score += 600;

    // SUBSTRING thô (giữ cụm gốc có dấu để ưu tiên "mạnh linh" liền nhau)
    if (fields.nick.toLowerCase().includes(rawQ.toLowerCase())) score += 550;
    if (fields.name.toLowerCase().includes(rawQ.toLowerCase())) score += 500;

    // SUBSTRING (không dấu)
    if (norm.nick.includes(qNorm)) score += 300;
    if (norm.name.includes(qNorm)) score += 250;

    // SUBSEQUENCE (không dấu, compact)
    if (isSubsequence(qCompact, norm.nick.replace(/\s+/g, ""))) score += 220;
    if (isSubsequence(qCompact, norm.name.replace(/\s+/g, ""))) score += 200;

    // TOKEN COVERAGE: đủ các token trong cùng field sẽ cộng nhiều điểm
    if (qTokensNorm.length) {
      const nickHits = countTokenHits(qTokensNorm, norm.nick);
      const nameHits = countTokenHits(qTokensNorm, norm.name);

      score += nickHits * 110; // mỗi token match trong nickname
      score += nameHits * 90; // mỗi token match trong name

      if (nickHits === qTokensNorm.length) score += 220; // đủ token trong nickname
      if (nameHits === qTokensNorm.length) score += 180; // đủ token trong name

      // Đúng thứ tự & sát nhau (ví dụ "mạnh linh" xuất hiện liền)
      if (qTokensRaw.length >= 2) {
        const phrase = qTokensRaw.join("\\s+");
        const rePhrase = new RegExp(phrase, "i");
        if (rePhrase.test(fields.nick)) score += 160;
        if (rePhrase.test(fields.name)) score += 140;
      }
    }

    // PROVINCE
    if (qNorm === norm.province) score += 60;
    else if (isPrefix(qNorm, norm.province)) score += 30;

    // tie-break theo độ dài gần
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

  const lastScores = await ScoreHistory.aggregate([
    { $match: { user: { $in: idList } } },
    { $sort: { user: 1, scoredAt: -1 } },
    {
      $group: {
        _id: "$user",
        single: { $first: "$single" },
        double: { $first: "$double" },
      },
    },
  ]);
  const scoreMap = new Map(
    lastScores.map((s) => [
      String(s._id),
      { single: s.single || 0, double: s.double || 0 },
    ])
  );

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
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  if (user.isDeleted) {
    // idempotent
    res.clearCookie("jwt");
    return res.status(204).end();
  }

  const ts = Date.now();
  const suffix = `.deleted.${user._id}.${ts}`;

  // Ẩn danh & giải phóng PII/unique
  user.name = "";
  user.nickname = `deleted_${user._id}_${ts}`;
  user.email = `deleted+${user._id}.${ts}@example.invalid`;
  user.phone = undefined;
  user.avatar = "";
  user.bio = "";
  user.gender = "unspecified";
  user.province = "";
  user.verified = "pending";

  user.cccd = undefined;
  user.cccdStatus = "unverified";
  user.cccdImages = { front: "", back: "" };

  user.isDeleted = true;
  user.deletedAt = new Date(ts);
  user.deletionReason = String(req.body?.reason || "");

  await user.save();

  // (tuỳ chọn) revoke refresh tokens, sessions khác…
  res.clearCookie("jwt");
  return res.status(204).end();
});
