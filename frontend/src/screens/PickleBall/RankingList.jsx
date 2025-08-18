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
  CircularProgress,
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
} from "@mui/material";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setKeyword, setPage } from "../../slices/rankingUiSlice";
import { useGetRankingsQuery } from "../../slices/rankingsApiSlice";
import PublicProfileDialog from "../../components/PublicProfileDialog";

const PLACE = "https://dummyimage.com/40x40/cccccc/ffffff&text=?";

// map từ tierColor BE → màu hex hiển thị
const HEX = {
  green: "#2e7d32", // ≥10 trận
  blue: "#1976d2",  // 5–9
  yellow: "#ff9800",// 1–4
  red: "#f44336",   // tự chấm
  grey: "#616161",  // chưa đấu
};
const textOn = (hex) => (hex === HEX.yellow ? "#000" : "#fff");
const fmt3 = (x) => (Number.isFinite(x) ? Number(x).toFixed(3) : "0.000");

// Tính tuổi: ưu tiên ngày sinh; fallback theo năm sinh
const calcAge = (u) => {
  if (!u) return null;
  const today = new Date();

  // Ưu tiên ngày sinh đầy đủ
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

  // Fallback: năm sinh (có thể là string)
  const yearRaw = u.birthYear ?? u.birth_year ?? u.yob;
  const year = Number(yearRaw);
  if (Number.isFinite(year) && year > 1900 && year <= today.getFullYear()) {
    return today.getFullYear() - year;
  }

  // Nếu chỉ có dateStr dạng năm (ví dụ "1995")
  if (dateStr && /^\d{4}$/.test(String(dateStr))) {
    const y = Number(dateStr);
    if (Number.isFinite(y)) return today.getFullYear() - y;
  }

  return null;
};

const cccdBadge = (status) => {
  switch (status) {
    case "verified":
      return { text: "Xác thực", color: "success" };
    case "pending":
      return { text: "Chờ", color: "warning" };
    case "rejected":
    case "unverified":
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

// Legend theo tier
const Legend = () => (
  <Stack
    direction="row"
    flexWrap="wrap"
    useFlexGap
    sx={{ columnGap: 1.5, rowGap: 1, mb: 2 }}
  >
    <Chip label="Xanh lá: ≥ 10 trận" sx={{ bgcolor: HEX.green, color: "#fff" }} />
    <Chip label="Xanh dương: 5–9 trận" sx={{ bgcolor: HEX.blue, color: "#fff" }} />
    <Chip label="Vàng: 1–4 trận" sx={{ bgcolor: HEX.yellow, color: "#000" }} />
    <Chip label="Đỏ: tự chấm" sx={{ bgcolor: HEX.red, color: "#fff" }} />
  </Stack>
);

export default function RankingList() {
  const dispatch = useDispatch();
  const { keyword, page } = useSelector((s) => s?.rankingUi || {});

  const {
    data = { docs: [], totalPages: 0 },
    isLoading,
    error,
    refetch,
  } = useGetRankingsQuery({ keyword, page });

  const { docs: list, totalPages } = data;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme?.breakpoints?.down("sm"));

  // nhẹ nhàng debounce refetch khi keyword đổi
  useEffect(() => {
    const t = setTimeout(refetch, 300);
    return () => clearTimeout(t);
  }, [keyword, refetch]);

  const [openProfile, setOpenProfile] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const handleOpen = (id) => {
    setSelectedId(id);
    setOpenProfile(true);
  };
  const handleClose = () => setOpenProfile(false);

  // Zoom avatar
  const [zoomSrc, setZoomSrc] = useState("");
  
  const [zoomOpen, setZoomOpen] = useState(false);
  const openZoom = (src) => {
    setZoomSrc(src || PLACE);
    setZoomOpen(true);
  };
  const closeZoom = () => setZoomOpen(false);

  const chipMobileSx = { mr: { xs: 0.75, sm: 0 }, mb: { xs: 0.75, sm: 0 } };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600}>
          Bảng xếp hạng
        </Typography>
        <Button component={Link} to="/levelpoint" variant="contained" size="small">
          Tự chấm trình
        </Button>
      </Box>

      <Legend />

      <TextField
        label="Tìm kiếm"
        variant="outlined"
        size="small"
        value={keyword || ""}
        onChange={(e) => dispatch(setKeyword(e?.target?.value))}
        sx={{ mb: 2, width: 300 }}
      />

      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error?.error}</Alert>
      ) : isMobile ? (
        // ===== MOBILE CARD LIST =====
        <Stack spacing={2}>
          {list?.map((r) => {
            const u = r?.user || {};
            const badge = cccdBadge(u?.cccdStatus);
            const avatarSrc = u?.avatar || PLACE;
            const tierHex = HEX[r?.tierColor] || HEX.grey;
            const age = calcAge(u);

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
                      <Typography variant="caption" color="text.secondary" noWrap>
                        Role: {u?.role || "--"}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {Number.isFinite(age) && (
                        <Chip size="small" label={age} sx={chipMobileSx} />
                      )}
                      <Chip label={badge.text} size="small" color={badge.color} />
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
                      sx={chipMobileSx}
                    />
                    <Chip
                      size="small"
                      label={`Tỉnh: ${u?.province || "--"}`}
                      sx={chipMobileSx}
                    />
                  </Stack>

                  <Divider sx={{ mb: 1 }} />

                  <Stack
                    direction="row"
                    spacing={2}
                    mb={1}
                    sx={{ "& .score": { color: tierHex, fontWeight: 600 } }}
                  >
                    <Typography variant="body2" className="score">
                      Đôi: {fmt3(r?.double)}
                    </Typography>
                    <Typography variant="body2" className="score">
                      Đơn: {fmt3(r?.single)}
                    </Typography>
                  </Stack>

                  <Typography variant="caption" color="text.secondary" display="block">
                    Cập nhật:{" "}
                    {r?.updatedAt
                      ? new Date(r.updatedAt).toLocaleDateString()
                      : "--"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Tham gia:{" "}
                    {u?.createdAt
                      ? new Date(u.createdAt).toLocaleDateString()
                      : "--"}
                  </Typography>

                  <Stack direction="row" spacing={1} mt={2}>
                    <Button size="small" variant="outlined">
                      Chấm
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      onClick={() => handleOpen(u?._id)}
                    >
                      Hồ sơ
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      ) : (
        // ===== DESKTOP TABLE =====
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                {/* <TableCell>ID</TableCell>  // XOÁ */}
                <TableCell>Ảnh</TableCell>
                <TableCell>Nick</TableCell>
                <TableCell>Tuổi</TableCell> {/* THÊM */}
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
                const badge = cccdBadge(u?.cccdStatus);
                const avatarSrc = u?.avatar || PLACE;
                const tierHex = HEX[r?.tierColor] || HEX.grey;
                const age = calcAge(u);

                return (
                  <TableRow key={r?._id || u?._id} hover>
                    <TableCell>{page * 10 + idx + 1}</TableCell>
                    {/* <TableCell>{u?._id?.toString()?.slice(-5)}</TableCell> // XOÁ */}
                    <TableCell>
                      <Avatar
                        src={avatarSrc}
                        alt={u?.nickname || "?"}
                        sx={{ width: 32, height: 32, cursor: "zoom-in" }}
                        onClick={() => openZoom(avatarSrc)}
                      />
                    </TableCell>
                    <TableCell>{u?.nickname || "--"}</TableCell>
                    <TableCell>{Number.isFinite(age) ? age : "--"}</TableCell> {/* số thuần */}
                    <TableCell>{genderLabel(u?.gender)}</TableCell>
                    <TableCell>{u?.province || "--"}</TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(r?.double)}
                    </TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(r?.single)}
                    </TableCell>
                    <TableCell>
                      {r?.updatedAt
                        ? new Date(r.updatedAt).toLocaleDateString()
                        : "--"}
                    </TableCell>
                    <TableCell>
                      {u?.createdAt
                        ? new Date(u.createdAt).toLocaleDateString()
                        : "--"}
                    </TableCell>
                    <TableCell>
                      <Chip label={badge.text} size="small" color={badge.color} />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={() => handleOpen(u?._id)}
                      >
                        Hồ sơ
                      </Button>
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
            onChange={(_, v) => dispatch(setPage(v - 1))}
            color="primary"
          />
        </Box>
      )}

      <PublicProfileDialog open={openProfile} onClose={handleClose} userId={selectedId} />

      {/* Zoom dialog */}
      <Dialog open={zoomOpen} onClose={closeZoom} maxWidth="sm" fullWidth>
        <DialogTitle>Ảnh đại diện</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", justifyContent: "center" }}>
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
    </Container>
  );
}
