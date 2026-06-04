import Venue from "../models/venueModel.js";

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
 * venueOrId: id, hoặc doc đã có sẵn { owner, managers }.
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
