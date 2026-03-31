import { useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import Grid from "@mui/material/Grid";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useRegisterChatBotPageSnapshot } from "../context/ChatBotPageContext.jsx";
import { useGetPublicStatusQuery } from "../slices/statusApiSlice.js";

const SERVICE_ORDER = [
  "public-api",
  "go-api",
  "relay-rtmp",
  "scheduler",
  "recording-export",
  "ai-commentary-worker",
  "general-worker",
  "recording-storage",
];

const SERVICE_NAME_KEYS = {
  "public-api": "publicApi",
  "go-api": "goApi",
  "relay-rtmp": "relayRtmp",
  scheduler: "scheduler",
  "recording-export": "recordingExport",
  "ai-commentary-worker": "aiCommentaryWorker",
  "general-worker": "generalWorker",
  "recording-storage": "recordingStorage",
};

const DEFAULT_CATEGORIES = {
  "public-api": "gateway",
  "go-api": "api",
  "relay-rtmp": "realtime",
  scheduler: "worker",
  "recording-export": "worker",
  "ai-commentary-worker": "worker",
  "general-worker": "worker",
  "recording-storage": "storage",
};

function getStatusColor(status) {
  if (status === "operational") return "success";
  if (status === "degraded") return "warning";
  if (status === "down") return "error";
  return "default";
}

const getSoftColor = (theme, colorType) => {
  if (colorType === "default" || colorType === "text.primary") {
    return alpha(theme.palette.action.active, 0.08);
  }
  return alpha(
    theme.palette[colorType]?.main || theme.palette.primary.main,
    0.12,
  );
};

function formatNumber(value, locale, fractionDigits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
}

function formatDateTime(value, locale) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatLatency(value, locale, t) {
  const formatted = formatNumber(value, locale, Number(value) >= 100 ? 0 : 1);
  return formatted ? `${formatted} ms` : t("common.unavailable");
}

function formatRatePerMinute(value, locale, t) {
  const formatted = formatNumber(value, locale, 2);
  return formatted ? `${formatted}/min` : t("common.unavailable");
}

function formatUptime(seconds, locale, t) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return t("common.unavailable");
  }
  const days = Math.floor(numeric / 86400);
  const hours = Math.floor((numeric % 86400) / 3600);
  const minutes = Math.floor((numeric % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${formatNumber(days, locale)}d`);
  if (hours) parts.push(`${formatNumber(hours, locale)}h`);
  if (minutes) parts.push(`${formatNumber(minutes, locale)}m`);
  if (!parts.length)
    parts.push(`${formatNumber(Math.round(numeric), locale)}s`);
  return parts.join(" ");
}

function getOverallBannerStyle(theme, overallStatus) {
  const statusColor = getStatusColor(overallStatus);
  if (statusColor === "error") {
    return {
      bgcolor: alpha(theme.palette.error.main, 0.06),
      borderColor: alpha(theme.palette.error.main, 0.2),
      dotColor: theme.palette.error.main,
    };
  }
  if (statusColor === "warning") {
    return {
      bgcolor: alpha(theme.palette.warning.main, 0.06),
      borderColor: alpha(theme.palette.warning.main, 0.2),
      dotColor: theme.palette.warning.main,
    };
  }
  if (statusColor === "success") {
    return {
      bgcolor: alpha(theme.palette.success.main, 0.06),
      borderColor: alpha(theme.palette.success.main, 0.2),
      dotColor: theme.palette.success.main,
    };
  }
  return {
    bgcolor: alpha(theme.palette.action.active, 0.04),
    borderColor: alpha(theme.palette.divider, 0.6),
    dotColor: theme.palette.grey[500],
  };
}

function SummaryCard({
  icon,
  title,
  value,
  hint,
  color = "text.primary",
  colorType = "default",
}) {
  const theme = useTheme();
  const cardShadowColor =
    theme.palette[colorType]?.main || theme.palette.common.black;

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 4,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        transition: "all 0.2s ease",
        boxShadow: `0 12px 32px ${alpha(cardShadowColor, colorType === "default" ? 0.08 : 0.1)}`,
        "&:hover": {
          boxShadow: `0 16px 40px ${alpha(cardShadowColor, colorType === "default" ? 0.12 : 0.16)}`,
          transform: "translateY(-2px)",
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography
          variant="caption"
          color="text.secondary"
          fontWeight={700}
          textTransform="uppercase"
          letterSpacing={1}
          sx={{ fontSize: "0.65rem" }}
        >
          {title}
        </Typography>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 2.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: getSoftColor(theme, colorType),
            color,
            "& .MuiSvgIcon-root": { fontSize: "1.15rem" },
          }}
        >
          {icon}
        </Box>
      </Stack>
      <Box>
        <Typography
          variant="h5"
          fontWeight={900}
          color={color}
          sx={{ letterSpacing: "-0.02em", lineHeight: 1.2 }}
        >
          {value}
        </Typography>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.7rem", mt: 0.5, display: "block" }}
        >
          {hint}
        </Typography>
      </Box>
    </Paper>
  );
}

SummaryCard.propTypes = {
  icon: PropTypes.node.isRequired,
  title: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  hint: PropTypes.string.isRequired,
  color: PropTypes.string,
  colorType: PropTypes.string,
};

function ServiceRow({ service, detail, locale, t }) {
  const theme = useTheme();
  const categoryKey =
    service.category || DEFAULT_CATEGORIES[service.key] || "worker";
  const statusColor = getStatusColor(service.status);
  const dotColor = theme.palette[statusColor]?.main || theme.palette.grey[500];
  const rowBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.035)
      : alpha(theme.palette.grey[50], 0.92);
  const rowHoverBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.055)
      : alpha(theme.palette.grey[100], 0.92);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: { xs: "flex-start", md: "center" },
        flexWrap: { xs: "wrap", md: "nowrap" },
        gap: 2,
        py: 1.75,
        px: 2,
        borderRadius: 2.5,
        transition: "background 0.15s ease",
        bgcolor: rowBg,
        "&:hover": {
          bgcolor: rowHoverBg,
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          flex: 1,
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: 10,
            height: 10,
            flexShrink: 0,
          }}
        >
          {service.status === "operational" && (
            <Box
              sx={{
                position: "absolute",
                inset: -3,
                borderRadius: "50%",
                bgcolor: alpha(dotColor, 0.25),
                animation: "statusPulse 2s ease-in-out infinite",
                "@keyframes statusPulse": {
                  "0%, 100%": { opacity: 0.4, transform: "scale(1)" },
                  "50%": { opacity: 0, transform: "scale(1.6)" },
                },
              }}
            />
          )}
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: dotColor,
              position: "relative",
            }}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {t(`statusPage.services.${SERVICE_NAME_KEYS[service.key]}`)}
          </Typography>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              fontSize: "0.65rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {t(`statusPage.categories.${categoryKey}`)}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: 0.5,
              display: "block",
              fontSize: "0.75rem",
              lineHeight: 1.55,
              whiteSpace: "normal",
            }}
          >
            {detail}
          </Typography>
          <Stack
            direction="row"
            spacing={1.5}
            useFlexGap
            sx={{
              mt: 1,
              flexWrap: "wrap",
              display: { xs: "flex", md: "none" },
            }}
          >
            <Typography variant="caption" color="text.disabled">
              {t("statusPage.labels.uptime")}:{" "}
              <Box component="span" sx={{ color: "text.primary", fontWeight: 700 }}>
                {formatUptime(service.uptimeSeconds, locale, t)}
              </Box>
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {t("statusPage.labels.latency")}:{" "}
              <Box component="span" sx={{ color: "text.primary", fontWeight: 700 }}>
                {formatLatency(service.latencyMs, locale, t)}
              </Box>
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {t("statusPage.labels.checkedAt")}:{" "}
              <Box component="span" sx={{ color: "text.primary", fontWeight: 700 }}>
                {formatDateTime(service.checkedAt, locale) ||
                  t("common.unavailable")}
              </Box>
            </Typography>
          </Stack>
        </Box>
      </Box>

      <Stack
        direction="row"
        spacing={3}
        alignItems="center"
        sx={{ flexShrink: 0, display: { xs: "none", md: "flex" } }}
      >
        <Box sx={{ textAlign: "center", minWidth: 72 }}>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              fontSize: "0.6rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              display: "block",
              mb: 0.25,
            }}
          >
            {t("statusPage.labels.uptime")}
          </Typography>
          <Typography variant="caption" fontWeight={700} color="text.primary">
            {formatUptime(service.uptimeSeconds, locale, t)}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "center", minWidth: 56 }}>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              fontSize: "0.6rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              display: "block",
              mb: 0.25,
            }}
          >
            {t("statusPage.labels.latency")}
          </Typography>
          <Typography variant="caption" fontWeight={700} color="text.primary">
            {formatLatency(service.latencyMs, locale, t)}
          </Typography>
        </Box>
        <Box
          sx={{
            textAlign: "center",
            minWidth: 72,
            display: { xs: "none", lg: "block" },
          }}
        >
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{
              fontSize: "0.6rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              display: "block",
              mb: 0.25,
            }}
          >
            {t("statusPage.labels.checkedAt")}
          </Typography>
          <Typography variant="caption" fontWeight={700} color="text.primary">
            {formatDateTime(service.checkedAt, locale) ||
              t("common.unavailable")}
          </Typography>
        </Box>
      </Stack>

      <Chip
        size="small"
        label={t(`statusPage.statusLabels.${service.status}`)}
        sx={{
          fontWeight: 700,
          fontSize: "0.7rem",
          height: 24,
          flexShrink: 0,
          ml: { xs: "auto", md: 0 },
          bgcolor: alpha(
            theme.palette[statusColor]?.main || theme.palette.grey[500],
            0.08,
          ),
          color:
            statusColor !== "default"
              ? `${statusColor}.main`
              : "text.secondary",
          border: "1px solid",
          borderColor: alpha(
            theme.palette[statusColor]?.main || theme.palette.grey[500],
            0.18,
          ),
          "& .MuiChip-label": { px: 1 },
        }}
      />
    </Box>
  );
}

ServiceRow.propTypes = {
  service: PropTypes.shape({
    key: PropTypes.string.isRequired,
    category: PropTypes.string,
    status: PropTypes.string.isRequired,
    uptimeSeconds: PropTypes.number,
    latencyMs: PropTypes.number,
    checkedAt: PropTypes.string,
  }).isRequired,
  detail: PropTypes.string.isRequired,
  locale: PropTypes.string.isRequired,
  t: PropTypes.func.isRequired,
};

function UptimeHistoryBar({ history, maxPoints, locale, t }) {
  const theme = useTheme();
  const snapshots = Array.isArray(history) ? history.filter(Boolean) : [];
  const barBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.025)
      : alpha(theme.palette.grey[100], 0.72);
  const separatorColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.08)
      : alpha(theme.palette.grey[400], 0.16);

  if (!snapshots.length) return null;

  const totalPoints = Math.max(Number(maxPoints) || snapshots.length, snapshots.length);
  const placeholders = Math.max(0, totalPoints - snapshots.length);
  const filledSnapshots = [
    ...Array.from({ length: placeholders }, () => null),
    ...snapshots,
  ];
  const operationalCount = snapshots.filter(
    (entry) => entry?.status === "operational"
  ).length;
  const uptimeRatio = formatNumber(
    (operationalCount / snapshots.length) * 100,
    locale,
    snapshots.length >= 10 ? 1 : 0
  );
  const firstCheckedAt = formatDateTime(snapshots[0]?.checkedAt, locale);
  const lastCheckedAt = formatDateTime(
    snapshots[snapshots.length - 1]?.checkedAt,
    locale
  );

  return (
    <Box
      sx={{
        px: 2.5,
        pt: 1.5,
        pb: 2.5,
        bgcolor: barBg,
        boxShadow: `inset 0 1px 0 ${separatorColor}`,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="body2" fontWeight={800}>
            {t("statusPage.historyTitle")}
          </Typography>
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ fontSize: "0.72rem" }}
          >
            {t("statusPage.historyHint", { count: snapshots.length })}
          </Typography>
        </Box>
        <Typography variant="body2" fontWeight={800} color="text.primary">
          {uptimeRatio ? `${uptimeRatio}%` : t("common.unavailable")}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${filledSnapshots.length}, minmax(0, 1fr))`,
          gap: 0.5,
          mt: 1.5,
        }}
      >
        {filledSnapshots.map((entry, index) => {
          const statusColor = getStatusColor(entry?.status);
          const segmentColor =
            theme.palette[statusColor]?.main || theme.palette.grey[400];
          const title = entry
            ? `${t(`statusPage.statusLabels.${entry.status}`)} | ${
                formatDateTime(entry.checkedAt, locale) || t("common.unavailable")
              }`
            : "";

          return (
            <Box
              key={`${entry?.checkedAt || "empty"}-${index}`}
              title={title}
              sx={{
                height: 12,
                borderRadius: 999,
                bgcolor: entry
                  ? alpha(segmentColor, 0.88)
                  : alpha(theme.palette.divider, 0.18),
                boxShadow: entry
                  ? `inset 0 0 0 1px ${alpha(segmentColor, 0.18)}`
                  : "none",
              }}
            />
          );
        })}
      </Box>

      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 1, gap: 1 }}
      >
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.68rem" }}
        >
          {firstCheckedAt || t("common.unavailable")}
        </Typography>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ fontSize: "0.68rem", textAlign: "right" }}
        >
          {lastCheckedAt || t("common.unavailable")}
        </Typography>
      </Stack>
    </Box>
  );
}

UptimeHistoryBar.propTypes = {
  history: PropTypes.arrayOf(
    PropTypes.shape({
      checkedAt: PropTypes.string,
      status: PropTypes.string,
      healthyServiceCount: PropTypes.number,
      serviceCount: PropTypes.number,
    })
  ).isRequired,
  maxPoints: PropTypes.number,
  locale: PropTypes.string.isRequired,
  t: PropTypes.func.isRequired,
};

export default function StatusPage() {
  const theme = useTheme();
  const { t, locale } = useLanguage();
  const servicePanelBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.background.paper, 0.92)
      : alpha(theme.palette.common.white, 0.82);
  const serviceHeaderBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.02)
      : alpha(theme.palette.grey[100], 0.82);
  const serviceBodyBg =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.black, 0.08)
      : alpha(theme.palette.grey[100], 0.42);
  const serviceDividerColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.common.white, 0.08)
      : alpha(theme.palette.grey[400], 0.16);
  const { data, error, isLoading, isFetching, refetch } =
    useGetPublicStatusQuery(undefined, {
      pollingInterval: 30000,
      refetchOnReconnect: true,
      refetchOnFocus: true,
    });

  const services = useMemo(() => {
    const map = new Map(
      (data?.services || []).map((service) => [service.key, service]),
    );
    return SERVICE_ORDER.map((key) => {
      const fallbackCategory = DEFAULT_CATEGORIES[key] || "worker";
      return (
        map.get(key) || {
          key,
          label: key,
          category: fallbackCategory,
          status: "unknown",
          uptimeSeconds: null,
          latencyMs: null,
          checkedAt: data?.generatedAt || null,
          detail: "",
          meta: {},
        }
      );
    });
  }, [data]);

  const overallStatus = data?.overallStatus || "unknown";
  const summary = useMemo(() => data?.summary || {}, [data?.summary]);
  const refreshIntervalSeconds = Number(data?.refreshIntervalSeconds || 30);
  const statusHistory = Array.isArray(data?.history?.overall)
    ? data.history.overall
    : [];
  const statusHistoryMaxPoints = Number(
    data?.history?.maxPoints || statusHistory.length || 0
  );
  const lastUpdated =
    formatDateTime(data?.generatedAt, locale) || t("common.unavailable");

  const buildServiceDetail = useCallback(
    (service) => {
      if (service.key === "public-api") {
        return service.status === "operational"
          ? t("statusPage.details.publicApiHealthy")
          : service.status === "degraded"
            ? t("statusPage.details.serviceDegraded")
            : service.status === "down"
              ? t("statusPage.details.serviceDown")
              : t("statusPage.details.serviceUnknown");
      }

      if (service.key === "recording-export") {
        const workerStatus = service.meta?.workerStatus || "unknown";
        const lastHeartbeat = formatDateTime(
          service.meta?.lastHeartbeatAt,
          locale,
        );
        const baseDetail =
          workerStatus === "busy"
            ? t("statusPage.details.workerBusy")
            : workerStatus === "idle"
              ? t("statusPage.details.workerIdle")
              : workerStatus === "stale"
                ? t("statusPage.details.workerStale")
                : workerStatus === "offline"
                  ? t("statusPage.details.workerOffline")
                  : t("statusPage.details.workerUnknown");

        return lastHeartbeat
          ? `${baseDetail} ${t("statusPage.details.lastHeartbeat", { date: lastHeartbeat })}`
          : baseDetail;
      }

      if (service.key === "recording-storage") {
        const healthy = Number(service.meta?.healthyTargetCount || 0);
        const total = Number(service.meta?.targetCount || 0);
        if (service.status === "operational")
          return t("statusPage.details.storageOperational", { healthy, total });
        if (service.status === "degraded")
          return t("statusPage.details.storageDegraded", { healthy, total });
        if (service.status === "down")
          return t("statusPage.details.storageDown");
        return t("statusPage.details.storageUnknown");
      }

      if (service.status === "operational")
        return t("statusPage.details.serviceHealthy");
      if (service.status === "degraded")
        return t("statusPage.details.serviceDegraded");
      if (service.status === "down") return t("statusPage.details.serviceDown");
      return t("statusPage.details.serviceUnknown");
    },
    [t, locale],
  );

  const summaryCards = useMemo(
    () => [
      {
        key: "overall",
        icon: <MonitorHeartRoundedIcon />,
        title: t("statusPage.summary.overallTitle"),
        value: t(`statusPage.statusLabels.${overallStatus}`),
        hint: t("statusPage.summary.overallHint", {
          healthy: Number(summary.healthyServiceCount || 0),
          total: Number(summary.serviceCount || services.length),
        }),
        color:
          getStatusColor(overallStatus) === "error"
            ? "error.main"
            : getStatusColor(overallStatus) === "warning"
              ? "warning.main"
              : getStatusColor(overallStatus) === "success"
                ? "success.main"
                : "text.primary",
        colorType: getStatusColor(overallStatus),
      },
      {
        key: "uptime",
        icon: <ScheduleRoundedIcon />,
        title: t("statusPage.summary.uptimeTitle"),
        value: formatUptime(summary.gatewayUptimeSeconds, locale, t),
        hint: t("statusPage.summary.uptimeHint"),
        color: "text.primary",
        colorType: "default",
      },
      {
        key: "throughput",
        icon: <QueryStatsRoundedIcon />,
        title: t("statusPage.summary.throughputTitle"),
        value: formatRatePerMinute(summary.requestRatePerMin, locale, t),
        hint: t("statusPage.summary.throughputHint"),
        color: "info.main",
        colorType: "info",
      },
      {
        key: "latency",
        icon: <SpeedRoundedIcon />,
        title: t("statusPage.summary.latencyTitle"),
        value: formatLatency(summary.apiP95Ms, locale, t),
        hint: t("statusPage.summary.latencyHint"),
        color:
          getStatusColor(overallStatus) === "error"
            ? "error.main"
            : "warning.main",
        colorType:
          getStatusColor(overallStatus) === "error" ? "error" : "warning",
      },
    ],
    [t, overallStatus, summary, services.length, locale],
  );

  const bannerStyle = getOverallBannerStyle(theme, overallStatus);
  const healthyCount = Number(summary.healthyServiceCount || 0);
  const totalCount = Number(summary.serviceCount || services.length);
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "status",
      entityTitle: t("statusPage.title"),
      sectionTitle: t(`statusPage.statusLabels.${overallStatus}`),
      pageSummary: t("statusPage.description"),
      activeLabels: [
        t(`statusPage.statusLabels.${overallStatus}`),
        `${healthyCount}/${totalCount} ${t("statusPage.summary.overallTitle")}`,
      ],
      visibleActions: [t("common.refresh")],
      highlights: services
        .filter((service) => service.status !== "operational")
        .slice(0, 4)
        .map((service) => service.label),
      metrics: summaryCards.map((card) => `${card.title}: ${card.value}`),
    }),
    [t, overallStatus, healthyCount, totalCount, services, summaryCards],
  );

  useRegisterChatBotPageSnapshot(chatBotSnapshot);

  return (
    <>
      <SEOHead
        title={t("statusPage.seoTitle")}
        description={t("statusPage.seoDescription")}
        path="/status"
      />

      <Box
        sx={{
          minHeight: "100vh",
          bgcolor:
            theme.palette.mode === "dark"
              ? theme.palette.background.default
              : theme.palette.grey[50],
          pb: 10,
        }}
      >
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Stack spacing={3}>
            {/* Header */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              justifyContent="space-between"
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              <Box>
                <Typography
                  variant="h4"
                  fontWeight={600}
                  sx={{ letterSpacing: "-0.03em", lineHeight: 1.2 }}
                >
                  {t("statusPage.title")}
                </Typography>
                <Typography
                  color="text.secondary"
                  variant="body2"
                  sx={{ mt: 0.75, lineHeight: 1.5 }}
                >
                  {t("statusPage.description")}
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                startIcon={
                  <RefreshRoundedIcon
                    sx={{
                      fontSize: "1rem !important",
                      animation: isFetching
                        ? "spin 1s linear infinite"
                        : "none",
                      "@keyframes spin": {
                        from: { transform: "rotate(0deg)" },
                        to: { transform: "rotate(360deg)" },
                      },
                    }}
                  />
                }
                onClick={() => refetch()}
                disabled={isFetching}
                sx={{
                  borderRadius: 2.5,
                  py: 0.75,
                  px: 2,
                  fontWeight: 700,
                  fontSize: "0.8rem",
                  textTransform: "none",
                  flexShrink: 0,
                  bgcolor: theme.palette.background.paper,
                  color: "text.primary",
                  boxShadow: `0 10px 24px ${alpha(theme.palette.common.black, 0.08)}`,
                  "&:hover": {
                    bgcolor: theme.palette.background.paper,
                    boxShadow: `0 14px 30px ${alpha(theme.palette.common.black, 0.12)}`,
                  },
                }}
              >
                {t("common.actions.refresh")}
              </Button>
            </Stack>

            {/* Overall status banner */}
            <Paper
              elevation={0}
              sx={{
                position: "relative",
                overflow: "hidden",
                borderRadius: 4,
                bgcolor: bannerStyle.bgcolor,
                px: 2.5,
                py: 2,
                boxShadow: `0 14px 34px ${alpha(bannerStyle.dotColor, 0.14)}`,
              }}
            >
              {isFetching && (
                <LinearProgress
                  color={
                    getStatusColor(overallStatus) !== "default"
                      ? getStatusColor(overallStatus)
                      : "primary"
                  }
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 2,
                  }}
                />
              )}
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      bgcolor: bannerStyle.dotColor,
                      flexShrink: 0,
                    }}
                  />
                  <Box>
                    <Typography variant="body2" fontWeight={800}>
                      {t(`statusPage.statusLabels.${overallStatus}`)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ fontSize: "0.7rem" }}
                    >
                      {t("statusPage.lastUpdated", { date: lastUpdated })}
                      {" · "}
                      {t("statusPage.refreshHint", {
                        seconds: refreshIntervalSeconds,
                      })}
                    </Typography>
                  </Box>
                </Stack>
                <Chip
                  size="small"
                  label={`${healthyCount} / ${totalCount}`}
                  sx={{
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    bgcolor: alpha(bannerStyle.dotColor, 0.12),
                    color: bannerStyle.dotColor,
                    border: "none",
                  }}
                />
              </Stack>
            </Paper>

            {/* Error Alert */}
            {error && (
              <Alert
                severity="error"
                variant="outlined"
                sx={{
                  borderRadius: 3,
                  alignItems: "center",
                  "& .MuiAlert-message": { flex: 1 },
                }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => refetch()}
                    sx={{ fontWeight: 700, textTransform: "none" }}
                  >
                    {t("common.actions.retry")}
                  </Button>
                }
              >
                <Typography variant="subtitle2" fontWeight={700}>
                  {t("statusPage.errors.loadTitle")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("statusPage.errors.loadBody")}
                </Typography>
              </Alert>
            )}

            {/* Loading */}
            {!data && isLoading && (
              <Paper
                elevation={0}
                sx={{
                  textAlign: "center",
                  py: 8,
                  borderRadius: 4,
                  boxShadow: `0 14px 32px ${alpha(theme.palette.common.black, 0.08)}`,
                }}
              >
                <LinearProgress
                  sx={{ width: 100, mx: "auto", mb: 2, borderRadius: 2 }}
                />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  fontWeight={500}
                >
                  {t("common.states.loading")}
                </Typography>
              </Paper>
            )}

            {data && (
              <>
                {/* Metrics */}
                <Grid container spacing={1.5}>
                  {summaryCards.map((card) => (
                    <Grid key={card.key} size={{ xs: 6, lg: 3 }}>
                      <SummaryCard {...card} />
                    </Grid>
                  ))}
                </Grid>

                {/* Services panel */}
                <Paper
                  elevation={0}
                  sx={{
                    borderRadius: 4,
                    overflow: "hidden",
                    bgcolor: servicePanelBg,
                    boxShadow: `0 18px 44px ${alpha(theme.palette.common.black, 0.08)}`,
                  }}
                >
                  {/* Panel header */}
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{
                      px: 2.5,
                      py: 2,
                      bgcolor: serviceHeaderBg,
                      borderBottom: "1px solid",
                      borderColor: serviceDividerColor,
                    }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={800}>
                        {t("statusPage.servicesTitle")}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{ fontSize: "0.7rem" }}
                      >
                        {t("statusPage.servicesSubtitle")}
                      </Typography>
                    </Box>
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{ display: { xs: "none", sm: "flex" } }}
                    >
                      {["operational", "degraded", "down"].map((s) => {
                        const sc = getStatusColor(s);
                        return (
                          <Stack
                            key={s}
                            direction="row"
                            spacing={0.75}
                            alignItems="center"
                          >
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                bgcolor:
                                  theme.palette[sc]?.main ||
                                  theme.palette.grey[500],
                              }}
                            />
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ fontSize: "0.7rem" }}
                            >
                              {t(`statusPage.statusLabels.${s}`)}
                            </Typography>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Stack>

                  {/* Service rows */}
                  <Box sx={{ p: 1, bgcolor: serviceBodyBg }}>
                    <Stack
                      divider={
                        <Divider
                          sx={{ mx: 2, borderColor: serviceDividerColor }}
                        />
                      }
                    >
                      {services.map((service) => (
                        <ServiceRow
                          key={service.key}
                          service={service}
                          detail={
                            String(service?.detail || "").trim() ||
                            buildServiceDetail(service)
                          }
                          locale={locale}
                          t={t}
                        />
                      ))}
                    </Stack>
                  </Box>
                  <UptimeHistoryBar
                    history={statusHistory}
                    maxPoints={statusHistoryMaxPoints}
                    locale={locale}
                    t={t}
                  />
                </Paper>
              </>
            )}

            {/* Note */}
            <Paper
              elevation={0}
              sx={{
                px: 2.5,
                py: 2,
                borderRadius: 3,
                bgcolor: alpha(theme.palette.warning.main, 0.04),
                display: "flex",
                gap: 1.5,
                alignItems: "flex-start",
                boxShadow: `0 12px 28px ${alpha(theme.palette.warning.main, 0.12)}`,
              }}
            >
              <Box
                sx={{
                  color: "warning.main",
                  flexShrink: 0,
                  mt: 0.25,
                  "& .MuiSvgIcon-root": { fontSize: "1.15rem" },
                }}
              >
                <WarningAmberRoundedIcon />
              </Box>
              <Box>
                <Typography
                  variant="body2"
                  fontWeight={800}
                  color="warning.dark"
                >
                  {t("statusPage.noteTitle")}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    lineHeight: 1.7,
                    mt: 0.25,
                    display: "block",
                    fontSize: "0.75rem",
                  }}
                >
                  {t("statusPage.noteBody")}
                </Typography>
              </Box>
            </Paper>
          </Stack>
        </Container>
      </Box>
    </>
  );
}
