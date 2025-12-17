import express from "express";
import {
  createTicket,
  listMyTickets,
  getMyTicketDetail,
  addMyMessage,
  adminListTickets,
  adminReply,
} from "../controllers/supportController.js";

import { authorize, protect } from "../middleware/authMiddleware.js";
// TODO: đổi middleware này theo hệ thống bạn (admin / isSuperUser)

const router = express.Router();

// user
router.route("/tickets").get(protect, listMyTickets).post(protect, createTicket);
router.route("/tickets/:id").get(protect, getMyTicketDetail);
router.route("/tickets/:id/messages").post(protect, addMyMessage);

// staff/admin
router.route("/admin/tickets").get(protect, authorize("admin"), adminListTickets);
router.route("/admin/tickets/:id/messages").post(protect, authorize("admin"), adminReply);

export default router;
