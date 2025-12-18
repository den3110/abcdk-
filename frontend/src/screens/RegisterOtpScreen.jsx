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
} from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import { setCredentials } from "../slices/authSlice";
import {
  useVerifyRegisterOtpMutation,
  useResendRegisterOtpMutation,
} from "../slices/usersApiSlice";

export default function RegisterOtpScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const [verifyOtp, { isLoading: verifying }] = useVerifyRegisterOtpMutation();
  const [resendOtp, { isLoading: resending }] = useResendRegisterOtpMutation();

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
        err?.data?.message || err?.message || "Xác thực OTP thất bại"
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

  return (
    <Container maxWidth="xs" sx={{ py: 6 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h5" gutterBottom>
          Xác thực OTP
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Mã OTP đã được gửi tới <b>{phoneMasked}</b>
        </Typography>

        <Stack spacing={2}>
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
