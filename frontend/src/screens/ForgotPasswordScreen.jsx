// src/screens/ForgotPasswordScreen.jsx
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Container,
  Box,
  TextField,
  Typography,
  Button,
  Paper,
  Alert,
  CircularProgress,
  Link,
  ToggleButton,
  ToggleButtonGroup,
  Stack,
} from "@mui/material";
import {
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useGetRegistrationSettingsQuery,
} from "../slices/usersApiSlice";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function ForgotPasswordScreen() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { data: regSettings } = useGetRegistrationSettingsQuery();
  const zaloEnabled = regSettings?.phoneOtpEnabled === true;

  const [mode, setMode] = useState("email"); // "email" | "zalo"
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();
  const [resetPassword, { isLoading: resetting }] = useResetPasswordMutation();

  // Email (link) mode
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");

  // Zalo (phone OTP) mode
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState("phone"); // "phone" | "otp"
  const [maskedPhone, setMaskedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const onSubmitEmail = async (e) => {
    e.preventDefault();
    try {
      const res = await forgotPassword({ email }).unwrap();
      setSentTo(res?.masked || email);
      toast.success(res?.message || t("auth.forgot.successToast"));
    } catch (err) {
      toast.error(err?.data?.message || t("auth.forgot.errors.failed"));
    }
  };

  const sendZaloOtp = async () => {
    try {
      const res = await forgotPassword({ channel: "zalo", phone: phone.trim() }).unwrap();
      if (res?.exists === false) {
        toast.info(res?.message || "SĐT chưa kích hoạt hoặc không tồn tại.");
        return;
      }
      setMaskedPhone(res?.masked || phone);
      setStep("otp");
      toast.success(res?.message || "Đã gửi mã OTP qua Zalo.");
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được OTP.");
    }
  };

  const doZaloReset = async () => {
    if (pw.length < 6) return toast.info("Mật khẩu tối thiểu 6 ký tự.");
    if (pw !== pw2) return toast.info("Mật khẩu nhập lại không khớp.");
    try {
      await resetPassword({
        channel: "zalo",
        phone: phone.trim(),
        otp: otp.trim(),
        password: pw,
      }).unwrap();
      toast.success("Đổi mật khẩu thành công. Vui lòng đăng nhập lại.");
      navigate("/login");
    } catch (err) {
      toast.error(err?.data?.message || "Đổi mật khẩu thất bại.");
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <SEOHead
        title={t("auth.forgot.seoTitle")}
        description={t("auth.forgot.seoDescription")}
      />
      <Box component={Paper} elevation={3} sx={{ p: 4, mt: 8 }}>
        <Typography variant="h5" fontWeight={600} mb={1}>
          {t("auth.forgot.title")}
        </Typography>

        {zaloEnabled && (
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, v) => v && setMode(v)}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="email">Qua Email</ToggleButton>
            <ToggleButton value="zalo">Qua Zalo (SĐT)</ToggleButton>
          </ToggleButtonGroup>
        )}

        {mode === "email" ? (
          <>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {t("auth.forgot.intro")}
            </Typography>
            {sentTo && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {t("auth.forgot.sentNoticePrefix")} <b>{sentTo}</b>.{" "}
                {t("auth.forgot.sentNoticeSuffix")}
              </Alert>
            )}
            <Box component="form" onSubmit={onSubmitEmail}>
              <TextField
                fullWidth
                required
                type="email"
                label={t("auth.forgot.emailLabel")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                sx={{ mt: 2 }}
                disabled={isLoading}
              >
                {isLoading ? <CircularProgress size={24} /> : t("auth.forgot.submit")}
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Nhập số điện thoại đã kích hoạt để nhận mã OTP qua Zalo.
            </Typography>
            {step === "phone" ? (
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="Số điện thoại"
                  placeholder="0987654321"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                  inputProps={{ inputMode: "numeric", maxLength: 11 }}
                  autoFocus
                />
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  disabled={isLoading || !phone.trim()}
                  onClick={sendZaloOtp}
                >
                  {isLoading ? <CircularProgress size={24} /> : "Gửi mã OTP"}
                </Button>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <Alert severity="info">
                  Mã OTP đã gửi tới Zalo của số <b>{maskedPhone}</b>
                </Alert>
                <TextField
                  fullWidth
                  label="Mã OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  inputProps={{ inputMode: "numeric", maxLength: 6 }}
                  autoFocus
                />
                <TextField
                  fullWidth
                  type="password"
                  label="Mật khẩu mới"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <TextField
                  fullWidth
                  type="password"
                  label="Nhập lại mật khẩu mới"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  disabled={resetting || otp.length < 4 || !pw}
                  onClick={doZaloReset}
                >
                  {resetting ? <CircularProgress size={24} /> : "Đặt lại mật khẩu"}
                </Button>
                <Stack direction="row" justifyContent="space-between">
                  <Button size="small" onClick={() => setStep("phone")}>
                    Đổi số
                  </Button>
                  <Button size="small" onClick={sendZaloOtp} disabled={isLoading}>
                    Gửi lại mã
                  </Button>
                </Stack>
              </Stack>
            )}
          </>
        )}

        <Link
          component={RouterLink}
          to="/login"
          underline="hover"
          sx={{ display: "inline-block", mt: 2 }}
        >
          {t("auth.forgot.backToLogin")}
        </Link>
      </Box>
    </Container>
  );
}
