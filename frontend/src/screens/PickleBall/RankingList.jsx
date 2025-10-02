import React, { useEffect, useState, useCallback, useMemo } from "react";
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
import { useGetRankingsQuery } from "../../slices/rankingsApiSlice";
import PublicProfileDialog from "../../components/PublicProfileDialog";

import { useGetMeQuery } from "../../slices/usersApiSlice";
import { useCreateEvaluationMutation } from "../../slices/evaluationsApiSlice";
import { useReviewKycMutation } from "../../slices/adminApiSlice";
import { skipToken } from "@reduxjs/toolkit/query";

/* ================= Color & constants ================= */
const VIEW_KEY = "ranking_desktop_view";
const PLACE = "https://dummyimage.com/40x40/cccccc/ffffff&text=";
const HEX = {
  green: "#2e7d32",
  blue: "#1976d2",
  yellow: "#ff9800",
  red: "#f44336",
  grey: "#616161",
};
const MIN_RATING = 2;
const MAX_RATING = 8.0;
const fmt3 = (x) => (Number.isFinite(x) ? Number(x).toFixed(3) : "0.000");
const prettyDate = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "—");

const SKELETON_CARDS_MOBILE = 6;
const SKELETON_ROWS_DESKTOP = 10;
const SKELETON_CARDS_DESKTOP = 9;

/* ================= Helpers ================= */
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

const cccdBadge = (status) => {
  switch (status) {
    case "verified":
      return { text: "Đã xác thực", color: "success" };
    case "pending":
      return { text: "Chờ xác thực", color: "warning" };
    default:
      return { text: "Chưa xác thực", color: "default" };
  }
};

const genderLabel = (g) => {
  switch (g) {
    case "male":
      return "Nam";
    case "female":
      return "Nữ";
    case "other":
      return "Khác";
    case "unspecified":
      return "Chưa xác định";
    default:
      return "--";
  }
};

// quyền chấm
const canGradeUser = (me, targetProvince) => {
  if (me?.role === "admin") return true;
  if (!me?.evaluator?.enabled) return false;
  const scopes = me?.evaluator?.gradingScopes?.provinces || [];
  return !!targetProvince && scopes.includes(String(targetProvince).trim());
};

// quyền xem KYC
const canViewKycAdmin = (me, status) =>
  me?.role === "admin" && (status === "verified" || status === "pending");

const numOrUndef = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

const getBaselineScores = (u, r) => {
  const singleFromR = numOrUndef(r?.single);
  const doubleFromR = numOrUndef(r?.double);
  const singleFromU =
    numOrUndef(u?.localRatings?.singles) ??
    numOrUndef(u?.ratingSingle) ??
    undefined;
  const doubleFromU =
    numOrUndef(u?.localRatings?.doubles) ??
    numOrUndef(u?.ratingDouble) ??
    undefined;
  return {
    single: singleFromR ?? singleFromU,
    double: doubleFromR ?? doubleFromU,
  };
};

// URL params helpers
const parsePageFromParams = (sp) => {
  const raw = sp.get("page");
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
};
const parseKeywordFromParams = (sp) => sp.get("q") ?? "";

/* ================= Flame podium styles ================= */
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

// 1) Thu gọn hiệu ứng để không vượt khung
const flameCardSx = (type = "gold") => ({
  position: "relative",
  overflow: "hidden", // was: 'visible'
  borderRadius: 6,
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 0, // was: -2
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
    inset: 0, // was: -6
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

const medalLabel = (m) =>
  m === "gold"
    ? "Nhà vô địch"
    : m === "silver"
    ? "Á quân"
    : m === "bronze"
    ? "Đồng hạng 3"
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

/* ================= Component ================= */
export default function RankingList() {
  const dispatch = useDispatch();
  const { keyword, page } = useSelector((s) => s?.rankingUi || {});
  const [searchParams, setSearchParams] = useSearchParams();

  // Desktop view mode: 'list' (table) | 'cards' (grid)
  const [desktopView, setDesktopView] = useState(() => {
    try {
      const cached = localStorage.getItem(VIEW_KEY);
      return cached === "cards" || cached === "list" ? cached : "list";
    } catch {
      return "cards";
    }
  });

  // Debounced input state
  const [searchInput, setSearchInput] = useState(keyword || "");

  // Query data (API mới có podiums30d)
  const {
    data = { docs: [], totalPages: 0, podiums30d: {} },
    isLoading,
    error,
  } = useGetRankingsQuery({ keyword, page });

  const {
    docs: list,
    totalPages,
    podiums30d,
  } = {
    docs: data?.docs || [],
    totalPages: data?.totalPages || 0,
    podiums30d: data?.podiums30d || {},
  };

  const theme = useTheme();
  const isMobile = useMediaQuery(theme?.breakpoints?.down("sm"));
  const isDesktop = useMediaQuery(theme?.breakpoints?.up("md"));
  const DRAWER_WIDTH_DESKTOP = 380;

  const desktopCards = !isMobile && desktopView === "cards";

  // token
  const token = useSelector(
    (s) =>
      s?.auth?.userInfo?.token ??
      s?.userLogin?.userInfo?.token ??
      s?.user?.token ??
      null
  );

  const { data: meData, isLoading: loading } = useGetMeQuery(
    token ? undefined : skipToken,
    {
      refetchOnFocus: false,
      refetchOnReconnect: false,
      refetchOnMountOrArgChange: false,
    }
  );
  const me = meData || null;
  const canSelfAssess = !me || me.isScoreVerified === false;

  // URL -> Redux & Input
  useEffect(() => {
    const urlPage = parsePageFromParams(searchParams);
    if (urlPage !== page) dispatch(setPage(urlPage));

    const urlQ = parseKeywordFromParams(searchParams);
    if ((urlQ || "") !== (keyword || "")) {
      dispatch(setKeyword(urlQ));
    }
    if ((urlQ || "") !== (searchInput || "")) {
      setSearchInput(urlQ || "");
    }

    // view mode from URL (optional)
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
  }, [searchParams]);

  // Redux -> URL (only page)
  useEffect(() => {
    const curPageParam = searchParams.get("page");
    const desiredPageParam = page > 0 ? String(page + 1) : null;
    if (curPageParam !== desiredPageParam) {
      const next = new URLSearchParams(searchParams);
      if (desiredPageParam) next.set("page", desiredPageParam);
      else next.delete("page");
      setSearchParams(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Debounce searchInput -> keyword
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

  // Immediate search on Enter
  const doImmediateSearch = useCallback(() => {
    if ((searchInput || "") === (keyword || "")) return;
    dispatch(setKeyword(searchInput || ""));
    dispatch(setPage(0));
    const next = new URLSearchParams(searchParams);
    if (searchInput) next.set("q", searchInput);
    else next.delete("q");
    next.delete("page");
    setSearchParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, keyword, dispatch, searchParams, setSearchParams]);

  const handleInputKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doImmediateSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (searchInput) setSearchInput("");
    }
  };

  const handleClear = () => {
    if (!searchInput && !keyword) return;
    setSearchInput("");
    dispatch(setKeyword(""));
    dispatch(setPage(0));
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    next.delete("page");
    setSearchParams(next);
  };

  // Profile dialog
  const [openProfile, setOpenProfile] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const handleOpenProfile = (id) => {
    setSelectedId(id);
    setOpenProfile(true);
  };
  const handleCloseProfile = () => setOpenProfile(false);

  // Zoom avatar
  const [zoomSrc, setZoomSrc] = useState("");
  const [zoomOpen, setZoomOpen] = useState(false);
  const openZoom = (src) => {
    setZoomSrc(src || PLACE);
    setZoomOpen(true);
  };
  const closeZoom = () => setZoomOpen(false);

  // Grade dialog
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
  const showSnack = (type, msg) => setSnack({ open: true, type, msg });

  // Patch map (optimistic refresh)
  const [patchMap, setPatchMap] = useState({});
  const getPatched = (r, u) => {
    const p = patchMap[u?._id || ""] || {};
    return {
      single: p?.single ?? r?.single,
      double: p?.double ?? r?.double,
      updatedAt: p?.updatedAt ?? r?.updatedAt,
    };
  };

  const openGrade = (u, r) => {
    const base = getBaselineScores(u, r);
    setGradeDlg({
      open: true,
      userId: u?._id,
      nickname: u?.nickname || "--",
      province: u?.province || "",
    });
    setGradeSingles(
      Number.isFinite(base.single) ? String(Number(base.single).toFixed(2)) : ""
    );
    setGradeDoubles(
      Number.isFinite(base.double) ? String(Number(base.double).toFixed(2)) : ""
    );
    setGradeNotes("");
  };

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
          `Điểm phải trong khoảng ${MIN_RATING} - ${MAX_RATING}`
        );
        return;
      }
      if (!gradeDlg.userId) {
        showSnack("error", "Thiếu thông tin người được chấm hoặc tỉnh.");
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

      showSnack("success", "Đã gửi phiếu chấm!");
      setGradeDlg({ open: false, userId: null, nickname: "", province: "" });
    } catch (err) {
      showSnack(
        "error",
        err?.data?.message || err?.error || "Không thể gửi phiếu chấm"
      );
    }
  };

  // KYC drawer
  const [kycView, setKycView] = useState(null);
  const [reviewKycMut, { isLoading: reviewing }] = useReviewKycMutation();
  const [cccdPatch, setCccdPatch] = useState({});
  const openKyc = (u) => setKycView(u || null);
  const closeKyc = () => setKycView(null);

  const doReview = async (action) => {
    if (!kycView?._id) return;
    try {
      await reviewKycMut({ id: kycView._id, action }).unwrap();
      const nextStatus = action === "approve" ? "verified" : "rejected";
      setCccdPatch((m) => ({ ...m, [kycView._id]: nextStatus }));
      setKycView((v) => (v ? { ...v, cccdStatus: nextStatus } : v));
      showSnack(
        "success",
        action === "approve" ? "Đã duyệt KYC" : "Đã từ chối KYC"
      );
    } catch (err) {
      showSnack(
        "error",
        err?.data?.message || err?.error || "Không thể xử lý KYC"
      );
    }
  };

  const chipMobileSx = { mr: { xs: 0.75, sm: 0 }, mb: { xs: 0.75, sm: 0 } };

  /* ===== Build top-achievement map từ API podiums30d ===== */
  const { topMedalByUser, labelByUser, hrefByUser } = useMemo(() => {
    const rank = { gold: 3, silver: 2, bronze: 1 };

    const topMap = new Map(); // userId -> "gold"/"silver"/"bronze"
    const labelMap = new Map(); // userId -> label hiển thị (CHỈ medal)
    const hrefMap = new Map(); // userId -> link tới trang giải

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
      return "/tournament";
    };

    for (const [uid, arr] of entries) {
      if (!Array.isArray(arr) || arr.length === 0) continue;

      // pick best by medal rank, then latest finishedAt
      const picked = [...arr].sort((a, b) => {
        const r = (rank[b.medal] || 0) - (rank[a.medal] || 0);
        if (r !== 0) return r;
        const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
        const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
        return tb - ta;
      })[0];

      // Label CHỈ còn “Nhà vô địch / Á quân / Đồng hạng 3”
      const title = medalLabel(picked.medal);

      topMap.set(String(uid), picked.medal);
      labelMap.set(String(uid), title);
      hrefMap.set(String(uid), getHref(picked));
    }

    return {
      topMedalByUser: topMap,
      labelByUser: labelMap,
      hrefByUser: hrefMap,
    };
  }, [podiums30d]);

  // handle desktop view mode change & sync URL
  const handleChangeDesktopView = (_, next) => {
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
  };

  // ======== Render helpers ========
  const DesktopCard = ({ r, idx }) => {
    const u = r?.user || {};
    const effectiveStatus = (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
    const badge = cccdBadge(effectiveStatus);
    const avatarSrc =
      u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
    const tierHex = HEX[r?.tierColor] || HEX.grey;
    const age = calcAge(u);
    const canGrade = canGradeUser(me, u?.province);
    const patched = getPatched(r, u);
    const allowKyc = canViewKycAdmin(me, effectiveStatus);

    const uid = u?._id && String(u._id);
    const topMedal = uid ? topMedalByUser.get(uid) : null;
    const label = uid ? labelByUser.get(uid) : null;

    return (
      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Card
          variant="outlined"
          sx={{
            ...(topMedal ? flameCardSx(topMedal) : { borderRadius: 6 }),
            width: "100%", // full bề rộng ô grid
            height: "100%", // kéo cao đều
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CardContent
            sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}
          >
            <Box display="flex" alignItems="center" mb={1.5} gap={2}>
              <Box sx={topMedal ? flameRingSx(topMedal) : undefined}>
                <Avatar
                  src={avatarSrc}
                  alt={u?.nickname || "?"}
                  onClick={() => openZoom(avatarSrc)}
                  sx={{ cursor: "zoom-in", width: 44, height: 44 }}
                />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography fontWeight={700} noWrap>
                  {u?.nickname || "---"}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" mt={0.5}>
                  {Number.isFinite(age) && (
                    <Chip size="small" label={`${age} tuổi`} />
                  )}
                  <Chip label={badge.text} size="small" color={badge.color} />
                </Stack>
              </Box>
            </Box>

            {/* SLOT cố định cho chip thành tích (28px) */}
            <Box
              sx={{
                minHeight: 28,
                mb: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              {topMedal && (
                <Chip
                  size="small"
                  variant="outlined"
                  clickable
                  component={Link}
                  to={hrefByUser.get(uid) || "/tournaments"}
                  label={label} // chỉ "Nhà vô địch/Á quân/Đồng hạng 3"
                  sx={medalChipStyle(topMedal, 260)}
                  onMouseDown={(e) => e.stopPropagation()}
                />
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
                label={`Giới tính: ${genderLabel(u?.gender)}`}
              />
              <Chip size="small" label={`Tỉnh: ${u?.province || "--"}`} />
            </Stack>

            <Divider sx={{ mb: 1.25 }} />

            <Stack
              direction="row"
              spacing={2}
              mb={0.5}
              sx={{ "& .score": { color: tierHex, fontWeight: 700 } }}
            >
              <Typography variant="body2" className="score">
                Đôi: {fmt3(patched.double)}
              </Typography>
              <Typography variant="body2" className="score">
                Đơn: {fmt3(patched.single)}
              </Typography>
            </Stack>

            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              Cập nhật:{" "}
              {patched?.updatedAt
                ? new Date(patched.updatedAt).toLocaleDateString()
                : "--"}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              Tham gia:{" "}
              {u?.createdAt ? new Date(u.createdAt).toLocaleDateString() : "--"}
            </Typography>

            {/* đẩy nút xuống đáy card */}
            <Stack direction="row" spacing={1} mt="auto">
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => handleOpenProfile(u?._id)}
              >
                Hồ sơ
              </Button>
              {canGrade && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => openGrade(u, r)}
                >
                  Chấm trình
                </Button>
              )}
              {allowKyc && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => openKyc(u)}
                >
                  Xem KYC
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Global keyframes for flame animation */}
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
          Bảng xếp hạng
        </Typography>

        <Stack direction="row" alignItems="center" spacing={1}>
          {!isMobile && (
            <ToggleButtonGroup
              size="small"
              value={desktopView}
              exclusive
              onChange={handleChangeDesktopView}
              aria-label="Chế độ hiển thị desktop"
            >
              <ToggleButton
                value="list"
                aria-label="Danh sách"
              >
                <Tooltip title="Hiển thị dạng danh sách" arrow enterDelay={500}>
                  <Box component="span" sx={{ display: "flex" }}>
                    <TableRowsIcon fontSize="small" />
                  </Box>
                </Tooltip>
              </ToggleButton>

              <ToggleButton
                value="cards"
                aria-label="Thẻ"
              >
                <Tooltip
                  title="Hiển thị dạng lưới"
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
              Tự chấm trình
            </Button>
          )}
        </Stack>
      </Box>

      {/* Legend */}
      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        sx={{ columnGap: 1.5, rowGap: 1, mb: 2 }}
      >
        <Chip
          label="Điểm vàng: Đã xác thực"
          sx={{ bgcolor: HEX.yellow, color: "#000" }}
        />
        <Chip
          label="Điểm đỏ: Tự chấm"
          sx={{ bgcolor: HEX.red, color: "#fff" }}
        />
        <Chip
          label="Điểm xám: Chưa xác thực"
          sx={{ bgcolor: HEX.grey, color: "#fff" }}
        />
      </Stack>

      <TextField
        label="Tìm kiếm"
        variant="outlined"
        size="small"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        onKeyDown={handleInputKeyDown}
        sx={{ mb: 2, width: 320 }}
        inputProps={{ maxLength: 120 }}
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
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
        placeholder="Nick, tỉnh, số CCCD, ..."
      />

      {error ? (
        <Alert severity="error">{error?.data?.message || error?.error}</Alert>
      ) : isLoading ? (
        isMobile ? (
          // mobile skeleton (cards 1 cột)
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
          // desktop skeleton (cards 3 cột)
          <Grid container spacing={2}>
            {Array.from({ length: SKELETON_CARDS_DESKTOP }).map((_, i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <Card variant="outlined">
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
              </Grid>
            ))}
          </Grid>
        ) : (
          // desktop table skeleton
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {[
                    "#",
                    "Ảnh",
                    "Nick",
                    "Tuổi",
                    "Giới tính",
                    "Tỉnh",
                    "Điểm đôi",
                    "Điểm đơn",
                    "Cập nhật",
                    "Tham gia",
                    "Xác thực",
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
      ) : isMobile ? (
        /* ===== MOBILE LIST (cards 1 cột) ===== */
        <Stack spacing={2}>
          {list?.map((r) => {
            const u = r?.user || {};
            const effectiveStatus =
              (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
            const badge = cccdBadge(effectiveStatus);
            const avatarSrc =
              u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
            const tierHex = HEX[r?.tierColor] || HEX.grey;
            const age = calcAge(u);
            const canGrade = canGradeUser(me, u?.province);
            const patched = getPatched(r, u);
            const allowKyc = canViewKycAdmin(me, effectiveStatus);

            const uid = u?._id && String(u._id);
            const topMedal = uid ? topMedalByUser.get(uid) : null;
            const label = uid ? labelByUser.get(uid) : null;

            return (
              <Card
                key={r?._id || u?._id}
                variant="outlined"
                sx={{
                  ...(topMedal ? flameCardSx(topMedal) : { borderRadius: 6 }),
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1} gap={2}>
                    <Box sx={topMedal ? flameRingSx(topMedal) : undefined}>
                      <Avatar
                        src={avatarSrc}
                        alt={u?.nickname || "?"}
                        onClick={() => openZoom(avatarSrc)}
                        sx={{ cursor: "zoom-in", width: 40, height: 40 }}
                      />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography fontWeight={600} noWrap>
                        {u?.nickname || "---"}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1} alignItems="center">
                      {Number.isFinite(age) && (
                        <Chip size="small" label={`${age} tuổi`} />
                      )}
                      <Chip
                        label={badge.text}
                        size="small"
                        color={badge.color}
                      />
                    </Stack>
                  </Box>

                  {topMedal && (
                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      useFlexGap
                      sx={{ columnGap: 1, rowGap: 1, mb: 1 }}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        clickable
                        component={Link}
                        to={hrefByUser.get(uid) || "/tournaments"}
                        label={label}
                        sx={medalChipStyle(topMedal, 220)}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    </Stack>
                  )}

                  <Stack
                    direction="row"
                    flexWrap="wrap"
                    useFlexGap
                    sx={{ columnGap: 1, rowGap: 1, mb: 1 }}
                  >
                    <Chip
                      size="small"
                      label={`Giới tính: ${genderLabel(u?.gender)}`}
                    />
                    <Chip size="small" label={`Tỉnh: ${u?.province || "--"}`} />
                  </Stack>

                  <Divider sx={{ mb: 1 }} />

                  <Stack
                    direction="row"
                    spacing={2}
                    mb={0.5}
                    sx={{ "& .score": { color: tierHex, fontWeight: 600 } }}
                  >
                    <Typography variant="body2" className="score">
                      Đôi: {fmt3(patched.double)}
                    </Typography>
                    <Typography variant="body2" className="score">
                      Đơn: {fmt3(patched.single)}
                    </Typography>
                  </Stack>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Cập nhật:{" "}
                    {patched?.updatedAt
                      ? new Date(patched.updatedAt).toLocaleDateString()
                      : "--"}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Tham gia:{" "}
                    {u?.createdAt
                      ? new Date(u.createdAt).toLocaleDateString()
                      : "--"}
                  </Typography>

                  <Stack direction="row" spacing={1} mt={2}>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      onClick={() => handleOpenProfile(u?._id)}
                    >
                      Hồ sơ
                    </Button>
                    {canGrade && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openGrade(u, r)}
                      >
                        Chấm trình
                      </Button>
                    )}
                    {allowKyc && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openKyc(u)}
                      >
                        Xem KYC
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      ) : desktopCards ? (
        /* ===== DESKTOP CARDS (grid 3 cột) ===== */
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              md: "repeat(3, minmax(0, 1fr))",
            },
            gap: 2, // tương đương spacing={2}
            alignItems: "stretch",
          }}
        >
          {list?.map((r, idx) => (
            <DesktopCard r={r} idx={idx} key={r?._id || r?.user?._id || idx} />
          ))}
        </Box>
      ) : (
        /* ===== DESKTOP TABLE (list) ===== */
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Ảnh</TableCell>
                <TableCell>Nick</TableCell>
                <TableCell>Tuổi</TableCell>
                <TableCell>Giới&nbsp;tính</TableCell>
                <TableCell>Tỉnh</TableCell>
                <TableCell>Điểm&nbsp;đôi</TableCell>
                <TableCell>Điểm&nbsp;đơn</TableCell>
                <TableCell>Cập nhật</TableCell>
                <TableCell>Tham gia</TableCell>
                <TableCell>Xác thực</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list?.map((r, idx) => {
                const u = r?.user || {};
                const effectiveStatus =
                  (u && u._id && cccdPatch[u._id]) || u?.cccdStatus;
                const badge = cccdBadge(effectiveStatus);
                const avatarSrc =
                  u?.avatar || PLACE + u?.nickname?.slice(0, 1)?.toUpperCase();
                const tierHex = HEX[r?.tierColor] || HEX.grey;
                const age = calcAge(u);
                const canGrade = canGradeUser(me, u?.province);
                const patched = getPatched(r, u);
                const allowKyc = canViewKycAdmin(me, effectiveStatus);

                const uid = u?._id && String(u._id);
                const topMedal = uid ? topMedalByUser.get(uid) : null;
                const label = uid ? labelByUser.get(uid) : null;

                return (
                  <TableRow key={r?._id || u?._id} hover>
                    <TableCell>{page * 10 + idx + 1}</TableCell>
                    <TableCell>
                      <Box sx={topMedal ? flameRingSx(topMedal) : undefined}>
                        <Avatar
                          src={avatarSrc}
                          alt={u?.nickname || "?"}
                          sx={{ width: 32, height: 32, cursor: "zoom-in" }}
                          onClick={() => openZoom(avatarSrc)}
                        />
                      </Box>
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
                    <TableCell>{genderLabel(u?.gender)}</TableCell>
                    <TableCell>{u?.province || "--"}</TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(patched.double)}
                    </TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(patched.single)}
                    </TableCell>
                    <TableCell>
                      {patched?.updatedAt
                        ? new Date(patched.updatedAt).toLocaleDateString()
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {u?.createdAt
                        ? new Date(u.createdAt).toLocaleDateString()
                        : "--"}
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
                          Hồ sơ
                        </Button>
                        {canGrade && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openGrade(u, r)}
                          >
                            Chấm trình
                          </Button>
                        )}
                        {allowKyc && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => openKyc(u)}
                          >
                            Xem KYC
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

      {totalPages > 1 && !isLoading && (
        <Box mt={2} display="flex" justifyContent="center">
          <Pagination
            count={totalPages}
            page={page + 1}
            onChange={(_, v) => dispatch(setPage(v - 1))}
            color="primary"
          />
        </Box>
      )}

      <PublicProfileDialog
        open={openProfile}
        onClose={handleCloseProfile}
        userId={selectedId}
        refreshKey={profileRefreshKey}
      />

      {/* Zoom dialog (avatar) */}
      <Dialog
        open={zoomOpen}
        onClose={closeZoom}
        maxWidth="sm"
        fullWidth
        sx={{ zIndex: (t) => t.zIndex.tooltip + 2 }}
        slotProps={{ paper: { sx: { borderRadius: 2 } } }}
      >
        <DialogTitle>Ảnh KYC</DialogTitle>
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
          <Button onClick={closeZoom}>Đóng</Button>
        </DialogActions>
      </Dialog>

      {/* KYC Drawer */}
      {/* ... (phần Drawer giữ nguyên như bản trước của bạn) ... */}
      {/* Mình không cắt dán lại toàn bộ cho gọn tin nhắn, nhưng không đổi logic phần Drawer/KYC/Grade Dialog */}

      {/* KYC Drawer */}
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
              <Grid item xs={12} md={12} sx={{ width: "100%" }}>
                <Grid container spacing={2} sx={{ width: "100%" }}>
                  {["front", "back"].map((side) => (
                    <Grid item xs={6} key={side} sx={{ width: "100%" }}>
                      <Paper
                        variant="outlined"
                        sx={{ borderRadius: 2, overflow: "hidden" }}
                      >
                        <Box
                          sx={{
                            position: "relative",
                            cursor: "zoom-in",
                            bgcolor: "background.default",
                          }}
                          onClick={() => openZoom(kycView?.cccdImages?.[side])}
                        >
                          <img
                            src={kycView?.cccdImages?.[side]}
                            alt={side}
                            style={{
                              display: "block",
                              width: "100%",
                              height: "auto",
                              maxHeight: 320,
                              objectFit: "contain",
                            }}
                          />
                          <Chip
                            size="small"
                            label={side === "front" ? "Mặt trước" : "Mặt sau"}
                            sx={{
                              position: "absolute",
                              top: 8,
                              left: 8,
                              bgcolor: "rgba(0,0,0,0.6)",
                              color: "#fff",
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                        </Box>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </Grid>

              <Grid item xs={12} md={12} sx={{ width: "100%" }}>
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
                          cccdPatch[kycView?._id] || kycView?.cccdStatus
                        ).text
                      }
                      color={
                        cccdBadge(
                          cccdPatch[kycView?._id] || kycView?.cccdStatus
                        ).color
                      }
                    />
                  </Stack>

                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "120px 1fr", md: "140px 1fr" },
                      rowGap: 1,
                      columnGap: 1.5,
                      "& .label": { color: "text.secondary", fontSize: 14 },
                      "& .value": { fontWeight: 600, fontSize: 15 },
                    }}
                  >
                    <Box className="label">Họ & tên</Box>
                    <Box className="value">{kycView?.name || "—"}</Box>

                    <Box className="label">Ngày sinh</Box>
                    <Box className="value">{prettyDate(kycView?.dob)}</Box>

                    <Box className="label">Số CCCD</Box>
                    <Box className="value" sx={{ fontFamily: "monospace" }}>
                      {kycView?.cccd || "—"}
                    </Box>

                    <Box className="label">Tỉnh / Thành</Box>
                    <Box className="value">{kycView?.province || "—"}</Box>
                  </Box>

                  {kycView?.note && (
                    <Box
                      sx={{
                        mt: 1.5,
                        p: 1.25,
                        bgcolor: "grey.50",
                        borderRadius: 1,
                      }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Ghi chú
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
              <Alert severity="info">Không có dữ liệu KYC để hiển thị.</Alert>
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
            <Button onClick={closeKyc}>Đóng</Button>
            <Button
              color="error"
              startIcon={<CancelIcon fontSize="small" />}
              onClick={() => doReview("reject")}
              disabled={reviewing || !kycView?._id}
            >
              Từ chối
            </Button>
            <Button
              color="success"
              startIcon={<VerifiedIcon fontSize="small" />}
              onClick={() => doReview("approve")}
              disabled={reviewing || !kycView?._id}
            >
              Duyệt
            </Button>
          </Stack>
        </Box>
      </Drawer>

      {/* Grade dialog */}
      <Dialog
        open={gradeDlg.open}
        onClose={() => setGradeDlg({ open: false })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Chấm trình – {gradeDlg.nickname}</DialogTitle>
        <DialogContent
          dividers
          sx={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <TextField
            label={`Điểm đơn (${MIN_RATING} – ${MAX_RATING})`}
            type="number"
            inputProps={{ step: "0.05", min: MIN_RATING, max: MAX_RATING }}
            value={gradeSingles}
            onChange={(e) => setGradeSingles(e.target.value)}
          />
          <TextField
            label={`Điểm đôi (${MIN_RATING} – ${MAX_RATING})`}
            type="number"
            inputProps={{ step: "0.05", min: MIN_RATING, max: MAX_RATING }}
            value={gradeDoubles}
            onChange={(e) => setGradeDoubles(e.target.value)}
          />
          <TextField
            label="Ghi chú"
            multiline
            minRows={2}
            value={gradeNotes}
            onChange={(e) => setGradeNotes(e.target.value)}
          />
          {me?.role === "admin" ? (
            <Alert severity="success">
              Bạn là admin: có thể chấm tất cả tỉnh.
            </Alert>
          ) : (
            <Alert severity="info">
              Tỉnh áp dụng: <b>{gradeDlg.province || "--"}</b>. Bạn chỉ có thể
              chấm khi thuộc phạm vi được cấp.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGradeDlg({ open: false })}>Huỷ</Button>
          <Button onClick={submitGrade} disabled={creating} variant="contained">
            {creating ? "Đang lưu..." : "Gửi chấm trình"}
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
    </Container>
  );
}
