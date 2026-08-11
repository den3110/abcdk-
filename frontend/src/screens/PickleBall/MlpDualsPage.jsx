// screens/PickleBall/MlpDualsPage.jsx
// Danh sách dual matches + generate + scoring hub cho MLP.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
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
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { RefreshCw, Play, Zap, Shuffle, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import {
  useListMlpDualsQuery,
  useGenerateMlpDualsMutation,
  useSyncSubMatchResultMutation,
  useGenerateMlpKnockoutMutation,
  useDeleteMlpDualMutation,
  useListMlpTournamentCourtsQuery,
  usePatchMlpDualMutation,
} from "../../slices/mlpApiSlice";
import TournamentCourtClusterDialog from "../../components/TournamentCourtClusterDialog";
import MlpPoolDrawDialog from "../../components/mlp/MlpPoolDrawDialog";
import MlpResetDialog from "../../components/mlp/MlpResetDialog";

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

function LineupRow({ side, players }) {
  if (!Array.isArray(players) || players.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        Team {side}: chưa cấu hình
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ minWidth: 44, fontWeight: 700 }}
      >
        Team {side}:
      </Typography>
      {players.map((p) => (
        <Chip
          key={p._id}
          size="small"
          avatar={
            p.avatar ? (
              <Avatar src={p.avatar} sx={{ width: 20, height: 20 }} />
            ) : undefined
          }
          label={p.nickname || p.name || "?"}
          sx={{ height: 22, fontSize: 11 }}
        />
      ))}
    </Stack>
  );
}

function DualCard({
  dual,
  tour,
  onSync,
  canManage,
  onOpen,
  courtOptions,
  onPatchCourt,
  patching,
}) {
  const cfg = tour?.mlpConfig || {};
  const courtValue = dual?.courtStation?._id
    ? `station:${dual.courtStation._id}`
    : dual?.courtStation
      ? `station:${dual.courtStation}`
      : dual?.court?._id
        ? `court:${dual.court._id}`
        : dual?.court
          ? `court:${dual.court}`
          : "";
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

        {/* Lineup preview + court assign inline */}
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {(dual.subMatches || []).map((sub) => (
            <Box
              key={sub._id || sub.slotKey}
              sx={{
                p: 1,
                borderRadius: 1.5,
                border: 1,
                borderColor: "divider",
                bgcolor: "background.default",
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 0.5 }}
              >
                <Chip
                  size="small"
                  label={sub.slotKey}
                  variant="outlined"
                  sx={{ fontWeight: 800, minWidth: 50 }}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flex: 1 }}
                >
                  {(cfg.slots || []).find((s) => s.key === sub.slotKey)?.label ||
                    ""}
                </Typography>
                <Typography variant="caption" fontWeight={700}>
                  {sub.result?.scoreA ?? 0} - {sub.result?.scoreB ?? 0}
                </Typography>
              </Stack>
              <Stack spacing={0.25}>
                <LineupRow side="A" players={sub.playersA} />
                <LineupRow side="B" players={sub.playersB} />
              </Stack>
            </Box>
          ))}
        </Stack>

        {canManage && (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ sm: "center" }}
            sx={{ mt: 1.5 }}
          >
            <Select
              size="small"
              value={courtValue}
              onChange={(e) => onPatchCourt?.(dual._id, e.target.value)}
              displayEmpty
              disabled={patching || dual.status === "finished"}
              sx={{ minWidth: 240, flex: 1 }}
            >
              <MenuItem value="">— Chưa gán sân —</MenuItem>
              {courtOptions.map((c) => (
                <MenuItem
                  key={`${c.type}:${c._id}`}
                  value={`${c.type}:${c._id}`}
                >
                  🏟️ {c.name}
                  {c.cluster ? ` (${c.cluster})` : ""} ·{" "}
                  {c.type === "station" ? "Station" : "Court"}
                </MenuItem>
              ))}
            </Select>
            {(dual.courtStation?.name || dual.court?.name) && (
              <Chip
                size="small"
                label={`Trọng tài theo sân${
                  dual.referees?.length
                    ? ` (${dual.referees.length})`
                    : " (chưa cấu hình)"
                }`}
                color={dual.referees?.length ? "success" : "default"}
                variant="outlined"
              />
            )}
          </Stack>
        )}

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
  const me = useSelector((s) => s.auth?.userInfo);
  const [genOpen, setGenOpen] = useState(false);
  const [format, setFormat] = useState("roundrobin");

  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);
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
  const canManage = isAdmin || isManager;
  const { data, isFetching, refetch } = useListMlpDualsQuery(
    { tourId: id },
    { skip: !id },
  );
  const [gen, { isLoading: generating }] = useGenerateMlpDualsMutation();
  const [syncSub] = useSyncSubMatchResultMutation();
  const [genKnockout, { isLoading: koLoading }] = useGenerateMlpKnockoutMutation();
  const [deleteDual] = useDeleteMlpDualMutation();
  const [patchDual, { isLoading: patchingCourt }] = usePatchMlpDualMutation();
  const { data: courtsRes } = useListMlpTournamentCourtsQuery(id, { skip: !id });
  const courtOptions = courtsRes?.items || [];

  const handleInlinePatchCourt = async (dualId, value) => {
    try {
      const payload = { dualId, tourId: id };
      if (value.startsWith("court:")) {
        payload.court = value.slice(6);
        payload.courtStation = null;
      } else if (value.startsWith("station:")) {
        payload.courtStation = value.slice(8);
        payload.court = null;
      } else {
        payload.court = null;
        payload.courtStation = null;
      }
      await patchDual(payload).unwrap();
      toast.success("Đã gán sân");
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Không gán được sân");
    }
  };
  const [clusterDialogOpen, setClusterDialogOpen] = useState(false);
  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [poolTab, setPoolTab] = useState("all"); // 'all' | poolKey | 'knockout'

  const gsEnabled = tour?.mlpConfig?.groupStage?.enabled === true;
  const drawStatus = tour?.mlpConfig?.groupStage?.drawStatus || "idle";

  const handleGenKnockout = async () => {
    try {
      let body;
      if (gsEnabled) {
        const topPerPool = tour?.mlpConfig?.groupStage?.topPerPool || 2;
        if (
          !window.confirm(
            `Sinh knockout: lấy top ${topPerPool} đội mỗi bảng.\n\nNếu vòng bảng chưa xong → các slot chưa xác định sẽ hiện "Nhất bảng A"/"Nhì bảng B"... và tự động fill khi bảng đó kết thúc.\n\nTiếp tục?`,
          )
        )
          return;
        body = { tid: id, topPerPool, crossPoolPairing: "cross" };
      } else {
        const raw = window.prompt("Số team vào knockout (2/4/8)?", "4");
        const topN = Math.max(2, Math.min(32, Number(raw) || 4));
        body = { tid: id, topN };
      }
      const r = await genKnockout(body).unwrap();
      toast.success(
        `Đã sinh knockout · ${r.round1Generated || 0} trận vòng 1 (${r.totalRounds || 1} vòng)`,
      );
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Lỗi");
    }
  };
  const handleDeleteDual = async (dualId) => {
    if (!window.confirm("Xoá dual này?")) return;
    try {
      await deleteDual(dualId).unwrap();
      toast.success("Đã xoá");
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Lỗi");
    }
  };

  const rawItems = data?.items || [];
  // Captain (không phải admin/manager) chỉ thấy dual có đội mình tham gia.
  const visibleItems = useMemo(() => {
    if (canManage) return rawItems;
    if (!me?._id) return rawItems;
    const myId = String(me._id);
    return rawItems.filter((d) => {
      const capA = String(d?.teamA?.captain?._id || d?.teamA?.captain || "");
      const capB = String(d?.teamB?.captain?._id || d?.teamB?.captain || "");
      return capA === myId || capB === myId;
    });
  }, [rawItems, canManage, me?._id]);

  // Group dual list theo phase + poolKey / knockoutRound.
  // Chỉ áp dụng khi giải bật group stage; giải flat cũ dùng grouping theo round.
  const grouped = useMemo(() => {
    const groups = {
      group: new Map(), // poolKey → [duals]
      knockout: new Map(), // knockoutRound → [duals]
      legacy: new Map(), // round → [duals] (flat mode BC)
    };
    for (const d of visibleItems) {
      if (d.phase === "group") {
        const k = d.poolKey || "?";
        if (!groups.group.has(k)) groups.group.set(k, []);
        groups.group.get(k).push(d);
      } else if (d.phase === "knockout") {
        const r = d.knockoutRound || 1;
        if (!groups.knockout.has(r)) groups.knockout.set(r, []);
        groups.knockout.get(r).push(d);
      } else {
        const r = d.round || 1;
        if (!groups.legacy.has(r)) groups.legacy.set(r, []);
        groups.legacy.get(r).push(d);
      }
    }
    return groups;
  }, [visibleItems]);

  const poolKeys = useMemo(
    () => [...grouped.group.keys()].sort(),
    [grouped],
  );
  const knockoutRounds = useMemo(
    () => [...grouped.knockout.keys()].sort((a, b) => a - b),
    [grouped],
  );

  // items hiện tại theo tab
  const items = useMemo(() => {
    if (poolTab === "all") return visibleItems;
    if (poolTab === "knockout") {
      return visibleItems.filter((d) => d.phase === "knockout");
    }
    // Pool key tab
    return visibleItems.filter(
      (d) => d.phase === "group" && d.poolKey === poolTab,
    );
  }, [visibleItems, poolTab]);

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
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            onClick={() => navigate(`/tournament/${id}/mlp/teams`)}
          >
            Teams
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate(`/tournament/${id}/mlp/standings`)}
          >
            BXH
          </Button>
          {canManage && (
            <>
              <Button
                variant="outlined"
                onClick={() => setClusterDialogOpen(true)}
              >
                Quản lý cụm sân
              </Button>
              {gsEnabled && (
                <>
                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<Shuffle size={14} />}
                    onClick={() => setDrawDialogOpen(true)}
                  >
                    Bốc thăm chia bảng
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={() =>
                      navigate(`/tournament/${id}/mlp/draw/live`)
                    }
                  >
                    🎲 Sân khấu bốc thăm
                  </Button>
                </>
              )}
              <Button
                variant="outlined"
                color="secondary"
                onClick={handleGenKnockout}
                disabled={koLoading}
              >
                {koLoading ? "Đang tạo…" : "Sinh knockout"}
              </Button>
              <Button variant="contained" onClick={() => setGenOpen(true)}>
                {gsEnabled ? "Sinh vòng bảng" : "Generate duals"}
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<Trash2 size={14} />}
                onClick={() => setResetDialogOpen(true)}
              >
                Reset giải
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {gsEnabled && drawStatus !== "committed" && canManage && (
        <Alert
          severity="warning"
          sx={{ mb: 2, borderRadius: 2 }}
          action={
            <Button
              size="small"
              color="warning"
              onClick={() => setDrawDialogOpen(true)}
            >
              Bốc thăm ngay
            </Button>
          }
        >
          Giải đang bật vòng bảng nhưng CHƯA bốc thăm. Bốc thăm chia bảng trước
          khi sinh dual matches.
        </Alert>
      )}

      {gsEnabled && (poolKeys.length > 0 || knockoutRounds.length > 0) && (
        <Tabs
          value={poolTab}
          onChange={(_, v) => setPoolTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2 }}
        >
          <Tab value="all" label={`Tất cả (${visibleItems.length})`} />
          {poolKeys.map((k) => (
            <Tab
              key={k}
              value={k}
              label={`Bảng ${k} (${grouped.group.get(k).length})`}
            />
          ))}
          {knockoutRounds.length > 0 && (
            <Tab
              value="knockout"
              label={`Knockout (${knockoutRounds.reduce((n, r) => n + grouped.knockout.get(r).length, 0)})`}
            />
          )}
        </Tabs>
      )}

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
              canManage={canManage}
              courtOptions={courtOptions}
              onPatchCourt={handleInlinePatchCourt}
              patching={patchingCourt}
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

      {/* Dialog quản lý cụm sân cho giải MLP — tái dùng dialog của giải
          thông thường. Sau khi user gán cụm, dropdown Court/Station trong
          DualAssignmentPanel sẽ list các sân thuộc cluster đó. */}
      <TournamentCourtClusterDialog
        open={clusterDialogOpen}
        tournament={tour}
        canOverride
        onClose={() => setClusterDialogOpen(false)}
        onUpdated={() => refetch()}
      />

      <MlpPoolDrawDialog
        open={drawDialogOpen}
        onClose={() => setDrawDialogOpen(false)}
        tour={tour}
        onDrawn={() => refetch()}
      />

      <MlpResetDialog
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        tour={tour}
        onReset={() => refetch()}
      />
    </Container>
  );
}
