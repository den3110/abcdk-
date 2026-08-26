// controllers/duesController.js
// Phí hội viên định kỳ: cấu hình + theo dõi đã đóng/còn nợ theo kỳ + ghi vào sổ quỹ.
// Xem: thành viên. Quản lý (đặt cấu hình, ghi đóng): admin/owner (gate ở route).
import mongoose from "mongoose";
import ClubDuesConfig, { DUES_PERIODS } from "../models/clubDuesConfigModel.js";
import ClubDuesPayment from "../models/clubDuesPaymentModel.js";
import ClubMember from "../models/clubMemberModel.js";
import ClubTransaction from "../models/clubTransactionModel.js";

const USER_FIELDS = "fullName nickname avatar";

async function resolveIsMember(req) {
  const meId = req.user?._id ? String(req.user._id) : null;
  if (!meId) return false;
  if (String(req.club.owner) === meId) return true;
  if (req.clubMembership?.status === "active") return true;
  const exists = await ClubMember.exists({
    club: req.club._id,
    user: meId,
    status: "active",
  });
  return !!exists;
}

/** GET /clubs/:id/dues/config */
export const getDuesConfig = async (req, res) => {
  try {
    if (!(await resolveIsMember(req)))
      return res.status(403).json({ message: "Chỉ thành viên mới xem được." });
    const cfg = await ClubDuesConfig.findOne({ club: req.club._id }).lean();
    return res.json(cfg || { amount: 0, period: "monthly", active: false, note: "" });
  } catch (err) {
    console.error("getDuesConfig error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** PUT /clubs/:id/dues/config — admin */
export const setDuesConfig = async (req, res) => {
  try {
    const { amount, period, active, note } = req.body || {};
    const patch = {};
    if (amount !== undefined) patch.amount = Math.max(0, Math.round(Number(amount) || 0));
    if (DUES_PERIODS.includes(period)) patch.period = period;
    if (active !== undefined) patch.active = !!active;
    if (note !== undefined) patch.note = String(note || "").slice(0, 500);
    const cfg = await ClubDuesConfig.findOneAndUpdate(
      { club: req.club._id },
      { $set: patch, $setOnInsert: { club: req.club._id } },
      { new: true, upsert: true }
    ).lean();
    return res.json(cfg);
  } catch (err) {
    console.error("setDuesConfig error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/dues/period?key=YYYY-MM — admin: danh sách thành viên + đã đóng/chưa */
export const getPeriodStatus = async (req, res) => {
  try {
    const periodKey = String(req.query.key || "").trim();
    if (!periodKey) return res.status(400).json({ message: "Thiếu kỳ (key)." });

    const [members, payments, cfg] = await Promise.all([
      ClubMember.find({ club: req.club._id, status: "active" })
        .sort({ joinedAt: 1 })
        .populate("user", USER_FIELDS)
        .lean(),
      ClubDuesPayment.find({ club: req.club._id, periodKey }).lean(),
      ClubDuesConfig.findOne({ club: req.club._id }).lean(),
    ]);

    const payMap = {};
    for (const p of payments) payMap[String(p.member)] = p;

    const items = members
      .filter((m) => m.user)
      .map((m) => {
        const pay = payMap[String(m.user._id)];
        return {
          user: m.user,
          role: m.role,
          paid: !!pay,
          payment: pay
            ? { _id: pay._id, amount: pay.amount, method: pay.method, paidAt: pay.paidAt }
            : null,
        };
      });

    const paidCount = items.filter((i) => i.paid).length;
    const total = payments.reduce((s, p) => s + (p.amount || 0), 0);

    return res.json({
      periodKey,
      config: cfg || { amount: 0, period: "monthly", active: false },
      items,
      summary: {
        memberCount: items.length,
        paidCount,
        unpaidCount: items.length - paidCount,
        total,
      },
    });
  } catch (err) {
    console.error("getPeriodStatus error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/dues/pay — admin ghi 1 thành viên đã đóng (tạo giao dịch thu) */
export const payDues = async (req, res) => {
  try {
    const { member, periodKey, amount, method = "cash" } = req.body || {};
    if (!member || !mongoose.isValidObjectId(member))
      return res.status(400).json({ message: "Thiếu thành viên." });
    if (!periodKey) return res.status(400).json({ message: "Thiếu kỳ." });

    const existed = await ClubDuesPayment.findOne({
      club: req.club._id,
      member,
      periodKey,
    });
    if (existed)
      return res.status(409).json({ message: "Thành viên đã đóng kỳ này." });

    const cfg = await ClubDuesConfig.findOne({ club: req.club._id }).lean();
    const amt = Math.max(0, Math.round(Number(amount ?? cfg?.amount ?? 0)));

    // Tạo giao dịch thu tương ứng trong sổ quỹ
    let tx = null;
    if (amt > 0) {
      tx = await ClubTransaction.create({
        club: req.club._id,
        type: "income",
        amount: amt,
        category: "Phí hội viên",
        description: `Phí hội viên kỳ ${periodKey}`,
        occurredAt: new Date(),
        method,
        member,
        createdBy: req.user._id,
      });
    }

    const pay = await ClubDuesPayment.create({
      club: req.club._id,
      member,
      periodKey,
      amount: amt,
      method,
      paidAt: new Date(),
      transaction: tx?._id,
      recordedBy: req.user._id,
    });
    return res.status(201).json({ ok: true, payment: pay });
  } catch (err) {
    if (err?.code === 11000)
      return res.status(409).json({ message: "Thành viên đã đóng kỳ này." });
    console.error("payDues error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/dues/pay — admin huỷ ghi đóng (xoá cả giao dịch thu) */
export const unpayDues = async (req, res) => {
  try {
    const member = req.body?.member || req.query?.member;
    const periodKey = req.body?.periodKey || req.query?.periodKey;
    if (!member || !periodKey)
      return res.status(400).json({ message: "Thiếu thành viên hoặc kỳ." });

    const pay = await ClubDuesPayment.findOne({
      club: req.club._id,
      member,
      periodKey,
    });
    if (!pay) return res.status(404).json({ message: "Chưa có ghi nhận." });

    if (pay.transaction) {
      await ClubTransaction.deleteOne({ _id: pay.transaction, club: req.club._id });
    }
    await ClubDuesPayment.deleteOne({ _id: pay._id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("unpayDues error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/dues/my — thành viên xem lịch sử đóng phí của chính mình */
export const getMyDues = async (req, res) => {
  try {
    if (!(await resolveIsMember(req)))
      return res.status(403).json({ message: "Chỉ thành viên mới xem được." });
    const [cfg, payments] = await Promise.all([
      ClubDuesConfig.findOne({ club: req.club._id }).lean(),
      ClubDuesPayment.find({ club: req.club._id, member: req.user._id })
        .sort({ periodKey: -1 })
        .lean(),
    ]);
    return res.json({
      config: cfg || { amount: 0, period: "monthly", active: false },
      payments,
    });
  } catch (err) {
    console.error("getMyDues error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
