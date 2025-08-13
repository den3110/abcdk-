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
  blue: "#1976d2", // 5–9
  yellow: "#ff9800", // 1–4
  red: "#f44336", // tự chấm
  grey: "#616161", // chưa đấu
};
const textOn = (hex) => (hex === HEX.yellow ? "#000" : "#fff");
const fmt3 = (x) => (Number.isFinite(x) ? Number(x).toFixed(3) : "0.000");

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

  // Legend theo tier (giữ nguyên)
  const Legend = () => (
    <Stack
      direction="row"
      flexWrap="wrap"
      useFlexGap
      sx={{ columnGap: 1.5, rowGap: 1, mb: 2 }}
    >
      <Chip
        label="Xanh lá: ≥ 10 trận"
        sx={{ bgcolor: HEX.green, color: "#fff" }}
      />
      <Chip
        label="Xanh dương: 5–9 trận"
        sx={{ bgcolor: HEX.blue, color: "#fff" }}
      />
      <Chip
        label="Vàng: 1–4 trận"
        sx={{ bgcolor: HEX.yellow, color: "#000" }}
      />
      <Chip label="Đỏ: tự chấm" sx={{ bgcolor: HEX.red, color: "#fff" }} />
    </Stack>
  );

  // margin cho Chip chỉ áp dụng trên mobile
  const chipMobileSx = { mr: { xs: 0.75, sm: 0 }, mb: { xs: 0.75, sm: 0 } };

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
        <Button
          component={Link}
          to="/levelpoint"
          variant="contained"
          size="small"
        >
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
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap>
                        {u?.nickname || "---"}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        ID: {u?._id?.toString()?.slice(-5) || "---"} • Role:{" "}
                        {u?.role || "--"}
                      </Typography>
                    </Box>
                    <Box ml="auto">
                      <Chip
                        label={badge.text}
                        size="small"
                        color={badge.color}
                      />
                    </Box>
                  </Box>

                  {/* Chips: chỉ giữ Giới tính + Tỉnh, bỏ Tier / trận đôi / trận đơn */}
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
                    {/* BỎ:
                    <Chip size="small" label={r?.tierLabel || "Chưa đấu"} />
                    <Chip size="small" label={`Đôi: ${r?.doubleMatches ?? 0} tr`} />
                    <Chip size="small" label={`Đơn: ${r?.singleMatches ?? 0} tr`} />
                    */}
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

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Cập nhật:{" "}
                    {r?.updatedAt
                      ? new Date(r.updatedAt).toLocaleDateString()
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
                <TableCell>ID</TableCell>
                <TableCell>Ảnh</TableCell>
                <TableCell>Nick</TableCell>
                <TableCell>Giới&nbsp;tính</TableCell>
                <TableCell>Tỉnh</TableCell>
                <TableCell>Điểm&nbsp;đôi</TableCell>
                <TableCell>Điểm&nbsp;đơn</TableCell>
                {/* <TableCell>Trận&nbsp;đôi</TableCell> */}
                {/* <TableCell>Trận&nbsp;đơn</TableCell> */}
                {/* <TableCell>Tier</TableCell> */}
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

                return (
                  <TableRow key={r?._id || u?._id} hover>
                    <TableCell>{page * 10 + idx + 1}</TableCell>
                    <TableCell>{u?._id?.toString()?.slice(-5)}</TableCell>
                    <TableCell>
                      <Avatar
                        src={avatarSrc}
                        alt={u?.nickname || "?"}
                        sx={{ width: 32, height: 32, cursor: "zoom-in" }}
                        onClick={() => openZoom(avatarSrc)}
                      />
                    </TableCell>
                    <TableCell>{u?.nickname}</TableCell>
                    <TableCell>{genderLabel(u?.gender)}</TableCell>
                    <TableCell>{u?.province || "--"}</TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(r?.double)}
                    </TableCell>
                    <TableCell sx={{ color: tierHex, fontWeight: 600 }}>
                      {fmt3(r?.single)}
                    </TableCell>
                    {/* <TableCell>{r?.doubleMatches ?? 0}</TableCell> */}
                    {/* <TableCell>{r?.singleMatches ?? 0}</TableCell> */}
                    {/* <TableCell>
                      <Chip
                        size="small"
                        label={r?.tierLabel || "Chưa đấu"}
                        sx={{ bgcolor: tierHex, color: textOn(tierHex) }}
                      />
                    </TableCell> */}
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
                      <Chip
                        label={badge.text}
                        size="small"
                        color={badge.color}
                      />
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

      <PublicProfileDialog
        open={openProfile}
        onClose={handleClose}
        userId={selectedId}
      />

      {/* Zoom dialog */}
      <Dialog open={zoomOpen} onClose={closeZoom} maxWidth="sm" fullWidth>
        <DialogTitle>Ảnh đại diện</DialogTitle>
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
    </Container>
  );
}
