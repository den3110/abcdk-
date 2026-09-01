/* eslint-disable react/prop-types */
import { useSelector } from "react-redux";
import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";
import { useGetMeQuery } from "../slices/usersApiSlice";
import PhoneActivationDialog from "./PhoneActivationDialog.jsx";

// Khi Admin bật forcePhoneVerification: buộc user đã đăng nhập nhưng chưa kích
// hoạt SĐT phải kích hoạt (hoặc đổi SĐT / đăng xuất) trước khi dùng tiếp.
export default function PhoneVerificationGate() {
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: appInit } = useGetAppInitQuery();
  const { data: me } = useGetMeQuery(undefined, { skip: !userInfo });

  const force = appInit?.publicUi?.forcePhoneVerification === true;
  // Admin buộc RIÊNG tài khoản này (dù toàn hệ thống không bật force).
  const userRequired = me?.phoneVerificationRequired === true;
  const verified = (me?.phoneVerified ?? userInfo?.phoneVerified) === true;
  const needed = (force || userRequired) && !!userInfo && !verified;

  if (!needed) return null;
  return <PhoneActivationDialog open force />;
}
