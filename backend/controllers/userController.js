import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import ScoreHistory from "../models/scoreHistoryModel.js";

// @desc    Auth user & get token
// @route   POST /api/users/auth
// @access  Public
// controllers/userController.js
const authUser = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  const user = await User.findOne({ phone });

  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error("Số điện thoại hoặc mật khẩu không đúng");
  }

  // ✅ Tạo cookie JWT
  generateToken(res, user);

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
    verified: user.verified, // "Chờ xác thực" / "Xác thực"
    cccdStatus: user.cccdStatus, // "Chưa xác minh" / "Đã xác minh"
    ratingSingle: user.ratingSingle,
    ratingDouble: user.ratingDouble,
    createdAt: user.createdAt,
    cccd: user.cccd,
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
  } = req.body;

  // Check trùng email, phone, nickname
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

  // Check CCCD nếu có nhập
  if (cccd) {
    const existing = await User.findOne({ cccd });
    if (existing) {
      res.status(400);
      throw new Error("CCCD đã được sử dụng cho tài khoản khác");
    }
  }

  const user = await User.create({
    name,
    nickname,
    phone,
    dob,
    email,
    password,
    avatar: avatar || "",
    cccd: cccd || null,
    cccdStatus: cccd ? "unverified" : undefined,
    province,
  });

  if (!user) {
    res.status(400);
    throw new Error("Dữ liệu không hợp lệ");
  }

  // 🔽 Upsert Ranking ngay sau khi tạo user
  try {
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
      { upsert: true }
    );
  } catch (err) {
    // Nếu unique index đã có và có race => 11000: có thể bỏ qua an toàn
    if (err?.code !== 11000) {
      console.error("Create ranking failed:", err);
      // tuỳ chính sách: không nên chặn đăng ký, nên chỉ log
    }
  }

  // Trả response
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
  });
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

  const { name, nickname, phone, dob, province, cccd, email, password, gender } =
    req.body;

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
  if (dob !== undefined) user.dob = dob;
  if (province !== undefined) user.province = province;
  if (cccd !== undefined) user.cccd = cccd;
  if (email !== undefined) user.email = email;
  if (gender !== undefined) user.gender= gender
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
    gender: updatedUser.gender
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
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  // Khớp tuyệt đối (không lấy fuzzy để tránh sai)
  const user = await User.findOne({
    $or: [{ phone: q }, { nickname: q }],
  }).select("name phone nickname avatar province");

  if (!user) return res.json([]);

  // lấy điểm trình mới nhất
  const last = await ScoreHistory.findOne({ user: user._id })
    .sort({ scoredAt: -1 })
    .select("single double");
  res.json([{ ...user.toObject(), score: last || { single: 0, double: 0 } }]);
});

export {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
};
