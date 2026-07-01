/* eslint-disable react/prop-types */
// RankingList.jsx
import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  memo,
  useRef,
  useLayoutEffect,
} from "react";
import {
  Container,
  Typography,
  Box,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Avatar,
  Alert,
  Stack,
  Chip,
  Card,
  CardContent,
  useTheme,
  useMediaQuery,
  Divider,
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Skeleton,
  Drawer,
  AppBar,
  Toolbar,
  IconButton,
  Grid,
  InputAdornment,
  GlobalStyles,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  LinearProgress,
  Fade,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import VerifiedIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import TableRowsIcon from "@mui/icons-material/TableRows";
import GridViewIcon from "@mui/icons-material/GridView";
import HistoryIcon from "@mui/icons-material/History";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import MilitaryTechIcon from "@mui/icons-material/MilitaryTech";

import { Link, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setKeyword, setPage } from "../../slices/rankingUiSlice";

/**
 * ✅ THAY API CŨ (useGetRankingsQuery) BẰNG 2 API MỚI
 * - useGetRankingsListQuery({ keyword, page }) -> { docs, totalPages }
 * - useGetRankingsPodiums30dQuery() -> { podiums30d } (hoặc object podiums)
 */
import {
  useGetRankingsListQuery,
  useGetRankingsPodiumAnnouncementsQuery,
  useGetRankingsPodiums30dQuery,
} from "../../slices/rankingsApiSlice";

import PublicProfileDialog from "../../components/PublicProfileDialog";

import {
  useGetMeQuery,
  useGetRatingHistoryQuery,
} from "../../slices/usersApiSlice";
import { useCreateEvaluationMutation } from "../../slices/evaluationsApiSlice";
import { useReviewKycMutation } from "../../slices/adminApiSlice";
import { skipToken } from "@reduxjs/toolkit/query";
import SponsorMarquee from "../../components/SponsorMarquee";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext";
import { formatDate } from "../../i18n/format";

/* ================= LAZY LOADING AVATAR COMPONENT ================= */
const ChampionCrown = memo(({ size = 26 }) => (
  <Box
    component="svg"
    viewBox="0 0 32 28"
    aria-hidden="true"
    focusable="false"
    sx={{
      position: "absolute",
      top: -Math.round(size * 0.42),
      left: -Math.round(size * 0.22),
      width: size,
      height: size,
      zIndex: 5,
      pointerEvents: "none",
      transform: "rotate(-16deg)",
      transformOrigin: "70% 80%",
      filter:
        "drop-shadow(0 2px 2px rgba(69,26,3,0.45)) drop-shadow(0 0 8px rgba(250,204,21,0.75))",
      animation: "championCrownFloat 1.8s ease-in-out infinite alternate",
    }}
  >
    <path
      d="M5.2 20.4 3.4 7.1l7.2 5.2L16 3.7l5.4 8.6 7.2-5.2-1.8 13.3Z"
      fill="#facc15"
      stroke="#fff7ad"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M7.4 18.3 6.6 11l4.8 3.4L16 7.2l4.6 7.2 4.8-3.4-.8 7.3Z"
      fill="#f59e0b"
      opacity="0.78"
    />
    <path
      d="M6.2 22.6h19.6"
      stroke="#b45309"
      strokeWidth="3.4"
      strokeLinecap="round"
    />
    <path
      d="M7.1 21.7h17.8"
      stroke="#fde68a"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <circle cx="3.4" cy="7" r="2.1" fill="#fff7ad" stroke="#f59e0b" />
    <circle cx="16" cy="3.7" r="2.35" fill="#fff7ad" stroke="#f59e0b" />
    <circle cx="28.6" cy="7" r="2.1" fill="#fff7ad" stroke="#f59e0b" />
    <path
      d="M10.3 10.9 16 3.7l5.7 7.2"
      fill="none"
      stroke="#fff7ad"
      strokeWidth="1.1"
      strokeLinecap="round"
      opacity="0.75"
    />
  </Box>
));

ChampionCrown.displayName = "ChampionCrown";

const LazyAvatar = memo(
  ({ src, alt, onClick, size = 44, flameEffect = null, showCrown = false }) => {
    const [loaded, setLoaded] = useState(false);
    const [isInView, setIsInView] = useState(false);
    const imgRef = useRef(null);

    // Intersection Observer for lazy loading
    useEffect(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setIsInView(true);
              observer.disconnect();
            }
          });
        },
        { rootMargin: "50px" }, // Load 50px before entering viewport
      );

      if (imgRef.current) {
        observer.observe(imgRef.current);
      }

      return () => observer.disconnect();
    }, []);

    const containerSx = useMemo(
      () => ({
        ...(flameEffect || {}),
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: showCrown ? "visible" : "hidden",
      }),
      [flameEffect, showCrown, size],
    );

    return (
      <Box ref={imgRef} sx={containerSx}>
        {showCrown && (
          <ChampionCrown size={Math.max(22, Math.round(size * 0.66))} />
        )}
        {!loaded && (
          <Skeleton
            variant="circular"
            width={size}
            height={size}
            animation="wave"
            sx={{ position: "absolute", top: 0, left: 0 }}
          />
        )}
        {isInView && (
          <Avatar
            src={src}
            alt={alt}
            onClick={onClick}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            imgProps={{
              loading: "lazy",
              decoding: "async",
            }}
            sx={{
              cursor: "zoom-in",
              width: size,
              height: size,
              opacity: loaded ? 1 : 0,
              transition: "opacity 0.3s ease-in-out",
            }}
          />
        )}
      </Box>
    );
  },
);

LazyAvatar.displayName = "LazyAvatar";

function KycImage({ src, alt, label, onClick, maxHeight = 320 }) {
  const { t } = useLanguage();
  const [loaded, setLoaded] = React.useState(false);
  const [err, setErr] = React.useState(false);
  const imgRef = React.useRef(null);

  React.useEffect(() => {
    setLoaded(false);
    setErr(false);
  }, [src]);

  React.useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    if (img.decode) {
      img
        .decode()
        .then(() => {
          if (!cancelled) setLoaded(true);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <Box
      sx={{
        position: "relative",
        cursor: src ? "zoom-in" : "default",
        bgcolor: "background.default",
        minHeight: maxHeight,
      }}
      onClick={() => src && onClick?.()}
    >
      {!loaded && !err && (
        <Skeleton
          variant="rectangular"
          animation="wave"
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: 0,
            height: maxHeight,
          }}
        />
      )}

      {src && (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="eager"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setErr(true);
            setLoaded(true);
          }}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            maxHeight,
            objectFit: "contain",
            opacity: loaded && !err ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
        />
      )}

      <Chip
        size="small"
        label={label}
        sx={{
          position: "absolute",
          top: 8,
          left: 8,
          bgcolor: "rgba(0,0,0,0.6)",
          color: "#fff",
          "& .MuiChip-label": { px: 1 },
        }}
      />

      {err && (
        <Box
          sx={{
            height: maxHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "background.default",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("rankings.feedback.imageLoadFailed")}
          </Typography>
        </Box>
      )}

      {!src && (
        <Box
          sx={{
            height: maxHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "background.default",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("rankings.feedback.noImage")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/* ================= Constants ================= */
const VIEW_KEY = "ranking_desktop_view";
const PLACE = "";
const HEX = {
  green: "#2e7d32",
  blue: "#1976d2",
  yellow: "#ff9800",
  red: "#f44336",
  grey: "#616161",
};
const RANKING_SCORE_FILTERS = [
  { value: "three_tours", label: "Từ 3 giải", bg: HEX.blue, color: "#fff" },
  { value: "staff", label: "Admin chấm", bg: HEX.yellow, color: "#000" },
  { value: "needs_review", label: "Cần chấm lại", bg: HEX.red, color: "#fff" },
  { value: "no_score", label: "Chưa có điểm", bg: HEX.grey, color: "#fff" },
];
const RANKING_SCORE_FILTER_VALUES = new Set(
  RANKING_SCORE_FILTERS.map((item) => item.value),
);
const ACHIEVEMENT_VISIBLE_LIMIT = 3;
const RANKING_PAGE_LIMIT = 12;
const MIN_RATING = 1.6;
const MAX_RATING = 8.0;
const fmt3 = (x) => {
  if (x === null) return "***";
  return Number.isFinite(x) ? Number(x).toFixed(3) : "0.000";
};
const SCORE_STALE_MONTHS = 4;

const hasAnyScore = (r) =>
  [r?.single, r?.double, r?.mix, r?.points].some((v) => Number(v) > 0);

const getLatestScoreActivityAt = (r) => {
  const dates = [
    r?.lastFinishedTourAt,
    r?.lastAssessmentAt,
    r?.lastStaffAssessmentAt,
    r?.lastUpdated,
    r?.updatedAt,
  ]
    .map((v) => (v ? new Date(v) : null))
    .filter((d) => d && Number.isFinite(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] || null;
};

const isScoreStale = (r) => {
  if (!hasAnyScore(r)) return false;
  const latest = getLatestScoreActivityAt(r);
  if (!latest) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - SCORE_STALE_MONTHS);
  return latest.getTime() < cutoff.getTime();
};

const getScoreHex = (r) => {
  if (!hasAnyScore(r)) return HEX.grey;
  if (isScoreStale(r)) return HEX.red;
  const totalTours = Number(r?.totalTours || r?.totalFinishedTours || 0);
  if (totalTours >= 3 || r?.tierColor === "blue") return HEX.blue;
  if (totalTours > 0 || r?.hasStaffAssessment || r?.tierColor === "yellow") {
    return HEX.yellow;
  }
  if (r?.tierColor === "red") return HEX.red;
  return HEX.grey;
};

const SKELETON_CARDS_MOBILE = 6;
const SKELETON_ROWS_DESKTOP = 10;
const SKELETON_CARDS_DESKTOP = 9;

/* ================= Helper Functions (memoized) ================= */
const calcAge = (u) => {
  if (!u) return null;
  const today = new Date();
  const dateStr =
    u.dob || u.dateOfBirth || u.birthday || u.birthdate || u.birth_date;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d)) {
      let age = today.getFullYear() - d.getFullYear();
      const m = today.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
      return age;
    }
  }
  const yearRaw = u.birthYear ?? u.birth_year ?? u.yob;
  const year = Number(yearRaw);
  if (Number.isFinite(year) && year > 1900 && year <= today.getFullYear()) {
    return today.getFullYear() - year;
  }
  if (dateStr && /^\d{4}$/.test(String(dateStr))) {
    const y = Number(dateStr);
    if (Number.isFinite(y)) return today.getFullYear() - y;
  }
  return null;
};

const cccdBadge = (status, t) => {
  switch (status) {
    case "verified":
      return { text: t("rankings.statuses.verified"), color: "success" };
    case "pending":
      return { text: t("rankings.statuses.pending"), color: "warning" };
    default:
      return { text: t("rankings.statuses.unverified"), color: "default" };
  }
};

const genderLabel = (g, t) => {
  switch (g) {
    case "male":
      return t("profile.genderOptions.male");
    case "female":
      return t("rankings.statuses.female");
    case "other":
      return t("rankings.statuses.other");
    case "unspecified":
      return t("rankings.statuses.unspecified");
    default:
      return "--";
  }
};

const canGradeUser = (me, targetProvince) => {
  if (me?.role === "admin") return true;
  if (!me?.evaluator?.enabled) return false;
  const scopes = me?.evaluator?.gradingScopes?.provinces || [];
  return !!targetProvince && scopes.includes(String(targetProvince).trim());
};

const canViewKycAdmin = (me, status) =>
  me?.role === "admin" && (status === "verified" || status === "pending");

const numOrUndef = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

const fmtHistoryScore = (value) => {
  if (value === "***") return "***";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : "--";
};

const getHistoryScorerName = (row) =>
  row?.scorer?.name ||
  row?.scorer?.nickname ||
  row?.scorer?.email ||
  "--";

const achievementToneSx = {
  blue: {
    bgcolor: HEX.blue,
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #1f6feb 0%, #35b7ff 100%)",
  },
  yellow: {
    bgcolor: HEX.yellow,
    color: "#111",
    backgroundImage: "linear-gradient(135deg, #ffd54f 0%, #ff9800 100%)",
  },
  red: {
    bgcolor: HEX.red,
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #ff1744 0%, #ff6d00 100%)",
  },
  grey: {
    bgcolor: HEX.grey,
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #616161 0%, #9e9e9e 100%)",
  },
  green: {
    bgcolor: HEX.green,
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #0f9d58 0%, #62d26f 100%)",
  },
  purple: {
    bgcolor: "#7b1fa2",
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #5b21b6 0%, #d946ef 100%)",
  },
  cyan: {
    bgcolor: "#00838f",
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #00838f 0%, #22d3ee 100%)",
  },
  bronze: {
    bgcolor: "#bf6d2d",
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #8d4a18 0%, #f59e0b 100%)",
  },
  navy: {
    bgcolor: "#1e3a8a",
    color: "#fff",
    backgroundImage: "linear-gradient(135deg, #172554 0%, #2563eb 100%)",
  },
};

const achievementEffectSx = {
  fire: {
    boxShadow: "0 0 12px rgba(255, 111, 0, 0.55)",
    "&::before": {
      background:
        "linear-gradient(90deg, transparent, rgba(255,255,255,0.46), transparent)",
      animation: "achievementFlare 1.45s ease-in-out infinite",
    },
    "&::after": {
      background:
        "radial-gradient(circle at 20% 80%, rgba(255,255,255,0.45) 0 8%, transparent 9%), radial-gradient(circle at 70% 20%, rgba(255,214,10,0.5) 0 10%, transparent 11%)",
      animation: "achievementPulse 1.15s ease-in-out infinite alternate",
    },
  },
  inferno: {
    boxShadow: "0 0 16px rgba(255, 61, 0, 0.72)",
    "&::before": {
      background:
        "linear-gradient(120deg, rgba(255,255,255,0), rgba(255,245,157,0.62), rgba(255,255,255,0))",
      animation: "achievementFlare 1.05s ease-in-out infinite",
    },
    "&::after": {
      background:
        "radial-gradient(circle at 25% 75%, rgba(255,245,157,0.55) 0 10%, transparent 11%), radial-gradient(circle at 72% 30%, rgba(255,255,255,0.45) 0 8%, transparent 9%)",
      animation: "achievementPulse 0.95s ease-in-out infinite alternate",
    },
  },
  snow: {
    boxShadow: "0 0 12px rgba(186, 230, 253, 0.52)",
    "&::before": {
      background:
        "radial-gradient(circle, rgba(255,255,255,0.92) 0 2px, transparent 3px), radial-gradient(circle, rgba(255,255,255,0.7) 0 1px, transparent 2px)",
      backgroundSize: "16px 16px, 11px 11px",
      animation: "achievementSnow 2.2s linear infinite",
    },
  },
  mystic: {
    boxShadow: "0 0 14px rgba(216, 180, 254, 0.62)",
    "&::before": {
      background:
        "linear-gradient(90deg, transparent, rgba(255,255,255,0.48), transparent)",
      animation: "achievementMystic 2s ease-in-out infinite",
    },
  },
  electric: {
    boxShadow: "0 0 12px rgba(34, 211, 238, 0.62)",
    "&::before": {
      background:
        "linear-gradient(115deg, transparent 20%, rgba(255,255,255,0.62) 42%, transparent 44%, rgba(255,255,255,0.5) 54%, transparent 60%)",
      animation: "achievementSpark 1.15s steps(2, end) infinite",
    },
  },
  royal: {
    boxShadow: "0 0 16px rgba(250, 204, 21, 0.62)",
    "&::before": {
      background:
        "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
      animation: "achievementFlare 1.65s ease-in-out infinite",
    },
  },
  ember: {
    boxShadow: "0 0 12px rgba(251, 146, 60, 0.54)",
    "&::after": {
      background:
        "radial-gradient(circle at 30% 75%, rgba(255,255,255,0.35) 0 8%, transparent 9%), radial-gradient(circle at 68% 25%, rgba(255,221,128,0.4) 0 8%, transparent 9%)",
      animation: "achievementPulse 1.35s ease-in-out infinite alternate",
    },
  },
  metal: {
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
    "&::before": {
      background:
        "linear-gradient(110deg, transparent 10%, rgba(255,255,255,0.36), transparent 34%)",
      animation: "achievementMystic 2.8s ease-in-out infinite",
    },
  },
  glow: {
    boxShadow: "0 0 10px rgba(255,255,255,0.22)",
    "&::after": {
      background:
        "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.24), transparent 60%)",
      animation: "achievementPulse 1.8s ease-in-out infinite alternate",
    },
  },
};

const achievementMedalSx = {
  gold: {
    color: "#2b1700",
    backgroundImage:
      "linear-gradient(135deg, #fff7ad 0%, #facc15 34%, #f59e0b 68%, #fef3c7 100%)",
    borderColor: "rgba(255, 214, 10, 0.82)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.32) inset, 0 0 16px rgba(250, 204, 21, 0.72), 0 6px 16px rgba(120, 53, 15, 0.28)",
    textShadow: "0 1px 0 rgba(255,255,255,0.35)",
    "&::before": {
      background:
        "linear-gradient(105deg, transparent 16%, rgba(255,255,255,0.76), transparent 42%)",
      animation: "achievementFlare 1.25s ease-in-out infinite",
    },
    "&::after": {
      background:
        "radial-gradient(circle at 22% 78%, rgba(255,255,255,0.48) 0 8%, transparent 9%), radial-gradient(circle at 78% 22%, rgba(255,255,255,0.42) 0 7%, transparent 8%)",
      animation: "achievementPulse 1.05s ease-in-out infinite alternate",
    },
    "& .MuiChip-icon": {
      color: "#7c2d12",
      filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.45))",
    },
  },
  silver: {
    color: "#102033",
    backgroundImage:
      "linear-gradient(135deg, #ffffff 0%, #dbeafe 28%, #94a3b8 62%, #f8fafc 100%)",
    borderColor: "rgba(226, 232, 240, 0.9)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.42) inset, 0 0 14px rgba(203, 213, 225, 0.62), 0 5px 14px rgba(15, 23, 42, 0.2)",
    textShadow: "0 1px 0 rgba(255,255,255,0.44)",
    "&::before": {
      background:
        "linear-gradient(112deg, transparent 14%, rgba(255,255,255,0.72), transparent 38%)",
      animation: "achievementMystic 2.05s ease-in-out infinite",
    },
    "&::after": {
      background:
        "radial-gradient(circle at 35% 25%, rgba(255,255,255,0.5) 0 8%, transparent 9%), radial-gradient(circle at 75% 75%, rgba(226,232,240,0.4) 0 8%, transparent 9%)",
      animation: "achievementSnow 2.6s linear infinite",
    },
    "& .MuiChip-icon": {
      color: "#334155",
      filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.55))",
    },
  },
  bronze: {
    color: "#fff7ed",
    backgroundImage:
      "linear-gradient(135deg, #78350f 0%, #b45309 36%, #f97316 72%, #fed7aa 100%)",
    borderColor: "rgba(251, 146, 60, 0.78)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.2) inset, 0 0 14px rgba(251, 146, 60, 0.58), 0 5px 14px rgba(67, 20, 7, 0.28)",
    textShadow: "0 1px 1px rgba(67,20,7,0.55)",
    "&::before": {
      background:
        "linear-gradient(105deg, transparent 18%, rgba(255,237,213,0.56), transparent 42%)",
      animation: "achievementFlare 1.7s ease-in-out infinite",
    },
    "&::after": {
      background:
        "radial-gradient(circle at 28% 78%, rgba(255,237,213,0.4) 0 8%, transparent 9%), radial-gradient(circle at 76% 28%, rgba(255,255,255,0.25) 0 7%, transparent 8%)",
      animation: "achievementPulse 1.35s ease-in-out infinite alternate",
    },
    "& .MuiChip-icon": {
      color: "#ffedd5",
      filter: "drop-shadow(0 1px 1px rgba(67,20,7,0.65))",
    },
  },
};

const getAchievementMedalVariant = (item) => {
  const id = String(item?.id || "");
  if (id.startsWith("gold-count")) return "gold";
  if (id.startsWith("silver-count")) return "silver";
  if (id.startsWith("bronze-count")) return "bronze";
  return "";
};

const getAchievementIcon = (item) => {
  const medal = getAchievementMedalVariant(item);
  if (medal === "gold") return <EmojiEventsIcon fontSize="small" />;
  if (medal === "silver") return <WorkspacePremiumIcon fontSize="small" />;
  if (medal === "bronze") return <MilitaryTechIcon fontSize="small" />;
  return null;
};

const safeScoreNumber = (value) => {
  if (value === null || value === "***") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const fmtAchievementScore = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--";

const daysAgo = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const countMedal = (items, medal) =>
  (items || []).filter((item) => item?.medal === medal).length;

const achievementRule = ({
  id,
  category,
  tone = "grey",
  priority = 0,
  when,
  label,
  explain,
}) => ({ id, category, tone, priority, when, label, explain });

const buildAchievementRules = () => {
  const rules = [
    achievementRule({
      id: "province-rank-1",
      category: "Xếp hạng tỉnh",
      tone: "blue",
      priority: 980,
      when: (ctx) => ctx.provinceRank === 1,
      label: (ctx) => `Top 1 ${ctx.province}`,
      explain: (ctx) =>
        `Đang đứng hạng 1 tại ${ctx.province} theo thứ tự xếp hạng hiện tại.`,
    }),
    achievementRule({
      id: "province-rank-2",
      category: "Xếp hạng tỉnh",
      tone: "blue",
      priority: 930,
      when: (ctx) => ctx.provinceRank === 2,
      label: (ctx) => `Top 2 ${ctx.province}`,
      explain: (ctx) =>
        `Đang đứng hạng 2 tại ${ctx.province} theo thứ tự xếp hạng hiện tại.`,
    }),
    achievementRule({
      id: "province-rank-3",
      category: "Xếp hạng tỉnh",
      tone: "blue",
      priority: 920,
      when: (ctx) => ctx.provinceRank === 3,
      label: (ctx) => `Top 3 ${ctx.province}`,
      explain: (ctx) =>
        `Đang nằm trong top 3 tại ${ctx.province}.`,
    }),
    achievementRule({
      id: "province-rank-5",
      category: "Xếp hạng tỉnh",
      tone: "blue",
      priority: 850,
      when: (ctx) => ctx.provinceRank > 0 && ctx.provinceRank <= 5,
      label: "Top 5 tỉnh",
      explain: (ctx) =>
        `Đang đứng hạng ${ctx.provinceRank} tại ${ctx.province}.`,
    }),
    achievementRule({
      id: "province-rank-10",
      category: "Xếp hạng tỉnh",
      tone: "blue",
      priority: 760,
      when: (ctx) => ctx.provinceRank > 0 && ctx.provinceRank <= 10,
      label: "Top 10 tỉnh",
      explain: (ctx) =>
        `Đang nằm trong top 10 tại ${ctx.province}, hạng ${ctx.provinceRank}.`,
    }),
    achievementRule({
      id: "national-rank-1",
      category: "Xếp hạng",
      tone: "purple",
      priority: 990,
      when: (ctx) => ctx.globalRank === 1,
      label: "Top 1 BXH",
      explain: "Đang đứng đầu bảng xếp hạng theo thứ tự hiện tại.",
    }),
    achievementRule({
      id: "national-rank-3",
      category: "Xếp hạng",
      tone: "purple",
      priority: 960,
      when: (ctx) => ctx.globalRank > 0 && ctx.globalRank <= 3,
      label: "Top 3 BXH",
      explain: (ctx) => `Đang nằm trong top 3 toàn bảng, hạng ${ctx.globalRank}.`,
    }),
    achievementRule({
      id: "national-rank-10",
      category: "Xếp hạng",
      tone: "purple",
      priority: 870,
      when: (ctx) => ctx.globalRank > 0 && ctx.globalRank <= 10,
      label: "Top 10 BXH",
      explain: (ctx) => `Đang nằm trong top 10 toàn bảng, hạng ${ctx.globalRank}.`,
    }),
    achievementRule({
      id: "kyc-verified",
      category: "Xác thực hồ sơ",
      tone: "green",
      priority: 520,
      when: (ctx) => ctx.kycStatus === "verified",
      label: "Đã KYC",
      explain: "Hồ sơ định danh đã được xác thực.",
    }),
    achievementRule({
      id: "needs-review",
      category: "Độ mới điểm",
      tone: "red",
      priority: 680,
      when: (ctx) => ctx.hasScore && ctx.isStale,
      label: "Cần chấm lại",
      explain: "Điểm có dấu hiệu cũ, nên cập nhật hoặc chấm lại.",
    }),
    achievementRule({
      id: "no-score",
      category: "Điểm trình",
      tone: "grey",
      priority: 120,
      when: (ctx) => !ctx.hasScore,
      label: "Chưa có điểm",
      explain: "Chưa có điểm đơn, đôi, mix hoặc điểm tích lũy.",
    }),
  ];

  [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50].forEach((n) => {
    rules.push(
      achievementRule({
        id: `tour-count-${n}`,
        category: "Kinh nghiệm thi đấu",
        tone: n >= 10 ? "navy" : "cyan",
        priority: 430 + n,
        when: (ctx) => ctx.totalTours >= n,
        label: n === 1 ? "Đã thi đấu" : `+${n} giải`,
        explain: (ctx) =>
          `Đã ghi nhận ${ctx.totalTours} giải đã hoàn tất trong dữ liệu ranking.`,
      }),
    );
  });

  [1, 2, 3, 4, 5, 7, 10].forEach((n) => {
    rules.push(
      achievementRule({
        id: `gold-count-${n}`,
        category: "Huy chương",
        tone: "yellow",
        priority: 900 + n * 8,
        when: (ctx) => ctx.goldCount >= n,
        label: n === 1 ? "Nhà vô địch" : `Vô địch +${n} giải`,
        explain: (ctx) =>
          `Có ${ctx.goldCount} lần vô địch trong dữ liệu podium 30 ngày gần đây.`,
      }),
    );
  });

  [1, 2, 3, 5, 7, 10].forEach((n) => {
    rules.push(
      achievementRule({
        id: `podium-count-${n}`,
        category: "Huy chương",
        tone: "bronze",
        priority: 780 + n * 7,
        when: (ctx) => ctx.podiumCount >= n,
        label: n === 1 ? "Có podium" : `Podium +${n}`,
        explain: (ctx) =>
          `Có ${ctx.podiumCount} lần lên bục trong dữ liệu podium 30 ngày gần đây.`,
      }),
    );
  });

  [1, 2, 3, 5].forEach((n) => {
    rules.push(
      achievementRule({
        id: `silver-count-${n}`,
        category: "Huy chương",
        tone: "grey",
        priority: 650 + n * 6,
        when: (ctx) => ctx.silverCount >= n,
        label: n === 1 ? "Á quân" : `Á quân +${n}`,
        explain: (ctx) =>
          `Có ${ctx.silverCount} lần á quân trong dữ liệu podium 30 ngày gần đây.`,
      }),
      achievementRule({
        id: `bronze-count-${n}`,
        category: "Huy chương",
        tone: "bronze",
        priority: 620 + n * 6,
        when: (ctx) => ctx.bronzeCount >= n,
        label: n === 1 ? "Hạng 3" : `Hạng 3 +${n}`,
        explain: (ctx) =>
          `Có ${ctx.bronzeCount} lần hạng ba trong dữ liệu podium 30 ngày gần đây.`,
      }),
    );
  });

  [2, 3, 4, 5, 7, 10].forEach((n) => {
    rules.push(
      achievementRule({
        id: `podium-event-count-${n}`,
        category: "Phong độ gần đây",
        tone: "purple",
        priority: 720 + n * 5,
        when: (ctx) => ctx.podiumEventCount >= n,
        label: `Ăn giải +${n} sự kiện`,
        explain: (ctx) =>
          `Có podium ở ${ctx.podiumEventCount} sự kiện khác nhau trong 30 ngày gần đây.`,
      }),
    );
  });

  [1, 3, 7, 14, 30].forEach((n) => {
    rules.push(
      achievementRule({
        id: `fresh-podium-${n}`,
        category: "Phong độ gần đây",
        tone: "green",
        priority: 740 - n,
        when: (ctx) =>
          ctx.latestPodiumDays !== null && ctx.latestPodiumDays <= n,
        label: n === 1 ? "Podium hôm nay" : `Podium ${n} ngày`,
        explain: (ctx) =>
          `Podium gần nhất cách đây ${ctx.latestPodiumDays} ngày.`,
      }),
    );
  });

  [2.0, 2.5, 3.0, 3.3, 3.5, 3.8, 4.0, 4.2, 4.5, 4.8, 5.0, 5.5, 6.0, 6.5, 7.0].forEach((n) => {
    rules.push(
      achievementRule({
        id: `double-score-${n}`,
        category: "Điểm đôi",
        tone: n >= 5 ? "purple" : n >= 4 ? "blue" : "cyan",
        priority: 330 + Math.round(n * 20),
        when: (ctx) => ctx.doubleScore !== null && ctx.doubleScore >= n,
        label: `Đôi ${n.toFixed(1)}+`,
        explain: (ctx) =>
          `Điểm đôi hiện tại là ${fmtAchievementScore(ctx.doubleScore)}, đạt mốc ${n.toFixed(1)}+.`,
      }),
      achievementRule({
        id: `single-score-${n}`,
        category: "Điểm đơn",
        tone: n >= 5 ? "purple" : n >= 4 ? "blue" : "cyan",
        priority: 320 + Math.round(n * 20),
        when: (ctx) => ctx.singleScore !== null && ctx.singleScore >= n,
        label: `Đơn ${n.toFixed(1)}+`,
        explain: (ctx) =>
          `Điểm đơn hiện tại là ${fmtAchievementScore(ctx.singleScore)}, đạt mốc ${n.toFixed(1)}+.`,
      }),
    );
  });

  [0.05, 0.1, 0.2, 0.3, 0.5].forEach((gap) => {
    rules.push(
      achievementRule({
        id: `balanced-gap-${gap}`,
        category: "Hồ sơ điểm",
        tone: "green",
        priority: 410 - Math.round(gap * 100),
        when: (ctx) =>
          ctx.singleScore !== null &&
          ctx.doubleScore !== null &&
          Math.abs(ctx.singleScore - ctx.doubleScore) <= gap,
        label: `Đơn/đôi cân ${gap}`,
        explain: (ctx) =>
          `Điểm đơn và đôi chênh ${fmtAchievementScore(Math.abs(ctx.singleScore - ctx.doubleScore))}, trong ngưỡng ${gap}.`,
      }),
    );
  });

  [60, 70, 80, 90, 100].forEach((n) => {
    rules.push(
      achievementRule({
        id: `reputation-${n}`,
        category: "Uy tín",
        tone: n >= 90 ? "purple" : "green",
        priority: 360 + n,
        when: (ctx) => ctx.reputation >= n,
        label: `Uy tín ${n}+`,
        explain: (ctx) => `Điểm uy tín hiện tại là ${ctx.reputation}.`,
      }),
    );
  });

  [
    { id: "junior", label: "Tài năng trẻ", when: (ctx) => ctx.age !== null && ctx.age <= 18 },
    { id: "u23", label: "U23", when: (ctx) => ctx.age !== null && ctx.age <= 23 },
    { id: "senior35", label: "35+", when: (ctx) => ctx.age !== null && ctx.age >= 35 },
    { id: "senior45", label: "45+", when: (ctx) => ctx.age !== null && ctx.age >= 45 },
    { id: "senior55", label: "55+", when: (ctx) => ctx.age !== null && ctx.age >= 55 },
  ].forEach((item) => {
    rules.push(
      achievementRule({
        id: `age-${item.id}`,
        category: "Nhóm tuổi",
        tone: "grey",
        priority: 180,
        when: item.when,
        label: item.label,
        explain: (ctx) => `Tuổi hiện tại được tính là ${ctx.age}.`,
      }),
    );
  });

  return rules;
};

const ACHIEVEMENT_RULES = buildAchievementRules();

const achievementFamilyFromId = (id = "") => {
  const key = String(id);
  if (key.startsWith("national-rank")) return "national-rank";
  if (key.startsWith("province-rank")) return "province-rank";
  if (key.startsWith("tour-count")) return "tour-count";
  if (key.startsWith("gold-count")) return "gold-count";
  if (key.startsWith("podium-count")) return "podium-count";
  if (key.startsWith("silver-count")) return "silver-count";
  if (key.startsWith("bronze-count")) return "bronze-count";
  if (key.startsWith("podium-event-count")) return "podium-event-count";
  if (key.startsWith("fresh-podium")) return "fresh-podium";
  if (key.startsWith("double-score")) return "double-score";
  if (key.startsWith("single-score")) return "single-score";
  if (key.startsWith("balanced-gap")) return "balanced-gap";
  if (key.startsWith("reputation")) return "reputation";
  if (key.startsWith("age-")) return "age";
  return key || "achievement";
};

const normalizeRankingAchievements = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || item?.label || ""),
      category: String(item?.category || "Chip nổi bật"),
      tone: String(item?.tone || "grey"),
      effect: String(item?.effect || item?.tone || "glow"),
      label: String(item?.label || "").trim(),
      explain: String(item?.explain || item?.description || "").trim(),
      priority: Number(item?.priority || 0),
    }))
    .filter((item) => item.id && item.label);

const hasTopOneAchievement = (achievements = []) =>
  (Array.isArray(achievements) ? achievements : []).some(
    (item) => item?.id === "national-rank-1",
  );

const buildAchievementContext = ({
  r,
  u,
  age,
  effectiveStatus,
  podiums,
  globalRank,
}) => {
  const podiumItems = Array.isArray(podiums) ? podiums : [];
  const latestPodiumDays =
    podiumItems.length > 0
      ? Math.min(
          ...podiumItems
            .map((item) => daysAgo(item?.finishedAt))
            .filter((value) => value !== null),
        )
      : null;
  const podiumEventCount = new Set(
    podiumItems.map((item) => item?.tournamentId).filter(Boolean).map(String),
  ).size;

  return {
    r,
    u,
    age: Number.isFinite(age) ? age : null,
    province: String(u?.province || "").trim() || "tỉnh",
    provinceRank: Number(r?.provinceRank) || null,
    globalRank: Number(globalRank || r?.globalRank) || null,
    totalTours: Number(r?.totalTours || r?.totalFinishedTours || 0),
    hasStaffAssessment: Boolean(r?.hasStaffAssessment),
    kycStatus: String(effectiveStatus || ""),
    hasScore: hasAnyScore(r),
    isStale: isScoreStale(r),
    singleScore: safeScoreNumber(r?.single),
    doubleScore: safeScoreNumber(r?.double),
    mixScore: safeScoreNumber(r?.mix),
    points: safeScoreNumber(r?.points),
    reputation: Number(r?.reputation || 0),
    goldCount: countMedal(podiumItems, "gold"),
    silverCount: countMedal(podiumItems, "silver"),
    bronzeCount: countMedal(podiumItems, "bronze"),
    podiumCount: podiumItems.length,
    podiumEventCount,
    latestPodiumDays: Number.isFinite(latestPodiumDays)
      ? latestPodiumDays
      : null,
  };
};

const buildRankingAchievements = (args) => {
  const backendAchievements = normalizeRankingAchievements(args?.r?.achievements);
  if (backendAchievements.length) return backendAchievements;
  if (!args?.enableFrontendAchievementFallback) return [];

  const ctx = buildAchievementContext(args);
  const matched = ACHIEVEMENT_RULES.filter((rule) => {
    try {
      return rule.when(ctx);
    } catch {
      return false;
    }
  })
    .map((rule) => ({
      id: rule.id,
      category: rule.category,
      tone: rule.tone,
      priority: rule.priority,
      label:
        typeof rule.label === "function" ? rule.label(ctx) : String(rule.label),
      explain:
        typeof rule.explain === "function"
          ? rule.explain(ctx)
          : String(rule.explain),
      effect: rule.tone,
    }))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));

  const byFamily = new Map();
  for (const item of matched) {
    const family = achievementFamilyFromId(item.id);
    if (!byFamily.has(family)) byFamily.set(family, item);
  }
  return Array.from(byFamily.values());
};

const achievementChipSx = (tone, extra = {}, effect = "glow", medal = "") => ({
  ...(achievementToneSx[tone] || achievementToneSx.grey),
  ...(achievementEffectSx[effect] || achievementEffectSx.glow),
  ...(achievementMedalSx[medal] || {}),
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  height: 24,
  borderRadius: "999px",
  fontWeight: 700,
  maxWidth: 180,
  border: "1px solid rgba(255,255,255,0.22)",
  textShadow: "0 1px 1px rgba(0,0,0,0.35)",
  transition: "transform 140ms ease, box-shadow 140ms ease",
  "&:hover": {
    transform: "translateY(-1px)",
  },
  "&::before,&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    pointerEvents: "none",
    zIndex: 0,
  },
  "& .MuiChip-label": {
    display: "block",
    position: "relative",
    zIndex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "& .MuiChip-icon": {
    position: "relative",
    zIndex: 1,
    ml: 0.75,
    mr: -0.25,
    fontSize: 16,
    ...(achievementMedalSx[medal]?.["& .MuiChip-icon"] || {}),
  },
  ...extra,
});

function AchievementSummary({ achievements, onOpen, maxWidth = 180 }) {
  if (!Array.isArray(achievements) || achievements.length === 0) return null;
  const visible = achievements.slice(0, ACHIEVEMENT_VISIBLE_LIMIT);
  const hiddenCount = Math.max(0, achievements.length - visible.length);

  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.75 }}>
      {visible.map((item) => (
        <Chip
          key={item.id}
          size="small"
          icon={getAchievementIcon(item)}
          label={item.label}
          clickable
          onClick={onOpen}
          sx={achievementChipSx(
            item.tone,
            { maxWidth },
            item.effect,
            getAchievementMedalVariant(item),
          )}
        />
      ))}
      {hiddenCount > 0 && (
        <Chip
          size="small"
          label={`+${hiddenCount}`}
          clickable
          onClick={onOpen}
          sx={achievementChipSx("grey", { maxWidth: 72 }, "metal")}
        />
      )}
    </Stack>
  );
}

function AchievementsDialog({ open, user, achievements, onClose }) {
  const displayName = user?.nickname || user?.name || "--";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" fontWeight={800} noWrap>
              Chip nổi bật - {displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {achievements.length} chip nổi bật đã được chọn lọc
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Đóng">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {achievements.length ? (
          <Stack spacing={1.25}>
            {achievements.map((item) => (
              <Paper
                key={item.id}
                variant="outlined"
                sx={{ p: 1.25, borderRadius: 2 }}
              >
                <Stack
                  direction="row"
                  alignItems="flex-start"
                  spacing={1.25}
                  sx={{ minWidth: 0 }}
                >
                  <Chip
                    size="small"
                    icon={getAchievementIcon(item)}
                    label={item.label}
                    sx={achievementChipSx(
                      item.tone,
                      { maxWidth: 220 },
                      item.effect,
                      getAchievementMedalVariant(item),
                    )}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {item.category}
                    </Typography>
                    <Typography variant="body2">{item.explain}</Typography>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">Chưa có chip nổi bật phù hợp.</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}

const podiumAnnouncementMeta = {
  gold: {
    label: "Vô địch",
    action: "vô địch giải",
    Icon: EmojiEventsIcon,
    accent: "#facc15",
    text: "#422006",
    bg:
      "linear-gradient(135deg, rgba(255,247,173,0.98), rgba(250,204,21,0.92), rgba(245,158,11,0.94))",
    glow: "rgba(250,204,21,0.38)",
  },
  silver: {
    label: "Hạng nhì",
    action: "đạt hạng nhì tại giải",
    Icon: WorkspacePremiumIcon,
    accent: "#cbd5e1",
    text: "#102033",
    bg:
      "linear-gradient(135deg, rgba(248,250,252,0.98), rgba(203,213,225,0.9), rgba(148,163,184,0.88))",
    glow: "rgba(203,213,225,0.34)",
  },
  bronze: {
    label: "Đồng hạng ba",
    action: "đồng hạng ba tại giải",
    Icon: MilitaryTechIcon,
    accent: "#fb923c",
    text: "#fff7ed",
    bg:
      "linear-gradient(135deg, rgba(120,53,15,0.98), rgba(180,83,9,0.95), rgba(249,115,22,0.9))",
    glow: "rgba(251,146,60,0.34)",
  },
};

function PodiumCelebrationMarquee({ items = [] }) {
  const base = useMemo(
    () =>
      (Array.isArray(items) ? items : []).filter(
        (item) => item?.teamLabel && item?.tournamentName && item?.medal,
      ),
    [items],
  );
  const group = useMemo(() => {
    if (!base.length) return [];
    const repeat = Math.max(2, Math.ceil(8 / base.length));
    return Array.from({ length: repeat }, () => base).flat();
  }, [base]);

  if (!base.length) return null;

  const duration = Math.max(24, group.length * 5);

  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        py: 1.5,
        mt: -1,
        mb: 1.5,
        background:
          "linear-gradient(90deg, rgba(7,14,28,0), rgba(30,41,59,0.38), rgba(7,14,28,0))",
        "&:hover ._podiumTrack": { animationPlayState: "paused" },
        "@media (prefers-reduced-motion: reduce)": {
          "& ._podiumTrack": { animation: "none" },
        },
      }}
    >
      <Box
        sx={(theme) => ({
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          zIndex: 2,
          background: `linear-gradient(90deg, ${theme.palette.background.default} 0%, rgba(0,0,0,0) 12%, rgba(0,0,0,0) 88%, ${theme.palette.background.default} 100%)`,
        })}
      />
      <Box
        className="_podiumTrack"
        sx={{
          display: "flex",
          alignItems: "center",
          width: "max-content",
          animation: `podiumAnnouncementScroll ${duration}s linear infinite`,
          willChange: "transform",
        }}
      >
        {[...group, ...group].map((item, idx) => (
          <PodiumCelebrationItem
            key={`${item.id || item.teamLabel}-${idx}`}
            item={item}
          />
        ))}
      </Box>
    </Box>
  );
}

function PodiumCelebrationItem({ item }) {
  const meta = podiumAnnouncementMeta[item?.medal] || podiumAnnouncementMeta.gold;
  const Icon = meta.Icon;
  const href = item?.href || `/tournament/${item?.tournamentId || ""}/bracket`;

  return (
    <Tooltip
      title={`${item.teamLabel} ${meta.action} ${item.tournamentName}`}
      arrow
      placement="top"
    >
      <Box
        component={Link}
        to={href}
        sx={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 1.1,
          mx: 1,
          px: 1.5,
          py: 0.9,
          minHeight: 52,
          maxWidth: { xs: 360, md: 520 },
          borderRadius: 2,
          color: "text.primary",
          textDecoration: "none",
          border: "1px solid rgba(255,255,255,0.12)",
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.86), rgba(30,41,59,0.72))",
          boxShadow: `0 0 28px ${meta.glow}, inset 0 1px 0 rgba(255,255,255,0.08)`,
          backdropFilter: "blur(14px) saturate(150%)",
          overflow: "hidden",
          transition: "transform 160ms ease, border-color 160ms ease",
          "&:hover": {
            transform: "translateY(-2px)",
            borderColor: meta.accent,
          },
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(110deg, transparent 12%, rgba(255,255,255,0.14), transparent 36%)",
            animation: "podiumAnnouncementSheen 3.2s ease-in-out infinite",
            pointerEvents: "none",
          },
        }}
      >
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            flex: "0 0 auto",
            borderRadius: "50%",
            color: meta.text,
            background: meta.bg,
            boxShadow: `0 0 18px ${meta.glow}`,
            animation: "podiumAnnouncementPulse 1.8s ease-in-out infinite",
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ position: "relative", zIndex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: meta.accent,
              fontWeight: 800,
              lineHeight: 1.1,
              textTransform: "uppercase",
            }}
          >
            Chúc mừng {meta.label}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "#fff",
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: { xs: 270, md: 430 },
            }}
          >
            {item.teamLabel} {meta.action} {item.tournamentName}
          </Typography>
        </Box>
      </Box>
    </Tooltip>
  );
}

const parsePageFromParams = (sp) => {
  const raw = sp.get("page");
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
};
const parseKeywordFromParams = (sp) => sp.get("q") ?? "";
const parseScoreStatusFromParams = (sp) => {
  const raw = String(sp.get("scoreStatus") || "").trim();
  return RANKING_SCORE_FILTER_VALUES.has(raw) ? raw : "";
};

/* ================= Flame Effects ================= */
const FLAME = {
  gold: ["#fff8b0", "#ffd54f", "#ffb300", "#ffd54f", "#fff8b0"],
  silver: ["#eceff1", "#cfd8dc", "#b0bec5", "#cfd8dc", "#eceff1"],
  bronze: ["#ffe0b2", "#ffb74d", "#d2691e", "#ffb74d", "#ffe0b2"],
};
const flameGradient = (arr) => `conic-gradient(from 0deg, ${arr.join(",")})`;

const flameRingSx = (type = "gold") => ({
  position: "relative",
  display: "inline-block",
  borderRadius: "50%",
  "&::before": {
    content: '""',
    position: "absolute",
    inset: "-3px",
    padding: "3px",
    borderRadius: "50%",
    background: flameGradient(FLAME[type] || FLAME.gold),
    WebkitMask:
      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
    filter: "blur(0.5px)",
    animation: "flameFlicker 1.6s ease-in-out infinite alternate",
    transformOrigin: "center",
  },
  "&::after": {
    content: '""',
    position: "absolute",
    inset: "-6px",
    borderRadius: "50%",
    boxShadow:
      type === "gold"
        ? "0 0 18px rgba(255, 179, 0, .35)"
        : type === "silver"
          ? "0 0 18px rgba(120, 144, 156, .35)"
          : "0 0 18px rgba(255, 112, 67, .35)",
    pointerEvents: "none",
    animation: "glowFlicker 1.8s ease-in-out infinite alternate",
  },
  "@media (prefers-reduced-motion: reduce)": {
    "&::before,&::after": { animation: "none" },
  },
});

const flameCardSx = (type = "gold") => ({
  position: "relative",
  overflow: "hidden",
  borderRadius: 6,
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 0,
    padding: "2px",
    borderRadius: 6,
    background: flameGradient(FLAME[type] || FLAME.gold),
    WebkitMask:
      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
    filter: "blur(0.4px)",
    animation: "flameFlicker 1.6s ease-in-out infinite alternate",
    zIndex: 0,
    transformOrigin: "center",
  },
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    borderRadius: 6,
    boxShadow:
      type === "gold"
        ? "0 0 12px rgba(255,179,0,.18)"
        : type === "silver"
          ? "0 0 12px rgba(120,144,156,.18)"
          : "0 0 12px rgba(255,112,67,.18)",
    zIndex: 0,
    pointerEvents: "none",
    animation: "glowFlicker 1.8s ease-in-out infinite alternate",
  },
  "& .MuiCardContent-root": { position: "relative", zIndex: 1 },
  "@media (prefers-reduced-motion: reduce)": {
    "&::before,&::after": { animation: "none" },
  },
});

const medalLabel = (m, t) =>
  m === "gold"
    ? t("rankings.medals.champion")
    : m === "silver"
      ? t("rankings.medals.runnerUp")
      : m === "bronze"
        ? t("rankings.medals.bronze")
        : "";

const medalChipStyle = (medal, maxWidth = 280) => ({
  maxWidth,
  "& .MuiChip-label": {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  borderColor:
    medal === "gold" ? "#ffb300" : medal === "silver" ? "#90a4ae" : "#ff8a65",
  color:
    medal === "gold" ? "#ff8f00" : medal === "silver" ? "#607d8b" : "#e65100",
});

const medalChipStyleFull = (medal, maxWidth = "100%") => ({
  maxWidth,
  alignSelf: "flex-start",
  "& .MuiChip-label": {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: 1.4,
    paddingTop: "2px",
    paddingBottom: "2px",
  },
  borderColor:
    medal === "gold" ? "#ffb300" : medal === "silver" ? "#90a4ae" : "#ff8a65",
  color:
    medal === "gold" ? "#ff8f00" : medal === "silver" ? "#607d8b" : "#e65100",
});

/* ================= Memoized Desktop Card Component ================= */
const DesktopCard = memo(
  ({
    r,
    me,
    cccdPatch,
    patchMap,
    topMedalByUser,
    labelFullByUser,
    hrefByUser,
    onOpenProfile,
    onOpenGrade,
    onOpenKyc,
    onOpenAchievements,
    onZoomAvatar,
    staggerDelay,
    locale,
    t,
  }) => {
    const u = useMemo(() => r?.user || {}, [r?.user]);
    const effectiveStatus = (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
    const badge = useMemo(
      () => cccdBadge(effectiveStatus, t),
      [effectiveStatus, t],
    );
    const avatarSrc =
      u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
    const tierHex = getScoreHex(r);
    const age = useMemo(() => calcAge(u), [u]);
    const canGrade = useMemo(
      () => canGradeUser(me, u?.province),
      [me, u?.province],
    );

    const patched = useMemo(() => {
      const p = patchMap[u?._id || ""] || {};
      return {
        single: p?.single ?? r?.single,
        double: p?.double ?? r?.double,
        updatedAt: p?.updatedAt ?? r?.updatedAt,
      };
    }, [patchMap, u?._id, r]);

    const allowKyc = useMemo(
      () => canViewKycAdmin(me, effectiveStatus),
      [me, effectiveStatus],
    );

    const uid = u?._id && String(u._id);
    const topMedal = uid ? topMedalByUser.get(uid) : null;
    const achievementRanking = useMemo(
      () => ({
        ...r,
        single: patched.single,
        double: patched.double,
        updatedAt: patched.updatedAt,
      }),
      [r, patched.double, patched.single, patched.updatedAt],
    );
    const achievements = useMemo(
      () =>
        buildRankingAchievements({
          r: achievementRanking,
          u,
          age,
          effectiveStatus,
        }),
      [achievementRanking, age, effectiveStatus, u],
    );
    const openAchievements = useCallback(() => {
      onOpenAchievements?.(u, achievements);
    }, [achievements, onOpenAchievements, u]);
    const showChampionCrown =
      Number(r?.globalRank) === 1 || hasTopOneAchievement(achievements);

    return (
      <Fade in timeout={500} style={{ transitionDelay: `${staggerDelay}ms` }}>
        <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Card
            variant="outlined"
            sx={{
              ...(topMedal ? flameCardSx(topMedal) : { borderRadius: 6 }),
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardContent
              sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}
            >
              <Box display="flex" alignItems="center" mb={1.5} gap={2}>
                <LazyAvatar
                  src={avatarSrc}
                  alt={u?.nickname || "?"}
                  onClick={() => onZoomAvatar(avatarSrc)}
                  size={44}
                  flameEffect={topMedal ? flameRingSx(topMedal) : null}
                  showCrown={showChampionCrown}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography fontWeight={700} noWrap>
                    {u?.nickname || "---"}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    mt={0.5}
                  >
                    {Number.isFinite(age) && (
                      <Chip
                        size="small"
                        label={t("rankings.labels.age", { value: age })}
                      />
                    )}
                    <Chip label={badge.text} size="small" color={badge.color} />
                  </Stack>
                </Box>
              </Box>

              <Box
                sx={{
                  mb: 1,
                  display: "flex",
                  alignItems: "flex-start",
                  minHeight: 28,
                }}
              >
                {topMedal && (
                  <Tooltip
                    title={labelFullByUser.get(uid) || ""}
                    arrow
                    placement="top"
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      clickable
                      component={Link}
                      to={hrefByUser.get(uid) || "/tournaments"}
                      label={labelFullByUser.get(uid)}
                      sx={medalChipStyleFull(topMedal, 260)}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  </Tooltip>
                )}
              </Box>

              {achievements.length > 0 && (
                <Box sx={{ mb: 1 }}>
                  <AchievementSummary
                    achievements={achievements}
                    onOpen={openAchievements}
                  />
                </Box>
              )}

              <Stack
                direction="row"
                flexWrap="wrap"
                useFlexGap
                sx={{ columnGap: 1, rowGap: 1, mb: 1 }}
              >
                <Chip
                  size="small"
                  label={t("rankings.labels.gender", {
                    value: genderLabel(u?.gender, t),
                  })}
                />
                <Chip
                  size="small"
                  label={t("rankings.labels.province", {
                    value: u?.province || "--",
                  })}
                />
              </Stack>

              <Divider sx={{ mb: 1.25 }} />

              <Stack
                direction="row"
                spacing={2}
                mb={0.5}
                sx={{ "& .score": { color: tierHex, fontWeight: 700 } }}
              >
                <Typography variant="body2" className="score">
                  {t("rankings.labels.doubles", {
                    value: fmt3(patched.double),
                  })}
                </Typography>
                <Typography variant="body2" className="score">
                  {t("rankings.labels.singles", {
                    value: fmt3(patched.single),
                  })}
                </Typography>
              </Stack>

              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("rankings.labels.updatedAt", {
                  value: patched?.updatedAt
                    ? formatDate(patched.updatedAt, locale)
                    : "--",
                })}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                {t("common.updatedAt", {
                  date: u?.createdAt ? formatDate(u.createdAt, locale) : "--",
                })}
              </Typography>

              <Stack direction="row" spacing={1} mt="auto">
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => onOpenProfile(u?._id)}
                >
                  {t("rankings.actions.profile")}
                </Button>
                {canGrade && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => onOpenGrade(u, r)}
                  >
                    {t("rankings.actions.grade")}
                  </Button>
                )}
                {allowKyc && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => onOpenKyc(u)}
                  >
                    {t("rankings.actions.viewKyc")}
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Fade>
    );
  },
);

DesktopCard.displayName = "DesktopCard";

/* ================= Main Component ================= */
export default function RankingList() {
  const dispatch = useDispatch();
  const { locale, t } = useLanguage();
  const { keyword, page } = useSelector((s) => s?.rankingUi || {});
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const [desktopView, setDesktopView] = useState(() => {
    try {
      const cached = localStorage.getItem(VIEW_KEY);
      if (cached === "cards" || cached === "list") return cached;
    } catch (e) {
      console.log(e);
    }
    return "cards";
  });

  const [searchInput, setSearchInput] = useState(keyword || "");
  const scoreStatus = useMemo(
    () => parseScoreStatusFromParams(searchParams),
    [searchParams],
  );

  /**
   * ✅ 2 API mới:
   * - list API: docs + totalPages
   * - podium API: podiums30d
   */
  const {
    data: listData,
    isLoading: isLoadingList,
    isFetching: isFetchingList,
    error: errorList,
  } = useGetRankingsListQuery({ keyword, page, scoreStatus });

  const { data: podiumData, isFetching: isFetchingPod } =
    useGetRankingsPodiums30dQuery();
  const { data: podiumAnnouncementData } =
    useGetRankingsPodiumAnnouncementsQuery({ days: 7, limit: 36 });

  const list = useMemo(() => listData?.docs || [], [listData?.docs]);
  const totalPages = listData?.totalPages || 0;

  // podiumData có thể là { podiums30d: {...} } hoặc trực tiếp {...}
  const podiums30d = useMemo(
    () => podiumData?.podiums30d || podiumData || {},
    [podiumData],
  );
  const podiumAnnouncementItems = useMemo(
    () =>
      Array.isArray(podiumAnnouncementData?.items)
        ? podiumAnnouncementData.items
        : [],
    [podiumAnnouncementData],
  );

  const theme = useTheme();
  const isMobile = useMediaQuery(theme?.breakpoints?.down("sm"));
  const isDesktop = useMediaQuery(theme?.breakpoints?.up("md"));
  const DRAWER_WIDTH_DESKTOP = 380;

  const desktopCards = !isMobile && desktopView === "cards";

  // gộp loading/fetching/error phù hợp
  const isLoading = isLoadingList; // list là chính
  const isFetching = isFetchingList || isFetchingPod; // podium fetch cũng hiện progress
  const error = errorList || null; // ưu tiên lỗi list; podium lỗi thì bỏ qua UI podium thôi
  const showSkeleton = isLoadingList || isFetchingList; // skeleton theo list

  const token = useSelector(
    (s) =>
      s?.auth?.userInfo?.token ??
      s?.userLogin?.userInfo?.token ??
      s?.user?.token ??
      null,
  );

  const { data: meData, isLoading: loading } = useGetMeQuery(
    token ? undefined : skipToken,
    {
      refetchOnFocus: false,
      refetchOnReconnect: false,
      refetchOnMountOrArgChange: false,
    },
  );
  const me = meData || null;
  const canSelfAssess = false;

  // Scroll to top with smooth behavior
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  const urlPage = useMemo(
    () => parsePageFromParams(searchParams),
    [searchParams],
  );
  const urlKeyword = useMemo(
    () => parseKeywordFromParams(searchParams),
    [searchParams],
  );

  useLayoutEffect(() => {
    const nextKeyword = urlKeyword || "";
    const keywordChanged = nextKeyword !== (keyword || "");
    const pageChanged = urlPage !== page;

    if (keywordChanged) dispatch(setKeyword(nextKeyword));
    if (pageChanged) dispatch(setPage(urlPage));
    if ((urlKeyword || "") !== (searchInput || ""))
      setSearchInput(urlKeyword || "");

    const v = searchParams.get("view");
    if (v === "cards" || v === "list") {
      if (v !== desktopView) setDesktopView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch (e) {
        console.log(e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPage, urlKeyword, searchParams]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if ((searchInput || "") !== (keyword || "")) {
        dispatch(setKeyword(searchInput || ""));
        dispatch(setPage(0));
        const next = new URLSearchParams(searchParams);
        if (searchInput) next.set("q", searchInput);
        else next.delete("q");
        next.delete("page");
        setSearchParams(next);
      }
    }, 400);
    return () => clearTimeout(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const doImmediateSearch = useCallback(() => {
    if ((searchInput || "") === (keyword || "")) return;
    dispatch(setKeyword(searchInput || ""));
    dispatch(setPage(0));
    const next = new URLSearchParams(searchParams);
    if (searchInput) next.set("q", searchInput);
    else next.delete("q");
    next.delete("page");
    setSearchParams(next);
  }, [searchInput, keyword, dispatch, searchParams, setSearchParams]);

  const handleInputKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doImmediateSearch();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (searchInput) setSearchInput("");
      }
    },
    [doImmediateSearch, searchInput],
  );

  const handleClear = useCallback(() => {
    if (!searchInput && !keyword) return;
    setSearchInput("");
    dispatch(setKeyword(""));
    dispatch(setPage(0));
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    next.delete("page");
    setSearchParams(next);
  }, [searchInput, keyword, dispatch, searchParams, setSearchParams]);

  const handlePageChange = useCallback(
    (_event, nextPageNumber) => {
      const nextPage = Math.max(0, Number(nextPageNumber || 1) - 1);
      dispatch(setPage(nextPage));

      const nextParams = new URLSearchParams(searchParams);
      if (nextPage > 0) nextParams.set("page", String(nextPage + 1));
      else nextParams.delete("page");
      setSearchParams(nextParams);
    },
    [dispatch, searchParams, setSearchParams],
  );

  const handleScoreStatusChange = useCallback(
    (nextStatus) => {
      const nextParams = new URLSearchParams(searchParams);
      if (scoreStatus === nextStatus) nextParams.delete("scoreStatus");
      else nextParams.set("scoreStatus", nextStatus);
      nextParams.delete("page");
      dispatch(setPage(0));
      setSearchParams(nextParams);
    },
    [dispatch, scoreStatus, searchParams, setSearchParams],
  );

  const [openProfile, setOpenProfile] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  const handleOpenProfile = useCallback((id) => {
    setSelectedId(id);
    setOpenProfile(true);
  }, []);

  const handleCloseProfile = useCallback(() => setOpenProfile(false), []);

  const [zoomSrc, setZoomSrc] = useState("");
  const [zoomOpen, setZoomOpen] = useState(false);

  const openZoom = useCallback((src) => {
    setZoomSrc(src || PLACE);
    setZoomOpen(true);
  }, []);

  const closeZoom = useCallback(() => setZoomOpen(false), []);

  const [gradeDlg, setGradeDlg] = useState({
    open: false,
    userId: null,
    nickname: "",
    province: "",
  });
  const [gradeSingles, setGradeSingles] = useState("");
  const [gradeDoubles, setGradeDoubles] = useState("");
  const [gradeNotes, setGradeNotes] = useState("");
  const [createEvaluation, { isLoading: creating }] =
    useCreateEvaluationMutation();
  const [gradeHistoryDlg, setGradeHistoryDlg] = useState({
    open: false,
    userId: null,
    nickname: "",
  });
  const {
    data: gradeHistoryData,
    isFetching: fetchingGradeHistory,
    isError: gradeHistoryError,
    refetch: refetchGradeHistory,
  } = useGetRatingHistoryQuery(
    gradeHistoryDlg.open && gradeHistoryDlg.userId
      ? { id: gradeHistoryDlg.userId, page: 1, limit: 30 }
      : skipToken,
    { refetchOnMountOrArgChange: true },
  );
  const gradeHistoryRows = Array.isArray(gradeHistoryData?.history)
    ? gradeHistoryData.history
    : [];

  const [snack, setSnack] = useState({ open: false, type: "success", msg: "" });
  const showSnack = useCallback(
    (type, msg) => setSnack({ open: true, type, msg }),
    [],
  );

  const [patchMap, setPatchMap] = useState({});
  const [cccdPatch, setCccdPatch] = useState({});

  const openGrade = useCallback(
    (u, r) => {
      const p = patchMap[u?._id || ""] || {};
      const base = {
        single:
          p?.single ??
          r?.single ??
          numOrUndef(u?.localRatings?.singles) ??
          numOrUndef(u?.ratingSingle),
        double:
          p?.double ??
          r?.double ??
          numOrUndef(u?.localRatings?.doubles) ??
          numOrUndef(u?.ratingDouble),
      };
      setGradeDlg({
        open: true,
        userId: u?._id,
        nickname: u?.nickname || "--",
        province: u?.province || "",
      });
      setGradeSingles(
        Number.isFinite(base.single)
          ? String(Number(base.single).toFixed(2))
          : "",
      );
      setGradeDoubles(
        Number.isFinite(base.double)
          ? String(Number(base.double).toFixed(2))
          : "",
      );
      setGradeNotes("");
    },
    [patchMap],
  );

  const openGradeHistory = useCallback(() => {
    if (!gradeDlg.userId) return;
    setGradeHistoryDlg({
      open: true,
      userId: gradeDlg.userId,
      nickname: gradeDlg.nickname || "--",
    });
  }, [gradeDlg.nickname, gradeDlg.userId]);

  const closeGradeHistory = useCallback(() => {
    setGradeHistoryDlg({ open: false, userId: null, nickname: "" });
  }, []);

  const submitGrade = async () => {
    try {
      const singles =
        gradeSingles === "" ? undefined : Number.parseFloat(gradeSingles);
      const doubles =
        gradeDoubles === "" ? undefined : Number.parseFloat(gradeDoubles);
      const inRange = (v) =>
        v === undefined || (v >= MIN_RATING && v <= MAX_RATING);
      if (!inRange(singles) || !inRange(doubles)) {
        showSnack(
          "error",
          t("rankings.feedback.invalidRange", {
            min: MIN_RATING,
            max: MAX_RATING,
          }),
        );
        return;
      }
      if (!gradeDlg.userId) {
        showSnack("error", t("rankings.feedback.missingTarget"));
        return;
      }

      const resp = await createEvaluation({
        targetUser: gradeDlg.userId,
        province: gradeDlg.province,
        source: "live",
        overall: { singles, doubles },
        notes: gradeNotes?.trim() || undefined,
      }).unwrap();

      const newSingle =
        resp?.ranking?.single ?? (singles !== undefined ? singles : undefined);
      const newDouble =
        resp?.ranking?.double ?? (doubles !== undefined ? doubles : undefined);
      const newUpdatedAt =
        resp?.ranking?.lastUpdated ?? new Date().toISOString();

      setPatchMap((m) => ({
        ...m,
        [gradeDlg.userId]: {
          single:
            newSingle !== undefined ? newSingle : m?.[gradeDlg.userId]?.single,
          double:
            newDouble !== undefined ? newDouble : m?.[gradeDlg.userId]?.double,
          updatedAt: newUpdatedAt,
        },
      }));

      if (
        openProfile &&
        selectedId &&
        String(selectedId) === String(gradeDlg.userId)
      ) {
        setProfileRefreshKey((k) => k + 1);
      }

      showSnack("success", t("rankings.feedback.submitSuccess"));
      if (
        gradeHistoryDlg.open &&
        String(gradeHistoryDlg.userId) === String(gradeDlg.userId)
      ) {
        refetchGradeHistory?.();
      }
      setGradeDlg({ open: false, userId: null, nickname: "", province: "" });
    } catch (err) {
      showSnack(
        "error",
        err?.data?.message || err?.error || t("rankings.feedback.submitFailed"),
      );
    }
  };

  const [kycView, setKycView] = useState(null);
  const [reviewKycMut, { isLoading: reviewing }] = useReviewKycMutation();

  const openKyc = useCallback((u) => setKycView(u || null), []);
  const closeKyc = useCallback(() => setKycView(null), []);
  const [achievementDlg, setAchievementDlg] = useState({
    open: false,
    user: null,
    achievements: [],
  });
  const openAchievementDialog = useCallback((user, achievements) => {
    setAchievementDlg({
      open: true,
      user: user || null,
      achievements: Array.isArray(achievements) ? achievements : [],
    });
  }, []);
  const closeAchievementDialog = useCallback(() => {
    setAchievementDlg({ open: false, user: null, achievements: [] });
  }, []);

  const doReview = async (action) => {
    if (!kycView?._id) return;
    try {
      await reviewKycMut({ id: kycView._id, action }).unwrap();
      const nextStatus = action === "approve" ? "verified" : "rejected";
      setCccdPatch((m) => ({ ...m, [kycView._id]: nextStatus }));
      setKycView((v) => (v ? { ...v, cccdStatus: nextStatus } : v));
      showSnack(
        "success",
        action === "approve"
          ? t("rankings.feedback.kycReviewed")
          : t("rankings.feedback.kycRejected"),
      );
    } catch (err) {
      showSnack(
        "error",
        err?.data?.message || err?.error || t("rankings.feedback.kycFailed"),
      );
    }
  };

  const { topMedalByUser, labelShortByUser, labelFullByUser, hrefByUser } =
    useMemo(() => {
      const rank = { gold: 3, silver: 2, bronze: 1 };

      const topMap = new Map();
      const shortMap = new Map();
      const fullMap = new Map();
      const hrefMap = new Map();

      const entries = Object.entries(podiums30d || {});

      const getHref = (t) => {
        const id =
          t?.tournamentId ||
          t?.tournament?._id ||
          t?.tournament?.id ||
          t?.tid ||
          t?.id;
        const slug = t?.tournamentSlug || t?.slug;
        if (id) return `/tournament/${id}/bracket`;
        if (slug) return `/tournament/${slug}/bracket`;
        const name = t?.tournamentName || t?.name;
        return name
          ? `/tournament?query=${encodeURIComponent(name)}/bracket`
          : "/tournament";
      };

      for (const [uid, arr] of entries) {
        if (!Array.isArray(arr) || arr.length === 0) continue;

        const picked = [...arr].sort((a, b) => {
          const r = (rank[b.medal] || 0) - (rank[a.medal] || 0);
          if (r !== 0) return r;
          const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
          const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
          return tb - ta;
        })[0];

        const plusN = Math.max(0, arr.length - 1);
        const medalText = medalLabel(picked.medal, t);
        const tourName =
          picked.tournamentName ||
          picked.name ||
          t("rankings.labels.tournamentFallback");
        const fullTitle = `${medalText} – ${tourName}${
          plusN > 0 ? t("rankings.labels.plusEvents", { count: plusN }) : ""
        }`;

        topMap.set(String(uid), picked.medal);
        shortMap.set(String(uid), medalText);
        fullMap.set(String(uid), fullTitle);
        hrefMap.set(String(uid), getHref(picked));
      }

      return {
        topMedalByUser: topMap,
        labelShortByUser: shortMap,
        labelFullByUser: fullMap,
        hrefByUser: hrefMap,
      };
    }, [podiums30d, t]);

  const handleChangeDesktopView = useCallback(
    (_, next) => {
      if (!next) return;
      setDesktopView(next);
      const nextParams = new URLSearchParams(searchParams);
      if (next === "list") nextParams.delete("view");
      else nextParams.set("view", next);
      setSearchParams(nextParams);
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch (e) {
        console.log(e);
      }
    },
    [searchParams, setSearchParams],
  );

  const rankingHighlights = useMemo(
    () =>
      list
        .slice(0, 4)
        .map((item) => item?.user?.nickname || item?.user?.name || item?.nickname || "")
        .filter(Boolean),
    [list],
  );

  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "leaderboard",
      pageSection: "leaderboard",
      pageView: desktopCards ? "cards" : "list",
      entityTitle: t("rankings.title"),
      sectionTitle: t("rankings.title"),
      pageSummary: t("rankings.seoDescription"),
      activeLabels: [
        desktopCards ? t("rankings.viewModes.cards") : t("rankings.viewModes.list"),
        searchInput ? `Tìm: ${searchInput}` : "",
        isFetching ? "Đang tải dữ liệu xếp hạng" : "",
      ],
      visibleActions: [
        t("rankings.searchLabel"),
        t("rankings.actions.profile"),
        t("rankings.actions.grade"),
        t("rankings.actions.viewKyc"),
        canSelfAssess ? t("rankings.selfAssess") : "",
      ],
      highlights: rankingHighlights,
      metrics: [
        `Hiển thị: ${list.length}`,
        `Trang: ${page + 1}/${Math.max(totalPages, 1)}`,
        isMobile ? "Chế độ mobile" : "Chế độ desktop",
      ],
      stats: {
        visible: list.length,
        page: page + 1,
        totalPages,
        keyword: searchInput || keyword || "",
        view: desktopCards ? "cards" : "list",
      },
    }),
    [
      canSelfAssess,
      desktopCards,
      isFetching,
      isMobile,
      keyword,
      list.length,
      page,
      rankingHighlights,
      searchInput,
      t,
      totalPages,
    ],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      search: (nextValue) => {
        const nextQuery = String(nextValue || "");
        setSearchInput(nextQuery);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
          searchInputRef.current?.scrollIntoView?.({
            behavior: "smooth",
            block: "center",
          });
        });
      },
      focusSearch: () => {
        searchInputRef.current?.focus?.();
        searchInputRef.current?.scrollIntoView?.({
          behavior: "smooth",
          block: "center",
        });
      },
      view: (nextValue) => {
        const nextView = String(nextValue || "") === "cards" ? "cards" : "list";
        handleChangeDesktopView(null, nextView);
      },
    }),
    [handleChangeDesktopView],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: ["set_page_state", "prefill_text", "focus_element", "navigate"],
    actionHandlers: chatBotActionHandlers,
  });

  return (
    <>
      <SEOHead
        title={t("rankings.seoTitle")}
        description={t("rankings.seoDescription")}
        keywords={t("rankings.seoKeywords")}
        path="/rankings"
      />
      <SponsorMarquee variant="glass" height={80} gap={24} />
      <PodiumCelebrationMarquee items={podiumAnnouncementItems} />

      {isFetching && !isLoading && (
        <Box
          sx={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999 }}
        >
          <LinearProgress />
        </Box>
      )}

      <Container maxWidth="xl" sx={{ py: 3 }} ref={containerRef}>
        <GlobalStyles
          styles={{
            "@keyframes flameFlicker": {
              "0%": { opacity: 0.85, filter: "blur(0.8px) brightness(1)" },
              "35%": { opacity: 1.0, filter: "blur(0.6px) brightness(1.05)" },
              "60%": { opacity: 0.92, filter: "blur(0.7px) brightness(0.98)" },
              "100%": { opacity: 1.0, filter: "blur(0.5px) brightness(1.08)" },
            },
            "@keyframes glowFlicker": {
              "0%": { opacity: 0.45, transform: "scale(1)" },
              "100%": { opacity: 0.75, transform: "scale(1.01)" },
            },
            "@keyframes achievementFlare": {
              "0%": { transform: "translateX(-120%) skewX(-18deg)" },
              "100%": { transform: "translateX(120%) skewX(-18deg)" },
            },
            "@keyframes achievementSnow": {
              "0%": { backgroundPosition: "0 0, 0 0", opacity: 0.22 },
              "50%": { opacity: 0.5 },
              "100%": {
                backgroundPosition: "0 18px, 8px 14px",
                opacity: 0.22,
              },
            },
            "@keyframes achievementMystic": {
              "0%": { transform: "translateX(-120%)", opacity: 0 },
              "45%": { opacity: 0.65 },
              "100%": { transform: "translateX(120%)", opacity: 0 },
            },
            "@keyframes achievementSpark": {
              "0%": { transform: "translateX(-110%)", opacity: 0.18 },
              "50%": { opacity: 0.8 },
              "100%": { transform: "translateX(110%)", opacity: 0.22 },
            },
            "@keyframes achievementPulse": {
              "0%": { opacity: 0.2, transform: "scale(0.96)" },
              "100%": { opacity: 0.72, transform: "scale(1.02)" },
            },
            "@keyframes championCrownFloat": {
              "0%": {
                transform: "rotate(-17deg) translateY(0)",
                filter:
                  "drop-shadow(0 2px 2px rgba(69,26,3,0.45)) drop-shadow(0 0 6px rgba(250,204,21,0.65))",
              },
              "100%": {
                transform: "rotate(-13deg) translateY(-1.5px)",
                filter:
                  "drop-shadow(0 2px 2px rgba(69,26,3,0.45)) drop-shadow(0 0 11px rgba(250,204,21,0.9))",
              },
            },
            "@keyframes podiumAnnouncementScroll": {
              "0%": { transform: "translateX(0)" },
              "100%": { transform: "translateX(-50%)" },
            },
            "@keyframes podiumAnnouncementSheen": {
              "0%": { transform: "translateX(-120%)" },
              "55%": { transform: "translateX(120%)" },
              "100%": { transform: "translateX(120%)" },
            },
            "@keyframes podiumAnnouncementPulse": {
              "0%,100%": {
                transform: "scale(1)",
                filter: "brightness(1)",
              },
              "50%": {
                transform: "scale(1.06)",
                filter: "brightness(1.12)",
              },
            },
            "@media (prefers-reduced-motion: reduce)": {
              ".MuiChip-root::before,.MuiChip-root::after": {
                animation: "none !important",
              },
              "svg[aria-hidden='true']": {
                animation: "none !important",
              },
              "._podiumTrack, ._podiumTrack *": {
                animation: "none !important",
              },
            },
          }}
        />

        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={2}
          gap={1}
        >
          <Typography variant="h5" fontWeight={600}>
            {t("rankings.title")}
          </Typography>

          <Stack direction="row" alignItems="center" spacing={1}>
            {!isMobile && (
              <ToggleButtonGroup
                size="small"
                value={desktopView}
                exclusive
                onChange={handleChangeDesktopView}
                aria-label={t("rankings.viewModes.desktop")}
                disabled={isFetching}
              >
                <ToggleButton
                  value="list"
                  aria-label={t("rankings.viewModes.list")}
                >
                  <Tooltip
                    title={t("rankings.viewModes.listTooltip")}
                    arrow
                    enterDelay={500}
                  >
                    <Box component="span" sx={{ display: "flex" }}>
                      <TableRowsIcon fontSize="small" />
                    </Box>
                  </Tooltip>
                </ToggleButton>

                <ToggleButton
                  value="cards"
                  aria-label={t("rankings.viewModes.cards")}
                >
                  <Tooltip
                    title={t("rankings.viewModes.cardsTooltip")}
                    arrow
                    enterDelay={500}
                  >
                    <Box component="span" sx={{ display: "flex" }}>
                      <GridViewIcon fontSize="small" />
                    </Box>
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>
            )}

            {loading === false && canSelfAssess && (
              <Button
                component={Link}
                to="/levelpoint"
                variant="contained"
                size="small"
              >
                {t("rankings.selfAssess")}
              </Button>
            )}
          </Stack>
        </Box>

        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          sx={{ columnGap: 1.5, rowGap: 1, mb: 2 }}
        >
          {RANKING_SCORE_FILTERS.map((item) => {
            const active = scoreStatus === item.value;
            return (
              <Chip
                key={item.value}
                label={item.label}
                clickable
                onClick={() => handleScoreStatusChange(item.value)}
                aria-pressed={active}
                sx={{
                  bgcolor: item.bg,
                  color: item.color,
                  border: active
                    ? "2px solid rgba(255,255,255,0.9)"
                    : "2px solid transparent",
                  boxShadow: active
                    ? "0 0 0 2px rgba(25,118,210,0.25)"
                    : "none",
                  opacity: !scoreStatus || active ? 1 : 0.72,
                  "&:hover": {
                    bgcolor: item.bg,
                    opacity: 1,
                  },
                }}
              />
            );
          })}
        </Stack>

        <TextField
          label={t("rankings.searchLabel")}
          variant="outlined"
          size="small"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          sx={{ mb: 2, width: 320 }}
          inputProps={{ maxLength: 120 }}
          inputRef={searchInputRef}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: (searchInput || keyword) && (
              <InputAdornment position="end">
                <IconButton
                  aria-label="clear"
                  onClick={handleClear}
                  edge="end"
                  size="small"
                  disabled={isFetching}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          placeholder={t("rankings.searchPlaceholder")}
        />

        {error ? (
          <Alert severity="error">{error?.data?.message || error?.error}</Alert>
        ) : showSkeleton ? (
          isMobile ? (
            <Stack spacing={2}>
              {Array.from({ length: SKELETON_CARDS_MOBILE }).map((_, i) => (
                <Card key={i} variant="outlined">
                  <CardContent>
                    <Box display="flex" alignItems="center" mb={1} gap={2}>
                      <Skeleton variant="circular" width={40} height={40} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Skeleton variant="text" width="40%" />
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Skeleton variant="rounded" width={64} height={24} />
                        <Skeleton variant="rounded" width={90} height={24} />
                      </Stack>
                    </Box>
                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      useFlexGap
                      sx={{ columnGap: 1, rowGap: 1, mb: 1 }}
                    >
                      <Skeleton variant="rounded" width={140} height={24} />
                      <Skeleton variant="rounded" width={160} height={24} />
                    </Stack>
                    <Divider sx={{ mb: 1 }} />
                    <Stack direction="row" spacing={2} mb={0.5}>
                      <Skeleton variant="text" width={100} />
                      <Skeleton variant="text" width={100} />
                    </Stack>
                    <Skeleton variant="text" width={180} />
                    <Skeleton variant="text" width={200} />
                    <Stack direction="row" spacing={1} mt={2}>
                      <Skeleton variant="rounded" width={80} height={32} />
                      <Skeleton variant="rounded" width={100} height={32} />
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          ) : desktopCards ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, minmax(0, 1fr))",
                  md: "repeat(3, minmax(0, 1fr))",
                },
                gap: 2,
                alignItems: "stretch",
              }}
            >
              {Array.from({ length: SKELETON_CARDS_DESKTOP }).map((_, i) => (
                <Card key={i} variant="outlined">
                  <CardContent>
                    <Box display="flex" alignItems="center" mb={1.5} gap={2}>
                      <Skeleton variant="circular" width={44} height={44} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Skeleton variant="text" width="60%" />
                        <Stack direction="row" spacing={1} mt={0.5}>
                          <Skeleton variant="rounded" width={60} height={22} />
                          <Skeleton variant="rounded" width={100} height={22} />
                        </Stack>
                      </Box>
                    </Box>
                    <Skeleton
                      variant="rounded"
                      width="100%"
                      height={28}
                      sx={{ mb: 1 }}
                    />
                    <Stack direction="row" spacing={1} mb={1}>
                      <Skeleton variant="rounded" width={120} height={24} />
                      <Skeleton variant="rounded" width={120} height={24} />
                    </Stack>
                    <Divider sx={{ mb: 1.25 }} />
                    <Stack direction="row" spacing={2} mb={0.5}>
                      <Skeleton variant="text" width={90} />
                      <Skeleton variant="text" width={90} />
                    </Stack>
                    <Skeleton variant="text" width={160} />
                    <Skeleton variant="text" width={180} />
                    <Stack direction="row" spacing={1} mt={2}>
                      <Skeleton variant="rounded" width={90} height={32} />
                      <Skeleton variant="rounded" width={100} height={32} />
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Box>
          ) : (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {[
                      "#",
                      t("rankings.table.avatar"),
                      "Nick",
                      t("rankings.table.age"),
                      t("rankings.table.gender"),
                      t("rankings.table.province"),
                      t("rankings.table.doubles"),
                      t("rankings.table.singles"),
                      t("rankings.table.updated"),
                      "Tham gia",
                      t("rankings.table.verified"),
                      "",
                    ].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Array.from({ length: SKELETON_ROWS_DESKTOP }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton variant="text" width={24} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="circular" width={32} height={32} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={120} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={40} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={70} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={90} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={80} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={80} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={110} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="text" width={110} />
                      </TableCell>
                      <TableCell>
                        <Skeleton variant="rounded" width={90} height={24} />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Skeleton variant="rounded" width={64} height={28} />
                          <Skeleton variant="rounded" width={96} height={28} />
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        ) : desktopCards ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "repeat(3, minmax(0, 1fr))",
              },
              gap: 2,
              alignItems: "stretch",
            }}
          >
            {list?.map((r, idx) => (
              <DesktopCard
                key={r?._id || r?.user?._id || idx}
                r={r}
                me={me}
                cccdPatch={cccdPatch}
                patchMap={patchMap}
                topMedalByUser={topMedalByUser}
                labelFullByUser={labelFullByUser}
                hrefByUser={hrefByUser}
                onOpenProfile={handleOpenProfile}
                onOpenGrade={openGrade}
                onOpenKyc={openKyc}
                onOpenAchievements={openAchievementDialog}
                onZoomAvatar={openZoom}
                staggerDelay={idx * 30}
                locale={locale}
                t={t}
              />
            ))}
          </Box>
        ) : isMobile ? (
          <Fade in timeout={400}>
            <Stack spacing={2}>
              {list?.map((r) => {
                const u = r?.user || {};
                const effectiveStatus =
                  (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
                const badge = cccdBadge(effectiveStatus, t);
                const avatarSrc =
                  u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
                const tierHex = getScoreHex(r);
                const age = calcAge(u);
                const canGrade = canGradeUser(me, u?.province);
                const patched = patchMap[u?._id || ""] || {};
                const patchedScores = {
                  single: patched?.single ?? r?.single,
                  double: patched?.double ?? r?.double,
                  updatedAt: patched?.updatedAt ?? r?.updatedAt,
                };
                const allowKyc = canViewKycAdmin(me, effectiveStatus);

                const uid = u?._id && String(u._id);
                const topMedal = uid ? topMedalByUser.get(uid) : null;
                const achievementRanking = {
                  ...r,
                  single: patchedScores.single,
                  double: patchedScores.double,
                  updatedAt: patchedScores.updatedAt,
                };
                const achievements = buildRankingAchievements({
                  r: achievementRanking,
                  u,
                  age,
                  effectiveStatus,
                });
                const showChampionCrown =
                  Number(r?.globalRank) === 1 ||
                  hasTopOneAchievement(achievements);

                return (
                  <Card
                    key={r?._id || u?._id}
                    variant="outlined"
                    sx={{
                      ...(topMedal
                        ? flameCardSx(topMedal)
                        : { borderRadius: 6 }),
                      width: "100%",
                    }}
                  >
                    <CardContent>
                      <Box display="flex" alignItems="center" mb={1} gap={2}>
                        <LazyAvatar
                          src={avatarSrc}
                          alt={u?.nickname || "?"}
                          onClick={() => openZoom(avatarSrc)}
                          size={40}
                          flameEffect={topMedal ? flameRingSx(topMedal) : null}
                          showCrown={showChampionCrown}
                        />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography fontWeight={600} noWrap>
                            {u?.nickname || "---"}
                          </Typography>
                        </Box>

                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          flexWrap="wrap"
                        >
                          {Number.isFinite(age) && (
                            <Chip
                              size="small"
                              label={t("rankings.labels.age", { value: age })}
                            />
                          )}
                          <Chip
                            label={badge.text}
                            size="small"
                            color={badge.color}
                          />
                        </Stack>
                      </Box>

                      {topMedal && (
                        <Box sx={{ mb: 1, minHeight: 28 }}>
                          <Tooltip
                            title={labelFullByUser.get(uid) || ""}
                            arrow
                            placement="top"
                          >
                            <Chip
                              size="small"
                              variant="outlined"
                              clickable
                              component={Link}
                              to={hrefByUser.get(uid) || "/tournaments"}
                              label={labelFullByUser.get(uid)}
                              sx={medalChipStyleFull(topMedal, "100%")}
                              onMouseDown={(e) => e.stopPropagation()}
                            />
                          </Tooltip>
                        </Box>
                      )}

                      {achievements.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          <AchievementSummary
                            achievements={achievements}
                            onOpen={() =>
                              openAchievementDialog(u, achievements)
                            }
                            maxWidth="100%"
                          />
                        </Box>
                      )}

                      <Stack
                        direction="row"
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ columnGap: 1, rowGap: 1, mb: 1 }}
                      >
                        <Chip
                          size="small"
                          label={t("rankings.labels.gender", {
                            value: genderLabel(u?.gender, t),
                          })}
                        />
                        <Chip
                          size="small"
                          label={t("rankings.labels.province", {
                            value: u?.province || "--",
                          })}
                        />
                      </Stack>

                      <Divider sx={{ mb: 1 }} />

                      <Stack
                        direction="row"
                        spacing={2}
                        mb={0.5}
                        sx={{ "& .score": { color: tierHex, fontWeight: 600 } }}
                      >
                        <Typography variant="body2" className="score">
                          {t("rankings.labels.doubles", {
                            value: fmt3(patchedScores.double),
                          })}
                        </Typography>
                        <Typography variant="body2" className="score">
                          {t("rankings.labels.singles", {
                            value: fmt3(patchedScores.single),
                          })}
                        </Typography>
                      </Stack>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                      >
                        {t("rankings.labels.updatedAt", {
                          value: patchedScores?.updatedAt
                            ? formatDate(patchedScores.updatedAt, locale)
                            : "--",
                        })}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                      >
                        Tham gia:{" "}
                        {u?.createdAt ? formatDate(u.createdAt, locale) : "--"}
                      </Typography>

                      <Stack
                        direction="row"
                        spacing={1}
                        mt={2}
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          onClick={() => handleOpenProfile(u?._id)}
                        >
                          {t("rankings.actions.profile")}
                        </Button>
                        {canGrade && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openGrade(u, r)}
                          >
                            {t("rankings.actions.grade")}
                          </Button>
                        )}
                        {allowKyc && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openKyc(u)}
                          >
                            {t("rankings.actions.viewKyc")}
                          </Button>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          </Fade>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>{t("rankings.table.avatar")}</TableCell>
                  <TableCell>Nick</TableCell>
                  <TableCell>{t("rankings.table.age")}</TableCell>
                  <TableCell>{t("rankings.table.gender")}</TableCell>
                  <TableCell>{t("rankings.table.province")}</TableCell>
                  <TableCell>{t("rankings.table.doubles")}</TableCell>
                  <TableCell>{t("rankings.table.singles")}</TableCell>
                  <TableCell>{t("rankings.table.updated")}</TableCell>
                  <TableCell>Tham gia</TableCell>
                  <TableCell>{t("rankings.table.verified")}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list?.map((r, idx) => {
                  const u = r?.user || {};
                  const effectiveStatus =
                    (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
                  const badge = cccdBadge(effectiveStatus, t);
                  const avatarSrc =
                    u?.avatar ||
                    PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
                  const tierHex = getScoreHex(r);
                  const age = calcAge(u);
                  const canGrade = canGradeUser(me, u?.province);
                  const patched = patchMap[u?._id || ""] || {};
                  const patchedScores = {
                    single: patched?.single ?? r?.single,
                    double: patched?.double ?? r?.double,
                    updatedAt: patched?.updatedAt ?? r?.updatedAt,
                  };
                  const allowKyc = canViewKycAdmin(me, effectiveStatus);

                  const uid = u?._id && String(u._id);
                  const topMedal = uid ? topMedalByUser.get(uid) : null;
                  const label = uid ? labelShortByUser.get(uid) : null;
                  const displayRank =
                    Number(r?.globalRank) || page * RANKING_PAGE_LIMIT + idx + 1;
                  const achievementRanking = {
                    ...r,
                    single: patchedScores.single,
                    double: patchedScores.double,
                    updatedAt: patchedScores.updatedAt,
                  };
                  const achievements = buildRankingAchievements({
                    r: achievementRanking,
                    u,
                    age,
                    effectiveStatus,
                  });
                  const showChampionCrown =
                    Number(r?.globalRank) === 1 ||
                    hasTopOneAchievement(achievements);

                  return (
                    <TableRow key={r?._id || u?._id} hover>
                      <TableCell>{displayRank}</TableCell>
                      <TableCell>
                        <LazyAvatar
                          src={avatarSrc}
                          alt={u?.nickname || "?"}
                          onClick={() => openZoom(avatarSrc)}
                          size={32}
                          flameEffect={topMedal ? flameRingSx(topMedal) : null}
                          showCrown={showChampionCrown}
                        />
                      </TableCell>
                      <TableCell>
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            gap: 0.5,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600 }}
                            noWrap
                          >
                            {u?.nickname || "--"}
                          </Typography>
                          {topMedal && (
                            <Tooltip title={label || ""}>
                              <Chip
                                size="small"
                                variant="outlined"
                                clickable
                                component={Link}
                                to={hrefByUser.get(uid) || "/tournaments"}
                                label={label}
                                sx={medalChipStyle(topMedal, 240)}
                                onMouseDown={(e) => e.stopPropagation()}
                              />
                            </Tooltip>
                          )}
                          {achievements.length > 0 && (
                            <AchievementSummary
                              achievements={achievements}
                              onOpen={() =>
                                openAchievementDialog(u, achievements)
                              }
                              maxWidth={160}
                            />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{Number.isFinite(age) ? age : "--"}</TableCell>
                      <TableCell>{genderLabel(u?.gender, t)}</TableCell>
                      <TableCell>{u?.province || "--"}</TableCell>
                      <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                        {fmt3(patchedScores.double)}
                      </TableCell>
                      <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                        {fmt3(patchedScores.single)}
                      </TableCell>
                      <TableCell>
                        {patchedScores?.updatedAt
                          ? formatDate(patchedScores.updatedAt, locale)
                          : "--"}
                      </TableCell>
                      <TableCell>
                        {u?.createdAt ? formatDate(u.createdAt, locale) : "--"}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={badge.text}
                          size="small"
                          color={badge.color}
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() => handleOpenProfile(u?._id)}
                          >
                            {t("rankings.actions.profile")}
                          </Button>
                          {canGrade && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => openGrade(u, r)}
                            >
                              {t("rankings.actions.grade")}
                            </Button>
                          )}
                          {allowKyc && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => openKyc(u)}
                            >
                              {t("rankings.actions.viewKyc")}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {totalPages > 1 && (
          <Box mt={2} display="flex" justifyContent="center">
            <Pagination
              count={totalPages}
              page={page + 1}
              onChange={handlePageChange}
              color="primary"
              disabled={isFetching}
            />
          </Box>
        )}

        <PublicProfileDialog
          open={openProfile}
          onClose={handleCloseProfile}
          userId={selectedId}
          refreshKey={profileRefreshKey}
        />

        <AchievementsDialog
          open={achievementDlg.open}
          user={achievementDlg.user}
          achievements={achievementDlg.achievements}
          onClose={closeAchievementDialog}
        />

        <Dialog
          open={zoomOpen}
          onClose={closeZoom}
          maxWidth="sm"
          fullWidth
          sx={{ zIndex: (t) => t.zIndex.tooltip + 2 }}
          slotProps={{ paper: { sx: { borderRadius: 2 } } }}
        >
          <DialogTitle>{t("rankings.kycImageTitle")}</DialogTitle>
          <DialogContent
            dividers
            sx={{ display: "flex", justifyContent: "center" }}
          >
            <img
              src={zoomSrc}
              alt="avatar"
              style={{
                width: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
                borderRadius: 8,
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={closeZoom}>{t("common.actions.close")}</Button>
          </DialogActions>
        </Dialog>

        {/* KYC Drawer - keeping original implementation */}
        <Drawer
          anchor="right"
          open={!!kycView}
          onClose={closeKyc}
          PaperProps={{
            sx: {
              width: isDesktop ? DRAWER_WIDTH_DESKTOP : "100%",
              maxWidth: isDesktop ? DRAWER_WIDTH_DESKTOP : "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              zIndex: (t) => t.zIndex.tooltip + 1,
            },
          }}
          ModalProps={{
            keepMounted: true,
            sx: { zIndex: (t) => t.zIndex.tooltip + 1 },
            BackdropProps: { sx: { zIndex: (t) => t.zIndex.tooltip } },
          }}
        >
          <AppBar
            position="sticky"
            color="inherit"
            elevation={0}
            sx={{ borderBottom: "1px solid", borderColor: "divider" }}
          >
            <Toolbar sx={{ minHeight: 48, px: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
                KYC – {kycView?.name || kycView?.nickname || "--"}
              </Typography>
              <IconButton onClick={closeKyc}>
                <CloseIcon />
              </IconButton>
            </Toolbar>
          </AppBar>

          <Box
            sx={{
              p: { xs: 2, sm: 2 },
              bgcolor: "transparent",
              flex: 1,
              overflow: "auto",
            }}
          >
            {kycView ? (
              <Grid container spacing={2} sx={{ m: 0 }}>
                <Grid item size={{ xs: 12, md: 12 }} sx={{ width: "100%" }}>
                  <Grid container spacing={2} sx={{ width: "100%" }}>
                    {["front", "back"].map((side) => (
                      <Grid
                        item
                        size={{ xs: 6 }}
                        key={side}
                        sx={{ width: "100%" }}
                      >
                        <Paper
                          variant="outlined"
                          sx={{ borderRadius: 2, overflow: "hidden" }}
                        >
                          <KycImage
                            src={kycView?.cccdImages?.[side]}
                            alt={side}
                            label={
                              side === "front"
                                ? t("rankings.kycFront")
                                : t("rankings.kycBack")
                            }
                            onClick={() =>
                              openZoom(kycView?.cccdImages?.[side])
                            }
                            maxHeight={320}
                          />
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Grid>

                <Grid item size={{ xs: 12, md: 12 }} sx={{ width: "100%" }}>
                  <Box
                    sx={{
                      p: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ mb: 1 }}
                    >
                      <Chip
                        size="small"
                        label={
                          cccdBadge(
                            cccdPatch[kycView?._id] || kycView?.cccdStatus,
                            t,
                          ).text
                        }
                        color={
                          cccdBadge(
                            cccdPatch[kycView?._id] || kycView?.cccdStatus,
                            t,
                          ).color
                        }
                      />
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "120px 1fr",
                          md: "140px 1fr",
                        },
                        rowGap: 1,
                        columnGap: 1.5,
                        "& .label": { color: "text.secondary", fontSize: 14 },
                        "& .value": { fontWeight: 600, fontSize: 15 },
                      }}
                    >
                      <Box className="label">
                        {t("rankings.kycLabels.name")}
                      </Box>
                      <Box className="value">{kycView?.name || "—"}</Box>

                      <Box className="label">{t("rankings.kycLabels.dob")}</Box>
                      <Box className="value">
                        {kycView?.dob
                          ? formatDate(kycView.dob, locale)
                          : t("common.unavailable")}
                      </Box>

                      <Box className="label">
                        {t("rankings.kycLabels.cccd")}
                      </Box>
                      <Box className="value" sx={{ fontFamily: "monospace" }}>
                        {kycView?.cccd || "—"}
                      </Box>

                      <Box className="label">
                        {t("rankings.kycLabels.province")}
                      </Box>
                      <Box className="value">{kycView?.province || "—"}</Box>
                    </Box>

                    {kycView?.note && (
                      <Box
                        sx={{
                          mt: 1.5,
                          p: 1.25,
                          bgcolor: "action.hover",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {t("rankings.kycLabels.note")}
                        </Typography>
                        <Typography variant="body2" display="block">
                          {kycView?.note}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Grid>
              </Grid>
            ) : (
              <Box p={2}>
                <Alert severity="info">{t("rankings.kycNoData")}</Alert>
              </Box>
            )}
          </Box>

          <Box
            sx={{
              position: "sticky",
              bottom: 0,
              borderTop: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              p: 1,
            }}
          >
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={closeKyc}>{t("common.actions.close")}</Button>
              <Button
                color="error"
                startIcon={<CancelIcon fontSize="small" />}
                onClick={() => doReview("reject")}
                disabled={reviewing || !kycView?._id}
              >
                {t("common.actions.reject")}
              </Button>
              <Button
                color="success"
                startIcon={<VerifiedIcon fontSize="small" />}
                onClick={() => doReview("approve")}
                disabled={reviewing || !kycView?._id}
              >
                {t("common.actions.approve")}
              </Button>
            </Stack>
          </Box>
        </Drawer>

        <Dialog
          open={gradeDlg.open}
          onClose={() => setGradeDlg({ open: false })}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle component="div">
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <Typography component="span" variant="h6" fontWeight={700}>
                {t("rankings.gradeDialog.title", { name: gradeDlg.nickname })}
              </Typography>
              <Tooltip title={t("rankings.gradeHistory.openTooltip")}>
                <span>
                  <IconButton
                    size="small"
                    onClick={openGradeHistory}
                    disabled={!gradeDlg.userId}
                    aria-label={t("rankings.gradeHistory.openTooltip")}
                  >
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </DialogTitle>
          <DialogContent
            dividers
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <TextField
              label={t("rankings.gradeDialog.singles", {
                min: MIN_RATING,
                max: MAX_RATING,
              })}
              type="number"
              inputProps={{ step: "0.05", min: MIN_RATING, max: MAX_RATING }}
              value={gradeSingles}
              onChange={(e) => setGradeSingles(e.target.value)}
            />
            <TextField
              label={t("rankings.gradeDialog.doubles", {
                min: MIN_RATING,
                max: MAX_RATING,
              })}
              type="number"
              inputProps={{ step: "0.05", min: MIN_RATING, max: MAX_RATING }}
              value={gradeDoubles}
              onChange={(e) => setGradeDoubles(e.target.value)}
            />
            <TextField
              label={t("rankings.gradeDialog.note")}
              multiline
              minRows={2}
              value={gradeNotes}
              onChange={(e) => setGradeNotes(e.target.value)}
            />
            {me?.role === "admin" ? (
              <Alert severity="success">
                {t("rankings.feedback.adminGradeAll")}
              </Alert>
            ) : (
              <Alert severity="info">
                {t("rankings.feedback.evaluatorScope", {
                  province: gradeDlg.province || "--",
                })}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setGradeDlg({ open: false })}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              onClick={submitGrade}
              disabled={creating}
              variant="contained"
            >
              {creating
                ? t("rankings.actions.saving")
                : t("rankings.actions.submitGrade")}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={gradeHistoryDlg.open}
          onClose={closeGradeHistory}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle component="div">
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography component="div" variant="h6" fontWeight={700} noWrap>
                  {t("rankings.gradeHistory.title", {
                    name: gradeHistoryDlg.nickname || "--",
                  })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("rankings.gradeHistory.subtitle", {
                    count: gradeHistoryRows.length,
                  })}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={closeGradeHistory}
                aria-label={t("common.actions.close")}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent dividers sx={{ p: 0 }}>
            {fetchingGradeHistory ? <LinearProgress /> : null}
            {gradeHistoryError ? (
              <Alert severity="error" sx={{ m: 2 }}>
                {t("rankings.gradeHistory.loadFailed")}
              </Alert>
            ) : gradeHistoryRows.length ? (
              <TableContainer sx={{ maxHeight: 420, overflowX: "auto" }}>
                <Table size="small" stickyHeader sx={{ minWidth: 620 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("rankings.gradeHistory.scoredAt")}</TableCell>
                      <TableCell>{t("rankings.gradeHistory.scorer")}</TableCell>
                      <TableCell align="right">
                        {t("rankings.gradeHistory.singles")}
                      </TableCell>
                      <TableCell align="right">
                        {t("rankings.gradeHistory.doubles")}
                      </TableCell>
                      <TableCell>{t("rankings.gradeHistory.note")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {gradeHistoryRows.map((row) => (
                      <TableRow key={row?._id} hover>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {row?.scoredAt ? formatDate(row.scoredAt, locale) : "--"}
                        </TableCell>
                        <TableCell sx={{ minWidth: 140 }}>
                          {getHistoryScorerName(row)}
                        </TableCell>
                        <TableCell align="right">
                          {fmtHistoryScore(row?.single)}
                        </TableCell>
                        <TableCell align="right">
                          {fmtHistoryScore(row?.double)}
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <Typography variant="body2" color="text.secondary">
                            {row?.note || "--"}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info" sx={{ m: 2 }}>
                {fetchingGradeHistory
                  ? t("rankings.gradeHistory.loading")
                  : t("rankings.gradeHistory.empty")}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeGradeHistory}>
              {t("common.actions.close")}
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar
          open={snack.open}
          autoHideDuration={2800}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity={snack.type} variant="filled">
            {snack.msg}
          </Alert>
        </Snackbar>

        {/* nếu podium API lỗi, mình không chặn UI chính; bạn muốn show warning thì mở dòng dưới */}
        {/* {errorPod && <Alert severity="warning">Không tải được podium 30 ngày.</Alert>} */}
      </Container>
    </>
  );
}
