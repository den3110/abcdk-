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

import dayjs from "dayjs";
import "dayjs/locale/vi";
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

const KYC_META = {
  unverified: {
    label: "Chưa xác minh",
    chipColor: "default",
    accent: "#64748b",
    Icon: PendingIcon,
    description: "Điền đủ CCCD và tải đủ hai mặt ảnh để gửi duyệt.",
  },
  pending: {
    label: "Đang chờ duyệt",
    chipColor: "warning",
    accent: "#f59e0b",
    Icon: PendingIcon,
    description: "Hồ sơ đã được gửi và đang chờ đội ngũ kiểm tra.",
  },
  verified: {
    label: "Đã xác minh",
    chipColor: "success",
    accent: "#10b981",
    Icon: VerifiedUserIcon,
    description: "CCCD đã được xác minh và hiện đã khóa chỉnh sửa.",
  },
  rejected: {
    label: "Bị từ chối",
    chipColor: "error",
    accent: "#ef4444",
    Icon: GppBadIcon,
    description: "Bạn có thể cập nhật lại thông tin và gửi ảnh mới.",
  },
};

const formatDisplayDate = (value, format = "DD/MM/YYYY") => {
  if (!value) return "Chưa cập nhật";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format(format) : "Chưa cập nhật";
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
      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mb: 0.75 }}>
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

function SectionCard({ icon, title, subtitle, action, tone = "primary", children }) {
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

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 4 },
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
              sx={{ bgcolor: theme.palette.mode === "light" ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.common.white, 0.14), mb: 2 }}
            />
            <Skeleton
              variant="text"
              width="76%"
              height={64}
              sx={{ bgcolor: theme.palette.mode === "light" ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.common.white, 0.1) }}
            />
            <Skeleton
              variant="text"
              width="88%"
              height={28}
              sx={{ bgcolor: theme.palette.mode === "light" ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.common.white, 0.1), mb: 2 }}
            />

            <Grid container spacing={2}>
              {Array.from({ length: 3 }).map((_, index) => (
                <Grid key={index} size={{ xs: 12, sm: 4 }}>
                  <Skeleton
                    variant="rounded"
                    height={110}
                    sx={{ bgcolor: theme.palette.mode === "light" ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.common.white, 0.1), borderRadius: 4 }}
                  />
                </Grid>
              ))}
            </Grid>
          </Grid>

          <Grid size={{ xs: 12, lg: 5 }}>
            <Skeleton
              variant="rounded"
              height={260}
              sx={{ bgcolor: theme.palette.mode === "light" ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.common.white, 0.1), borderRadius: 5 }}
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
            <Skeleton variant="rounded" height={8} sx={{ borderRadius: 99, mb: 3 }} />

            <Stack spacing={1.5}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} variant="rounded" height={56} sx={{ borderRadius: 3 }} />
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
              Đăng xuất
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
                <Skeleton variant="text" width="64%" height={22} sx={{ mb: 3 }} />
                <Grid container spacing={2}>
                  {Array.from({ length: index === 2 ? 2 : 4 }).map((__, fieldIndex) => (
                    <Grid key={fieldIndex} size={{ xs: 12, sm: 6 }}>
                      <Skeleton variant="rounded" height={58} sx={{ borderRadius: 3 }} />
                    </Grid>
                  ))}
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

  const cccdSectionRef = useRef(null);
  const HEADER_OFFSET = 72;

  const scrollToEl = useCallback((el) => {
    if (!el || typeof window === "undefined") return;
    const top = el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
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
  const [uploadAvatar, { isLoading: uploadingAvatar }] = useUploadRealAvatarMutation();

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
        msg: err?.data?.message || "Đăng xuất thất bại",
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

    if (!data.name.trim()) nextErrors.name = "Không được bỏ trống";
    else if (data.name.trim().length < 2) nextErrors.name = "Tối thiểu 2 ký tự";

    if (!data.nickname.trim()) nextErrors.nickname = "Không được bỏ trống";
    else if (data.nickname.trim().length < 2) {
      nextErrors.nickname = "Tối thiểu 2 ký tự";
    }

    if (!/^0\d{9}$/.test(data.phone.trim())) {
      nextErrors.phone = "Sai định dạng (10 chữ số)";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      nextErrors.email = "Email không hợp lệ";
    }

    if (data.dob) {
      const day = new Date(data.dob);
      if (Number.isNaN(day)) nextErrors.dob = "Ngày sinh không hợp lệ";
      else if (day > new Date()) nextErrors.dob = "Không được ở tương lai";
      else if (new Date(data.dob) < new Date("1940-01-01")) {
        nextErrors.dob = "Không trước 01/01/1940";
      }
    }

    if (!data.province) nextErrors.province = "Bắt buộc";

    if (data.cccd && !/^\d{12}$/.test(data.cccd.trim())) {
      nextErrors.cccd = "CCCD phải đủ 12 số";
    }

    if (changePassword) {
      if (!data.password) nextErrors.password = "Vui lòng nhập mật khẩu mới";
      else if (data.password.length < 6) {
        nextErrors.password = "Tối thiểu 6 ký tự";
      }

      if (!data.confirmPassword) {
        nextErrors.confirmPassword = "Vui lòng nhập lại mật khẩu";
      } else if (data.password !== data.confirmPassword) {
        nextErrors.confirmPassword = "Không khớp";
      }
    }

    if (!["male", "female", "unspecified", "other"].includes(data.gender)) {
      nextErrors.gender = "Giới tính không hợp lệ";
    }

    return nextErrors;
  };

  useEffect(() => setErrors(validate(form)), [form, changePassword]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = useMemo(() => {
    const changed = Object.keys(form).some(
      (key) => key !== "confirmPassword" && form[key] !== initialRef.current[key]
    );
    return changed || !!avatarFile;
  }, [form, avatarFile]);

  const isValid = useMemo(() => !Object.keys(errors).length, [errors]);

  const isCccdValid = useMemo(
    () => /^\d{12}$/.test((form.cccd || "").trim()),
    [form.cccd]
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
        msg: "Vui lòng kiểm tra lại thông tin!",
      });
      return;
    }

    if (!isDirty) {
      setSnack({
        open: true,
        type: "info",
        msg: "Bạn chưa thay đổi thông tin nào.",
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
            msg: "Ảnh không được vượt quá 10 MB.",
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

  const handleAvatarSelect = (event) => {
    const file = event.target.files?.[0];
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
    <Dialog open={logoutConfirmOpen} onClose={closeLogoutConfirm} maxWidth="xs" fullWidth>
      <Box sx={{ p: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1 }}
        >
          <Typography variant="h6" fontWeight={800}>
            Xác nhận đăng xuất
          </Typography>
          <IconButton onClick={closeLogoutConfirm} disabled={isLoggingOut}>
            <CloseIcon />
          </IconButton>
        </Stack>

        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Bạn có chắc muốn đăng xuất không?
        </Typography>

        <Stack direction="row" spacing={1.2} justifyContent="flex-end">
          <Button variant="outlined" onClick={closeLogoutConfirm} disabled={isLoggingOut}>
            Huỷ
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
            {isLoggingOut ? "Đang đăng xuất..." : "Đăng xuất"}
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

  const kycMeta = KYC_META[status] || KYC_META.unverified;
  const KycStatusIcon = kycMeta.Icon;
  const saveDisabled = !isDirty || !isValid || isLoading || uploadingAvatar;
  const hasAvatar = Boolean(form.avatar || avatarPreview);
  const pendingUploads = [frontImg, backImg].filter(Boolean).length;
  const storedCccdImages = [frontUrl, backUrl].filter(Boolean).length;
  const cccdSummary =
    status === "verified"
      ? "Đã xác minh"
      : status === "pending"
      ? "Đang chờ duyệt"
      : pendingUploads > 0
      ? `Đã chọn ${pendingUploads}/2 ảnh`
      : storedCccdImages > 0
      ? `Đã có ${storedCccdImages}/2 ảnh`
      : isCccdValid
      ? "Đã có số CCCD hợp lệ"
      : cccdTrim
      ? "Số CCCD chưa hợp lệ"
      : "Chưa có";
  const profileCode = user?._id ? String(user._id).slice(-6).toUpperCase() : "------";
  const memberSince = formatDisplayDate(user?.createdAt || user?.joinedAt);
  const genderLabel =
    GENDER_OPTIONS.find((option) => option.value === form.gender)?.label ||
    "Chưa xác định";
  const hasFullCccdImages =
    pendingUploads === 2 ||
    storedCccdImages === 2 ||
    status === "pending" ||
    status === "verified";
  const hasSubmittedKyc = status === "pending" || status === "verified";
  const completionItems = [
    { label: "Họ và tên", done: Boolean(form.name.trim()) },
    { label: "Biệt danh", done: Boolean(form.nickname.trim()) },
    { label: "Số điện thoại", done: /^0\d{9}$/.test(form.phone.trim()) },
    { label: "Email", done: Boolean(form.email.trim()) },
    { label: "Ngày sinh", done: Boolean(form.dob) },
    { label: "Tỉnh / Thành phố", done: Boolean(form.province) },
    { label: "Giới tính", done: form.gender !== "unspecified" },
    { label: "Ảnh đại diện", done: hasAvatar },
    { label: "Số CCCD hợp lệ", done: isCccdValid },
    { label: "Đủ 2 ảnh CCCD", done: hasFullCccdImages },
    { label: "Đã gửi hồ sơ KYC", done: hasSubmittedKyc },
  ];
  const completionCount = completionItems.filter((item) => item.done).length;
  const profileCompletion = Math.round(
    (completionCount / completionItems.length) * 100
  );

  const kycAlert = {
    unverified: {
      severity: "info",
      message: "Hoàn tất số CCCD và tải đủ hai mặt ảnh để bắt đầu quy trình xác minh.",
    },
    pending: {
      severity: "warning",
      message: "Yêu cầu của bạn đang được xử lý. Tạm thời chưa cần gửi lại ảnh.",
    },
    verified: {
      severity: "success",
      message: "Hồ sơ KYC đã hoàn tất. Số CCCD hiện đã khóa để đảm bảo tính nhất quán.",
    },
    rejected: {
      severity: "error",
      message: "Yêu cầu trước đó bị từ chối. Hãy cập nhật lại thông tin và ảnh rõ nét hơn.",
    },
  }[status];

  return (
    <>
      <SEOHead title="Hồ sơ cá nhân" noIndex={true} />

      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="vi">
        <Box
          sx={{
            minHeight: "100vh",
            pb: 8,
            backgroundColor: theme.palette.background.default,
          }}
        >
          <Container maxWidth="xl" sx={{ pt: { xs: 3, md: 5 } }}>
            <Box
              sx={{
                position: "relative",
                overflow: "hidden",
                borderRadius: { xs: 5, md: 7 },
                px: { xs: 2.5, md: 4 },
                py: { xs: 3, md: 4 },
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
                      HỒ SƠ CÁ NHÂN
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
                        Quản lý hồ sơ cá nhân
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{
                          maxWidth: 650,
                          mt: 1.25,
                          color: "text.secondary",
                        }}
                      >
                        Cập nhật thông tin cá nhân, bảo mật tài khoản và theo dõi trạng
                        thái xác minh tại một nơi, gọn hơn và dễ thao tác hơn.
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
                        label={isDirty ? "Có thay đổi chưa lưu" : "Hồ sơ đã đồng bộ"}
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
                          label="Mức hoàn thiện"
                          value={`${profileCompletion}%`}
                          caption={`${completionCount}/${completionItems.length} mục đã hoàn thiện`}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <HeroMetric
                          label="Trạng thái KYC"
                          value={kycMeta.label}
                          caption={kycMeta.description}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <HeroMetric
                          label="Thay đổi chờ lưu"
                          value={isDirty ? "Có" : "Không"}
                          caption={
                            isDirty
                              ? "Nhấn lưu để áp dụng cập nhật mới."
                              : "Không có chỉnh sửa nào đang treo."
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
                      <Stack direction="row" spacing={2} sx={{ minWidth: 0, flex: 1 }}>
                        <Badge
                          overlap="circular"
                          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
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
                              borderColor: alpha(theme.palette.primary.main, 0.16),
                              boxShadow: theme.palette.mode === "light" ? "0 8px 18px rgba(15, 23, 42, 0.12)" : "0 8px 18px rgba(0,0,0,0.22)",
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
                            {form.name || "Người dùng PickleTour"}
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
                            {form.email || "Chưa cập nhật email"}
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
                        {isDark ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
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
                          label: "Tỉnh thành",
                          value: form.province || "Chưa chọn",
                          icon: <PlaceRoundedIcon fontSize="small" />,
                        },
                        {
                          label: "Điện thoại",
                          value: form.phone || "Chưa cập nhật",
                          icon: <PhoneIphoneRoundedIcon fontSize="small" />,
                        },
                        {
                          label: "Mã hồ sơ",
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
                            <Stack direction="row" spacing={1.25} alignItems="center">
                              <Box sx={{ color: "primary.main", display: "grid", placeItems: "center" }}>
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
                        Đi tới KYC
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
                          Gỡ ảnh
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
                        p: { xs: 2.25, md: 2.75 },
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
                        Tình trạng tài khoản
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                        Theo dõi nhanh mức hoàn thiện và các hạng mục cần chú ý.
                      </Typography>

                      <Box sx={{ mt: 2.5 }}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          sx={{ mb: 1 }}
                        >
                          <Typography variant="body2" fontWeight={700}>
                            Hồ sơ đã hoàn thiện
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
                          {completionCount}/{completionItems.length} mục đang hoàn thiện
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1.5 }}>
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
                                color: item.done ? "success.main" : "text.secondary",
                                "& .MuiChip-label": { fontWeight: 700 },
                              }}
                            />
                          ))}
                        </Stack>
                      </Box>

                      <Grid container spacing={1.5} sx={{ mt: 0.5, mb: 3 }}>
                        {[
                          {
                            label: "Ảnh đại diện",
                            value: hasAvatar ? "Đã có" : "Chưa có",
                          },
                          {
                            label: "Bảo mật",
                            value: changePassword ? "Sẽ đổi mật khẩu" : "Giữ nguyên",
                          },
                          {
                            label: "Xác minh",
                            value: kycMeta.label,
                          },
                          {
                            label: "Dữ liệu CCCD",
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
                              <Typography variant="caption" color="text.secondary">
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
                          label="Họ và tên"
                          value={form.name || "Chưa cập nhật"}
                        />
                        <SummaryRow
                          icon={<MailOutlineRoundedIcon fontSize="small" />}
                          label="Email đăng nhập"
                          value={form.email || "Chưa cập nhật"}
                        />
                        <SummaryRow
                          icon={<PhoneIphoneRoundedIcon fontSize="small" />}
                          label="Số điện thoại"
                          value={form.phone || "Chưa cập nhật"}
                        />
                        <SummaryRow
                          icon={<PlaceRoundedIcon fontSize="small" />}
                          label="Khu vực"
                          value={form.province || "Chưa chọn tỉnh thành"}
                        />
                      </Stack>

                      <Divider sx={{ my: 3 }} />

                      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2.25 }}>
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
                          label={isDirty ? "Cần lưu thay đổi" : "Không có thay đổi"}
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
                        sx={{ borderRadius: 3, py: 1.3 }}
                      >
                        Đăng xuất
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
                        Lưu ý nhanh
                      </Typography>
                      <Stack spacing={1.5} sx={{ mt: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          Ảnh đại diện nên nhẹ hơn 10MB để tải lên nhanh và sắc nét hơn.
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Email hiện chỉ hiển thị để tham chiếu và chưa chỉnh trực tiếp ở màn này.
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Sau khi KYC được duyệt, số CCCD sẽ bị khóa để tránh sai lệch dữ liệu.
                        </Typography>
                      </Stack>
                    </Paper>
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, lg: 8 }}>
                  <Stack spacing={3}>
                    <SectionCard
                      tone="primary"
                      icon={<PersonRoundedIcon />}
                      title="Thông tin cơ bản"
                      subtitle="Cập nhật những trường nhận diện chính của bạn trên hệ thống."
                      action={
                        <Chip
                          size="small"
                          label={isDirty ? "Chưa lưu" : "Đã đồng bộ"}
                          color={isDirty ? "warning" : "success"}
                          variant="outlined"
                        />
                      }
                    >
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
                            inputProps={{ inputMode: "numeric", maxLength: 10 }}
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
                            helperText={
                              showErr("email")
                                ? errors.email
                                : "Email hiện dùng làm thông tin đăng nhập"
                            }
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
                              {GENDER_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                  {option.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                          <DatePicker
                            label="Ngày sinh"
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
                            format="DD/MM/YYYY"
                            minDate={MIN_DOB}
                            disableFuture
                            slotProps={{
                              textField: {
                                fullWidth: true,
                                onBlur: () =>
                                  setTouched((prev) => ({ ...prev, dob: true })),
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
                            label: "Ngày tham gia",
                            value: memberSince,
                          },
                          {
                            label: "Giới tính đang chọn",
                            value: genderLabel,
                          },
                          {
                            label: "Mã hồ sơ",
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
                              <Typography variant="caption" color="text.secondary">
                                {item.label}
                              </Typography>
                              <Typography variant="body2" fontWeight={800} sx={{ mt: 0.5 }}>
                                {item.value}
                              </Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>
                      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2.5 }}>
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
                            ? "Đang xử lý..."
                            : "Lưu thông tin cơ bản"}
                        </Button>
                      </Stack>
                    </SectionCard>

                    <SectionCard
                      tone="info"
                      icon={<ShieldRoundedIcon />}
                      title="Bảo mật tài khoản"
                      subtitle="Chỉ bật đổi mật khẩu khi bạn thực sự muốn cập nhật thông tin đăng nhập."
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
                              <Typography fontWeight={700}>Đổi mật khẩu</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {changePassword
                                  ? "Mật khẩu mới sẽ được áp dụng sau khi bạn lưu hồ sơ."
                                  : "Bật tùy chọn này khi cần thay đổi mật khẩu hiện tại."}
                              </Typography>
                            </Box>
                          }
                        />

                        {changePassword && (
                          <Grid container spacing={2} sx={{ mt: 1.5 }}>
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
                      {changePassword && (
                        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2.5 }}>
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
                              ? "Đang xử lý..."
                              : "Lưu"}
                          </Button>
                        </Stack>
                      )}
                    </SectionCard>

                    <SectionCard
                      tone="warning"
                      icon={<FingerprintRoundedIcon />}
                      title="Xác minh danh tính"
                      subtitle="Hoàn tất KYC để tăng độ tin cậy và khóa thông tin định danh chính xác."
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
                        <Alert severity={kycAlert.severity} sx={{ mb: 2.5, borderRadius: 3.5 }}>
                          {kycAlert.message}
                        </Alert>

                        <Grid container spacing={2} sx={{ mb: 2 }}>
                          <Grid size={{ xs: 12, md: 7 }}>
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
                                  : "Thông tin này chỉ dùng cho quy trình xác minh"
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
                              <Typography variant="caption" color="text.secondary">
                                Tình trạng hiện tại
                              </Typography>
                              <Typography variant="body1" fontWeight={800} sx={{ mt: 0.5 }}>
                                {kycMeta.label}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
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
                              <Alert severity="info" sx={{ mb: 2, borderRadius: 3 }}>
                                Vui lòng nhập <strong>số CCCD</strong> ở trên trước khi tải
                                ảnh lên.
                              </Alert>
                            )}

                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <CccdDropzone
                                  label="Mặt trước"
                                  file={frontImg}
                                  onFile={setFrontImg}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <CccdDropzone
                                  label="Mặt sau"
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
                                    frontImg ? "Đã chọn mặt trước" : "Chưa chọn mặt trước"
                                  }
                                  color={frontImg ? "success" : "default"}
                                  variant="outlined"
                                />
                                <Chip
                                  size="small"
                                  label={backImg ? "Đã chọn mặt sau" : "Chưa chọn mặt sau"}
                                  color={backImg ? "success" : "default"}
                                  variant="outlined"
                                />
                              </Stack>

                              <Button
                                variant="contained"
                                disabled={!frontImg || !backImg || upLoad || !isCccdValid}
                                startIcon={
                                  upLoad ? (
                                    <CircularProgress size={18} color="inherit" />
                                  ) : (
                                    <FingerprintRoundedIcon />
                                  )
                                }
                                onClick={sendCccd}
                                sx={{ borderRadius: 99, px: 3, py: 1.2, fontWeight: 700 }}
                              >
                                {upLoad ? "Đang gửi yêu cầu..." : "Gửi yêu cầu xác minh"}
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
                                  transition: "transform 0.2s ease, border-color 0.2s ease",
                                  "&:hover": {
                                    transform: "translateY(-2px)",
                                    borderColor: "primary.main",
                                  },
                                }}
                                onClick={() => openCccdZoom(frontUrl)}
                              >
                                <img
                                  src={frontUrl}
                                  alt="Mặt trước"
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
                                  Mặt trước CCCD
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
                                  transition: "transform 0.2s ease, border-color 0.2s ease",
                                  "&:hover": {
                                    transform: "translateY(-2px)",
                                    borderColor: "primary.main",
                                  },
                                }}
                                onClick={() => openCccdZoom(backUrl)}
                              >
                                <img
                                  src={backUrl}
                                  alt="Mặt sau"
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
                                  Mặt sau CCCD
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
                            Lưu thay đổi
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                            {saveDisabled
                              ? isDirty
                                ? "Một vài trường vẫn chưa hợp lệ. Kiểm tra lại trước khi lưu."
                                : "Bạn chưa có thay đổi nào cần lưu."
                              : "Mọi cập nhật sẽ được áp dụng ngay vào hồ sơ cá nhân của bạn."}
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
                              ? "Đang xử lý..."
                              : "Lưu thay đổi"}
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
            autoHideDuration={3000}
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

          <Dialog open={avatarZoomOpen} onClose={() => setAvatarZoomOpen(false)} maxWidth="md">
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

          <Dialog open={cccdZoomOpen} onClose={() => setCccdZoomOpen(false)} maxWidth="md">
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
