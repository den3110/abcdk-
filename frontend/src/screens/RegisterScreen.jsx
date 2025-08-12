// src/screens/RegisterScreen.jsx
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useRegisterMutation } from "../slices/usersApiSlice";
import { useUploadAvatarMutation } from "../slices/uploadApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const GENDER_OPTIONS = [
  { value: "unspecified", label: "--" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
];
const PROVINCES = [
  "An Giang",
  "Bà Rịa-Vũng Tàu",
  "Bạc Liêu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Dương",
  "Bình Định",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cao Bằng",
  "Cần Thơ",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên Huế",
  "Tiền Giang",
  "TP Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

export default function RegisterScreen() {
  const [form, setForm] = useState({
    name: "",
    nickname: "",
    phone: "",
    dob: "",
    email: "",
    password: "",
    confirmPassword: "",
    cccd: "",
    province: "",
    gender: "unspecified", // 👈 thêm
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
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
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
    province,
    gender, // 👈 thêm
  }) => {
    const errors = [];
    if (!name.trim()) errors.push("Họ tên không được để trống.");
    if (!nickname.trim()) errors.push("Biệt danh không được để trống.");
    if (!/^0\d{9}$/.test(phone.trim()))
      errors.push("Số điện thoại phải bắt đầu bằng 0 và đủ 10 chữ số.");
    if (!dob) errors.push("Vui lòng chọn ngày sinh.");
    if (!province) errors.push("Vui lòng chọn tỉnh / thành.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.push("Email không hợp lệ.");
    if (password.length < 6) errors.push("Mật khẩu phải có ít nhất 6 ký tự.");
    if (password !== confirmPassword)
      errors.push("Mật khẩu và xác nhận mật khẩu không khớp.");
    if (!/^\d{12}$/.test(cccd.trim()))
      errors.push("CCCD phải bao gồm đúng 12 chữ số.");
    // 👇 hợp lệ theo enum; không bắt buộc khác 'unspecified'
    if (!["male", "female", "unspecified", "other"].includes(gender))
      errors.push("Giới tính không hợp lệ.");
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
    if (errors.length) {
      errors.forEach((msg) => toast.error(msg));
      return;
    }

    try {
      let uploadedUrl = avatarUrl;

      if (avatarFile && !uploadedUrl) {
        if (avatarFile.size > MAX_FILE_SIZE) {
          toast.error("Ảnh không được vượt quá 10 MB.");
          return;
        }
        const resUpload = await uploadAvatar(avatarFile).unwrap();
        uploadedUrl = resUpload.url;
        setAvatarUrl(resUpload.url);
      }

      const res = await register({ ...cleaned, avatar: uploadedUrl }).unwrap();
      dispatch(setCredentials(res));
      toast.success("Đăng ký thành công!");
      navigate("/");
    } catch (err) {
      const msg = err?.data?.message || err.message || "Đăng ký thất bại";
      const map = {
        Email: "Email đã được sử dụng",
        "Số điện thoại": "Số điện thoại đã được sử dụng",
        CCCD: "CCCD đã được sử dụng",
        nickname: "Nickname đã tồn tại",
      };
      const matched = Object.keys(map).find((k) => msg.includes(k));
      toast.error(matched ? map[matched] : msg);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 6 }}>
      <Typography variant="h4" gutterBottom>
        Đăng ký
      </Typography>

      <Box component="form" noValidate onSubmit={submitHandler}>
        {[
          { name: "name", label: "Họ và tên" },
          { name: "nickname", label: "Nickname" },
          { name: "phone", label: "Số điện thoại" },
          {
            name: "dob",
            label: "Ngày sinh",
            type: "date",
            InputLabelProps: { shrink: true },
          },
          { name: "email", label: "Email", type: "email" },
          { name: "cccd", label: "Mã định danh CCCD" },
          { name: "password", label: "Mật khẩu", type: "password" },
          {
            name: "confirmPassword",
            label: "Xác nhận mật khẩu",
            type: "password",
          },
        ].map(({ name, ...rest }) => (
          <TextField
            key={name}
            fullWidth
            required
            margin="normal"
            name={name}
            id={name}
            value={form[name]}
            onChange={handleChange}
            {...rest}
          />
        ))}

        {/* 👇 Gender Select */}
        <FormControl fullWidth margin="normal">
          <InputLabel id="gender-label">Giới tính</InputLabel>
          <Select
            labelId="gender-label"
            name="gender"
            value={form.gender}
            label="Giới tính"
            onChange={handleChange}
          >
            {GENDER_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Province Select */}
        <FormControl fullWidth required margin="normal">
          <InputLabel id="province-label">Tỉnh / Thành phố</InputLabel>
          <Select
            labelId="province-label"
            name="province"
            value={form.province}
            label="Tỉnh / Thành phố"
            onChange={handleChange}
          >
            {PROVINCES.map((prov) => (
              <MenuItem key={prov} value={prov}>
                {prov}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Avatar upload */}
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
                if (!file) return;
                if (file.size > MAX_FILE_SIZE) {
                  toast.error("Ảnh không được vượt quá 10 MB.");
                  return;
                }
                setAvatarFile(file);
                setAvatarPreview(URL.createObjectURL(file));
                setAvatarUrl("");
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
}
