import asyncHandler from 'express-async-handler';
import Registration from '../models/registrationModel.js';
import Tournament from '../models/tournamentModel.js';

/* Tạo đăng ký */
export const createRegistration = asyncHandler(async (req, res) => {
  const { id } = req.params; // tournamentId
  const { player1, player2, message } = req.body;

  const tour = await Tournament.findById(id);
  if (!tour) { res.status(404); throw new Error('Tournament not found'); }

  const reg = await Registration.create({ tournament: id, player1, player2, message });

  tour.registered = (tour.registered || 0) + 1;
  await tour.save();

  res.status(201).json(reg);
});

/* Lấy danh sách đăng ký */
export const getRegistrations = asyncHandler(async (req, res) => {
  console.log(req.params.id)
  const regs = await Registration.find({ tournament: req.params.id }).sort({ createdAt: -1 });
  res.json(regs);
});

/* Cập nhật trạng thái lệ phí */
export const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const { status } = req.body; // 'Đã nộp' | 'Chưa nộp'

  const reg = await Registration.findById(regId);
  if (!reg) { res.status(404); throw new Error('Registration not found'); }

  reg.payment.status = status;
  reg.payment.paidAt = status === 'Đã nộp' ? new Date() : undefined;
  await reg.save();

  res.json(reg);
});

/* Check‑in */
export const checkinRegistration = asyncHandler(async (req, res) => {
  const { regId } = req.params;
  const reg = await Registration.findById(regId);
  if (!reg) { res.status(404); throw new Error('Registration not found'); }

  reg.checkinAt = new Date();
  await reg.save();

  res.json(reg);
});
