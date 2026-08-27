/* eslint-disable react/prop-types */
import { useState } from "react";
import { useSelector } from "react-redux";
import { Alert, Button, Chip, Stack } from "@mui/material";
import VerifiedRoundedIcon from "@mui/icons-material/VerifiedRounded";
import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";
import { useGetMeQuery } from "../slices/usersApiSlice";
import PhoneActivationDialog from "./PhoneActivationDialog.jsx";

// Thẻ kích hoạt SĐT trong hồ sơ. Hiển thị trạng thái + nút kích hoạt/đổi số.
// Tự ẩn khi ZNS tắt. Khi đã kích hoạt: hiện chip "Đã kích hoạt".
export default function PhoneActivationCard({ sx }) {
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: appInit } = useGetAppInitQuery();
  const { data: me } = useGetMeQuery(undefined, { skip: !userInfo });
  const [open, setOpen] = useState(false);

  const phoneOtpEnabled = appInit?.publicUi?.phoneOtpEnabled === true;
  if (!phoneOtpEnabled || !userInfo) return null;

  const verified = (me?.phoneVerified ?? userInfo?.phoneVerified) === true;

  if (verified) {
    return (
      <Chip
        icon={<VerifiedRoundedIcon />}
        color="success"
        variant="outlined"
        label="Số điện thoại đã kích hoạt"
        sx={{ fontWeight: 600, ...sx }}
      />
    );
  }

  return (
    <>
      <Alert
        severity="warning"
        sx={sx}
        action={
          <Button color="warning" variant="contained" size="small" onClick={() => setOpen(true)}>
            Kích hoạt ngay
          </Button>
        }
      >
        <Stack spacing={0.25}>
          <b>Số điện thoại chưa được kích hoạt</b>
          <span>Kích hoạt SĐT qua Zalo để bảo mật tài khoản (hoặc đổi số khác nếu số hiện tại không nhận được mã).</span>
        </Stack>
      </Alert>
      <PhoneActivationDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
