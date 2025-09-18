// src/pages/admin/UsersPage.jsx
/* eslint-disable react/prop-types */
import { useState, useEffect, useMemo } from "react";
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
  Grid,
  Typography,
  useMediaQuery,
  Paper,
  Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VerifiedIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
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
} from "../../slices/adminApiSlice";
import { setPage, setKeyword, setRole } from "../../slices/adminUiSlice";

/* ================== Consts ================== */
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
  pending: "Chờ KYC",
  verified: "Đã KYC",
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

/* ================== Page ================== */
export default function UsersPage() {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down("sm")); // <600
  const isMdUp = useMediaQuery(theme.breakpoints.up("md")); // >=900

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

  // ========= Row component (list) =========
  const UserRow = ({ u }) => {
    const isFull = !!fullMap[u._id];

    return (
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1, sm: 1.25 },
          borderRadius: 2,
          mb: 1,
        }}
      >
        <Grid container spacing={1.5} alignItems="center">
          {/* Left: Info */}
          <Grid item xs={12} md={7} lg={8}>
            <Stack spacing={0.5}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
              >
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  noWrap
                  title={u.name}
                >
                  {u.name}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                  sx={{ flexShrink: 0 }}
                >
                  <Chip
                    size="small"
                    label={KYC_LABEL[u.cccdStatus || "unverified"]}
                    color={KYC_COLOR[u.cccdStatus || "unverified"]}
                  />
                  {u.cccdImages?.front && (
                    <Tooltip title="Xem ảnh CCCD">
                      <IconButton size="small" onClick={() => setKyc(u)}>
                        <ZoomInIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>

              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                title={u.email}
              >
                {u.email}
              </Typography>

              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 0.25 }}
              >
                <Chip size="small" label={`Phone: ${u.phone || "-"}`} />
                <Chip size="small" label={`Đơn: ${u.single ?? "-"}`} />
                <Chip size="small" label={`Đôi: ${u.double ?? "-"}`} />
                {u.cccd && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`CCCD: ${u.cccd}`}
                    sx={{ fontFamily: "monospace" }}
                  />
                )}
              </Stack>
            </Stack>
          </Grid>

          {/* Middle: Role & toggle */}
          <Grid item xs={12} md={3} lg={3}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <FormControl size="small" sx={{ minWidth: 140, flexShrink: 0 }}>
                <InputLabel id={`role-${u._id}`}>Role</InputLabel>
                <Select
                  labelId={`role-${u._id}`}
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
              <FormControlLabel
                sx={{
                  m: 0,
                  "& .MuiFormControlLabel-label": {
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  },
                }}
                control={
                  <Checkbox
                    size="small"
                    checked={isFull}
                    onChange={(e) =>
                      toggleAdminEvaluator(u._id, e.target.checked)
                    }
                  />
                }
                label={isMdUp ? "Admin chấm trình (FULL tỉnh)" : "Full tỉnh"}
              />
            </Stack>
          </Grid>

          {/* Right: Actions */}
          <Grid item xs={12} md={2} lg={1}>
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              justifyContent={{ xs: "flex-start", md: "flex-end" }}
            >
              <Tooltip title="Cập nhật điểm">
                <IconButton
                  size="small"
                  color="info"
                  onClick={() => setScore({ ...u })}
                >
                  <VerifiedIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Sửa">
                <IconButton size="small" onClick={() => setEdit({ ...u })}>
                  <EditIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Xoá">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => setDel(u)}
                >
                  <DeleteIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Grid>
        </Grid>
      </Paper>
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

  /* ================== Render ================== */
  return (
    <Box>
      {/* Toolbar filters */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", sm: "center" }}
        sx={{ flexWrap: "wrap", mb: 2 }}
      >
        <TextField
          size="small"
          placeholder="Tìm tên / email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1 }} />,
          }}
          sx={{ width: { xs: "100%", sm: 280 } }}
        />
        {/* Role filter */}
        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 160 } }}>
          <InputLabel id="role-filter" shrink>
            Role
          </InputLabel>
          <Select
            labelId="role-filter"
            label="Role"
            value={role}
            onChange={(e) => {
              dispatch(setRole(e.target.value));
              dispatch(setPage(0));
            }}
            displayEmpty
            renderValue={(selected) =>
              selected === "" ? "Tất cả" : roleText(selected)
            }
          >
            <MenuItem value="">
              <em>Tất cả</em>
            </MenuItem>
            <MenuItem value="user">User</MenuItem>
            <MenuItem value="referee">Trọng tài</MenuItem>
            <MenuItem value="admin">Admin</MenuItem>
          </Select>
        </FormControl>
        {/* KYC filter */}
        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 180 } }}>
          <InputLabel id="cccd-filter" shrink>
            Trạng thái CCCD
          </InputLabel>
          <Select
            labelId="cccd-filter"
            label="Trạng thái CCCD"
            value={kycFilter}
            onChange={(e) => {
              setKycFilter(String(e.target.value));
              dispatch(setPage(0));
            }}
            displayEmpty
            renderValue={(selected) =>
              selected === "" ? "Tất cả" : KYC_LABEL[selected] || "Tất cả"
            }
          >
            <MenuItem value="">
              <em>Tất cả</em>
            </MenuItem>
            <MenuItem value="unverified">{KYC_LABEL.unverified}</MenuItem>
            <MenuItem value="pending">{KYC_LABEL.pending}</MenuItem>
            <MenuItem value="verified">{KYC_LABEL.verified}</MenuItem>
            <MenuItem value="rejected">{KYC_LABEL.rejected}</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {/* LIST */}
      <Box
        sx={{
          bgcolor: "background.paper",
          borderRadius: 2,
          p: { xs: 1, sm: 1.25 },
        }}
      >
        {isFetching ? (
          <Box py={6} textAlign="center">
            <CircularProgress />
          </Box>
        ) : users.length === 0 ? (
          <Box py={6} textAlign="center">
            <Typography>Không có người dùng</Typography>
          </Box>
        ) : (
          <Box>
            {users.map((u) => (
              <UserRow key={u._id} u={u} />
            ))}
          </Box>
        )}
      </Box>

      {/* Server pagination */}
      <Box py={2} display="flex" justifyContent="center">
        <Pagination
          page={page + 1}
          count={serverTotalPages}
          color="primary"
          onChange={(_, v) => dispatch(setPage(v - 1))}
        />
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snack.type} variant="filled">
          {snack.msg}
        </Alert>
      </Snackbar>

      {/* Zoom ảnh */}
      <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="md">
        {zoom && (
          <img
            src={zoom}
            alt="zoom"
            style={{ maxWidth: "100%", height: "auto" }}
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
      >
        {kyc && (
          <>
            <DialogTitle>Kiểm tra CCCD</DialogTitle>
            <DialogContent dividers sx={{ pt: 2 }}>
              <Grid container spacing={2}>
                {/* LEFT: Ảnh CCCD */}
                <Grid item xs={12} md={12} sx={{width: "100%"}}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    {["front", "back"].map((side) => (
                      <Box key={side} flex={1} textAlign="center">
                        <img
                          src={kyc.cccdImages?.[side]}
                          alt={side}
                          style={{
                            width: "100%",
                            maxHeight: isXs ? 220 : 280,
                            objectFit: "contain",
                            cursor: "zoom-in",
                            border: "1px solid #e0e0e0",
                            borderRadius: 8,
                            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                          }}
                          onClick={() => setZoom(kyc.cccdImages?.[side])}
                        />
                        <Typography
                          variant="caption"
                          display="block"
                          sx={{ mt: 0.5 }}
                        >
                          {side === "front" ? "Mặt trước" : "Mặt sau"}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Grid>

                {/* RIGHT: Thông tin */}
                <Grid item xs={12} md={12} sx={{width: "100%"}}>
                  <Box
                    sx={{
                      p: 2,
                      border: "1px solid #e0e0e0",
                      borderRadius: 2,
                      height: "100%",
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
                        label={KYC_LABEL[kyc.cccdStatus || "unverified"]}
                        color={KYC_COLOR[kyc.cccdStatus || "unverified"]}
                      />
                    </Stack>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "140px 1fr",
                        rowGap: 1,
                        columnGap: 1.5,
                        "& .label": { color: "text.secondary", fontSize: 14 },
                        "& .value": { fontWeight: 600, fontSize: 15 },
                      }}
                    >
                      <Box className="label">Họ & tên</Box>
                      <Box className="value">{kyc.name || "—"}</Box>

                      <Box className="label">Ngày sinh</Box>
                      <Box className="value">{prettyDate(kyc.dob)}</Box>

                      <Box className="label">Số CCCD</Box>
                      <Box
                        className="value"
                        style={{ fontFamily: "monospace" }}
                      >
                        {kyc.cccd || "—"}
                      </Box>

                      <Box className="label">Tỉnh / Thành</Box>
                      <Box className="value">{kyc.province || "—"}</Box>
                    </Box>

                    {kyc.note && (
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
                          {kyc.note}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions sx={{ px: 2.5, py: 1.5 }}>
              <Button onClick={() => setKyc(null)}>Đóng</Button>
              <Button
                color="error"
                startIcon={<CancelIcon fontSize="small" />}
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
                color="success"
                startIcon={<VerifiedIcon fontSize="small" />}
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
            <DialogTitle>Sửa thông tin</DialogTitle>
            <DialogContent
              sx={{ display: "flex", flexDirection: "column", gap: 2 }}
            >
              <Box mt={2} />
              <TextField
                label="Tên"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
              <TextField
                label="Nickname"
                value={edit.nickname || ""}
                onChange={(e) => setEdit({ ...edit, nickname: e.target.value })}
              />
              <TextField
                label="Phone"
                value={edit.phone || ""}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
              />
              <TextField
                label="Email"
                value={edit.email}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
              />

              <TextField
                label="CCCD"
                value={edit.cccd || ""}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    cccd: e.target.value.replace(/\D/g, "").slice(0, 12),
                  })
                }
                inputProps={{
                  inputMode: "numeric",
                  maxLength: 12,
                  pattern: "\\d{12}",
                }}
                helperText="Nhập đúng 12 chữ số"
              />

              <TextField
                label="DOB"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={edit.dob ? String(edit.dob).slice(0, 10) : ""}
                onChange={(e) => setEdit({ ...edit, dob: e.target.value })}
              />

              <FormControl
                fullWidth
                size="small"
                sx={{ ".MuiInputBase-root": { height: 40 } }}
              >
                <InputLabel id="gender-lbl">Giới tính</InputLabel>
                <Select
                  labelId="gender-lbl"
                  label="Giới tính"
                  value={
                    ["male", "female", "unspecified", "other"].includes(
                      edit.gender
                    )
                      ? edit.gender
                      : "unspecified"
                  }
                  onChange={(e) => setEdit({ ...edit, gender: e.target.value })}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl
                fullWidth
                size="small"
                sx={{ ".MuiInputBase-root": { height: 40 } }}
              >
                <InputLabel id="prov-lbl">Tỉnh / Thành</InputLabel>
                <Select
                  labelId="prov-lbl"
                  label="Tỉnh / Thành"
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

              {/* Đổi mật khẩu */}
              <Box sx={{ mt: 1, pt: 1.5, borderTop: "1px dashed #e0e0e0" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={changePass}
                      onChange={(e) => setChangePass(e.target.checked)}
                    />
                  }
                  label="Đổi mật khẩu"
                />
                {changePass && (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      mt: 1,
                    }}
                  >
                    <TextField
                      label="Mật khẩu mới"
                      type={showNew ? "text" : "password"}
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      error={Boolean(passTooShort)}
                      helperText={passTooShort ? "Tối thiểu 6 ký tự" : " "}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              edge="end"
                              onClick={() => setShowNew((s) => !s)}
                              aria-label="toggle password visibility"
                            >
                              {showNew ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <TextField
                      label="Xác nhận mật khẩu mới"
                      type={showConfirm ? "text" : "password"}
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      error={Boolean(passNotMatch)}
                      helperText={passNotMatch ? "Không khớp" : " "}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              edge="end"
                              onClick={() => setShowConfirm((s) => !s)}
                              aria-label="toggle password visibility"
                            >
                              {showConfirm ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                    <Box
                      sx={{
                        display: "flex",
                        gap: 1,
                        justifyContent: "flex-end",
                      }}
                    >
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setChangePass(false);
                          setNewPass("");
                          setConfirmPass("");
                          setShowNew(false);
                          setShowConfirm(false);
                        }}
                      >
                        Huỷ đổi mật khẩu
                      </Button>
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
                            "Đã đổi mật khẩu"
                          ).then(() => {
                            setChangePass(false);
                            setNewPass("");
                            setConfirmPass("");
                            setShowNew(false);
                            setShowConfirm(false);
                          })
                        }
                      >
                        Cập nhật mật khẩu
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEdit(null)}>Đóng</Button>
              <Button
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
                    "Đã cập nhật người dùng"
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
        <DialogTitle>Xoá người dùng?</DialogTitle>
        <DialogContent>
          {" "}
          Bạn chắc chắn xoá <b>{del?.name}</b> ({del?.email})?{" "}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDel(null)}>Huỷ</Button>
          <Button
            color="error"
            onClick={() =>
              handle(deleteUserMut(del._id).unwrap(), "Đã xoá người dùng").then(
                () => setDel(null)
              )
            }
          >
            Xoá
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cập nhật điểm */}
      <Dialog
        open={!!score}
        onClose={() => setScore(null)}
        maxWidth="xs"
        fullWidth
        fullScreen={isXs}
      >
        {score && (
          <>
            <DialogTitle>Cập nhật điểm</DialogTitle>
            <DialogContent
              sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
            >
              <Box mt={2} />
              <TextField
                label="Điểm đơn"
                type="number"
                fullWidth
                value={score.single}
                onChange={(e) => setScore({ ...score, single: e.target.value })}
              />
              <TextField
                label="Điểm đôi"
                type="number"
                fullWidth
                value={score.double}
                onChange={(e) => setScore({ ...score, double: e.target.value })}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setScore(null)}>Huỷ</Button>
              <Button
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
                Lưu
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
