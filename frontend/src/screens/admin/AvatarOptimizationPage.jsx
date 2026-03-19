/* eslint-disable react/prop-types */
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import BoltIcon from "@mui/icons-material/Bolt";
import { useLanguage } from "../../context/LanguageContext";
import { formatDateTime } from "../../i18n/format";
import {
  useGetAvatarOptimizationStatusQuery,
  useRunAvatarOptimizationCleanupMutation,
  useRunAvatarOptimizationSweepMutation,
} from "../../slices/adminApiSlice";

const isTruthy = (value) =>
  value === true || value === 1 || value === "1" || value === "true";

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const isSuperAdminUser = (user) => {
  const role = normalizeRole(user?.role);
  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : []
  );
  if (role) roles.add(role);
  if (user?.isAdmin) roles.add("admin");
  if (user?.isSuperUser || user?.isSuperAdmin) {
    roles.add("admin");
    roles.add("superadmin");
    roles.add("superuser");
  }

  return (
    (roles.has("superadmin") || roles.has("superuser")) &&
    (roles.has("admin") ||
      isTruthy(user?.isAdmin) ||
      isTruthy(user?.isSuperUser) ||
      isTruthy(user?.isSuperAdmin))
  );
};

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(ms = 0) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "0s";
  if (value < 1000) return `${value}ms`;
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function MetricCard({ label, value, caption, tone = "default" }) {
  const accent =
    tone === "warning"
      ? "warning.main"
      : tone === "success"
        ? "success.main"
        : tone === "info"
          ? "info.main"
          : "text.primary";

  return (
    <Card variant="outlined" sx={{ minHeight: 138 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800, color: accent }}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {caption}
        </Typography>
      </CardContent>
    </Card>
  );
}

function StatusChip({ running, idleLabel, runningLabel }) {
  return (
    <Chip
      size="small"
      color={running ? "warning" : "success"}
      label={running ? runningLabel : idleLabel}
      icon={running ? <AutorenewIcon /> : <BoltIcon />}
      sx={{
        "& .MuiChip-icon": running
          ? { animation: "spin 1.4s linear infinite" }
          : undefined,
        "@keyframes spin": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      }}
    />
  );
}

function UserSampleCard({ title, item, locale, t }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack spacing={0.5}>
        <Typography fontWeight={700} noWrap>
          {item?.name || item?.nickname || t("common.unavailable")}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {item?.phone || item?.avatar || t("common.unavailable")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {title}:{" "}
          {item?.updatedAt || item?.avatarOptimization?.optimizedAt
            ? formatDateTime(
                item?.avatarOptimization?.optimizedAt || item?.updatedAt,
                locale
              )
            : t("common.unavailable")}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ wordBreak: "break-all" }}
        >
          {item?.avatar || t("common.unavailable")}
        </Typography>
      </Stack>
    </Paper>
  );
}

export default function AvatarOptimizationPage() {
  const { t, locale } = useLanguage();
  const tx = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const { userInfo } = useSelector((state) => state.auth || {});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [snack, setSnack] = useState({
    open: false,
    severity: "success",
    message: "",
  });

  const isSuperAdmin = useMemo(() => isSuperAdminUser(userInfo), [userInfo]);

  const {
    data,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useGetAvatarOptimizationStatusQuery(undefined, {
    skip: !isSuperAdmin,
    pollingInterval: autoRefresh ? 5000 : 0,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const [runSweep, { isLoading: isRunningSweepAction }] =
    useRunAvatarOptimizationSweepMutation();
  const [runCleanup, { isLoading: isRunningCleanupAction }] =
    useRunAvatarOptimizationCleanupMutation();

  if (!isSuperAdmin) {
    return <Navigate to="/403" replace />;
  }

  const summary = data?.summary || {};
  const jobs = data?.jobs || {};
  const sweep = jobs.sweep || {};
  const cleanup = jobs.cleanup || {};
  const trash = data?.trash || {};
  const config = data?.config || {};
  const samples = data?.samples || {};
  const hasBusyJob = Boolean(sweep?.running || cleanup?.running);

  const showSnack = (severity, message) => {
    setSnack({ open: true, severity, message });
  };

  const handleRunSweep = async () => {
    try {
      const result = await runSweep().unwrap();
      showSnack(
        result?.started ? "success" : "info",
        result?.started
          ? tx(
              "admin.avatarOptimization.feedback.sweepStarted",
              "Sweep da duoc kich hoat."
            )
          : tx(
              "admin.avatarOptimization.feedback.sweepAlreadyRunning",
              "Sweep dang chay tu luong khac."
            )
      );
      await refetch();
    } catch (runError) {
      showSnack(
        "error",
        runError?.data?.message ||
          tx(
            "admin.avatarOptimization.feedback.actionFailed",
            "Khong thuc hien duoc thao tac nay."
          )
      );
    }
  };

  const handleRunCleanup = async () => {
    try {
      const result = await runCleanup().unwrap();
      showSnack(
        result?.started ? "success" : "info",
        result?.started
          ? tx(
              "admin.avatarOptimization.feedback.cleanupStarted",
              "Cleanup da duoc kich hoat."
            )
          : tx(
              "admin.avatarOptimization.feedback.cleanupAlreadyRunning",
              "Cleanup dang chay tu luong khac."
            )
      );
      await refetch();
    } catch (runError) {
      showSnack(
        "error",
        runError?.data?.message ||
          tx(
            "admin.avatarOptimization.feedback.actionFailed",
            "Khong thuc hien duoc thao tac nay."
          )
      );
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        mb={2}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {tx(
              "admin.avatarOptimization.title",
              "Realtime avatar optimization"
            )}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {tx(
              "admin.avatarOptimization.subtitle",
              "Theo doi quet nen, kich chay tay va kiem tra vung trash cua avatar user."
            )}
          </Typography>
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "stretch", sm: "center" }}
        >
          <FormControlLabel
            control={
              <Switch
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
            }
            label={tx("admin.avatarOptimization.actions.autoRefresh", "Tu lam moi 5s")}
          />
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {t("common.actions.refresh")}
          </Button>
          <Button
            variant="contained"
            startIcon={<AutorenewIcon />}
            onClick={handleRunSweep}
            disabled={isRunningSweepAction || Boolean(sweep?.running)}
          >
            {tx("admin.avatarOptimization.actions.runSweep", "Chay sweep ngay")}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<CleaningServicesIcon />}
            onClick={handleRunCleanup}
            disabled={isRunningCleanupAction || Boolean(cleanup?.running)}
          >
            {tx("admin.avatarOptimization.actions.runCleanup", "Don trash ngay")}
          </Button>
        </Stack>
      </Stack>

      {(isFetching || hasBusyJob) && <LinearProgress sx={{ mb: 2 }} />}

      {isLoading ? (
        <Paper
          variant="outlined"
          sx={{
            py: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography color="text.secondary">
            {t("common.states.loading")}
          </Typography>
        </Paper>
      ) : error ? (
        <Alert severity="error">
          {error?.data?.message ||
            tx(
              "admin.avatarOptimization.feedback.loadFailed",
              "Khong tai duoc trang thai avatar optimization."
            )}
        </Alert>
      ) : (
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                xl: "repeat(5, minmax(0, 1fr))",
              },
              gap: 2,
            }}
          >
            <MetricCard
              label={tx("admin.avatarOptimization.metrics.totalAvatarUsers", "User co avatar")}
              value={summary.totalAvatarUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.totalAvatarUsersHint",
                "Tong user dang co gia tri avatar"
              )}
              tone="info"
            />
            <MetricCard
              label={tx("admin.avatarOptimization.metrics.pendingUsers", "Dang cho xu ly")}
              value={summary.pendingUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.pendingUsersHint",
                "Avatar chua sync xong theo trang thai moi nhat"
              )}
              tone="warning"
            />
            <MetricCard
              label={tx("admin.avatarOptimization.metrics.upToDateUsers", "Da dong bo")}
              value={summary.upToDateUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.upToDateUsersHint",
                "Avatar da duoc danh dau khop voi model hien tai"
              )}
              tone="success"
            />
            <MetricCard
              label={tx(
                "admin.avatarOptimization.metrics.activeOptimizedUsers",
                "Avatar toi uu dang dung"
              )}
              value={summary.activeOptimizedUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.activeOptimizedUsersHint",
                "Model user dang tro toi avatar optimized"
              )}
              tone="info"
            />
            <MetricCard
              label={tx("admin.avatarOptimization.metrics.trashFiles", "File trong trash")}
              value={trash.files || 0}
              caption={`${formatBytes(trash.totalBytes || 0)} | ${
                summary.queuedUsers || 0
              } ${tx(
                "admin.avatarOptimization.metrics.queuedUsersSuffix",
                "dang xep hang"
              )}`}
            />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
              gap: 2,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={2}
                  mb={1.5}
                >
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {tx("admin.avatarOptimization.sections.sweepJob", "Job quet avatar")}
                  </Typography>
                  <StatusChip
                    running={Boolean(sweep?.running)}
                    idleLabel={tx("admin.avatarOptimization.states.idle", "Ranh")}
                    runningLabel={tx("admin.avatarOptimization.states.running", "Dang chay")}
                  />
                </Stack>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.cron", "Cron")}:{" "}
                    {config?.sweep?.cron || t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.batchSize", "Batch size")}:{" "}
                    {config?.sweep?.batchSize || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastStartedAt",
                      "Lan chay bat dau"
                    )}
                    :{" "}
                    {sweep?.lastStartedAt
                      ? formatDateTime(sweep.lastStartedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastFinishedAt",
                      "Lan chay ket thuc"
                    )}
                    :{" "}
                    {sweep?.lastFinishedAt
                      ? formatDateTime(sweep.lastFinishedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastDuration",
                      "Thoi luong"
                    )}
                    :{" "}
                    {formatDuration(sweep?.lastDurationMs)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastResult",
                      "Ket qua gan nhat"
                    )}
                    :{" "}
                    {sweep?.lastResult
                      ? `${sweep.lastResult.scanned || 0}/${sweep.lastResult.optimized || 0}/${sweep.lastResult.skipped || 0}`
                      : t("common.unavailable")}
                  </Typography>
                  {sweep?.lastError ? (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {sweep.lastError}
                    </Alert>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={2}
                  mb={1.5}
                >
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    {tx(
                      "admin.avatarOptimization.sections.cleanupJob",
                      "Job don optimized/trash"
                    )}
                  </Typography>
                  <StatusChip
                    running={Boolean(cleanup?.running)}
                    idleLabel={tx("admin.avatarOptimization.states.idle", "Ranh")}
                    runningLabel={tx("admin.avatarOptimization.states.running", "Dang chay")}
                  />
                </Stack>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.cron", "Cron")}:{" "}
                    {config?.cleanup?.cron || t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.trashRetentionDays",
                      "Giu trash (ngay)"
                    )}
                    :{" "}
                    {config?.cleanup?.avatarTrashMaxAgeDays || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastStartedAt",
                      "Lan chay bat dau"
                    )}
                    :{" "}
                    {cleanup?.lastStartedAt
                      ? formatDateTime(cleanup.lastStartedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastFinishedAt",
                      "Lan chay ket thuc"
                    )}
                    :{" "}
                    {cleanup?.lastFinishedAt
                      ? formatDateTime(cleanup.lastFinishedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastDuration",
                      "Thoi luong"
                    )}
                    :{" "}
                    {formatDuration(cleanup?.lastDurationMs)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastResult",
                      "Ket qua gan nhat"
                    )}
                    :{" "}
                    {cleanup?.lastResult
                      ? `${cleanup.lastResult.removed || 0} ${tx(
                          "admin.avatarOptimization.fields.filesRemoved",
                          "file da don"
                        )}`
                      : t("common.unavailable")}
                  </Typography>
                  {cleanup?.lastError ? (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {cleanup.lastError}
                    </Alert>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", xl: "1.25fr 1fr" },
              gap: 2,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                  {tx(
                    "admin.avatarOptimization.sections.pendingUsers",
                    "User cho xu ly"
                  )}
                </Typography>
                {samples?.pending?.length ? (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: {
                        xs: "1fr",
                        md: "repeat(2, minmax(0, 1fr))",
                      },
                      gap: 1.5,
                    }}
                  >
                    {samples.pending.map((item) => (
                      <UserSampleCard
                        key={item._id}
                        title={tx(
                          "admin.avatarOptimization.fields.updatedAt",
                          "Cap nhat user"
                        )}
                        item={item}
                        locale={locale}
                        t={t}
                      />
                    ))}
                  </Box>
                ) : (
                  <Alert severity="success">
                    {tx(
                      "admin.avatarOptimization.states.noPendingUsers",
                      "Khong con user nao dang cho toi uu."
                    )}
                  </Alert>
                )}
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                  {tx(
                    "admin.avatarOptimization.sections.recentOptimized",
                    "User vua toi uu gan day"
                  )}
                </Typography>
                {samples?.recentOptimized?.length ? (
                  <Stack spacing={1.5}>
                    {samples.recentOptimized.map((item) => (
                      <UserSampleCard
                        key={item._id}
                        title={tx(
                          "admin.avatarOptimization.fields.optimizedAt",
                          "Toi uu luc"
                        )}
                        item={item}
                        locale={locale}
                        t={t}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="info">
                    {tx(
                      "admin.avatarOptimization.states.noRecentOptimized",
                      "Chua co avatar optimized nao de hien thi."
                    )}
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
              gap: 2,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                  {tx(
                    "admin.avatarOptimization.sections.config",
                    "Cau hinh chay nen"
                  )}
                </Typography>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.thresholdBytes",
                      "Nguong dung luong"
                    )}
                    :{" "}
                    {formatBytes(config?.sweep?.thresholdBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.maxDimension",
                      "Canh toi da"
                    )}
                    :{" "}
                    {config?.sweep?.maxDimension || 0}px
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.quality", "Chat luong webp")}
                    :{" "}
                    {config?.sweep?.quality || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.minSavedBytes",
                      "Nguong tiet kiem toi thieu"
                    )}
                    :{" "}
                    {formatBytes(config?.sweep?.minSavedBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.timezone", "Mui gio")}:{" "}
                    {config?.sweep?.timezone || t("common.unavailable")}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Chip
                    size="small"
                    color={config?.sweep?.deleteOriginals ? "warning" : "default"}
                    label={
                      config?.sweep?.deleteOriginals
                        ? tx(
                            "admin.avatarOptimization.notes.archiveOldOriginal",
                            "Anh goc se duoc dua vao _trash sau khi model doi sang anh moi"
                          )
                        : tx(
                            "admin.avatarOptimization.notes.keepOldOriginal",
                            "Anh goc dang duoc giu nguyen sau optimize"
                          )
                    }
                    sx={{ alignSelf: "flex-start" }}
                  />
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                  {tx("admin.avatarOptimization.sections.trash", "Vung trash avatar")}
                </Typography>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.root", "Thu muc")}:{" "}
                    {trash?.root || t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.files", "So file")}:{" "}
                    {trash?.files || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.totalBytes", "Dung luong")}:{" "}
                    {formatBytes(trash?.totalBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.oldestFileAt",
                      "File cu nhat"
                    )}
                    :{" "}
                    {trash?.oldestFileAt
                      ? formatDateTime(trash.oldestFileAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.newestFileAt",
                      "File moi nhat"
                    )}
                    :{" "}
                    {trash?.newestFileAt
                      ? formatDateTime(trash.newestFileAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        </Stack>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={2800}
        onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
          variant="filled"
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
