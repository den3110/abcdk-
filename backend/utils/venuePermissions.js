// utils/venuePermissions.js — danh mục quyền & vai trò nhân viên cụm sân (dùng chung BE/FE)

/** Danh mục quyền chi tiết. key dùng để kiểm tra, label để hiển thị. */
export const VENUE_PERMISSIONS = [
  { key: "bookings.view", label: "Xem lịch đặt sân", group: "Đặt sân" },
  { key: "bookings.manage", label: "Duyệt / huỷ / check-in đơn", group: "Đặt sân" },
  { key: "pos.sell", label: "Bán hàng tại quầy", group: "Bán hàng" },
  { key: "pos.products", label: "Quản lý sản phẩm & kho", group: "Bán hàng" },
  { key: "events.manage", label: "Quản lý sự kiện (xé vé / social)", group: "Sự kiện" },
  { key: "packages.manage", label: "Quản lý gói giờ / thẻ tháng", group: "Vận hành" },
  { key: "promos.manage", label: "Quản lý mã giảm giá", group: "Vận hành" },
  { key: "blocks.manage", label: "Khoá sân / bảo trì", group: "Vận hành" },
  { key: "recurring.manage", label: "Đặt lịch định kỳ", group: "Vận hành" },
  { key: "analytics.view", label: "Xem phân tích", group: "Báo cáo" },
  { key: "revenue.view", label: "Xem doanh thu", group: "Báo cáo" },
  { key: "venue.edit", label: "Sửa thông tin & giá sân", group: "Quản trị" },
  { key: "staff.manage", label: "Quản lý nhân viên", group: "Quản trị" },
];

export const VENUE_PERMISSION_KEYS = VENUE_PERMISSIONS.map((p) => p.key);
export const ALL_VENUE_PERMISSIONS = [...VENUE_PERMISSION_KEYS];

/** Vai trò dựng sẵn với preset quyền. */
export const VENUE_STAFF_ROLES = ["manager", "cashier", "staff"];
export const VENUE_ROLE_LABEL = {
  manager: "Quản lý",
  cashier: "Thu ngân",
  staff: "Nhân viên",
};
export const VENUE_ROLE_PRESETS = {
  manager: [...VENUE_PERMISSION_KEYS], // toàn quyền như chủ sân (trừ chuyển nhượng)
  cashier: ["bookings.view", "bookings.manage", "pos.sell", "pos.products", "events.manage", "revenue.view"],
  staff: ["bookings.view", "pos.sell"],
};

/** Lọc danh sách quyền hợp lệ, bỏ trùng. */
export function sanitizePermissions(list) {
  const valid = new Set(VENUE_PERMISSION_KEYS);
  return [...new Set((Array.isArray(list) ? list : []).filter((k) => valid.has(k)))];
}

/** Quyền hiệu dụng của 1 nhân viên (manager = full). */
export function effectivePermissions(role, permissions) {
  if (role === "manager") return [...VENUE_PERMISSION_KEYS];
  return sanitizePermissions(permissions);
}
