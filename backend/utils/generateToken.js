// utils/generateToken.js
import jwt from "jsonwebtoken";

/**
 * Ghi token vào cookie `jwt`.
 * @param {Response} res    express response
 * @param {Object}  user   mongoose doc (đã có _id, role)
 */
const generateToken = (res, user) => {
  const isProd = process.env.NODE_ENV === "production";
  //  🔑  payload gồm cả userId & role
  const token = jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  // cookie 30 ngày – secure ngoài dev
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: isProd, // phải TRUE khi SameSite=None
    sameSite: isProd ? "none" : "lax", // dev vẫn dùng Lax để khỏi cần https
    domain: isProd ? ".example.com" : undefined, // bao phủ cả app & api
    path: "/", // mặc định "/" cho an toàn
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
};

export default generateToken;
