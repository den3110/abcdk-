import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { registerMachine, listMachines, proxyCall } from "../controllers/liveControlController.js";

const router = express.Router();
const admin = authorize("admin");

// Desktop app đăng ký máy (admin auth — desktop đã đăng nhập admin).
router.post("/register", protect, admin, express.json(), registerMachine);
// App liệt kê máy + proxy điều khiển.
router.get("/machines", protect, admin, listMachines);
router.post("/:machineId/call", protect, admin, express.json(), proxyCall);

export default router;
