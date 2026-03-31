/* eslint-disable react/prop-types */
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
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
              label={`${item.label} · ${item.count}`}
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
          {turn.pageType ? <Chip size="small" label={turn.pageType} /> : null}
          {turn.pageSection ? <Chip size="small" label={turn.pageSection} /> : null}
          {turn.pageView ? <Chip size="small" label={turn.pageView} /> : null}
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Model: <strong>{turn.model || "-"}</strong> · First token:{" "}
          <strong>{formatMs(turn.firstTokenLatencyMs)}</strong> · Total:{" "}
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
            {turn.feedback.reason ? ` · ${turn.feedback.reason}` : ""}
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
                  label={`${event.type}${event.label ? ` · ${event.label}` : ""}`}
                />
              ))}
            </Stack>
          </Box>
        ) : null}
      </Stack>
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

  const summaryQuery = useGetChatTelemetrySummaryQuery({ days });
  const turnsQuery = useGetChatTelemetryTurnsQuery({
    days,
    page,
    limit: 20,
    outcome,
    intent,
    routeKind,
  });

  const summary = useMemo(() => summaryQuery.data || {}, [summaryQuery.data]);
  const turns = Array.isArray(turnsQuery.data?.turns) ? turnsQuery.data.turns : [];
  const totalPages = Math.max(
    1,
    Math.ceil(Number(turnsQuery.data?.total || 0) / Number(turnsQuery.data?.limit || 20)),
  );

  const pageSnapshot = useMemo(
    () => ({
      pageType: "admin_chatbot_ops",
      entityTitle: "Pikora Bot Ops",
      sectionTitle: outcome || "Tổng quan",
      pageSummary: "Theo dõi quality, latency, failures, actions và feedback của Pikora.",
      activeLabels: [
        `Ngày: ${days}`,
        outcome ? `Outcome: ${outcome}` : "All outcomes",
        intent ? `Intent: ${intent}` : "",
        routeKind ? `Route: ${routeKind}` : "",
      ],
      visibleActions: ["Làm mới telemetry", "Lọc theo outcome", "Lọc theo route"],
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
            Theo dõi latency, failures, top intents, feedback và hành vi action của Pikora.
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
          {tx("common.actions.refresh", "Làm mới")}
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <TextField
            select
            size="small"
            label="Khoảng ngày"
            value={days}
            onChange={(event) => {
              setDays(Number(event.target.value) || 7);
              setPage(1);
            }}
            sx={{ minWidth: 120 }}
          >
            {[1, 3, 7, 14, 30].map((value) => (
              <MenuItem key={value} value={value}>
                {value} ngày
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
            <MenuItem value="">Tất cả</MenuItem>
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

      {summaryQuery.isLoading ? (
        <Stack alignItems="center" py={8}>
          <CircularProgress />
        </Stack>
      ) : summaryQuery.error ? (
        <Alert severity="error" sx={{ borderRadius: 3, mb: 2 }}>
          Không tải được summary telemetry.
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
            label="Tổng turns"
            value={summary.totalTurns || 0}
            hint={`Trung bình ${summary.throughput?.avgTurnsPerDay || 0} turn/ngày`}
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
            label="Feedback âm"
            value={summary.feedback?.negative || 0}
            hint={`Feedback dương: ${summary.feedback?.positive || 0}`}
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
          emptyText="Chưa có intent nào."
        />
        <TagSection
          title="Most-used tools"
          items={summary.topTools}
          color="info"
          emptyText="Chưa có tool usage."
        />
        <TagSection
          title="Top failures"
          items={summary.topFailures}
          color="error"
          emptyText="Chưa có lỗi nào."
        />
        <TagSection
          title="Unsupported actions"
          items={summary.topUnsupportedActions}
          color="warning"
          emptyText="Chưa có unsupported action."
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
          emptyText="Chưa có lý do feedback."
        />
        <TagSection
          title="Top route kinds"
          items={summary.topRouteKinds}
          emptyText="Chưa có route kind."
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
            Turns gần nhất
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
            Chưa có telemetry turn nào theo bộ lọc hiện tại.
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            variant="outlined"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Trang trước
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
