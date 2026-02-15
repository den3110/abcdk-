
// src/layouts/tournament/AdminDrawPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import DashboardNavbar from "../../components/DashboardNavbar";
import SEOHead from "../../components/SEOHead";
import {
  Box,
  Stack,
  Typography,
  Paper,
  TextField,
  MenuItem,
  Button,
  Chip,
  Alert,
  Divider,
  Grid,
  LinearProgress,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  PlayArrow,
  Undo,
  DoneAll,
  Cancel,
  RestartAlt,
  ArrowForward,
} from "@mui/icons-material";
import { useParams, useNavigate } from "react-router-dom";

// import DashboardLayout from "examples/LayoutContainers/DashboardLayout";
// import DashboardNavbar from "examples/Navbars/DashboardNavbar";
// import Footer from "examples/Footer";

import {
  useGetTournamentQuery,
  useListTournamentBracketsQuery,
  useGetDrawStatusQuery,
  useInitDrawMutation,
  useRevealDrawMutation,
  useUndoDrawMutation,
  useCancelDrawMutation,
  useFinalizeKoMutation,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";


/* ===== helpers ===== */
const safePairName = (reg, evType = "double") => {
  if (!reg) return "—";
  const p1 =
    reg?.player1?.fullName + reg?.player1?.name + reg?.player1?.nickname ||
    "N/A";
  const p2 =
    reg?.player2?.fullName + reg?.player2?.name + reg?.player2?.nickname || "";
  return evType === "single" ? p1 : p2 ? `${p1}` & `${p2}` : p1;
};

function GroupBoard({ session, eventType }) {
  const groups = Number(session?.config?.groups || 0);
  const groupSize = Number(session?.config?.groupSize || 0);
  const labels = useMemo(() => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    return Array.from({ length: groups }, (_, i) => letters[i] || `G${i + 1}`);
  }, [groups]);

  const byLabel = useMemo(() => {
    const m = new Map();
    labels.forEach((lb) => {
      m.set(
        lb,
        Array.from({ length: groupSize }, () => null)
      );
    });
    (session?.applied || []).forEach((st) => {
      if (st.groupLabel && Number.isInteger(st.slotIndex)) {
        const arr = m.get(st.groupLabel);
        if (arr) arr[st.slotIndex] = st.reg; // đã được populate {player1,player2}
      }
    });
    return m;
  }, [labels, groupSize, session?.applied]);

  if (!groups || !groupSize) {
    return <Alert severity="info">Chưa có cấu hình bảng.</Alert>;
  }

  return (
    <Grid container spacing={2}>
      {labels.map((lb) => (
        <Grid item size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={lb}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography fontWeight={700}>Bảng {lb}</Typography>
              <Chip
                size="small"
                label={`${(byLabel.get(lb) || []).filter(Boolean).length
                  }/${groupSize}`}
              />
            </Stack>
            <Stack spacing={1}>
              {(byLabel.get(lb) || []).map((reg, idx) => (
                <Paper
                  key={idx}
                  variant="outlined"
                  sx={{ p: 1, bgcolor: reg ? "transparent" : "action.hover" }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={`${idx + 1}`}
                      sx={{ minWidth: 28 }}
                    />
                    <Typography
                      sx={{ flex: 1 }}
                      noWrap
                      title={reg ? safePairName(reg, eventType) : "—"}
                    >
                      {reg ? safePairName(reg, eventType) : "—"}
                    </Typography>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}

function KnockoutBoard({ session, eventType }) {
  // applied: [{ matchOrder, side, reg }]
  const buckets = useMemo(() => {
    const m = new Map(); // order -> {A,B}
    (session?.applied || []).forEach((st) => {
      const b = m.get(st.matchOrder) || {};
      if (st.side === "A") b.A = st.reg;
      if (st.side === "B") b.B = st.reg;
      m.set(st.matchOrder, b);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [session?.applied]);

  if (!buckets.length) {
    return <Alert severity="info">Chưa có cặp nào được bốc.</Alert>;
  }

  return (
    <Stack spacing={1.25}>
      {buckets.map(([order, pair]) => (
        <Paper key={order} variant="outlined" sx={{ p: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`Cặp #${order + 1}`}
            />
            <Typography
              sx={{ flex: 1 }}
              noWrap
              title={pair.A ? safePairName(pair.A, eventType) : "—"}
            >
              A: <b>{pair.A ? safePairName(pair.A, eventType) : "—"}</b>
            </Typography>
            <Typography
              sx={{ flex: 1 }}
              textAlign="right"
              noWrap
              title={pair.B ? safePairName(pair.B, eventType) : "—"}
            >
              B: <b>{pair.B ? safePairName(pair.B, eventType) : "—"}</b>
            </Typography>
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

export default function AdminDrawPage() {
  const { id: tournamentId, bracketId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  // info
  const { data: tour } = useGetTournamentQuery(tournamentId);
  const { data: brackets = [] } = useListTournamentBracketsQuery(tournamentId);
  const thisBracket = useMemo(
    () => (brackets || []).find((b) => String(b._id) === String(bracketId)),
    [brackets, bracketId]
  );

  // draw status (RTK)
  const {
    data: statusData,
    refetch: refetchStatus,
    isFetching: fetchingStatus,
  } = useGetDrawStatusQuery(bracketId, { skip: !bracketId });

  // local session from socket or RTK
  const [session, setSession] = useState(null);

  // socket join
  const socket = useSocket();
  useEffect(() => {
    if (!socket || !bracketId) return;
    socket.emit("draw:join", { bracketId });

    const onState = (s) => setSession(s);
    const onReveal = () => refetchStatus(); // để chắc ăn sync
    const onUndo = () => refetchStatus();
    const onError = (msg) => console.warn("[draw:error]", msg);

    socket.on("draw:state", onState);
    socket.on("draw:reveal", onReveal);
    socket.on("draw:undo", onUndo);
    socket.on("draw:finalized", onState);
    socket.on("draw:error", onError);

    return () => {
      socket.off("draw:state", onState);
      socket.off("draw:reveal", onReveal);
      socket.off("draw:undo", onUndo);
      socket.off("draw:finalized", onState);
      socket.off("draw:error", onError);
    };
  }, [socket, bracketId, refetchStatus]);

  // sync RTK -> local on first load / fallback
  useEffect(() => {
    if (statusData) setSession(statusData);
  }, [statusData]);

  // mutations (REST)
  const [initDraw, { isLoading: initLoading }] = useInitDrawMutation();
  const [revealNext, { isLoading: revealLoading }] = useRevealDrawMutation();
  const [undo, { isLoading: undoLoading }] = useUndoDrawMutation();
  const [cancel, { isLoading: cancelLoading }] = useCancelDrawMutation();
  const [finalizeKo, { isLoading: finLoading }] = useFinalizeKoMutation();

  // init form
  const [mode, setMode] = useState("group"); // "group"|"knockout"
  const [groups, setGroups] = useState(8);
  const [groupSize, setGroupSize] = useState(4);
  const [knockoutSlots, setKnockoutSlots] = useState(16);
  const [jitter, setJitter] = useState(0.05);

  const eventType =
    (thisBracket?.tournament?.eventType || tour?.eventType) === "single"
      ? "single"
      : "double";

  const progress = useMemo(() => {
    const cur = Number(session?.cursor || 0);
    const total = Number(session?.total || 0);
    return { cur, total, pct: total ? Math.round((cur / total) * 100) : 0 };
  }, [session]);

  const canReveal =
    session &&
    ["ready", "running"].includes(session.status) &&
    progress.cur < progress.total;
  const isKO = session?.mode === "knockout";
  const isGroup = session?.mode === "group";

  const handleInit = async () => {
    const body =
      mode === "group"
        ? {
          mode,
          config: {
            groups: Number(groups),
            groupSize: Number(groupSize),
            jitter: Number(jitter),
          },
        }
        : {
          mode,
          config: {
            knockoutSlots: Number(knockoutSlots),
            jitter: Number(jitter),
          },
        };
    await initDraw({ bracketId, ...body }).unwrap();
    await refetchStatus();
  };

  const handleReveal = async () => {
    await revealNext(bracketId).unwrap();
    await refetchStatus();
  };

  const handleUndo = async () => {
    await undo(bracketId).unwrap();
    await refetchStatus();
  };

  const handleCancel = async () => {
    await cancel(bracketId).unwrap();
    await refetchStatus();
  };

  const handleFinalizeKo = async () => {
    await finalizeKo(bracketId).unwrap();
    await refetchStatus();
  };



  return (
    <>
      <SEOHead title="Quản lý bốc thăm" noIndex={true} />
      {/* <DashboardNavbar /> */}
      <Box p={2} pb={6} maxWidth={1200} mx="auto">
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 2 }}
        >
          <Stack spacing={0.3}>
            <Typography variant="h5" fontWeight={800}>
              Bốc thăm — {tour?.name || "Giải đấu"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Bracket: {thisBracket?.name} •{" "}
              {thisBracket?.type === "group" ? "Vòng bảng" : "Knockout"} •{" "}
              {eventType === "single" ? "Giải đơn" : "Giải đôi"}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => navigate(-1)}>
              Quay lại
            </Button>
          </Stack>
        </Stack>

        {/* trạng thái */}
        {fetchingStatus && <LinearProgress sx={{ mb: 2 }} />}

        {/* Nếu chưa có session / đã done / đã cancel -> form tạo mới */}
        {!session || ["done", "canceled"].includes(session.status) ? (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Khởi tạo phiên bốc thăm
            </Typography>
            <Grid container spacing={2}>
              <Grid item size={{ xs: 12, sm: "auto" }}>
                <TextField
                  select
                  label="Chế độ"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="group">Vòng bảng</MenuItem>
                  <MenuItem value="knockout">Knockout</MenuItem>
                </TextField>
              </Grid>

              {mode === "group" ? (
                <>
                  <Grid item size={{ xs: 6, sm: "auto" }}>
                    <TextField
                      type="number"
                      label="Số bảng"
                      value={groups}
                      onChange={(e) =>
                        setGroups(Math.max(1, Number(e.target.value)))
                      }
                      sx={{ minWidth: 160 }}
                    />
                  </Grid>
                  <Grid item size={{ xs: 6, sm: "auto" }}>
                    <TextField
                      type="number"
                      label="Đội/bảng"
                      value={groupSize}
                      onChange={(e) =>
                        setGroupSize(Math.max(2, Number(e.target.value)))
                      }
                      sx={{ minWidth: 160 }}
                    />
                  </Grid>
                </>
              ) : (
                <Grid item size={{ xs: 12, sm: "auto" }}>
                  <TextField
                    select
                    label="Số đội KO"
                    value={knockoutSlots}
                    onChange={(e) => setKnockoutSlots(Number(e.target.value))}
                    sx={{ minWidth: 160 }}
                  >
                    {[4, 8, 16, 32, 64].map((n) => (
                      <MenuItem key={n} value={n}>
                        {n}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
              )}

              <Grid item size={{ xs: 12, sm: "auto" }}>
                <TextField
                  type="number"
                  label="Jitter (0~0.1)"
                  value={jitter}
                  inputProps={{ step: 0.01, min: 0, max: 0.2 }}
                  onChange={(e) =>
                    setJitter(
                      Math.max(0, Math.min(0.2, Number(e.target.value)))
                    )
                  }
                  sx={{ minWidth: 160 }}
                  helperText="Xáo trộn nhẹ tăng ngẫu nhiên"
                />
              </Grid>

              <Grid item size={{ xs: 12 }}>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={handleInit}
                    disabled={initLoading}
                    startIcon={<RestartAlt />}
                    sx={{ color: "white !important" }}
                  >
                    Khởi tạo
                  </Button>
                </Stack>
              </Grid>
            </Grid>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ sm: "center" }}
              spacing={2}
            >
              <Stack sx={{ flex: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Phiên bốc thăm •{" "}
                  {session.mode === "group" ? "Vòng bảng" : "Knockout"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Trạng thái:{" "}
                  <b>
                    {session.status === "running"
                      ? "Đang chạy"
                      : session.status === "ready"
                        ? "Sẵn sàng"
                        : session.status === "done"
                          ? "Hoàn tất"
                          : "Đã huỷ"}
                  </b>{" "}
                  • Tiến độ: {progress.cur}/{progress.total}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <LinearProgress variant="determinate" value={progress.pct} />
                </Box>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: { xs: 1, sm: 0 } }}>
                <Button
                  variant="contained"
                  disabled={!canReveal || revealLoading}
                  onClick={handleReveal}
                  startIcon={<PlayArrow />}
                  sx={{ color: "white !important" }}
                >
                  Bốc tiếp
                </Button>
                <Button
                  variant="outlined"
                  disabled={!(session.cursor > 0) || undoLoading}
                  onClick={handleUndo}
                  startIcon={<Undo />}
                >
                  Undo
                </Button>
                {isKO && (
                  <Button
                    variant="outlined"
                    color="success"
                    disabled={finLoading}
                    onClick={handleFinalizeKo}
                    startIcon={<DoneAll />}
                  >
                    Tạo R1 (Finalize)
                  </Button>
                )}
                <Button
                  variant="outlined"
                  color="error"
                  disabled={cancelLoading}
                  onClick={handleCancel}
                  startIcon={<Cancel />}
                >
                  Huỷ phiên
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}

        {/* Bảng hiển thị */}
        {session && ["ready", "running", "done"].includes(session.status) && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 1 }}
            >
              <Typography variant="h6" fontWeight={700}>
                Kết quả bốc thăm
              </Typography>
              <Chip
                size="small"
                color={session.mode === "group" ? "default" : "primary"}
                variant="outlined"
                label={session.mode === "group" ? "Group" : "Knockout"}
              />
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Cập nhật:{" "}
                {session.updatedAt
                  ? new Date(session.updatedAt).toLocaleString()
                  : "—"}
              </Typography>
            </Stack>

            <Divider sx={{ mb: 2 }} />

            {session.mode === "group" ? (
              <GroupBoard session={session} eventType={eventType} />
            ) : (
              <KnockoutBoard session={session} eventType={eventType} />
            )}
          </Paper>
        )}
      </Box>
      {/* <Footer /> */}
    </>
  );
}
