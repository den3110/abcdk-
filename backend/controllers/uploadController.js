import User from "../models/userModel.js";
import { notifyNewKyc } from "../services/telegram/telegramNotifyKyc.js";

export const uploadCccd = async (req, res) => {
  if (!req.files || !req.files.front || !req.files.back)
    return res.status(400).json({ message: "Thiếu file ảnh" });

  const cccd = String(req.body?.cccd || req.user?.cccd || "").trim();
  if (!/^\d{12}$/.test(cccd)) {
    return res.status(400).json({
      message: "Vui lòng nhập số CCCD hợp lệ trước khi gửi xác minh",
    });
  }

  if (
    req.user.cccdStatus === "verified" &&
    req.user.cccd &&
    req.user.cccd !== cccd
  ) {
    return res.status(400).json({
      message: "CCCD đã được xác minh và không thể thay đổi",
    });
  }

  const duplicated = await User.findOne({
    _id: { $ne: req.user._id },
    cccd,
    isDeleted: { $ne: true },
  }).select("_id");
  if (duplicated) {
    return res.status(409).json({ message: "CCCD đã được sử dụng" });
  }

  const { front, back } = req.files;
  const urls = {
    front: `/${front[0].path.replace(/\\/g, "/")}`,
    back: `/${back[0].path.replace(/\\/g, "/")}`,
  };

  req.user.cccd = cccd;
  req.user.cccdImages = urls;
  req.user.cccdStatus = "pending";
  await req.user.save();
  notifyNewKyc(req.user).catch((e) =>
    console.error("Telegram notify error:", e),
  );

  res.status(201).json({
    message: "Upload thành công, đang chờ xác minh",
    cccdImages: urls,
    cccdStatus: "pending",
  });
};
