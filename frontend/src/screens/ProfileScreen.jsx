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
  Chip,
} from "@mui/material";
// import { useDispatch, useSelector } from "react-redux";
import {
  useGetProfileQuery,
  useUpdateUserMutation,
} from "../slices/usersApiSlice";
import { useUploadCccdMutation } from "../slices/uploadApiSlice";
import CccdDropzone from "../components/CccdDropzone";

/* ---------- Danh sách tỉnh ---------- */
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

/* ---------- Gender options (enum mới) ---------- */
const GENDER_OPTIONS = [
  { value: "unspecified", label: "--" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
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
  gender: "unspecified", // ⬅️ thêm
};

export default function ProfileScreen() {
  const { data: user, isLoading: fetching, refetch } = useGetProfileQuery();

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [snack, setSnack] = useState({ open: false, type: "success", msg: "" });
  const initialRef = useRef(EMPTY);

  const [updateProfile, { isLoading }] = useUpdateUserMutation();
  const [uploadCccd, { isLoading: upLoad }] = useUploadCccdMutation();

  const [frontImg, setFrontImg] = useState(null);
  const [backImg, setBackImg] = useState(null);

  /* Prefill khi user đến */
  useEffect(() => {
    if (!user) return;
    const init = {
      name: user.name || "",
      nickname: user.nickname || "",
      phone: user.phone || "",
      dob: user.dob ? user.dob.slice(0, 10) : "",
      province: user.province || "",
      cccd: user.cccd || "",
      email: user.email || "",
      password: "",
      confirmPassword: "",
      gender: user.gender || "unspecified", // ⬅️ thêm
    };
    initialRef.current = init;
    setForm(init);
  }, [user]);

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
    // ✅ validate gender theo enum
    if (!["male", "female", "unspecified", "other"].includes(d.gender)) {
      e.gender = "Giới tính không hợp lệ";
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
    const out = { _id: user._id };
    for (const k in form) {
      if (k === "confirmPassword") continue;
      if (form[k] !== initialRef.current[k]) out[k] = form[k];
    }
    return out;
  };

  /* Submit profile */
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
      await updateProfile(diff()).unwrap();
      await refetch();
      setTouched({});
      setSnack({ open: true, type: "success", msg: "Đã lưu thành công" });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || err?.error || "Cập nhật thất bại",
      });
    }
  };

  /* Upload CCCD */
  const sendCccd = async () => {
    if (!frontImg || !backImg || upLoad) return;
    const fd = new FormData();
    fd.append("front", frontImg);
    fd.append("back", backImg);
    try {
      await uploadCccd(fd).unwrap();
      setFrontImg(null);
      setBackImg(null);
      await refetch();
      setSnack({ open: true, type: "success", msg: "Đã gửi, chờ xác minh" });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || "Upload thất bại",
      });
    }
  };

  if (fetching || !user)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10 }}>
        <CircularProgress />
      </Box>
    );

  const status = user.cccdStatus || "unverified";
  const showUpload = status === "unverified" || status === "rejected";
  const frontUrl = user.cccdImages?.front || "";
  const backUrl = user.cccdImages?.back || "";

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} mb={2}>
          Cập nhật hồ sơ
        </Typography>

        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {/* ------ Thông tin cá nhân ------ */}
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

            {/* 🔹 Giới tính */}
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

            {/* ------ Upload / Preview CCCD ------ */}
            <Typography variant="subtitle1" fontWeight={600} mt={1}>
              Ảnh CCCD
            </Typography>
            {showUpload ? (
              <>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <CccdDropzone
                    label="Mặt trước"
                    file={frontImg}
                    onFile={setFrontImg}
                  />
                  <CccdDropzone
                    label="Mặt sau"
                    file={backImg}
                    onFile={setBackImg}
                  />
                </Stack>
                <Button
                  variant="outlined"
                  disabled={!frontImg || !backImg || upLoad}
                  startIcon={upLoad && <CircularProgress size={20} />}
                  onClick={sendCccd}
                >
                  {upLoad ? "Đang gửi…" : "Gửi ảnh xác minh"}
                </Button>
              </>
            ) : (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <img
                    src={frontUrl}
                    alt="front"
                    style={{
                      width: "100%",
                      maxHeight: 160,
                      objectFit: "contain",
                      borderRadius: 8,
                    }}
                  />
                  <Typography align="center" variant="caption">
                    Mặt trước
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <img
                    src={backUrl}
                    alt="back"
                    style={{
                      width: "100%",
                      maxHeight: 160,
                      objectFit: "contain",
                      borderRadius: 8,
                    }}
                  />
                  <Typography align="center" variant="caption">
                    Mặt sau
                  </Typography>
                </Box>
              </Stack>
            )}

            {/* Trạng thái */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">Trạng thái:</Typography>
              <Chip
                size="small"
                color={
                  status === "verified"
                    ? "success"
                    : status === "pending"
                    ? "warning"
                    : status === "rejected"
                    ? "error"
                    : "default"
                }
                label={
                  {
                    unverified: "Chưa xác nhận",
                    pending: "Chờ xác nhận",
                    verified: "Đã xác nhận",
                    rejected: "Bị từ chối",
                  }[status]
                }
              />
            </Stack>

            {/* ------ Lưu thay đổi ------ */}
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
