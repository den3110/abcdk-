// src/screens/RegisterScreen.jsx
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
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
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useRegisterMutation } from "../slices/usersApiSlice";
import { useUploadRealAvatarMutation } from "../slices/uploadApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

/* Icons */
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";

/* MUI X Date Pickers */
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

/* ---------- Config ---------- */
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DOB = dayjs("1970-01-01");

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
  const { t, language } = useLanguage();

  const [register, { isLoading }] = useRegisterMutation();
  const [uploadAvatar, { isLoading: uploadingAvatar }] =
    useUploadRealAvatarMutation();

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});

  // ✅ Show/Hide password
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

  const genderOptions = useMemo(
    () => [
      { value: "unspecified", label: t("auth.register.genderOptions.unspecified") },
      { value: "male", label: t("auth.register.genderOptions.male") },
      { value: "female", label: t("auth.register.genderOptions.female") },
      { value: "other", label: t("auth.register.genderOptions.other") },
    ],
    [t]
  );

  const showErr = (f) => touched[f] && !!errors[f];

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };
  const onBlur = (e) => {
    const { name } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors(() => validate({ ...form }));
  };

  const validate = useCallback((d) => {
    const e = {};
    if (!d.name.trim()) e.name = t("auth.register.validation.empty");
    else if (d.name.trim().length < 2)
      e.name = t("auth.register.validation.minChars", { count: 2 });

    if (!d.nickname.trim()) e.nickname = t("auth.register.validation.empty");
    else if (d.nickname.trim().length < 2)
      e.nickname = t("auth.register.validation.minChars", { count: 2 });

    if (!/^0\d{9}$/.test(d.phone.trim()))
      e.phone = t("auth.register.validation.invalidPhone");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
      e.email = t("auth.register.validation.invalidEmail");

    if (!d.password) e.password = t("auth.register.validation.required");
    else if (d.password.length < 6)
      e.password = t("auth.register.validation.minChars", { count: 6 });
    if (d.password !== d.confirmPassword)
      e.confirmPassword = t("auth.register.validation.passwordMismatch");

    if (!d.dob) e.dob = t("auth.register.validation.required");
    else {
      const day = new Date(d.dob);
      if (Number.isNaN(day)) e.dob = t("auth.register.validation.invalidDob");
      else if (day > new Date()) e.dob = t("auth.register.validation.futureDob");
      else if (new Date(d.dob) < new Date("1940-01-01"))
        e.dob = t("auth.register.validation.minDob");
    }

    if (!d.province) e.province = t("auth.register.validation.required");

    if (!["male", "female", "unspecified", "other"].includes(d.gender))
      e.gender = t("auth.register.validation.invalidGender");

    if (!d.cccd.trim()) e.cccd = t("auth.register.validation.required");
    else if (!/^\d{12}$/.test(d.cccd.trim()))
      e.cccd = t("auth.register.validation.invalidCccd");

    if (!avatarFile) e.avatar = t("auth.register.validation.avatarRequired");
    if (avatarFile && avatarFile.size > MAX_FILE_SIZE)
      e.avatar = t("auth.register.validation.avatarTooLarge");

    return e;
  }, [avatarFile, t]);

  useEffect(() => {
    setErrors(validate(form));
  }, [form, validate]);

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
    });

    const errs = validate(form);
    setErrors(errs);

    if (errs.avatar) {
      jumpAndHighlight(avatarRef, setHighlightAvatar);
    }

    if (Object.keys(errs).length) {
      toast.error(t("auth.register.errors.checkInfo"));
      return;
    }

    try {
      // 1) Upload avatar
      let avatarUrl = "";
      if (avatarFile) {
        const up = await uploadAvatar(avatarFile).unwrap();
        avatarUrl = up?.url || "";
        if (!avatarUrl) throw new Error(t("auth.register.errors.avatarUploadFailed"));
      }

      // 2) Register
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
      };

      const res = await register(payload).unwrap();

      // ✅ đăng ký xong login luôn (OTP tạm tắt)
      dispatch(setCredentials(res));
      toast.success(t("auth.register.success"));
      navigate("/");
    } catch (err) {
      const msg = err?.data?.message || err?.message || t("auth.register.errors.failed");
      const map = {
        Email: t("auth.register.errors.emailUsed"),
        "Số điện thoại": t("auth.register.errors.phoneUsed"),
        CCCD: t("auth.register.errors.cccdUsed"),
        nickname: t("auth.register.errors.nicknameUsed"),
      };
      const matched = Object.keys(map).find((k) => msg.includes(k));
      toast.error(matched ? map[matched] : msg);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <SEOHead
        title={t("auth.register.seoTitle")}
        description={t("auth.register.seoDescription")}
        path="/register"
      />
      <Paper elevation={2} sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          {t("auth.register.title")}
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
                    {t("auth.register.chooseAvatar")}
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
                            avatar: t("auth.register.validation.avatarTooLarge"),
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

            <TextField
              label={t("auth.register.nameLabel")}
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
              label={t("auth.register.nicknameLabel")}
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
              label={t("auth.register.phoneLabel")}
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
              label={t("auth.register.emailLabel")}
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
                {t("auth.register.genderLabel")}
              </InputLabel>
              <Select
                labelId="gender-lbl"
                label={t("auth.register.genderLabel")}
                name="gender"
                value={form.gender}
                onChange={onChange}
                onBlur={onBlur}
                displayEmpty
                required
              >
                {genderOptions.map((opt) => (
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
              label={t("auth.register.dobLabel")}
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
              format={language === "en" ? "MM/DD/YYYY" : "DD/MM/YYYY"}
              minDate={MIN_DOB}
              defaultCalendarMonth={MIN_DOB}
              referenceDate={MIN_DOB}
              disableFuture
              views={["year", "month", "day"]}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  placeholder: language === "en" ? "MM/DD/YYYY" : "DD/MM/YYYY",
                  onBlur: () => setTouched((t) => ({ ...t, dob: true })),
                  error: showErr("dob"),
                  helperText: showErr("dob") ? errors.dob : " ",
                },
              }}
            />

            {/* Province */}
            <FormControl fullWidth required error={showErr("province")}>
              <InputLabel id="province-lbl" shrink>
                {t("auth.register.provinceLabel")}
              </InputLabel>
              <Select
                labelId="province-lbl"
                label={t("auth.register.provinceLabel")}
                name="province"
                value={form.province}
                onChange={onChange}
                onBlur={onBlur}
                displayEmpty
                required
              >
                <MenuItem value="">
                  <em>{t("auth.register.provincePlaceholder")}</em>
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
              label={t("auth.register.cccdLabel")}
              name="cccd"
              value={form.cccd}
              onChange={onChange}
              onBlur={onBlur}
              fullWidth
              required
              placeholder={t("auth.register.cccdPlaceholder")}
              inputProps={{ inputMode: "numeric", maxLength: 12 }}
              error={showErr("cccd")}
              helperText={showErr("cccd") ? errors.cccd : " "}
            />

            {/* Password (✅ hide/show) */}
            <TextField
              label={t("auth.register.passwordLabel")}
              type={showPassword ? "text" : "password"}
              name="password"
              value={form.password}
              onChange={onChange}
              onBlur={onBlur}
              required
              fullWidth
              error={showErr("password")}
              helperText={showErr("password") ? errors.password : " "}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword((v) => !v)}
                      edge="end"
                      aria-label={t("auth.register.aria.togglePassword")}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              label={t("auth.register.confirmPasswordLabel")}
              type={showConfirmPassword ? "text" : "password"}
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
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      edge="end"
                      aria-label={t("auth.register.aria.toggleConfirmPassword")}
                    >
                      {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

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
              {isLoading || uploadingAvatar
                ? t("auth.register.processing")
                : t("auth.register.submit")}
            </Button>
          </Stack>
        </Box>

        <Typography variant="body2" align="center" sx={{ mt: 2 }}>
          {t("auth.register.hasAccount")}{" "}
          <MuiLink component={Link} to="/login" underline="hover">
            {t("auth.register.login")}
          </MuiLink>
        </Typography>
      </Paper>
    </Container>
  );
}
