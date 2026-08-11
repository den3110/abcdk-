// screens/PickleBall/MlpDrawLivePage.jsx
// Sân khấu bốc thăm chia bảng công khai — dùng khi BTC tổ chức buổi bốc thăm
// livestream. Operator (admin/manager) bấm nút reveal từng đội, event stream
// qua socket cho viewers.
//
// Route: /tournament/:id/mlp/draw/live
// Query: ?mode=viewer (mặc định operator nếu có quyền)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Grid,
  Grow,
  Paper,
  Slide,
  Stack,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";

import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import {
  useBroadcastMlpLiveDrawMutation,
  useDrawMlpPoolsMutation,
  useListMlpPoolsQuery,
  useListMlpTeamsQuery,
} from "../../slices/mlpApiSlice";
import { useSocket } from "../../context/SocketContext";

function poolKeyFromIndex(idx) {
  if (!Number.isFinite(idx) || idx < 0) return null;
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MlpDrawLivePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const me = useSelector((s) => s.auth?.userInfo);
  const forcedViewer = searchParams.get("mode") === "viewer";

  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);
  const { data: teamsData } = useListMlpTeamsQuery(
    { tourId: id, status: "approved" },
    { skip: !id },
  );
  const { data: poolsData } = useListMlpPoolsQuery(id, { skip: !id });
  const [broadcast] = useBroadcastMlpLiveDrawMutation();
  const [drawPools, { isLoading: committing }] = useDrawMlpPoolsMutation();

  const socket = useSocket();

  const isAdmin = !!(me?.role === "admin" || me?.isAdmin || me?.isSuperUser);
  const isManager = useMemo(() => {
    if (!me?._id || !tour) return false;
    if (String(tour.createdBy?._id ?? tour.createdBy) === String(me._id))
      return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some(
        (m) => String(m?.user?._id ?? m?.user ?? m) === String(me._id),
      );
    }
    return false;
  }, [me?._id, tour]);
  const canOperate = (isAdmin || isManager) && !forcedViewer;

  const gs = tour?.mlpConfig?.groupStage || {};
  const poolCount = gs.poolCount || 4;

  const teams = useMemo(
    () => (teamsData?.items || []).filter((t) => t.status === "approved"),
    [teamsData],
  );

  // Live state — dùng cho cả operator và viewer.
  // reveals: [{teamId, poolIndex, poolKey, seed}]
  const [reveals, setReveals] = useState([]);
  const [highlightTeamId, setHighlightTeamId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | started | done | committed
  const [nowRevealing, setNowRevealing] = useState(null); // {team, target}
  const poolSeeds = useRef(new Map()); // poolIndex → count

  // Khởi tạo từ pool hiện tại nếu đã có
  useEffect(() => {
    if (poolsData?.pools?.length) {
      const initial = [];
      const cnt = new Map();
      for (const p of poolsData.pools) {
        for (const t of p.teams || []) {
          cnt.set(p.index, (cnt.get(p.index) || 0) + 1);
          initial.push({
            teamId: String(t._id),
            poolIndex: p.index,
            poolKey: p.key,
            seed: cnt.get(p.index),
          });
        }
      }
      if (initial.length) {
        setReveals(initial);
        setStatus("committed");
        poolSeeds.current = cnt;
      }
    }
  }, [poolsData]);

  // Socket subscribe
  useEffect(() => {
    if (!socket || !id) return;
    const join = () => socket.emit?.("mlp:tour:subscribe", { tourId: id });
    join();
    socket.on?.("connect", join);
    const onStart = () => {
      setReveals([]);
      setStatus("started");
      poolSeeds.current = new Map();
    };
    const onReveal = (p) => {
      poolSeeds.current.set(
        p.poolIndex,
        (poolSeeds.current.get(p.poolIndex) || 0) + 1,
      );
      const seed = poolSeeds.current.get(p.poolIndex);
      setReveals((prev) => {
        if (prev.some((r) => r.teamId === p.teamId)) return prev;
        return [
          ...prev,
          {
            teamId: p.teamId,
            poolIndex: p.poolIndex,
            poolKey: p.poolKey || poolKeyFromIndex(p.poolIndex),
            seed,
            teamName: p.teamName,
            teamLogo: p.teamLogo,
            teamColor: p.teamColor,
          },
        ];
      });
      setNowRevealing({
        teamId: p.teamId,
        poolIndex: p.poolIndex,
        teamName: p.teamName,
      });
      setTimeout(() => setNowRevealing(null), 2200);
    };
    const onHighlight = (p) => {
      setHighlightTeamId(p.teamId || null);
    };
    const onReset = () => {
      setReveals([]);
      setStatus("idle");
      setNowRevealing(null);
      poolSeeds.current = new Map();
    };
    const onCommit = () => setStatus("committed");
    socket.on?.("mlp:draw:start", onStart);
    socket.on?.("mlp:draw:reveal", onReveal);
    socket.on?.("mlp:draw:highlight", onHighlight);
    socket.on?.("mlp:draw:reset", onReset);
    socket.on?.("mlp:draw:commit", onCommit);
    return () => {
      socket.off?.("connect", join);
      socket.off?.("mlp:draw:start", onStart);
      socket.off?.("mlp:draw:reveal", onReveal);
      socket.off?.("mlp:draw:highlight", onHighlight);
      socket.off?.("mlp:draw:reset", onReset);
      socket.off?.("mlp:draw:commit", onCommit);
      socket.emit?.("mlp:tour:unsubscribe", { tourId: id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, id]);

  const revealedIds = useMemo(
    () => new Set(reveals.map((r) => r.teamId)),
    [reveals],
  );
  const remainingTeams = useMemo(
    () => teams.filter((t) => !revealedIds.has(String(t._id))),
    [teams, revealedIds],
  );

  const groupedPools = useMemo(() => {
    const arr = Array.from({ length: poolCount }).map((_, i) => ({
      index: i,
      key: poolKeyFromIndex(i),
      teams: [],
    }));
    const byId = new Map(teams.map((t) => [String(t._id), t]));
    for (const r of reveals) {
      const pool = arr[r.poolIndex];
      if (!pool) continue;
      pool.teams.push({
        ...r,
        team: byId.get(String(r.teamId)),
      });
    }
    return arr;
  }, [reveals, poolCount, teams]);

  // Operator actions
  const handleStart = async () => {
    if (!canOperate) return;
    setReveals([]);
    setStatus("started");
    poolSeeds.current = new Map();
    try {
      await broadcast({
        tid: id,
        event: "start",
        payload: { poolCount },
      }).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Không phát được event");
    }
  };

  const handleReveal = async () => {
    if (!canOperate) return;
    if (remainingTeams.length === 0) {
      toast.info("Đã bốc thăm hết đội");
      setStatus("done");
      return;
    }
    // Pick 1 random đội chưa reveal
    const team = shuffle(remainingTeams)[0];
    // Chọn pool có ít đội nhất (cân bằng)
    const counts = groupedPools.map((p) => p.teams.length);
    const minCount = Math.min(...counts);
    const candidates = groupedPools.filter((p) => p.teams.length === minCount);
    const target = shuffle(candidates)[0];
    setHighlightTeamId(String(team._id));
    try {
      await broadcast({
        tid: id,
        event: "highlight",
        payload: { teamId: String(team._id) },
      }).unwrap();
    } catch {}
    // Đợi 1.5s cho animation "spinning" trước khi reveal
    setTimeout(async () => {
      try {
        await broadcast({
          tid: id,
          event: "reveal",
          payload: {
            teamId: String(team._id),
            teamName: team.name,
            teamLogo: team.logo,
            teamColor: team.color,
            poolIndex: target.index,
            poolKey: target.key,
          },
        }).unwrap();
      } catch (err) {
        toast.error(err?.data?.message || "Không phát được event");
      }
      setHighlightTeamId(null);
    }, 1500);
  };

  const handleReset = async () => {
    if (!canOperate) return;
    if (!window.confirm("Reset toàn bộ bốc thăm hiện tại?")) return;
    try {
      await broadcast({ tid: id, event: "reset", payload: {} }).unwrap();
    } catch {}
    setReveals([]);
    setStatus("idle");
    poolSeeds.current = new Map();
  };

  const handleCommit = async () => {
    if (!canOperate) return;
    if (reveals.length === 0) {
      toast.error("Chưa có đội nào được bốc thăm");
      return;
    }
    try {
      const assignments = reveals.map((r) => ({
        teamId: r.teamId,
        poolIndex: r.poolIndex,
        seed: r.seed,
      }));
      const r = await drawPools({
        tid: id,
        method: "manual",
        poolCount,
        assignments,
      }).unwrap();
      toast.success(
        `Đã commit bốc thăm: ${r.updated} đội vào ${r.pools?.length || poolCount} bảng`,
      );
      setStatus("committed");
      try {
        await broadcast({ tid: id, event: "commit", payload: {} }).unwrap();
      } catch {}
    } catch (err) {
      toast.error(err?.data?.message || "Commit thất bại");
    }
  };

  if (tourLoading) {
    return (
      <Box textAlign="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (tour?.tournamentMode !== "mlp") {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="warning">Giải này không MLP.</Alert>
      </Container>
    );
  }
  if (!gs.enabled) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="warning">
          Giải chưa bật vòng bảng. Vào Cấu hình MLP để bật.
        </Alert>
      </Container>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#0a1834",
        color: "#fff",
        py: { xs: 2, md: 4 },
      }}
    >
      <Container maxWidth="xl">
        {/* Header */}
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ md: "center" }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h4" fontWeight={900}>
              🎲 Bốc thăm chia bảng · {tour?.name}
            </Typography>
            <Typography variant="body2" sx={{ color: "#94A3B8" }}>
              {teams.length} đội · {poolCount} bảng · Top {gs.topPerPool || 2}{" "}
              vào Knockout
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {canOperate ? (
              <>
                {status === "idle" && (
                  <Button
                    variant="contained"
                    color="warning"
                    size="large"
                    onClick={handleStart}
                  >
                    Bắt đầu bốc thăm
                  </Button>
                )}
                {status === "started" && remainingTeams.length > 0 && (
                  <Button
                    variant="contained"
                    color="warning"
                    size="large"
                    onClick={handleReveal}
                    disabled={!!nowRevealing}
                  >
                    🎯 Bốc đội tiếp theo
                  </Button>
                )}
                {(status === "started" || status === "done") &&
                  reveals.length > 0 && (
                    <Button
                      variant="contained"
                      color="success"
                      size="large"
                      onClick={handleCommit}
                      disabled={committing}
                    >
                      {committing ? "Đang commit..." : "✅ Commit"}
                    </Button>
                  )}
                {status !== "idle" && (
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={handleReset}
                    sx={{ color: "#fff", borderColor: "#fff" }}
                  >
                    Reset
                  </Button>
                )}
              </>
            ) : (
              <Chip
                label="Chế độ xem"
                sx={{ bgcolor: "#334155", color: "#fff" }}
              />
            )}
            <Button
              size="small"
              onClick={() => navigate(`/tournament/${id}/mlp/duals`)}
              sx={{ color: "#fff", borderColor: "#fff" }}
              variant="outlined"
            >
              ← Về Duals
            </Button>
          </Stack>
        </Stack>

        {/* Now revealing overlay */}
        <Grow in={!!nowRevealing} timeout={{ enter: 400, exit: 300 }}>
          <Box
            sx={{
              position: "fixed",
              top: "40%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9999,
              textAlign: "center",
              pointerEvents: "none",
              display: nowRevealing ? "block" : "none",
            }}
          >
            <Paper
              elevation={12}
              sx={{
                bgcolor: "#facc15",
                color: "#0a1834",
                px: 6,
                py: 4,
                borderRadius: 4,
              }}
            >
              <Typography variant="body2" fontWeight={800}>
                Đội mới bốc:
              </Typography>
              <Typography variant="h3" fontWeight={900}>
                {nowRevealing?.teamName}
              </Typography>
              <Typography variant="h5" fontWeight={800}>
                → Bảng{" "}
                {nowRevealing
                  ? poolKeyFromIndex(nowRevealing.poolIndex)
                  : ""}
              </Typography>
            </Paper>
          </Box>
        </Grow>

        {/* Pools grid */}
        <Grid container spacing={2}>
          {groupedPools.map((p) => (
            <Grid item xs={12} sm={6} md={12 / Math.min(4, poolCount)} key={p.index}>
              <Paper
                sx={{
                  bgcolor: "#1e293b",
                  color: "#fff",
                  p: 2,
                  borderRadius: 3,
                  border: "2px solid #334155",
                  minHeight: 260,
                }}
              >
                <Typography
                  variant="h5"
                  fontWeight={900}
                  sx={{ mb: 1.5, textAlign: "center" }}
                >
                  Bảng {p.key}
                </Typography>
                <Stack spacing={1}>
                  {p.teams.map((it) => (
                    <Slide
                      key={it.teamId}
                      in
                      direction="right"
                      timeout={400}
                      appear
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{
                          bgcolor: "#334155",
                          p: 1,
                          borderRadius: 2,
                        }}
                      >
                        <Chip
                          size="small"
                          label={`#${it.seed}`}
                          sx={{ bgcolor: "#facc15", color: "#0a1834", fontWeight: 800 }}
                        />
                        <Avatar
                          src={it.teamLogo || it.team?.logo}
                          sx={{
                            bgcolor:
                              it.teamColor || it.team?.color || "#3b82f6",
                            width: 32,
                            height: 32,
                          }}
                        >
                          {(it.teamName || it.team?.name || "?")[0]}
                        </Avatar>
                        <Typography fontWeight={700} noWrap sx={{ flex: 1 }}>
                          {it.teamName || it.team?.name}
                        </Typography>
                      </Stack>
                    </Slide>
                  ))}
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>

        {/* Remaining teams pool */}
        {status !== "idle" && remainingTeams.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="h6" fontWeight={900} sx={{ mb: 1 }}>
              Chờ bốc ({remainingTeams.length})
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {remainingTeams.map((t) => {
                const isHi = String(t._id) === highlightTeamId;
                return (
                  <Chip
                    key={t._id}
                    avatar={
                      <Avatar
                        src={t.logo}
                        sx={{ bgcolor: t.color || "#3b82f6" }}
                      >
                        {t.name?.[0]}
                      </Avatar>
                    }
                    label={t.name}
                    sx={{
                      bgcolor: isHi ? "#facc15" : "#334155",
                      color: isHi ? "#0a1834" : "#fff",
                      fontWeight: 700,
                      transform: isHi ? "scale(1.15)" : "scale(1)",
                      transition: "all 0.3s ease",
                      animation: isHi
                        ? "wiggle 0.5s ease-in-out infinite"
                        : undefined,
                      "@keyframes wiggle": {
                        "0%, 100%": { transform: "scale(1.15) rotate(0)" },
                        "25%": { transform: "scale(1.15) rotate(-3deg)" },
                        "75%": { transform: "scale(1.15) rotate(3deg)" },
                      },
                    }}
                  />
                );
              })}
            </Stack>
          </Box>
        )}
        {status === "idle" && (
          <Alert
            severity="info"
            sx={{ mt: 3, borderRadius: 2, bgcolor: "#1e40af", color: "#fff" }}
          >
            {canOperate
              ? "Bấm 'Bắt đầu bốc thăm' để mở phiên. Viewers có thể xem qua URL này (?mode=viewer)."
              : "Chờ BTC bắt đầu bốc thăm..."}
          </Alert>
        )}
      </Container>
    </Box>
  );
}
