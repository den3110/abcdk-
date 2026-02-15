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

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [forgotPassword, { isLoading }] = useForgotPasswordMutation();

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await forgotPassword({ email }).unwrap();
      setSentTo(res?.masked || email);
      toast.success(
        res?.message || "Đã gửi yêu cầu hướng dẫn đặt lại mật khẩu qua email"
      );
    } catch (err) {
      toast.error(err?.data?.message || "Không gửi được yêu cầu. Thử lại sau.");
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <SEOHead title="Quên mật khẩu" description="Khôi phục mật khẩu tài khoản Pickletour.vn" />
      <Box component={Paper} elevation={3} sx={{ p: 4, mt: 8 }}>
        <Typography variant="h5" fontWeight={600} mb={1}>
          Quên mật khẩu
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Nhập <b>email</b> bạn đã đăng ký với tài khoản của bạn. Chúng tôi sẽ gửi liên kết để đặt lại
          mật khẩu.
        </Typography>

        {sentTo && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Đã gửi yêu cầu đến: <b>{sentTo}</b>. Hãy kiểm tra hộp thư (hoặc
            spam).
          </Alert>
        )}

        <Box component="form" onSubmit={onSubmit}>
          <TextField
            fullWidth
            required
            type="email"
            label="Email"
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
            {isLoading ? <CircularProgress size={24} /> : "Gửi hướng dẫn"}
          </Button>

          <Link
            component={RouterLink}
            to="/login"
            underline="hover"
            sx={{ display: "inline-block", mt: 2 }}
          >
            Quay lại đăng nhập
          </Link>
        </Box>
      </Box>
    </Container>
  );
}
