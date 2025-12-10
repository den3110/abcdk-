// src/screens/RegisterScreen.jsx
import { useState, useMemo, useRef, useEffect } from "react";
import React from "react";
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
  Paper,
  Stack,
  Alert,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useRegisterMutation } from "../slices/usersApiSlice";
import { useUploadRealAvatarMutation } from "../slices/uploadApiSlice"; // 👈 chỉ còn avatar thôi
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";

/* MUI X Date Pickers */
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

/* ---------- Config ---------- */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DOB = dayjs("1940-01-01");

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

/* ---------- Utils ---------- */
const EMPTY = {
  name: "",
  nickname: "",
  phone: "",
  dob: "",
  email: "",
  password: "",
  confirmPassword: "",
  cccd: "",
  province: "",
  gender: "unspecified",
  avatar: "",
};

export default function RegisterScreen() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [register, { isLoading }] = useRegisterMutation();
  const [uploadAvatar, { isLoading: uploadingAvatar }] =
    useUploadRealAvatarMutation();

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});

  // Avatar
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");

  // Refs để scroll tới khu vực lỗi
  const avatarRef = useRef(null);

  const [highlightAvatar, setHighlightAvatar] = useState(false);

  const dobValue = useMemo(() => {
    if (!form.dob) return null;
    const d = dayjs(form.dob, "YYYY-MM-DD", true);
    return d.isValid() ? d : null;
  }, [form.dob]);

  const isCccdValid = useMemo(
    () => /^\d{12}$/.test((form.cccd || "").trim()),
    [form.cccd]
  );

  const showErr = (f) => touched[f] && !!errors[f];

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };
  const onBlur = (e) => {
    const { name } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors((prev) => {
      const next = validate({ ...form });
      return next;
    });
  };

  const validate = (d) => {
    const e = {};
    // Basic
    if (!d.name.trim()) e.name = "Không được bỏ trống";
    else if (d.name.trim().length < 2) e.name = "Tối thiểu 2 ký tự";

    if (!d.nickname.trim()) e.nickname = "Không được bỏ trống";
    else if (d.nickname.trim().length < 2) e.nickname = "Tối thiểu 2 ký tự";

    if (!/^0\d{9}$/.test(d.phone.trim()))
      e.phone = "Sai định dạng (10 chữ số, bắt đầu bằng 0)";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
      e.email = "Email không hợp lệ";

    if (!d.password) e.password = "Bắt buộc";
    else if (d.password.length < 6) e.password = "Tối thiểu 6 ký tự";
    if (d.password !== d.confirmPassword) e.confirmPassword = "Không khớp";

    if (!d.dob) e.dob = "Bắt buộc";
    else {
      const day = new Date(d.dob);
      if (Number.isNaN(day)) e.dob = "Ngày sinh không hợp lệ";
      else if (day > new Date()) e.dob = "Không được ở tương lai";
      else if (new Date(d.dob) < new Date("1940-01-01"))
        e.dob = "Không trước 01/01/1940";
    }

    if (!d.province) e.province = "Bắt buộc";

    if (!["male", "female", "unspecified", "other"].includes(d.gender))
      e.gender = "Giới tính không hợp lệ";

    if (!d.cccd.trim()) e.cccd = "Bắt buộc";
    else if (!/^\d{12}$/.test(d.cccd.trim())) e.cccd = "CCCD phải đủ 12 số";

    // Avatar vẫn bắt
    if (!avatarFile) e.avatar = "Vui lòng tải ảnh đại diện.";
    if (avatarFile && avatarFile.size > MAX_FILE_SIZE)
      e.avatar = "Ảnh không vượt quá 10MB";

    // ❗️KHÔNG còn validate ảnh CCCD nữa
    return e;
  };

  // luôn tính lại lỗi khi form/ảnh thay đổi
  useEffect(() => {
    setErrors(validate(form));
  }, [form, avatarFile]);

  // nếu avatar ok thì tắt highlight
  useEffect(() => {
    if (!errors.avatar) setHighlightAvatar(false);
  }, [errors.avatar]);

  const jumpAndHighlight = (ref, setHighlight) => {
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(true);
    setTimeout(() => setHighlight(false), 1200);
  };

  const submitHandler = async (e) => {
    e.preventDefault();
    setTouched({
      name: true,
      nickname: true,
      phone: true,
      dob: true,
      email: true,
      password: true,
      confirmPassword: true,
      cccd: true,
      province: true,
      gender: true,
      avatar: true,
      // ❌ không còn cccdFront / cccdBack
    });

    const errs = validate(form);
    setErrors(errs);

    if (errs.avatar) {
      jumpAndHighlight(avatarRef, setHighlightAvatar);
    }

    if (Object.keys(errs).length) {
      toast.error("Vui lòng kiểm tra lại thông tin.");
      return;
    }

    try {
      // 1) Upload avatar
      let avatarUrl = "";
      if (avatarFile) {
        const res = await uploadAvatar(avatarFile).unwrap();
        avatarUrl = res?.url || "";
        if (!avatarUrl) throw new Error("Upload avatar thất bại");
      }

      // 2) Register — chỉ gửi số CCCD, KHÔNG gửi ảnh
      const payload = {
        name: form.name.trim(),
        nickname: form.nickname.trim(),
        phone: form.phone.trim(),
        dob: form.dob,
        email: form.email.trim(),
        password: form.password,
        cccd: form.cccd.trim(),
        province: form.province,
        gender: form.gender,
        avatar: avatarUrl,
        // cccdImages: { ... } // ❌ tạm ẩn
      };

      const res = await register(payload).unwrap();
      dispatch(setCredentials(res));
      toast.success("Đăng ký thành công!");
      navigate("/");
    } catch (err) {
      const msg = err?.data?.message || err?.message || "Đăng ký thất bại";
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
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Đăng ký
        </Typography>

        <Box component="form" noValidate onSubmit={submitHandler}>
          <Stack spacing={2}>
            {/* Avatar */}
            <Box
              ref={avatarRef}
              sx={{
                p: 1,
                borderRadius: 1.5,
                transition: "box-shadow .2s, border-color .2s",
                border: highlightAvatar ? "1px solid" : "1px solid transparent",
                borderColor: highlightAvatar ? "error.main" : "transparent",
                boxShadow: highlightAvatar ? 3 : 0,
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <Avatar
                  src={
                    avatarPreview ||
                    "https://dummyimage.com/80x80/cccccc/ffffff&text=?"
                  }
                  sx={{ width: 80, height: 80 }}
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <Button
                    variant="outlined"
                    component="label"
                    disabled={uploadingAvatar || isLoading}
                  >
                    Chọn ảnh đại diện
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > MAX_FILE_SIZE) {
                          setErrors((p) => ({
                            ...p,
                            avatar: "Ảnh không vượt quá 10MB",
                          }));
                          jumpAndHighlight(avatarRef, setHighlightAvatar);
                          return;
                        }
                        setAvatarFile(file);
                        setAvatarPreview(URL.createObjectURL(file));
                        setErrors((p) => ({ ...p, avatar: undefined }));
                      }}
                    />
                  </Button>
                </Stack>
              </Box>
              {showErr("avatar") && errors.avatar && (
                <Alert severity="error" sx={{ mt: 1 }} role="alert">
                  {errors.avatar}
                </Alert>
              )}
            </Box>

            {/* Basic fields */}
            <TextField
              label="Họ và tên"
              name="name"
              value={form.name}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("name")}
              helperText={showErr("name") ? errors.name : " "}
            />
            <TextField
              label="Nickname"
              name="nickname"
              value={form.nickname}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("nickname")}
              helperText={showErr("nickname") ? errors.nickname : " "}
            />
            <TextField
              label="Số điện thoại"
              name="phone"
              value={form.phone}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              inputProps={{
                inputMode: "numeric",
                pattern: "0\\d{9}",
                maxLength: 10,
              }}
              error={showErr("phone")}
              helperText={showErr("phone") ? errors.phone : " "}
            />

            <TextField
              label="Email"
              type="email"
              name="email"
              value={form.email}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("email")}
              helperText={showErr("email") ? errors.email : " "}
            />

            {/* Gender */}
            <FormControl fullWidth error={showErr("gender")}>
              <InputLabel id="gender-lbl" shrink>
                Giới tính
              </InputLabel>
              <Select
                labelId="gender-lbl"
                label="Giới tính"
                name="gender"
                value={form.gender}
                onChange={onChange}
                onBlur={onBlur}
                displayEmpty
                required
              >
                {GENDER_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
              {showErr("gender") && (
                <Typography variant="caption" color="error">
                  {errors.gender}
                </Typography>
              )}
            </FormControl>

            {/* DOB */}
            <DatePicker
              label="Ngày sinh"
              value={dobValue}
              onChange={(newVal) => {
                setTouched((t) => ({ ...t, dob: true }));
                setForm((p) => ({
                  ...p,
                  dob:
                    newVal && newVal.isValid()
                      ? newVal.format("YYYY-MM-DD")
                      : "",
                }));
              }}
              format="DD/MM/YYYY"
              minDate={MIN_DOB}
              defaultCalendarMonth={MIN_DOB}
              referenceDate={MIN_DOB}
              disableFuture
              views={["year", "month", "day"]}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  placeholder: "DD/MM/YYYY",
                  onBlur: () => setTouched((t) => ({ ...t, dob: true })),
                  error: showErr("dob"),
                  helperText: showErr("dob") ? errors.dob : " ",
                },
              }}
            />

            {/* Province */}
            <FormControl fullWidth required error={showErr("province")}>
              <InputLabel id="province-lbl" shrink>
                Tỉnh / Thành phố
              </InputLabel>
              <Select
                labelId="province-lbl"
                label="Tỉnh / Thành phố"
                name="province"
                value={form.province}
                onChange={onChange}
                onBlur={onBlur}
                displayEmpty
                required
              >
                <MenuItem value="">
                  <em>-- Chọn --</em>
                </MenuItem>
                {PROVINCES.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </Select>
              {showErr("province") && (
                <Typography variant="caption" color="error">
                  {errors.province}
                </Typography>
              )}
            </FormControl>

            {/* CCCD */}
            <TextField
              label="Mã định danh CCCD"
              name="cccd"
              value={form.cccd}
              onChange={onChange}
              onBlur={onBlur}
              fullWidth
              required
              placeholder="12 chữ số"
              inputProps={{ inputMode: "numeric", maxLength: 12 }}
              error={showErr("cccd")}
              helperText={showErr("cccd") ? errors.cccd : " "}
            />

            {/* ❌ Tạm ẩn block upload ảnh CCCD
            <Box>...</Box>
            */}

            {/* Password */}
            <TextField
              label="Mật khẩu"
              type="password"
              name="password"
              value={form.password}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("password")}
              helperText={showErr("password") ? errors.password : " "}
            />
            <TextField
              label="Xác nhận mật khẩu"
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("confirmPassword")}
              helperText={
                showErr("confirmPassword") ? errors.confirmPassword : " "
              }
            />

            {/* Submit */}
            <Button
              type="submit"
              fullWidth
              variant="contained"
              color="primary"
              disabled={isLoading || uploadingAvatar}
              startIcon={
                (isLoading || uploadingAvatar) && <CircularProgress size={20} />
              }
            >
              {isLoading || uploadingAvatar ? "Đang xử lý..." : "Đăng ký"}
            </Button>
          </Stack>
        </Box>

        <Typography variant="body2" align="center" sx={{ mt: 2 }}>
          Đã có tài khoản?{" "}
          <MuiLink component={Link} to="/login" underline="hover">
            Đăng nhập
          </MuiLink>
        </Typography>
      </Paper>
    </Container>
  );
}
