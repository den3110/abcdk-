// src/screens/LoginScreen.jsx
import { useState, useEffect } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Container,
  Box,
  TextField,
  Typography,
  Button,
  Grid,
  CircularProgress,
  Paper,
  Link,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { useLoginMutation } from "../slices/usersApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";
import apiSlice from "../slices/apiSlice";

export default function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  const submitHandler = async (e) => {
    e.preventDefault();
    try {
      const res = await login({ phone, password }).unwrap();
      dispatch(setCredentials({ ...res }));
      dispatch(apiSlice.util.resetApiState());
      navigate("/");
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        component={Paper}
        elevation={3}
        sx={{
          p: 4,
          mt: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Typography component="h1" variant="h5" fontWeight={600} mb={2}>
          Đăng nhập
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
          />

          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="Mật khẩu"
            type="password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            sx={{ mt: 3, mb: 2 }}
            disabled={isLoading}
          >
            {isLoading ? <CircularProgress size={24} /> : "Đăng nhập"}
          </Button>

          <Grid container alignItems="center" justifyContent="space-between">
            <Grid item>
              <Link
                component={RouterLink}
                to="/forgot-password"
                underline="hover"
              >
                Quên mật khẩu?
              </Link>
            </Grid>
            <Grid item>
              <Link component={RouterLink} to="/register" underline="hover">
                Chưa có tài khoản? Đăng ký ngay
              </Link>
            </Grid>
          </Grid>
        </Box>
      </Box>
    </Container>
  );
}
