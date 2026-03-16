// src/screens/ForgotPasswordScreen.jsx
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
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
} from "@mui/material";
import { useForgotPasswordMutation } from "../slices/usersApiSlice";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();
  const { t } = useLanguage();

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await forgotPassword({ email }).unwrap();
      setSentTo(res?.masked || email);
      toast.success(
        res?.message || t("auth.forgot.successToast")
      );
    } catch (err) {
      toast.error(err?.data?.message || t("auth.forgot.errors.failed"));
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
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t("auth.forgot.intro")}
        </Typography>

        {sentTo && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {t("auth.forgot.sentNoticePrefix")} <b>{sentTo}</b>.{" "}
            {t("auth.forgot.sentNoticeSuffix")}
          </Alert>
        )}

        <Box component="form" onSubmit={onSubmit}>
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

          <Link
            component={RouterLink}
            to="/login"
            underline="hover"
            sx={{ display: "inline-block", mt: 2 }}
          >
            {t("auth.forgot.backToLogin")}
          </Link>
        </Box>
      </Box>
    </Container>
  );
}
