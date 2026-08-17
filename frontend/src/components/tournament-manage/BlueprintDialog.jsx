/* eslint-disable react/prop-types */
// BlueprintDialog.jsx — MVP AI Blueprint planner cho manager trang manage.
//
// Flow user (3 bước):
//   1. Cấu hình: số cặp + toggle các stage muốn có
//   2. Đề xuất: bấm "🪄 AI đề xuất" hoặc "⚙ Auto (không cần AI)" → xem plan JSON
//   3. Xem tác động + áp dụng: preview impact → apply safe hoặc replace_all
//
// KHÔNG đụng logic BE — chỉ dùng endpoints đã mở quyền manager:
//   POST /api/admin/tournaments/:id/plan/suggest    — AI (OpenAI)
//   POST /api/admin/tournaments/:id/plan/auto       — Deterministic
//   POST /api/admin/tournaments/:id/plan/impact     — Preview impact
//   POST /api/admin/tournaments/:id/plan/commit     — Apply plan
//   PUT  /api/admin/tournaments/:id/plan            — Save draft
//   GET  /api/admin/tournaments/:id/plan            — Get cached plan

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  AutoAwesome as AIIcon,
  Build as BuildIcon,
  ContentCopy as CopyIcon,
  ChevronLeft as BackIcon,
  ChevronRight as NextIcon,
  Refresh as RefreshIcon,
  CheckCircle as OkIcon,
  Warning as WarnIcon,
  Lock as LockIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetTournamentPlanQuery,
  useUpdateTournamentPlanMutation,
  useSuggestTournamentPlanMutation,
  usePreviewBlueprintImpactMutation,
  useCommitTournamentPlanMutation,
  useAutoPlanTournamentMutation,
  useGetRegistrationsQuery,
} from "../../slices/tournamentsApiSlice";

const STAGE_META = {
  groups: { label: "Vòng bảng", color: "#0d6efd", icon: "🏓" },
  po: { label: "Playoff (PO)", color: "#f59e0b", icon: "🥊" },
  ko: { label: "Knockout", color: "#dc3545", icon: "🏆" },
};

const IMPACT_TYPE_META = {
  unchanged: { color: "default", label: "Không đổi", icon: <OkIcon fontSize="small" /> },
  create: { color: "success", label: "Tạo mới", icon: <OkIcon fontSize="small" /> },
  rebuild: { color: "warning", label: "Rebuild", icon: <WarnIcon fontSize="small" /> },
  update_rules: {
    color: "info",
    label: "Cập nhật rules",
    icon: <BuildIcon fontSize="small" />,
  },
  delete: { color: "error", label: "Xoá", icon: <WarnIcon fontSize="small" /> },
  locked_conflict: {
    color: "error",
    label: "Đã khoá",
    icon: <LockIcon fontSize="small" />,
  },
};

function StageSummary({ stageKey, stage }) {
  const meta = STAGE_META[stageKey];
  if (!stage) return null;
  const short = [];
  if (stageKey === "groups") {
    short.push(`${stage.count || "?"} bảng`);
    short.push(`${stage.size || stage.groupSizes?.[0] || "?"} đội/bảng`);
    short.push(`top ${stage.qualifiersPerGroup || "?"}`);
  } else if (stageKey === "po") {
    short.push(`${stage.drawSize || "?"} đội đầu vào`);
    short.push(`${stage.maxRounds || "?"} vòng`);
  } else if (stageKey === "ko") {
    short.push(`${stage.drawSize || "?"} slot`);
    if (stage.format) short.push(stage.format);
    if (stage.thirdPlaceEnabled) short.push("+ hạng 3-4");
  }
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderLeft: `4px solid ${meta.color}`,
        bgcolor: alpha(meta.color, 0.05),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <Typography variant="subtitle2" fontWeight={800}>
          {meta.label}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {short.map((s, i) => (
          <Chip key={i} size="small" label={s} variant="outlined" />
        ))}
      </Stack>
    </Paper>
  );
}

function ImpactStageRow({ s }) {
  const meta = IMPACT_TYPE_META[s.type] || IMPACT_TYPE_META.unchanged;
  const stageMeta = STAGE_META[s.key] || { label: s.key, color: "#666" };
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        borderLeft: `4px solid ${stageMeta.color}`,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography fontWeight={700} sx={{ minWidth: 110 }}>
          {stageMeta.icon} {stageMeta.label}
        </Typography>
        <Chip
          size="small"
          color={meta.color}
          icon={meta.icon}
          label={meta.label}
          variant="filled"
        />
        {s.locked && (
          <Chip
            size="small"
            color="error"
            variant="outlined"
            icon={<LockIcon fontSize="small" />}
            label="Đã có dữ liệu — không thay được"
          />
        )}
        {s.reason && (
          <Typography variant="caption" color="text.secondary">
            {s.reason}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

export default function BlueprintDialog({ open, onClose, tourId }) {
  const theme = useTheme();
  const { data: regs = [] } = useGetRegistrationsQuery(tourId, {
    skip: !open || !tourId,
  });
  const approvedCount = useMemo(
    () =>
      (regs || []).filter((r) => !r.status || r.status === "approved").length,
    [regs],
  );

  const { data: planCached, refetch: refetchPlan } = useGetTournamentPlanQuery(
    tourId,
    { skip: !open || !tourId },
  );
  const cachedPlan = planCached?.plan || null;

  const [step, setStep] = useState(0);
  const [paidCount, setPaidCount] = useState(0);
  const [modeHint, setModeHint] = useState("auto"); // auto | group | po | ko
  const [plan, setPlan] = useState(null);
  const [impact, setImpact] = useState(null);

  useEffect(() => {
    if (!open) return;
    setPaidCount(approvedCount || 16);
    setModeHint("auto");
    setPlan(cachedPlan || null);
    setImpact(null);
    setStep(cachedPlan ? 1 : 0);
  }, [open, approvedCount, cachedPlan]);

  const [suggestPlan, { isLoading: suggesting }] =
    useSuggestTournamentPlanMutation();
  const [autoPlan, { isLoading: autoplanning }] = useAutoPlanTournamentMutation();
  const [previewImpact, { isLoading: previewing }] =
    usePreviewBlueprintImpactMutation();
  const [commitPlan, { isLoading: committing }] =
    useCommitTournamentPlanMutation();
  const [updatePlan, { isLoading: saving }] = useUpdateTournamentPlanMutation();

  const handleAiSuggest = async () => {
    try {
      const body = { paidCount: Number(paidCount) || 16 };
      if (modeHint !== "auto") body.modeHint = modeHint;
      const res = await suggestPlan({ tourId, body }).unwrap();
      const p = res?.plan ?? res;
      setPlan(p);
      setStep(1);
      toast.success("AI đã đề xuất blueprint");
    } catch (err) {
      toast.error(
        err?.data?.message || err?.data?.error || "AI gợi ý thất bại",
      );
    }
  };

  const handleAutoPlan = async () => {
    try {
      const body = {
        expectedTeams: Number(paidCount) || 16,
        allowGroup: modeHint === "auto" || modeHint === "group",
        allowPO: modeHint === "auto" || modeHint === "po",
        allowKO: modeHint === "auto" || modeHint === "ko",
      };
      const res = await autoPlan({ tourId, body }).unwrap();
      const p = res?.plan ?? res;
      setPlan(p);
      setStep(1);
      toast.success("Đã tạo blueprint tự động (không dùng AI)");
    } catch (err) {
      toast.error(err?.data?.message || "Auto plan thất bại");
    }
  };

  const buildBody = () => {
    if (!plan) return null;
    return {
      groups: plan.groups || null,
      po: plan.po || null,
      ko: plan.ko || null,
    };
  };

  const handlePreview = async () => {
    if (!plan) return;
    try {
      const res = await previewImpact({
        tourId,
        body: buildBody(),
      }).unwrap();
      setImpact(res);
      setStep(2);
    } catch (err) {
      toast.error(err?.data?.message || "Không lấy được impact");
    }
  };

  const handleSaveDraft = async () => {
    if (!plan) return;
    try {
      await updatePlan({ tourId, body: buildBody() }).unwrap();
      toast.success("Đã lưu bản nháp");
      refetchPlan();
    } catch (err) {
      toast.error(err?.data?.message || "Lưu nháp thất bại");
    }
  };

  const handleCommit = async (mode) => {
    if (!plan) return;
    const confirm = window.confirm(
      mode === "replace_all"
        ? "THAY TOÀN BỘ blueprint sẽ XOÁ các vòng đã có (kể cả có match) rồi tạo lại. Chắc chắn?"
        : "Áp dụng blueprint cho các stage CHƯA khoá. Stage đã có match/live sẽ được bỏ qua.",
    );
    if (!confirm) return;
    try {
      const body = { ...buildBody(), mode };
      const res = await commitPlan({ tourId, body }).unwrap();
      if (res?.ok) {
        toast.success(
          `Đã áp dụng blueprint (${res.impactedStages?.length || 0} stage đổi)`,
        );
        onClose?.();
      }
    } catch (err) {
      const d = err?.data;
      if (d?.code === "BLUEPRINT_STAGE_LOCKED") {
        toast.error(
          `Không áp được — có ${d.conflictStages?.length || 0} stage đang bị khoá. Xem chi tiết ở tab Impact.`,
        );
        setImpact(d);
      } else {
        toast.error(d?.message || "Commit thất bại");
      }
    }
  };

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      toast.success("Đã copy JSON plan");
    } catch {
      /* ignore */
    }
  };

  const busy =
    suggesting || autoplanning || previewing || committing || saving;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { minHeight: "70vh" } }}
    >
      <DialogTitle sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 1 }}>
        <AIIcon color="primary" /> Blueprint AI — Thiết kế toàn bộ giải một lần
      </DialogTitle>
      {busy && <LinearProgress />}
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 2 }}>
          <Step>
            <StepLabel>Cấu hình</StepLabel>
          </Step>
          <Step>
            <StepLabel>Xem plan</StepLabel>
          </Step>
          <Step>
            <StepLabel>Áp dụng</StepLabel>
          </Step>
        </Stepper>

        {/* ═══ Step 0: Config ═══ */}
        {step === 0 && (
          <Stack spacing={2}>
            <Alert severity="info" variant="outlined">
              Blueprint AI sẽ tự tính số bảng / số vòng / seeding và tạo cả
              chuỗi vòng bảng → PO → KO trong 1 lần. Bạn có thể sửa từng vòng
              sau qua tab <b>Vòng đấu</b>.
            </Alert>
            <TextField
              label="Số cặp đã đăng ký"
              type="number"
              value={paidCount}
              onChange={(e) => setPaidCount(e.target.value)}
              helperText={`Hệ thống thấy hiện có ${approvedCount} cặp đã duyệt.`}
              inputProps={{ min: 2 }}
              fullWidth
              size="small"
            />
            <Box>
              <Typography variant="subtitle2" mb={1}>
                Gợi ý cho AI (tuỳ chọn — để "Tự động" nếu chưa quyết)
              </Typography>
              <Grid container spacing={1}>
                {[
                  { v: "auto", label: "Tự động", hint: "AI tự chọn" },
                  { v: "group", label: "Có vòng bảng", hint: "Bắt buộc có" },
                  { v: "po", label: "Có PO", hint: "Vòng loại rút gọn" },
                  { v: "ko", label: "Chỉ knockout", hint: "Loại trực tiếp" },
                ].map((m) => (
                  <Grid key={m.v} size={{ xs: 6, sm: 3 }}>
                    <Paper
                      variant="outlined"
                      onClick={() => setModeHint(m.v)}
                      sx={{
                        p: 1.5,
                        cursor: "pointer",
                        borderColor:
                          modeHint === m.v ? "primary.main" : "divider",
                        borderWidth: modeHint === m.v ? 2 : 1,
                        bgcolor:
                          modeHint === m.v
                            ? alpha(theme.palette.primary.main, 0.08)
                            : "transparent",
                        textAlign: "center",
                      }}
                    >
                      <Typography fontWeight={700}>{m.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {m.hint}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Box>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                variant="contained"
                startIcon={<AIIcon />}
                onClick={handleAiSuggest}
                disabled={busy || !paidCount}
                fullWidth
              >
                {suggesting ? "Đang hỏi AI…" : "🪄 AI đề xuất"}
              </Button>
              <Button
                variant="outlined"
                startIcon={<BuildIcon />}
                onClick={handleAutoPlan}
                disabled={busy || !paidCount}
                fullWidth
              >
                {autoplanning ? "Đang tính…" : "⚙ Auto (không dùng AI)"}
              </Button>
            </Stack>

            {cachedPlan && (
              <Alert severity="success" variant="outlined">
                <AlertTitle>Có bản nháp đã lưu</AlertTitle>
                Nhấn <b>Xem plan</b> để tiếp tục với plan cũ, hoặc tạo mới ở trên.
                <Box mt={1}>
                  <Button size="small" onClick={() => setStep(1)}>
                    Xem plan đã lưu →
                  </Button>
                </Box>
              </Alert>
            )}
          </Stack>
        )}

        {/* ═══ Step 1: Plan preview ═══ */}
        {step === 1 && (
          <Stack spacing={2}>
            {!plan ? (
              <Alert severity="warning">
                Chưa có plan. Quay lại bước 1 để tạo.
              </Alert>
            ) : (
              <>
                <Alert severity="info">
                  Blueprint đề xuất — có thể lưu nháp hoặc xem tác động trước
                  khi áp dụng.
                </Alert>
                <Stack spacing={1}>
                  {["groups", "po", "ko"].map((k) => (
                    <StageSummary key={k} stageKey={k} stage={plan[k]} />
                  ))}
                </Stack>

                <Divider textAlign="left">
                  <Typography variant="caption" color="text.secondary">
                    JSON plan
                  </Typography>
                </Divider>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    maxHeight: 260,
                    overflow: "auto",
                    bgcolor: alpha(theme.palette.text.primary, 0.03),
                    position: "relative",
                  }}
                >
                  <Tooltip title="Copy JSON">
                    <IconButton
                      size="small"
                      onClick={copyPlan}
                      sx={{ position: "absolute", top: 4, right: 4 }}
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Box
                    component="pre"
                    sx={{
                      fontSize: 11.5,
                      fontFamily: "SF Mono, Consolas, monospace",
                      m: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(plan, null, 2)}
                  </Box>
                </Paper>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="outlined"
                    onClick={handleSaveDraft}
                    disabled={busy}
                    startIcon={saving ? <CircularProgress size={16} /> : null}
                  >
                    Lưu bản nháp
                  </Button>
                  <Button
                    variant="contained"
                    onClick={handlePreview}
                    disabled={busy}
                    startIcon={<NextIcon />}
                  >
                    Xem tác động →
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        )}

        {/* ═══ Step 2: Impact + apply ═══ */}
        {step === 2 && (
          <Stack spacing={2}>
            {!impact ? (
              <Alert severity="warning">
                Chưa có phân tích tác động. Bấm <b>← Quay lại</b> để tạo.
              </Alert>
            ) : (
              <>
                {impact.hasConflicts && (
                  <Alert severity="error" variant="outlined">
                    <AlertTitle>Có xung đột</AlertTitle>
                    {impact.conflictStages?.length || 0} stage đang bị khoá
                    (đã có trận live/finished). Chỉ có thể dùng
                    <b> Thay toàn bộ</b> — sẽ xoá matches cũ.
                  </Alert>
                )}
                {!impact.changed && (
                  <Alert severity="success">
                    Blueprint hiện tại KHÔNG có gì thay đổi so với đã lưu.
                  </Alert>
                )}
                <Stack spacing={1}>
                  {(impact.stages || []).map((s) => (
                    <ImpactStageRow key={s.key} s={s} />
                  ))}
                </Stack>
                <Divider />
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="outlined"
                    startIcon={<BackIcon />}
                    onClick={() => setStep(1)}
                    disabled={busy}
                  >
                    Quay lại
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => handleCommit("safe_apply")}
                    disabled={busy || !impact.changed}
                  >
                    Áp dụng an toàn (bỏ qua stage đã khoá)
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => handleCommit("replace_all")}
                    disabled={busy}
                  >
                    ⚠ Thay toàn bộ (xoá dữ liệu cũ)
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step > 0 && !busy && (
          <Button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            startIcon={<BackIcon />}
          >
            Bước trước
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Reload plan cached">
          <IconButton onClick={() => refetchPlan()} size="small">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
