// screens/PickleBall/MlpDualDetailPage.jsx
// Chi tiết 1 dual: assign lineup, sync sub-match, DreamBreaker scoring.
import { useEffect, useMemo, useState } from "react";
import { useSocket } from "../../context/SocketContext";
import { useParams, useNavigate } from "react-router-dom";
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
  TextField,
  Typography,
} from "@mui/material";
import { RefreshCw, ArrowLeft, Plus, Undo2, Zap, Save } from "lucide-react";
import { toast } from "react-toastify";

import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import { useListMlpTeamsQuery } from "../../slices/mlpApiSlice";
import {
  useGetMlpDualQuery,
  useAssignSubMatchLineupMutation,
  useSyncSubMatchResultMutation,
  useStartDreamBreakerMutation,
  useScoreDreamBreakerPointMutation,
  useUndoDreamBreakerPointMutation,
  usePatchMlpDualMutation,
} from "../../slices/mlpApiSlice";
import DualAssignmentPanel from "../../components/mlp/DualAssignmentPanel.jsx";

function ScoreEditor({ sub, dualId, onSaved }) {
  const [scoreA, setScoreA] = useState(sub.result?.scoreA ?? 0);
  const [scoreB, setScoreB] = useState(sub.result?.scoreB ?? 0);
  const [status, setStatus] = useState(sub.result?.status || "scheduled");
  const [saving, setSaving] = useState(false);
  const [update] = useSyncSubMatchResultMutation();

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({
        dualId,
        subId: sub._id,
        scoreA: Number(scoreA),
        scoreB: Number(scoreB),
        status,
      }).unwrap();
      onSaved?.();
      toast.success("Đã lưu");
    } catch (e) {
      toast.error(e?.data?.message || "Lỗi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ minWidth: 220, textAlign: "center" }}>
      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
        <TextField
          size="small"
          type="number"
          value={scoreA}
          onChange={(e) => setScoreA(Math.max(0, Number(e.target.value) || 0))}
          inputProps={{ min: 0, max: 99 }}
          sx={{ width: 70 }}
        />
        <Typography variant="h6">-</Typography>
        <TextField
          size="small"
          type="number"
          value={scoreB}
          onChange={(e) => setScoreB(Math.max(0, Number(e.target.value) || 0))}
          inputProps={{ min: 0, max: 99 }}
          sx={{ width: 70 }}
        />
      </Stack>
      <Stack direction="row" spacing={0.5} justifyContent="center" sx={{ mt: 0.5 }}>
        <Select
          size="small"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="scheduled">Chưa BĐ</MenuItem>
          <MenuItem value="live">Đang chơi</MenuItem>
          <MenuItem value="finished">Kết thúc</MenuItem>
        </Select>
        <IconButton
          size="small"
          color="primary"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />
        </IconButton>
      </Stack>
    </Box>
  );
}

function LineupDialog({ open, onClose, sub, teamA, teamB, onSubmit }) {
  const [pa, setPa] = useState([]);
  const [pb, setPb] = useState([]);
  const size = sub?.matchType === "single" ? 1 : 2;

  const toggle = (list, setList, u) => {
    const has = list.some((x) => String(x._id) === String(u._id));
    if (has) setList(list.filter((x) => String(x._id) !== String(u._id)));
    else if (list.length < size) setList([...list, u]);
  };

  const handleSubmit = () => {
    if (pa.length !== size || pb.length !== size) {
      toast.error(`Mỗi bên cần chọn ${size} VĐV`);
      return;
    }
    onSubmit(
      pa.map((p) => p._id),
      pb.map((p) => p._id),
    );
    setPa([]);
    setPb([]);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Chọn lineup — Slot {sub?.slotKey} ({size === 1 ? "Đơn" : "Đôi"})
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          {[
            { label: "Team A", team: teamA, list: pa, setList: setPa },
            { label: "Team B", team: teamB, list: pb, setList: setPb },
          ].map((col) => (
            <Box key={col.label} flex={1}>
              <Typography variant="body2" fontWeight={800} sx={{ mb: 1 }}>
                {col.label}: {col.team?.name} ({col.list.length}/{size})
              </Typography>
              <Stack spacing={0.5}>
                {(col.team?.players || []).map((p) => {
                  const active = col.list.some(
                    (x) => String(x._id) === String(p._id),
                  );
                  return (
                    <Stack
                      key={p._id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        p: 0.75,
                        cursor: "pointer",
                        border: 1,
                        borderColor: active ? "primary.main" : "divider",
                        borderRadius: 1,
                        bgcolor: active ? "action.selected" : "transparent",
                      }}
                      onClick={() => toggle(col.list, col.setList, p)}
                    >
                      <Avatar src={p.avatar} sx={{ width: 28, height: 28 }}>
                        {(p.nickname || p.name || "?")[0]}
                      </Avatar>
                      <Box flex={1}>
                        <Typography variant="body2" fontWeight={600}>
                          {p.name || p.nickname}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {p.gender || "—"}
                        </Typography>
                      </Box>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="contained" onClick={handleSubmit}>
          Lưu lineup
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DreamBreakerPanel({ dual, tour, onPoint, onUndo, onStart }) {
  const db = dual.dreamBreaker || {};
  const cfg = tour?.mlpConfig?.dreamBreaker || {};
  const rotate = cfg.rotationEveryPoints || 4;
  const target = cfg.pointsToWin || 21;

  const currentA = useMemo(() => {
    if (!db.lineupA?.length) return null;
    const idx =
      Math.floor(db.scoreA / rotate) % db.lineupA.length;
    return db.lineupA[idx];
  }, [db.scoreA, db.lineupA, rotate]);
  const currentB = useMemo(() => {
    if (!db.lineupB?.length) return null;
    const idx =
      Math.floor(db.scoreB / rotate) % db.lineupB.length;
    return db.lineupB[idx];
  }, [db.scoreB, db.lineupB, rotate]);

  if (!db.triggered) {
    return (
      <Card variant="outlined" sx={{ borderRadius: 3, borderColor: "error.main" }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Zap size={18} color="#EF4444" />
            <Typography variant="h6" fontWeight={800}>
              DreamBreaker — Tie-breaker
            </Typography>
          </Stack>
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
            Hoà số slot {dual.slotWinsA}-{dual.slotWinsB}. Bấm để chọn lineup
            cho DreamBreaker (cumulative singles tới {target}, rotate mỗi{" "}
            {rotate} điểm).
          </Alert>
          <Button
            variant="contained"
            color="error"
            startIcon={<Zap size={16} />}
            onClick={onStart}
          >
            Start DreamBreaker
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        borderColor: db.winner ? "success.main" : "error.main",
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <Zap size={18} color="#EF4444" />
          <Typography variant="h6" fontWeight={800}>
            DreamBreaker · Chạm {target}, rotate mỗi {rotate}đ
          </Typography>
          {db.winner && (
            <Chip
              size="small"
              color="success"
              label={`Team ${db.winner} thắng`}
            />
          )}
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          {[
            {
              side: "A",
              team: dual.teamA,
              score: db.scoreA,
              current: currentA,
              lineup: db.lineupA,
              color: "info",
            },
            {
              side: "B",
              team: dual.teamB,
              score: db.scoreB,
              current: currentB,
              lineup: db.lineupB,
              color: "secondary",
            },
          ].map((col) => (
            <Box
              key={col.side}
              flex={1}
              sx={{
                p: 2,
                borderRadius: 2,
                border: 2,
                borderColor: `${col.color}.main`,
                textAlign: "center",
              }}
            >
              <Typography variant="body2" fontWeight={800} color={`${col.color}.main`}>
                {col.team?.name}
              </Typography>
              <Typography variant="h1" fontWeight={900} sx={{ my: 1 }}>
                {col.score}
              </Typography>
              {col.current && (
                <Chip
                  size="small"
                  avatar={<Avatar src={col.current.avatar} />}
                  label={`Đang chơi: ${col.current.name || col.current.nickname}`}
                  color={col.color}
                />
              )}
              <Stack direction="row" spacing={0.5} justifyContent="center" sx={{ mt: 1, flexWrap: "wrap" }} useFlexGap>
                {col.lineup?.map((p, i) => {
                  const isCurrent =
                    col.current && String(col.current._id) === String(p._id);
                  return (
                    <Chip
                      key={p._id || i}
                      size="small"
                      avatar={<Avatar src={p.avatar}>{(p.nickname || "?")[0]}</Avatar>}
                      label={p.nickname || p.name}
                      variant={isCurrent ? "filled" : "outlined"}
                      color={isCurrent ? col.color : "default"}
                    />
                  );
                })}
              </Stack>
              <Button
                variant="contained"
                color={col.color}
                fullWidth
                sx={{ mt: 2 }}
                onClick={() => onPoint(col.side)}
                disabled={!!db.winner}
                startIcon={<Plus size={16} />}
              >
                +1 điểm
              </Button>
            </Box>
          ))}
        </Stack>

        <Stack direction="row" justifyContent="center" sx={{ mt: 2 }}>
          <Button
            size="small"
            startIcon={<Undo2 size={14} />}
            onClick={onUndo}
            disabled={db.points?.length === 0}
          >
            Undo điểm cuối
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function StartDbDialog({ open, onClose, dual, onSubmit }) {
  const [la, setLa] = useState([]);
  const [lb, setLb] = useState([]);

  const toggle = (list, setList, u) => {
    const idx = list.findIndex((x) => String(x._id) === String(u._id));
    if (idx >= 0) setList(list.filter((_, i) => i !== idx));
    else setList([...list, u]);
  };

  const handleSubmit = () => {
    if (!la.length || !lb.length) {
      toast.error("Cần lineup cả 2 team");
      return;
    }
    onSubmit(la.map((p) => p._id), lb.map((p) => p._id));
    setLa([]);
    setLb([]);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Chọn thứ tự lineup DreamBreaker</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
          Chọn thứ tự VĐV thi đấu (rotate mỗi 4 điểm). Bấm để thêm — chọn lại
          để bỏ.
        </Alert>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          {[
            { label: "Team A", team: dual.teamA, list: la, setList: setLa },
            { label: "Team B", team: dual.teamB, list: lb, setList: setLb },
          ].map((col) => (
            <Box key={col.label} flex={1}>
              <Typography variant="body2" fontWeight={800} sx={{ mb: 1 }}>
                {col.label}: {col.team?.name} (đã chọn {col.list.length})
              </Typography>
              <Box sx={{ mb: 1 }}>
                {col.list.map((p, i) => (
                  <Chip
                    key={p._id}
                    size="small"
                    label={`${i + 1}. ${p.nickname || p.name}`}
                    sx={{ m: 0.25 }}
                    onDelete={() => toggle(col.list, col.setList, p)}
                  />
                ))}
              </Box>
              <Stack spacing={0.5}>
                {(col.team?.players || []).map((p) => {
                  const active = col.list.some(
                    (x) => String(x._id) === String(p._id),
                  );
                  return (
                    <Stack
                      key={p._id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        p: 0.75,
                        cursor: "pointer",
                        border: 1,
                        borderColor: active ? "primary.main" : "divider",
                        borderRadius: 1,
                        bgcolor: active ? "action.selected" : "transparent",
                      }}
                      onClick={() => toggle(col.list, col.setList, p)}
                    >
                      <Avatar src={p.avatar} sx={{ width: 28, height: 28 }}>
                        {(p.nickname || p.name || "?")[0]}
                      </Avatar>
                      <Typography variant="body2" fontWeight={600}>
                        {p.name || p.nickname}
                      </Typography>
                    </Stack>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="contained" color="error" onClick={handleSubmit}>
          Start DreamBreaker
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MlpDualDetailPage() {
  const { tid, id } = useParams();
  const navigate = useNavigate();
  const [lineupTarget, setLineupTarget] = useState(null);
  const [dbStartOpen, setDbStartOpen] = useState(false);

  const { data: tour } = useGetTournamentQuery(tid);
  const { data: dual, isLoading, refetch } = useGetMlpDualQuery(id);
  const socket = useSocket();

  // Realtime: subscribe room mlp:dual:${id}, refetch khi có event score /
  // dual updated / finished từ backend (referee đang chấm ở thiết bị khác).
  useEffect(() => {
    if (!socket || !id) return;
    const subscribe = () =>
      socket.emit("mlp:dual:subscribe", { dualId: id });
    subscribe();
    socket.on("connect", subscribe);
    const bump = () => refetch();
    socket.on("mlp:sub:score", bump);
    socket.on("mlp:db:score", bump);
    socket.on("mlp:dual:updated", bump);
    socket.on("mlp:dual:finished", bump);
    return () => {
      try {
        socket.emit("mlp:dual:unsubscribe", { dualId: id });
      } catch {}
      socket.off("connect", subscribe);
      socket.off("mlp:sub:score", bump);
      socket.off("mlp:db:score", bump);
      socket.off("mlp:dual:updated", bump);
      socket.off("mlp:dual:finished", bump);
    };
  }, [socket, id, refetch]);
  const [assignLineup] = useAssignSubMatchLineupMutation();
  const [syncSub] = useSyncSubMatchResultMutation();
  const [startDb] = useStartDreamBreakerMutation();
  const [pointDb] = useScoreDreamBreakerPointMutation();
  const [undoDb] = useUndoDreamBreakerPointMutation();

  if (isLoading || !dual) {
    return (
      <Container sx={{ py: 6, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Button
        startIcon={<ArrowLeft size={16} />}
        onClick={() => navigate(`/tournament/${tid}/mlp/duals`)}
        sx={{ mb: 1.5 }}
      >
        Về danh sách duals
      </Button>

      {/* Team header */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="center"
        sx={{ mb: 3 }}
      >
        {[
          { team: dual.teamA, score: dual.slotWinsA, winner: dual.winner === "A", side: "A" },
          { team: dual.teamB, score: dual.slotWinsB, winner: dual.winner === "B", side: "B" },
        ].map((t) => (
          <Card
            key={t.side}
            variant="outlined"
            sx={{
              flex: 1,
              borderRadius: 3,
              borderColor: t.winner ? "success.main" : "divider",
              bgcolor: t.winner ? "success.50" : "transparent",
              width: "100%",
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar
                  src={t.team?.logo}
                  sx={{
                    width: 56,
                    height: 56,
                    bgcolor: t.team?.color || "primary.main",
                    fontWeight: 800,
                  }}
                >
                  {t.team?.shortName?.[0] || t.team?.name?.[0]}
                </Avatar>
                <Box flex={1}>
                  <Typography variant="h6" fontWeight={800}>
                    {t.team?.name}
                  </Typography>
                </Box>
                <Typography variant="h2" fontWeight={900}>
                  {t.score}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* Assignment panel: court + trọng tài + giờ */}
      <DualAssignmentPanel
        dual={dual}
        tour={tour}
        onSaved={() => refetch()}
      />

      {/* Sub-matches */}
      <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>
        Sub-matches ({dual.subMatches?.length})
      </Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {(dual.subMatches || []).map((sub) => {
          const slot = (tour?.mlpConfig?.slots || []).find(
            (s) => s.key === sub.slotKey,
          );
          return (
            <Card key={sub._id || sub.slotKey} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent>
                <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
                  <Box sx={{ minWidth: 120 }}>
                    <Typography variant="body1" fontWeight={800}>
                      {sub.slotKey}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {slot?.label || slot?.matchType} · {slot?.genderRule}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap flex={1}>
                    {(sub.playersA || []).map((p) => (
                      <Chip
                        key={p._id}
                        size="small"
                        avatar={<Avatar src={p.avatar}>{(p.nickname || "?")[0]}</Avatar>}
                        label={p.nickname || p.name}
                        color="info"
                        variant="outlined"
                      />
                    ))}
                    <Typography sx={{ mx: 1 }}>vs</Typography>
                    {(sub.playersB || []).map((p) => (
                      <Chip
                        key={p._id}
                        size="small"
                        avatar={<Avatar src={p.avatar}>{(p.nickname || "?")[0]}</Avatar>}
                        label={p.nickname || p.name}
                        color="secondary"
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                  <ScoreEditor
                    sub={sub}
                    dualId={dual._id}
                    onSaved={refetch}
                  />
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" onClick={() => setLineupTarget(sub)}>
                      Lineup
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {/* DreamBreaker if tie */}
      {(dual.status === "tie_break" || dual.dreamBreaker?.triggered) && (
        <DreamBreakerPanel
          dual={dual}
          tour={tour}
          onStart={() => setDbStartOpen(true)}
          onPoint={async (side) => {
            try {
              await pointDb({ dualId: dual._id, side }).unwrap();
              refetch();
            } catch (e) {
              toast.error(e?.data?.message || "Lỗi");
            }
          }}
          onUndo={async () => {
            try {
              await undoDb({ dualId: dual._id }).unwrap();
              refetch();
            } catch (e) {
              toast.error(e?.data?.message || "Lỗi");
            }
          }}
        />
      )}

      {/* Dialogs */}
      <LineupDialog
        open={!!lineupTarget}
        onClose={() => setLineupTarget(null)}
        sub={lineupTarget}
        teamA={dual.teamA}
        teamB={dual.teamB}
        onSubmit={async (pa, pb) => {
          try {
            await assignLineup({
              dualId: dual._id,
              subId: lineupTarget._id,
              playersA: pa,
              playersB: pb,
            }).unwrap();
            toast.success("Đã gán lineup");
            setLineupTarget(null);
            refetch();
          } catch (e) {
            toast.error(e?.data?.message || "Lỗi");
          }
        }}
      />

      <StartDbDialog
        open={dbStartOpen}
        onClose={() => setDbStartOpen(false)}
        dual={dual}
        onSubmit={async (la, lb) => {
          try {
            await startDb({
              dualId: dual._id,
              lineupA: la,
              lineupB: lb,
            }).unwrap();
            toast.success("Đã start DreamBreaker");
            setDbStartOpen(false);
            refetch();
          } catch (e) {
            toast.error(e?.data?.message || "Lỗi");
          }
        }}
      />
    </Container>
  );
}
