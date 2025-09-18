// RankingList.jsx
import { useEffect, useState } from "react";
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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import VerifiedIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";

import { Link, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setKeyword, setPage } from "../../slices/rankingUiSlice";
import { useGetRankingsQuery } from "../../slices/rankingsApiSlice";
import PublicProfileDialog from "../../components/PublicProfileDialog";

import { useGetMeQuery } from "../../slices/usersApiSlice";
import { useCreateEvaluationMutation } from "../../slices/evaluationsApiSlice";
import { useReviewKycMutation } from "../../slices/adminApiSlice";
import { skipToken } from "@reduxjs/toolkit/query";

const PLACE = "https://dummyimage.com/40x40/cccccc/ffffff&text=?";
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

/* ================= helpers ================= */
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

// chip xác thực
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

const Legend = () => (
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
    <Chip label="Điểm đỏ: Tự chấm" sx={{ bgcolor: HEX.red, color: "#fff" }} />
    <Chip
      label="Điểm xám: Chưa xác thực"
      sx={{ bgcolor: HEX.grey, color: "#fff" }}
    />
  </Stack>
);

// quyền chấm
const canGradeUser = (me, targetProvince) => {
  if (me?.role === "admin") return true;
  if (!me?.evaluator?.enabled) return false;
  const scopes = me?.evaluator?.gradingScopes?.provinces || [];
  return !!targetProvince && scopes.includes(String(targetProvince).trim());
};

// quyền xem KYC: chỉ admin & chỉ khi CCCD pending/verified
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

export default function RankingList() {
  const dispatch = useDispatch();
  const { keyword, page } = useSelector((s) => s?.rankingUi || {});
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data = { docs: [], totalPages: 0 },
    isLoading,
    error,
    refetch,
  } = useGetRankingsQuery({ keyword, page });

  const { docs: list, totalPages } = data;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme?.breakpoints?.down("sm"));
  const isDesktop = useMediaQuery(theme?.breakpoints?.up("md"));
  const DRAWER_WIDTH_DESKTOP = 380; // ← đổi 350/400 theo ý bạn

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

  // URL -> Redux
  useEffect(() => {
    const urlPage = parsePageFromParams(searchParams);
    if (urlPage !== page) dispatch(setPage(urlPage));
    const urlQ = parseKeywordFromParams(searchParams);
    if ((urlQ || "") !== (keyword || "")) dispatch(setKeyword(urlQ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Redux -> URL
  useEffect(() => {
    const curPageParam = searchParams.get("page");
    const desiredPageParam = page > 0 ? String(page + 1) : null;
    const curQ = searchParams.get("q") ?? "";
    const desiredQ = keyword || "";
    const needPageUpdate = curPageParam !== desiredPageParam;
    const needQUpdate = curQ !== desiredQ;
    if (needPageUpdate || needQUpdate) {
      const next = new URLSearchParams(searchParams);
      if (desiredPageParam) next.set("page", desiredPageParam);
      else next.delete("page");
      if (desiredQ) next.set("q", desiredQ);
      else next.delete("q");
      setSearchParams(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, keyword]);

  // debounce refetch theo keyword
  useEffect(() => {
    const t = setTimeout(refetch, 300);
    return () => clearTimeout(t);
  }, [keyword, refetch]);

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

  // Dialog chấm điểm
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

  // patch điểm tạm
  const [patchMap, setPatchMap] = useState({});
  const getPatched = (r, u) => {
    const p = patchMap[u?._id || ""];
    return {
      single: p?.single ?? r?.single,
      double: p?.double ?? r?.double,
      updatedAt: p?.updatedAt ?? r?.updatedAt,
    };
  };

  const getBaselineScores2 = (u, r) => {
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

  const openGrade = (u, r) => {
    const base = getBaselineScores2(u, r);
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

  // ============== Xem KYC (Drawer full-screen) ==============
  const [kycView, setKycView] = useState(null); // u object
  const [reviewKycMut, { isLoading: reviewing }] = useReviewKycMutation();
  const [cccdPatch, setCccdPatch] = useState({}); // { userId: 'verified'|'rejected' }

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

  /* ================= render ================= */
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5" fontWeight={600}>
          Bảng xếp hạng
        </Typography>
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
      </Box>

      {/* Legend */}
      <Legend />

      <TextField
        label="Tìm kiếm"
        variant="outlined"
        size="small"
        value={keyword || ""}
        onChange={(e) => dispatch(setKeyword(e?.target?.value))}
        sx={{ mb: 2, width: 300 }}
      />

      {error ? (
        <Alert severity="error">{error?.data?.message || error?.error}</Alert>
      ) : isLoading ? (
        isMobile ? (
          /* mobile skeleton */
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
        ) : (
          /* desktop skeleton */
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
        /* ===== MOBILE LIST ===== */
        <Stack spacing={2}>
          {list?.map((r) => {
            const u = r?.user || {};
            const effectiveStatus = cccdPatch[u?._id] || u?.cccdStatus; // patched
            const badge = cccdBadge(effectiveStatus);
            const avatarSrc = u?.avatar || PLACE;
            const tierHex = HEX[r?.tierColor] || HEX.grey;
            const age = calcAge(u);
            const canGrade = canGradeUser(me, u?.province);

            const p = (id) => patchMap[id || ""] || {};
            const patched = {
              single: p(u?._id)?.single ?? r?.single,
              double: p(u?._id)?.double ?? r?.double,
              updatedAt: p(u?._id)?.updatedAt ?? r?.updatedAt,
            };

            // ✅ chỉ admin + CCCD pending/verified mới thấy nút KYC
            const allowKyc = canViewKycAdmin(me, effectiveStatus);

            return (
              <Card key={r?._id || u?._id} variant="outlined">
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1} gap={2}>
                    <Avatar
                      src={avatarSrc}
                      alt={u?.nickname || "?"}
                      onClick={() => openZoom(avatarSrc)}
                      sx={{ cursor: "zoom-in" }}
                    />
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
      ) : (
        /* ===== DESKTOP TABLE ===== */
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
                const effectiveStatus = cccdPatch[u?._id] || u?.cccdStatus; // patched
                const badge = cccdBadge(effectiveStatus);
                const avatarSrc = u?.avatar || PLACE;
                const tierHex = HEX[r?.tierColor] || HEX.grey;
                const age = calcAge(u);
                const canGrade = canGradeUser(me, u?.province);

                const p = (id) => patchMap[id || ""] || {};
                const patched = {
                  single: p(u?._id)?.single ?? r?.single,
                  double: p(u?._id)?.double ?? r?.double,
                  updatedAt: p(u?._id)?.updatedAt ?? r?.updatedAt,
                };

                // ✅ chỉ admin + CCCD pending/verified mới thấy nút KYC
                const allowKyc = canViewKycAdmin(me, effectiveStatus);

                return (
                  <TableRow key={r?._id || u?._id} hover>
                    <TableCell>{page * 10 + idx + 1}</TableCell>
                    <TableCell>
                      <Avatar
                        src={avatarSrc}
                        alt={u?.nickname || "?"}
                        sx={{ width: 32, height: 32, cursor: "zoom-in" }}
                        onClick={() => openZoom(avatarSrc)}
                      />
                    </TableCell>
                    <TableCell>{u?.nickname || "--"}</TableCell>
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
        slotProps={{
          paper: { sx: { borderRadius: 2 } },
        }}
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

      {/* ============ Drawer xem KYC full-screen ============ */}
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
              {/* LEFT: Ảnh */}
              <Grid item xs={12} md={12} sx={{ width: "100%" }}>
                <Grid container spacing={2} sx={{ width: "100%" }}>
                  {["front", "back"].map((side) => (
                    <Grid item xs={6} key={side} sx={{ width: "100%" }}>
                      <Paper
                        variant="outlined"
                        sx={{
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
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

              {/* RIGHT: Thông tin */}
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

        {/* Footer actions */}
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

      {/* Dialog chấm điểm */}
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
