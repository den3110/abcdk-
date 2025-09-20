// Trả về số nguyên dương (VND) hoặc 0
const toPositiveInt = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[^0-9.-]/g, ""); // bỏ dấu phẩy, ký tự lạ
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/**
 * Lấy phí đăng ký (VND) cho 1 registration/tournament.
 * Ưu tiên: reg.payment.amount -> tour.registrationFee -> tour.fee -> tour.entryFee
 */
export const getFeeAmount = (tour, reg) => {
  const regAmt = toPositiveInt(reg?.payment?.amount);
  if (regAmt) return regAmt;

  const tourAmt =
    toPositiveInt(tour?.registrationFee) ||
    toPositiveInt(tour?.fee) ||
    toPositiveInt(tour?.entryFee);

  return tourAmt || 0;
};
