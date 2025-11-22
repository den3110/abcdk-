// graphql/context.js
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";           // ⚠️ path này đúng với cấu trúc backend hiện tại
import { createLoaders } from "./loaders/index.js";

export async function buildContext({ req }) {
  const loaders = createLoaders();

  // 1) Ưu tiên lấy user từ middleware attachJwtIfPresent (cookie)
  let user = req.user || null;

  // 2) Nếu chưa có user thì thử đọc Authorization: Bearer <token>
  if (!user) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded?.id) {
            user = await User.findById(decoded.id).select("-password");
          }
        } catch (err) {
          console.warn("[GraphQL] Invalid JWT in Authorization header:", err.message);
          // ❗ KHÔNG throw – cứ để user = null, query me sẽ trả null chứ không crash
        }
      }
    }
  }

  const requestId =
    req.headers["x-request-id"] ||
    `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    user: user || null,
    loaders,
    requestId,
    req,
  };
}
