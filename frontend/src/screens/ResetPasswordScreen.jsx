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

export default function ResetPasswordScreen() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [resetPassword, { isLoading }] = useResetPasswordMutation();

  const disabled = useMemo(
    () => !password || password.length < 6 || password !== confirm,
    [password, confirm]
  );

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!token) return toast.error("Thiếu token. Mở từ email để tiếp tục.");
      if (password !== confirm)
        return toast.error("Mật khẩu nhập lại không khớp");
      const res = await resetPassword({ token, password }).unwrap();
      toast.success(
        res?.message || "Đổi mật khẩu thành công. Vui lòng đăng nhập lại."
      );
      navigate("/login");
    } catch (err) {
      toast.error(
        err?.data?.message ||
          "Không thể đặt lại mật khẩu. Token có thể đã hết hạn."
      );
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box component={Paper} elevation={3} sx={{ p: 4, mt: 8 }}>
        <Typography variant="h5" fontWeight={600} mb={1}>
          Đặt lại mật khẩu
        </Typography>
        {!token && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Thiếu token. Vui lòng mở liên kết từ email.
          </Alert>
        )}

        <Box component="form" onSubmit={onSubmit}>
          <TextField
            fullWidth
            required
            label="Mật khẩu mới"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            margin="normal"
            inputProps={{ minLength: 6 }}
            helperText="Tối thiểu 6 ký tự"
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
            label="Nhập lại mật khẩu"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            margin="normal"
            error={!!confirm && confirm !== password}
            helperText={confirm && confirm !== password ? "Không khớp" : " "}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            sx={{ mt: 2 }}
            disabled={isLoading || disabled}
          >
            {isLoading ? <CircularProgress size={24} /> : "Đổi mật khẩu"}
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
