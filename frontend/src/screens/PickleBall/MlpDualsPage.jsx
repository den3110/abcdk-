// screens/PickleBall/MlpDualsPage.jsx
// Danh sách dual matches + generate + scoring hub cho MLP.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { RefreshCw, Play, Zap } from "lucide-react";
import { toast } from "react-toastify";

import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import {
  useListMlpDualsQuery,
  useGenerateMlpDualsMutation,
  useSyncSubMatchResultMutation,
} from "../../slices/mlpApiSlice";

const STATUS_COLOR = {
  scheduled: "default",
  live: "warning",
  tie_break: "error",
  finished: "success",
};
const STATUS_LABEL = {
  scheduled: "Chưa bắt đầu",
  live: "Đang diễn ra",
  tie_break: "DreamBreaker",
  finished: "Kết thúc",
};

function DualCard({ dual, tour, onSync, canManage, onOpen }) {
  const cfg = tour?.mlpConfig || {};
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ mb: 1.5 }}
        >
          <Chip
            size="small"
            label={STATUS_LABEL[dual.status] || dual.status}
            color={STATUS_COLOR[dual.status]}
          />
          <Typography variant="caption" color="text.secondary">
            V{dual.round}-T{dual.order + 1}
          </Typography>
          <Box flex={1} />
          {canManage && (
            <Tooltip title="Đồng bộ kết quả từ các sub-match">
              <IconButton size="small" onClick={onSync}>
                <RefreshCw size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems="center"
        >
          {/* Team A */}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flex={1}
            sx={{
              p: 1.25,
              borderRadius: 2,
              border: 1,
              borderColor:
                dual.winner === "A" ? "success.main" : "divider",
              bgcolor: dual.winner === "A" ? "success.50" : "transparent",
              width: "100%",
            }}
          >
            <Avatar
              src={dual.teamA?.logo}
              sx={{
                bgcolor: dual.teamA?.color || "primary.main",
                fontWeight: 800,
              }}
            >
              {dual.teamA?.shortName?.[0] || dual.teamA?.name?.[0]}
            </Avatar>
            <Typography variant="body1" fontWeight={700} sx={{ flex: 1 }}>
              {dual.teamA?.name}
            </Typography>
            <Typography variant="h5" fontWeight={900}>
              {dual.slotWinsA}
            </Typography>
          </Stack>

          {/* Team B */}
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flex={1}
            sx={{
              p: 1.25,
              borderRadius: 2,
              border: 1,
              borderColor:
                dual.winner === "B" ? "success.main" : "divider",
              bgcolor: dual.winner === "B" ? "success.50" : "transparent",
              width: "100%",
            }}
          >
            <Avatar
              src={dual.teamB?.logo}
              sx={{
                bgcolor: dual.teamB?.color || "secondary.main",
                fontWeight: 800,
              }}
            >
              {dual.teamB?.shortName?.[0] || dual.teamB?.name?.[0]}
            </Avatar>
            <Typography variant="body1" fontWeight={700} sx={{ flex: 1 }}>
              {dual.teamB?.name}
            </Typography>
            <Typography variant="h5" fontWeight={900}>
              {dual.slotWinsB}
            </Typography>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
          {(dual.subMatches || []).map((sub) => {
            const slot =
              (cfg.slots || []).find((s) => s.key === sub.slotKey) || {};
            const status = sub.result?.status || "pending";
            const color =
              status === "finished"
                ? sub.result?.winner === "A"
                  ? "info"
                  : sub.result?.winner === "B"
                    ? "secondary"
                    : "default"
                : status === "live"
                  ? "warning"
                  : "default";
            return (
              <Chip
                key={sub._id || sub.slotKey}
                size="small"
                label={`${sub.slotKey}: ${sub.result?.scoreA ?? 0}-${
                  sub.result?.scoreB ?? 0
                }`}
                color={color}
                variant={status === "finished" ? "filled" : "outlined"}
                title={slot.label}
              />
            );
          })}
          {dual.status === "tie_break" && (
            <Chip
              size="small"
              color="error"
              icon={<Zap size={12} />}
              label="Chờ DreamBreaker"
            />
          )}
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Play size={14} />}
            onClick={onOpen}
          >
            Chi tiết
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function MlpDualsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [genOpen, setGenOpen] = useState(false);
  const [format, setFormat] = useState("roundrobin");

  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);
  const { data, isFetching, refetch } = useListMlpDualsQuery(
    { tourId: id },
    { skip: !id },
  );
  const [gen, { isLoading: generating }] = useGenerateMlpDualsMutation();
  const [syncSub] = useSyncSubMatchResultMutation();

  const items = data?.items || [];

  const isMlp = tour?.tournamentMode === "mlp";

  const handleGenerate = async () => {
    try {
      await gen({ tourId: id, format }).unwrap();
      toast.success("Đã sinh dual matches");
      setGenOpen(false);
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Lỗi");
    }
  };

  const handleSyncAll = async (dual) => {
    for (const sub of dual.subMatches || []) {
      if (sub.match) {
        try {
          await syncSub({ dualId: dual._id, subId: sub._id }).unwrap();
        } catch {}
      }
    }
    refetch();
    toast.success("Đã đồng bộ");
  };

  if (tourLoading) {
    return (
      <Container sx={{ py: 6, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }
  if (!isMlp) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="warning">Giải này không MLP.</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={900}>
            MLP Duals · {tour?.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Các trận team-vs-team. Sync để cập nhật score từ sub-matches.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={() => navigate(`/tournament/${id}/mlp/teams`)}
          >
            Teams
          </Button>
          <Button variant="contained" onClick={() => setGenOpen(true)}>
            Generate duals
          </Button>
        </Stack>
      </Stack>

      {isFetching && !items.length ? (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Chưa có dual match. Bấm "Generate duals" để sinh trận từ team đã duyệt.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={2}>
          {items.map((d) => (
            <DualCard
              key={d._id}
              dual={d}
              tour={tour}
              onSync={() => handleSyncAll(d)}
              onOpen={() => navigate(`/tournament/${id}/mlp/duals/${d._id}`)}
              canManage
            />
          ))}
        </Stack>
      )}

      <Dialog open={genOpen} onClose={() => setGenOpen(false)}>
        <DialogTitle>Generate dual matches</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
            Sẽ xoá các dual match cũ (nếu chưa có kết quả) và sinh mới.
          </Alert>
          <Select
            size="small"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            fullWidth
          >
            <MenuItem value="roundrobin">Round-robin (mọi cặp gặp 1 lần)</MenuItem>
            <MenuItem value="single_elim">Single elimination</MenuItem>
          </Select>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenOpen(false)}>Huỷ</Button>
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? "Đang sinh..." : "Generate"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
