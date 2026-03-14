import express from "express";
import { authorize, protect, protectJwt } from "../middleware/authMiddleware.js";
import {
  getOtaAllowed,
  getRegistrationSettings,
} from "../controllers/systemSettings.controller.js";

const router = express.Router();

router.get("/verify", protectJwt, authorize("admin", "referee"), (req, res) => {
  const { _id, name, email, role } = req.user;
  const isSuperUser = Boolean(req.user?.isSuperUser || req.user?.isSuperAdmin);

  const roles = new Set(
    [
      ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
      ...(role ? [role] : []),
    ]
      .map((r) => String(r || "").toLowerCase())
      .filter(Boolean)
  );

  if (req.user?.isAdmin) roles.add("admin");
  if (isSuperUser) {
    roles.add("admin");
    roles.add("superadmin");
    roles.add("superuser");
  }

  res.json({
    _id,
    name,
    email,
    role,
    roles: Array.from(roles),
    isSuperUser,
    isSuperAdmin: isSuperUser,
  });
});

router.post("/logout", protectJwt, authorize("admin"), (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.clearCookie("jwt", { path: "/" });
  res.status(200).json({ message: "Logged out successfully" });
});

router.get("/system/registration", getRegistrationSettings);
router.get("/system/ota/allowed", getOtaAllowed);

export default router;
