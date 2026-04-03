/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { useSelector } from "react-redux";
import { useLiveMatch } from "../../hook/useLiveMatch";
import {
  getMatchCourtStationName,
  getMatchDisplayCode,
  getPairDisplayName,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay";

const textOf = (value) => (value && String(value).trim()) || "";

const pairLabel = (pair, source) => getPairDisplayName(pair, source) || "TBD";

const matchCode = (match) =>
  getMatchDisplayCode(match) ||
  textOf(match?.displayCode) ||
  textOf(match?.globalCode) ||
  textOf(match?.code) ||
  `R${match?.round ?? "?"}-${(match?.order ?? 0) + 1}`;

const courtLabelOf = (match) =>
  textOf(getMatchCourtStationName(match)) ||
  textOf(match?.courtStationName) ||
  textOf(match?.courtStationLabel) ||
  textOf(match?.courtLabel) ||
  textOf(match?.court?.name) ||
  textOf(match?.court?.label) ||
  "Chưa gán sân";

const sidePairOf = (match, side) => {
  if (side === "A") {
    return match?.pairA || match?.teams?.A || match?.teamA || match?.sideA || null;
  }
  return match?.pairB || match?.teams?.B || match?.teamB || match?.sideB || null;
};

const currentGameIndexOf = (match) =>
  Number.isInteger(match?.currentGame) ? match.currentGame : 0;

const currentScoreOf = (match) => {
  const game = match?.gameScores?.[currentGameIndexOf(match)] || {};
  return {
    a: Number(game?.a || 0),
    b: Number(game?.b || 0),
  };
};

const flipSlotNumbers = (source = {}) =>
  Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      Number(value) === 1 ? 2 : Number(value) === 2 ? 1 : value,
    ]),
  );

const ownerLabel = (owner) =>
  textOf(owner?.displayName) || textOf(owner?.deviceName) || "trọng tài khác";

export default function RefereeScoreDialog({
  open,
  matchId,
  initialMatch = null,
  onClose,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
  const { userInfo } = useSelector((state) => state.auth || {});
  const token = userInfo?.token || "";
  const { data, error, api, sync } = useLiveMatch(matchId, token, {
    offlineSync: true,
    enabled: open && Boolean(matchId),
  });

  const match = useMemo(
    () => normalizeMatchDisplay(data || initialMatch || null, data || initialMatch || null),
    [data, initialMatch],
  );
  const currentScore = useMemo(() => currentScoreOf(match || {}), [match]);
  const currentGame = currentGameIndexOf(match || {});
  const localBreak = match?.isBreak;
  const currentBase = match?.slots?.base || match?.meta?.slots?.base || { A: {}, B: {} };
  const currentLayout = match?.meta?.refereeLayout || { left: "A", right: "B" };
  const isOwner = sync?.isOwner ?? true;
  const featureEnabled = sync?.featureEnabled !== false;
  const canControl = !featureEnabled || isOwner;
  const canScoreNow = Boolean(match?._id) && match?.status === "live" && isOwner;
  const canStart =
    Boolean(match?._id) &&
    match?.status !== "live" &&
    match?.status !== "finished" &&
    canControl;

  const [pointsToWin, setPointsToWin] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [courts, setCourts] = useState([]);
  const [courtsLoading, setCourtsLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setPointsToWin(
      match?.rules?.pointsToWin != null ? String(match.rules.pointsToWin) : "",
    );
  }, [match?.rules?.pointsToWin]);

  const handleError = (nextError) => {
    setActionError(textOf(nextError?.message) || "Thao tác không thành công.");
  };

  const runBusy = async (key, task) => {
    setActionError("");
    setBusy(key);
    try {
      await task();
    } catch (nextError) {
      handleError(nextError);
    } finally {
      setBusy("");
    }
  };

  const loadCourts = async () => {
    setCourtsLoading(true);
    await runBusy("courts", async () => {
      const result = await api.listCourts({ includeBusy: true });
      const items = Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
          ? result
          : [];
      setCourts(items);
    });
    setCourtsLoading(false);
  };

  const handleTimeout = async (type, side) => {
    const timeoutMinutes = Number(match?.timeoutMinutes || 1);
    const expectedResumeAt = new Date(Date.now() + timeoutMinutes * 60000).toISOString();
    await runBusy(type, () =>
      api.setBreak({
        active: true,
        note: `${type}:${side}`,
        afterGame: currentGame,
        expectedResumeAt,
      }),
    );
  };

  const handleContinue = async () => {
    await runBusy("continue", () =>
      api.setBreak({
        active: false,
        note: "",
        afterGame: currentGame,
      }),
    );
  };

  const handleUpdateSettings = async () => {
    await runBusy("settings", () =>
      api.updateSettings({
        pointsToWin: Number(pointsToWin || match?.rules?.pointsToWin || 11),
      }),
    );
  };

  const handleFlipSlots = async (side) => {
    const nextBase = {
      ...currentBase,
      [side]: flipSlotNumbers(currentBase?.[side] || {}),
    };
    await runBusy(`slots-${side}`, () =>
      api.setSlotsBase({
        base: nextBase,
        layout: currentLayout,
        serve: match?.serve || null,
      }),
    );
  };

  const handleFlipLayout = async () => {
    await runBusy("layout", () =>
      api.setSlotsBase({
        base: currentBase,
        layout:
          currentLayout?.left === "B"
            ? { left: "A", right: "B" }
            : { left: "B", right: "A" },
        serve: match?.serve || null,
      }),
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="lg"
    >
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Box>
            <Typography variant="h6" fontWeight={800}>
              {matchCode(match || {})}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {courtLabelOf(match || {})}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {sync?.pendingCount ? (
              <Chip color="warning" label={`Chờ sync ${sync.pendingCount}`} />
            ) : null}
            {featureEnabled ? (
              <Chip
                color={isOwner ? "success" : "warning"}
                label={isOwner ? "Đang giữ quyền" : `Bị khóa bởi ${ownerLabel(sync?.owner)}`}
              />
            ) : (
              <Chip color="default" label="Khóa trọng tài đang tắt" />
            )}
            {match?.video ? (
              <Button
                size="small"
                startIcon={<OpenInNewIcon />}
                onClick={() => window.open(match.video, "_blank", "noopener,noreferrer")}
              >
                Mở video
              </Button>
            ) : null}
            <Button size="small" startIcon={<CloseIcon />} onClick={onClose}>
              Đóng
            </Button>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{textOf(error?.message) || "Không tải được dữ liệu trận."}</Alert> : null}
          {actionError ? <Alert severity="error">{actionError}</Alert> : null}
          {sync?.hasConflict ? (
            <Alert
              severity="warning"
              action={
                <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => sync.takeover?.()}>Take over</Button>
                <Button size="small" onClick={() => sync.discardRejected?.()}>Bỏ queue</Button>
                </Stack>
              }
            >
              Trận đang bị khóa bởi {ownerLabel(sync?.owner)}. Bạn cần takeover để tiếp tục chấm.
            </Alert>
          ) : null}
          {featureEnabled && !isOwner && !sync?.hasConflict ? (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={() => sync.takeover?.()}>
                  Take over
                </Button>
              }
            >
              Trận hiện do {ownerLabel(sync?.owner)} điều khiển.
            </Alert>
          ) : null}

          <Box sx={{ p: 2.5, borderRadius: 3, bgcolor: "grey.50", border: "1px solid", borderColor: "divider" }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} gap={2}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h5" fontWeight={800}>
                  {pairLabel(sidePairOf(match, "A"), match)}
                </Typography>
                <Typography variant="body2" color="text.secondary">Đội A</Typography>
              </Box>
              <Box sx={{ textAlign: "center", minWidth: 220 }}>
                <Typography variant="caption" color="text.secondary">
                  Ván {currentGame + 1}
                </Typography>
                <Typography variant="h2" fontWeight={900} lineHeight={1}>
                  {currentScore.a} : {currentScore.b}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Giao bóng: {textOf(match?.serve?.side) || "A"} / Server {match?.serve?.server ?? 2}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, textAlign: { xs: "left", md: "right" } }}>
                <Typography variant="h5" fontWeight={800}>
                  {pairLabel(sidePairOf(match, "B"), match)}
                </Typography>
                <Typography variant="body2" color="text.secondary">Đội B</Typography>
              </Box>
            </Stack>
          </Box>

          <Stack direction="row" flexWrap="wrap" gap={1}>
            {canStart ? (
              <Button variant="contained" onClick={() => runBusy("start", () => api.start())} disabled={busy === "start"}>
                Bắt đầu
              </Button>
            ) : null}
            <Button variant="contained" onClick={() => runBusy("pointA", () => api.pointA(1))} disabled={!canScoreNow || busy === "pointA"}>
              +1 A
            </Button>
            <Button variant="contained" onClick={() => runBusy("pointB", () => api.pointB(1))} disabled={!canScoreNow || busy === "pointB"}>
              +1 B
            </Button>
            <Button variant="outlined" onClick={() => runBusy("undo", () => api.undo())} disabled={!canScoreNow || busy === "undo"}>
              Undo
            </Button>
            <Button variant="outlined" onClick={() => runBusy("nextGame", () => api.nextGame({ autoNext: true }))} disabled={!canScoreNow || busy === "nextGame"}>
              Bắt game tiếp
            </Button>
            <Button color="success" variant="contained" onClick={() => runBusy("finishA", () => api.finish("A", "finish"))} disabled={!canScoreNow || busy === "finishA"}>
              Finish A
            </Button>
            <Button color="success" variant="contained" onClick={() => runBusy("finishB", () => api.finish("B", "finish"))} disabled={!canScoreNow || busy === "finishB"}>
              Finish B
            </Button>
            <Button color="error" variant="outlined" onClick={() => runBusy("forfeitA", () => api.forfeit("A", "forfeit"))} disabled={!canScoreNow || busy === "forfeitA"}>
              Forfeit A
            </Button>
            <Button color="error" variant="outlined" onClick={() => runBusy("forfeitB", () => api.forfeit("B", "forfeit"))} disabled={!canScoreNow || busy === "forfeitB"}>
              Forfeit B
            </Button>
          </Stack>

          <Divider />
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Break</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleTimeout("timeout", "A")}>Timeout A</Button>
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleTimeout("timeout", "B")}>Timeout B</Button>
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleTimeout("medical", "A")}>Nghỉ y tế A</Button>
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleTimeout("medical", "B")}>Nghỉ y tế B</Button>
                <Button variant="contained" color="warning" disabled={!localBreak?.active} onClick={handleContinue}>Continue</Button>
              </Stack>
              {localBreak?.active ? (
                <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                  Đang nghỉ: {textOf(localBreak?.note) || "Break"}.
                </Typography>
              ) : null}
            </Box>

            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Serve và slot</Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {["A-1", "A-2", "B-1", "B-2"].map((item) => {
                  const [side, server] = item.split("-");
                  return (
                    <Button
                      key={item}
                      variant="outlined"
                      disabled={!canScoreNow}
                      onClick={() => runBusy(item, () => api.setServe({ side, server: Number(server) }))}
                    >
                      {item}
                    </Button>
                  );
                })}
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleFlipSlots("A")}>Đổi tay A</Button>
                <Button variant="outlined" disabled={!canScoreNow} onClick={() => handleFlipSlots("B")}>Đổi tay B</Button>
                <Button variant="outlined" disabled={!canScoreNow} onClick={handleFlipLayout}>Đổi layout</Button>
              </Stack>
            </Box>
          </Stack>

          <Divider />
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Cấu hình trận</Typography>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TextField
                  type="number"
                  label="Points to win"
                  size="small"
                  value={pointsToWin}
                  onChange={(event) => setPointsToWin(event.target.value)}
                  sx={{ maxWidth: 160 }}
                />
                <Button variant="contained" onClick={handleUpdateSettings} disabled={busy === "settings" || !canControl}>
                  Lưu
                </Button>
              </Stack>
            </Box>

            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Gán sân</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
                <Button startIcon={<RefreshIcon />} onClick={loadCourts} disabled={courtsLoading || busy === "courts" || !canControl}>
                  Tải sân
                </Button>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="referee-court-select-label">Sân</InputLabel>
                  <Select
                    labelId="referee-court-select-label"
                    label="Sân"
                    value={selectedCourtId}
                    onChange={(event) => setSelectedCourtId(event.target.value)}
                  >
                    {courts.map((court) => (
                      <MenuItem key={court?._id || court?.id} value={court?._id || court?.id}>
                        {textOf(court?.name) || textOf(court?.label) || textOf(court?.code)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button variant="contained" disabled={!selectedCourtId || !canControl} onClick={() => runBusy("assignCourt", () => api.assignCourt({ courtId: selectedCourtId }))}>
                  Gán
                </Button>
                <Button variant="outlined" color="warning" disabled={(!match?.court && !match?.courtStationId) || !canControl} onClick={() => runBusy("unassignCourt", () => api.unassignCourt({ toStatus: "queued" }))}>
                  Bỏ gán
                </Button>
              </Stack>
            </Box>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => sync?.syncNow?.()} disabled={!sync?.pendingCount || sync?.syncing}>
          Sync ngay
        </Button>
        {featureEnabled ? (
          <Button onClick={() => sync?.claim?.()} disabled={sync?.claiming}>
            Claim
          </Button>
        ) : null}
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
