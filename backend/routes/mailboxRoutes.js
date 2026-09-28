import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  testAccount,
  getFolders,
  getMessages,
  getOneMessage,
  getAttachment,
  markMessage,
  moveMessage,
  deleteMessage,
  sendMessage,
} from "../controllers/admin/mailboxController.js";

const router = express.Router();

// Toàn bộ hộp thư chỉ dành cho admin.
router.use(protect, authorize("admin"));

// Cấu hình tài khoản hộp thư
router.get("/accounts", listAccounts);
router.post("/accounts", createAccount);
router.put("/accounts/:id", updateAccount);
router.delete("/accounts/:id", deleteAccount);
router.post("/accounts/:id/test", testAccount);

// Thao tác thư theo từng hộp thư
router.get("/:id/folders", getFolders);
router.get("/:id/messages", getMessages);
router.get("/:id/message", getOneMessage);
router.get("/:id/attachment", getAttachment);
router.post("/:id/mark", markMessage);
router.post("/:id/move", moveMessage);
router.post("/:id/delete", deleteMessage);
router.post("/:id/send", sendMessage);

export default router;
