import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
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
  Divider,
  Dialog,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  useGetProfileQuery,
  useUpdateUserMutation,
  useLogoutMutation,
} from "../slices/usersApiSlice";
import {
  useUploadCccdMutation,
  useUploadAvatarMutation,
} from "../slices/uploadApiSlice";
import { logout } from "../slices/authSlice";
import CccdDropzone from "../components/CccdDropzone";
import LogoutIcon from "@mui/icons-material/Logout";

/* ✅ MUI X Date Pickers */
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

/* ---------- Config ---------- */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DOB = dayjs("1940-01-01"); // minDate 01/01/1990

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

/* ---------- Gender options ---------- */
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
  gender: "unspecified",
  avatar: "",
};

export default function ProfileScreen() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { data: user, isLoading: fetching, refetch } = useGetProfileQuery();
  const [updateProfile, { isLoading }] = useUpdateUserMutation();
  const [logoutApiCall] = useLogoutMutation();

  const [uploadCccd, { isLoading: upLoad }] = useUploadCccdMutation();
  const [uploadAvatar, { isLoading: uploadingAvatar }] =
    useUploadAvatarMutation();

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [snack, setSnack] = useState({ open: false, type: "success", msg: "" });
  const initialRef = useRef(EMPTY);

  const [frontImg, setFrontImg] = useState(null);
  const [backImg, setBackImg] = useState(null);

  // Avatar state
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState("");
  const [avatarZoomOpen, setAvatarZoomOpen] = useState(false);
  const avatarSrc = useMemo(
    () =>
      avatarPreview ||
      form.avatar ||
      "https://dummyimage.com/400x400/cccccc/ffffff&text=?",
    [avatarPreview, form.avatar]
  );

  // CCCD Zoom state
  const [cccdZoomOpen, setCccdZoomOpen] = useState(false);
  const [cccdZoomSrc, setCccdZoomSrc] = useState("");
  const openCccdZoom = (src) => {
    if (!src) return;
    setCccdZoomSrc(src);
    setCccdZoomOpen(true);
  };

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
      gender: user.gender || "unspecified",
      avatar: user.avatar || "",
    };
    initialRef.current = init;
    setForm(init);
    setAvatarPreview("");
    setAvatarFile(null);
    setUploadedAvatarUrl("");
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
      else if (new Date(d.dob) < new Date("1940-01-01"))
        e.dob = "Không trước 01/01/1940";
    }
    if (!d.province) e.province = "Bắt buộc";
    if (d.cccd && !/^\d{12}$/.test(d.cccd.trim()))
      e.cccd = "CCCD phải đủ 12 số";
    if (d.password) {
      if (d.password.length < 6) e.password = "Tối thiểu 6 ký tự";
      if (d.password !== d.confirmPassword) e.confirmPassword = "Không khớp";
    }
    if (!["male", "female", "unspecified", "other"].includes(d.gender)) {
      e.gender = "Giới tính không hợp lệ";
    }
    return e;
  };
  useEffect(() => setErrors(validate(form)), [form]);

  const isDirty = useMemo(() => {
    const changed = Object.keys(form).some(
      (k) => k !== "confirmPassword" && form[k] !== initialRef.current[k]
    );
    return changed || !!avatarFile;
  }, [form, avatarFile]);

  const isValid = useMemo(() => !Object.keys(errors).length, [errors]);

  // 🔒 CCCD phải hợp lệ (12 số) mới được gửi ảnh
  const isCccdValid = useMemo(
    () => /^\d{12}$/.test((form.cccd || "").trim()),
    [form.cccd]
  );

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
      // Upload avatar nếu cần
      let finalAvatarUrl = uploadedAvatarUrl || form.avatar || "";
      if (avatarFile && !uploadedAvatarUrl) {
        if (avatarFile.size > MAX_FILE_SIZE) {
          setSnack({
            open: true,
            type: "error",
            msg: "Ảnh không được vượt quá 10 MB.",
          });
          return;
        }
        const resUpload = await uploadAvatar(avatarFile).unwrap();
        finalAvatarUrl = resUpload.url;
        setUploadedAvatarUrl(resUpload.url);
        setForm((p) => ({ ...p, avatar: resUpload.url }));
      }

      const payload = diff();
      if (finalAvatarUrl && finalAvatarUrl !== initialRef.current.avatar) {
        payload.avatar = finalAvatarUrl;
      }
      if (!finalAvatarUrl && initialRef.current.avatar) {
        payload.avatar = "";
      }

      await updateProfile(payload).unwrap();
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
    if (!isCccdValid) {
      setSnack({
        open: true,
        type: "error",
        msg: "Vui lòng nhập số CCCD hợp lệ (12 số) trước khi gửi ảnh.",
      });
      return;
    }
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

  /* Logout */
  const onLogout = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigate("/login");
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || "Đăng xuất thất bại",
      });
    }
  };

  const status = user?.cccdStatus || "unverified";
  const showUpload = status === "unverified" || status === "rejected";
  const frontUrl = user?.cccdImages?.front || "";
  const backUrl = user?.cccdImages?.back || "";

  const cccdTrim = (form.cccd || "").trim();
  const isCccdEmpty = cccdTrim === "";

  // Dayjs value cho DatePicker (từ string 'YYYY-MM-DD')
  const dobValue = useMemo(() => {
    if (!form.dob) return null;
    const d = dayjs(form.dob, "YYYY-MM-DD", true);
    return d.isValid() ? d : null;
  }, [form.dob]);

  if (fetching || !user)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 10 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} mb={2}>
          Cập nhật hồ sơ
        </Typography>

        <Box component="form" onSubmit={submit} noValidate>
          <Stack spacing={2}>
            {/* ------ Avatar ------ */}
            <Box display="flex" alignItems="center" gap={2}>
              <Avatar
                src={avatarSrc}
                sx={{ width: 80, height: 80, cursor: "zoom-in" }}
                title="Nhấn để phóng to"
                onClick={() => setAvatarZoomOpen(true)}
                imgProps={{ loading: "lazy" }}
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
                        setSnack({
                          open: true,
                          type: "error",
                          msg: "Ảnh không được vượt quá 10 MB.",
                        });
                        return;
                      }
                      setAvatarFile(file);
                      setAvatarPreview(URL.createObjectURL(file));
                      setUploadedAvatarUrl("");
                    }}
                  />
                </Button>
                {(form.avatar || avatarPreview) && (
                  <Button
                    variant="text"
                    color="error"
                    onClick={() => {
                      setAvatarFile(null);
                      setAvatarPreview("");
                      setUploadedAvatarUrl("");
                      setForm((p) => ({ ...p, avatar: "" }));
                    }}
                  >
                    Xóa ảnh
                  </Button>
                )}
              </Stack>
            </Box>

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

            {/* ✅ DatePicker cho Ngày sinh */}
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
                defaultCalendarMonth={MIN_DOB} // mở đúng tháng/năm 01/1990 khi chưa có giá trị
                referenceDate={MIN_DOB} // tham chiếu mặc định 01/01/1990
                disableFuture
                views={["year", "month", "day"]}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    placeholder: "DD/MM/YYYY", // 👈 placeholder khi chưa chọn
                    onBlur: () => setTouched((t) => ({ ...t, dob: true })),
                    error: showErr("dob"),
                    helperText: showErr("dob") ? errors.dob : " ",
                  },
                }}
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
              helperText={
                showErr("cccd")
                  ? errors.cccd
                  : isCccdEmpty
                  ? "Bạn cần nhập CCCD để gửi ảnh."
                  : " "
              }
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
                {isCccdEmpty && (
                  <Alert severity="info" sx={{ mb: 1 }}>
                    Nhập <strong>số CCCD</strong> trước khi gửi ảnh xác minh.
                  </Alert>
                )}
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
                  disabled={!frontImg || !backImg || upLoad || !isCccdValid}
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
                    alt="CCCD mặt trước"
                    style={{
                      width: "100%",
                      maxHeight: 160,
                      objectFit: "contain",
                      borderRadius: 8,
                      cursor: frontUrl ? "zoom-in" : "default",
                      userSelect: "none",
                    }}
                    onClick={() => openCccdZoom(frontUrl)}
                    loading="lazy"
                    draggable={false}
                  />
                  <Typography align="center" variant="caption">
                    Mặt trước
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <img
                    src={backUrl}
                    alt="CCCD mặt sau"
                    style={{
                      width: "100%",
                      maxHeight: 160,
                      objectFit: "contain",
                      borderRadius: 8,
                      cursor: backUrl ? "zoom-in" : "default",
                      userSelect: "none",
                    }}
                    onClick={() => openCccdZoom(backUrl)}
                    loading="lazy"
                    draggable={false}
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
              disabled={!isDirty || !isValid || isLoading || uploadingAvatar}
              startIcon={
                (isLoading || uploadingAvatar) && <CircularProgress size={20} />
              }
            >
              {isLoading || uploadingAvatar ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </Stack>
        </Box>

        {/* ✅ Đăng xuất dưới cùng, chỉ hiện trên mobile */}
        <Divider sx={{ my: 2, display: { xs: "block", md: "none" } }} />
        <Button
          variant="outlined"
          color="error"
          fullWidth
          startIcon={<LogoutIcon />}
          onClick={onLogout}
          sx={{ display: { xs: "inline-flex", md: "none" } }}
        >
          Đăng xuất
        </Button>
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

      {/* Zoom Avatar */}
      <Dialog
        open={avatarZoomOpen}
        onClose={() => setAvatarZoomOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <Box sx={{ position: "relative" }}>
          <IconButton
            aria-label="Đóng"
            onClick={() => setAvatarZoomOpen(false)}
            size="large"
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              zIndex: 1,
              bgcolor: "rgba(0,0,0,0.65)",
              color: "#fff",
              boxShadow: 3,
              backdropFilter: "blur(2px)",
              "&:hover": { bgcolor: "rgba(0,0,0,0.8)" },
            }}
          >
            <CloseIcon sx={{ fontSize: 26 }} />
          </IconButton>
          <Box
            sx={{
              p: { xs: 1, sm: 2 },
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: { xs: 280, sm: 400 },
            }}
          >
            <img
              src={avatarSrc}
              alt="Avatar"
              onClick={() => setAvatarZoomOpen(false)}
              style={{
                maxWidth: "100%",
                maxHeight: "80vh",
                borderRadius: 12,
                cursor: "zoom-out",
                userSelect: "none",
              }}
              draggable={false}
            />
          </Box>
        </Box>
      </Dialog>

      {/* 🔍 Zoom CCCD (mặt trước / mặt sau) */}
      <Dialog
        open={cccdZoomOpen}
        onClose={() => setCccdZoomOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <Box sx={{ position: "relative" }}>
          <IconButton
            aria-label="Đóng"
            onClick={() => setCccdZoomOpen(false)}
            size="large"
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              zIndex: 1,
              bgcolor: "rgba(0,0,0,0.65)",
              color: "#fff",
              boxShadow: 3,
              backdropFilter: "blur(2px)",
              "&:hover": { bgcolor: "rgba(0,0,0,0.8)" },
            }}
          >
            <CloseIcon sx={{ fontSize: 26 }} />
          </IconButton>
          <Box
            sx={{
              p: { xs: 1, sm: 2 },
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: { xs: 280, sm: 400 },
            }}
          >
            <img
              src={cccdZoomSrc || ""}
              alt="Ảnh CCCD"
              onClick={() => setCccdZoomOpen(false)}
              style={{
                maxWidth: "100%",
                maxHeight: "80vh",
                borderRadius: 12,
                cursor: "zoom-out",
                userSelect: "none",
              }}
              draggable={false}
            />
          </Box>
        </Box>
      </Dialog>
    </Container>
  );
}
