/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import { alpha, useTheme } from "@mui/material/styles";

import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import DeleteIcon from "@mui/icons-material/Delete";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FingerprintRoundedIcon from "@mui/icons-material/FingerprintRounded";
import GppBadIcon from "@mui/icons-material/GppBad";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import LogoutIcon from "@mui/icons-material/Logout";
import MailOutlineRoundedIcon from "@mui/icons-material/MailOutlineRounded";
import PendingIcon from "@mui/icons-material/Pending";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import PhoneIphoneRoundedIcon from "@mui/icons-material/PhoneIphoneRounded";
import PlaceRoundedIcon from "@mui/icons-material/PlaceRounded";
import SaveIcon from "@mui/icons-material/Save";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";

import {
  useGetProfileQuery,
  useUpdateUserMutation,
  useLogoutMutation,
} from "../slices/usersApiSlice";
import {
  useUploadCccdMutation,
  useUploadRealAvatarMutation,
} from "../slices/uploadApiSlice";
import { logout } from "../slices/authSlice";
import CccdDropzone from "../components/CccdDropzone";
import { useThemeMode } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { getDateInputFormat } from "../i18n/format";
import {
  getGenderLabel,
  getGenderOptions,
  getKycMeta,
  getProvincePlaceholder,
} from "../i18n/uiOptions";

import dayjs from "dayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import SEOHead from "../components/SEOHead";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIN_DOB = dayjs("1940-01-01");
const PLACEHOLDER_AVATAR = "https://via.placeholder.com/150?text=No+Image";
const PLACEHOLDER_CCCD = "https://via.placeholder.com/400x250?text=Image+Error";

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

const KYC_STATUS_ICONS = {
  unverified: PendingIcon,
  pending: PendingIcon,
  verified: VerifiedUserIcon,
  rejected: GppBadIcon,
};

const formatDisplayDate = (value, language, fallback) => {
  const format = getDateInputFormat(language);
  if (!value) return fallback;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(format) : fallback;
};

function HeroMetric({ label, value, caption }) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        p: 2.25,
        height: "100%",
        borderRadius: 4,
        border: "1px solid",
        borderColor: "divider",
        bgcolor:
          theme.palette.mode === "light"
            ? alpha(theme.palette.primary.main, 0.04)
            : alpha(theme.palette.primary.main, 0.08),
      }}
    >
      <Typography
        variant="caption"
        sx={{ display: "block", color: "text.secondary", mb: 0.75 }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color: "text.primary",
          fontWeight: 800,
          lineHeight: 1.15,
          fontSize: { xs: "1.3rem", md: "1.7rem" },
        }}
      >
        {value}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.75 }}>
        {caption}
      </Typography>
    </Box>
  );
}

function SectionCard({
  icon,
  title,
  subtitle,
  action,
  tone = "primary",
  children,
}) {
  const theme = useTheme();
  const palette = theme.palette[tone] || theme.palette.primary;

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 5,
        border: "1px solid",
        borderColor: alpha(palette.main, 0.16),
        boxShadow:
          theme.palette.mode === "light"
            ? "0 24px 48px rgba(15, 23, 42, 0.06)"
            : "0 24px 48px rgba(0, 0, 0, 0.24)",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: { xs: 2.25, md: 3 },
          py: { xs: 2, md: 2.5 },
          borderBottom: "1px solid",
          borderColor: alpha(palette.main, 0.12),
          bgcolor:
            theme.palette.mode === "light"
              ? alpha(palette.main, 0.05)
              : alpha(palette.main, 0.1),
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 3.5,
                display: "grid",
                placeItems: "center",
                color: palette.main,
                bgcolor: alpha(palette.main, 0.12),
              }}
            >
              {icon}
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={800}>
                {title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            </Box>
          </Stack>
          {action}
        </Stack>
      </Box>

      <Box
        sx={{
          px: { xs: 2.25, md: 3 },
          py: { xs: 2.25, md: 3 },
          "& .MuiOutlinedInput-root": { borderRadius: 3 },
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

function SummaryRow({ icon, label, value }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 3,
          display: "grid",
          placeItems: "center",
          bgcolor: "action.hover",
          color: "primary.main",
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" fontWeight={700} noWrap title={value}>
          {value}
        </Typography>
      </Box>
    </Stack>
  );
}

function ProfileSkeleton({ onLogout }) {
  const theme = useTheme();
  const { t } = useLanguage();

  return (
    <Container
      maxWidth="xl"
      sx={{ py: { xs: 2, md: 5 }, px: { xs: 1.5, sm: 3, md: 4 } }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 1.5, md: 4 },
          mb: 3,
          borderRadius: 6,
          overflow: "hidden",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Grid container spacing={3} alignItems="stretch">
          <Grid size={{ xs: 12, lg: 7 }}>
            <Skeleton
              variant="rounded"
              width={180}
              height={34}
              sx={{
                bgcolor:
                  theme.palette.mode === "light"
                    ? alpha(theme.palette.primary.main, 0.12)
                    : alpha(theme.palette.common.white, 0.14),
                mb: 2,
              }}
            />
            <Skeleton
              variant="text"
              width="76%"
              height={64}
              sx={{
                bgcolor:
                  theme.palette.mode === "light"
                    ? alpha(theme.palette.primary.main, 0.08)
                    : alpha(theme.palette.common.white, 0.1),
              }}
            />
            <Skeleton
              variant="text"
              width="88%"
              height={28}
              sx={{
                bgcolor:
                  theme.palette.mode === "light"
                    ? alpha(theme.palette.primary.main, 0.08)
                    : alpha(theme.palette.common.white, 0.1),
                mb: 2,
              }}
            />

            <Grid container spacing={2}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Grid key={index} size={{ xs: 12, sm: 4 }}>
                  <Skeleton
                    variant="rounded"
                    height={110}
                    sx={{
                      bgcolor:
                        theme.palette.mode === "light"
                          ? alpha(theme.palette.primary.main, 0.08)
                          : alpha(theme.palette.common.white, 0.1),
                      borderRadius: 4,
                    }}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>

          <Grid size={{ xs: 12, lg: 5 }}>
            <Skeleton
              variant="rounded"
              height={260}
              sx={{
                bgcolor:
                  theme.palette.mode === "light"
                    ? alpha(theme.palette.primary.main, 0.08)
                    : alpha(theme.palette.common.white, 0.1),
                borderRadius: 5,
              }}
            />
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              height: "100%",
              borderRadius: 5,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Skeleton variant="text" width={180} height={40} />
            <Skeleton variant="text" width="72%" height={24} sx={{ mb: 2 }} />
            <Skeleton
              variant="rounded"
              height={8}
              sx={{ borderRadius: 99, mb: 3 }}
            />

            <Stack spacing={1.5}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton
                  key={index}
                  variant="rounded"
                  height={56}
                  sx={{ borderRadius: 3 }}
                />
              ))}
            </Stack>

            <Divider sx={{ my: 3 }} />

            <Button
              variant="outlined"
              color="error"
              fullWidth
              startIcon={<LogoutIcon />}
              onClick={onLogout}
              sx={{ borderRadius: 3, py: 1.25 }}
            >
              {t("profile.hero.logout")}
            </Button>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={3}>
            {Array.from({ length: 3 }).map((_, index) => (
              <Paper
                key={index}
                elevation={0}
                sx={{
                  p: 3,
                  borderRadius: 5,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Skeleton variant="text" width={220} height={36} />
                <Skeleton
                  variant="text"
                  width="64%"
                  height={22}
                  sx={{ mb: 3 }}
                />
                <Grid container spacing={2}>
                  {Array.from({ length: index === 2 ? 2 : 4 }).map(
                    (__, fieldIndex) => (
                      <Grid key={fieldIndex} size={{ xs: 12, sm: 6 }}>
                        <Skeleton
                          variant="rounded"
                          height={58}
                          sx={{ borderRadius: 3 }}
                        />
                      </Grid>
                    ),
                  )}
                </Grid>
              </Paper>
            ))}
          </Stack>
        </Grid>
      </Grid>
    </Container>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark, toggleTheme } = useThemeMode();
  const { language, t } = useLanguage();
  const genderOptions = useMemo(() => getGenderOptions(t), [t]);
  const kycMetaMap = useMemo(() => getKycMeta(t), [t]);
  const provincePlaceholder = useMemo(() => getProvincePlaceholder(t), [t]);

  const cccdSectionRef = useRef(null);
  const HEADER_OFFSET = 72;

  const scrollToEl = useCallback((el) => {
    if (!el || typeof window === "undefined") return;
    const top =
      el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
    window.scrollTo({ top, behavior: "smooth" });
    el.style.outline = "2px solid #0284c7";
    el.style.borderRadius = "18px";
    setTimeout(() => {
      el.style.outline = "none";
    }, 1500);
  }, []);

  const { data: user, isLoading: fetching, refetch } = useGetProfileQuery();
  const [updateProfile, { isLoading }] = useUpdateUserMutation();
  const [logoutApiCall, { isLoading: isLoggingOut }] = useLogoutMutation();
  const [uploadCccd, { isLoading: upLoad }] = useUploadCccdMutation();
  const [uploadAvatar, { isLoading: uploadingAvatar }] =
    useUploadRealAvatarMutation();

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
    [avatarPreview, form.avatar],
  );

  const [cccdZoomOpen, setCccdZoomOpen] = useState(false);
  const [cccdZoomSrc, setCccdZoomSrc] = useState("");

  const openCccdZoom = (src) => {
    if (!src) return;
    setCccdZoomSrc(src);
    setCccdZoomOpen(true);
  };

  const [changePassword, setChangePassword] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const requestLogout = () => setLogoutConfirmOpen(true);

  const closeLogoutConfirm = () => {
    if (isLoggingOut) return;
    setLogoutConfirmOpen(false);
  };

  const confirmLogout = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      setLogoutConfirmOpen(false);
      navigate("/login");
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || t("profile.logout.failed"),
      });
      setLogoutConfirmOpen(false);
    }
  };

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

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  const validate = (data) => {
    const nextErrors = {};

    if (!data.name.trim()) nextErrors.name = t("profile.validation.empty");
    else if (data.name.trim().length < 2)
      nextErrors.name = t("profile.validation.min2");

    if (!data.nickname.trim())
      nextErrors.nickname = t("profile.validation.empty");
    else if (data.nickname.trim().length < 2) {
      nextErrors.nickname = t("profile.validation.min2");
    }

    if (!/^0\d{9}$/.test(data.phone.trim())) {
      nextErrors.phone = t("profile.validation.invalidPhone");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      nextErrors.email = t("profile.validation.invalidEmail");
    }

    if (data.dob) {
      const day = new Date(data.dob);
      if (Number.isNaN(day))
        nextErrors.dob = t("profile.validation.invalidDob");
      else if (day > new Date())
        nextErrors.dob = t("profile.validation.futureDob");
      else if (new Date(data.dob) < new Date("1940-01-01")) {
        nextErrors.dob = t("profile.validation.minDob");
      }
    }

    if (!data.province)
      nextErrors.province = t("profile.validation.provinceRequired");

    if (data.cccd && !/^\d{12}$/.test(data.cccd.trim())) {
      nextErrors.cccd = t("profile.validation.invalidCccd");
    }

    if (changePassword) {
      if (!data.password)
        nextErrors.password = t("profile.validation.passwordRequired");
      else if (data.password.length < 6) {
        nextErrors.password = t("profile.validation.passwordMin");
      }

      if (!data.confirmPassword) {
        nextErrors.confirmPassword = t(
          "profile.validation.confirmPasswordRequired",
        );
      } else if (data.password !== data.confirmPassword) {
        nextErrors.confirmPassword = t("profile.validation.passwordMismatch");
      }
    }

    if (!["male", "female", "unspecified", "other"].includes(data.gender)) {
      nextErrors.gender = t("profile.validation.invalidGender");
    }

    return nextErrors;
  };

  useEffect(() => setErrors(validate(form)), [form, changePassword]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = useMemo(() => {
    const changed = Object.keys(form).some(
      (key) =>
        key !== "confirmPassword" && form[key] !== initialRef.current[key],
    );
    return changed || !!avatarFile;
  }, [form, avatarFile]);

  const isValid = useMemo(() => !Object.keys(errors).length, [errors]);

  const isCccdValid = useMemo(
    () => /^\d{12}$/.test((form.cccd || "").trim()),
    [form.cccd],
  );

  const showErr = (field) => touched[field] && !!errors[field];

  const onChange = (event) =>
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));

  const onBlur = (event) =>
    setTouched((prev) => ({ ...prev, [event.target.name]: true }));

  const diff = () => {
    const output = { _id: user?._id };
    for (const key in form) {
      if (key === "confirmPassword") continue;
      if (form[key] !== initialRef.current[key]) output[key] = form[key];
    }
    return output;
  };

  const submit = async (event) => {
    event.preventDefault();
    setTouched(Object.fromEntries(Object.keys(form).map((key) => [key, true])));
    const nextErrors = validate(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      setSnack({
        open: true,
        type: "error",
        msg: t("profile.feedback.reviewInfo"),
      });
      return;
    }

    if (!isDirty) {
      setSnack({
        open: true,
        type: "info",
        msg: t("profile.feedback.noChanges"),
      });
      return;
    }

    try {
      let finalAvatarUrl = uploadedAvatarUrl || form.avatar || "";
      if (avatarFile && !uploadedAvatarUrl) {
        if (avatarFile.size > MAX_FILE_SIZE) {
          setSnack({
            open: true,
            type: "error",
            msg: t("profile.feedback.avatarTooLarge"),
          });
          return;
        }
        const uploaded = await uploadAvatar(avatarFile).unwrap();
        finalAvatarUrl = uploaded.url;
        setUploadedAvatarUrl(uploaded.url);
        setForm((prev) => ({ ...prev, avatar: uploaded.url }));
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
        msg: t("profile.feedback.updateSuccess"),
      });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg:
          err?.data?.message ||
          err?.error ||
          t("profile.feedback.updateFailed"),
      });
    }
  };

  const sendCccd = async () => {
    if (!frontImg || !backImg || upLoad) return;
    if (!isCccdValid) {
      setSnack({
        open: true,
        type: "error",
        msg: t("profile.feedback.cccdInvalidBeforeUpload"),
      });
      return;
    }

    const formData = new FormData();
    formData.append("front", frontImg);
    formData.append("back", backImg);

    try {
      await uploadCccd(formData).unwrap();
      setFrontImg(null);
      setBackImg(null);
      await refetch();
      setSnack({
        open: true,
        type: "success",
        msg: t("profile.feedback.cccdUploadSuccess"),
      });
    } catch (err) {
      setSnack({
        open: true,
        type: "error",
        msg: err?.data?.message || t("profile.feedback.cccdUploadFailed"),
      });
    }
  };

  const handleAvatarSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setSnack({
        open: true,
        type: "error",
        msg: t("profile.feedback.avatarTooLarge"),
      });
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setUploadedAvatarUrl("");
  };

  const handleRemoveAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview("");
    setUploadedAvatarUrl("");
    setForm((prev) => ({ ...prev, avatar: "" }));
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
    const parsed = dayjs(form.dob, "YYYY-MM-DD", true);
    return parsed.isValid() ? parsed : null;
  }, [form.dob]);

  const handleImgError = (event) => {
    event.target.src = PLACEHOLDER_AVATAR;
  };

  const handleCccdError = (event) => {
    event.target.src = PLACEHOLDER_CCCD;
  };

  const logoutConfirmDialog = (
    <Dialog
      open={logoutConfirmOpen}
      onClose={closeLogoutConfirm}
      maxWidth="xs"
      fullWidth
    >
      <Box sx={{ p: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Typography variant="h6" fontWeight={800}>
            {t("profile.logout.title")}
          </Typography>
          <IconButton onClick={closeLogoutConfirm} disabled={isLoggingOut}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("profile.logout.body")}
        </Typography>

        <Stack direction="row" spacing={1.2} justifyContent="flex-end">
          <Button
            variant="outlined"
            onClick={closeLogoutConfirm}
            disabled={isLoggingOut}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmLogout}
            disabled={isLoggingOut}
            startIcon={
              isLoggingOut ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <LogoutIcon />
              )
            }
          >
            {isLoggingOut
              ? t("profile.logout.pending")
              : t("profile.hero.logout")}
          </Button>
        </Stack>
      </Box>
    </Dialog>
  );

  if (fetching || !user) {
    return (
      <>
        <ProfileSkeleton onLogout={requestLogout} />
        {logoutConfirmDialog}
      </>
    );
  }

  const kycMeta = kycMetaMap[status] || kycMetaMap.unverified;
  const KycStatusIcon = KYC_STATUS_ICONS[status] || PendingIcon;
  const saveDisabled = !isDirty || !isValid || isLoading || uploadingAvatar;
  const hasAvatar = Boolean(form.avatar || avatarPreview);
  const pendingUploads = [frontImg, backImg].filter(Boolean).length;
  const storedCccdImages = [frontUrl, backUrl].filter(Boolean).length;
  const cccdSummary =
    status === "verified"
      ? t("profile.kyc.summary.verified")
      : status === "pending"
        ? t("profile.kyc.summary.pending")
        : pendingUploads > 0
          ? t("profile.kyc.summary.selectedImages", { count: pendingUploads })
          : storedCccdImages > 0
            ? t("profile.kyc.summary.storedImages", { count: storedCccdImages })
            : isCccdValid
              ? t("profile.kyc.summary.validNumber")
              : cccdTrim
                ? t("profile.kyc.summary.invalidNumber")
                : t("profile.kyc.summary.empty");
  const profileCode = user?._id
    ? String(user._id).slice(-6).toUpperCase()
    : "------";
  const memberSince =
    formatDisplayDate(
      user?.createdAt || user?.joinedAt,
      language,
      t("common.states.notUpdated"),
    ) || t("common.states.notUpdated");
  const genderLabel = getGenderLabel(t, form.gender);
  const hasFullCccdImages =
    pendingUploads === 2 ||
    storedCccdImages === 2 ||
    status === "pending" ||
    status === "verified";
  const hasSubmittedKyc = status === "pending" || status === "verified";
  const completionItems = [
    {
      label: t("profile.completionItems.name"),
      done: Boolean(form.name.trim()),
    },
    {
      label: t("profile.completionItems.nickname"),
      done: Boolean(form.nickname.trim()),
    },
    {
      label: t("profile.completionItems.phone"),
      done: /^0\d{9}$/.test(form.phone.trim()),
    },
    {
      label: t("profile.completionItems.email"),
      done: Boolean(form.email.trim()),
    },
    { label: t("profile.completionItems.dob"), done: Boolean(form.dob) },
    {
      label: t("profile.completionItems.province"),
      done: Boolean(form.province),
    },
    {
      label: t("profile.completionItems.gender"),
      done: form.gender !== "unspecified",
    },
    { label: t("profile.completionItems.avatar"), done: hasAvatar },
    { label: t("profile.completionItems.cccd"), done: isCccdValid },
    { label: t("profile.completionItems.cccdImages"), done: hasFullCccdImages },
    { label: t("profile.completionItems.kycSubmitted"), done: hasSubmittedKyc },
  ];
  const completionCount = completionItems.filter((item) => item.done).length;
  const profileCompletion = Math.round(
    (completionCount / completionItems.length) * 100,
  );

  const kycAlert = {
    unverified: {
      severity: "info",
      message: t("profile.kyc.alerts.unverified"),
    },
    pending: {
      severity: "warning",
      message: t("profile.kyc.alerts.pending"),
    },
    verified: {
      severity: "success",
      message: t("profile.kyc.alerts.verified"),
    },
    rejected: {
      severity: "error",
      message: t("profile.kyc.alerts.rejected"),
    },
  }[status];

  return (
    <>
      <SEOHead title={t("profile.seoTitle")} noIndex />

      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={language}>
        <Box
          sx={{
            minHeight: "100vh",
            pb: 8,
            backgroundColor: theme.palette.background.default,
          }}
        >
          <Container
            maxWidth="xl"
            sx={{ pt: { xs: 1.5, md: 5 }, px: { xs: 1.5, sm: 3, md: 4 } }}
          >
            <Box
              sx={{
                position: "relative",
                overflow: "hidden",
                borderRadius: { xs: 4, md: 7 },
                px: { xs: 1.5, md: 4 },
                py: { xs: 2.5, md: 4 },
                mb: 3,
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider",
                boxShadow:
                  theme.palette.mode === "light"
                    ? "0 18px 40px rgba(15, 23, 42, 0.08)"
                    : "0 18px 40px rgba(0, 0, 0, 0.28)",
              }}
            >
              <Grid
                container
                spacing={3}
                alignItems="stretch"
                sx={{ position: "relative", zIndex: 1 }}
              >
                <Grid size={{ xs: 12, lg: 7 }}>
                  <Stack spacing={2.25}>
                    <Typography
                      variant="overline"
                      sx={{
                        display: "block",
                        color: "text.secondary",
                        fontWeight: 700,
                        letterSpacing: "0.16em",
                      }}
                    >
                      {t("profile.hero.title").toUpperCase()}
                    </Typography>

                    <Box>
                      <Typography
                        sx={{
                          fontWeight: 900,
                          lineHeight: 1.05,
                          fontSize: { xs: "2rem", md: "3rem" },
                          letterSpacing: "-0.02em",
                          maxWidth: 760,
                        }}
                      >
                        {t("profile.hero.title")}
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{
                          maxWidth: 650,
                          mt: 1.25,
                          color: "text.secondary",
                        }}
                      >
                        {t("profile.hero.subtitle")}
                      </Typography>
                    </Box>

                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      <Chip
                        icon={<KycStatusIcon fontSize="small" />}
                        label={`KYC: ${kycMeta.label}`}
                        sx={{
                          color: "text.primary",
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          border: "1px solid",
                          borderColor: alpha(theme.palette.primary.main, 0.14),
                        }}
                      />
                      <Chip
                        icon={
                          isDirty ? (
                            <EditRoundedIcon fontSize="small" />
                          ) : (
                            <VerifiedUserIcon fontSize="small" />
                          )
                        }
                        label={
                          isDirty
                            ? t("profile.summary.unsaved")
                            : t("profile.summary.synced")
                        }
                        sx={{
                          color: "text.primary",
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          border: "1px solid",
                          borderColor: alpha(theme.palette.primary.main, 0.14),
                        }}
                      />
                    </Stack>

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <HeroMetric
                          label={t("profile.summary.completion")}
                          value={`${profileCompletion}%`}
                          caption={`${completionCount}/${completionItems.length} ${t("profile.summary.completion").toLowerCase()}`}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <HeroMetric
                          label={t("profile.summary.kycStatus")}
                          value={kycMeta.label}
                          caption={kycMeta.description}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <HeroMetric
                          label={t("profile.summary.pendingChanges")}
                          value={
                            isDirty
                              ? t("common.states.on")
                              : t("common.states.off")
                          }
                          caption={
                            isDirty
                              ? t("profile.savePanel.ready")
                              : t("profile.summary.noChanges")
                          }
                        />
                      </Grid>
                    </Grid>
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, lg: 5 }}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: { xs: 2.25, md: 2.5 },
                      height: "100%",
                      borderRadius: 5,
                      bgcolor:
                        theme.palette.mode === "light"
                          ? alpha(theme.palette.primary.main, 0.04)
                          : alpha(theme.palette.primary.main, 0.08),
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="flex-start"
                      spacing={2}
                    >
                      <Stack
                        direction="row"
                        spacing={2}
                        sx={{ minWidth: 0, flex: 1 }}
                      >
                        <Badge
                          overlap="circular"
                          anchorOrigin={{
                            vertical: "bottom",
                            horizontal: "right",
                          }}
                          badgeContent={
                            <IconButton
                              component="label"
                              disabled={uploadingAvatar || isLoading}
                              sx={{
                                bgcolor: "primary.main",
                                color: "primary.contrastText",
                                width: 38,
                                height: 38,
                                border: `3px solid ${theme.palette.background.paper}`,
                                boxShadow: "none",
                                "&:hover": { bgcolor: "primary.dark" },
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
                                onChange={handleAvatarSelect}
                              />
                            </IconButton>
                          }
                        >
                          <Avatar
                            src={avatarSrc}
                            imgProps={{ onError: handleImgError }}
                            sx={{
                              width: { xs: 92, md: 108 },
                              height: { xs: 92, md: 108 },
                              cursor: "zoom-in",
                              border: "4px solid",
                              borderColor: alpha(
                                theme.palette.primary.main,
                                0.16,
                              ),
                              boxShadow:
                                theme.palette.mode === "light"
                                  ? "0 8px 18px rgba(15, 23, 42, 0.12)"
                                  : "0 8px 18px rgba(0,0,0,0.22)",
                            }}
                            onClick={() => setAvatarZoomOpen(true)}
                          />
                        </Badge>

                        <Box sx={{ minWidth: 0, pt: 0.5 }}>
                          <Typography
                            sx={{
                              color: "text.primary",
                              fontWeight: 800,
                              lineHeight: 1.1,
                              fontSize: { xs: "1.3rem", md: "1.55rem" },
                            }}
                          >
                            {form.name || "PickleTour"}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: "text.secondary", mt: 0.5 }}
                          >
                            @{form.nickname || "nickname"}
                          </Typography>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ color: "text.secondary", mt: 0.75 }}
                          >
                            {form.email || t("common.states.notUpdated")}
                          </Typography>
                        </Box>
                      </Stack>

                      <IconButton
                        onClick={toggleTheme}
                        sx={{
                          color: "text.primary",
                          border: "1px solid",
                          borderColor: "divider",
                          bgcolor: "background.paper",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        {isDark ? (
                          <LightModeRoundedIcon />
                        ) : (
                          <DarkModeRoundedIcon />
                        )}
                      </IconButton>
                    </Stack>

                    <Grid container spacing={1.5} sx={{ mt: 2.25 }}>
                      {[
                        {
                          label: "Tham gia",
                          value: memberSince,
                          icon: <CalendarMonthRoundedIcon fontSize="small" />,
                        },
                        {
                          label: t("publicProfile.labels.province"),
                          value: form.province || provincePlaceholder,
                          icon: <PlaceRoundedIcon fontSize="small" />,
                        },
                        {
                          label: t("profile.fields.phone"),
                          value: form.phone || t("common.states.notUpdated"),
                          icon: <PhoneIphoneRoundedIcon fontSize="small" />,
                        },
                        {
                          label: t("profile.summary.profileCode"),
                          value: profileCode,
                          icon: <PersonRoundedIcon fontSize="small" />,
                        },
                      ].map((item) => (
                        <Grid key={item.label} size={{ xs: 12, sm: 6 }}>
                          <Box
                            sx={{
                              p: 1.5,
                              borderRadius: 3,
                              border: "1px solid",
                              borderColor: "divider",
                              bgcolor: "action.hover",
                            }}
                          >
                            <Stack
                              direction="row"
                              spacing={1.25}
                              alignItems="center"
                            >
                              <Box
                                sx={{
                                  color: "primary.main",
                                  display: "grid",
                                  placeItems: "center",
                                }}
                              >
                                {item.icon}
                              </Box>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="caption"
                                  sx={{ color: "text.secondary" }}
                                >
                                  {item.label}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  fontWeight={700}
                                  noWrap
                                  sx={{ color: "text.primary" }}
                                  title={item.value}
                                >
                                  {item.value}
                                </Typography>
                              </Box>
                            </Stack>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>

                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.25}
                      sx={{ mt: 2.25 }}
                    >
                      <Button
                        variant="contained"
                        onClick={() => scrollToEl(cccdSectionRef.current)}
                        sx={{
                          flex: 1,
                          borderRadius: 99,
                          py: 1.2,
                          fontWeight: 700,
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          "&:hover": { bgcolor: "primary.dark" },
                        }}
                      >
                        {t("profile.sections.kycTitle")}
                      </Button>

                      {hasAvatar && (
                        <Button
                          variant="outlined"
                          color="inherit"
                          onClick={handleRemoveAvatar}
                          startIcon={<DeleteIcon />}
                          sx={{
                            borderRadius: 99,
                            py: 1.2,
                            color: "text.primary",
                            borderColor: "divider",
                            "&:hover": {
                              borderColor: "text.secondary",
                              bgcolor: "action.hover",
                            },
                          }}
                        >
                          {t("common.actions.delete")}
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              </Grid>
            </Box>

            <Box component="form" onSubmit={submit} noValidate>
              <Grid container spacing={3} alignItems="flex-start">
                <Grid size={{ xs: 12, lg: 4 }}>
                  <Stack
                    spacing={3}
                    sx={{
                      position: { lg: "sticky" },
                      top: { lg: 96 },
                    }}
                  >
                    <Paper
                      elevation={0}
                      sx={{
                        p: { xs: 1.5, md: 2.75 },
                        borderRadius: 5,
                        border: "1px solid",
                        borderColor: alpha(theme.palette.primary.main, 0.14),
                        boxShadow:
                          theme.palette.mode === "light"
                            ? "0 22px 44px rgba(15, 23, 42, 0.06)"
                            : "0 22px 44px rgba(0, 0, 0, 0.22)",
                      }}
                    >
                      <Typography variant="h6" fontWeight={800}>
                        {t("publicProfile.labels.accountStatus")}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.75 }}
                      >
                        {t("profile.hero.subtitle")}
                      </Typography>

                      <Box sx={{ mt: 2.5 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          sx={{ mb: 1 }}
                        >
                          <Typography variant="body2" fontWeight={700}>
                            {t("profile.summary.completion")}
                          </Typography>
                          <Typography variant="body2" fontWeight={800}>
                            {profileCompletion}%
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={profileCompletion}
                          sx={{
                            height: 10,
                            borderRadius: 99,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            "& .MuiLinearProgress-bar": {
                              borderRadius: 99,
                              backgroundColor: theme.palette.primary.main,
                            },
                          }}
                        />
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 1 }}
                        >
                          {completionCount}/{completionItems.length}{" "}
                          {t("profile.summary.completion").toLowerCase()}
                        </Typography>
                        <Stack
                          direction="row"
                          flexWrap="wrap"
                          gap={1}
                          sx={{ mt: 1.5 }}
                        >
                          {completionItems.map((item) => (
                            <Chip
                              key={item.label}
                              size="small"
                              label={item.label}
                              variant="outlined"
                              sx={{
                                borderRadius: 999,
                                borderColor: item.done
                                  ? alpha(theme.palette.success.main, 0.24)
                                  : "divider",
                                bgcolor: item.done
                                  ? alpha(theme.palette.success.main, 0.08)
                                  : "transparent",
                                color: item.done
                                  ? "success.main"
                                  : "text.secondary",
                                "& .MuiChip-label": { fontWeight: 700 },
                              }}
                            />
                          ))}
                        </Stack>
                      </Box>

                      <Grid container spacing={1.5} sx={{ mt: 0.5, mb: 3 }}>
                        {[
                          {
                            label: t("profile.completionItems.avatar"),
                            value: hasAvatar
                              ? t("common.states.on")
                              : t("common.states.off"),
                          },
                          {
                            label: t("profile.sections.securityTitle"),
                            value: changePassword
                              ? t("profile.actions.enablePassword")
                              : t("common.actions.default"),
                          },
                          {
                            label: t("profile.sections.kycTitle"),
                            value: kycMeta.label,
                          },
                          {
                            label: t("profile.fields.cccd"),
                            value: cccdSummary,
                          },
                        ].map((item) => (
                          <Grid key={item.label} size={{ xs: 6 }}>
                            <Box
                              sx={{
                                p: 1.5,
                                borderRadius: 3.5,
                                bgcolor: "action.hover",
                                border: "1px solid",
                                borderColor: "divider",
                                minHeight: 90,
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {item.label}
                              </Typography>
                              <Typography
                                variant="body2"
                                fontWeight={800}
                                sx={{ mt: 0.75 }}
                              >
                                {item.value}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>

                      <Stack spacing={1.5}>
                        <SummaryRow
                          icon={<PersonRoundedIcon fontSize="small" />}
                          label={t("profile.fields.name")}
                          value={form.name || t("common.states.notUpdated")}
                        />
                        <SummaryRow
                          icon={<MailOutlineRoundedIcon fontSize="small" />}
                          label={t("profile.fields.email")}
                          value={form.email || t("common.states.notUpdated")}
                        />
                        <SummaryRow
                          icon={<PhoneIphoneRoundedIcon fontSize="small" />}
                          label={t("profile.fields.phone")}
                          value={form.phone || t("common.states.notUpdated")}
                        />
                        <SummaryRow
                          icon={<PlaceRoundedIcon fontSize="small" />}
                          label={t("profile.fields.province")}
                          value={form.province || provincePlaceholder}
                        />
                      </Stack>

                      <Divider sx={{ my: 3 }} />

                      <Stack
                        direction="row"
                        flexWrap="wrap"
                        gap={1}
                        sx={{ mb: 2.25 }}
                      >
                        <Chip
                          size="small"
                          icon={<KycStatusIcon fontSize="small" />}
                          label={kycMeta.label}
                          color={kycMeta.chipColor}
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          icon={
                            isDirty ? (
                              <EditRoundedIcon fontSize="small" />
                            ) : (
                              <VerifiedUserIcon fontSize="small" />
                            )
                          }
                          label={
                            isDirty
                              ? t("profile.summary.needSave")
                              : t("profile.summary.noChanges")
                          }
                          color={isDirty ? "warning" : "success"}
                          variant="outlined"
                        />
                      </Stack>

                      <Button
                        variant="outlined"
                        color="error"
                        fullWidth
                        startIcon={<LogoutIcon />}
                        onClick={requestLogout}
                        sx={{
                          display: { xs: "none", lg: "flex" },
                          borderRadius: 3,
                          py: 1.3,
                        }}
                      >
                        {t("profile.hero.logout")}
                      </Button>
                    </Paper>

                    <Paper
                      elevation={0}
                      sx={{
                        p: { xs: 2.25, md: 2.5 },
                        borderRadius: 5,
                        border: "1px solid",
                        borderColor: alpha(theme.palette.info.main, 0.16),
                        bgcolor:
                          theme.palette.mode === "light"
                            ? alpha(theme.palette.info.main, 0.05)
                            : alpha(theme.palette.info.main, 0.08),
                      }}
                    >
                      <Typography variant="h6" fontWeight={800}>
                        {t("profile.notes.title")}
                      </Typography>
                      <Stack spacing={1.5} sx={{ mt: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          {t("profile.notes.avatar")}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t("profile.notes.email")}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t("profile.notes.kyc")}
                        </Typography>
                      </Stack>
                    </Paper>
                  </Stack>
                  <Button
                    variant="outlined"
                    color="error"
                    fullWidth
                    startIcon={<LogoutIcon />}
                    onClick={requestLogout}
                    sx={{
                      display: { xs: "flex", lg: "none" },
                      mt: 3,
                      borderRadius: 3,
                      borderWidth: 2,
                      py: 1.25,
                      fontWeight: 700,
                    }}
                  >
                    {t("profile.hero.logout")}
                  </Button>
                </Grid>

                <Grid size={{ xs: 12, lg: 8 }}>
                  <Stack spacing={3}>
                    <SectionCard
                      tone="primary"
                      icon={<PersonRoundedIcon />}
                      title={t("profile.sections.basicTitle")}
                      subtitle={t("profile.sections.basicSubtitle")}
                      action={
                        <Chip
                          size="small"
                          label={
                            isDirty
                              ? t("profile.summary.unsaved")
                              : t("profile.summary.synced")
                          }
                          color={isDirty ? "warning" : "success"}
                          variant="outlined"
                        />
                      }
                    >
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            label={t("profile.fields.name")}
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
                            label={t("profile.fields.nickname")}
                            name="nickname"
                            value={form.nickname}
                            onChange={onChange}
                            onBlur={onBlur}
                            required
                            fullWidth
                            error={showErr("nickname")}
                            helperText={
                              showErr("nickname") ? errors.nickname : ""
                            }
                          />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            label={t("profile.fields.phone")}
                            name="phone"
                            value={form.phone}
                            onChange={onChange}
                            onBlur={onBlur}
                            required
                            fullWidth
                            error={showErr("phone")}
                            helperText={showErr("phone") ? errors.phone : ""}
                            inputProps={{ inputMode: "numeric", maxLength: 10 }}
                          />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField
                            label={t("profile.fields.email")}
                            name="email"
                            value={form.email}
                            onChange={onChange}
                            onBlur={onBlur}
                            required
                            fullWidth
                            disabled
                            error={showErr("email")}
                            helperText={
                              showErr("email")
                                ? errors.email
                                : t("profile.fields.emailHelper")
                            }
                          />
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                          <FormControl fullWidth error={showErr("gender")}>
                            <InputLabel id="gender-lbl">
                              {t("profile.fields.gender")}
                            </InputLabel>
                            <Select
                              labelId="gender-lbl"
                              label={t("profile.fields.gender")}
                              name="gender"
                              value={form.gender}
                              onChange={onChange}
                              onBlur={onBlur}
                            >
                              {genderOptions.map((option) => (
                                <MenuItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                          <DatePicker
                            label={t("profile.fields.dob")}
                            value={dobValue}
                            onChange={(newValue) => {
                              setTouched((prev) => ({ ...prev, dob: true }));
                              setForm((prev) => ({
                                ...prev,
                                dob:
                                  newValue && newValue.isValid()
                                    ? newValue.format("YYYY-MM-DD")
                                    : "",
                              }));
                            }}
                            format={getDateInputFormat(language)}
                            minDate={MIN_DOB}
                            disableFuture
                            slotProps={{
                              textField: {
                                fullWidth: true,
                                onBlur: () =>
                                  setTouched((prev) => ({
                                    ...prev,
                                    dob: true,
                                  })),
                                error: showErr("dob"),
                                helperText: showErr("dob") ? errors.dob : "",
                              },
                            }}
                          />
                        </Grid>

                        <Grid size={{ xs: 12 }}>
                          <FormControl
                            fullWidth
                            required
                            error={showErr("province")}
                          >
                            <InputLabel id="province-lbl">
                              {t("profile.fields.province")}
                            </InputLabel>
                            <Select
                              labelId="province-lbl"
                              label={t("profile.fields.province")}
                              name="province"
                              value={form.province}
                              onChange={onChange}
                              onBlur={onBlur}
                            >
                              <MenuItem value="">
                                <em>{provincePlaceholder}</em>
                              </MenuItem>
                              {PROVINCES.map((province) => (
                                <MenuItem key={province} value={province}>
                                  {province}
                                </MenuItem>
                              ))}
                            </Select>

                            {showErr("province") && (
                              <Typography
                                variant="caption"
                                color="error"
                                sx={{ mx: 2, mt: 0.75 }}
                              >
                                {errors.province}
                              </Typography>
                            )}
                          </FormControl>
                        </Grid>
                      </Grid>

                      <Grid container spacing={1.5} sx={{ mt: 1.5 }}>
                        {[
                          {
                            label: t("profile.summary.memberSince"),
                            value: memberSince,
                          },
                          {
                            label: t("profile.summary.selectedGender"),
                            value: genderLabel,
                          },
                          {
                            label: t("profile.summary.profileCode"),
                            value: profileCode,
                          },
                        ].map((item) => (
                          <Grid key={item.label} size={{ xs: 12, sm: 4 }}>
                            <Box
                              sx={{
                                p: 1.5,
                                borderRadius: 3.5,
                                bgcolor: "action.hover",
                                border: "1px solid",
                                borderColor: "divider",
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {item.label}
                              </Typography>
                              <Typography
                                variant="body2"
                                fontWeight={800}
                                sx={{ mt: 0.5 }}
                              >
                                {item.value}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                      <Stack
                        direction="row"
                        justifyContent="flex-end"
                        sx={{ mt: 2.5 }}
                      >
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={saveDisabled}
                          startIcon={
                            isLoading || uploadingAvatar ? (
                              <CircularProgress size={18} color="inherit" />
                            ) : (
                              <SaveIcon />
                            )
                          }
                          sx={{
                            borderRadius: 99,
                            px: 2.75,
                            py: 1.15,
                            fontWeight: 700,
                            boxShadow: "none",
                          }}
                        >
                          {isLoading || uploadingAvatar
                            ? t("profile.actions.saving")
                            : t("profile.actions.saveBasic")}
                        </Button>
                      </Stack>
                    </SectionCard>

                    <SectionCard
                      tone="info"
                      icon={<ShieldRoundedIcon />}
                      title={t("profile.sections.securityTitle")}
                      subtitle={t("profile.sections.securitySubtitle")}
                    >
                      <Box
                        sx={{
                          p: { xs: 2, md: 2.25 },
                          borderRadius: 4,
                          border: "1px solid",
                          borderColor: alpha(theme.palette.info.main, 0.18),
                          bgcolor:
                            theme.palette.mode === "light"
                              ? alpha(theme.palette.info.main, 0.04)
                              : alpha(theme.palette.info.main, 0.08),
                        }}
                      >
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={changePassword}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setChangePassword(checked);
                                if (!checked) {
                                  setForm((prev) => ({
                                    ...prev,
                                    password: "",
                                    confirmPassword: "",
                                  }));
                                  setTouched((prev) => ({
                                    ...prev,
                                    password: false,
                                    confirmPassword: false,
                                  }));
                                }
                              }}
                              color="primary"
                            />
                          }
                          label={
                            <Box>
                              <Typography fontWeight={700}>
                                {t("profile.actions.enablePassword")}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {changePassword
                                  ? t("profile.password.enabledHint")
                                  : t("profile.password.disabledHint")}
                              </Typography>
                            </Box>
                          }
                        />

                        {changePassword && (
                          <Grid container spacing={2} sx={{ mt: 1.5 }}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label={t("profile.fields.password")}
                                type="password"
                                name="password"
                                value={form.password}
                                onChange={onChange}
                                onBlur={onBlur}
                                fullWidth
                                error={showErr("password")}
                                helperText={
                                  showErr("password") ? errors.password : ""
                                }
                              />
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label={t("profile.fields.confirmPassword")}
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
                      {changePassword && (
                        <Stack
                          direction="row"
                          justifyContent="flex-end"
                          sx={{ mt: 2.5 }}
                        >
                          <Button
                            type="submit"
                            variant="contained"
                            disabled={saveDisabled}
                            startIcon={
                              isLoading || uploadingAvatar ? (
                                <CircularProgress size={18} color="inherit" />
                              ) : (
                                <SaveIcon />
                              )
                            }
                            sx={{
                              borderRadius: 99,
                              px: 2.75,
                              py: 1.15,
                              fontWeight: 700,
                              boxShadow: "none",
                            }}
                          >
                            {isLoading || uploadingAvatar
                              ? t("profile.actions.saving")
                              : t("profile.actions.save")}
                          </Button>
                        </Stack>
                      )}
                    </SectionCard>

                    <SectionCard
                      tone="warning"
                      icon={<FingerprintRoundedIcon />}
                      title={t("profile.sections.kycTitle")}
                      subtitle={t("profile.sections.kycSubtitle")}
                      action={
                        <Chip
                          size="small"
                          icon={<KycStatusIcon fontSize="small" />}
                          label={kycMeta.label}
                          color={kycMeta.chipColor}
                          variant="outlined"
                        />
                      }
                    >
                      <Box
                        ref={cccdSectionRef}
                        id="cccd"
                        sx={{ scrollMarginTop: `${HEADER_OFFSET + 16}px` }}
                      >
                        <Alert
                          severity={kycAlert.severity}
                          sx={{ mb: 2.5, borderRadius: 3.5 }}
                        >
                          {kycAlert.message}
                        </Alert>

                        <Grid container spacing={2} sx={{ mb: 2 }}>
                          <Grid size={{ xs: 12, md: 7 }}>
                            <TextField
                              label={t("profile.fields.cccd")}
                              name="cccd"
                              value={form.cccd}
                              onChange={onChange}
                              onBlur={onBlur}
                              fullWidth
                              inputProps={{
                                inputMode: "numeric",
                                maxLength: 12,
                              }}
                              disabled={isKycLocked}
                              error={showErr("cccd")}
                              helperText={
                                isKycLocked
                                  ? t("profile.kyc.helpers.locked")
                                  : showErr("cccd")
                                    ? errors.cccd
                                    : isCccdEmpty
                                      ? t("profile.kyc.helpers.activateUpload")
                                      : t("profile.kyc.helpers.processOnly")
                              }
                            />
                          </Grid>

                          <Grid size={{ xs: 12, md: 5 }}>
                            <Box
                              sx={{
                                height: "100%",
                                minHeight: 72,
                                px: 2,
                                py: 1.5,
                                borderRadius: 3.5,
                                border: "1px solid",
                                borderColor: alpha(kycMeta.accent, 0.24),
                                bgcolor: alpha(kycMeta.accent, 0.08),
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                              }}
                            >
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {t("profile.fields.currentState")}
                              </Typography>
                              <Typography
                                variant="body1"
                                fontWeight={800}
                                sx={{ mt: 0.5 }}
                              >
                                {kycMeta.label}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.5 }}
                              >
                                {kycMeta.description}
                              </Typography>
                            </Box>
                          </Grid>
                        </Grid>

                        {showUpload ? (
                          <Box
                            sx={{
                              p: { xs: 2, md: 2.5 },
                              borderRadius: 4,
                              border: "1px solid",
                              borderColor: "divider",
                              bgcolor: "action.hover",
                            }}
                          >
                            {isCccdEmpty && (
                              <Alert
                                severity="info"
                                sx={{ mb: 2, borderRadius: 3 }}
                              >
                                {t("profile.kyc.helpers.enterBeforeUpload")}
                              </Alert>
                            )}

                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <CccdDropzone
                                  label={t("profile.kyc.images.front")}
                                  file={frontImg}
                                  onFile={setFrontImg}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <CccdDropzone
                                  label={t("profile.kyc.images.back")}
                                  file={backImg}
                                  onFile={setBackImg}
                                />
                              </Grid>
                            </Grid>

                            <Stack
                              direction={{ xs: "column", md: "row" }}
                              spacing={1.5}
                              justifyContent="space-between"
                              alignItems={{ xs: "stretch", md: "center" }}
                              sx={{ mt: 2 }}
                            >
                              <Stack direction="row" flexWrap="wrap" gap={1}>
                                <Chip
                                  size="small"
                                  label={
                                    frontImg
                                      ? t("profile.kyc.images.frontSelected")
                                      : t("profile.kyc.images.frontMissing")
                                  }
                                  color={frontImg ? "success" : "default"}
                                  variant="outlined"
                                />
                                <Chip
                                  size="small"
                                  label={
                                    backImg
                                      ? t("profile.kyc.images.backSelected")
                                      : t("profile.kyc.images.backMissing")
                                  }
                                  color={backImg ? "success" : "default"}
                                  variant="outlined"
                                />
                              </Stack>

                              <Button
                                variant="contained"
                                disabled={
                                  !frontImg ||
                                  !backImg ||
                                  upLoad ||
                                  !isCccdValid
                                }
                                startIcon={
                                  upLoad ? (
                                    <CircularProgress
                                      size={18}
                                      color="inherit"
                                    />
                                  ) : (
                                    <FingerprintRoundedIcon />
                                  )
                                }
                                onClick={sendCccd}
                                sx={{
                                  borderRadius: 99,
                                  px: 3,
                                  py: 1.2,
                                  fontWeight: 700,
                                }}
                              >
                                {upLoad
                                  ? t("profile.actions.submittingKyc")
                                  : t("profile.actions.submitKyc")}
                              </Button>
                            </Stack>
                          </Box>
                        ) : (
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 1.5,
                                  borderRadius: 4,
                                  cursor: "zoom-in",
                                  bgcolor: "action.hover",
                                  transition:
                                    "transform 0.2s ease, border-color 0.2s ease",
                                  "&:hover": {
                                    transform: "translateY(-2px)",
                                    borderColor: "primary.main",
                                  },
                                }}
                                onClick={() => openCccdZoom(frontUrl)}
                              >
                                <img
                                  src={frontUrl}
                                  alt={t("profile.kyc.images.front")}
                                  style={{
                                    width: "100%",
                                    height: 180,
                                    objectFit: "contain",
                                    display: "block",
                                  }}
                                  onError={handleCccdError}
                                />
                                <Typography
                                  align="center"
                                  variant="body2"
                                  fontWeight={700}
                                  sx={{ mt: 1 }}
                                >
                                  {t("profile.kyc.images.frontTitle")}
                                </Typography>
                              </Paper>
                            </Grid>

                            <Grid size={{ xs: 12, md: 6 }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  p: 1.5,
                                  borderRadius: 4,
                                  cursor: "zoom-in",
                                  bgcolor: "action.hover",
                                  transition:
                                    "transform 0.2s ease, border-color 0.2s ease",
                                  "&:hover": {
                                    transform: "translateY(-2px)",
                                    borderColor: "primary.main",
                                  },
                                }}
                                onClick={() => openCccdZoom(backUrl)}
                              >
                                <img
                                  src={backUrl}
                                  alt={t("profile.kyc.images.back")}
                                  style={{
                                    width: "100%",
                                    height: 180,
                                    objectFit: "contain",
                                    display: "block",
                                  }}
                                  onError={handleCccdError}
                                />
                                <Typography
                                  align="center"
                                  variant="body2"
                                  fontWeight={700}
                                  sx={{ mt: 1 }}
                                >
                                  {t("profile.kyc.images.backTitle")}
                                </Typography>
                              </Paper>
                            </Grid>
                          </Grid>
                        )}
                      </Box>
                    </SectionCard>

                    <Paper
                      elevation={0}
                      sx={{
                        p: { xs: 2.25, md: 2.5 },
                        borderRadius: 5,
                        border: "1px solid",
                        borderColor: saveDisabled
                          ? "divider"
                          : alpha(theme.palette.primary.main, 0.22),
                        bgcolor:
                          theme.palette.mode === "light"
                            ? alpha(theme.palette.primary.main, 0.04)
                            : alpha(theme.palette.primary.main, 0.08),
                      }}
                    >
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={2}
                        justifyContent="space-between"
                        alignItems={{ xs: "stretch", md: "center" }}
                      >
                        <Box sx={{ maxWidth: 520 }}>
                          <Typography variant="h6" fontWeight={800}>
                            {t("profile.sections.saveTitle")}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 0.75 }}
                          >
                            {saveDisabled
                              ? isDirty
                                ? t("profile.savePanel.invalid")
                                : t("profile.savePanel.unchanged")
                              : t("profile.savePanel.ready")}
                          </Typography>
                        </Box>

                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1.25}
                          sx={{ width: { xs: "100%", md: "auto" } }}
                        >
                          <Button
                            type="submit"
                            variant="contained"
                            disabled={saveDisabled}
                            startIcon={
                              isLoading || uploadingAvatar ? (
                                <CircularProgress size={18} color="inherit" />
                              ) : (
                                <SaveIcon />
                              )
                            }
                            sx={{
                              borderRadius: 99,
                              px: 3,
                              py: 1.2,
                              fontWeight: 800,
                              boxShadow: "0 14px 30px rgba(13, 110, 253, 0.24)",
                            }}
                          >
                            {isLoading || uploadingAvatar
                              ? t("profile.actions.saving")
                              : t("profile.actions.saveChanges")}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  </Stack>
                </Grid>
              </Grid>
            </Box>
          </Container>

          <Snackbar
            open={snack.open}
            autoHideDuration={4000}
            onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          >
            <Alert
              severity={snack.type}
              variant="filled"
              onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
              sx={{ width: "100%", boxShadow: 6 }}
            >
              {snack.msg}
            </Alert>
          </Snackbar>

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
        </Box>
      </LocalizationProvider>

      {logoutConfirmDialog}
    </>
  );
}
