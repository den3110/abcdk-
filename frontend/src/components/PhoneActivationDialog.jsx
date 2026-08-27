/* eslint-disable react/prop-types */
import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Stack,
  Alert,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useRequestPhoneOtpMutation,
  useVerifyPhoneActivationOtpMutation,
} from "../slices/usersApiSlice";
import { setCredentials, logout } from "../slices/authSlice";

// Dialog kích hoạt / đổi SĐT bằng OTP Zalo. force=true => không cho đóng (bắt buộc).
export default function PhoneActivationDialog({ open, onClose, force = false }) {
  const dispatch = useDispatch();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const [requestOtp, { isLoading: sending }] = useRequestPhoneOtpMutation();
  const [verifyOtp, { isLoading: verifying }] =
    useVerifyPhoneActivationOtpMutation();

  const [step, setStep] = useState("start"); // "start" | "otp"
  const [changing, setChanging] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");

  const currentPhone = userInfo?.phone || "";
  const useNewPhone = changing || !currentPhone;

  const send = async () => {
    try {
      const body =
        useNewPhone && newPhone.trim() ? { phone: newPhone.trim() } : {};
      const res = await requestOtp(body).unwrap();
      setPhoneMasked(res?.phoneMasked || "");
      setStep("otp");
      toast.success("Đã gửi mã OTP qua Zalo.");
    } catch (e) {
      toast.error(e?.data?.message || "Gửi OTP thất bại");
    }
  };

  const verify = async () => {
    if (!otp.trim()) return;
    try {
      const res = await verifyOtp({ otp: otp.trim() }).unwrap();
      dispatch(
        setCredentials({
          ...userInfo,
          phone: res?.phone || userInfo?.phone,
          phoneVerified: true,
        })
      );
      toast.success("Kích hoạt số điện thoại thành công!");
      onClose && onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Xác thực thất bại");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={force ? undefined : onClose}
      disableEscapeKeyDown={force}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>Kích hoạt số điện thoại</DialogTitle>
      <DialogContent>
        {force && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Bạn cần kích hoạt số điện thoại để tiếp tục sử dụng ứng dụng.
          </Alert>
        )}
        {step === "start" ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Chúng tôi sẽ gửi mã OTP qua Zalo tới số:{" "}
              <b>
                {useNewPhone
                  ? newPhone || "(nhập số bên dưới)"
                  : currentPhone || "chưa có SĐT"}
              </b>
            </Typography>
            {useNewPhone && (
              <TextField
                label="Số điện thoại"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0987654321"
                fullWidth
                inputProps={{ inputMode: "numeric", maxLength: 11 }}
              />
            )}
            {!changing && currentPhone && (
              <Button size="small" onClick={() => setChanging(true)}>
                Số này không nhận được mã? Dùng số khác
              </Button>
            )}
            {changing && currentPhone && (
              <Button
                size="small"
                onClick={() => {
                  setChanging(false);
                  setNewPhone("");
                }}
              >
                Dùng lại số hiện tại ({currentPhone})
              </Button>
            )}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">
              Nhập mã OTP đã gửi tới <b>{phoneMasked}</b>
            </Typography>
            <TextField
              label="Mã OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              inputProps={{ maxLength: 6, inputMode: "numeric" }}
              fullWidth
              autoFocus
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setStep("start")}>
                Đổi số
              </Button>
              <Button size="small" onClick={send} disabled={sending}>
                {sending ? "Đang gửi…" : "Gửi lại mã"}
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {force && (
          <Button color="inherit" onClick={() => dispatch(logout())}>
            Đăng xuất
          </Button>
        )}
        {!force && onClose && <Button onClick={onClose}>Đóng</Button>}
        {step === "start" ? (
          <Button
            variant="contained"
            onClick={send}
            disabled={sending || (useNewPhone && !newPhone.trim())}
          >
            {sending ? "Đang gửi…" : "Gửi mã OTP"}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={verify}
            disabled={verifying || otp.length < 4}
          >
            {verifying ? "Đang xác thực…" : "Xác nhận"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
