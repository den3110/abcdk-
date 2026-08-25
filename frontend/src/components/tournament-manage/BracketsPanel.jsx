/* eslint-disable react/prop-types */
// BracketsPanel.jsx — Section CRUD vòng đấu/sơ đồ cho manager trang manage.
// Phase 2 + Phase 3 (manual pool assign) gộp trong 1 file để dễ maintain.
//
// KHÔNG đụng logic backend controllers — chỉ dùng endpoint đã có
// (admin controllers đã được mở quyền manager qua route mount ở
//  commit 18b51fdd).

import { useMemo, useState, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  DeleteOutline as DeleteIcon,
  Refresh as RefreshIcon,
  GroupWork as GroupWorkIcon,
  AccountTree as AccountTreeIcon,
  Layers as LayersIcon,
  OpenInNew as OpenInNewIcon,
  AutoAwesome as AIIcon,
} from "@mui/icons-material";
import BlueprintDialog from "./BlueprintDialog";
import GroupPairsManagerDialog from "./GroupPairsManagerDialog";
import { toast } from "react-toastify";
import { Link as RouterLink } from "react-router-dom";

import {
  useAdminGetBracketsQuery,
  useCreateBracketMutation,
  useUpdateBracketMutation,
  useDeleteBracketMutation,
  useRebuildKnockoutBracketMutation,
  useClearBracketMatchesMutation,
  useGetRegistrationsQuery,
  useInsertRegistrationIntoGroupMutation,
  useUpdateGroupStructureMutation,
} from "../../slices/tournamentsApiSlice";

/* ────────────────────── constants ────────────────────── */

const BRACKET_TYPES = [
  {
    value: "group",
    label: "Vòng bảng",
    hint: "Chia đội thành các bảng, round-robin trong bảng.",
    icon: <GroupWorkIcon fontSize="small" />,
  },
  {
    value: "knockout",
    label: "Nhánh loại trực tiếp",
    hint: "Bracket 2^n. Thua là loại.",
    icon: <AccountTreeIcon fontSize="small" />,
  },
  {
    value: "roundElim",
    label: "Vòng loại rút gọn",
    hint: "PO/Pre-qualifying: loser cascade nhiều vòng.",
    icon: <LayersIcon fontSize="small" />,
  },
  {
    value: "round_robin",
    label: "Round-robin toàn giải",
    hint: "Tất cả gặp tất cả (1 bảng lớn).",
    icon: <GroupWorkIcon fontSize="small" />,
  },
  {
    value: "double_elim",
    label: "Double elim (chuyên gia)",
    hint: "Winners + Losers bracket + Grand Final.",
    icon: <AccountTreeIcon fontSize="small" />,
  },
];

const typeLabel = (t) => BRACKET_TYPES.find((b) => b.value === t)?.label || t;
const typeIcon = (t) =>
  BRACKET_TYPES.find((b) => b.value === t)?.icon || <LayersIcon fontSize="small" />;

/* Default config theo type */
function defaultConfigForType(type) {
  if (type === "group" || type === "round_robin") {
    return {
      config: {
        rules: { bestOf: 3, pointsToWin: 11, winByTwo: true },
        roundRobin: {
          points: { win: 3, loss: 0 },
          tiebreakers: ["h2h", "setsDiff", "pointsDiff", "pointsFor"],
          groupSize: 4,
        },
      },
      groupCount: 4,
      groupSize: 4,
    };
  }
  if (type === "knockout") {
    return {
      config: { rules: { bestOf: 3, pointsToWin: 11, winByTwo: true } },
      drawRounds: 3,
      drawSize: 8,
    };
  }
  if (type === "roundElim") {
    return {
      config: {
        rules: { bestOf: 3, pointsToWin: 11, winByTwo: true },
        roundElim: { drawSize: 8, cutRounds: 2 },
      },
      drawRounds: 2,
    };
  }
  if (type === "double_elim") {
    return {
      config: {
        rules: { bestOf: 3, pointsToWin: 11, winByTwo: true },
        doubleElim: { hasGrandFinalReset: true },
      },
      drawRounds: 3,
      drawSize: 8,
    };
  }
  return { config: {} };
}

/* ────────────────────── Create/Edit dialog ────────────────────── */

function BracketEditorDialog({ open, onClose, tourId, bracket, onSaved }) {
  const isEdit = !!bracket?._id;
  const initial = isEdit
    ? {
        name: bracket.name || "",
        type: bracket.type || "knockout",
        stage: bracket.stage || 1,
        order: bracket.order || 0,
        drawRounds: bracket.drawRounds || 3,
        drawSize: bracket.drawSize || 8,
        groupCount: bracket.groups?.length || 4,
        groupSize: bracket.config?.roundRobin?.groupSize || 4,
        bestOf: bracket.config?.rules?.bestOf || 3,
        pointsToWin: bracket.config?.rules?.pointsToWin || 11,
        winByTwo: bracket.config?.rules?.winByTwo !== false,
      }
    : {
        name: "",
        type: "knockout",
        stage: 1,
        order: 0,
        drawRounds: 3,
        drawSize: 8,
        groupCount: 4,
        groupSize: 4,
        bestOf: 3,
        pointsToWin: 11,
        winByTwo: true,
      };

  const [form, setForm] = useState(initial);
  const [createBracket, { isLoading: creating }] = useCreateBracketMutation();
  const [updateBracket, { isLoading: updating }] = useUpdateBracketMutation();
  const busy = creating || updating;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const buildBody = () => {
    const type = form.type;
    const rules = {
      bestOf: Number(form.bestOf) || 3,
      pointsToWin: Number(form.pointsToWin) || 11,
      winByTwo: !!form.winByTwo,
    };
    const body = {
      name: (form.name || "").trim() || typeLabel(type),
      type,
      stage: Number(form.stage) || 1,
      order: Number(form.order) || 0,
      config: { rules },
    };
    if (type === "group" || type === "round_robin") {
      const groupSize = Math.max(2, Number(form.groupSize) || 4);
      const groupCount = Math.max(1, Number(form.groupCount) || 4);
      body.config.roundRobin = {
        points: { win: 3, loss: 0 },
        tiebreakers: ["h2h", "setsDiff", "pointsDiff", "pointsFor"],
        groupSize,
      };
      // Backend đọc thêm 2 field này khi tạo group bracket
      body.groupCount = groupCount;
      body.groupSize = groupSize;
    }
    if (type === "knockout" || type === "double_elim") {
      body.drawSize = Math.max(2, Number(form.drawSize) || 8);
      body.drawRounds =
        Math.max(1, Number(form.drawRounds) || 3) ||
        Math.ceil(Math.log2(body.drawSize));
      if (type === "double_elim") {
        body.config.doubleElim = { hasGrandFinalReset: true };
      }
    }
    if (type === "roundElim") {
      body.drawRounds = Math.max(1, Number(form.drawRounds) || 2);
      body.config.roundElim = {
        drawSize: Math.max(2, Number(form.drawSize) || 8),
        cutRounds: Math.max(1, Number(form.drawRounds) || 2),
      };
    }
    return body;
  };

  const handleSave = async () => {
    if (busy) return;
    try {
      const body = buildBody();
      if (isEdit) {
        await updateBracket({
          tournamentId: tourId,
          bracketId: bracket._id,
          body,
        }).unwrap();
        toast.success("Đã lưu vòng đấu");
      } else {
        await createBracket({ tourId, body }).unwrap();
        toast.success("Đã tạo vòng đấu");
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Không lưu được");
    }
  };

  const showKO = form.type === "knockout" || form.type === "double_elim";
  const showRE = form.type === "roundElim";
  const showGroup = form.type === "group" || form.type === "round_robin";
  const typeHint = BRACKET_TYPES.find((b) => b.value === form.type)?.hint;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {isEdit ? "Sửa vòng đấu" : "Tạo vòng đấu mới"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Tên vòng"
            placeholder={typeLabel(form.type)}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            fullWidth
            size="small"
          />

          <FormControl fullWidth size="small">
            <InputLabel>Thể thức</InputLabel>
            <Select
              value={form.type}
              label="Thể thức"
              onChange={(e) => {
                const nextType = e.target.value;
                const d = defaultConfigForType(nextType);
                setForm((f) => ({
                  ...f,
                  type: nextType,
                  ...(d.drawRounds ? { drawRounds: d.drawRounds } : {}),
                  ...(d.drawSize ? { drawSize: d.drawSize } : {}),
                  ...(d.groupCount ? { groupCount: d.groupCount } : {}),
                  ...(d.groupSize ? { groupSize: d.groupSize } : {}),
                }));
              }}
            >
              {BRACKET_TYPES.map((b) => (
                <MenuItem key={b.value} value={b.value}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {b.icon}
                    <span>{b.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {typeHint && (
            <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
              {typeHint}
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Giai đoạn (stage)"
                type="number"
                size="small"
                fullWidth
                value={form.stage}
                onChange={(e) => set("stage", e.target.value)}
                inputProps={{ min: 1 }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Thứ tự (order)"
                type="number"
                size="small"
                fullWidth
                value={form.order}
                onChange={(e) => set("order", e.target.value)}
                inputProps={{ min: 0 }}
              />
            </Grid>
          </Grid>

          {showGroup && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Số bảng"
                  type="number"
                  size="small"
                  fullWidth
                  value={form.groupCount}
                  onChange={(e) => set("groupCount", e.target.value)}
                  inputProps={{ min: 1, max: 32 }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label="Số đội mỗi bảng"
                  type="number"
                  size="small"
                  fullWidth
                  value={form.groupSize}
                  onChange={(e) => set("groupSize", e.target.value)}
                  inputProps={{ min: 2, max: 16 }}
                />
              </Grid>
            </Grid>
          )}

          {(showKO || showRE) && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label={showKO ? "Draw size (2^n)" : "Số đội đầu vào"}
                  type="number"
                  size="small"
                  fullWidth
                  value={form.drawSize}
                  onChange={(e) => set("drawSize", e.target.value)}
                  inputProps={{ min: 2 }}
                  helperText={
                    showKO
                      ? "Số slot; sẽ chèn BYE nếu thiếu."
                      : "PO cho phép số lẻ."
                  }
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label={showKO ? "Số round (log2)" : "Số vòng loại"}
                  type="number"
                  size="small"
                  fullWidth
                  value={form.drawRounds}
                  onChange={(e) => set("drawRounds", e.target.value)}
                  inputProps={{ min: 1, max: 10 }}
                />
              </Grid>
            </Grid>
          )}

          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Luật chấm
            </Typography>
          </Divider>
          <Grid container spacing={2}>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Best of</InputLabel>
                <Select
                  value={form.bestOf}
                  label="Best of"
                  onChange={(e) => set("bestOf", e.target.value)}
                >
                  <MenuItem value={1}>1 ván</MenuItem>
                  <MenuItem value={3}>3 ván</MenuItem>
                  <MenuItem value={5}>5 ván</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Điểm thắng</InputLabel>
                <Select
                  value={form.pointsToWin}
                  label="Điểm thắng"
                  onChange={(e) => set("pointsToWin", e.target.value)}
                >
                  <MenuItem value={11}>11</MenuItem>
                  <MenuItem value={15}>15</MenuItem>
                  <MenuItem value={21}>21</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <FormControlLabel
                sx={{ mt: 0.5 }}
                control={
                  <Switch
                    checked={!!form.winByTwo}
                    onChange={(e) => set("winByTwo", e.target.checked)}
                  />
                }
                label="Win by 2"
              />
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Huỷ
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} /> : null}
        >
          {isEdit ? "Lưu" : "Tạo"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ────────────────────── Manual pool assign dialog ────────────────────── */

function ManualPoolAssignDialog({ open, onClose, tourId, bracket }) {
  const theme = useTheme();
  const { data: regsData } = useGetRegistrationsQuery(tourId, {
    skip: !open,
  });
  const regs = useMemo(
    () =>
      (regsData || []).filter(
        (r) => !r.status || r.status === "approved",
      ),
    [regsData],
  );
  const groups = bracket?.groups || [];

  // Map current assignment: regId → groupIndex
  const initialAssign = useMemo(() => {
    const m = new Map();
    groups.forEach((g, gi) => {
      (g.regIds || []).forEach((rid) => {
        m.set(String(rid?._id || rid), gi);
      });
    });
    return m;
  }, [groups]);

  const [assign, setAssign] = useState(initialAssign);
  const [saving, setSaving] = useState(false);
  const [insertReg] = useInsertRegistrationIntoGroupMutation();

  // Sync khi bracket đổi
  const [syncedKey, setSyncedKey] = useState("");
  const key = `${bracket?._id}:${groups.length}`;
  if (open && key !== syncedKey) {
    setAssign(initialAssign);
    setSyncedKey(key);
  }

  const setRegGroup = (regId, gi) => {
    setAssign((prev) => {
      const next = new Map(prev);
      if (gi === "" || gi === null || gi === undefined) next.delete(regId);
      else next.set(regId, Number(gi));
      return next;
    });
  };

  const pairText = (r) => {
    const p1 = r.player1?.fullName || r.player1?.nickname || "";
    const p2 = r.player2?.fullName || r.player2?.nickname || "";
    return [p1, p2].filter(Boolean).join(" / ") || `#${String(r._id).slice(-6)}`;
  };

  const counts = useMemo(() => {
    const c = new Array(groups.length).fill(0);
    assign.forEach((gi) => {
      if (gi >= 0 && gi < c.length) c[gi]++;
    });
    return c;
  }, [assign, groups.length]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    let success = 0;
    let failed = 0;
    // Loop từng reg thay đổi so với initial, dùng insertRegIntoGroupSlot
    for (const [regId, gi] of assign.entries()) {
      const prev = initialAssign.get(regId);
      if (prev === gi) continue;
      const targetGroup = groups[gi];
      if (!targetGroup?._id) {
        failed++;
        continue;
      }
      try {
        await insertReg({
          bracketId: bracket._id,
          groupId: targetGroup._id,
          registrationId: regId,
          slotIndex: (counts[gi] || 1),
          autoGrowExpectedSize: true,
        }).unwrap();
        success++;
      } catch {
        failed++;
      }
    }
    setSaving(false);
    if (success) toast.success(`Đã gán ${success} cặp vào bảng`);
    if (failed) toast.error(`${failed} cặp lỗi không gán được`);
    onClose?.();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Chia bảng thủ công — {bracket?.name || "Vòng bảng"}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          Chọn bảng cho từng cặp đăng ký. Cặp chưa gán bảng có thể được BTC
          bốc thăm tự động sau, hoặc để trống nếu chưa cần. Sau khi Lưu:
          nếu bảng đầy hơn dự kiến, hệ thống tự tăng sức chứa (
          <code>expectedSize</code>).
        </Alert>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 1.5 }}
          flexWrap="wrap"
          useFlexGap
        >
          {groups.map((g, gi) => (
            <Chip
              key={g._id || gi}
              label={`${g.name || `Bảng ${gi + 1}`}: ${counts[gi]}/${g.expectedSize || "?"}`}
              size="small"
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                fontWeight: 700,
              }}
            />
          ))}
        </Stack>
        <TableContainer sx={{ maxHeight: 480 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Cặp</TableCell>
                <TableCell sx={{ fontWeight: 700, minWidth: 160 }}>
                  Bảng
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {regs.map((r, i) => {
                const gi = assign.get(String(r._id));
                return (
                  <TableRow key={r._id} hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>{pairText(r)}</TableCell>
                    <TableCell>
                      <Select
                        value={gi === undefined ? "" : gi}
                        onChange={(e) =>
                          setRegGroup(String(r._id), e.target.value)
                        }
                        size="small"
                        displayEmpty
                        fullWidth
                      >
                        <MenuItem value="">
                          <em>— Chưa gán —</em>
                        </MenuItem>
                        {groups.map((g, idx) => (
                          <MenuItem key={g._id || idx} value={idx}>
                            {g.name || `Bảng ${idx + 1}`}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
              {regs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} align="center">
                    <Typography variant="body2" color="text.secondary" py={3}>
                      Chưa có cặp đăng ký nào đã duyệt.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Huỷ
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || regs.length === 0}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          Lưu chia bảng
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ────────────────────── Main panel ────────────────────── */

export default function BracketsPanel({ tourId }) {
  const theme = useTheme();
  const {
    data: brackets = [],
    isLoading,
    isFetching,
    refetch,
  } = useAdminGetBracketsQuery(tourId, { skip: !tourId });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolBracket, setPoolBracket] = useState(null);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [pairsMgrOpen, setPairsMgrOpen] = useState(false);
  const [pairsMgrBracket, setPairsMgrBracket] = useState(null);

  const [deleteBracket, { isLoading: deleting }] = useDeleteBracketMutation();
  const [rebuildKO, { isLoading: rebuilding }] =
    useRebuildKnockoutBracketMutation();
  const [clearMatches, { isLoading: clearing }] =
    useClearBracketMatchesMutation();

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (b) => {
    setEditing(b);
    setEditorOpen(true);
  };
  const openPool = (b) => {
    setPoolBracket(b);
    setPoolOpen(true);
  };

  const handleDelete = useCallback(
    async (b) => {
      if (
        !window.confirm(
          `Xoá vòng "${b.name || typeLabel(b.type)}"? Mọi trận trong vòng này sẽ bị xoá theo.`,
        )
      )
        return;
      try {
        await deleteBracket({
          tournamentId: tourId,
          bracketId: b._id,
        }).unwrap();
        toast.success("Đã xoá vòng đấu");
      } catch (err) {
        toast.error(err?.data?.message || "Xoá thất bại");
      }
    },
    [deleteBracket, tourId],
  );

  const handleClearMatches = useCallback(
    async (b) => {
      if (!window.confirm(`Xoá TOÀN BỘ trận trong "${b.name}"? (giữ khung)`))
        return;
      try {
        await clearMatches({ bracketId: b._id }).unwrap();
        toast.success("Đã xoá trận");
      } catch (err) {
        toast.error(err?.data?.message || "Xoá trận thất bại");
      }
    },
    [clearMatches],
  );

  const handleRebuildKO = useCallback(
    async (b) => {
      if (!window.confirm(`Rebuild bracket knockout "${b.name}"?`)) return;
      try {
        await rebuildKO({
          tournamentId: tourId,
          bracketId: b._id,
        }).unwrap();
        toast.success("Đã rebuild");
      } catch (err) {
        toast.error(err?.data?.message || "Rebuild thất bại");
      }
    },
    [rebuildKO, tourId],
  );

  return (
    <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={1.5}
        flexWrap="wrap"
        useFlexGap
        gap={1}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Vòng đấu / Sơ đồ
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Tạo & cấu hình vòng bảng, nhánh loại trực tiếp, PO... cho giải.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title="Reload">
            <IconButton
              size="small"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? <CircularProgress size={18} /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Để AI đề xuất blueprint tất cả vòng (bảng → PO → KO) trong 1 lần">
            <Button
              variant="outlined"
              size="small"
              color="secondary"
              startIcon={<AIIcon />}
              onClick={() => setBlueprintOpen(true)}
            >
              Blueprint AI
            </Button>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={openCreate}
          >
            Tạo vòng đấu
          </Button>
        </Stack>
      </Stack>

      {isLoading ? (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      ) : brackets.length === 0 ? (
        <Alert severity="info" variant="outlined">
          Chưa có vòng đấu nào. Bấm <b>Tạo vòng đấu</b> để bắt đầu.
        </Alert>
      ) : (
        <Grid container spacing={1.5}>
          {brackets
            .slice()
            .sort(
              (a, b) =>
                (a.stage || 1) - (b.stage || 1) ||
                (a.order || 0) - (b.order || 0),
            )
            .map((b) => (
              <Grid key={b._id} size={{ xs: 12, md: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderLeft: `4px solid ${theme.palette.primary.main}`,
                  }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="flex-start"
                    mb={1}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                        {typeIcon(b.type)}
                        <Typography variant="subtitle2" fontWeight={800}>
                          {b.name || typeLabel(b.type)}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          label={typeLabel(b.type)}
                          color="primary"
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          label={`Stage ${b.stage || 1} / order ${b.order || 0}`}
                          variant="outlined"
                        />
                        {b.type === "group" || b.type === "round_robin" ? (
                          <Chip
                            size="small"
                            label={`${b.groups?.length || 0} bảng`}
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            size="small"
                            label={`${b.drawRounds || 0} vòng · ${b.drawSize || "?"} slot`}
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Xem bracket public">
                        <IconButton
                          size="small"
                          component={RouterLink}
                          to={`/tournament/${tourId}/bracket`}
                          target="_blank"
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Sửa">
                        <IconButton size="small" onClick={() => openEdit(b)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Xoá vòng">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(b)}
                          disabled={deleting}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {(b.type === "group" || b.type === "round_robin") && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<GroupWorkIcon />}
                        onClick={() => openPool(b)}
                      >
                        Chia bảng thủ công
                      </Button>
                    )}
                    {(b.type === "group" || b.type === "round_robin") && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="secondary"
                        onClick={() => {
                          setPairsMgrBracket(b);
                          setPairsMgrOpen(true);
                        }}
                      >
                        Thêm / Chuyển cặp
                      </Button>
                    )}
                    {(b.type === "knockout" || b.type === "double_elim") && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleRebuildKO(b)}
                        disabled={rebuilding}
                      >
                        Rebuild bracket
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="text"
                      color="warning"
                      onClick={() => handleClearMatches(b)}
                      disabled={clearing}
                    >
                      Xoá toàn bộ trận
                    </Button>
                  </Stack>
                </Paper>
              </Grid>
            ))}
        </Grid>
      )}

      <BracketEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        tourId={tourId}
        bracket={editing}
        onSaved={refetch}
      />
      <ManualPoolAssignDialog
        open={poolOpen}
        onClose={() => {
          setPoolOpen(false);
          refetch();
        }}
        tourId={tourId}
        bracket={poolBracket}
      />
      <BlueprintDialog
        open={blueprintOpen}
        onClose={() => {
          setBlueprintOpen(false);
          refetch();
        }}
        tourId={tourId}
      />
      <GroupPairsManagerDialog
        open={pairsMgrOpen}
        onClose={() => {
          setPairsMgrOpen(false);
          refetch();
        }}
        tourId={tourId}
        bracket={pairsMgrBracket}
      />
    </Paper>
  );
}
