// src/screens/VerifyOtpScreen.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link as RouterLink,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import apiSlice from "../slices/apiSlice";
import { setCredentials } from "../slices/authSlice";
import {
  useResendLoginOtpMutation,
  useVerifyLoginOtpMutation,
} from "../slices/usersApiSlice";

export default function VerifyOtpScreen() {
  const [params] = useSearchParams();
  const loginToken = useMemo(
    () => String(params.get("loginToken") || ""),
    [params]
  );
  const phoneMasked = useMemo(
    () => String(params.get("phoneMasked") || ""),
    [params]
  );

  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const otpRef = useRef(null);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [verifyOtp, { isLoading: isVerifying }] = useVerifyLoginOtpMutation();
  const [resendOtp, { isLoading: isResending }] = useResendLoginOtpMutation();

  // ✅ validate token (không auto resend)
  useEffect(() => {
    if (!loginToken) {
      toast.error("Thiếu loginToken. Vui lòng đăng nhập lại.");
      navigate("/login");
      return;
    }
    // focus input cho user nhập nhanh
    setTimeout(() => otpRef.current?.focus?.(), 50);
  }, [loginToken, navigate]);

  // ✅ cooldown countdown
  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const onChangeOtp = (val) => {
    const clean = String(val || "")
      .replace(/\D/g, "")
      .slice(0, 6);
    setOtp(clean);
  };

  const submitHandler = async (e) => {
    e.preventDefault();

    const cleanOtp = String(otp || "")
      .replace(/\D/g, "")
      .slice(0, 6);

    if (cleanOtp.length < 4) {
      toast.error("OTP không hợp lệ");
      return;
    }

    try {
      const res = await verifyOtp({ loginToken, otp: cleanOtp }).unwrap();
      dispatch(setCredentials({ ...res }));
      dispatch(apiSlice.util.resetApiState());
      navigate("/");
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const handleResend = async () => {
    if (!loginToken) {
      toast.error("Thiếu loginToken. Vui lòng đăng nhập lại.");
      navigate("/login");
      return;
    }
    if (cooldown > 0) return;

    try {
      const r = await resendOtp({ loginToken }).unwrap();
      const cd = Number(r?.cooldown || 60);
      setCooldown(Number.isFinite(cd) ? cd : 60);
      toast.success("Đã gửi OTP");

      // tuỳ chọn: debug non-prod
      if (r?.devOtp) toast.info(`devOtp: ${r.devOtp}`);
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Container
        maxWidth={isMobile ? "sm" : "xs"}
        sx={{ px: isMobile ? 1 : 3 }}
      >
        <Paper
          elevation={24}
          sx={{
            p: isMobile ? 3 : 4,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(20px)",
            borderRadius: "24px",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
          }}
        >
          <Stack spacing={1} sx={{ mb: 3 }}>
            <Typography
              variant={isMobile ? "h5" : "h4"}
              fontWeight={800}
              color="#333"
            >
              Xác thực OTP
            </Typography>

            <Typography color="text.secondary">
              Nhập mã OTP gửi tới số: <b>{phoneMasked || "số của bạn"}</b>
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Vui lòng kiểm tra <b>Zalo</b> để nhận mã OTP.
            </Typography>
          </Stack>

          <Box component="form" onSubmit={submitHandler}>
            <TextField
              inputRef={otpRef}
              fullWidth
              label="OTP"
              value={otp}
              onChange={(e) => onChangeOtp(e.target.value)}
              inputProps={{
                inputMode: "numeric",
                autoComplete: "one-time-code",
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "12px",
                  backgroundColor: "rgba(255,255,255,0.5)",
                },
              }}
              helperText='OTP được gửi qua Zalo. Nếu chưa nhận được, bấm “Gửi lại OTP”.'
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              sx={{
                mt: 2,
                borderRadius: "12px",
                py: 1.4,
                textTransform: "none",
                fontWeight: 800,
              }}
              disabled={isVerifying}
            >
              {isVerifying ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Xác thực"
              )}
            </Button>

            <Button
              fullWidth
              variant="outlined"
              size="large"
              sx={{
                mt: 1.5,
                borderRadius: "12px",
                py: 1.2,
                textTransform: "none",
              }}
              onClick={handleResend}
              disabled={isResending || cooldown > 0}
            >
              {isResending
                ? "Đang gửi..."
                : cooldown > 0
                ? `Gửi lại OTP (${cooldown}s)`
                : "Gửi lại OTP"}
            </Button>

            <Box sx={{ mt: 2 }}>
              <Link
                component={RouterLink}
                to="/login"
                underline="none"
                sx={{ fontWeight: 700 }}
              >
                Quay lại đăng nhập
              </Link>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
