// screens/PickleBall/MlpStandingsPage.jsx — Bảng xếp hạng team MLP.
// Sort theo Wins → SlotDiff → PointDiff → Name. Admin có nút Recompute.
// Nếu tour bật groupStage → hiện BXH theo bảng riêng + tab tổng.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { RefreshCw, ArrowLeft, Download } from "lucide-react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useListMlpStandingsQuery,
  useRecomputeMlpStandingsMutation,
} from "../../slices/mlpApiSlice.js";

const isAdmin = (u) => u?.role === "admin" || u?.isAdmin || u?.isSuperUser;

function StandingsTable({ items, topPerPool }) {
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 40 }}>#</TableCell>
            <TableCell>Team</TableCell>
            <TableCell align="center">
              <Tooltip title="Số dual thắng"><span>T</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Số dual thua"><span>B</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Số dual đã đấu"><span>ĐĐ</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Slot thắng"><span>S+</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Slot thua"><span>S-</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Hiệu số slot"><span>±S</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Điểm ghi (tổng sub-match + DreamBreaker)">
                <span>Đ+</span>
              </Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Điểm bị ghi"><span>Đ-</span></Tooltip>
            </TableCell>
            <TableCell align="center">
              <Tooltip title="Hiệu số điểm"><span>±Đ</span></Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((row, idx) => {
            const isTop = topPerPool && idx < topPerPool;
            return (
              <TableRow
                key={row._id}
                sx={{
                  "&:hover": { bgcolor: "action.hover" },
                  ...(isTop && { bgcolor: "success.50" }),
                  ...(row.rank === 1 && !isTop && { bgcolor: "warning.50" }),
                }}
              >
                <TableCell sx={{ fontWeight: 700 }}>
                  {row.rank}
                  {isTop && (
                    <Chip
                      size="small"
                      label="KO"
                      color="success"
                      sx={{ ml: 0.5, height: 18, fontSize: 10 }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar
                      src={row.logo || ""}
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: row.color || "grey.300",
                        fontSize: 12,
                      }}
                    >
                      {(row.shortName || row.name || "?")[0]?.toUpperCase()}
                    </Avatar>
                    <Typography variant="body2" fontWeight={600}>
                      {row.name}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>
                  {row.wins}
                </TableCell>
                <TableCell align="center">{row.losses}</TableCell>
                <TableCell align="center">{row.played}</TableCell>
                <TableCell align="center">{row.slotsFor}</TableCell>
                <TableCell align="center">{row.slotsAgainst}</TableCell>
                <TableCell
                  align="center"
                  sx={{
                    fontWeight: 700,
                    color:
                      row.slotDiff > 0
                        ? "success.main"
                        : row.slotDiff < 0
                          ? "error.main"
                          : "text.secondary",
                  }}
                >
                  {row.slotDiff > 0 ? `+${row.slotDiff}` : row.slotDiff}
                </TableCell>
                <TableCell align="center">{row.pointsFor}</TableCell>
                <TableCell align="center">{row.pointsAgainst}</TableCell>
                <TableCell
                  align="center"
                  sx={{
                    color:
                      row.pointDiff > 0
                        ? "success.main"
                        : row.pointDiff < 0
                          ? "error.main"
                          : "text.secondary",
                  }}
                >
                  {row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function MlpStandingsPage() {
  const nav = useNavigate();
  const { id: tid } = useParams();
  const me = useSelector((s) => s.auth?.userInfo);
  const { data, isFetching, refetch } = useListMlpStandingsQuery(tid, {
    skip: !tid,
  });
  const [recompute, { isLoading: recomputing }] =
    useRecomputeMlpStandingsMutation();

  const items = data?.items || [];
  const pools = Array.isArray(data?.pools) ? data.pools : null;
  const gs = data?.groupStage || null;
  const [tab, setTab] = useState(0); // 0 = all, 1..N = pool

  const handleRecompute = async () => {
    try {
      await recompute(tid).unwrap();
      toast.success("Đã tính lại BXH");
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Không tính lại được BXH");
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={() => nav(-1)}>
          <ArrowLeft size={20} />
        </IconButton>
        <Typography variant="h5" fontWeight={700} flex={1}>
          Bảng xếp hạng MLP
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Download size={16} />}
          onClick={() =>
            window.open(
              `/api/mlp/tournaments/${tid}/export/standings.csv`,
              "_blank",
            )
          }
        >
          BXH CSV
        </Button>
        <Button
          variant="outlined"
          startIcon={<Download size={16} />}
          onClick={() =>
            window.open(
              `/api/mlp/tournaments/${tid}/export/results.csv`,
              "_blank",
            )
          }
        >
          Kết quả CSV
        </Button>
        {isAdmin(me) && (
          <Button
            variant="outlined"
            startIcon={<RefreshCw size={16} />}
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? "Đang tính…" : "Tính lại"}
          </Button>
        )}
      </Stack>

      {isFetching && !data ? (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            Chưa có team nào hoặc chưa có dual match nào kết thúc.
          </Typography>
        </Paper>
      ) : gs?.enabled && pools && pools.length > 0 ? (
        <>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2 }}
          >
            <Tab label={`Tổng (${items.length} đội)`} />
            {pools.map((p) => (
              <Tab key={p.key} label={`Bảng ${p.key}`} />
            ))}
          </Tabs>
          {tab === 0 ? (
            <StandingsTable items={items} topPerPool={0} />
          ) : (
            (() => {
              const p = pools[tab - 1];
              if (!p) return null;
              return (
                <>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="h6" fontWeight={800}>
                      Bảng {p.key}
                    </Typography>
                    <Chip
                      size="small"
                      color="success"
                      label={`Top ${gs.topPerPool} → Knockout`}
                    />
                  </Stack>
                  <StandingsTable
                    items={p.items || []}
                    topPerPool={gs.topPerPool}
                  />
                </>
              );
            })()
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">
            BXH bảng: chỉ tính các dual trong vòng bảng. Các đội ở vùng xanh (top{" "}
            {gs.topPerPool}) sẽ được đưa vào knockout khi BTC bấm "Sinh knockout".
          </Typography>
        </>
      ) : (
        <StandingsTable items={items} />
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mt: 2, display: "block" }}
      >
        Tiêu chí sắp xếp: Số dual thắng → Đối đầu trực tiếp → Hiệu số slot →
        Hiệu số điểm → Tên team. BXH được tính lại tự động sau mỗi dual kết thúc.
      </Typography>
    </Container>
  );
}
