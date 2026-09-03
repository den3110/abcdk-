// controllers/admin/financeController.js
// Quản lý thu/chi giải đấu -> tính lợi nhuận (admin).
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import FinanceEntry from "../../models/financeEntryModel.js";

const TYPES = ["revenue", "expense"];

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildFilter(query) {
  const f = {};
  if (TYPES.includes(query.type)) f.type = query.type;
  if (query.category) f.category = String(query.category).trim();
  if (query.tournamentName)
    f.tournamentName = String(query.tournamentName).trim();
  if (query.tournament && mongoose.isValidObjectId(query.tournament))
    f.tournament = query.tournament;
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    f.occurredAt = {};
    if (from) f.occurredAt.$gte = from;
    if (to) {
      // tính hết ngày "to"
      to.setHours(23, 59, 59, 999);
      f.occurredAt.$lte = to;
    }
  }
  if (query.q) {
    const rx = new RegExp(String(query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    f.$or = [{ note: rx }, { category: rx }, { tournamentName: rx }];
  }
  return f;
}

// POST /api/admin/finance
export const createFinanceEntry = asyncHandler(async (req, res) => {
  const { type, amount, category, tournamentName, tournament, note, occurredAt } =
    req.body || {};
  if (!TYPES.includes(type)) {
    res.status(400);
    throw new Error("type phải là 'revenue' hoặc 'expense'.");
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    res.status(400);
    throw new Error("Số tiền không hợp lệ.");
  }
  const entry = await FinanceEntry.create({
    type,
    amount: Math.round(amt),
    category: String(category || "").trim(),
    tournamentName: String(tournamentName || "").trim(),
    tournament:
      tournament && mongoose.isValidObjectId(tournament) ? tournament : null,
    note: String(note || "").trim(),
    occurredAt: parseDate(occurredAt) || new Date(),
    createdBy: req.user?._id || null,
  });
  res.status(201).json(entry);
});

// GET /api/admin/finance
export const listFinanceEntries = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const filter = buildFilter(req.query);

  const [items, total, totalsAgg] = await Promise.all([
    FinanceEntry.find(filter)
      .sort({ occurredAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    FinanceEntry.countDocuments(filter),
    FinanceEntry.aggregate([
      { $match: filter },
      { $group: { _id: "$type", sum: { $sum: "$amount" } } },
    ]),
  ]);

  let revenue = 0;
  let expense = 0;
  for (const g of totalsAgg) {
    if (g._id === "revenue") revenue = g.sum;
    else if (g._id === "expense") expense = g.sum;
  }

  res.json({
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    totals: { revenue, expense, profit: revenue - expense },
  });
});

// PATCH /api/admin/finance/:id
export const updateFinanceEntry = asyncHandler(async (req, res) => {
  const entry = await FinanceEntry.findById(req.params.id);
  if (!entry) {
    res.status(404);
    throw new Error("Không tìm thấy bút toán.");
  }
  const b = req.body || {};
  if (b.type !== undefined) {
    if (!TYPES.includes(b.type)) {
      res.status(400);
      throw new Error("type không hợp lệ.");
    }
    entry.type = b.type;
  }
  if (b.amount !== undefined) {
    const amt = Number(b.amount);
    if (!Number.isFinite(amt) || amt < 0) {
      res.status(400);
      throw new Error("Số tiền không hợp lệ.");
    }
    entry.amount = Math.round(amt);
  }
  if (b.category !== undefined) entry.category = String(b.category).trim();
  if (b.tournamentName !== undefined)
    entry.tournamentName = String(b.tournamentName).trim();
  if (b.tournament !== undefined)
    entry.tournament =
      b.tournament && mongoose.isValidObjectId(b.tournament)
        ? b.tournament
        : null;
  if (b.note !== undefined) entry.note = String(b.note).trim();
  if (b.occurredAt !== undefined)
    entry.occurredAt = parseDate(b.occurredAt) || entry.occurredAt;
  await entry.save();
  res.json(entry);
});

// DELETE /api/admin/finance/:id
export const deleteFinanceEntry = asyncHandler(async (req, res) => {
  const del = await FinanceEntry.findByIdAndDelete(req.params.id);
  if (!del) {
    res.status(404);
    throw new Error("Không tìm thấy bút toán.");
  }
  res.json({ ok: true, _id: req.params.id });
});

// GET /api/admin/finance/summary
export const financeSummary = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);

  const [byType, byTournament, byCategory, byMonth] = await Promise.all([
    FinanceEntry.aggregate([
      { $match: filter },
      { $group: { _id: "$type", sum: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    FinanceEntry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { name: { $ifNull: ["$tournamentName", ""] }, type: "$type" },
          sum: { $sum: "$amount" },
        },
      },
    ]),
    FinanceEntry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { category: { $ifNull: ["$category", ""] }, type: "$type" },
          sum: { $sum: "$amount" },
        },
      },
    ]),
    FinanceEntry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            ym: {
              $dateToString: {
                format: "%Y-%m",
                date: "$occurredAt",
                timezone: "+07:00",
              },
            },
            type: "$type",
          },
          sum: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.ym": 1 } },
    ]),
  ]);

  let revenue = 0;
  let expense = 0;
  for (const g of byType) {
    if (g._id === "revenue") revenue = g.sum;
    else if (g._id === "expense") expense = g.sum;
  }

  // gom theo giải
  const tMap = new Map();
  for (const g of byTournament) {
    const name = g._id.name || "(Chung / không thuộc giải)";
    if (!tMap.has(name)) tMap.set(name, { name, revenue: 0, expense: 0 });
    const o = tMap.get(name);
    if (g._id.type === "revenue") o.revenue += g.sum;
    else o.expense += g.sum;
  }
  const tournaments = [...tMap.values()]
    .map((o) => ({ ...o, profit: o.revenue - o.expense }))
    .sort((a, b) => b.profit - a.profit);

  // gom theo hạng mục
  const cMap = new Map();
  for (const g of byCategory) {
    const name = g._id.category || "(Không phân loại)";
    if (!cMap.has(name)) cMap.set(name, { name, revenue: 0, expense: 0 });
    const o = cMap.get(name);
    if (g._id.type === "revenue") o.revenue += g.sum;
    else o.expense += g.sum;
  }
  const categories = [...cMap.values()].sort(
    (a, b) => b.revenue + b.expense - (a.revenue + a.expense),
  );

  // gom theo tháng
  const mMap = new Map();
  for (const g of byMonth) {
    const ym = g._id.ym;
    if (!mMap.has(ym)) mMap.set(ym, { month: ym, revenue: 0, expense: 0 });
    const o = mMap.get(ym);
    if (g._id.type === "revenue") o.revenue += g.sum;
    else o.expense += g.sum;
  }
  const months = [...mMap.values()]
    .map((o) => ({ ...o, profit: o.revenue - o.expense }))
    .sort((a, b) => a.month.localeCompare(b.month));

  res.json({
    totals: { revenue, expense, profit: revenue - expense },
    tournaments,
    categories,
    months,
  });
});
