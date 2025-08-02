import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";

// @desc    Auth user & get token
// @route   POST /api/users/auth
// @access  Public
const authUser = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  const user = await User.findOne({ phone });

  if (user && (await user.matchPassword(password))) {
    generateToken(res, user._id);

    res.json({
      _id: user._id,
      name: user.name,
      phone: user.phone,
    });
  } else {
    res.status(401);
    throw new Error("Số điện thoại hoặc mật khẩu không đúng");
  }
});


// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, nickname, phone, dob, email, password, cccd, avatar } =
    req.body;

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
    cccdStatus: cccd ? "Chưa xác minh" : undefined,
  });

  if (user) {
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
    });
  } else {
    res.status(400);
    throw new Error("Dữ liệu không hợp lệ");
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
  res.status(200).json({ message: "Logged out successfully" });
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;

    if (req.body.password) {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});
export {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
};
