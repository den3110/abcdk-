// src/pages/admin/UsersPage.jsx
/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import {
  Box,
  Stack,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  FormControlLabel,
  Snackbar,
  Alert,
  Pagination,
  CircularProgress,
  InputAdornment,
  Typography,
  useMediaQuery,
  Paper,
  Divider,
  Avatar,
  Card,
  Collapse,
  Grid,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";

// Icons
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import VerifiedIcon from "@mui/icons-material/Verified";
import CancelIcon from "@mui/icons-material/Cancel";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import SaveIcon from "@mui/icons-material/Save";
import FilterListIcon from "@mui/icons-material/FilterList";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import BadgeIcon from "@mui/icons-material/Badge";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";

import { useDispatch, useSelector } from "react-redux";

import {
  useGetUsersQuery,
  useUpdateUserRoleMutation,
  useUpdateUserInfoMutation,
  useReviewKycMutation,
  useUpdateRankingMutation,
  useChangeUserPasswordMutation,
  usePromoteToEvaluatorMutation,
  useDemoteEvaluatorMutation,
  useDeleteUserMutation,
  useUpdateRankingSearchConfigMutation,
  useGetUserAuditQuery,
} from "../../slices/adminApiSlice";
import { setPage, setKeyword, setRole } from "../../slices/adminUiSlice";

import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";

/* ================== Utils & Consts ================== */
const GENDER_OPTIONS = [
  { value: "unspecified", label: "--" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
];

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
const PROVINCES_SET = new Set(PROVINCES);

const KYC_LABEL = {
  unverified: "Chưa KYC",
  pending: "Chờ duyệt",
  verified: "Đã xác thực",
  rejected: "Từ chối",
};

const KYC_COLOR = {
  unverified: "default",
  pending: "warning",
  verified: "success",
  rejected: "error",
};

const prettyDate = (d) => (d ? new Date(d).toLocaleDateString("vi-VN") : "—");
const roleText = (r) =>
  r === "admin" ? "Admin" : r === "referee" ? "Trọng tài" : "User";

const getEvalProvinces = (u) =>
  Array.isArray(u?.evaluator?.gradingScopes?.provinces)
    ? u.evaluator.gradingScopes.provinces.filter(Boolean)
    : [];
const getIsFullEvaluator = (u) => {
  const list = getEvalProvinces(u);
  if (!list.length) return false;
  const normalized = Array.from(
    new Set(list.filter((p) => PROVINCES_SET.has(p)))
  );
  return normalized.length === PROVINCES.length;
};

// Hàm tạo màu avatar từ tên
function stringToColor(string) {
  let hash = 0;
  let i;
  /* eslint-disable no-bitwise */
  for (i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = "#";
  for (i = 0; i < 3; i += 1) {
    const value = (hash >> (i * 8)) & 0xff;
    color += `00${value.toString(16)}`.slice(-2);
  }
  /* eslint-enable no-bitwise */
  return color;
}
function stringAvatar(name) {
  const n = name || "?";
  return {
    sx: {
      bgcolor: stringToColor(n),
      fontSize: 16,
      fontWeight: "bold",
    },
    children: n.includes(" ")
      ? `${n.split(" ")[0][0]}${n.split(" ")[1][0]}`.toUpperCase()
      : n.substr(0, 2).toUpperCase(),
  };
}

/* ================== Page Component ================== */
export default function UsersPage() {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down("sm"));
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));

  const dispatch = useDispatch();
  const { page, keyword, role = "" } = useSelector((s) => s.adminUi);
  const [kycFilter, setKycFilter] = useState("");

  // query
  const { data, isFetching, refetch } = useGetUsersQuery(
    { page: page + 1, keyword, role, cccdStatus: kycFilter },
    { refetchOnMountOrArgChange: true }
  );

  // mutations
  const [updateRoleMut] = useUpdateUserRoleMutation();
  const [updateInfoMut] = useUpdateUserInfoMutation();
  const [reviewKycMut] = useReviewKycMutation();
  const [updateRanking] = useUpdateRankingMutation();
  const [changePasswordMut, { isLoading: changingPass }] =
    useChangeUserPasswordMutation();
  const [promoteEvaluatorMut] = usePromoteToEvaluatorMutation();
  const [demoteEvaluatorMut] = useDemoteEvaluatorMutation();
  const [deleteUserMut] = useDeleteUserMutation();
  const [updateRankingSearchConfigMut] = useUpdateRankingSearchConfigMutation();

  // UI state
  const [search, setSearch] = useState(keyword);
  useEffect(() => {
    const t = setTimeout(() => dispatch(setKeyword(search.trim())), 500);
    return () => clearTimeout(t);
  }, [search, dispatch]);

  const [edit, setEdit] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [del, setDel] = useState(null);
  const [score, setScore] = useState(null);

  // ✅ ADD: Audit history dialog
  const [auditUser, setAuditUser] = useState(null);
  const [auditPage, setAuditPage] = useState(1);
  const AUDIT_LIMIT = 20;

  const {
    data: auditData,
    isFetching: auditFetching,
    refetch: refetchAudit,
    error: auditError,
  } = useGetUserAuditQuery(
    auditUser
      ? { userId: auditUser._id, page: auditPage, limit: AUDIT_LIMIT }
      : { userId: "" },
    { skip: !auditUser }
  );

  useEffect(() => {
    if (!auditUser) setAuditPage(1);
  }, [auditUser]);

  const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("vi-VN") : "—");

  const fmtVal = (v) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return "—";
      return s.length > 140 ? `${s.slice(0, 140)}…` : s;
    }
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try {
      const s = JSON.stringify(v);
      return s.length > 140 ? `${s.slice(0, 140)}…` : s;
    } catch {
      return String(v);
    }
  };

  const [snack, setSnack] = useState({ open: false, type: "success", msg: "" });
  const showSnack = (type, msg) => setSnack({ open: true, type, msg });

  // FULL tỉnh optimistic
  const [fullMap, setFullMap] = useState({});
  useEffect(() => {
    if (data?.users) {
      const next = {};
      data.users.forEach((u) => (next[u._id] = getIsFullEvaluator(u)));
      setFullMap(next);
    }
  }, [data?.users]);

  const handle = async (promise, successMsg) => {
    try {
      const res = await promise;
      showSnack("success", successMsg);
      await refetch();
      return res;
    } catch (err) {
      showSnack("error", err?.data?.message || err.error || "Đã xảy ra lỗi");
      throw err;
    }
  };

  const toggleAdminEvaluator = async (userId, enable) => {
    setFullMap((m) => ({ ...m, [userId]: enable }));
    try {
      if (enable) {
        await promoteEvaluatorMut({
          idOrEmail: userId,
          provinces: PROVINCES,
          sports: [],
        }).unwrap();
        showSnack("success", "Đã bật Admin chấm trình (FULL tỉnh)");
      } else {
        await demoteEvaluatorMut({
          id: userId,
          body: { toRole: "user" },
        }).unwrap();
        showSnack("success", "Đã tắt Admin chấm trình");
      }
      refetch();
    } catch (err) {
      setFullMap((m) => ({ ...m, [userId]: !enable }));
      showSnack("error", err?.data?.message || err.error || "Đã xảy ra lỗi");
    }
  };

  const users = data?.users ?? [];
  const serverTotalPages = data
    ? Math.ceil((data.total || 0) / (data.pageSize || 1))
    : 0;

  // ========= COMPONENT: USER CARD =========
  const UserCard = ({ u }) => {
    const isFull = !!fullMap[u._id];
    const [expanded, setExpanded] = useState(false);

    // Limit logic
    const [limitInput, setLimitInput] = useState(
      typeof u.rankingSearchLimit === "number" && u.rankingSearchLimit > 0
        ? String(u.rankingSearchLimit)
        : ""
    );
    const [unlimited, setUnlimited] = useState(!!u.rankingSearchUnlimited);
    const [savingLimit, setSavingLimit] = useState(false);

    useEffect(() => {
      setLimitInput(
        typeof u.rankingSearchLimit === "number" && u.rankingSearchLimit > 0
          ? String(u.rankingSearchLimit)
          : ""
      );
      setUnlimited(!!u.rankingSearchUnlimited);
    }, [u.rankingSearchLimit, u.rankingSearchUnlimited, u._id]);

    const handleSaveLimit = async () => {
      const body = { unlimited };
      if (limitInput === "") {
        body.limit = null;
      } else {
        const parsed = Number(limitInput);
        if (!Number.isFinite(parsed) || parsed < 0) {
          showSnack("error", "Limit không hợp lệ");
          return;
        }
        body.limit = parsed;
      }
      setSavingLimit(true);
      try {
        await handle(
          updateRankingSearchConfigMut({ id: u._id, body }).unwrap(),
          "Cập nhật cấu hình tìm kiếm xếp hạng thành công."
        );
      } catch (e) {
        // handled
      } finally {
        setSavingLimit(false);
      }
    };

    return (
      <Card
        sx={{
          mb: 2,
          border: "1px solid",
          borderColor: "divider",
          boxShadow: theme.shadows[1],
          transition: "all 0.3s",
          "&:hover": {
            boxShadow: theme.shadows[4],
            borderColor: theme.palette.primary.main,
          },
        }}
      >
        {/* === Header: Basic Info & Main Actions === */}
        <Box sx={{ p: 2, display: "flex", alignItems: "flex-start", gap: 2 }}>
          <Avatar
            {...stringAvatar(u.name)}
            sx={{ width: 48, height: 48, ...stringAvatar(u.name).sx }}
          />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              flexWrap="wrap"
            >
              <Typography
                variant="h6"
                sx={{ fontSize: "1rem", fontWeight: 700 }}
                noWrap
              >
                {u.name}
              </Typography>
              {u.role !== "user" && (
                <Chip
                  label={roleText(u.role)}
                  size="small"
                  color={u.role === "admin" ? "error" : "info"}
                  variant="outlined"
                  sx={{ height: 20, fontSize: "0.7rem" }}
                />
              )}
              <Chip
                size="small"
                icon={u.cccdStatus === "verified" ? <VerifiedIcon /> : null}
                label={KYC_LABEL[u.cccdStatus || "unverified"]}
                color={KYC_COLOR[u.cccdStatus || "unverified"]}
                sx={{ height: 20, fontSize: "0.7rem" }}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {u.email}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.5 }}
            >
              Phone: {u.phone || "--"} • {u.province || "Chưa cập nhật tỉnh"}
            </Typography>

            {/* Stats Chips */}
            {/* Stats & CCCD / KYC action */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              mt={1}
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Stack direction="row" spacing={1}>
                <Chip
                  icon={<SportsTennisIcon sx={{ fontSize: 14 }} />}
                  label={`Đơn: ${u.single ?? "-"}`}
                  size="small"
                  sx={{
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    color: "primary.main",
                    fontWeight: 600,
                  }}
                />
                <Chip
                  icon={<SportsTennisIcon sx={{ fontSize: 14 }} />}
                  label={`Đôi: ${u.double ?? "-"}`}
                  size="small"
                  sx={{
                    bgcolor: alpha(theme.palette.secondary.main, 0.1),
                    color: "secondary.main",
                    fontWeight: 600,
                  }}
                />
              </Stack>

              {u.cccdImages?.front && (
                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  startIcon={<BadgeIcon sx={{ fontSize: 16 }} />}
                  onClick={() => setKyc(u)}
                  sx={{
                    textTransform: "none",
                    fontWeight: 600,
                  }}
                >
                  Xem CCCD / KYC
                </Button>
              )}
            </Stack>
          </Box>

          {/* Quick Actions (Desktop) */}
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Lịch sử chỉnh sửa">
              <IconButton
                size="small"
                onClick={() => setAuditUser(u)} // ✅ OPEN DIALOG
                sx={{ color: "text.secondary" }}
              >
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Cập nhật điểm">
              <IconButton
                size="small"
                onClick={() => setScore({ ...u })}
                sx={{ color: "primary.main" }}
              >
                <VerifiedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Sửa thông tin">
              <IconButton size="small" onClick={() => setEdit({ ...u })}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Xoá người dùng">
              <IconButton
                size="small"
                onClick={() => setDel(u)}
                sx={{ color: "error.main" }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {/* === Divider & Expand Button === */}
        <Divider />
        <Box
          sx={{
            px: 2,
            py: 0.5,
            bgcolor: expanded ? "grey.50" : "transparent",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            "&:hover": { bgcolor: "grey.50" },
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, color: "text.secondary" }}
          >
            {expanded
              ? "Ẩn cấu hình nâng cao"
              : "Cấu hình nâng cao (Role, Limit Search...)"}
          </Typography>
          <IconButton
            size="small"
            sx={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "0.3s",
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* === Expanded Configuration === */}
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ p: 2, bgcolor: "grey.50" }}>
            <Grid container spacing={2}>
              {/* Col 1: Role & Evaluator */}
              <Grid size={{ xs: 12, md: 5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  display="block"
                  mb={1}
                >
                  PHÂN QUYỀN &amp; CHẤM TRÌNH
                </Typography>
                <Stack spacing={2}>
                  <FormControl size="small" fullWidth sx={{ bgcolor: "white" }}>
                    <InputLabel>Role</InputLabel>
                    <Select
                      label="Role"
                      value={u.role}
                      onChange={(e) =>
                        handle(
                          updateRoleMut({
                            id: u._id,
                            role: e.target.value,
                          }).unwrap(),
                          "Đã cập nhật role"
                        )
                      }
                    >
                      <MenuItem value="user">User</MenuItem>
                      <MenuItem value="referee">Trọng tài</MenuItem>
                      <MenuItem value="admin">Admin</MenuItem>
                    </Select>
                  </FormControl>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 1,
                      bgcolor: "white",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={isFull}
                      onChange={(e) =>
                        toggleAdminEvaluator(u._id, e.target.checked)
                      }
                    />
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        Admin chấm trình (Full tỉnh)
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Quyền chấm điểm mọi khu vực
                      </Typography>
                    </Box>
                  </Paper>
                </Stack>
              </Grid>

              {/* Col 2: Search Quota */}
              <Grid size={{ xs: 12, md: 7 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  display="block"
                  mb={1}
                >
                  QUOTA TÌM KIẾM
                </Typography>
                <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "white" }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    alignItems="center"
                  >
                    <TextField
                      size="small"
                      type="number"
                      label="Limit/ngày"
                      value={limitInput}
                      onChange={(e) => setLimitInput(e.target.value)}
                      placeholder="Mặc định (5)"
                      sx={{ flex: 1 }}
                      InputLabelProps={{ shrink: true }}
                    />
                    <FormControlLabel
                      sx={{ "& .MuiTypography-root": { fontSize: 13 } }}
                      control={
                        <Checkbox
                          size="small"
                          checked={unlimited}
                          onChange={(e) => setUnlimited(e.target.checked)}
                        />
                      }
                      label="Không giới hạn"
                    />
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SaveIcon />}
                      onClick={handleSaveLimit}
                      disabled={savingLimit}
                      sx={{ minWidth: 80 }}
                    >
                      Lưu
                    </Button>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        </Collapse>
      </Card>
    );
  };

  /* ============ Password local states ============ */
  const [changePass, setChangePass] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (edit) {
      setChangePass(false);
      setNewPass("");
      setConfirmPass("");
      setShowNew(false);
      setShowConfirm(false);
    }
  }, [edit]);

  const passTooShort = newPass && newPass.length < 6;
  const passNotMatch = confirmPass && confirmPass !== newPass;
  const canChangePass =
    !!edit &&
    changePass &&
    newPass.length >= 6 &&
    confirmPass === newPass &&
    !changingPass;

  /* ================== Main Render ================== */
  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", p: { xs: 1, md: 3 } }}>
      {/* Header Title */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mb={3}
      >
        <Typography
          variant="h5"
          fontWeight={800}
          sx={{ color: "text.primary" }}
        >
          Quản lý người dùng
        </Typography>
      </Stack>

      {/* FILTER BAR */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems="center"
        >
          <TextField
            name="search-query"
            size="small"
            placeholder="Tìm kiếm theo Tên, Email..."
            value={search}
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            InputProps={{
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            }}
            sx={{ flex: 2 }}
          />

          <Stack
            direction="row"
            spacing={2}
            sx={{ width: { xs: "100%", md: "auto" }, flex: 1 }}
          >
            <FormControl size="small" fullWidth>
              <InputLabel id="role-filter">Role</InputLabel>
              <Select
                labelId="role-filter"
                label="Role"
                value={role}
                onChange={(e) => {
                  dispatch(setRole(e.target.value));
                  dispatch(setPage(0));
                }}
              >
                <MenuItem value="">Tất cả Role</MenuItem>
                <MenuItem value="user">User</MenuItem>
                <MenuItem value="referee">Trọng tài</MenuItem>
                <MenuItem value="admin">Admin</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel id="cccd-filter">Trạng thái KYC</InputLabel>
              <Select
                labelId="cccd-filter"
                label="Trạng thái KYC"
                value={kycFilter}
                onChange={(e) => {
                  setKycFilter(String(e.target.value));
                  dispatch(setPage(0));
                }}
              >
                <MenuItem value="">Tất cả</MenuItem>
                <MenuItem value="unverified">{KYC_LABEL.unverified}</MenuItem>
                <MenuItem value="pending">{KYC_LABEL.pending}</MenuItem>
                <MenuItem value="verified">{KYC_LABEL.verified}</MenuItem>
                <MenuItem value="rejected">{KYC_LABEL.rejected}</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </Stack>
      </Paper>

      {/* LIST USERS */}
      <Box>
        {isFetching ? (
          <Stack alignItems="center" py={8}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary" mt={2}>
              Đang tải dữ liệu...
            </Typography>
          </Stack>
        ) : users.length === 0 ? (
          <Paper
            sx={{ py: 8, textAlign: "center", borderStyle: "dashed" }}
            variant="outlined"
          >
            <FilterListIcon
              sx={{ fontSize: 48, color: "text.disabled", mb: 1 }}
            />
            <Typography variant="h6" color="text.secondary">
              Không tìm thấy người dùng nào
            </Typography>
            <Typography variant="body2" color="text.disabled">
              Thử thay đổi bộ lọc tìm kiếm
            </Typography>
          </Paper>
        ) : (
          <Box>
            {users.map((u) => (
              <UserCard key={u._id} u={u} />
            ))}
          </Box>
        )}
      </Box>

      {/* Pagination */}
      {serverTotalPages > 1 && (
        <Box py={3} display="flex" justifyContent="center">
          <Pagination
            page={page + 1}
            count={serverTotalPages}
            color="primary"
            onChange={(_, v) => dispatch(setPage(v - 1))}
            size="large"
            shape="rounded"
          />
        </Box>
      )}

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert severity={snack.type} variant="filled" sx={{ width: "100%" }}>
          {snack.msg}
        </Alert>
      </Snackbar>

      {/* Zoom ảnh */}
      <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="lg">
        {zoom && (
          <img
            src={zoom}
            alt="zoom"
            style={{
              maxWidth: "100%",
              maxHeight: "90vh",
              objectFit: "contain",
            }}
            onClick={() => setZoom(null)}
          />
        )}
      </Dialog>

      {/* KYC dialog */}
      <Dialog
        open={!!kyc}
        onClose={() => setKyc(null)}
        maxWidth="md"
        fullWidth
        fullScreen={isXs}
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        {kyc && (
          <>
            <DialogTitle sx={{ borderBottom: "1px solid #eee" }}>
              Kiểm tra CCCD - {kyc.name}
            </DialogTitle>
            <DialogContent sx={{ pt: 3, bgcolor: "grey.50" }}>
              <Grid container spacing={3}>
                <Grid size={{ xs: 12 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    {["front", "back"].map((side) => (
                      <Paper
                        key={side}
                        elevation={0}
                        variant="outlined"
                        sx={{
                          flex: 1,
                          p: 1,
                          bgcolor: "white",
                          textAlign: "center",
                        }}
                      >
                        <Box
                          component="img"
                          src={kyc.cccdImages?.[side]}
                          alt={side}
                          sx={{
                            width: "100%",
                            height: 200,
                            objectFit: "contain",
                            cursor: "zoom-in",
                            display: "block",
                          }}
                          onClick={() => setZoom(kyc.cccdImages?.[side])}
                        />
                        <Typography
                          variant="caption"
                          sx={{
                            mt: 1,
                            display: "block",
                            fontWeight: 600,
                            color: "text.secondary",
                            textTransform: "uppercase",
                          }}
                        >
                          {side === "front" ? "Mặt trước" : "Mặt sau"}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12 }}>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: "white" }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      mb={2}
                    >
                      <Typography variant="subtitle2" fontWeight={700}>
                        THÔNG TIN NGƯỜI DÙNG
                      </Typography>
                      <Chip
                        size="small"
                        label={KYC_LABEL[kyc.cccdStatus || "unverified"]}
                        color={KYC_COLOR[kyc.cccdStatus || "unverified"]}
                      />
                    </Stack>

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          Họ tên:
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {kyc.name}
                        </Typography>
                      </Grid>

                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          Ngày sinh:
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {prettyDate(kyc.dob)}
                        </Typography>
                      </Grid>

                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          Số CCCD:
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          fontFamily="monospace"
                        >
                          {kyc.cccd}
                        </Typography>
                      </Grid>

                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          Khu vực:
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 6, md: 3 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {kyc.province}
                        </Typography>
                      </Grid>
                    </Grid>

                    {kyc.note && (
                      <Alert severity="info" sx={{ mt: 2 }} icon={false}>
                        <Typography
                          variant="caption"
                          display="block"
                          fontWeight={700}
                        >
                          Ghi chú:
                        </Typography>
                        {kyc.note}
                      </Alert>
                    )}
                  </Paper>
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #eee" }}>
              <Button
                onClick={() => setKyc(null)}
                variant="outlined"
                color="inherit"
              >
                Đóng
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() =>
                  handle(
                    reviewKycMut({ id: kyc._id, action: "reject" }).unwrap(),
                    "Đã từ chối KYC"
                  ).then(() => setKyc(null))
                }
              >
                Từ chối
              </Button>
              <Button
                variant="contained"
                color="success"
                startIcon={<VerifiedIcon />}
                onClick={() =>
                  handle(
                    reviewKycMut({ id: kyc._id, action: "approve" }).unwrap(),
                    "Đã duyệt KYC"
                  ).then(() => setKyc(null))
                }
              >
                Duyệt
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isXs}
      >
        {edit && (
          <>
            <DialogTitle>Sửa thông tin: {edit.name}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Họ tên"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  fullWidth
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Email"
                    value={edit.email}
                    onChange={(e) =>
                      setEdit({ ...edit, email: e.target.value })
                    }
                    fullWidth
                  />
                  <TextField
                    label="Phone"
                    value={edit.phone || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, phone: e.target.value })
                    }
                    fullWidth
                  />
                </Stack>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Nickname"
                    value={edit.nickname || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, nickname: e.target.value })
                    }
                    fullWidth
                  />
                  <FormControl fullWidth>
                    <InputLabel>Giới tính</InputLabel>
                    <Select
                      label="Giới tính"
                      value={
                        ["male", "female", "unspecified", "other"].includes(
                          edit.gender
                        )
                          ? edit.gender
                          : "unspecified"
                      }
                      onChange={(e) =>
                        setEdit({ ...edit, gender: e.target.value })
                      }
                    >
                      {GENDER_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>

                <Stack direction="row" spacing={2}>
                  <TextField
                    label="CCCD"
                    value={edit.cccd || ""}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        cccd: e.target.value.replace(/\D/g, "").slice(0, 12),
                      })
                    }
                    fullWidth
                    helperText="12 chữ số"
                  />
                  <TextField
                    label="Ngày sinh"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={edit.dob ? String(edit.dob).slice(0, 10) : ""}
                    onChange={(e) => setEdit({ ...edit, dob: e.target.value })}
                    fullWidth
                  />
                </Stack>

                <FormControl fullWidth>
                  <InputLabel>Khu vực (Tỉnh/Thành)</InputLabel>
                  <Select
                    label="Khu vực (Tỉnh/Thành)"
                    value={edit.province || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, province: e.target.value })
                    }
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
                </FormControl>

                {/* Change Password Section */}
                <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={changePass}
                        onChange={(e) => setChangePass(e.target.checked)}
                      />
                    }
                    label={
                      <Typography fontWeight={600}>Đổi mật khẩu</Typography>
                    }
                  />
                  <Collapse in={changePass}>
                    <Stack spacing={2} mt={1}>
                      <TextField
                        label="Mật khẩu mới"
                        type={showNew ? "text" : "password"}
                        value={newPass}
                        onChange={(e) => setNewPass(e.target.value)}
                        error={Boolean(passTooShort)}
                        helperText={passTooShort ? "Tối thiểu 6 ký tự" : ""}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton onClick={() => setShowNew(!showNew)}>
                                {showNew ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                      <TextField
                        label="Xác nhận mật khẩu"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPass}
                        onChange={(e) => setConfirmPass(e.target.value)}
                        error={Boolean(passNotMatch)}
                        helperText={passNotMatch ? "Mật khẩu không khớp" : ""}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => setShowConfirm(!showConfirm)}
                              >
                                {showConfirm ? (
                                  <VisibilityOff />
                                ) : (
                                  <Visibility />
                                )}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                      <Button
                        variant="contained"
                        color="secondary"
                        disabled={!canChangePass}
                        onClick={() =>
                          handle(
                            changePasswordMut({
                              id: edit._id,
                              body: { newPassword: newPass },
                            }).unwrap(),
                            "Đã đổi mật khẩu thành công"
                          ).then(() => {
                            setChangePass(false);
                            setNewPass("");
                            setConfirmPass("");
                          })
                        }
                      >
                        Lưu mật khẩu mới
                      </Button>
                    </Stack>
                  </Collapse>
                </Paper>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
              <Button onClick={() => setEdit(null)} color="inherit">
                Huỷ bỏ
              </Button>
              <Button
                variant="contained"
                onClick={() =>
                  handle(
                    updateInfoMut({
                      id: edit._id,
                      body: {
                        name: edit.name,
                        nickname: edit.nickname,
                        phone: edit.phone,
                        email: edit.email,
                        cccd: edit.cccd,
                        dob: edit.dob,
                        gender: [
                          "male",
                          "female",
                          "unspecified",
                          "other",
                        ].includes(edit.gender)
                          ? edit.gender
                          : "unspecified",
                        province: edit.province,
                      },
                    }).unwrap(),
                    "Đã cập nhật thông tin"
                  ).then(() => setEdit(null))
                }
              >
                Lưu thông tin
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!del} onClose={() => setDel(null)}>
        <DialogTitle
          sx={{
            color: "error.main",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <DeleteIcon /> Xoá người dùng?
        </DialogTitle>
        <DialogContent>
          <Typography>
            Bạn có chắc chắn muốn xoá người dùng <b>{del?.name}</b>?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hành động này không thể hoàn tác.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDel(null)} color="inherit">
            Huỷ
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() =>
              handle(deleteUserMut(del._id).unwrap(), "Đã xoá người dùng").then(
                () => setDel(null)
              )
            }
          >
            Xoá vĩnh viễn
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cập nhật điểm */}
      <Dialog
        open={!!score}
        onClose={() => setScore(null)}
        maxWidth="xs"
        fullWidth
      >
        {score && (
          <>
            <DialogTitle>Cập nhật điểm trình</DialogTitle>
            <DialogContent>
              <Stack spacing={3} mt={1}>
                <TextField
                  label="Điểm Đơn"
                  type="number"
                  value={score.single}
                  onChange={(e) =>
                    setScore({ ...score, single: e.target.value })
                  }
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">điểm</InputAdornment>
                    ),
                  }}
                />
                <TextField
                  label="Điểm Đôi"
                  type="number"
                  value={score.double}
                  onChange={(e) =>
                    setScore({ ...score, double: e.target.value })
                  }
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">điểm</InputAdornment>
                    ),
                  }}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
              <Button onClick={() => setScore(null)} color="inherit">
                Huỷ
              </Button>
              <Button
                variant="contained"
                onClick={() =>
                  handle(
                    updateRanking({
                      id: score._id,
                      single: Number(score.single),
                      double: Number(score.double),
                    }).unwrap(),
                    "Đã cập nhật điểm"
                  ).then(() => setScore(null))
                }
              >
                Lưu điểm
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      {/* ✅ Audit History Dialog */}
      <Dialog
        open={!!auditUser}
        onClose={() => setAuditUser(null)}
        maxWidth="lg"
        fullWidth
        fullScreen={isXs}
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        {auditUser && (
          <>
            <DialogTitle sx={{ borderBottom: "1px solid #eee" }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6" fontWeight={800} noWrap>
                    Lịch sử chỉnh sửa • {auditUser.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {auditUser.email} • ID: {auditUser._id}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} alignItems="center">
                  <Tooltip title="Tải lại">
                    <IconButton
                      onClick={() => refetchAudit?.()}
                      disabled={auditFetching}
                    >
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                  <Button
                    onClick={() => setAuditUser(null)}
                    variant="outlined"
                    color="inherit"
                  >
                    Đóng
                  </Button>
                </Stack>
              </Stack>
            </DialogTitle>

            <DialogContent dividers sx={{ bgcolor: "grey.50" }}>
              {auditFetching ? (
                <Stack alignItems="center" py={6}>
                  <CircularProgress />
                  <Typography variant="body2" color="text.secondary" mt={2}>
                    Đang tải lịch sử...
                  </Typography>
                </Stack>
              ) : auditError ? (
                <Alert severity="error">
                  {auditError?.data?.message ||
                    "Không tải được lịch sử chỉnh sửa"}
                </Alert>
              ) : (auditData?.items?.length || 0) === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
                  <Typography fontWeight={700}>
                    Chưa có lịch sử chỉnh sửa
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Người dùng này chưa có bản ghi update nào.
                  </Typography>
                </Paper>
              ) : (
                <Stack spacing={2}>
                  {auditData.items.map((log) => (
                    <Paper
                      key={log._id}
                      variant="outlined"
                      sx={{ p: 2, bgcolor: "white", borderRadius: 2 }}
                    >
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        justifyContent="space-between"
                        alignItems={{ xs: "flex-start", sm: "center" }}
                      >
                        <Stack spacing={0.2}>
                          <Typography fontWeight={800}>
                            {fmtDateTime(log.createdAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Actor: {log?.actor?.kind || "user"} •{" "}
                            {log?.actor?.id || "—"}
                            {log?.note ? ` • ${log.note}` : ""}
                          </Typography>
                        </Stack>

                        <Chip
                          size="small"
                          label={log.action || "UPDATE"}
                          color="primary"
                          variant="outlined"
                          sx={{ fontWeight: 700 }}
                        />
                      </Stack>

                      <Divider sx={{ my: 1.5 }} />

                      <Stack spacing={1.2}>
                        {(log.changes || []).map((c, idx) => (
                          <Paper
                            key={`${log._id}-${idx}`}
                            variant="outlined"
                            sx={{
                              p: 1.25,
                              borderRadius: 2,
                              bgcolor: "grey.50",
                            }}
                          >
                            <Stack spacing={0.75}>
                              <Chip
                                size="small"
                                label={c.field}
                                sx={{
                                  alignSelf: "flex-start",
                                  fontWeight: 700,
                                }}
                              />

                              <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    fontWeight={700}
                                  >
                                    Trước
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontFamily: "monospace",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {fmtVal(c.from)}
                                  </Typography>
                                </Grid>

                                <Grid size={{ xs: 12, md: 6 }}>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    fontWeight={700}
                                  >
                                    Sau
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontFamily: "monospace",
                                      wordBreak: "break-word",
                                    }}
                                  >
                                    {fmtVal(c.to)}
                                  </Typography>
                                </Grid>
                              </Grid>
                            </Stack>
                          </Paper>
                        ))}
                      </Stack>
                    </Paper>
                  ))}

                  {/* Pagination inside dialog */}
                  {(auditData?.pages || 0) > 1 && (
                    <Box display="flex" justifyContent="center" pt={1}>
                      <Pagination
                        page={auditPage}
                        count={auditData.pages}
                        onChange={(_, v) => setAuditPage(v)}
                        color="primary"
                        shape="rounded"
                      />
                    </Box>
                  )}
                </Stack>
              )}
            </DialogContent>

            <DialogActions sx={{ px: 3, py: 2, borderTop: "1px solid #eee" }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flex: 1 }}
              >
                Tổng: {auditData?.total ?? "—"} bản ghi
              </Typography>
              <Button onClick={() => setAuditUser(null)} color="inherit">
                Đóng
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
