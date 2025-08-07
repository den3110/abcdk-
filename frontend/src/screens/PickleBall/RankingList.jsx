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
} from "@mui/material";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setKeyword, setPage } from "../../slices/rankingUiSlice";
import { useGetRankingsQuery } from "../../slices/rankingsApiSlice";
import PublicProfileDialog from "../../components/PublicProfileDialog";

const PLACE = "https://dummyimage.com/40x40/cccccc/ffffff&text=?";
const colorByGames = (g) => (g < 1 ? "#f44336" : g < 7 ? "#ff9800" : "#212121");

export default function RankingList() {
  /* redux ui */
  const dispatch = useDispatch();
  const { keyword, page } = useSelector((s) => s.rankingUi);

  /* fetch */
  const {
    data = { docs: [], totalPages: 0 },
    isLoading,
    error,
    refetch,
  } = useGetRankingsQuery({ keyword, page });

  const { docs: list, totalPages } = data;

  /* responsive */
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  /* debounce refetch khi đổi keyword */
  useEffect(() => {
    const t = setTimeout(refetch, 300);
    return () => clearTimeout(t);
  }, [keyword, refetch]);

  /* dialog */
  const [openProfile, setOpenProfile] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const handleOpen = (id) => {
    setSelectedId(id);
    setOpenProfile(true);
  };
  const handleClose = () => setOpenProfile(false);

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography variant="h5" fontWeight={600}>
          PLAYER RANKING
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

      {/* legend */}
      <Stack direction="row" spacing={2} mb={2} flexWrap="wrap">
        <Chip label="Đỏ: tự chấm" sx={{ bgcolor: "#f44336", color: "#fff" }} />
        <Chip
          label="Vàng: &lt; 7 trận"
          sx={{ bgcolor: "#ff9800", color: "#fff" }}
        />
        <Chip
          label="Đen: ≥ 7 trận"
          sx={{ bgcolor: "#212121", color: "#fff" }}
        />
      </Stack>

      {/* search */}
      <TextField
        label="Tìm kiếm"
        variant="outlined"
        size="small"
        value={keyword}
        onChange={(e) => dispatch(setKeyword(e.target.value))}
        sx={{ mb: 2, width: 300 }}
      />

      {/* list */}
      {isLoading ? (
        <CircularProgress />
      ) : error ? (
        <Alert severity="error">{error?.data?.message || error.error}</Alert>
      ) : isMobile ? (
        /* mobile cards */
        <Stack spacing={2}>
          {list.map((r) => {
            const u = r.user || {};
            const color = colorByGames(r.games);
            return (
              <Card key={r._id} variant="outlined">
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1} gap={2}>
                    <Avatar src={u.avatar || PLACE} alt={u.nickname || "?"} />
                    <Box>
                      <Typography fontWeight={600}>
                        {u.nickname || "---"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ID: {u._id?.toString().slice(-5) || "---"}
                      </Typography>
                    </Box>
                    <Box ml="auto">
                      <Chip
                        label={u.verified ? "Xác thực" : "Chờ"}
                        size="small"
                        color={u.verified ? "success" : "default"}
                      />
                    </Box>
                  </Box>
                  <Stack direction="row" spacing={2} flexWrap="wrap" mb={1}>
                    <Chip label={`Giới tính: ${u.gender || "--"}`} />
                    <Chip label={`Tỉnh: ${u.province || "--"}`} />
                  </Stack>
                  <Divider sx={{ mb: 1 }} />
                  <Stack direction="row" spacing={2} mb={1}>
                    <Typography variant="body2" sx={{ color }}>
                      Đôi: {r?.ratingDouble?.toFixed(3)}
                    </Typography>
                    <Typography variant="body2" sx={{ color }}>
                      Đơn: {r?.ratingSingle?.toFixed(3)}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Cập nhật: {new Date(r?.updatedAt).toLocaleDateString()}
                  </Typography>{" "}
                  <Typography variant="caption" color="text.secondary">
                    Tham gia: {new Date(u?.createdAt).toLocaleDateString()}
                  </Typography>
                  <Stack direction="row" spacing={1} mt={2}>
                    <Button size="small" variant="outlined">
                      Chấm
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      onClick={() => handleOpen(u._id)}
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
        /* desktop table */
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
                <TableCell>Cập nhật</TableCell>
                <TableCell>Tham gia</TableCell>
                <TableCell>Xác thực</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((r, idx) => {
                const u = r.user || {};
                const color = colorByGames(r.games);
                return (
                  <TableRow key={r._id}>
                    <TableCell>{page * 10 + idx + 1}</TableCell>
                    <TableCell>{u._id?.toString().slice(-5)}</TableCell>
                    <TableCell>
                      <Avatar
                        src={u.avatar || PLACE}
                        sx={{ width: 32, height: 32 }}
                        alt={u.nickname || "?"}
                      />
                    </TableCell>
                    <TableCell>{u.nickname}</TableCell>
                    <TableCell>{u.gender || "--"}</TableCell>
                    <TableCell>{u.province || "--"}</TableCell>
                    <TableCell sx={{ color }}>
                      {r.ratingDouble.toFixed(3)}
                    </TableCell>
                    <TableCell sx={{ color }}>
                      {r.ratingSingle.toFixed(3)}
                    </TableCell>
                    <TableCell>
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={u.verified ? "Xác thực" : "Chờ"}
                        size="small"
                        color={u.verified ? "success" : "default"}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        onClick={() => handleOpen(u._id)}
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

      {/* pagination */}
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
    </Container>
  );
}
