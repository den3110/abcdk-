// src/screens/RegisterScreen.jsx
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import PlaceholderAvatar from "../components/PlaceholderAvatar";
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
  Avatar,
  Link,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Paper,
  Stack,
  Alert,
  IconButton,
  InputAdornment,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useDispatch } from "react-redux";
import { useRegisterMutation } from "../slices/usersApiSlice";
import { useUploadRealAvatarMutation } from "../slices/uploadApiSlice";
import { setCredentials } from "../slices/authSlice";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import LogoAnimationMorph from "../components/LogoAnimationMorph.jsx";
import CapWidget from "../components/CapWidget.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { CAP_ENABLED } from "../utils/cap.js";
import { addBusinessBreadcrumb } from "../utils/sentry";

/* Icons */
import {
  ArrowOutwardRounded,
  CalendarMonthRounded,
  LeaderboardRounded,
  LockRounded,
  PlayCircleRounded,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";

/* MUI X Date Pickers */
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";

/* ---------- Config ---------- */
const WEB_LOGO_PATH = "/icon-192.png";
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

/* ---------- Showcase Visual (shared with login) ---------- */
function ShowcaseVisual({ kind, accent, compact = false }) {
  if (kind === "live") {
    return (
      <Stack spacing={compact ? 0.8 : 1.1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box sx={{ px: compact ? 0.7 : 1, py: compact ? 0.28 : 0.4, borderRadius: 99, bgcolor: alpha(accent, 0.18), color: accent, fontSize: compact ? 9 : 11, fontWeight: 800, letterSpacing: "0.08em" }}>LIVE</Box>
          <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>Court A</Typography>
        </Stack>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between">
          <Box>
            <Typography sx={{ color: "#ffffff", fontSize: compact ? 20 : 28, fontWeight: 800, lineHeight: 1 }}>11</Typography>
            <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>Team A</Typography>
          </Box>
          <Typography sx={{ color: alpha("#ffffff", 0.28), fontSize: compact ? 16 : 20, fontWeight: 700 }}>:</Typography>
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ color: "#ffffff", fontSize: compact ? 20 : 28, fontWeight: 800, lineHeight: 1 }}>08</Typography>
            <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>Team B</Typography>
          </Box>
        </Stack>
        <Box sx={{ height: compact ? 5 : 6, borderRadius: 99, bgcolor: alpha("#ffffff", 0.08), overflow: "hidden" }}>
          <Box sx={{ width: "68%", height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${accent} 0%, ${alpha(accent, 0.5)} 100%)` }} />
        </Box>
      </Stack>
    );
  }
  if (kind === "ranking") {
    return (
      <Stack spacing={compact ? 0.75 : 1}>
        {[1, 2, 3].map((rank, index) => (
          <Stack key={rank} direction="row" spacing={compact ? 0.8 : 1.1} alignItems="center">
            <Box sx={{ width: compact ? 18 : 24, height: compact ? 18 : 24, borderRadius: 99, display: "grid", placeItems: "center", bgcolor: index === 0 ? accent : alpha("#ffffff", 0.08), color: index === 0 ? "#04110b" : "#ffffff", fontSize: compact ? 9 : 11, fontWeight: 800 }}>{rank}</Box>
            <Box sx={{ flex: 1, height: compact ? 6 : 8, borderRadius: 99, bgcolor: alpha("#ffffff", 0.08), overflow: "hidden" }}>
              <Box sx={{ width: `${86 - index * 18}%`, height: "100%", borderRadius: 99, background: index === 0 ? `linear-gradient(90deg, ${accent} 0%, ${alpha(accent, 0.56)} 100%)` : alpha("#ffffff", 0.26) }} />
            </Box>
          </Stack>
        ))}
      </Stack>
    );
  }
  return (
    <Stack spacing={compact ? 0.75 : 1}>
      {[0, 1, 2].map((row) => (
        <Stack key={row} direction="row" spacing={compact ? 0.75 : 1} alignItems="center">
          <Box sx={{ width: (compact ? 30 : 44) - row * (compact ? 4 : 6), height: compact ? 6 : 8, borderRadius: 99, bgcolor: row === 0 ? accent : alpha("#ffffff", 0.14) }} />
          <Box sx={{ flex: 1, height: 1, bgcolor: alpha("#ffffff", 0.12) }} />
          <Box sx={{ width: (compact ? 20 : 30) + row * (compact ? 9 : 12), height: compact ? 6 : 8, borderRadius: 99, bgcolor: alpha("#ffffff", 0.1) }} />
        </Stack>
      ))}
      <Stack direction="row" spacing={1}>
        <Box sx={{ flex: 1, height: compact ? 6 : 8, borderRadius: 99, bgcolor: alpha("#ffffff", 0.08) }} />
        <Box sx={{ width: compact ? 44 : 64, height: compact ? 6 : 8, borderRadius: 99, bgcolor: alpha(accent, 0.82) }} />
      </Stack>
    </Stack>
  );
}

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isCompactMobile = useMediaQuery("(max-width:480px)");
  const isDark = theme.palette.mode === "dark";
  const { t, language } = useLanguage();

  const [register, { isLoading }] = useRegisterMutation();
  const [uploadAvatar, { isLoading: uploadingAvatar }] =
    useUploadRealAvatarMutation();

  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const avatarRef = useRef(null);
  const [highlightAvatar, setHighlightAvatar] = useState(false);
  const [activeShowcase, setActiveShowcase] = useState(0);

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
    [t],
  );

  const showcaseItems = useMemo(
    () => [
      { icon: CalendarMonthRounded, label: t("auth.login.chips.schedule"), title: t("auth.login.highlights.tournaments.title"), body: t("auth.login.highlights.tournaments.body"), accent: "#dbff55", kind: "schedule" },
      { icon: PlayCircleRounded, label: t("auth.login.chips.live"), title: t("auth.login.highlights.live.title"), body: t("auth.login.highlights.live.body"), accent: "#7f68ff", kind: "live" },
      { icon: LeaderboardRounded, label: t("auth.login.chips.community"), title: t("auth.login.highlights.ranking.title"), body: t("auth.login.highlights.ranking.body"), accent: "#abd6ff", kind: "ranking" },
    ],
    [t],
  );

  useEffect(() => {
    if (showcaseItems.length < 2) return undefined;
    const timer = setInterval(() => {
      setActiveShowcase((prev) => (prev + 1) % showcaseItems.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [showcaseItems.length]);

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

  const validate = useCallback(
    (d) => {
      const e = {};
      if (!d.name.trim()) e.name = t("auth.register.validation.empty");
      else if (d.name.trim().length < 2) e.name = t("auth.register.validation.minChars", { count: 2 });
      if (!d.nickname.trim()) e.nickname = t("auth.register.validation.empty");
      else if (d.nickname.trim().length < 2) e.nickname = t("auth.register.validation.minChars", { count: 2 });
      if (!/^0\d{9}$/.test(d.phone.trim())) e.phone = t("auth.register.validation.invalidPhone");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = t("auth.register.validation.invalidEmail");
      if (!d.password) e.password = t("auth.register.validation.required");
      else if (d.password.length < 6) e.password = t("auth.register.validation.minChars", { count: 6 });
      if (d.password !== d.confirmPassword) e.confirmPassword = t("auth.register.validation.passwordMismatch");
      if (!d.dob) e.dob = t("auth.register.validation.required");
      else {
        const day = new Date(d.dob);
        if (Number.isNaN(day)) e.dob = t("auth.register.validation.invalidDob");
        else if (day > new Date()) e.dob = t("auth.register.validation.futureDob");
        else if (new Date(d.dob) < new Date("1940-01-01")) e.dob = t("auth.register.validation.minDob");
      }
      if (!d.province) e.province = t("auth.register.validation.required");
      if (!["male", "female", "unspecified", "other"].includes(d.gender)) e.gender = t("auth.register.validation.invalidGender");
      if (!d.cccd.trim()) e.cccd = t("auth.register.validation.required");
      else if (!/^\d{12}$/.test(d.cccd.trim())) e.cccd = t("auth.register.validation.invalidCccd");
      if (!avatarFile) e.avatar = t("auth.register.validation.avatarRequired");
      if (avatarFile && avatarFile.size > MAX_FILE_SIZE) e.avatar = t("auth.register.validation.avatarTooLarge");
      return e;
    },
    [avatarFile, t],
  );

  useEffect(() => { setErrors(validate(form)); }, [form, validate]);
  useEffect(() => { if (!errors.avatar) setHighlightAvatar(false); }, [errors.avatar]);

  const jumpAndHighlight = (ref, setHighlight) => {
    ref?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(true);
    setTimeout(() => setHighlight(false), 1200);
  };

  const submitHandler = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const capToken = String(formData.get("cap-token") || "").trim();
    setTouched({ name: true, nickname: true, phone: true, dob: true, email: true, password: true, confirmPassword: true, cccd: true, province: true, gender: true, avatar: true });
    const errs = validate(form);
    setErrors(errs);
    if (errs.avatar) jumpAndHighlight(avatarRef, setHighlightAvatar);
    if (!agreedTerms) { errs.terms = true; }
    if (Object.keys(errs).length) { toast.error(t("auth.register.errors.checkInfo")); return; }
    if (CAP_ENABLED && !capToken) {
      toast.error(
        t(
          "auth.cap.requiredToast",
          {},
          language === "vi"
            ? "Vui lòng hoàn thành xác minh CAPTCHA."
            : "Please complete the CAPTCHA.",
        ),
      );
      return;
    }

    addBusinessBreadcrumb("auth.register.submit", { province: form.province, gender: form.gender, hasAvatar: Boolean(avatarFile) });

    try {
      let avatarUrl = "";
      if (avatarFile) {
        const up = await uploadAvatar(avatarFile).unwrap();
        avatarUrl = up?.url || "";
        if (!avatarUrl) throw new Error(t("auth.register.errors.avatarUploadFailed"));
      }
      const payload = { name: form.name.trim(), nickname: form.nickname.trim(), phone: form.phone.trim(), dob: form.dob, email: form.email.trim(), password: form.password, cccd: form.cccd.trim(), province: form.province, gender: form.gender, avatar: avatarUrl, capToken };
      const res = await register(payload).unwrap();
      dispatch(setCredentials(res));
      toast.success(t("auth.register.success"));
      navigate("/");
    } catch (err) {
      const msg = err?.data?.message || err?.message || t("auth.register.errors.failed");
      const map = { Email: t("auth.register.errors.emailUsed"), "Số điện thoại": t("auth.register.errors.phoneUsed"), CCCD: t("auth.register.errors.cccdUsed"), nickname: t("auth.register.errors.nicknameUsed") };
      const matched = Object.keys(map).find((k) => msg.includes(k));
      toast.error(matched ? map[matched] : msg);
    }
  };

  /* ---- Styling tokens (same as login) ---- */
  const shellBackground = isDark ? alpha("#0b1419", 0.94) : "#fbfbfa";
  const formTextPrimary = isDark ? "#f2f8fb" : "#0c1116";
  const formTextSecondary = isDark ? alpha("#d5e4ec", 0.72) : alpha("#24323d", 0.68);
  const fieldBackground = isDark ? alpha("#111b22", 0.96) : "#ffffff";
  const fieldBorder = alpha(isDark ? "#b6ebff" : "#111827", isDark ? 0.14 : 0.1);

  const activeCard = showcaseItems[activeShowcase];
  const topCard = showcaseItems[(activeShowcase + 1) % showcaseItems.length];
  const bottomCard = showcaseItems[(activeShowcase + 2) % showcaseItems.length];
  const ActiveIcon = activeCard.icon;

  /* ---- Shared field sx ---- */
  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 3.5,
      backgroundColor: fieldBackground,
      minHeight: { xs: 50, md: 54 },
      "& fieldset": { borderColor: fieldBorder },
      "&:hover fieldset": { borderColor: alpha("#091118", 0.28) },
      "&.Mui-focused fieldset": { borderColor: "#0b1115", boxShadow: `0 0 0 4px ${alpha("#0b1115", 0.08)}` },
    },
    "& .MuiInputLabel-root.Mui-focused": { color: formTextPrimary },
  };

  return (
    <Box sx={{ position: "fixed", inset: 0, overflow: "hidden", background: isDark ? "#081017" : "#ffffff" }}>
      <SEOHead title={t("auth.register.seoTitle")} description={t("auth.register.seoDescription")} path="/register" />

      <Box component="main" sx={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "stretch" }}>
        <Paper
          elevation={0}
          sx={{
            width: "100%",
            height: "100%",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            overflow: "hidden",
            borderRadius: 0,
            background: shellBackground,
            border: 0,
            boxShadow: "none",
          }}
        >
          {/* ---- Top bar ---- */}
          <Box
            sx={{
              position: "relative",
              zIndex: 2,
              height: { xs: 48, md: 50 },
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "49% 51%" },
              alignItems: "center",
              borderBottom: { xs: `1px solid ${alpha(isDark ? "#d8eef7" : "#101820", 0.08)}`, md: 0 },
            }}
          >
            <Box sx={{ display: { xs: "none", md: "block" } }} />
            <Box sx={{ px: { xs: 2, sm: 2.5, md: 3 }, display: "flex", justifyContent: "space-between", alignItems: "center", minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, transform: { xs: "scale(0.86)", md: "none" }, transformOrigin: "left center" }}>
                <LogoAnimationMorph isMobile={false} showBackButton={false} />
              </Box>
              <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center">
                <Typography variant="body2" sx={{ display: { xs: "none", md: "block" }, color: formTextSecondary, whiteSpace: "nowrap" }}>
                  {t("auth.register.hasAccount")}
                </Typography>
                <Link component={RouterLink} to="/login" underline="hover" sx={{ color: formTextPrimary, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {t("auth.register.login")}
                </Link>
              </Stack>
            </Box>
          </Box>

          {/* ---- Content area ---- */}
          <Box
            sx={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "49% 51%" },
              gridTemplateRows: "1fr",
              mt: { xs: 0, md: "-50px" },
              height: { xs: "100%", md: "calc(100% + 50px)" },
              minHeight: 0,
            }}
          >
            {/* ---- Left showcase panel ---- */}
            <Box
              sx={{
                display: { xs: "none", md: "grid" },
                position: "relative",
                overflow: "hidden",
                gridTemplateRows: "auto minmax(0, 1fr) auto",
                minHeight: 0,
                height: "100%",
                background: "linear-gradient(180deg, #062e21 0%, #04271c 48%, #032117 100%)",
                color: "#f7fffb",
              }}
            >
              <Box aria-hidden="true" sx={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 10% 12%, ${alpha("#d9ff58", 0.1)} 0, transparent 20%), radial-gradient(circle at 86% 20%, ${alpha("#7f68ff", 0.18)} 0, transparent 18%), radial-gradient(circle at 72% 78%, ${alpha("#91d2ff", 0.16)} 0, transparent 20%)`, pointerEvents: "none" }} />

              <Stack spacing={{ xs: 2, md: 2.75 }} sx={{ position: "relative", zIndex: 1, px: { xs: 1.4, sm: 2.75, md: 3.5 }, pt: { xs: 1.2, sm: 2.75, md: 3 } }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ display: { xs: "none", sm: "flex" } }}>
                  <Box sx={{ width: 42, height: 42, borderRadius: 2.5, display: "grid", placeItems: "center", bgcolor: alpha("#ffffff", 0.08), border: `1px solid ${alpha("#ffffff", 0.1)}` }}>
                    <Box component="img" src={WEB_LOGO_PATH} alt="PickleTour" sx={{ width: 28, height: 28, objectFit: "contain" }} />
                  </Box>
                  <Typography sx={{ fontSize: { xs: 24, md: 28 }, lineHeight: 1, fontWeight: 900, letterSpacing: "-0.04em", color: "#e6ff49" }}>PICKLETOUR</Typography>
                </Stack>
                <Box sx={{ maxWidth: 380 }}>
                  <Typography sx={{ color: alpha("#ffffff", 0.62), fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {t("auth.login.brandBadge")}
                  </Typography>
                  <Typography variant={isMobile ? "h6" : "h4"} sx={{ mt: { xs: 0.3, md: 1 }, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.04em", fontSize: { xs: "0.92rem", sm: undefined } }}>
                    {t("auth.login.brandTitle")}
                  </Typography>
                  <Typography sx={{ mt: 1, display: { xs: "none", sm: "block" }, color: alpha("#ffffff", 0.72), lineHeight: 1.7, fontSize: { xs: 14, md: 15 } }}>
                    {t("auth.login.brandBody")}
                  </Typography>
                </Box>
              </Stack>

              {/* Showcase cards */}
              <Box
                sx={{
                  position: "relative",
                  zIndex: 1,
                  minHeight: { xs: 170, sm: 220, md: 340 },
                  mt: { xs: 0.5, md: 1.5 },
                  ...(isMobile
                    ? { display: "flex", gap: 1.5, px: 1.5, pb: 1, overflowX: "auto", overflowY: "visible", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", msOverflowStyle: "none", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" }, alignItems: "flex-start" }
                    : {}),
                }}
              >
                <Box aria-hidden="true" sx={{ display: { xs: "none", md: "block" }, position: "absolute", top: 18, right: 34, width: 104, height: 104, borderRadius: 4, bgcolor: "#7d64ff", transform: "rotate(10deg)" }} />
                <Box aria-hidden="true" sx={{ display: { xs: "none", md: "block" }, position: "absolute", bottom: 26, right: 74, width: 118, height: 118, borderRadius: 4, bgcolor: "#b8d8ff", transform: "rotate(-5deg)" }} />

                {isMobile ? (
                  <>
                    {showcaseItems.map((card, index) => {
                      const CardIcon = card.icon;
                      const rotations = [-3, 2, -1.5];
                      const offsets = [0, 12, 4];
                      const isActive = index === activeShowcase;
                      return (
                        <Paper key={card.kind} elevation={0} sx={{ flex: "0 0 auto", width: isActive ? 200 : 140, scrollSnapAlign: "center", p: isActive ? 1.5 : 1, borderRadius: 3.5, color: "#ffffff", background: isActive ? "linear-gradient(180deg, #0b2017 0%, #091a13 100%)" : "linear-gradient(180deg, #10261c 0%, #0a1d15 100%)", border: `1px solid ${alpha("#ffffff", isActive ? 0.12 : 0.06)}`, boxShadow: isActive ? `0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px ${alpha(card.accent, 0.15)}` : "0 8px 24px rgba(0,0,0,0.2)", transform: `rotate(${rotations[index]}deg) translateY(${offsets[index]}px)`, transition: "all 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
                          <Stack spacing={isActive ? 1.4 : 1}>
                            <Stack direction="row" spacing={0.75} alignItems="center">
                              <Box sx={{ width: isActive ? 28 : 22, height: isActive ? 28 : 22, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: isActive ? card.accent : alpha(card.accent, 0.18), color: isActive ? "#061108" : card.accent }}>
                                <CardIcon sx={{ fontSize: isActive ? 16 : 14 }} />
                              </Box>
                              <Typography sx={{ fontSize: isActive ? 9 : 8, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: isActive ? card.accent : alpha("#ffffff", 0.7) }}>{card.label}</Typography>
                            </Stack>
                            <Typography sx={{ fontSize: isActive ? 12 : 10, fontWeight: 700, lineHeight: 1.2, color: alpha("#ffffff", isActive ? 1 : 0.85) }}>{card.title}</Typography>
                            <ShowcaseVisual kind={card.kind} accent={card.accent} compact />
                          </Stack>
                        </Paper>
                      );
                    })}
                    <Box sx={{ flex: "0 0 8px" }} />
                  </>
                ) : (
                  <>
                    <Paper elevation={0} sx={{ position: "absolute", zIndex: 2, top: 68, left: "16%", width: "62%", maxWidth: 400, p: 2.4, borderRadius: 4, color: "#ffffff", background: "linear-gradient(180deg, #0b2017 0%, #091a13 100%)", border: `1px solid ${alpha("#ffffff", 0.08)}`, boxShadow: "0 24px 48px rgba(0, 0, 0, 0.32)", transform: "rotate(-5deg)", transition: "all 320ms ease" }}>
                      <Stack spacing={1.6}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box sx={{ width: 34, height: 34, borderRadius: 2.5, display: "grid", placeItems: "center", bgcolor: activeCard.accent, color: "#061108" }}>
                              <ActiveIcon fontSize="small" />
                            </Box>
                            <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: activeCard.accent }}>{activeCard.label}</Typography>
                          </Stack>
                          <Box sx={{ width: 8, height: 8, borderRadius: 99, bgcolor: activeCard.accent, boxShadow: `0 0 0 6px ${alpha(activeCard.accent, 0.12)}` }} />
                        </Stack>
                        <Box>
                          <Typography sx={{ fontSize: 22, fontWeight: 800 }}>{activeCard.title}</Typography>
                          <Typography sx={{ mt: 0.7, color: alpha("#ffffff", 0.68), fontSize: 13, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{activeCard.body}</Typography>
                        </Box>
                        <ShowcaseVisual kind={activeCard.kind} accent={activeCard.accent} compact={false} />
                      </Stack>
                    </Paper>
                    {[topCard, bottomCard].map((card, index) => {
                      const CardIcon = card.icon;
                      return (
                        <Paper key={card.title} elevation={0} sx={{ position: "absolute", zIndex: index === 0 ? 3 : 1, top: index === 0 ? 34 : 210, right: index === 0 ? 16 : "auto", left: index === 0 ? "auto" : 22, width: index === 0 ? 232 : 244, p: 1.8, borderRadius: 4, color: "#ffffff", background: "linear-gradient(180deg, #10261c 0%, #0a1d15 100%)", border: `1px solid ${alpha("#ffffff", 0.08)}`, boxShadow: "0 18px 40px rgba(0, 0, 0, 0.26)", transform: index === 0 ? "rotate(5deg)" : "rotate(-4deg)" }}>
                          <Stack spacing={1.25}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Box sx={{ width: 28, height: 28, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: alpha(card.accent, 0.18), color: card.accent }}>
                                <CardIcon sx={{ fontSize: 18 }} />
                              </Box>
                              <Typography sx={{ color: alpha("#ffffff", 0.9), fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{card.title}</Typography>
                            </Stack>
                            <ShowcaseVisual kind={card.kind} accent={card.accent} compact={isCompactMobile} />
                          </Stack>
                        </Paper>
                      );
                    })}
                  </>
                )}
              </Box>

              {/* Testimonial + Dots */}
              <Stack spacing={1.5} sx={{ position: "relative", zIndex: 1, px: { xs: 2.25, sm: 2.75, md: 3.5 }, pb: { xs: 1.5, md: 2.25 }, pt: { xs: 0.75, md: 1.5 } }}>
                <Paper
                  elevation={0}
                  sx={{
                    display: { xs: "none", sm: "block" },
                    p: { xs: 2, md: 2.2 },
                    borderRadius: 4,
                    background: alpha("#ffffff", 0.07),
                    border: `1px solid ${alpha("#ffffff", 0.1)}`,
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <Typography sx={{ color: alpha("#ffffff", 0.92), fontSize: { xs: 14, md: 15 }, lineHeight: 1.8 }}>
                    {t("auth.login.testimonial.quote")}
                  </Typography>
                  <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mt: 2 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: 99, background: "linear-gradient(135deg, rgba(219,255,85,0.95) 0%, rgba(127,104,255,0.95) 100%)" }} />
                    <Box>
                      <Typography sx={{ color: "#ffffff", fontWeight: 700, fontSize: 14 }}>{t("auth.login.testimonial.author")}</Typography>
                      <Typography sx={{ color: alpha("#ffffff", 0.6), fontSize: 12 }}>{t("auth.login.testimonial.role")}</Typography>
                    </Box>
                  </Stack>
                </Paper>
                <Stack direction="row" spacing={0.8} justifyContent="center">
                {showcaseItems.map((item, index) => (
                  <Box key={item.title} sx={{ width: index === activeShowcase ? 22 : 6, height: 6, borderRadius: 99, bgcolor: index === activeShowcase ? alpha("#ffffff", 0.92) : alpha("#ffffff", 0.28), transition: "all 220ms ease" }} />
                ))}
                </Stack>
              </Stack>
            </Box>

            {/* ---- Right form panel ---- */}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                boxSizing: "border-box",
                px: { xs: 2, sm: 3, md: 4 },
                pb: { xs: 3, sm: 3, md: 4 },
                pt: { xs: 2, sm: 3, md: "50px" },
                background: isDark ? alpha("#0c1419", 0.92) : "#fbfbfa",
                overflowY: "auto",
              }}
            >
              <Box sx={{ width: "100%", maxWidth: 430, mx: "auto" }}>
                <Stack spacing={{ xs: 2, md: 2.5 }}>
                  <Box>
                    <Typography
                      component="h1"
                      variant={isMobile ? "h4" : "h3"}
                      sx={{ color: formTextPrimary, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.04em" }}
                    >
                      {t("auth.register.title")}
                    </Typography>
                    <Typography sx={{ mt: 1, color: formTextSecondary, lineHeight: 1.75, fontSize: { xs: 14, md: 15 }, maxWidth: 360 }}>
                      {t("auth.register.seoDescription")}
                    </Typography>
                  </Box>

                  <Box component="form" noValidate onSubmit={submitHandler}>
                    <Stack spacing={1.75}>
                      {/* Avatar */}
                      <Box
                        ref={avatarRef}
                        sx={{
                          p: 1.5,
                          borderRadius: 3.5,
                          transition: "box-shadow .2s, border-color .2s",
                          border: highlightAvatar ? "1px solid" : `1px solid ${fieldBorder}`,
                          borderColor: highlightAvatar ? "error.main" : fieldBorder,
                          boxShadow: highlightAvatar ? 3 : 0,
                          bgcolor: fieldBackground,
                        }}
                      >
                        <Box display="flex" alignItems="center" gap={2}>
                          <PlaceholderAvatar src={avatarPreview} size={64} />
                          <Stack spacing={0.5}>
                            <Button
                              variant="outlined"
                              component="label"
                              disabled={uploadingAvatar || isLoading}
                              size="small"
                              sx={{ borderRadius: 99, textTransform: "none", fontWeight: 700 }}
                            >
                              {t("auth.register.chooseAvatar")}
                              <input type="file" accept="image/*" hidden onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                if (file.size > MAX_FILE_SIZE) {
                                  setErrors((p) => ({ ...p, avatar: t("auth.register.validation.avatarTooLarge") }));
                                  jumpAndHighlight(avatarRef, setHighlightAvatar);
                                  return;
                                }
                                setAvatarFile(file);
                                setAvatarPreview(URL.createObjectURL(file));
                                setErrors((p) => ({ ...p, avatar: undefined }));
                              }} />
                            </Button>
                            <Typography sx={{ color: formTextSecondary, fontSize: 11 }}>
                              {t("auth.register.validation.avatarRequired")}
                            </Typography>
                          </Stack>
                        </Box>
                        {showErr("avatar") && errors.avatar && (
                          <Alert severity="error" sx={{ mt: 1 }} role="alert">{errors.avatar}</Alert>
                        )}
                      </Box>

                      <TextField label={t("auth.register.nameLabel")} name="name" value={form.name} onChange={onChange} onBlur={onBlur} required fullWidth error={showErr("name")} helperText={showErr("name") ? errors.name : " "} sx={fieldSx} />
                      <TextField label={t("auth.register.nicknameLabel")} name="nickname" value={form.nickname} onChange={onChange} onBlur={onBlur} required fullWidth error={showErr("nickname")} helperText={showErr("nickname") ? errors.nickname : " "} sx={fieldSx} />
                      <TextField label={t("auth.register.phoneLabel")} name="phone" value={form.phone} onChange={onChange} onBlur={onBlur} required fullWidth inputProps={{ inputMode: "numeric", pattern: "0\\d{9}", maxLength: 10 }} error={showErr("phone")} helperText={showErr("phone") ? errors.phone : " "} sx={fieldSx} />
                      <TextField label={t("auth.register.emailLabel")} type="email" name="email" value={form.email} onChange={onChange} onBlur={onBlur} required fullWidth error={showErr("email")} helperText={showErr("email") ? errors.email : " "} sx={fieldSx} />

                      {/* Gender */}
                      <FormControl fullWidth error={showErr("gender")} sx={fieldSx}>
                        <InputLabel id="gender-lbl" shrink>{t("auth.register.genderLabel")}</InputLabel>
                        <Select labelId="gender-lbl" label={t("auth.register.genderLabel")} name="gender" value={form.gender} onChange={onChange} onBlur={onBlur} displayEmpty required>
                          {genderOptions.map((opt) => (<MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>))}
                        </Select>
                        {showErr("gender") && (<Typography variant="caption" color="error">{errors.gender}</Typography>)}
                      </FormControl>

                      {/* DOB */}
                      <DatePicker
                        label={t("auth.register.dobLabel")}
                        value={dobValue}
                        onChange={(newVal) => {
                          setTouched((t) => ({ ...t, dob: true }));
                          setForm((p) => ({ ...p, dob: newVal && newVal.isValid() ? newVal.format("YYYY-MM-DD") : "" }));
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
                            sx: fieldSx,
                          },
                        }}
                      />

                      {/* Province */}
                      <FormControl fullWidth required error={showErr("province")} sx={fieldSx}>
                        <InputLabel id="province-lbl" shrink>{t("auth.register.provinceLabel")}</InputLabel>
                        <Select labelId="province-lbl" label={t("auth.register.provinceLabel")} name="province" value={form.province} onChange={onChange} onBlur={onBlur} displayEmpty required>
                          <MenuItem value=""><em>{t("auth.register.provincePlaceholder")}</em></MenuItem>
                          {PROVINCES.map((p) => (<MenuItem key={p} value={p}>{p}</MenuItem>))}
                        </Select>
                        {showErr("province") && (<Typography variant="caption" color="error">{errors.province}</Typography>)}
                      </FormControl>

                      {/* CCCD */}
                      <TextField label={t("auth.register.cccdLabel")} name="cccd" value={form.cccd} onChange={onChange} onBlur={onBlur} fullWidth required placeholder={t("auth.register.cccdPlaceholder")} inputProps={{ inputMode: "numeric", maxLength: 12 }} error={showErr("cccd")} helperText={showErr("cccd") ? errors.cccd : " "} sx={fieldSx} />

                      {/* Password */}
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
                        sx={fieldSx}
                        InputProps={{
                          startAdornment: (<InputAdornment position="start"><LockRounded sx={{ color: alpha(formTextPrimary, 0.56) }} /></InputAdornment>),
                          endAdornment: (<InputAdornment position="end"><IconButton onClick={() => setShowPassword((v) => !v)} edge="end" aria-label={t("auth.register.aria.togglePassword")}>{showPassword ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment>),
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
                        helperText={showErr("confirmPassword") ? errors.confirmPassword : " "}
                        sx={fieldSx}
                        InputProps={{
                          startAdornment: (<InputAdornment position="start"><LockRounded sx={{ color: alpha(formTextPrimary, 0.56) }} /></InputAdornment>),
                          endAdornment: (<InputAdornment position="end"><IconButton onClick={() => setShowConfirmPassword((v) => !v)} edge="end" aria-label={t("auth.register.aria.toggleConfirmPassword")}>{showConfirmPassword ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment>),
                        }}
                      />

                      {/* Terms checkbox */}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={agreedTerms}
                            onChange={(e) => setAgreedTerms(e.target.checked)}
                            sx={{
                              color: alpha(formTextPrimary, 0.4),
                              "&.Mui-checked": { color: "#dbff55" },
                            }}
                          />
                        }
                        label={
                          <Typography sx={{ fontSize: 13, color: formTextSecondary, lineHeight: 1.5 }}>
                            {t("auth.register.termsPrefix")}
                            <Link component={RouterLink} to="/terms" underline="hover" sx={{ color: formTextPrimary, fontWeight: 600 }}>{t("auth.register.termsLink")}</Link>
                            {t("auth.register.termsAnd")}
                            <Link component={RouterLink} to="/privacy" underline="hover" sx={{ color: formTextPrimary, fontWeight: 600 }}>{t("auth.register.privacyLink")}</Link>
                            {t("auth.register.termsSuffix")}
                          </Typography>
                        }
                        sx={{ alignItems: "flex-start", mx: 0, mt: 0.5 }}
                      />

                      <CapWidget
                        fieldBackground={fieldBackground}
                        fieldBorder={fieldBorder}
                        textColor={formTextPrimary}
                        helperColor={formTextSecondary}
                      />

                      <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        size="large"
                        endIcon={!(isLoading || uploadingAvatar) ? <ArrowOutwardRounded /> : null}
                        sx={{
                          mt: "6px !important",
                          minHeight: { xs: 54, md: 58 },
                          borderRadius: 99,
                          fontSize: "1rem",
                          fontWeight: 800,
                          textTransform: "none",
                          color: "#ffffff",
                          background: "#070b10",
                          boxShadow: "0 20px 34px rgba(7, 11, 16, 0.16)",
                          "&:hover": { background: "#000000", boxShadow: "0 24px 40px rgba(7, 11, 16, 0.2)" },
                        }}
                        disabled={isLoading || uploadingAvatar}
                      >
                        {(isLoading || uploadingAvatar) ? <CircularProgress size={24} sx={{ color: "#ffffff" }} /> : t("auth.register.submit")}
                      </Button>

                      <Stack direction="row" spacing={0.75} justifyContent="center" alignItems="center" sx={{ pt: 0.5, display: { xs: "flex", md: "none" } }}>
                        <Typography sx={{ color: formTextSecondary, fontSize: 14 }}>
                          {t("auth.register.hasAccount")}
                        </Typography>
                        <Link component={RouterLink} to="/login" underline="hover" sx={{ color: formTextPrimary, fontWeight: 700 }}>
                          {t("auth.register.login")}
                        </Link>
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
