// utils/clubVisibility.js
export function canReadClubContent(club, reqUserId, isMember) {
  // CLB 'hidden' → chỉ thành viên / quản trị xem được nội dung
  if (club.visibility === "hidden") return isMember;
  // 'private' & 'public': xem tiếp ở cấp item (public/members)
  return true;
}

export function itemVisibleToUser(itemVisibility, club, isMember) {
  if (club.visibility === "hidden") return isMember; // override
  if (itemVisibility === "public") return true;
  return isMember;
}
