import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import ScoreHistory from "../models/scoreHistoryModel.js";
import Ranking from "../models/rankingModel.js";
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
    token
  });
});

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const {
    name,
    nickname,
    phone,
    dob,
    email,
    password,
    cccd,
    avatar,
    province,
    gender
  } = req.body;

  // (không bắt buộc) pre-check để trả message friendly sớm
  // -> vẫn giữ, nhưng race-condition sẽ được chặn thêm bởi unique index + catch E11000
  const duplicate = await User.findOne({
    $or: [{ email }, { phone }, { nickname }],
  });
  if (duplicate) {
    if (duplicate.email === email) {
      res.status(400);
      throw new Error("Email đã tồn tại");
    }
    if (duplicate.phone === phone) {
      res.status(400);
      throw new Error("Số điện thoại đã tồn tại");
    }
    if (duplicate.nickname === nickname) {
      res.status(400);
      throw new Error("Nickname đã tồn tại");
    }
  }
  if (cccd) {
    const existing = await User.findOne({ cccd });
    if (existing) {
      res.status(400);
      throw new Error("CCCD đã được sử dụng cho tài khoản khác");
    }
  }

  const session = await mongoose.startSession();
  let user; // để dùng sau khi commit
  try {
    await session.withTransaction(async () => {
      // tạo user trong transaction
      const doc = {
        name,
        nickname,
        phone,
        dob,
        email,
        password,
        avatar: avatar || "",
        province,
        gender
      };
      if (cccd) {
        doc.cccd = cccd;
        doc.cccdStatus = "unverified";
      }

      // dùng create([],{session}) để chắc chắn gắn session
      const created = await User.create([doc], { session });
      user = created[0];

      if (!user) {
        throw new Error("Dữ liệu không hợp lệ");
      }

      // upsert ranking trong cùng transaction
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

    // ✅ ra khỏi withTransaction là đã commit
    generateToken(res, user._id);
    res.status(201).json({
      _id: user._id,
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      dob: user.dob,
      email: user.email,
      avatar: user.avatar,
      cccd: user.cccd,
      cccdStatus: user.cccdStatus,
      province: user.province,
      gender: user.gender
    });
  } catch (err) {
    // map lỗi duplicate key → message thân thiện
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

    // lỗi khác
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
  if (email !== undefined && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

export const searchUser = asyncHandler(async (req, res) => {
  const rawQ = String(req.query.q || "").trim();
  const limit = clampInt(req.query.limit, 1, 50, 10);
  if (!rawQ) return res.json([]);

  const qNorm = vnNorm(rawQ);
  const qCompact = qNorm.replace(/\s+/g, "");
  const qTokensRaw = rawQ.split(/\s+/).filter(Boolean);       // giữ dấu để regex trực tiếp
  const qTokensNorm = qNorm.split(/\s+/).filter(Boolean);     // cho scoring

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
      { $group: { _id: "$user", single: { $first: "$single" }, double: { $first: "$double" } } },
    ]);
    const scoreMap = new Map(
      lastScores.map((s) => [String(s._id), { single: s.single || 0, double: s.double || 0 }])
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
      score += nameHits * 90;  // mỗi token match trong name

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
  let maxB = -Infinity, minB = Infinity;
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
    { $group: { _id: "$user", single: { $first: "$single" }, double: { $first: "$double" } } },
  ]);
  const scoreMap = new Map(
    lastScores.map((s) => [String(s._id), { single: s.single || 0, double: s.double || 0 }])
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
    if (!seen.has(k)) { seen.add(k); out.push(u); }
  }
  return out;
}
function countTokenHits(tokensNorm, targetNorm) {
  let hits = 0;
  for (const tk of tokensNorm) if (targetNorm.includes(tk)) hits++;
  return hits;
}

export {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
};
