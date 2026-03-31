import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SaveIcon from "@mui/icons-material/Save";
import {
  useGetSeoNewsArticlesQuery,
  useGetSeoNewsCandidatesQuery,
  useGetSeoNewsJobMonitorQuery,
  useGetSeoNewsSettingsQuery,
  usePushSeoNewsDraftsMutation,
  useQueueSeoNewsJobMutation,
  useUpdateSeoNewsSettingsMutation,
} from "../../slices/adminApiSlice";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";

const DEFAULT_FORM = {
  enabled: true,
  autoPublish: true,
  imageSearchEnabled: true,
  imageFallbackEnabled: true,
  intervalMinutes: 180,
  minAiScore: 0.75,
  reviewPassScore: 0.78,
  maxArticlesPerRun: 8,
  maxArticlesPerDay: 8,
  targetArticlesPerDay: 6,
  discoveryProvider: "auto",
  articleGenerationModel: "",
  mainKeywords: "pickleball, pickletour, giai pickleball",
  extraKeywords: "",
  allowedDomains: "",
  blockedDomains: "",
  competitorDomains: "alobo.vn, vpickleball.com",
  competitorKeywords: "alobo, vpickleball",
};

function toCsv(value) {
  if (!Array.isArray(value)) return "";
  return value.filter(Boolean).join(", ");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN");
}

function getGatewayAlertSeverity(status) {
  if (status === "online") return "success";
  if (status === "degraded") return "warning";
  if (status === "auth_error" || status === "misconfigured") return "error";
  return "info";
}

function getGatewayChipColor(status) {
  if (status === "online") return "success";
  if (status === "degraded") return "warning";
  if (status === "auth_error" || status === "misconfigured") return "error";
  return "default";
}

function formatGatewaySource(source) {
  if (source === "dedicated") return "Dedicated";
  if (source === "shared_proxy") return "Shared proxy";
  if (source === "openai_default") return "OpenAI";
  return "Missing";
}

function formatPipelineJobType(type) {
  if (type === "pipeline") return "Pipeline";
  if (type === "pending_candidates") return "Pending";
  if (type === "create_ready_articles") return "AI Ready";
  return "Job";
}

function getStepSummary(result) {
  if (!result) return null;
  const stats = result.stats || result;
  return {
    externalGenerated: Number(stats?.externalGenerated) || 0,
    evergreenGenerated:
      Number(stats?.evergreenGenerated ?? result?.generated) || 0,
    published: Number(stats?.published) || 0,
    draft: Number(stats?.draft) || 0,
    failed:
      Number(stats?.failed) ||
      Number(result?.failed) ||
      Number(result?.crawl?.failed) ||
      0,
  };
}

export default function AdminNewsPage() {
  const {
    data: settings,
    isLoading: loadingSettings,
    refetch: refetchSettings,
  } = useGetSeoNewsSettingsQuery();

  const {
    data: candidates = [],
    isFetching: loadingCandidates,
    refetch: refetchCandidates,
  } = useGetSeoNewsCandidatesQuery({ limit: 120 });
  const {
    data: jobMonitor,
    isFetching: loadingJobMonitor,
    refetch: refetchJobMonitor,
  } = useGetSeoNewsJobMonitorQuery(undefined, {
    pollingInterval: 5000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const {
    data: draftArticlesData,
    isFetching: loadingDraftArticles,
    refetch: refetchDraftArticles,
  } = useGetSeoNewsArticlesQuery({
    page: 1,
    limit: 40,
    status: "draft",
    origin: "external",
  });
  const {
    data: generatedDraftArticlesData,
    isFetching: loadingGeneratedDraftArticles,
    refetch: refetchGeneratedDraftArticles,
  } = useGetSeoNewsArticlesQuery({
    page: 1,
    limit: 40,
    status: "draft",
    origin: "generated",
  });

  const [updateSettings, { isLoading: savingSettings }] =
    useUpdateSeoNewsSettingsMutation();
  const [queueSeoNewsJob, { isLoading: queueingJob }] =
    useQueueSeoNewsJobMutation();
  const [pushSeoNewsDrafts, { isLoading: pushingDrafts }] =
    usePushSeoNewsDraftsMutation();

  const [form, setForm] = useState(DEFAULT_FORM);
  const [message, setMessage] = useState({ type: "success", text: "" });
  const [publishingAllDrafts, setPublishingAllDrafts] = useState(false);
  const [publishingAllGeneratedDrafts, setPublishingAllGeneratedDrafts] =
    useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled !== false,
      autoPublish: settings.autoPublish !== false,
      imageSearchEnabled: settings.imageSearchEnabled !== false,
      imageFallbackEnabled: settings.imageFallbackEnabled !== false,
      intervalMinutes: Number(settings.intervalMinutes) || 180,
      minAiScore: Number(settings.minAiScore) || 0.75,
      reviewPassScore: Number(settings.reviewPassScore) || 0.78,
      maxArticlesPerRun: Number(settings.maxArticlesPerRun) || 8,
      maxArticlesPerDay: Number(settings.maxArticlesPerDay) || 8,
      targetArticlesPerDay: Number(settings.targetArticlesPerDay) || 6,
      discoveryProvider: settings.discoveryProvider || "auto",
      articleGenerationModel: settings.articleGenerationModel || "",
      mainKeywords: toCsv(settings.mainKeywords),
      extraKeywords: toCsv(settings.extraKeywords),
      allowedDomains: toCsv(settings.allowedDomains),
      blockedDomains: toCsv(settings.blockedDomains),
      competitorDomains: toCsv(settings.competitorDomains),
      competitorKeywords: toCsv(settings.competitorKeywords),
    });
  }, [settings]);

  const canSave = useMemo(() => {
    return form.intervalMinutes >= 5 && form.maxArticlesPerDay >= 1;
  }, [form.intervalMinutes, form.maxArticlesPerDay]);

  const pendingCandidatesCount = useMemo(
    () =>
      (candidates || []).filter((item) => item?.status === "pending").length,
    [candidates],
  );

  const draftArticles = useMemo(() => {
    if (Array.isArray(draftArticlesData)) return draftArticlesData;
    if (Array.isArray(draftArticlesData?.items)) return draftArticlesData.items;
    return [];
  }, [draftArticlesData]);
  const generatedDraftArticles = useMemo(() => {
    if (Array.isArray(generatedDraftArticlesData))
      return generatedDraftArticlesData;
    if (Array.isArray(generatedDraftArticlesData?.items)) {
      return generatedDraftArticlesData.items;
    }
    return [];
  }, [generatedDraftArticlesData]);

  const draftArticlesCount =
    Number(draftArticlesData?.total) || draftArticles.length || 0;
  const generatedDraftArticlesCount =
    Number(generatedDraftArticlesData?.total) ||
    generatedDraftArticles.length ||
    0;
  const articleGenerationGateway = settings?.articleGenerationGateway || null;
  const activeJob = jobMonitor?.activeJob || null;
  const recentJobs = Array.isArray(jobMonitor?.recentJobs)
    ? jobMonitor.recentJobs
    : [];
  const jobSummary = jobMonitor?.summary || {};
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "admin_news",
      entityTitle: "News Management",
      sectionTitle: form.discoveryProvider || "auto",
      pageSummary:
        "Trang admin điều phối pipeline AI News, discovery provider, gateway và publish queue.",
      activeLabels: [
        form.enabled ? "Auto fetch bật" : "Auto fetch tắt",
        form.autoPublish ? "Auto publish bật" : "Auto publish tắt",
        form.discoveryProvider ? `Provider: ${form.discoveryProvider}` : "",
        form.articleGenerationModel
          ? `Model: ${form.articleGenerationModel}`
          : "",
      ],
      visibleActions: [
        "Refresh status",
        "Run pipeline",
        "Lưu settings",
        "Publish drafts",
      ],
      highlights: [
        activeJob?.type ? `Job: ${activeJob.type}` : "",
        articleGenerationGateway?.status
          ? `Gateway: ${articleGenerationGateway.status}`
          : "",
      ],
      metrics: [
        `Pending candidates: ${pendingCandidatesCount}`,
        `Draft ngoài mạng: ${draftArticlesCount}`,
        `Draft AI: ${generatedDraftArticlesCount}`,
        `Recent jobs: ${recentJobs.length}`,
      ],
    }),
    [
      form.enabled,
      form.autoPublish,
      form.discoveryProvider,
      form.articleGenerationModel,
      activeJob?.type,
      articleGenerationGateway?.status,
      pendingCandidatesCount,
      draftArticlesCount,
      generatedDraftArticlesCount,
      recentJobs.length,
    ],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      discoveryProvider: (nextValue) => {
        setForm((prev) => ({ ...prev, discoveryProvider: String(nextValue || "auto") }));
      },
      articleGenerationModel: (nextValue) => {
        setForm((prev) => ({
          ...prev,
          articleGenerationModel: String(nextValue || ""),
        }));
      },
      autoPublish: (nextValue) => {
        setForm((prev) => ({ ...prev, autoPublish: Boolean(nextValue) }));
      },
      enabled: (nextValue) => {
        setForm((prev) => ({ ...prev, enabled: Boolean(nextValue) }));
      },
      search: (nextValue) => {
        setForm((prev) => ({ ...prev, mainKeywords: String(nextValue || "") }));
      },
    }),
    [],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: ["set_page_state", "prefill_text", "focus_element", "navigate"],
    actionHandlers: chatBotActionHandlers,
  });

  const refreshAll = () => {
    refetchSettings();
    refetchCandidates();
    refetchDraftArticles();
    refetchGeneratedDraftArticles();
    refetchJobMonitor();
  };

  const onChange = (field) => (event) => {
    const value = event?.target?.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSwitch = (field) => (_event, checked) => {
    setForm((prev) => ({ ...prev, [field]: checked }));
  };

  const handleSave = async () => {
    try {
      const payload = {
        enabled: !!form.enabled,
        autoPublish: !!form.autoPublish,
        imageSearchEnabled: !!form.imageSearchEnabled,
        imageFallbackEnabled: !!form.imageFallbackEnabled,
        intervalMinutes: Number(form.intervalMinutes) || 180,
        minAiScore: Math.max(0, Math.min(1, Number(form.minAiScore) || 0)),
        reviewPassScore: Math.max(
          0,
          Math.min(1, Number(form.reviewPassScore) || 0),
        ),
        maxArticlesPerRun: Math.max(1, Number(form.maxArticlesPerRun) || 1),
        maxArticlesPerDay: Math.max(1, Number(form.maxArticlesPerDay) || 1),
        targetArticlesPerDay: Math.max(
          1,
          Number(form.targetArticlesPerDay) || 1,
        ),
        discoveryProvider: form.discoveryProvider,
        articleGenerationModel: String(form.articleGenerationModel || "").trim(),
        mainKeywords: parseCsv(form.mainKeywords),
        extraKeywords: parseCsv(form.extraKeywords),
        allowedDomains: parseCsv(form.allowedDomains),
        blockedDomains: parseCsv(form.blockedDomains),
        competitorDomains: parseCsv(form.competitorDomains),
        competitorKeywords: parseCsv(form.competitorKeywords),
      };

      await updateSettings(payload).unwrap();
      setMessage({ type: "success", text: "Saved settings" });
      refetchSettings();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || "Save failed",
      });
    }
  };

  const queueWorkerJob = async ({
    type,
    successText,
    body = {},
    emptyGuard,
  }) => {
    if (emptyGuard) {
      const guardMessage = emptyGuard();
      if (guardMessage) {
        setMessage({ type: "info", text: guardMessage });
        return;
      }
    }

    try {
      const result = await queueSeoNewsJob({
        type,
        ...body,
      }).unwrap();
      setMessage({
        type: "success",
        text: `${successText}: ${result?.job?.id || ""}`.trim(),
      });
      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || "Queue job failed",
      });
    }
  };

  const handleRunNow = async () => {
    await queueWorkerJob({
      type: "pipeline",
      successText: "Queued pipeline job",
      body: {
        discoveryMode: form.discoveryProvider,
        rounds: 1,
      },
    });
  };

  const handleRunPendingCandidates = async () => {
    await queueWorkerJob({
      type: "pending_candidates",
      successText: "Queued pending candidates job",
      body: {
        limit: pendingCandidatesCount,
      },
      emptyGuard: () =>
        pendingCandidatesCount ? "" : "No pending candidates to run",
    });
  };

  const publishDraftBatch = async ({
    origin,
    onlyCrawled,
    draftCount,
    emptyMessage,
    successPrefix,
    failedMessage,
  }) => {
    if (!draftCount) {
      setMessage({ type: "info", text: emptyMessage });
      return;
    }

    try {
      const result = await pushSeoNewsDrafts({
        limit: Math.min(100, draftCount),
        origin,
        onlyCrawled,
      }).unwrap();

      const pushed = Number(result?.pushed) || 0;
      const skipped = Number(result?.skipped) || 0;

      setMessage({
        type: pushed > 0 ? "success" : "info",
        text:
          pushed > 0
            ? successPrefix + ": " + pushed + ", skipped: " + skipped
            : skipped > 0
              ? "No draft passed filters. Skipped: " + skipped
              : emptyMessage,
      });

      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || failedMessage,
      });
    }
  };

  const publishAllDraftBatches = async ({
    origin,
    onlyCrawled,
    setLoading,
    successPrefix,
    emptyMessage,
    failedMessage,
  }) => {
    try {
      setLoading(true);

      let totalPushed = 0;
      let totalSkipped = 0;
      const maxRounds = 40;
      const batchSize = 100;

      for (let i = 0; i < maxRounds; i += 1) {
        const result = await pushSeoNewsDrafts({
          limit: batchSize,
          origin,
          onlyCrawled,
        }).unwrap();

        const pushed = Number(result?.pushed) || 0;
        const skipped = Number(result?.skipped) || 0;
        totalPushed += pushed;
        totalSkipped += skipped;

        if (!pushed || pushed < batchSize) {
          break;
        }
      }

      setMessage({
        type: totalPushed > 0 ? "success" : "info",
        text:
          totalPushed > 0
            ? successPrefix + ": " + totalPushed + ", skipped: " + totalSkipped
            : totalSkipped > 0
              ? "No draft passed filters. Skipped: " + totalSkipped
              : emptyMessage,
      });

      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || failedMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePushDraftsToNews = async () => {
    await publishDraftBatch({
      origin: "external",
      onlyCrawled: true,
      draftCount: draftArticlesCount,
      emptyMessage: "No draft crawled articles to publish",
      successPrefix: "Published crawled drafts",
      failedMessage: "Publish crawled drafts failed",
    });
  };

  const handleFetchMoreArticles = async (rounds = 1) => {
    await queueWorkerJob({
      type: "pipeline",
      successText: `Queued fetch job (${Math.min(
        Math.max(Number(rounds) || 1, 1),
        6,
      )} round)`,
      body: {
        discoveryMode: form.discoveryProvider,
        rounds,
      },
    });
  };

  const handleCreateReadyArticles = async (count = 3) => {
    await queueWorkerJob({
      type: "create_ready_articles",
      successText: "Queued create ready AI posts job",
      body: {
        count,
        forcePublish: true,
      },
    });
  };

  const handlePublishAllDrafts = async () => {
    if (publishingAllDrafts) return;

    await publishAllDraftBatches({
      origin: "external",
      onlyCrawled: true,
      setLoading: setPublishingAllDrafts,
      successPrefix: "Published all crawled drafts",
      emptyMessage: "No draft crawled articles to publish",
      failedMessage: "Publish all crawled drafts failed",
    });
  };

  const handlePushGeneratedDraftsToNews = async () => {
    await publishDraftBatch({
      origin: "generated",
      onlyCrawled: false,
      draftCount: generatedDraftArticlesCount,
      emptyMessage: "No draft AI articles to publish",
      successPrefix: "Published AI drafts",
      failedMessage: "Publish AI drafts failed",
    });
  };

  const handlePublishAllGeneratedDrafts = async () => {
    if (publishingAllGeneratedDrafts) return;

    await publishAllDraftBatches({
      origin: "generated",
      onlyCrawled: false,
      setLoading: setPublishingAllGeneratedDrafts,
      successPrefix: "Published all AI drafts",
      emptyMessage: "No draft AI articles to publish",
      failedMessage: "Publish all AI drafts failed",
    });
  };

  const publishingBusy =
    pushingDrafts || publishingAllDrafts || publishingAllGeneratedDrafts;

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
        News Management
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Settings and pipeline control for AI News module.
      </Typography>

      {message.text ? (
        <Alert
          severity={message.type}
          sx={{ mb: 2 }}
          onClose={() => setMessage({ type: "success", text: "" })}
        >
          {message.text}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Auto Fetch Status
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1 }}
        >
          <Chip
            size="small"
            label={`Auto: ${form.enabled ? "ON" : "OFF"}`}
            color={form.enabled ? "success" : "default"}
          />
          <Chip
            size="small"
            label={`Cron: ${settings?.cronStatus || "idle"}`}
            color={
              settings?.cronStatus === "running"
                ? "warning"
                : settings?.cronStatus === "success"
                  ? "success"
                  : settings?.cronStatus === "error"
                    ? "error"
                    : "default"
            }
          />
          <Chip
            size="small"
            label={`Interval: ${Number(form.intervalMinutes) || 180}m`}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Today: ${Number(settings?.todayArticlesCount) || 0}`}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Missing target: ${Number(settings?.missingToTarget) || 0}`}
            color={
              Number(settings?.missingToTarget) > 0 ? "warning" : "success"
            }
            variant={
              Number(settings?.missingToTarget) > 0 ? "filled" : "outlined"
            }
          />
          <Chip
            size="small"
            label={`Next: ${formatDateTime(settings?.nextCronRunAt)}`}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Last run: ${formatDateTime(settings?.lastCronRunAt)}`}
            variant="outlined"
          />
          <Chip
            size="small"
            label={`Last success: ${formatDateTime(settings?.lastCronSuccessAt)}`}
            variant="outlined"
          />
        </Stack>
        {settings?.lastCronError ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {settings.lastCronError}
          </Alert>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Cách hoạt động
        </Typography>
        <Stack spacing={1.5}>
          <Alert severity="info">
            <strong>Bài ngoài mạng</strong>: hệ thống dùng Discovery provider +
            keywords + domain filter để tìm URL bài viết trên internet, sau đó
            crawl nội dung thật từ chính URL đó.
          </Alert>
          <Alert severity="success">
            <strong>Bài AI tự viết</strong>: hệ thống không lấy từ báo ngoài, mà
            tự tạo bài evergreen bằng gateway AI ở phần Article Generation
            Gateway.
          </Alert>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={0.75}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Bấm nút nào khi cần:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                `Chạy full pipeline`: tìm bài ngoài mạng, crawl, và nếu thiếu
                target trong ngày thì có thể gen thêm bài AI.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                `Tìm bài ngoài mạng`: chạy 1 round tìm URL và crawl bài ngoài
                mạng.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                `Tìm bài ngoài mạng x3`: chạy tối đa 3 round liên tiếp để tìm
                thêm bài ngoài mạng.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                `Xử lý link pending`: chỉ xử lý các link đã tìm thấy trước đó
                đang ở trạng thái pending.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                `Tạo 3 bài AI sẵn sàng`: chỉ tạo bài AI evergreen, không tìm bài
                ngoài mạng.
              </Typography>
            </Stack>
          </Paper>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", md: "center" }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Article Generation Gateway
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Gateway riêng cho luồng tạo bài AI evergreen của SEO News.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              label={`Status: ${articleGenerationGateway?.status || "unknown"}`}
              color={getGatewayChipColor(articleGenerationGateway?.status)}
            />
            <Chip
              size="small"
              label={`Source: ${formatGatewaySource(
                articleGenerationGateway?.source,
              )}`}
              variant="outlined"
            />
            <Chip
              size="small"
              label={`API key: ${
                articleGenerationGateway?.apiKeyConfigured ? "configured" : "missing"
              }`}
              color={
                articleGenerationGateway?.apiKeyConfigured ? "success" : "default"
              }
              variant={
                articleGenerationGateway?.apiKeyConfigured ? "filled" : "outlined"
              }
            />
            <Chip
              size="small"
              label={`Models: ${Number(articleGenerationGateway?.modelCount) || 0}`}
              variant="outlined"
            />
            <Chip
              size="small"
              label={`Effective model: ${
                articleGenerationGateway?.effectiveModel || "-"
              }`}
              color="success"
              variant="outlined"
            />
            {articleGenerationGateway?.selectedModel ? (
              <Chip
                size="small"
                label={`Configured model: ${articleGenerationGateway.selectedModel}`}
                color={
                  articleGenerationGateway?.selectedModelAvailable === false
                    ? "warning"
                    : "default"
                }
                variant={
                  articleGenerationGateway?.selectedModelAvailable === false
                    ? "filled"
                    : "outlined"
                }
              />
            ) : null}
            {!articleGenerationGateway?.selectedModel &&
            Number(articleGenerationGateway?.modelCount) > 0 &&
            articleGenerationGateway?.effectiveModel ? (
              <Chip
                size="small"
                label="Model auto-selected from /models"
                color="success"
                variant="filled"
              />
            ) : null}
          </Stack>
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="Connection URL"
            value={articleGenerationGateway?.responsesUrl || ""}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Models URL"
            value={articleGenerationGateway?.modelsUrl || ""}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
          />
        </Stack>

        <FormControl size="small" fullWidth sx={{ mt: 2 }}>
          <InputLabel id="article-generation-model-label">
            Article model
          </InputLabel>
          <Select
            labelId="article-generation-model-label"
            value={form.articleGenerationModel}
            label="Article model"
            onChange={onChange("articleGenerationModel")}
          >
            <MenuItem value="">Auto (first model from /models)</MenuItem>
            {(articleGenerationGateway?.availableModels || []).map((modelId) => (
              <MenuItem key={modelId} value={modelId}>
                {modelId}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {articleGenerationGateway?.message ? (
          <Alert
            severity={getGatewayAlertSeverity(articleGenerationGateway?.status)}
            sx={{ mt: 1.5 }}
          >
            {articleGenerationGateway.message}
          </Alert>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        {loadingSettings ? (
          <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.enabled}
                    onChange={onSwitch("enabled")}
                  />
                }
                label="Enabled"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.autoPublish}
                    onChange={onSwitch("autoPublish")}
                  />
                }
                label="Auto publish"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.imageSearchEnabled}
                    onChange={onSwitch("imageSearchEnabled")}
                  />
                }
                label="Search external images"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={!!form.imageFallbackEnabled}
                    onChange={onSwitch("imageFallbackEnabled")}
                  />
                }
                label="AI cover for generated articles"
              />

              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="provider-label">Discovery</InputLabel>
                <Select
                  labelId="provider-label"
                  value={form.discoveryProvider}
                  label="Discovery"
                  onChange={onChange("discoveryProvider")}
                >
                  <MenuItem value="auto">Auto</MenuItem>
                  <MenuItem value="gemini">Gemini</MenuItem>
                  <MenuItem value="openai">OpenAI</MenuItem>
                </Select>
              </FormControl>
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Interval (minutes)"
                type="number"
                value={form.intervalMinutes}
                onChange={onChange("intervalMinutes")}
                size="small"
                fullWidth
              />
              <TextField
                label="Min AI score"
                type="number"
                inputProps={{ step: 0.01, min: 0, max: 1 }}
                value={form.minAiScore}
                onChange={onChange("minAiScore")}
                size="small"
                fullWidth
              />
              <TextField
                label="Review pass score"
                type="number"
                inputProps={{ step: 0.01, min: 0, max: 1 }}
                value={form.reviewPassScore}
                onChange={onChange("reviewPassScore")}
                size="small"
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Max per run"
                type="number"
                value={form.maxArticlesPerRun}
                onChange={onChange("maxArticlesPerRun")}
                size="small"
                fullWidth
              />
              <TextField
                label="Max per day"
                type="number"
                value={form.maxArticlesPerDay}
                onChange={onChange("maxArticlesPerDay")}
                size="small"
                fullWidth
              />
              <TextField
                label="Target per day"
                type="number"
                value={form.targetArticlesPerDay}
                onChange={onChange("targetArticlesPerDay")}
                size="small"
                fullWidth
              />
            </Stack>

            <TextField
              label="Main keywords (comma separated)"
              value={form.mainKeywords}
              onChange={onChange("mainKeywords")}
              size="small"
              fullWidth
            />
            <TextField
              label="Extra keywords (comma separated)"
              value={form.extraKeywords}
              onChange={onChange("extraKeywords")}
              size="small"
              fullWidth
            />
            <TextField
              label="Allowed domains (comma separated)"
              value={form.allowedDomains}
              onChange={onChange("allowedDomains")}
              size="small"
              fullWidth
            />
            <TextField
              label="Blocked domains (comma separated)"
              value={form.blockedDomains}
              onChange={onChange("blockedDomains")}
              size="small"
              fullWidth
            />
            <TextField
              label="Competitor domains (comma separated)"
              value={form.competitorDomains}
              onChange={onChange("competitorDomains")}
              size="small"
              fullWidth
            />
            <TextField
              label="Competitor keywords (comma separated)"
              value={form.competitorKeywords}
              onChange={onChange("competitorKeywords")}
              size="small"
              fullWidth
            />

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              useFlexGap
              flexWrap="wrap"
            >
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                disabled={!canSave || savingSettings}
                onClick={handleSave}
              >
                Save
              </Button>
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={queueingJob}
                onClick={handleRunNow}
              >
                Chạy full pipeline
              </Button>
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={queueingJob}
                onClick={() => handleFetchMoreArticles(1)}
              >
                Tìm bài ngoài mạng
              </Button>
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={queueingJob}
                onClick={() => handleFetchMoreArticles(3)}
              >
                Tìm bài ngoài mạng x3
              </Button>
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                disabled={queueingJob}
                onClick={() => handleCreateReadyArticles(3)}
              >
                Tạo 3 bài AI sẵn sàng
              </Button>
              <Button
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={refreshAll}
              >
                Tải lại
              </Button>
            </Stack>

            <Alert severity="info">
              Discovery chỉ ảnh hưởng đến luồng tìm bài ngoài mạng. Nếu bạn muốn
              hệ thống tự viết bài mới bằng AI, dùng nút `Tạo 3 bài AI sẵn
              sàng`. Nếu muốn chạy cả hai luồng, dùng `Chạy full pipeline`.
            </Alert>
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Worker lấy bài
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Các thao tác fetch/generate bài manual sẽ chạy nền và lưu job vào DB.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`Queued: ${Number(jobSummary.queued) || 0}`} />
            <Chip label={`Running: ${Number(jobSummary.running) || 0}`} />
            <Chip label={`Completed: ${Number(jobSummary.completed) || 0}`} />
            <Chip
              label={`Failed: ${Number(jobSummary.failed) || 0}`}
              color={Number(jobSummary.failed) > 0 ? "warning" : "default"}
            />
            {loadingJobMonitor ? <CircularProgress size={18} /> : null}
          </Stack>
        </Stack>

        {activeJob ? (
          <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
            <Stack spacing={1}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={1}
              >
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    Job đang chạy: {formatPipelineJobType(activeJob.type)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {activeJob.currentStep?.label || "Dang cho worker xu ly"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    label={activeJob.status}
                    color={activeJob.status === "running" ? "primary" : "default"}
                  />
                  <Chip
                    size="small"
                    label={`${activeJob.completedSteps}/${activeJob.totalSteps} xong`}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={`Progress: ${activeJob.progressPercent || 0}%`}
                    variant="outlined"
                  />
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`External: ${
                    Number(activeJob.summary?.externalGenerated) || 0
                  }`}
                />
                <Chip
                  size="small"
                  label={`Generated: ${
                    Number(activeJob.summary?.evergreenGenerated) || 0
                  }`}
                />
                <Chip
                  size="small"
                  label={`Published: ${Number(activeJob.summary?.published) || 0}`}
                />
                <Chip
                  size="small"
                  label={`Draft: ${Number(activeJob.summary?.draft) || 0}`}
                />
                <Chip
                  size="small"
                  label={`Failed: ${Number(activeJob.summary?.failed) || 0}`}
                  color={
                    Number(activeJob.summary?.failed) > 0 ? "warning" : "default"
                  }
                />
              </Stack>

              <Stack spacing={1}>
                {(activeJob.steps || []).map((step) => (
                  <Paper
                    key={`${activeJob.id}-${step.index}`}
                    variant="outlined"
                    sx={{ p: 1 }}
                  >
                    <Stack spacing={0.5}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {step.label}
                        </Typography>
                        <Chip size="small" label={step.status} />
                      </Stack>
                      {step.message ? (
                        <Typography variant="caption" color="text.secondary">
                          {step.message}
                        </Typography>
                      ) : null}
                      {step.error ? (
                        <Typography variant="caption" color="error.main">
                          {step.error}
                        </Typography>
                      ) : null}
                      {getStepSummary(step.result) ? (
                        <Stack
                          direction="row"
                          spacing={1}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Chip
                            size="small"
                            label={`External: ${
                              getStepSummary(step.result)?.externalGenerated || 0
                            }`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Generated: ${
                              getStepSummary(step.result)?.evergreenGenerated || 0
                            }`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Published: ${
                              getStepSummary(step.result)?.published || 0
                            }`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Draft: ${
                              getStepSummary(step.result)?.draft || 0
                            }`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Failed: ${
                              getStepSummary(step.result)?.failed || 0
                            }`}
                            variant="outlined"
                          />
                        </Stack>
                      ) : null}
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </Paper>
        ) : (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Chưa có job worker SEO News nào đang chạy.
          </Alert>
        )}

        {recentJobs.length ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Job gần đây
            </Typography>
            {recentJobs.map((job) => (
              <Paper key={job.id} variant="outlined" sx={{ p: 1.25 }}>
                <Stack spacing={0.75}>
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {formatPipelineJobType(job.type)}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={job.status} />
                      <Chip
                        size="small"
                        label={`${job.completedSteps}/${job.totalSteps} xong`}
                        variant="outlined"
                      />
                      <Chip
                        size="small"
                        label={formatDateTime(job.createdAt)}
                        variant="outlined"
                      />
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={`External: ${
                        Number(job.summary?.externalGenerated) || 0
                      }`}
                    />
                    <Chip
                      size="small"
                      label={`Generated: ${
                        Number(job.summary?.evergreenGenerated) || 0
                      }`}
                    />
                    <Chip
                      size="small"
                      label={`Published: ${Number(job.summary?.published) || 0}`}
                    />
                    <Chip
                      size="small"
                      label={`Draft: ${Number(job.summary?.draft) || 0}`}
                    />
                    <Chip
                      size="small"
                      label={`Failed: ${Number(job.summary?.failed) || 0}`}
                      color={
                        Number(job.summary?.failed) > 0 ? "warning" : "default"
                      }
                    />
                  </Stack>
                  {job.lastError ? (
                    <Typography variant="caption" color="error.main">
                      {job.lastError}
                    </Typography>
                  ) : null}
                  <Stack spacing={0.5}>
                    {(job.steps || []).map((step) => (
                      <Typography
                        key={`${job.id}-${step.index}`}
                        variant="caption"
                        color={
                          step.status === "failed"
                            ? "error.main"
                            : "text.secondary"
                        }
                      >
                        {step.label}: {step.status}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Link tìm được từ internet
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
          >
            <Chip
              size="small"
              label={`Pending: ${pendingCandidatesCount}`}
              color={pendingCandidatesCount > 0 ? "warning" : "default"}
              variant={pendingCandidatesCount > 0 ? "filled" : "outlined"}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={() => handleFetchMoreArticles(1)}
              disabled={queueingJob}
            >
              Tìm thêm URL
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handleRunPendingCandidates}
              disabled={queueingJob || pendingCandidatesCount === 0}
            >
              Xử lý link pending
            </Button>
            {loadingCandidates || queueingJob ? (
              <CircularProgress size={18} />
            ) : null}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Alert severity="info" sx={{ mb: 1.5 }}>
          Đây là danh sách URL tìm được từ internet. Ở bước này hệ thống mới
          tìm thấy link và đưa vào hàng chờ crawl/review.
        </Alert>

        {!loadingCandidates && (!candidates || candidates.length === 0) ? (
          <Alert severity="info">No candidate links</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {(candidates || []).map((item) => (
            <Paper
              key={item._id || item.url}
              variant="outlined"
              sx={{ p: 1.25 }}
            >
              <Stack spacing={0.75}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, wordBreak: "break-word" }}
                >
                  {item.title || item.url}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ wordBreak: "break-word" }}
                >
                  {item.url}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={item.status || "pending"} />
                  <Chip size="small" label={`score: ${item.score ?? "-"}`} />
                  <Chip
                    size="small"
                    label={formatDateTime(item.createdAt)}
                    variant="outlined"
                  />
                </Stack>
                {item.lastError ? (
                  <Typography variant="caption" color="error.main">
                    {item.lastError}
                  </Typography>
                ) : null}
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Bài đã crawl từ link ngoài
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
          >
            <Chip
              size="small"
              label={`Drafts: ${draftArticlesCount}`}
              color={draftArticlesCount > 0 ? "warning" : "default"}
              variant={draftArticlesCount > 0 ? "filled" : "outlined"}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handlePushDraftsToNews}
              disabled={publishingBusy || draftArticlesCount === 0}
            >
              Publish 20
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handlePublishAllDrafts}
              disabled={publishingBusy || draftArticlesCount === 0}
            >
              Publish all
            </Button>
            {loadingDraftArticles || publishingBusy ? (
              <CircularProgress size={18} />
            ) : null}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Alert severity="info" sx={{ mb: 1.5 }}>
          Đây là bài được tạo sau khi hệ thống đã crawl nội dung thật từ các URL
          ngoài mạng.
        </Alert>

        {!loadingDraftArticles && draftArticles.length === 0 ? (
          <Alert severity="info">No draft crawled articles</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {draftArticles.map((item) => (
            <Paper
              key={item._id || item.slug}
              variant="outlined"
              sx={{ p: 1.25 }}
            >
              <Stack spacing={0.75}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, wordBreak: "break-word" }}
                >
                  {item.title || item.slug}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ wordBreak: "break-word" }}
                >
                  {item.sourceUrl || item.slug}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={item.status || "draft"} />
                  <Chip
                    size="small"
                    label={item.origin || "external"}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={`review: ${item?.review?.status || "pending"}`}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={formatDateTime(item.createdAt)}
                    variant="outlined"
                  />
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Bài AI tự viết
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
          >
            <Chip
              size="small"
              label={"AI drafts: " + generatedDraftArticlesCount}
              color={generatedDraftArticlesCount > 0 ? "warning" : "default"}
              variant={generatedDraftArticlesCount > 0 ? "filled" : "outlined"}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handlePushGeneratedDraftsToNews}
              disabled={publishingBusy || generatedDraftArticlesCount === 0}
            >
              Publish AI 20
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handlePublishAllGeneratedDrafts}
              disabled={publishingBusy || generatedDraftArticlesCount === 0}
            >
              Publish AI all
            </Button>
            {loadingGeneratedDraftArticles || publishingBusy ? (
              <CircularProgress size={18} />
            ) : null}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Alert severity="info" sx={{ mb: 1.5 }}>
          Đây là bài evergreen do AI tự viết. Nhóm này không crawl từ bài báo
          ngoài.
        </Alert>

        {!loadingGeneratedDraftArticles &&
        generatedDraftArticles.length === 0 ? (
          <Alert severity="info">No draft AI articles</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {generatedDraftArticles.map((item) => (
            <Paper
              key={item._id || item.slug}
              variant="outlined"
              sx={{ p: 1.25 }}
            >
              <Stack spacing={0.75}>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, wordBreak: "break-word" }}
                >
                  {item.title || item.slug}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ wordBreak: "break-word" }}
                >
                  {item.sourceUrl || "PickleTour AI"}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={item.status || "draft"} />
                  <Chip
                    size="small"
                    label={item.origin || "generated"}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={"review: " + (item?.review?.status || "pending")}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={formatDateTime(item.createdAt)}
                    variant="outlined"
                  />
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}
