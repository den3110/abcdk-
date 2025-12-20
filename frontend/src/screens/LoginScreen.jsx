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

const WEB_LOGO_PATH = "/icon.png";

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  const submitHandler = async (e) => {
    e.preventDefault();
    try {
      const res = await login({ phone, password }).unwrap();

      // ✅ nếu backend báo cần verify OTP
      // ✅ nếu backend báo cần OTP đăng nhập
      if (res?.needLoginOtp) {
        const qs = new URLSearchParams({
          loginToken: res?.loginToken || "",
          phoneMasked: res?.phoneMasked || "",
        }).toString();
        navigate(`/verify-otp?${qs}`);
        return;
      }

      dispatch(setCredentials({ ...res }));
      dispatch(apiSlice.util.resetApiState());
      navigate("/");
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
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(20px)",
            borderRadius: "24px",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
          }}
        >
          <Box sx={{ mb: 3, display: "flex", justifyContent: "center" }}>
            <img
              src={WEB_LOGO_PATH}
              alt="Logo"
              style={{
                width: isMobile ? "100px" : "120px",
                height: isMobile ? "100px" : "120px",
                objectFit: "contain",
                borderRadius: "20px",
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
            Chào mừng bạn trở lại Pickletour!
          </Typography>
          <Typography
            variant={isMobile ? "body2" : "body1"}
            color="text.secondary"
            sx={{ mb: 4, textAlign: "center" }}
          >
            Đăng nhập hệ thống
          </Typography>

          <Box component="form" onSubmit={submitHandler} sx={{ width: "100%" }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="phone"
              label="Số điện thoại"
              name="phone"
              autoComplete="tel"
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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
              label="Mật khẩu"
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
                  background:
                    "linear-gradient(45deg, #5a6fd6 30%, #6b4295 90%)",
                  transform: "scale(1.02)",
                },
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                "Đăng nhập"
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
                Quên mật khẩu?
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
                Đăng ký
              </Link>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
