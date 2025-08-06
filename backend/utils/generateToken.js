// utils/generateToken.js
import jwt from "jsonwebtoken";

/**
 * Ghi token vào cookie `jwt`.
 * @param {Response} res    express response
 * @param {Object}  user   mongoose doc (đã có _id, role)
 */
const generateToken = (res, user) => {
  const isProd = process.env.NODE_ENV === "production";
  const rootDomain = process.env.COOKIE_DOMAIN; 
  //  🔑  payload gồm cả userId & role
  const token = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  // cookie 30 ngày – secure ngoài dev
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: isProd, // bắt buộc https ở prod
    sameSite: isProd ? "None" : "Lax", // "None" để chấp nhận cross-site khi cần
    domain: rootDomain, // bỏ trống => host-only
    path: "/", // mọi route đều nhận
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 ngày
  });
};

export default generateToken;
