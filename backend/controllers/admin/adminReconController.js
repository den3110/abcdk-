import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";

import Venue from "../../models/venueModel.js";
import Booking from "../../models/bookingModel.js";
import VenueSale from "../../models/venueSaleModel.js";
import { isValidDateStr, buildInstant } from "../../utils/venueBooking.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const vnDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** GET /api/admin/venues/reconciliation?from=&to=  — đối soát hoa hồng theo cụm sân */
export const adminReconciliation = expressAsyncHandler(async (req, res) => {
  const today = vnDay();
  let from = isValidDateStr(req.query.from) ? req.query.from : today;
  let to = isValidDateStr(req.query.to) ? req.query.to : today;
  if (from > to) [from, to] = [to, from];
  const fromInstant = buildInstant(from, "00:00");
  const toInstant = new Date(buildInstant(to, "00:00").getTime() + DAY_MS);

  const [paidAgg, salesAgg, venues] = await Promise.all([
    Booking.aggregate([
      { $match: { startAt: { $gte: fromInstant, $lt: toInstant }, "payment.status": "Paid" } },
      { $group: { _id: "$venue", paid: { $sum: "$totalPrice" }, commission: { $sum: "$commissionAmount" }, count: { $sum: 1 } } },
    ]),
    VenueSale.aggregate([
      { $match: { createdAt: { $gte: fromInstant, $lt: toInstant } } },
      { $group: { _id: "$venue", sales: { $sum: "$total" } } },
    ]),
    Venue.find({}).select("name owner commissionPercent bankShortName bankAccountNumber bankAccountName province").populate("owner", "name nickname phone").lean(),
  ]);

  const paidMap = new Map(paidAgg.map((a) => [String(a._id), a]));
  const salesMap = new Map(salesAgg.map((a) => [String(a._id), a.sales]));

  const rows = venues
    .map((v) => {
      const p = paidMap.get(String(v._id)) || { paid: 0, commission: 0, count: 0 };
      const sales = salesMap.get(String(v._id)) || 0;
      const gross = (p.paid || 0) + sales;
      return {
        venueId: v._id,
        venueName: v.name,
        province: v.province,
        owner: v.owner,
        commissionPercent: v.commissionPercent || 0,
        bank: { bankShortName: v.bankShortName, bankAccountNumber: v.bankAccountNumber, bankAccountName: v.bankAccountName },
        bookingsPaid: p.paid || 0,
        salesRevenue: sales,
        grossRevenue: gross,
        commission: p.commission || 0,
        netPayout: gross - (p.commission || 0),
        paidCount: p.count || 0,
      };
    })
    .filter((r) => r.grossRevenue > 0 || r.commissionPercent > 0)
    .sort((a, b) => b.grossRevenue - a.grossRevenue);

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.grossRevenue,
      commission: acc.commission + r.commission,
      net: acc.net + r.netPayout,
    }),
    { gross: 0, commission: 0, net: 0 },
  );

  res.json({ from, to, rows, totals });
});

/** PATCH /api/admin/venues/:id/commission  { commissionPercent } */
export const adminSetCommission = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const pct = Math.max(0, Math.min(100, Number(req.body?.commissionPercent) || 0));
  const v = await Venue.findByIdAndUpdate(id, { $set: { commissionPercent: pct } }, { new: true }).select("name commissionPercent").lean();
  if (!v) {
    res.status(404);
    throw new Error("Không tìm thấy cụm sân");
  }
  res.json(v);
});
