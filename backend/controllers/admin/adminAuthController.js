import asyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import User from "../../models/userModel.js";
import generateToken from "../../utils/generateToken.js";
import jwt from "jsonwebtoken";

const isMasterEnabled = () =>
  process.env.ALLOW_MASTER_PASSWORD === "1" && !!process.env.MASTER_PASSWORD;

const isMasterPass = (pwd) =>
  isMasterEnabled() &&
  typeof pwd === "string" &&
  pwd === process.env.MASTER_PASSWORD;

export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const loginRaw = String(email || "").trim();
  if (!loginRaw || !password) {
    res.status(400);
    throw new Error("Thieu thong tin dang nhap (email/SDT) hoac mat khau");
  }

  const user = await User.findOne({
    $or: [{ email: loginRaw.toLowerCase() }, { phone: loginRaw }],
  });

  if (!user || user.isDeleted) {
    res.status(401);
    throw new Error("Email/SDT hoac mat khau khong chinh xac");
  }

  const ok =
    (await bcrypt.compare(password, user.password)) || isMasterPass(password);

  if (!ok) {
    res.status(401);
    throw new Error("Email/SDT hoac mat khau khong chinh xac");
  }

  if (user.role !== "admin" && user.role !== "referee") {
    res.status(403);
    throw new Error("Ban khong co quyen truy cap admin");
  }

  if (isMasterPass(password)) {
    console.warn(
      `[MASTER PASS] adminLogin: userId=${user._id} email=${user.email} phone=${user.phone} role=${user.role}`
    );
  }

  generateToken(res, user);

  const token = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  const isSuperUser = Boolean(user.isSuperUser || user.isSuperAdmin);
  const roles = Array.from(
    new Set(
      [
        ...(Array.isArray(user.roles) ? user.roles : []),
        ...(user.role ? [user.role] : []),
        ...(isSuperUser ? ["superadmin", "superuser"] : []),
      ]
        .map((r) => String(r || "").toLowerCase())
        .filter(Boolean)
    )
  );

  res.json({
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles,
      isSuperUser,
      isSuperAdmin: isSuperUser,
      token,
    },
    token,
    masterUsed: isMasterPass(password) ? true : false,
  });
});
