import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Checkbox,
  FormControlLabel,
  Grid, // ✅ MUI v7 Grid
  Badge,
} from "@mui/material";

// Icons
import CloseIcon from "@mui/icons-material/Close";
import LogoutIcon from "@mui/icons-material/Logout";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import GppBadIcon from "@mui/icons-material/GppBad";
import PendingIcon from "@mui/icons-material/Pending";
import ImageNotSupportedIcon from "@mui/icons-material/ImageNotSupported";

import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router-dom";
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

/* ✅ MUI X Date Pickers */
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

/* ---------- Config ---------- */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIN_DOB = dayjs("1940-01-01");
const PLACEHOLDER_AVATAR = "https://via.placeholder.com/150?text=No+Image"; // Ảnh thế mạng Avatar
const PLACEHOLDER_CCCD = "https://via.placeholder.com/400x250?text=Image+Error"; // Ảnh thế mạng CCCD

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

const GENDER_OPTIONS = [
  { value: "unspecified", label: "Chưa xác định" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
];

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
  const location = useLocation();
  const cccdSectionRef = useRef(null);
  const HEADER_OFFSET = 72;

  const scrollToEl = useCallback((el) => {
    if (!el || typeof window === "undefined") return;
    const top =
      el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
    window.scrollTo({ top, behavior: "smooth" });
    el.style.outline = "2px solid #0284c7";
    el.style.borderRadius = "8px";
    setTimeout(() => {
      el.style.outline = "none";
    }, 1500);
  }, []);

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

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState("");
  const [avatarZoomOpen, setAvatarZoomOpen] = useState(false);
  const avatarSrc = useMemo(
    () => avatarPreview || form.avatar || PLACEHOLDER_AVATAR,
    [avatarPreview, form.avatar]
  );

  const [cccdZoomOpen, setCccdZoomOpen] = useState(false);
  const [cccdZoomSrc, setCccdZoomSrc] = useState("");
  const openCccdZoom = (src) => {
    if (!src) return;
    setCccdZoomSrc(src);
    setCccdZoomOpen(true);
  };

  const [changePassword, setChangePassword] = useState(false);

  useEffect(() => {
    if (fetching) return;
    const hash = (location.hash || "").replace("#", "");
    if (hash === "2" || hash === "cccd") {
      requestAnimationFrame(() => scrollToEl(cccdSectionRef.current));
    }
  }, [location.hash, fetching, scrollToEl]);

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
    setChangePassword(false);
  }, [user]);

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

    if (changePassword) {
      if (!d.password) e.password = "Vui lòng nhập mật khẩu mới";
      else if (d.password.length < 6) e.password = "Tối thiểu 6 ký tự";

      if (!d.confirmPassword) e.confirmPassword = "Vui lòng nhập lại mật khẩu";
      else if (d.password !== d.confirmPassword)
        e.confirmPassword = "Không khớp";
    }

    if (!["male", "female", "unspecified", "other"].includes(d.gender)) {
      e.gender = "Giới tính không hợp lệ";
    }
    return e;
  };

  useEffect(() => setErrors(validate(form)), [form, changePassword]);

  const isDirty = useMemo(() => {
    const changed = Object.keys(form).some(
      (k) => k !== "confirmPassword" && form[k] !== initialRef.current[k]
    );
    return changed || !!avatarFile;
  }, [form, avatarFile]);

  const isValid = useMemo(() => !Object.keys(errors).length, [errors]);

  const isCccdValid = useMemo(
    () => /^\d{12}$/.test((form.cccd || "").trim()),
    [form.cccd]
  );

  const showErr = (f) => touched[f] && !!errors[f];
  const onChange = (e) =>
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  const onBlur = (e) => setTouched((t) => ({ ...t, [e.target.name]: true }));

  const diff = () => {
    const out = { _id: user._id };
    for (const k in form) {
      if (k === "confirmPassword") continue;
      if (form[k] !== initialRef.current[k]) out[k] = form[k];
    }
    return out;
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map((k) => [k, true])));
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length)
      return setSnack({
        open: true,
        type: "error",
        msg: "Vui lòng kiểm tra lại thông tin!",
      });
    if (!isDirty)
      return setSnack({
        open: true,
        type: "info",
        msg: "Bạn chưa thay đổi thông tin nào.",
      });

    try {
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
      setSnack({
        open: true,
        type: "success",
        msg: "Cập nhật hồ sơ thành công!",
      });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || err?.error || "Cập nhật thất bại",
      });
    }
  };

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
      setSnack({
        open: true,
        type: "success",
        msg: "Đã gửi ảnh, vui lòng chờ xác minh.",
      });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || "Upload thất bại",
      });
    }
  };

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
  const isKycLocked = status === "verified";

  const cccdTrim = (form.cccd || "").trim();
  const isCccdEmpty = cccdTrim === "";

  const dobValue = useMemo(() => {
    if (!form.dob) return null;
    const d = dayjs(form.dob, "YYYY-MM-DD", true);
    return d.isValid() ? d : null;
  }, [form.dob]);

  // ✅ Hàm xử lý khi ảnh lỗi
  const handleImgError = (e) => {
    e.target.src = PLACEHOLDER_AVATAR;
  };
  const handleCccdError = (e) => {
    e.target.src = PLACEHOLDER_CCCD;
  };

  if (fetching || !user)
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "80vh",
        }}
      >
        <CircularProgress size={60} thickness={4} />
      </Box>
    );

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Box mb={4} textAlign="center">
        <Typography
          variant="h4"
          fontWeight={800}
          gutterBottom
          sx={{
            background: "linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Hồ sơ cá nhân
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Quản lý thông tin hồ sơ và bảo mật tài khoản của bạn
        </Typography>
      </Box>

      <Box component="form" onSubmit={submit} noValidate>
        <Grid container spacing={3}>
          {/* Cột trái: Avatar & Thông tin */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper
              elevation={4}
              sx={{
                p: 4,
                textAlign: "center",
                borderRadius: 4,
                height: "100%",
              }}
            >
              <Box
                sx={{ position: "relative", display: "inline-block", mb: 2 }}
              >
                <Badge
                  overlap="circular"
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  badgeContent={
                    <IconButton
                      component="label"
                      disabled={uploadingAvatar || isLoading}
                      sx={{
                        bgcolor: "primary.main",
                        color: "white",
                        width: 36,
                        height: 36,
                        border: "3px solid white",
                        "&:hover": { bgcolor: "primary.dark" },
                        boxShadow: 3,
                      }}
                    >
                      {uploadingAvatar ? (
                        <CircularProgress size={20} color="inherit" />
                      ) : (
                        <CameraAltIcon fontSize="small" />
                      )}
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
                              msg: "Ảnh quá lớn (>10MB).",
                            });
                            return;
                          }
                          setAvatarFile(file);
                          setAvatarPreview(URL.createObjectURL(file));
                          setUploadedAvatarUrl("");
                        }}
                      />
                    </IconButton>
                  }
                >
                  <Avatar
                    src={avatarSrc}
                    // ✅ Fallback khi ảnh avatar lỗi
                    imgProps={{ onError: handleImgError }}
                    sx={{
                      width: 140,
                      height: 140,
                      border: "4px solid #e3f2fd",
                      boxShadow: 3,
                      cursor: "zoom-in",
                      transition: "transform 0.2s",
                      "&:hover": { transform: "scale(1.05)" },
                    }}
                    onClick={() => setAvatarZoomOpen(true)}
                  />
                </Badge>
              </Box>

              <Typography variant="h6" fontWeight={700}>
                {form.nickname || "User"}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {form.email}
              </Typography>

              {(form.avatar || avatarPreview) && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  sx={{ mt: 1, textTransform: "none" }}
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

              {/* ✅ Desktop: Hiện nút đăng xuất ở Sidebar */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <Divider sx={{ my: 3 }} />
                <Button
                  variant="outlined"
                  color="error"
                  fullWidth
                  startIcon={<LogoutIcon />}
                  onClick={onLogout}
                  sx={{ borderRadius: 2, py: 1 }}
                >
                  Đăng xuất
                </Button>
              </Box>
            </Paper>
          </Grid>

          {/* Cột phải: Form */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper elevation={3} sx={{ p: 4, borderRadius: 4 }}>
              <Typography
                variant="h6"
                fontWeight={700}
                mb={3}
                sx={{
                  borderLeft: "4px solid #1976d2",
                  pl: 2,
                  color: "#1976d2",
                }}
              >
                Thông tin chung
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Họ và tên"
                    name="name"
                    value={form.name}
                    onChange={onChange}
                    onBlur={onBlur}
                    required
                    fullWidth
                    error={showErr("name")}
                    helperText={showErr("name") ? errors.name : ""}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Biệt danh"
                    name="nickname"
                    value={form.nickname}
                    onChange={onChange}
                    onBlur={onBlur}
                    required
                    fullWidth
                    error={showErr("nickname")}
                    helperText={showErr("nickname") ? errors.nickname : ""}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Số điện thoại"
                    name="phone"
                    value={form.phone}
                    onChange={onChange}
                    onBlur={onBlur}
                    required
                    fullWidth
                    error={showErr("phone")}
                    helperText={showErr("phone") ? errors.phone : ""}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Email"
                    name="email"
                    value={form.email}
                    onChange={onChange}
                    onBlur={onBlur}
                    required
                    fullWidth
                    disabled
                    error={showErr("email")}
                    helperText={showErr("email") ? errors.email : ""}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth error={showErr("gender")}>
                    <InputLabel id="gender-lbl">Giới tính</InputLabel>
                    <Select
                      labelId="gender-lbl"
                      label="Giới tính"
                      name="gender"
                      value={form.gender}
                      onChange={onChange}
                      onBlur={onBlur}
                    >
                      {GENDER_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
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
                    disableFuture
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        onBlur: () => setTouched((t) => ({ ...t, dob: true })),
                        error: showErr("dob"),
                        helperText: showErr("dob") ? errors.dob : "",
                      },
                    }}
                  />
                </Grid>

                <Grid size={{ xs: 12 }}>
                  <FormControl fullWidth required error={showErr("province")}>
                    <InputLabel id="province-lbl">Tỉnh / Thành phố</InputLabel>
                    <Select
                      labelId="province-lbl"
                      label="Tỉnh / Thành phố"
                      name="province"
                      value={form.province}
                      onChange={onChange}
                      onBlur={onBlur}
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
                      <Typography
                        variant="caption"
                        color="error"
                        sx={{ mx: 2, mt: 0.5 }}
                      >
                        {errors.province}
                      </Typography>
                    )}
                  </FormControl>
                </Grid>
              </Grid>

              {/* Phần Đổi mật khẩu */}
              <Box
                mt={4}
                p={2}
                sx={{
                  bgcolor: "grey.50",
                  borderRadius: 3,
                  border: "1px dashed #ccc",
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={changePassword}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setChangePassword(checked);
                        if (!checked) {
                          setForm((p) => ({
                            ...p,
                            password: "",
                            confirmPassword: "",
                          }));
                          setTouched((t) => ({
                            ...t,
                            password: false,
                            confirmPassword: false,
                          }));
                        }
                      }}
                      color="primary"
                    />
                  }
                  label={<Typography fontWeight={600}>Đổi mật khẩu</Typography>}
                />

                {changePassword && (
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Mật khẩu mới"
                        type="password"
                        name="password"
                        value={form.password}
                        onChange={onChange}
                        onBlur={onBlur}
                        fullWidth
                        error={showErr("password")}
                        helperText={showErr("password") ? errors.password : ""}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
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
                          showErr("confirmPassword")
                            ? errors.confirmPassword
                            : ""
                        }
                      />
                    </Grid>
                  </Grid>
                )}
              </Box>

              {/* Phần CCCD */}
              <Box
                mt={4}
                ref={cccdSectionRef}
                id="cccd"
                sx={{ scrollMarginTop: `${HEADER_OFFSET + 16}px` }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  mb={2}
                >
                  <Typography
                    variant="h6"
                    fontWeight={700}
                    sx={{
                      borderLeft: "4px solid #ed6c02",
                      pl: 2,
                      color: "#ed6c02",
                    }}
                  >
                    Xác minh danh tính (KYC)
                  </Typography>
                  <Chip
                    icon={
                      status === "verified" ? (
                        <VerifiedUserIcon />
                      ) : status === "rejected" ? (
                        <GppBadIcon />
                      ) : (
                        <PendingIcon />
                      )
                    }
                    label={
                      {
                        unverified: "Chưa xác minh",
                        pending: "Đang chờ duyệt",
                        verified: "Đã xác minh",
                        rejected: "Bị từ chối",
                      }[status]
                    }
                    color={
                      {
                        verified: "success",
                        pending: "warning",
                        rejected: "error",
                        unverified: "default",
                      }[status]
                    }
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                </Stack>

                <TextField
                  label="Số CCCD (12 số)"
                  name="cccd"
                  value={form.cccd}
                  onChange={onChange}
                  onBlur={onBlur}
                  fullWidth
                  inputProps={{ inputMode: "numeric", maxLength: 12 }}
                  disabled={isKycLocked}
                  error={showErr("cccd")}
                  helperText={
                    isKycLocked
                      ? "Không thể sửa khi đã xác minh"
                      : showErr("cccd")
                      ? errors.cccd
                      : isCccdEmpty
                      ? "Nhập số CCCD để kích hoạt upload ảnh"
                      : ""
                  }
                  sx={{ mb: 3 }}
                />

                {showUpload ? (
                  <Box
                    p={3}
                    sx={{
                      bgcolor: "#f9fafb",
                      borderRadius: 3,
                      border: "1px solid #eee",
                    }}
                  >
                    {isCccdEmpty && (
                      <Alert severity="info" sx={{ mb: 2 }}>
                        Vui lòng nhập <strong>số CCCD</strong> ở trên để tải ảnh
                        lên.
                      </Alert>
                    )}
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <CccdDropzone
                          label="Mặt trước"
                          file={frontImg}
                          onFile={setFrontImg}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <CccdDropzone
                          label="Mặt sau"
                          file={backImg}
                          onFile={setBackImg}
                        />
                      </Grid>
                    </Grid>
                    <Button
                      variant="outlined"
                      fullWidth
                      disabled={!frontImg || !backImg || upLoad || !isCccdValid}
                      startIcon={upLoad && <CircularProgress size={20} />}
                      onClick={sendCccd}
                      sx={{
                        mt: 2,
                        py: 1.5,
                        borderStyle: "dashed",
                        borderWidth: 2,
                      }}
                    >
                      {upLoad ? "Đang gửi yêu cầu..." : "Gửi yêu cầu xác minh"}
                    </Button>
                  </Box>
                ) : (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6 }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1,
                          bgcolor: "#f4f4f4",
                          cursor: "zoom-in",
                          "&:hover": { borderColor: "primary.main" },
                        }}
                        onClick={() => openCccdZoom(frontUrl)}
                      >
                        {/* ✅ Fallback cho ảnh CCCD */}
                        <img
                          src={frontUrl}
                          alt="Mặt trước"
                          style={{
                            width: "100%",
                            height: 120,
                            objectFit: "contain",
                          }}
                          onError={handleCccdError}
                        />
                        <Typography
                          align="center"
                          variant="caption"
                          display="block"
                        >
                          Mặt trước
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1,
                          bgcolor: "#f4f4f4",
                          cursor: "zoom-in",
                          "&:hover": { borderColor: "primary.main" },
                        }}
                        onClick={() => openCccdZoom(backUrl)}
                      >
                        {/* ✅ Fallback cho ảnh CCCD */}
                        <img
                          src={backUrl}
                          alt="Mặt sau"
                          style={{
                            width: "100%",
                            height: 120,
                            objectFit: "contain",
                          }}
                          onError={handleCccdError}
                        />
                        <Typography
                          align="center"
                          variant="caption"
                          display="block"
                        >
                          Mặt sau
                        </Typography>
                      </Paper>
                    </Grid>
                  </Grid>
                )}
              </Box>

              {/* Nút Lưu Form */}
              <Box mt={5}>
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  size="large"
                  disabled={
                    !isDirty || !isValid || isLoading || uploadingAvatar
                  }
                  startIcon={
                    isLoading || uploadingAvatar ? (
                      <CircularProgress size={20} color="inherit" />
                    ) : (
                      <SaveIcon />
                    )
                  }
                  sx={{
                    borderRadius: 3,
                    py: 1.5,
                    fontSize: "1rem",
                    fontWeight: 700,
                    boxShadow: "0 8px 16px rgba(33, 150, 243, 0.24)",
                  }}
                >
                  {isLoading || uploadingAvatar
                    ? "Đang xử lý..."
                    : "Lưu thay đổi"}
                </Button>
              </Box>

              {/* ✅ Mobile Only: Nút đăng xuất nằm ở CUỐI CÙNG */}
              <Box sx={{ display: { xs: "block", md: "none" }, mt: 3 }}>
                <Divider sx={{ mb: 3 }}>
                  <Chip label="Tài khoản" size="small" />
                </Divider>
                <Button
                  variant="outlined"
                  color="error"
                  fullWidth
                  startIcon={<LogoutIcon />}
                  onClick={onLogout}
                  sx={{ borderRadius: 2, py: 1.5 }}
                >
                  Đăng xuất
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      </Box>

      {/* Snackbar Alert */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          severity={snack.type}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{ width: "100%", boxShadow: 6 }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>

      {/* Dialog Zoom Avatar */}
      <Dialog
        open={avatarZoomOpen}
        onClose={() => setAvatarZoomOpen(false)}
        maxWidth="md"
      >
        <Box position="relative" p={1} bgcolor="black">
          <IconButton
            onClick={() => setAvatarZoomOpen(false)}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: "white",
              bgcolor: "rgba(0,0,0,0.5)",
            }}
          >
            <CloseIcon />
          </IconButton>
          <img
            src={avatarSrc}
            onError={handleImgError}
            alt="Avatar Zoom"
            style={{
              maxWidth: "100%",
              maxHeight: "80vh",
              display: "block",
              margin: "auto",
            }}
          />
        </Box>
      </Dialog>

      {/* Dialog Zoom CCCD */}
      <Dialog
        open={cccdZoomOpen}
        onClose={() => setCccdZoomOpen(false)}
        maxWidth="md"
      >
        <Box position="relative" p={1} bgcolor="black">
          <IconButton
            onClick={() => setCccdZoomOpen(false)}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: "white",
              bgcolor: "rgba(0,0,0,0.5)",
            }}
          >
            <CloseIcon />
          </IconButton>
          <img
            src={cccdZoomSrc}
            onError={handleCccdError}
            alt="CCCD Zoom"
            style={{
              maxWidth: "100%",
              maxHeight: "80vh",
              display: "block",
              margin: "auto",
            }}
          />
        </Box>
      </Dialog>
    </Container>
  );
}
