// graphql/context.js
import jwt from "jsonwebtoken";
import User from "../models/userModel.js";           // ⚠️ path này đúng với cấu trúc backend hiện tại
import { createLoaders } from "./loaders/index.js";
import { extractBearerToken } from "../utils/authToken.js";

export async function buildContext({ req }) {
  const loaders = createLoaders();

  // 1) Ưu tiên lấy user từ middleware attachJwtIfPresent (cookie)
  let user = req.user || null;

  // 2) Nếu chưa có user thì thử đọc Authorization: Bearer <token>
  if (!user) {
    const token = extractBearerToken(req.headers?.authorization);
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded?.userId || decoded?.id || decoded?._id;
        if (userId) {
          user = await User.findById(userId).select("-password");
        }
      } catch (err) {
        console.warn("[GraphQL] Invalid JWT in Authorization header:", err.message);
        // ❗ KHÔNG throw – cứ để user = null, query me sẽ trả null chứ không crash
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
