// src/screens/RegisterOtpScreen.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import { setCredentials } from "../slices/authSlice";
import {
  useVerifyRegisterOtpMutation,
  useResendRegisterOtpMutation,
  useSkipRegisterOtpMutation,
} from "../slices/usersApiSlice";
import SEOHead from "../components/SEOHead";

export default function RegisterOtpScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const [verifyOtp, { isLoading: verifying }] = useVerifyRegisterOtpMutation();
  const [resendOtp, { isLoading: resending }] = useResendRegisterOtpMutation();
  const [skipOtp, { isLoading: skipping }] = useSkipRegisterOtpMutation();

  const fromState = location.state || {};
  const fromSession = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("register_otp") || "null");
    } catch {
      return null;
    }
  }, []);

  const registerToken =
    fromState?.registerToken || fromSession?.registerToken || "";
  const phoneMasked =
    fromState?.phoneMasked || fromSession?.phoneMasked || "số điện thoại";
  const canSkip = Boolean(fromState?.canSkip || fromSession?.canSkip);
  const otpSendFailed = Boolean(
    fromState?.otpSendFailed || fromSession?.otpSendFailed,
  );

  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!registerToken) {
      toast.error("Thiếu registerToken. Vui lòng đăng ký lại.");
      navigate("/register");
      return;
    }
  }, [registerToken, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const onVerify = async () => {
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      toast.error("OTP phải gồm 6 chữ số.");
      return;
    }

    try {
      const res = await verifyOtp({ registerToken, otp: code }).unwrap();

      if (!res?.token) {
        toast.error("Xác thực thành công nhưng thiếu token.");
        return;
      }

      dispatch(setCredentials(res));
      sessionStorage.removeItem("register_otp");

      toast.success("Đăng ký thành công!");
      navigate("/");
    } catch (err) {
      toast.error(
        err?.data?.message || err?.message || "Xác thực OTP thất bại",
      );
    }
  };

  const onResend = async () => {
    if (cooldown > 0) return;
    try {
      await resendOtp({ registerToken }).unwrap();
      toast.success("Đã gửi lại OTP.");
      setCooldown(30);
    } catch (err) {
      toast.error(err?.data?.message || err?.message || "Gửi lại OTP thất bại");
    }
  };

  const onSkip = async () => {
    try {
      const res = await skipOtp({ registerToken }).unwrap();
      if (!res?.token) {
        toast.error("Bỏ qua thất bại. Vui lòng thử lại.");
        return;
      }
      dispatch(setCredentials(res));
      sessionStorage.removeItem("register_otp");
      toast.success(
        "Đăng ký thành công! Bạn có thể kích hoạt số điện thoại sau trong phần hồ sơ.",
      );
      navigate("/");
    } catch (err) {
      toast.error(err?.data?.message || err?.message || "Bỏ qua thất bại");
    }
  };

  return (
    <Container maxWidth="xs" sx={{ py: 6 }}>
      <SEOHead title="Xác thực OTP - Đăng ký" noIndex={true} />
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Xác thực OTP
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Mã OTP đã được gửi tới <b>{phoneMasked}</b>
        </Typography>

        <Stack spacing={2}>
          {otpSendFailed && (
            <Alert severity="warning">
              Không gửi được mã OTP tới số của bạn (dịch vụ đang gặp sự cố). Bạn
              có thể <b>bỏ qua</b> bước này và kích hoạt số điện thoại sau trong
              phần hồ sơ.
            </Alert>
          )}
          <TextField
            label="Nhập OTP (6 số)"
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
            }
            inputProps={{ inputMode: "numeric", maxLength: 6 }}
            autoFocus
            fullWidth
          />

          <Button
            variant="contained"
            fullWidth
            onClick={onVerify}
            disabled={verifying || otp.trim().length !== 6}
            startIcon={verifying && <CircularProgress size={18} />}
          >
            {verifying ? "Đang xác thực..." : "Xác thực"}
          </Button>

          {canSkip && (
            <Button
              variant="outlined"
              color="warning"
              fullWidth
              onClick={onSkip}
              disabled={skipping || verifying}
              startIcon={skipping && <CircularProgress size={18} />}
            >
              {skipping ? "Đang xử lý..." : "Bỏ qua & kích hoạt sau"}
            </Button>
          )}

          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Button
              variant="text"
              onClick={() => navigate("/register")}
              disabled={verifying || resending}
            >
              Quay lại
            </Button>

            <Button
              variant="text"
              onClick={onResend}
              disabled={verifying || resending || cooldown > 0}
            >
              {resending
                ? "Đang gửi..."
                : cooldown > 0
                  ? `Gửi lại (${cooldown}s)`
                  : "Gửi lại OTP"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Container>
  );
}
