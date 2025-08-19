// src/controllers/adminUserController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../../models/userModel.js";
import { buildAutoUsers } from "../../services/userAutoGen.js";

const sanitizeOut = (u) => {
  const obj = { ...u };
  delete obj.password;
  delete obj.emailGenerator;
  delete obj.phoneGenerator;
  delete obj.nicknameGenerator;
  return obj;
};

/** Xem trước (không ghi DB) */
export const previewAutoUsers = asyncHandler(async (req, res) => {
  const options = req.body || {};
  const draft = await buildAutoUsers(options, { checkUniqueness: true, dryRun: true });
  res.json({ ok: true, count: draft.length, users: draft.map(sanitizeOut) });
});

/** Tạo thật (ghi DB) */
export const createAutoUsers = asyncHandler(async (req, res) => {
  const options = req.body || {};
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const drafts = await buildAutoUsers(options, { checkUniqueness: true, dryRun: false });

    const results = [];
    for (const draft of drafts) {
      const plainPassword = draft.__plainPassword;
      delete draft.__plainPassword;

      let saved;
      let tries = 0;

      while (!saved && tries < 5) {
        try {
          const u = new User(draft);
          const doc = await u.save({ session });
          saved = doc;
        } catch (err) {
          if (err?.code === 11000) {
            // Duplicate key -> regenerate các field unique và thử lại
            tries++;
            if (err.keyPattern?.email && typeof draft.emailGenerator === "function") {
              draft.email = await draft.emailGenerator();
            }
            if (draft.role === "user") {
              if (err.keyPattern?.phone && typeof draft.phoneGenerator === "function") {
                draft.phone = await draft.phoneGenerator();
              }
              if (err.keyPattern?.nickname && typeof draft.nicknameGenerator === "function") {
                draft.nickname = await draft.nicknameGenerator();
              }
            }
          } else {
            throw err;
          }
        }
      }

      if (!saved) throw new Error("Không thể lưu user sau nhiều lần thử.");

      const safe = sanitizeOut(saved.toObject());
      results.push({ ...safe, plainPassword });
    }

    await session.commitTransaction();
    res.status(201).json({ ok: true, created: results.length, users: results });
  } catch (err) {
    // gợi ý status 400 cho lỗi validate/duplicate; asyncHandler sẽ đẩy qua error middleware
    if (!res.headersSent) res.status(400);
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
});
