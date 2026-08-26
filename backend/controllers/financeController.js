// controllers/financeController.js
// Quỹ CLB: giao dịch thu/chi + báo cáo + xuất CSV.
// Xem: thành viên (+ admin/owner). Quản lý (thêm/sửa/xoá): admin/owner (gate ở route).
import mongoose from "mongoose";
import ClubTransaction, {
  TX_TYPES,
  TX_METHODS,
} from "../models/clubTransactionModel.js";
import ClubMember from "../models/clubMemberModel.js";

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

function buildFilter(req) {
  const filter = { club: req.club._id };
  const { type, category, from, to, member } = req.query;
  if (TX_TYPES.includes(type)) filter.type = type;
  if (category) filter.category = category;
  if (member && mongoose.isValidObjectId(member)) filter.member = member;
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }
  return filter;
}

/** GET /clubs/:id/finance/transactions — thành viên xem */
export const listTransactions = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới xem được quỹ CLB." });
    }
    const { page = 1, limit = 30 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const filter = buildFilter(req);

    const [items, total] = await Promise.all([
      ClubTransaction.find(filter)
        .sort({ occurredAt: -1, _id: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate("member", USER_FIELDS)
        .populate("createdBy", USER_FIELDS)
        .lean(),
      ClubTransaction.countDocuments(filter),
    ]);
    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listTransactions error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/finance/summary — số dư + tổng thu/chi + theo danh mục + theo tháng */
export const financeSummary = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới xem được quỹ CLB." });
    }
    const clubId = req.club._id;

    // Tổng thu/chi toàn bộ (số dư)
    const totalsAll = await ClubTransaction.aggregate([
      { $match: { club: clubId } },
      { $group: { _id: "$type", sum: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    let totalIncome = 0;
    let totalExpense = 0;
    let countIncome = 0;
    let countExpense = 0;
    for (const t of totalsAll) {
      if (t._id === "income") {
        totalIncome = t.sum;
        countIncome = t.count;
      } else if (t._id === "expense") {
        totalExpense = t.sum;
        countExpense = t.count;
      }
    }

    // Theo danh mục (dùng filter khoảng thời gian nếu có)
    const filter = buildFilter(req);
    const byCategoryRaw = await ClubTransaction.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { type: "$type", category: "$category" },
          sum: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { sum: -1 } },
    ]);
    const byCategory = byCategoryRaw.map((r) => ({
      type: r._id.type,
      category: r._id.category || "Khác",
      sum: r.sum,
      count: r.count,
    }));

    // Theo tháng (12 tháng gần nhất)
    const byMonthRaw = await ClubTransaction.aggregate([
      { $match: { club: clubId } },
      {
        $group: {
          _id: {
            y: { $year: "$occurredAt" },
            m: { $month: "$occurredAt" },
            type: "$type",
          },
          sum: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
    ]);
    const monthMap = {};
    for (const r of byMonthRaw) {
      const key = `${r._id.y}-${String(r._id.m).padStart(2, "0")}`;
      monthMap[key] = monthMap[key] || { month: key, income: 0, expense: 0 };
      if (r._id.type === "income") monthMap[key].income = r.sum;
      else monthMap[key].expense = r.sum;
    }
    const byMonth = Object.values(monthMap).slice(-12);

    return res.json({
      balance: totalIncome - totalExpense,
      totalIncome,
      totalExpense,
      countIncome,
      countExpense,
      byCategory,
      byMonth,
    });
  } catch (err) {
    console.error("financeSummary error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** POST /clubs/:id/finance/transactions — admin thêm */
export const createTransaction = async (req, res) => {
  try {
    const {
      type,
      amount,
      category = "",
      description = "",
      occurredAt,
      method = "cash",
      member,
      attachmentUrl = "",
    } = req.body || {};

    if (!TX_TYPES.includes(type)) {
      return res.status(400).json({ message: "Loại giao dịch không hợp lệ." });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "Số tiền phải lớn hơn 0." });
    }
    const doc = await ClubTransaction.create({
      club: req.club._id,
      type,
      amount: Math.round(amt),
      category: String(category || "").trim().slice(0, 100),
      description: String(description || "").slice(0, 1000),
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      method: TX_METHODS.includes(method) ? method : "cash",
      member: member && mongoose.isValidObjectId(member) ? member : undefined,
      attachmentUrl: String(attachmentUrl || ""),
      createdBy: req.user._id,
    });
    const populated = await ClubTransaction.findById(doc._id)
      .populate("member", USER_FIELDS)
      .populate("createdBy", USER_FIELDS)
      .lean();
    return res.status(201).json(populated);
  } catch (err) {
    console.error("createTransaction error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** PATCH /clubs/:id/finance/transactions/:txId — admin sửa */
export const updateTransaction = async (req, res) => {
  try {
    const tx = await ClubTransaction.findOne({
      _id: req.params.txId,
      club: req.club._id,
    });
    if (!tx) return res.status(404).json({ message: "Không tìm thấy giao dịch." });

    const b = req.body || {};
    if (TX_TYPES.includes(b.type)) tx.type = b.type;
    if (b.amount !== undefined) {
      const amt = Number(b.amount);
      if (!Number.isFinite(amt) || amt <= 0)
        return res.status(400).json({ message: "Số tiền phải lớn hơn 0." });
      tx.amount = Math.round(amt);
    }
    if ("category" in b) tx.category = String(b.category || "").trim().slice(0, 100);
    if ("description" in b) tx.description = String(b.description || "").slice(0, 1000);
    if (b.occurredAt) tx.occurredAt = new Date(b.occurredAt);
    if (TX_METHODS.includes(b.method)) tx.method = b.method;
    if ("member" in b)
      tx.member = b.member && mongoose.isValidObjectId(b.member) ? b.member : undefined;
    if ("attachmentUrl" in b) tx.attachmentUrl = String(b.attachmentUrl || "");

    await tx.save();
    const populated = await ClubTransaction.findById(tx._id)
      .populate("member", USER_FIELDS)
      .populate("createdBy", USER_FIELDS)
      .lean();
    return res.json(populated);
  } catch (err) {
    console.error("updateTransaction error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** DELETE /clubs/:id/finance/transactions/:txId — admin xoá */
export const deleteTransaction = async (req, res) => {
  try {
    const del = await ClubTransaction.deleteOne({
      _id: req.params.txId,
      club: req.club._id,
    });
    if (!del.deletedCount)
      return res.status(404).json({ message: "Không tìm thấy giao dịch." });
    return res.json({ ok: true });
  } catch (err) {
    console.error("deleteTransaction error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

/** GET /clubs/:id/finance/export.csv — thành viên xuất CSV */
export const exportTransactionsCsv = async (req, res) => {
  try {
    const isMember = await resolveIsMember(req);
    if (!isMember) {
      return res
        .status(403)
        .json({ message: "Chỉ thành viên mới xuất được quỹ CLB." });
    }
    const filter = buildFilter(req);
    const rows = await ClubTransaction.find(filter)
      .sort({ occurredAt: -1 })
      .limit(5000)
      .populate("member", USER_FIELDS)
      .populate("createdBy", USER_FIELDS)
      .lean();

    const esc = (v) => {
      const s = String(v == null ? "" : v).replace(/"/g, '""');
      return `"${s}"`;
    };
    const fmtDate = (d) => {
      try {
        return new Date(d).toLocaleString("vi-VN");
      } catch {
        return "";
      }
    };
    const typeLabel = (t) => (t === "income" ? "Thu" : "Chi");
    const methodLabel = (m) =>
      ({ cash: "Tiền mặt", bank: "Ngân hàng", transfer: "Chuyển khoản", momo: "MoMo", other: "Khác" }[m] || m);

    const header = [
      "Ngày",
      "Loại",
      "Số tiền",
      "Danh mục",
      "Phương thức",
      "Thành viên",
      "Mô tả",
      "Người tạo",
    ];
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push(
        [
          fmtDate(r.occurredAt),
          typeLabel(r.type),
          r.amount,
          r.category || "",
          methodLabel(r.method),
          r.member?.fullName || r.member?.nickname || "",
          r.description || "",
          r.createdBy?.fullName || r.createdBy?.nickname || "",
        ]
          .map(esc)
          .join(",")
      );
    }
    const csv = "﻿" + lines.join("\r\n"); // BOM để Excel đọc UTF-8

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="quy-clb-${req.club._id}.csv"`
    );
    return res.send(csv);
  } catch (err) {
    console.error("exportTransactionsCsv error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};
