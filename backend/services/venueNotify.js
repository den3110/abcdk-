// services/venueNotify.js — tiện ích push + in-app dùng chung cho cụm sân (booking, gói, nhân viên)
import Venue from "../models/venueModel.js";
import VenueStaff from "../models/venueStaffModel.js";
import { effectivePermissions, VENUE_ROLE_LABEL } from "../utils/venuePermissions.js";
import { publishNotification, EVENTS } from "./notifications/notificationHub.js";
import { createInAppNotifications } from "./inAppNotify.js";

export const fmtVND = (n) => `${(Number(n) || 0).toLocaleString("vi-VN")}đ`;

/**
 * Người nhận thông báo của 1 cụm sân theo quyền `perm`:
 * chủ sân + quản lý (managers) + nhân viên/thu ngân active có quyền tương ứng.
 */
export async function venueStaffIds(venueId, perm = "bookings.manage") {
  const v = await Venue.findById(venueId).select("owner managers").lean();
  if (!v) return [];
  const ids = new Set([v.owner, ...(v.managers || [])].filter(Boolean).map(String));
  const staff = await VenueStaff.find({ venue: venueId, active: true })
    .select("user role permissions")
    .lean();
  for (const s of staff) {
    if (effectivePermissions(s.role, s.permissions).includes(perm)) ids.add(String(s.user));
  }
  return [...ids];
}

/** Gửi push realtime + lưu in-app cho danh sách user (bỏ actor ra khỏi người nhận). */
export async function pushToUsers({ recipients, actorId, type = "BOOKING", title, body, url, data }) {
  const list = (Array.isArray(recipients) ? recipients : [recipients])
    .filter(Boolean)
    .map(String)
    .filter((id) => id !== String(actorId || ""));
  if (!list.length) return;
  await Promise.allSettled([
    createInAppNotifications({ recipients: list, actorId: actorId || null, type, title, body, url, data }),
    ...list.map((userId) =>
      publishNotification(EVENTS.USER_DIRECT_BROADCAST, { userId, title, body, url }).catch(() => {}),
    ),
  ]);
}

/* ---------- Gói giờ / thẻ tháng ---------- */

/** Khách mua gói → báo chủ sân / người có quyền packages.manage duyệt kích hoạt. */
export async function notifyPackagePurchased(venue, purchase, buyer) {
  await pushToUsers({
    recipients: await venueStaffIds(venue._id, "packages.manage"),
    actorId: buyer?._id,
    title: "🎟️ Có lượt mua gói chờ kích hoạt",
    body: `${buyer?.name || "Khách"} mua "${purchase.packageName}" · ${fmtVND(purchase.price)} — xác nhận đã nhận tiền để kích hoạt`,
    url: `/owner/venues/${venue._id}`,
    data: { kind: "package_purchased", venueId: String(venue._id), purchaseId: String(purchase._id) },
  });
}

/** Chủ sân kích hoạt gói → báo khách. */
export async function notifyPackageActivated(purchase, actorId) {
  await pushToUsers({
    recipients: purchase.user,
    actorId,
    title: "✅ Gói đã được kích hoạt",
    body: `"${purchase.packageName}" đã sẵn sàng — dùng để thanh toán khi đặt sân.`,
    url: "/courts/my-packages",
    data: { kind: "package_activated", purchaseId: String(purchase._id) },
  });
}

/* ---------- Nhân viên ---------- */

/** Được thêm / đổi vai trò làm nhân viên cụm sân. */
export async function notifyStaffAssigned(venue, userId, role, actorId) {
  await pushToUsers({
    recipients: userId,
    actorId,
    title: "👥 Bạn được thêm vào cụm sân",
    body: `Bạn là ${VENUE_ROLE_LABEL[role] || "nhân viên"} tại ${venue.name}. Mở tab "Quản lý sân" để bắt đầu.`,
    url: `/owner/venues/${venue._id}`,
    data: { kind: "staff_assigned", venueId: String(venue._id), role },
  });
}
