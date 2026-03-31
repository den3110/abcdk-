/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TimelineIcon from "@mui/icons-material/Timeline";
import BoltIcon from "@mui/icons-material/Bolt";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SEOHead from "../../components/SEOHead";
import {
  useGetChatTelemetrySummaryQuery,
  useGetChatTelemetryTurnsQuery,
  useGetChatRolloutConfigQuery,
  useUpdateChatRolloutConfigMutation,
} from "../../slices/chatBotApiSlice";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";

function formatMs(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function toCountItems(record = {}, limit = 8) {
  return Object.entries(record || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count: Number(count || 0) }));
}

function csvToList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function MetricCard({ icon, label, value, hint }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 3,
        minHeight: 148,
      }}
    >
      <Stack spacing={1.2}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography variant="body2" color="text.secondary" fontWeight={700}>
            {label}
          </Typography>
        </Stack>
        <Typography variant="h4" fontWeight={800}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      </Stack>
    </Paper>
  );
}

function TagSection({ title, items = [], color = "default", emptyText }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: "100%" }}>
      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25 }}>
        {title}
      </Typography>
      {items.length ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
          {items.map((item) => (
            <Chip
              key={`${title}-${item.label}`}
              color={color}
              variant="outlined"
              label={`${item.label} Â· ${item.count}`}
              sx={{ fontWeight: 700 }}
            />
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      )}
    </Paper>
  );
}

function TurnCard({ turn }) {
  const clientEvents = Array.isArray(turn?.meta?.clientEvents)
    ? turn.meta.clientEvents
    : [];

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack spacing={1.2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={turn.intent || "unknown"} color="primary" />
            <Chip size="small" label={turn.routeKind || "route"} variant="outlined" />
            <Chip
              size="small"
              label={turn.outcome || "success"}
              color={
                turn.outcome === "error"
                  ? "error"
                  : turn.outcome === "aborted"
                    ? "warning"
                    : "success"
              }
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {formatDateTime(turn.createdAt)}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {turn.surface ? <Chip size="small" label={turn.surface} /> : null}
          {turn.pageType ? <Chip size="small" label={turn.pageType} /> : null}
          {turn.pageSection ? <Chip size="small" label={turn.pageSection} /> : null}
          {turn.pageView ? <Chip size="small" label={turn.pageView} /> : null}
          {turn.routeLane ? (
            <Chip size="small" label={turn.routeLane} variant="outlined" />
          ) : null}
          {turn.groundingStatus ? (
            <Chip size="small" label={turn.groundingStatus} color="success" variant="outlined" />
          ) : null}
          {turn.operatorStatus ? (
            <Chip size="small" label={turn.operatorStatus} color="info" variant="outlined" />
          ) : null}
          {turn.retrievalMode ? (
            <Chip size="small" label={turn.retrievalMode} color="secondary" variant="outlined" />
          ) : null}
          {turn.guardApplied ? (
            <Chip size="small" label="guard applied" color="warning" />
          ) : null}
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Model: <strong>{turn.model || "-"}</strong> Â· First token:{" "}
          <strong>{formatMs(turn.firstTokenLatencyMs)}</strong> Â· Total:{" "}
          <strong>{formatMs(turn.processingTimeMs)}</strong>
        </Typography>

        {(turn.toolsUsed || []).length ? (
          <Typography variant="body2" color="text.secondary">
            Tools: {(turn.toolsUsed || []).join(", ")}
          </Typography>
        ) : null}

        {(turn.actionTypes || []).length ? (
          <Typography variant="body2" color="text.secondary">
            Actions: {(turn.actionTypes || []).join(", ")}
          </Typography>
        ) : null}

        {turn.feedback?.value ? (
          <Alert
            severity={turn.feedback.value === "negative" ? "warning" : "success"}
            sx={{ borderRadius: 2 }}
          >
            Feedback: {turn.feedback.value}
            {turn.feedback.reason ? ` Â· ${turn.feedback.reason}` : ""}
          </Alert>
        ) : null}

        {clientEvents.length ? (
          <Box>
            <Divider sx={{ mb: 1.2 }} />
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              Client events
            </Typography>
            <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mt: 0.8 }}>
              {clientEvents.slice(0, 6).map((event, index) => (
                <Chip
                  key={`${turn._id}-event-${index}`}
                  size="small"
                  variant="outlined"
                  label={`${event.type}${event.label ? ` Â· ${event.label}` : ""}`}
                />
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

function SurfaceMetricsSection({ title, data = {} }) {
  const entries = Object.entries(data || {});

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: "100%" }}>
      <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.25 }}>
        {title}
      </Typography>
      {entries.length ? (
        <Stack spacing={1}>
          {entries.map(([surface, values]) => (
            <Paper
              key={`${title}-${surface}`}
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2 }}
            >
              <Typography variant="body2" fontWeight={800} sx={{ mb: 0.5 }}>
                {surface}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                First token P95: {formatMs(values?.firstTokenP95)}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Total P95: {formatMs(values?.processingP95)}
              </Typography>
              {"executed" in (values || {}) ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  Executed: {values?.executed || 0} Â· Degraded: {values?.degraded || 0} Â· Unsupported: {values?.unsupported || 0}
                </Typography>
              ) : null}
            </Paper>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          ChÆ°a cÃ³ dá»¯ liá»‡u theo surface.
        </Typography>
      )}
    </Paper>
  );
}

export default function ChatBotOpsPage() {
  const { t } = useLanguage();
  const tx = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const [days, setDays] = useState(7);
  const [outcome, setOutcome] = useState("");
  const [intent, setIntent] = useState("");
  const [routeKind, setRouteKind] = useState("");
  const [page, setPage] = useState(1);
  const [rolloutDraft, setRolloutDraft] = useState({
    enabled: true,
    allowLiveRetrieval: false,
    cohortPercentage: 100,
    surfaces: ["web", "mobile"],
    allowlistRoles: ["admin"],
    allowlistUserIds: [],
  });

  const summaryQuery = useGetChatTelemetrySummaryQuery({ days });
  const turnsQuery = useGetChatTelemetryTurnsQuery({
    days,
    page,
    limit: 20,
    outcome,
    intent,
    routeKind,
  });
  const rolloutQuery = useGetChatRolloutConfigQuery();
  const [updateChatRolloutConfig, rolloutMutation] =
    useUpdateChatRolloutConfigMutation();

  const summary = useMemo(() => summaryQuery.data || {}, [summaryQuery.data]);
  const turns = Array.isArray(turnsQuery.data?.turns) ? turnsQuery.data.turns : [];
  useEffect(() => {
    if (!rolloutQuery.data) return;
    setRolloutDraft({
      enabled: rolloutQuery.data.enabled !== false,
      allowLiveRetrieval: Boolean(rolloutQuery.data.allowLiveRetrieval),
      cohortPercentage: Number(rolloutQuery.data.cohortPercentage || 100),
      surfaces: Array.isArray(rolloutQuery.data.surfaces)
        ? rolloutQuery.data.surfaces
        : ["web", "mobile"],
      allowlistRoles: Array.isArray(rolloutQuery.data.allowlistRoles)
        ? rolloutQuery.data.allowlistRoles
        : ["admin"],
      allowlistUserIds: Array.isArray(rolloutQuery.data.allowlistUserIds)
        ? rolloutQuery.data.allowlistUserIds
        : [],
    });
  }, [rolloutQuery.data]);
  const totalPages = Math.max(
    1,
    Math.ceil(Number(turnsQuery.data?.total || 0) / Number(turnsQuery.data?.limit || 20)),
  );
  const rolloutDirty = useMemo(() => {
    if (!rolloutQuery.data) return false;
    return JSON.stringify({
      enabled: rolloutDraft.enabled,
      allowLiveRetrieval: rolloutDraft.allowLiveRetrieval,
      cohortPercentage: Number(rolloutDraft.cohortPercentage || 0),
      surfaces: rolloutDraft.surfaces,
      allowlistRoles: rolloutDraft.allowlistRoles,
      allowlistUserIds: rolloutDraft.allowlistUserIds,
    }) !== JSON.stringify({
      enabled: rolloutQuery.data.enabled !== false,
      allowLiveRetrieval: Boolean(rolloutQuery.data.allowLiveRetrieval),
      cohortPercentage: Number(rolloutQuery.data.cohortPercentage || 0),
      surfaces: Array.isArray(rolloutQuery.data.surfaces)
        ? rolloutQuery.data.surfaces
        : ["web", "mobile"],
      allowlistRoles: Array.isArray(rolloutQuery.data.allowlistRoles)
        ? rolloutQuery.data.allowlistRoles
        : [],
      allowlistUserIds: Array.isArray(rolloutQuery.data.allowlistUserIds)
        ? rolloutQuery.data.allowlistUserIds
        : [],
    });
  }, [rolloutDraft, rolloutQuery.data]);

  const pageSnapshot = useMemo(
    () => ({
      pageType: "admin_chatbot_ops",
      entityTitle: "Pikora Bot Ops",
      sectionTitle: outcome || "Tá»•ng quan",
      pageSummary: "Theo dÃµi quality, latency, failures, actions vÃ  feedback cá»§a Pikora.",
      activeLabels: [
        `NgÃ y: ${days}`,
        outcome ? `Outcome: ${outcome}` : "All outcomes",
        intent ? `Intent: ${intent}` : "",
        routeKind ? `Route: ${routeKind}` : "",
      ],
      visibleActions: ["LÃ m má»›i telemetry", "Lá»c theo outcome", "Lá»c theo route"],
      highlights: (summary.topFailures || []).slice(0, 3).map((item) => item.label),
      metrics: [
        `Turns: ${summary.totalTurns || 0}`,
        `P95 first token: ${formatMs(summary.latency?.firstTokenP95)}`,
        `P95 total: ${formatMs(summary.latency?.processingP95)}`,
      ],
    }),
    [days, intent, outcome, routeKind, summary],
  );

  const actionHandlers = useMemo(
    () => ({
      days: (value) => {
        setDays(Number(value) || 7);
        setPage(1);
      },
      outcome: (value) => {
        setOutcome(String(value || ""));
        setPage(1);
      },
      intent: (value) => {
        setIntent(String(value || ""));
        setPage(1);
      },
      routeKind: (value) => {
        setRouteKind(String(value || ""));
        setPage(1);
      },
    }),
    [],
  );

  useRegisterChatBotPageContext({
    snapshot: pageSnapshot,
    capabilityKeys: ["set_page_state", "prefill_text", "focus_element", "navigate"],
    actionHandlers,
  });

  return (
    <Box>
      <SEOHead title="Pikora Bot Ops" noIndex={true} />

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        mb={2}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Pikora Bot Ops
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Theo dÃµi latency, failures, top intents, feedback vÃ  hÃ nh vi action cá»§a Pikora.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => {
            summaryQuery.refetch();
            turnsQuery.refetch();
          }}
        >
          {tx("common.actions.refresh", "LÃ m má»›i")}
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            select
            size="small"
            label="Khoáº£ng ngÃ y"
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value) || 7);
              setPage(1);
            }}
            sx={{ minWidth: 120 }}
          >
            {[1, 3, 7, 14, 30].map((value) => (
              <MenuItem key={value} value={value}>
                {value} ngÃ y
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Outcome"
            value={outcome}
            onChange={(event) => {
              setOutcome(String(event.target.value || ""));
              setPage(1);
            }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">Táº¥t cáº£</MenuItem>
            <MenuItem value="success">success</MenuItem>
            <MenuItem value="empty">empty</MenuItem>
            <MenuItem value="aborted">aborted</MenuItem>
            <MenuItem value="error">error</MenuItem>
          </TextField>

          <TextField
            size="small"
            label="Intent"
            value={intent}
            onChange={(event) => {
              setIntent(event.target.value);
              setPage(1);
            }}
            placeholder="tournament_lookup"
            sx={{ minWidth: 180 }}
          />

          <TextField
            size="small"
            label="Route"
            value={routeKind}
            onChange={(event) => {
              setRouteKind(event.target.value);
              setPage(1);
            }}
            placeholder="tournament"
            sx={{ minWidth: 180 }}
          />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", md: "center" }}
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Pikora V7 rollout
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dark launch cho hybrid retrieval vÃ  surface gating.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => rolloutQuery.refetch()}
              disabled={rolloutQuery.isFetching}
            >
              Reload rollout
            </Button>
            <Button
              variant="contained"
              disabled={!rolloutDirty || rolloutMutation.isLoading}
              onClick={async () => {
                await updateChatRolloutConfig({
                  enabled: rolloutDraft.enabled,
                  allowLiveRetrieval: rolloutDraft.allowLiveRetrieval,
                  cohortPercentage: Number(rolloutDraft.cohortPercentage || 0),
                  surfaces: rolloutDraft.surfaces,
                  allowlistRoles: rolloutDraft.allowlistRoles,
                  allowlistUserIds: rolloutDraft.allowlistUserIds,
                }).unwrap();
              }}
            >
              Save rollout
            </Button>
          </Stack>
        </Stack>

        {rolloutQuery.error ? (
          <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }}>
            Không tải được rollout config.
          </Alert>
        ) : null}

        {rolloutMutation.isError ? (
          <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }}>
            Không lưu được rollout config.
          </Alert>
        ) : null}

        {rolloutMutation.isSuccess ? (
          <Alert severity="success" sx={{ borderRadius: 2, mb: 2 }}>
            Đã cập nhật rollout config.
          </Alert>
        ) : null}

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          flexWrap="wrap"
          useFlexGap
        >
          <FormControlLabel
            control={
              <Switch
                checked={rolloutDraft.enabled}
                onChange={(event) =>
                  setRolloutDraft((prev) => ({
                    ...prev,
                    enabled: event.target.checked,
                  }))
                }
              />
            }
            label="Enabled"
          />
          <FormControlLabel
            control={
              <Switch
                checked={rolloutDraft.allowLiveRetrieval}
                onChange={(event) =>
                  setRolloutDraft((prev) => ({
                    ...prev,
                    allowLiveRetrieval: event.target.checked,
                  }))
                }
              />
            }
            label="Allow live retrieval"
          />
          <FormControlLabel
            control={
              <Switch
                checked={rolloutDraft.surfaces.includes("web")}
                onChange={(event) =>
                  setRolloutDraft((prev) => ({
                    ...prev,
                    surfaces: event.target.checked
                      ? Array.from(new Set([...prev.surfaces, "web"]))
                      : prev.surfaces.filter((item) => item !== "web"),
                  }))
                }
              />
            }
            label="Web"
          />
          <FormControlLabel
            control={
              <Switch
                checked={rolloutDraft.surfaces.includes("mobile")}
                onChange={(event) =>
                  setRolloutDraft((prev) => ({
                    ...prev,
                    surfaces: event.target.checked
                      ? Array.from(new Set([...prev.surfaces, "mobile"]))
                      : prev.surfaces.filter((item) => item !== "mobile"),
                  }))
                }
              />
            }
            label="Mobile"
          />
          <TextField
            size="small"
            type="number"
            label="Cohort %"
            value={rolloutDraft.cohortPercentage}
            onChange={(event) =>
              setRolloutDraft((prev) => ({
                ...prev,
                cohortPercentage: Math.max(
                  0,
                  Math.min(100, Number(event.target.value || 0)),
                ),
              }))
            }
            sx={{ width: 140 }}
          />
          <TextField
            size="small"
            label="Allowlist roles"
            value={rolloutDraft.allowlistRoles.join(", ")}
            onChange={(event) =>
              setRolloutDraft((prev) => ({
                ...prev,
                allowlistRoles: csvToList(event.target.value),
              }))
            }
            sx={{ minWidth: 220, flex: 1 }}
          />
          <TextField
            size="small"
            label="Allowlist user IDs"
            value={rolloutDraft.allowlistUserIds.join(", ")}
            onChange={(event) =>
              setRolloutDraft((prev) => ({
                ...prev,
                allowlistUserIds: csvToList(event.target.value),
              }))
            }
            sx={{ minWidth: 220, flex: 1 }}
          />
        </Stack>
      </Paper>

      {summaryQuery.isLoading ? (
        <Stack alignItems="center" py={8}>
          <CircularProgress />
        </Stack>
      ) : summaryQuery.error ? (
        <Alert severity="error" sx={{ borderRadius: 3, mb: 2 }}>
          KhÃ´ng táº£i Ä‘Æ°á»£c summary telemetry.
        </Alert>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "repeat(2, minmax(0, 1fr))",
              xl: "repeat(4, minmax(0, 1fr))",
            },
            gap: 2,
            mb: 2,
          }}
        >
          <MetricCard
            icon={<SmartToyIcon color="primary" />}
            label="Tá»•ng turns"
            value={summary.totalTurns || 0}
            hint={`Trung bÃ¬nh ${summary.throughput?.avgTurnsPerDay || 0} turn/ngÃ y`}
          />
          <MetricCard
            icon={<TimelineIcon color="info" />}
            label="First token P95"
            value={formatMs(summary.latency?.firstTokenP95)}
            hint={`P50: ${formatMs(summary.latency?.firstTokenP50)}`}
          />
          <MetricCard
            icon={<BoltIcon color="warning" />}
            label="Processing P95"
            value={formatMs(summary.latency?.processingP95)}
            hint={`P50: ${formatMs(summary.latency?.processingP50)}`}
          />
          <MetricCard
            icon={<WarningAmberIcon color="error" />}
            label="Feedback Ã¢m"
            value={summary.feedback?.negative || 0}
            hint={`Feedback dÆ°Æ¡ng: ${summary.feedback?.positive || 0}`}
          />
          <MetricCard
            icon={<WarningAmberIcon color="warning" />}
            label="Guard hits"
            value={summary.guardHits || 0}
            hint={`Fallback used: ${summary.fallbackUsed || 0}`}
          />
        </Box>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "repeat(2, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 2,
        }}
      >
        <TagSection
          title="Top intents"
          items={summary.topIntents}
          color="primary"
          emptyText="ChÆ°a cÃ³ intent nÃ o."
        />
        <TagSection
          title="Most-used tools"
          items={summary.topTools}
          color="info"
          emptyText="ChÆ°a cÃ³ tool usage."
        />
        <TagSection
          title="Top failures"
          items={summary.topFailures}
          color="error"
          emptyText="ChÆ°a cÃ³ lá»—i nÃ o."
        />
        <TagSection
          title="Unsupported actions"
          items={summary.topUnsupportedActions}
          color="warning"
          emptyText="ChÆ°a cÃ³ unsupported action."
        />
        <TagSection
          title="Unsupported intents"
          items={summary.topUnsupportedIntents}
          color="warning"
          emptyText="ChÆ°a cÃ³ unsupported intent."
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "repeat(2, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 2,
        }}
      >
        <TagSection
          title="Feedback reasons"
          items={summary.topFeedbackReasons}
          emptyText="ChÆ°a cÃ³ lÃ½ do feedback."
        />
        <TagSection
          title="Top route kinds"
          items={summary.topRouteKinds}
          emptyText="ChÆ°a cÃ³ route kind."
        />
        <TagSection
          title="Top route lanes"
          items={summary.topRouteLanes}
          emptyText="ChÆ°a cÃ³ route lane."
        />
        <TagSection
          title="Grounding status"
          items={toCountItems(summary.groundingStatuses)}
          emptyText="ChÆ°a cÃ³ grounding status."
        />
        <TagSection
          title="Operator status"
          items={toCountItems(summary.operatorStatuses)}
          emptyText="ChÆ°a cÃ³ operator status."
        />
        <TagSection
          title="Surface split"
          items={toCountItems(summary.surfaces)}
          emptyText="ChÆ°a cÃ³ surface data."
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "repeat(2, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 2,
        }}
      >
        <TagSection
          title="Retrieval modes"
          items={toCountItems(summary.retrievalModes)}
          emptyText="Chưa có retrieval mode."
        />
        <SurfaceMetricsSection
          title="Latency by surface"
          data={summary.latencyBySurface}
        />
        <SurfaceMetricsSection
          title="Action status by surface"
          data={summary.actionStatusBySurface}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          sx={{ mb: 1.5 }}
        >
          <Typography variant="h6" fontWeight={800}>
            Turns gáº§n nháº¥t
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Trang {page} / {totalPages}
          </Typography>
        </Stack>

        {turnsQuery.isFetching && !turns.length ? (
          <Stack alignItems="center" py={5}>
            <CircularProgress size={24} />
          </Stack>
        ) : turns.length ? (
          <Stack spacing={1.5}>
            {turns.map((turn) => (
              <TurnCard key={turn._id} turn={turn} />
            ))}
          </Stack>
        ) : (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            ChÆ°a cÃ³ telemetry turn nÃ o theo bá»™ lá»c hiá»‡n táº¡i.
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            variant="outlined"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Trang trÆ°á»›c
          </Button>
          <Button
            variant="contained"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Trang sau
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

