/* eslint-disable react/prop-types */
import { useCallback, useMemo, useState } from "react";
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
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";
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

const isAdminUser = (user) => {
  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : [],
  );
  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin) roles.add("admin");
  return roles.has("admin");
};

const isSuperAdminUser = (user) => {
  return (
    isAdminUser(user) &&
    (isTruthy(user?.isSuperUser) || isTruthy(user?.isSuperAdmin))
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
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
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
                locale,
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
  const tx = useCallback((key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  }, [t]);
  const { userInfo } = useSelector((state) => state.auth || {});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [snack, setSnack] = useState({
    open: false,
    severity: "success",
    message: "",
  });

  const isSuperAdmin = useMemo(() => isSuperAdminUser(userInfo), [userInfo]);

  const { data, error, isLoading, isFetching, refetch } =
    useGetAvatarOptimizationStatusQuery(undefined, {
      skip: !isSuperAdmin,
      pollingInterval: autoRefresh ? 5000 : 0,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    });

  const [runSweep, { isLoading: isRunningSweepAction }] =
    useRunAvatarOptimizationSweepMutation();
  const [runCleanup, { isLoading: isRunningCleanupAction }] =
    useRunAvatarOptimizationCleanupMutation();

  const summary = data?.summary || {};
  const jobs = data?.jobs || {};
  const sweep = jobs.sweep || {};
  const cleanup = jobs.cleanup || {};
  const trash = data?.trash || {};
  const config = data?.config || {};
  const samples = data?.samples || {};
  const hasBusyJob = Boolean(sweep?.running || cleanup?.running);
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "admin_avatar_optimization",
      entityTitle: tx(
        "admin.avatarOptimization.title",
        "Tối ưu Ảnh Đại Diện theo thời gian thực",
      ),
      sectionTitle: hasBusyJob ? "Có job đang chạy" : "Đang rảnh",
      pageSummary:
        "Trang admin theo dõi quét nền, dọn thùng rác và hiệu suất tối ưu avatar.",
      activeLabels: [
        autoRefresh ? "Auto refresh bật" : "Auto refresh tắt",
        sweep?.running ? "Sweep đang chạy" : "",
        cleanup?.running ? "Cleanup đang chạy" : "",
      ],
      visibleActions: ["Làm mới", "Bật auto refresh", "Chạy sweep", "Chạy cleanup"],
      highlights: [
        samples?.latestOptimized?.name || "",
        samples?.latestDeleted?.name || "",
      ],
      metrics: [
        `Users checked: ${summary.totalUsersChecked || 0}`,
        `Optimized: ${summary.totalOptimized || 0}`,
        `Trash files: ${trash.count || 0}`,
      ],
    }),
    [
      tx,
      hasBusyJob,
      autoRefresh,
      sweep?.running,
      cleanup?.running,
      samples?.latestOptimized?.name,
      samples?.latestDeleted?.name,
      summary.totalUsersChecked,
      summary.totalOptimized,
      trash.count,
    ],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      autoRefresh: (nextValue) => {
        setAutoRefresh(Boolean(nextValue));
      },
    }),
    [],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: ["set_page_state", "focus_element", "navigate"],
    actionHandlers: chatBotActionHandlers,
  });

  if (!isSuperAdmin) {
    return <Navigate to="/403" replace />;
  }

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
              "Đã kích hoạt quét ảnh đại diện.",
            )
          : tx(
              "admin.avatarOptimization.feedback.sweepAlreadyRunning",
              "Tác vụ quét đang chạy ở luồng khác.",
            ),
      );
      await refetch();
    } catch (runError) {
      showSnack(
        "error",
        runError?.data?.message ||
          tx(
            "admin.avatarOptimization.feedback.actionFailed",
            "Không thực hiện được thao tác này.",
          ),
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
              "Đã kích hoạt dọn thùng rác.",
            )
          : tx(
              "admin.avatarOptimization.feedback.cleanupAlreadyRunning",
              "Tác vụ dọn đang chạy ở luồng khác.",
            ),
      );
      await refetch();
    } catch (runError) {
      showSnack(
        "error",
        runError?.data?.message ||
          tx(
            "admin.avatarOptimization.feedback.actionFailed",
            "Không thực hiện được thao tác này.",
          ),
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
              "Tối ưu Ảnh Đại Diện theo thời gian thực",
            )}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {tx(
              "admin.avatarOptimization.subtitle",
              "Theo dõi quét nền, chạy thủ công và kiểm tra thùng rác cho ảnh đại diện người dùng.",
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
            label={tx(
              "admin.avatarOptimization.actions.autoRefresh",
              "Tự làm mới mỗi 5 giây",
            )}
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
            {tx("admin.avatarOptimization.actions.runSweep", "Chạy quét ngay")}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<CleaningServicesIcon />}
            onClick={handleRunCleanup}
            disabled={isRunningCleanupAction || Boolean(cleanup?.running)}
          >
            {tx(
              "admin.avatarOptimization.actions.runCleanup",
              "Dọn thùng rác ngay",
            )}
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
              "Không tải được trạng thái tối ưu ảnh đại diện.",
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
              label={tx(
                "admin.avatarOptimization.metrics.totalAvatarUsers",
                "Người dùng có ảnh đại diện",
              )}
              value={summary.totalAvatarUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.totalAvatarUsersHint",
                "Tổng số người dùng đang có ảnh đại diện",
              )}
              tone="info"
            />
            <MetricCard
              label={tx(
                "admin.avatarOptimization.metrics.pendingUsers",
                "Đang chờ xử lý",
              )}
              value={summary.pendingUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.pendingUsersHint",
                "Ảnh đại diện chưa đồng bộ xong theo trạng thái mới nhất",
              )}
              tone="warning"
            />
            <MetricCard
              label={tx(
                "admin.avatarOptimization.metrics.upToDateUsers",
                "Đã đồng bộ",
              )}
              value={summary.upToDateUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.upToDateUsersHint",
                "Ảnh đại diện đã được đánh dấu khớp với dữ liệu hiện tại",
              )}
              tone="success"
            />
            <MetricCard
              label={tx(
                "admin.avatarOptimization.metrics.activeOptimizedUsers",
                "Ảnh tối ưu đang dùng",
              )}
              value={summary.activeOptimizedUsers || 0}
              caption={tx(
                "admin.avatarOptimization.metrics.activeOptimizedUsersHint",
                "Tài khoản người dùng đang trỏ tới ảnh đã tối ưu",
              )}
              tone="info"
            />
            <MetricCard
              label={tx(
                "admin.avatarOptimization.metrics.trashFiles",
                "Tệp trong thùng rác",
              )}
              value={trash.files || 0}
              caption={`${formatBytes(trash.totalBytes || 0)} | ${
                summary.queuedUsers || 0
              } ${tx(
                "admin.avatarOptimization.metrics.queuedUsersSuffix",
                "đang xếp hàng",
              )}`}
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
                    {tx(
                      "admin.avatarOptimization.sections.sweepJob",
                      "Tác vụ quét ảnh đại diện",
                    )}
                  </Typography>
                  <StatusChip
                    running={Boolean(sweep?.running)}
                    idleLabel={tx(
                      "admin.avatarOptimization.states.idle",
                      "Đang nghỉ",
                    )}
                    runningLabel={tx(
                      "admin.avatarOptimization.states.running",
                      "Đang chạy",
                    )}
                  />
                </Stack>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.cron", "Cron")}:{" "}
                    {config?.sweep?.cron || t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.batchSize",
                      "Số lượng mỗi lượt",
                    )}
                    : {config?.sweep?.batchSize || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastStartedAt",
                      "Lần bắt đầu",
                    )}
                    :{" "}
                    {sweep?.lastStartedAt
                      ? formatDateTime(sweep.lastStartedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastFinishedAt",
                      "Lần kết thúc",
                    )}
                    :{" "}
                    {sweep?.lastFinishedAt
                      ? formatDateTime(sweep.lastFinishedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastDuration",
                      "Thời lượng",
                    )}
                    : {formatDuration(sweep?.lastDurationMs)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastResult",
                      "Kết quả",
                    )}
                    :{" "}
                    {sweep?.lastResult
                      ? `${sweep.lastResult.scanned || 0}/${
                          sweep.lastResult.optimized || 0
                        }/${sweep.lastResult.skipped || 0}`
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
                      "Tác vụ dọn thùng rác",
                    )}
                  </Typography>
                  <StatusChip
                    running={Boolean(cleanup?.running)}
                    idleLabel={tx(
                      "admin.avatarOptimization.states.idle",
                      "Đang nghỉ",
                    )}
                    runningLabel={tx(
                      "admin.avatarOptimization.states.running",
                      "Đang chạy",
                    )}
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
                      "Giữ lại thùng rác (ngày)",
                    )}
                    : {config?.cleanup?.avatarTrashMaxAgeDays || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastStartedAt",
                      "Lần bắt đầu",
                    )}
                    :{" "}
                    {cleanup?.lastStartedAt
                      ? formatDateTime(cleanup.lastStartedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastFinishedAt",
                      "Lần kết thúc",
                    )}
                    :{" "}
                    {cleanup?.lastFinishedAt
                      ? formatDateTime(cleanup.lastFinishedAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastDuration",
                      "Thời lượng",
                    )}
                    : {formatDuration(cleanup?.lastDurationMs)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.lastResult",
                      "Kết quả",
                    )}
                    :{" "}
                    {cleanup?.lastResult
                      ? `${cleanup.lastResult.removed || 0} ${tx(
                          "admin.avatarOptimization.fields.filesRemoved",
                          "tệp đã dọn",
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
                    "Người dùng chờ xử lý",
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
                          "Cập nhật lúc",
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
                      "Không còn người dùng nào đang chờ tối ưu.",
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
                    "Người dùng vừa tối ưu",
                  )}
                </Typography>
                {samples?.recentOptimized?.length ? (
                  <Stack spacing={1.5}>
                    {samples.recentOptimized.map((item) => (
                      <UserSampleCard
                        key={item._id}
                        title={tx(
                          "admin.avatarOptimization.fields.optimizedAt",
                          "Tối ưu lúc",
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
                      "Chưa có ảnh tối ưu nào để hiển thị.",
                    )}
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                lg: "repeat(2, minmax(0, 1fr))",
              },
              gap: 2,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>
                  {tx(
                    "admin.avatarOptimization.sections.config",
                    "Cấu hình nền",
                  )}
                </Typography>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.thresholdBytes",
                      "Ngưỡng dung lượng",
                    )}
                    : {formatBytes(config?.sweep?.thresholdBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.maxDimension",
                      "Cạnh tối đa",
                    )}
                    : {config?.sweep?.maxDimension || 0}px
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.quality",
                      "Chất lượng WebP",
                    )}
                    : {config?.sweep?.quality || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.minSavedBytes",
                      "Tiết kiệm tối thiểu",
                    )}
                    : {formatBytes(config?.sweep?.minSavedBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.timezone", "Múi giờ")}:{" "}
                    {config?.sweep?.timezone || t("common.unavailable")}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Chip
                    size="small"
                    color={
                      config?.sweep?.deleteOriginals ? "warning" : "default"
                    }
                    label={
                      config?.sweep?.deleteOriginals
                        ? tx(
                            "admin.avatarOptimization.notes.archiveOldOriginal",
                            "Ảnh gốc sẽ được đưa vào thùng rác sau khi đổi sang ảnh mới",
                          )
                        : tx(
                            "admin.avatarOptimization.notes.keepOldOriginal",
                            "Ảnh gốc đang được giữ lại sau khi tối ưu",
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
                  {tx(
                    "admin.avatarOptimization.sections.trash",
                    "Thùng rác ảnh đại diện",
                  )}
                </Typography>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.root", "Thư mục")}:{" "}
                    {trash?.root || t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx("admin.avatarOptimization.fields.files", "Số tệp")}:{" "}
                    {trash?.files || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.totalBytes",
                      "Dung lượng",
                    )}
                    : {formatBytes(trash?.totalBytes || 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.oldestFileAt",
                      "Tệp cũ nhất",
                    )}
                    :{" "}
                    {trash?.oldestFileAt
                      ? formatDateTime(trash.oldestFileAt, locale)
                      : t("common.unavailable")}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tx(
                      "admin.avatarOptimization.fields.newestFileAt",
                      "Tệp mới nhất",
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
