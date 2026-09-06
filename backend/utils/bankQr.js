/** Bỏ dấu tiếng Việt cho nội dung chuyển khoản. */
export function normalizeNoAccent(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * URL ảnh QR chuyển khoản (chuẩn VietQR qua sepay) tới STK chủ sân.
 * Số tiền = toàn bộ tiền sân (khách thanh toán 100% qua QR rồi gửi bill).
 * Trả "" nếu sân chưa cấu hình STK.
 */
export function buildBookingQrUrl(venue, booking) {
  const bank = venue?.bankShortName || venue?.qrBank || "";
  const acc = venue?.bankAccountNumber || venue?.qrAccount || "";
  if (!bank || !acc) return "";
  const amount = Number(booking?.totalPrice) || 0;
  const des = normalizeNoAccent(`DAT SAN ${booking?.code || ""}`);
  const params = new URLSearchParams({ bank, acc, des, template: "compact" });
  if (amount > 0) params.set("amount", String(amount));
  return `https://qr.sepay.vn/img?${params.toString()}`;
}

/** Thông tin chuyển khoản hiển thị cho khách. */
export function bookingBankInfo(venue, booking) {
  return {
    bankShortName: venue?.bankShortName || venue?.qrBank || "",
    bankAccountNumber: venue?.bankAccountNumber || venue?.qrAccount || "",
    bankAccountName: venue?.bankAccountName || "",
    amount: Number(booking?.totalPrice) || 0,
    memo: normalizeNoAccent(`DAT SAN ${booking?.code || ""}`),
    qrUrl: buildBookingQrUrl(venue, booking),
  };
}
