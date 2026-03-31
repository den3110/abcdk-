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
  useGetRankingsPodiums30dQuery,
} from "../../slices/rankingsApiSlice";

import PublicProfileDialog from "../../components/PublicProfileDialog";

import { useGetMeQuery } from "../../slices/usersApiSlice";
import { useCreateEvaluationMutation } from "../../slices/evaluationsApiSlice";
import { useReviewKycMutation } from "../../slices/adminApiSlice";
import { skipToken } from "@reduxjs/toolkit/query";
import SponsorMarquee from "../../components/SponsorMarquee";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext";
import { formatDate } from "../../i18n/format";

/* ================= LAZY LOADING AVATAR COMPONENT ================= */
const LazyAvatar = memo(
  ({ src, alt, onClick, size = 44, flameEffect = null }) => {
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
        overflow: "hidden",
      }),
      [flameEffect, size],
    );

    return (
      <Box ref={imgRef} sx={containerSx}>
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
const MIN_RATING = 1.6;
const MAX_RATING = 8.0;
const fmt3 = (x) => (Number.isFinite(x) ? Number(x).toFixed(3) : "0.000");

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

const parsePageFromParams = (sp) => {
  const raw = sp.get("page");
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
};
const parseKeywordFromParams = (sp) => sp.get("q") ?? "";

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
    onZoomAvatar,
    staggerDelay,
    locale,
    t,
  }) => {
    const u = r?.user || {};
    const effectiveStatus = (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
    const badge = useMemo(
      () => cccdBadge(effectiveStatus, t),
      [effectiveStatus, t],
    );
    const avatarSrc =
      u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
    const tierHex = HEX[r?.tierColor] || HEX.grey;
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
  } = useGetRankingsListQuery({ keyword, page });

  const { data: podiumData, isFetching: isFetchingPod } =
    useGetRankingsPodiums30dQuery();

  const list = listData?.docs || [];
  const totalPages = listData?.totalPages || 0;

  // podiumData có thể là { podiums30d: {...} } hoặc trực tiếp {...}
  const podiums30d = podiumData?.podiums30d || podiumData || {};

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
  const canSelfAssess = !me || me.isScoreVerified === false;

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
        searchInput ? `TÃ¬m: ${searchInput}` : "",
        isFetching ? "Äang táº£i dá»¯ liá»‡u xáº¿p háº¡ng" : "",
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
        `Hiá»ƒn thá»‹: ${list.length}`,
        `Trang: ${page + 1}/${Math.max(totalPages, 1)}`,
        isMobile ? "Cháº¿ Ä‘á»™ mobile" : "Cháº¿ Ä‘á»™ desktop",
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
          <Chip
            label={t("rankings.scoreLegend.verified")}
            sx={{ bgcolor: HEX.yellow, color: "#000" }}
          />
          <Chip
            label={t("rankings.scoreLegend.selfAssessed")}
            sx={{ bgcolor: HEX.red, color: "#fff" }}
          />
          <Chip
            label={t("rankings.scoreLegend.unverified")}
            sx={{ bgcolor: HEX.grey, color: "#fff" }}
          />
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
                const tierHex = HEX[r?.tierColor] || HEX.grey;
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
                  const tierHex = HEX[r?.tierColor] || HEX.grey;
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

                  return (
                    <TableRow key={r?._id || u?._id} hover>
                      <TableCell>{page * 10 + idx + 1}</TableCell>
                      <TableCell>
                        <LazyAvatar
                          src={avatarSrc}
                          alt={u?.nickname || "?"}
                          onClick={() => openZoom(avatarSrc)}
                          size={32}
                          flameEffect={topMedal ? flameRingSx(topMedal) : null}
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
          <DialogTitle>
            {t("rankings.gradeDialog.title", { name: gradeDlg.nickname })}
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
