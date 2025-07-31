import { useState, useEffect } from "react";
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  CircularProgress,
  Avatar,
  Link as MuiLink,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useRegisterMutation } from "../slices/usersApiSlice";
import { useUploadAvatarMutation } from "../slices/uploadApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const RegisterScreen = () => {
  const [form, setForm] = useState({
    name: "",
    nickname: "",
    phone: "",
    dob: "",
    email: "",
    password: "",
    confirmPassword: "",
    cccd: "",
  });

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [register, { isLoading }] = useRegisterMutation();
  const [uploadAvatar] = useUploadAvatarMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  const handleChange = (e) => {
    const { id, value } = e.target;
    setForm((prev) => ({ ...prev, [id]: value }));
  };

  const validate = ({
    name,
    nickname,
    phone,
    dob,
    email,
    password,
    confirmPassword,
    cccd,
  }) => {
    const errors = [];
    if (!name.trim()) errors.push("Họ tên không được để trống.");
    if (!nickname.trim()) errors.push("Biệt danh không được để trống.");
    if (!/^0\d{9}$/.test(phone.trim()))
      errors.push("Số điện thoại phải bắt đầu bằng 0 và đủ 10 chữ số.");
    if (!dob) errors.push("Vui lòng chọn ngày sinh.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.push("Email không hợp lệ.");
    if (password.length < 6) errors.push("Mật khẩu phải có ít nhất 6 ký tự.");
    if (password !== confirmPassword)
      errors.push("Mật khẩu và xác nhận mật khẩu không khớp.");
    if (!/^\d{12}$/.test(cccd.trim()))
      errors.push("CCCD phải bao gồm đúng 12 chữ số.");
    return errors;
  };

  const submitHandler = async (e) => {
    e.preventDefault();

    const cleaned = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [
        k,
        typeof v === "string" ? v.trim() : v,
      ])
    );

    const errors = validate(cleaned);
    if (errors.length > 0) {
      errors.forEach((msg) => toast.error(msg));
      return;
    }

    try {
      let uploadedUrl = avatarUrl;

      if (avatarFile && !uploadedUrl) {
        if (avatarFile.size > MAX_FILE_SIZE) {
          toast.error("Ảnh không được vượt quá 5MB.");
          return;
        }

        const res = await uploadAvatar(avatarFile).unwrap();
        uploadedUrl = res.url;
        setAvatarUrl(res.url);
      }

      const payload = { ...cleaned, avatar: uploadedUrl };
      const res = await register(payload).unwrap();

      dispatch(setCredentials(res));
      toast.success("Đăng ký thành công!");
      navigate("/");
    } catch (err) {
      const msg = err?.data?.message || err.message || "Đăng ký thất bại";

      // Hiển thị lỗi trùng CCCD hoặc nickname rõ ràng
      if (msg.includes("Email")) toast.error("Email đã được sử dụng");
      if (msg.includes("Số điện thoại"))
        toast.error("Số điện thoại đã được sử dụng");
      if (msg.includes("CCCD")) toast.error("CCCD đã được sử dụng");
      else if (msg.includes("nickname")) toast.error("Nickname đã tồn tại");
      else toast.error(msg);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 6 }}>
      <Typography variant="h4" gutterBottom>
        Đăng ký
      </Typography>

      <Box component="form" noValidate onSubmit={submitHandler}>
        <TextField
          fullWidth
          required
          id="name"
          label="Họ và tên"
          margin="normal"
          value={form.name}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="nickname"
          label="Nickname"
          margin="normal"
          value={form.nickname}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="phone"
          label="Số điện thoại"
          margin="normal"
          value={form.phone}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="dob"
          label="Ngày sinh"
          type="date"
          InputLabelProps={{ shrink: true }}
          margin="normal"
          value={form.dob}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="email"
          label="Email"
          type="email"
          margin="normal"
          value={form.email}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="cccd"
          label="Mã định danh CCCD"
          margin="normal"
          value={form.cccd}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="password"
          label="Mật khẩu"
          type="password"
          margin="normal"
          value={form.password}
          onChange={handleChange}
        />
        <TextField
          fullWidth
          required
          id="confirmPassword"
          label="Xác nhận mật khẩu"
          type="password"
          margin="normal"
          value={form.confirmPassword}
          onChange={handleChange}
        />

        <Box mt={2} display="flex" alignItems="center" gap={2}>
          <Avatar
            src={
              avatarPreview ||
              "https://dummyimage.com/80x80/cccccc/ffffff&text=?"
            }
            sx={{ width: 80, height: 80 }}
          />
          <Button variant="outlined" component="label">
            Chọn ảnh đại diện
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  if (file.size > MAX_FILE_SIZE) {
                    toast.error("Ảnh không được vượt quá 5MB.");
                    return;
                  }
                  setAvatarFile(file);
                  setAvatarPreview(URL.createObjectURL(file));
                  setAvatarUrl(""); // reset nếu đổi file
                }
              }}
            />
          </Button>
        </Box>

        <Button
          type="submit"
          fullWidth
          variant="contained"
          color="primary"
          sx={{ mt: 3, mb: 2 }}
          disabled={isLoading}
        >
          {isLoading ? (
            <CircularProgress size={24} color="inherit" />
          ) : (
            "Đăng ký"
          )}
        </Button>
      </Box>

      <Typography variant="body2" align="center">
        Đã có tài khoản?{" "}
        <MuiLink component={Link} to="/login" underline="hover">
          Đăng nhập
        </MuiLink>
      </Typography>
    </Container>
  );
};

export default RegisterScreen;
