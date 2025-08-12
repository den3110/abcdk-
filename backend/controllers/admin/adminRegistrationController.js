import Registration from "../../models/registrationModel.js";
import asyncHandler from "express-async-handler";
import Tournament from "../../models/tournamentModel.js";

/**
 * @desc    Approve or undo a registration’s payment (Admin)
 * @route   PUT /admin/tournaments/registrations/:regId/payment
 */
export const adminUpdatePayment = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { status } = req.body; // expect "Paid" or "Unpaid"

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  if (!["Paid", "Unpaid"].includes(status)) {
    res.status(400);
    throw new Error("Invalid payment status");
  }

  reg.payment.status = status;
  reg.payment.paidAt = status === "Paid" ? new Date() : null;
  await reg.save();

  res.json(reg);
});

/**
 * @desc    Check-in a registration (Admin)
 * @route   PUT /admin/tournaments/registrations/:regId/checkin
 */
export const adminCheckin = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  reg.checkinAt = new Date();
  await reg.save();

  res.json(reg);
});

/**
 * @route   DELETE /admin/tournaments/registrations/:regId
 */
export const adminDeleteRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;

  const reg = await Registration.findById(regId);
  if (!reg) {
    res.status(404);
    throw new Error("Registration not found");
  }

  // giảm đếm đã đăng ký của giải
  await Tournament.findByIdAndUpdate(reg.tournament, {
    $inc: { registered: -1 },
  });

  await reg.deleteOne();

  res.json({ message: "Deleted" });
});

export const getRegistrationsAdmin = asyncHandler(async (req, res) => {
  const regs = await Registration.find({ tournament: req.params.id })
    .sort({ createdAt: -1 })
    .lean(); // lấy plain objects để dễ sửa

  const out = regs.map((r) => ({
    ...r,
    player1: r.player1 ? { ...r.player1 } : r.player1,
    player2: r.player2 ? { ...r.player2 } : r.player2,
  }));

  res.json(out);
});
