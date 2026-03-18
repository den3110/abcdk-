// src/screens/LoginScreen.jsx
import { useState, useEffect } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Box,
  TextField,
  Typography,
  Button,
  CircularProgress,
  Link,
  Paper,
  InputAdornment,
  IconButton,
  Container,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Phone as PhoneIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useDispatch, useSelector } from "react-redux";
import { useLoginMutation } from "../slices/usersApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";
import apiSlice from "../slices/apiSlice";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

const WEB_LOGO_PATH = "/icon-192.png";

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState(""); // ✅ SĐT hoặc Email
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useLanguage();

  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  const submitHandler = async (e) => {
    e.preventDefault();

    const cleanIdentifier = String(identifier || "").trim();
    const cleanPassword = String(password || "");

    try {
      // ✅ gửi identifier để backend tự phân biệt email/phone
      const res = await login({ identifier: cleanIdentifier, password: cleanPassword }).unwrap();

      // ✅ login trực tiếp (OTP tạm tắt)
      dispatch(setCredentials({ ...res }));
      dispatch(apiSlice.util.resetApiState());
      navigate("/");
    } catch (err) {
      toast.error(err?.data?.message || err?.error || t("auth.login.errors.failed"));
    }
  };

  return (
    <Box
      sx={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <SEOHead title={t("auth.login.seoTitle")} />
      <Container component="main" maxWidth="xs">
        <Paper
          elevation={6}
          sx={{
            p: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            borderRadius: "24px",
            background: "rgba(255, 255, 255, 0.9)",
            backdropFilter: "blur(20px)",
          }}
        >
          <Box sx={{ mb: 2 }}>
            <img
              src={WEB_LOGO_PATH}
              alt="Logo"
              style={{
                width: 80,
                height: 80,
                objectFit: "contain",
                filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.15))",
              }}
            />
          </Box>

          <Typography
            component="h1"
            variant={isMobile ? "h5" : "h4"}
            fontWeight="800"
            color="#333"
            sx={{ mb: 1 }}
            align="center"
          >
            {t("auth.login.welcome")}
          </Typography>
          <Typography
            variant={isMobile ? "body2" : "body1"}
            color="text.secondary"
            sx={{ mb: 4, textAlign: "center" }}
          >
            {t("auth.login.subtitle")}
          </Typography>

          <Box component="form" onSubmit={submitHandler} sx={{ width: "100%" }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="identifier"
              label={t("auth.login.identifierLabel")}
              name="identifier"
              autoComplete="username"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "12px",
                  backgroundColor: "rgba(255,255,255,0.5)",
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <PhoneIcon color="primary" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label={t("auth.login.passwordLabel")}
              type={showPassword ? "text" : "password"}
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "12px",
                  backgroundColor: "rgba(255,255,255,0.5)",
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LockIcon color="primary" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              sx={{
                mt: 4,
                mb: 3,
                py: 1.5,
                borderRadius: "12px",
                fontSize: "1rem",
                fontWeight: "bold",
                textTransform: "none",
                background: "linear-gradient(45deg, #667eea 30%, #764ba2 90%)",
                boxShadow: "0 3px 5px 2px rgba(100, 105, 255, .3)",
                transition: "transform 0.2s",
                "&:hover": {
                  background: "linear-gradient(45deg, #5a6fd6 30%, #6b4295 90%)",
                  transform: "scale(1.02)",
                },
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                t("auth.login.submit")
              )}
            </Button>

            <Box
              display="flex"
              justifyContent="space-between"
              width="100%"
              mt={1}
              flexDirection={isMobile ? "column" : "row"}
            >
              <Link
                component={RouterLink}
                to="/forgot-password"
                variant="body2"
                sx={{
                  textDecoration: "none",
                  color: "#667eea",
                  fontWeight: 600,
                  mb: isMobile ? 1 : 0,
                }}
              >
                {t("auth.login.forgot")}
              </Link>
              <Link
                component={RouterLink}
                to="/register"
                variant="body2"
                sx={{
                  textDecoration: "none",
                  color: "#764ba2",
                  fontWeight: 600,
                }}
              >
                {t("auth.login.register")}
              </Link>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
