import { useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import Grid from "@mui/material/Grid"; // Hoặc Grid2 tùy phiên bản MUI bạn đang dùng
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
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";
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

// Giúp tạo màu nền mờ cho các icon/chip theo theme
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

function SummaryCard({
  icon,
  title,
  value,
  hint,
  color = "text.primary",
  colorType = "default",
}) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 4,
        border: "1px solid",
        borderColor: "divider",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          boxShadow: theme.shadows[2],
          borderColor: "text.disabled",
        },
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: getSoftColor(theme, colorType),
              color,
            }}
          >
            {icon}
          </Box>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            fontWeight={600}
          >
            {title}
          </Typography>
        </Stack>
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            color={color}
            sx={{ mb: 0.5 }}
          >
            {value}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {hint}
          </Typography>
        </Box>
      </Stack>
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

function ServiceCard({ service, detail, locale, t }) {
  const theme = useTheme();
  const categoryKey =
    service.category || DEFAULT_CATEGORIES[service.key] || "worker";
  const statusColor = getStatusColor(service.status);

  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 4,
        border: "1px solid",
        borderColor: "divider",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "all 0.2s ease-in-out",
        "&:hover": {
          boxShadow: theme.shadows[4],
          borderColor: alpha(
            theme.palette[statusColor]?.main || theme.palette.primary.main,
            0.4,
          ),
        },
      }}
    >
      <Stack spacing={2.5} sx={{ height: "100%" }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="flex-start"
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {t(`statusPage.services.${SERVICE_NAME_KEYS[service.key]}`)}
            </Typography>
            <Chip
              size="small"
              label={t(`statusPage.categories.${categoryKey}`)}
              sx={{
                mt: 1,
                fontSize: "0.75rem",
                fontWeight: 600,
                bgcolor: alpha(theme.palette.text.primary, 0.05),
                border: "none",
              }}
            />
          </Box>
          <Chip
            size="small"
            color={statusColor}
            label={t(`statusPage.statusLabels.${service.status}`)}
            sx={{
              fontWeight: 700,
              bgcolor: alpha(
                theme.palette[statusColor]?.main || theme.palette.grey[500],
                0.1,
              ),
              color: `${statusColor}.main`,
              border: "none",
            }}
          />
        </Stack>

        <Typography
          color="text.secondary"
          variant="body2"
          sx={{ lineHeight: 1.6, minHeight: 44 }}
        >
          {detail}
        </Typography>

        <Divider sx={{ borderStyle: "dashed" }} />

        <Grid container spacing={2}>
          <Grid size={{ xs: 6 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              textTransform="uppercase"
              fontWeight={600}
              letterSpacing={0.5}
            >
              {t("statusPage.labels.uptime")}
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>
              {formatUptime(service.uptimeSeconds, locale, t)}
            </Typography>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              textTransform="uppercase"
              fontWeight={600}
              letterSpacing={0.5}
            >
              {t("statusPage.labels.latency")}
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>
              {formatLatency(service.latencyMs, locale, t)}
            </Typography>
          </Grid>
        </Grid>

        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ mt: "auto", pt: 1, display: "block" }}
        >
          {t("statusPage.labels.checkedAt")}:{" "}
          {formatDateTime(service.checkedAt, locale) || t("common.unavailable")}
        </Typography>
      </Stack>
    </Paper>
  );
}

ServiceCard.propTypes = {
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

export default function StatusPage() {
  const theme = useTheme();
  const { t, locale } = useLanguage();
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
  const summary = data?.summary || {};
  const refreshIntervalSeconds = Number(data?.refreshIntervalSeconds || 30);
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

  const summaryCards = [
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
  ];

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
          background:
            theme.palette.mode === "dark"
              ? "radial-gradient(circle at top, rgba(15,25,35,1) 0%, rgba(10,14,18,1) 100%)"
              : "radial-gradient(circle at top, #f8fafc 0%, #ffffff 100%)",
          pb: 8,
        }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
          <Stack spacing={4}>
            {/* Header Section */}
            <Paper
              elevation={0}
              sx={{
                position: "relative",
                overflow: "hidden",
                p: { xs: 3, md: 5 },
                borderRadius: 5,
                border: "1px solid",
                borderColor: alpha(theme.palette.divider, 0.6),
                background:
                  theme.palette.mode === "dark"
                    ? `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.6)} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`
                    : `linear-gradient(135deg, #ffffff 0%, #f4f7f6 100%)`,
                boxShadow:
                  theme.palette.mode === "dark"
                    ? "none"
                    : "0px 12px 24px -4px rgba(0, 0, 0, 0.03)",
              }}
            >
              {isFetching && (
                <LinearProgress
                  color="inherit"
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    opacity: 0.3,
                  }}
                />
              )}

              <Stack spacing={3}>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", md: "center" }}
                >
                  <Box>
                    <Typography
                      variant="overline"
                      color="primary.main"
                      fontWeight={700}
                      sx={{ letterSpacing: 1.5 }}
                    >
                      {t("statusPage.eyebrow")}
                    </Typography>
                    <Typography
                      variant="h3"
                      fontWeight={800}
                      sx={{ mt: 1, mb: 1, letterSpacing: "-0.02em" }}
                    >
                      {t("statusPage.title")}
                    </Typography>
                    <Typography
                      color="text.secondary"
                      variant="subtitle1"
                      sx={{ maxWidth: 700, lineHeight: 1.6 }}
                    >
                      {t("statusPage.description")}
                    </Typography>
                  </Box>

                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    alignItems={{ xs: "stretch", sm: "center" }}
                  >
                    <Chip
                      color={getStatusColor(overallStatus)}
                      label={t(`statusPage.statusLabels.${overallStatus}`)}
                      sx={{
                        fontWeight: 700,
                        px: 1,
                        py: 2.5,
                        fontSize: "0.95rem",
                        borderRadius: 3,
                      }}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<RefreshRoundedIcon />}
                      onClick={() => refetch()}
                      disabled={isFetching}
                      sx={{
                        borderRadius: 3,
                        py: 1,
                        fontWeight: 600,
                        borderColor: alpha(theme.palette.divider, 0.8),
                      }}
                    >
                      {t("common.actions.refresh")}
                    </Button>
                  </Stack>
                </Stack>

                <Divider sx={{ opacity: 0.6 }} />

                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    fontWeight={500}
                  >
                    {t("statusPage.lastUpdated", { date: lastUpdated })}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {t("statusPage.refreshHint", {
                      seconds: refreshIntervalSeconds,
                    })}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            {/* Error Alert */}
            {error && (
              <Alert
                severity="error"
                sx={{ borderRadius: 3, alignItems: "center" }}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => refetch()}
                    sx={{ fontWeight: 600 }}
                  >
                    {t("common.actions.retry")}
                  </Button>
                }
              >
                <Typography variant="subtitle2" fontWeight={700}>
                  {t("statusPage.errors.loadTitle")}
                </Typography>
                <Typography variant="body2">
                  {t("statusPage.errors.loadBody")}
                </Typography>
              </Alert>
            )}

            {/* Loading State Overlay (nếu chưa có data) */}
            {!data && isLoading && (
              <Box textAlign="center" py={4}>
                <Typography
                  variant="body1"
                  color="text.secondary"
                  fontWeight={500}
                >
                  {t("common.states.loading")}
                </Typography>
              </Box>
            )}

            {/* Metrics Section */}
            {data && (
              <>
                <Grid container spacing={3}>
                  {summaryCards.map((card) => (
                    <Grid key={card.key} size={{ xs: 12, sm: 6, xl: 3 }}>
                      <SummaryCard {...card} />
                    </Grid>
                  ))}
                </Grid>

                {/* Services Section */}
                <Box pt={2}>
                  <Stack spacing={1} mb={3}>
                    <Typography
                      variant="h5"
                      fontWeight={800}
                      letterSpacing="-0.01em"
                    >
                      {t("statusPage.servicesTitle")}
                    </Typography>
                    <Typography color="text.secondary" variant="body1">
                      {t("statusPage.servicesSubtitle")}
                    </Typography>
                  </Stack>

                  <Grid container spacing={3}>
                    {services.map((service) => (
                      <Grid key={service.key} size={{ xs: 12, md: 6, xl: 3 }}>
                        <ServiceCard
                          service={service}
                          detail={buildServiceDetail(service)}
                          locale={locale}
                          t={t}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              </>
            )}

            {/* Note Section */}
            <Paper
              elevation={0}
              sx={{
                p: 3,
                borderRadius: 4,
                border: "1px dashed",
                borderColor: alpha(theme.palette.warning.main, 0.3),
                bgcolor: alpha(theme.palette.warning.main, 0.04),
              }}
            >
              <Stack spacing={1}>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  color="warning.dark"
                >
                  {t("statusPage.noteTitle")}
                </Typography>
                <Typography
                  color="text.secondary"
                  variant="body2"
                  sx={{ lineHeight: 1.6 }}
                >
                  {t("statusPage.noteBody")}
                </Typography>
              </Stack>
            </Paper>
          </Stack>
        </Container>
      </Box>
    </>
  );
}
