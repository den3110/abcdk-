// src/screens/ProfileScreen.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { useUpdateUserMutation } from "../slices/usersApiSlice";
import { setCredentials } from "../slices/authSlice";

/* ---------- Danh sách tỉnh ---------- */
const PROVINCES = [
  /* ...như trước, giữ nguyên... */
  "An Giang", "Bà Rịa‑Vũng Tàu", "Bạc Liêu", "Bắc Giang", "Bắc Kạn",
  "Bắc Ninh", "Bến Tre", "Bình Dương", "Bình Định", "Bình Phước", "Bình Thuận",
  "Cà Mau", "Cao Bằng", "Cần Thơ", "Đà Nẵng", "Đắk Lắk", "Đắk Nông", "Điện Biên",
  "Đồng Nai", "Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam", "Hà Nội", "Hà Tĩnh",
  "Hải Dương", "Hải Phòng", "Hậu Giang", "Hòa Bình", "Hưng Yên", "Khánh Hòa",
  "Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai",
  "Long An", "Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ",
  "Phú Yên", "Quảng Bình", "Quảng Nam", "Quảng Ngãi", "Quảng Ninh",
  "Quảng Trị", "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên",
  "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang", "TP Hồ Chí Minh", "Trà Vinh",
  "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
];

/* ---------- Form gốc ---------- */
const EMPTY = {
  name: "",
  nickname: "",
  phone: "",
  dob: "",
  province: "",
  cccd: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export default function ProfileScreen() {
  const dispatch = useDispatch();
  const { userInfo } = useSelector((s) => s.auth);

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [snack, setSnack] = useState({ open: false, type: "success", msg: "" });
  const initialRef = useRef(EMPTY);
  const [updateProfile, { isLoading }] = useUpdateUserMutation();

  /* Prefill */
  useEffect(() => {
    if (!userInfo) return;
    const init = {
      name: userInfo.name || "",
      nickname: userInfo.nickname || "",
      phone: userInfo.phone || "",
      dob: userInfo.dob ? userInfo.dob.slice(0, 10) : "",
      province: userInfo.province || "",
      cccd: userInfo.cccd || "",
      email: userInfo.email || "",
      password: "",
      confirmPassword: "",
    };
    initialRef.current = init;
    setForm(init);
  }, [userInfo]);

  /* Validate */
  const validate = (d) => {
    const e = {};
    if (!d.name.trim()) e.name = "Không được bỏ trống";
    else if (d.name.trim().length < 2) e.name = "Tối thiểu 2 ký tự";

    if (!d.nickname.trim()) e.nickname = "Không được bỏ trống";
    else if (d.nickname.trim().length < 2) e.nickname = "Tối thiểu 2 ký tự";

    if (!/^0\d{9}$/.test(d.phone.trim())) e.phone = "Sai định dạng (10 chữ số)";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
      e.email = "Email không hợp lệ";

    if (d.dob) {
      const day = new Date(d.dob);
      if (Number.isNaN(day)) e.dob = "Ngày sinh không hợp lệ";
      else if (day > new Date()) e.dob = "Không được ở tương lai";
    }

    if (!d.province) e.province = "Bắt buộc";

    if (d.cccd && !/^\d{12}$/.test(d.cccd.trim()))
      e.cccd = "CCCD phải đủ 12 số";

    if (d.password) {
      if (d.password.length < 6) e.password = "Tối thiểu 6 ký tự";
      if (d.password !== d.confirmPassword) e.confirmPassword = "Không khớp";
    }
    return e;
  };
  useEffect(() => setErrors(validate(form)), [form]);

  const isDirty = useMemo(
    () =>
      Object.keys(form).some(
        (k) => k !== "confirmPassword" && form[k] !== initialRef.current[k]
      ),
    [form]
  );
  const isValid = useMemo(() => !Object.keys(errors).length, [errors]);

  /* Helpers */
  const showErr = (f) => touched[f] && !!errors[f];
  const onChange = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  const onBlur = (e) => setTouched((t) => ({ ...t, [e.target.name]: true }));

  /* Diff payload */
  const diff = () => {
    const out = { _id: userInfo._id };
    for (const k in form) {
      if (k === "confirmPassword") continue;
      if (form[k] && form[k] !== initialRef.current[k]) out[k] = form[k];
    }
    return out;
  };

  /* Submit */
  const submit = async (e) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map((k) => [k, true])));
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length)
      return setSnack({ open: true, type: "error", msg: "Kiểm tra lại!" });
    if (!isDirty)
      return setSnack({ open: true, type: "info", msg: "Chưa thay đổi" });

    try {
      const res = await updateProfile(diff()).unwrap();
      dispatch(setCredentials(res));
      initialRef.current = { ...form, password: "", confirmPassword: "" };
      setForm((f) => ({ ...f, password: "", confirmPassword: "" }));
      setTouched({});
      setSnack({ open: true, type: "success", msg: "Đã lưu thành công" });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || err.error || "Cập nhật thất bại",
      });
    }
  };

  /* ---------------- UI ---------------- */
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} mb={2}>
          Cập nhật hồ sơ
        </Typography>

        {/* Form */}
        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
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
              label="Biệt danh"
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
              inputProps={{ inputMode: "numeric", pattern: "0\\d{9}" }}
              error={showErr("phone")}
              helperText={showErr("phone") ? errors.phone : " "}
            />

            <TextField
              label="Ngày sinh"
              type="date"
              name="dob"
              value={form.dob}
              onChange={onChange}
              onBlur={onBlur}
              fullWidth
              InputLabelProps={{ shrink: true }}
              error={showErr("dob")}
              helperText={showErr("dob") ? errors.dob : " "}
            />

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

            <TextField
              label="Mã định danh CCCD"
              name="cccd"
              value={form.cccd}
              onChange={onChange}
              onBlur={onBlur}
              fullWidth
              placeholder="12 chữ số"
              inputProps={{ inputMode: "numeric", maxLength: 12 }}
              error={showErr("cccd")}
              helperText={showErr("cccd") ? errors.cccd : " "}
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

            <TextField
              label="Mật khẩu mới"
              type="password"
              name="password"
              value={form.password}
              onChange={onChange}
              onBlur={onBlur}
              fullWidth
              placeholder="Để trống nếu không đổi"
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
              fullWidth
              error={showErr("confirmPassword")}
              helperText={
                showErr("confirmPassword") ? errors.confirmPassword : " "
              }
            />

            <Button
              type="submit"
              variant="contained"
              disabled={!isDirty || !isValid || isLoading}
              startIcon={isLoading && <CircularProgress size={20} />}
            >
              {isLoading ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </Stack>
        </Box>
      </Paper>

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.type}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Container>
  );
}
