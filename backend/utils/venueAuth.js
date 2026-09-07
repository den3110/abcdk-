import Venue from "../models/venueModel.js";
import VenueStaff from "../models/venueStaffModel.js";
import {
  ALL_VENUE_PERMISSIONS,
  effectivePermissions,
} from "./venuePermissions.js";

/** Admin / superuser */
export function isAdminLike(user) {
  if (!user) return false;
  return Boolean(
    user.isAdmin ||
      user.isSuperUser ||
      user.role === "admin" ||
      (Array.isArray(user.roles) && user.roles.includes("admin")),
  );
}

/** Có vai trò chủ sân (hoặc admin) */
export function isCourtOwnerLike(user) {
  if (!user) return false;
  if (isAdminLike(user)) return true;
  return (
    user.role === "courtOwner" ||
    (Array.isArray(user.roles) && user.roles.includes("courtOwner"))
  );
}

/**
 * User có quyền quản lý venue này không (admin / owner / manager).
 * Dùng cho các thao tác cấp chủ sân. Nhân viên quyền hạn chế KHÔNG pass hàm này —
 * hãy dùng venueCan(user, venue, "<perm>").
 */
export async function canManageVenue(user, venueOrId) {
  if (!user) return false;
  if (isAdminLike(user)) return true;

  let venue = venueOrId;
  if (!venue || typeof venue !== "object" || venue.owner === undefined) {
    venue = await Venue.findById(venueOrId).select("owner managers").lean();
  }
  if (!venue) return false;

  const uid = String(user._id);
  if (String(venue.owner) === uid) return true;
  if (
    Array.isArray(venue.managers) &&
    venue.managers.some((m) => String(m) === uid)
  ) {
    return true;
  }
  return false;
}

/**
 * Giải quyền của user với 1 venue → { role, permissions, canManage }.
 * role: "admin" | "owner" | "manager" | "cashier" | "staff" | null
 * canManage = true nếu là admin/owner/manager (toàn quyền cấp chủ sân).
 */
export async function resolveVenueAccess(user, venueOrId) {
  if (!user) return { role: null, permissions: [], canManage: false };
  if (isAdminLike(user)) {
    return { role: "admin", permissions: ALL_VENUE_PERMISSIONS, canManage: true };
  }

  let venue = venueOrId;
  if (!venue || typeof venue !== "object" || venue.owner === undefined) {
    venue = await Venue.findById(venueOrId).select("owner managers").lean();
  }
  if (!venue) return { role: null, permissions: [], canManage: false };

  const uid = String(user._id);
  if (String(venue.owner) === uid) {
    return { role: "owner", permissions: ALL_VENUE_PERMISSIONS, canManage: true };
  }
  if (Array.isArray(venue.managers) && venue.managers.some((m) => String(m) === uid)) {
    return { role: "manager", permissions: ALL_VENUE_PERMISSIONS, canManage: true };
  }

  const staff = await VenueStaff.findOne({
    venue: venue._id || venueOrId,
    user: uid,
    active: true,
  }).lean();
  if (staff) {
    return {
      role: staff.role || "staff",
      permissions: effectivePermissions(staff.role, staff.permissions),
      canManage: staff.role === "manager",
      staffId: String(staff._id),
    };
  }
  return { role: null, permissions: [], canManage: false };
}

/** User có quyền `perm` với venue không (owner/manager/admin luôn true). */
export async function venueCan(user, venueOrId, perm) {
  const access = await resolveVenueAccess(user, venueOrId);
  if (access.canManage) return true;
  return perm ? access.permissions.includes(perm) : false;
}

/** User có BẤT KỲ quyền nào trong `perms` với venue không (owner/manager/admin luôn true). */
export async function venueCanAny(user, venueOrId, perms = []) {
  const access = await resolveVenueAccess(user, venueOrId);
  if (access.canManage) return true;
  return perms.some((p) => access.permissions.includes(p));
}
