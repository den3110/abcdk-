// src/screens/ResetPasswordScreen.jsx
import { useMemo, useState } from "react";
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom";
import {
  Container,
  Box,
  TextField,
  Typography,
  Button,
  Paper,
  Alert,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useResetPasswordMutation } from "../slices/usersApiSlice";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function ResetPasswordScreen() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const { t } = useLanguage();

  const disabled = useMemo(
    () => !password || password.length < 6 || password !== confirm,
    [password, confirm]
  );

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!token) return toast.error(t("auth.reset.errors.missingToken"));
      if (password !== confirm)
        return toast.error(t("auth.reset.errors.mismatch"));
      const res = await resetPassword({ token, password }).unwrap();
      toast.success(
        res?.message || t("auth.reset.success")
      );
      navigate("/login");
    } catch (err) {
      toast.error(err?.data?.message || t("auth.reset.errors.failed"));
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <SEOHead
        title={t("auth.reset.seoTitle")}
        description={t("auth.reset.seoDescription")}
      />
      <Box component={Paper} elevation={3} sx={{ p: 4, mt: 8 }}>
        <Typography variant="h5" fontWeight={600} mb={1}>
          {t("auth.reset.title")}
        </Typography>
        {!token && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t("auth.reset.missingToken")}
          </Alert>
        )}

        <Box component="form" onSubmit={onSubmit}>
          <TextField
            fullWidth
            required
            label={t("auth.reset.newPasswordLabel")}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="normal"
            inputProps={{ minLength: 6 }}
            helperText={t("auth.reset.minLengthHint")}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShow((s) => !s)} edge="end">
                    {show ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <TextField
            fullWidth
            required
            label={t("auth.reset.confirmPasswordLabel")}
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            margin="normal"
            error={!!confirm && confirm !== password}
            helperText={
              confirm && confirm !== password ? t("auth.reset.mismatchShort") : " "
            }
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            sx={{ mt: 2 }}
            disabled={isLoading || disabled}
          >
            {isLoading ? <CircularProgress size={24} /> : t("auth.reset.submit")}
          </Button>

          <Link
            component={RouterLink}
            to="/login"
            underline="hover"
            sx={{ display: "inline-block", mt: 2 }}
          >
            {t("auth.reset.backToLogin")}
          </Link>
        </Box>
      </Box>
    </Container>
  );
}
