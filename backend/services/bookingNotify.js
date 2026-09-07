// services/bookingNotify.js — push + thông báo in-app cho các sự kiện đặt sân
import { pushToUsers as send, venueStaffIds, fmtVND } from "./venueNotify.js";

const fmtTime = (d) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(d));

/**
 * kind: created | proof_submitted | approved | rejected | cancelled_by_customer |
 *       cancelled_by_owner | reminder | checked_in | expired
 */
export async function notifyBooking(kind, booking, { actorId, venueName, courtName, reason } = {}) {
  const b = booking;
  const when = fmtTime(b.startAt);
  const vName = venueName || "sân";
  const cName = courtName ? ` · ${courtName}` : "";
  const customerUrl = `/my-bookings?booking=${b._id}`;
  const ownerUrl = `/owner/venues/${b.venue}/bookings?booking=${b._id}`;
  const data = { kind, bookingId: String(b._id), venueId: String(b.venue) };

  switch (kind) {
    case "created":
      return send({
        recipients: await venueStaffIds(b.venue),
        actorId,
        title: "🎾 Có lượt đặt sân mới",
        body: `${b.customerName || "Khách"} đặt ${vName}${cName} lúc ${when} · ${fmtVND(b.totalPrice)}`,
        url: ownerUrl,
        data,
      });
    case "proof_submitted":
      return send({
        recipients: await venueStaffIds(b.venue),
        actorId,
        title: "💸 Khách đã gửi bill chuyển khoản",
        body: `${b.customerName || "Khách"} · ${b.code} · ${fmtVND(b.totalPrice)} — vào duyệt đơn`,
        url: ownerUrl,
        data,
      });
    case "approved":
      return send({
        recipients: b.user,
        actorId,
        title: "✅ Đặt sân đã được xác nhận",
        body: `${vName}${cName} · ${when}. Mở vé QR để check-in tại sân.`,
        url: customerUrl,
        data,
      });
    case "owner_created":
      return send({
        recipients: b.user,
        actorId,
        title: "🎾 Bạn có lượt đặt sân mới",
        body: `${vName}${cName} · ${when} đã được đặt cho bạn. Mở vé QR để check-in.`,
        url: customerUrl,
        data,
      });
    case "rejected":
      return send({
        recipients: b.user,
        actorId,
        title: "❌ Bill chưa được chấp nhận",
        body: reason
          ? `Lý do: ${reason}. Vui lòng gửi lại bill.`
          : "Vui lòng kiểm tra và gửi lại bill chuyển khoản.",
        url: customerUrl,
        data,
      });
    case "cancelled_by_customer":
      return send({
        recipients: await venueStaffIds(b.venue),
        actorId,
        title: "Khách đã huỷ lượt đặt",
        body: `${b.customerName || "Khách"} huỷ ${b.code} · ${when}${reason ? ` · ${reason}` : ""}`,
        url: ownerUrl,
        data,
      });
    case "cancelled_by_owner":
      return send({
        recipients: b.user,
        actorId,
        title: "Lượt đặt sân đã bị huỷ",
        body: `${vName}${cName} · ${when}${reason ? ` · ${reason}` : ""}`,
        url: customerUrl,
        data,
      });
    case "reminder":
      return send({
        recipients: b.user,
        title: "⏰ Sắp tới giờ chơi",
        body: `${vName}${cName} lúc ${when}. Mang vé QR để check-in nhé!`,
        url: customerUrl,
        data,
      });
    case "checked_in":
      return send({
        recipients: b.user,
        actorId,
        title: "🎫 Đã check-in",
        body: `Chúc bạn chơi vui tại ${vName}${cName}!`,
        url: customerUrl,
        data,
      });
    case "expired":
      return send({
        recipients: b.user,
        title: "Lượt đặt đã hết hạn",
        body: `${b.code} bị huỷ do chưa thanh toán trong 15 phút. Bạn có thể đặt lại.`,
        url: customerUrl,
        data,
      });
    default:
      return undefined;
  }
}
