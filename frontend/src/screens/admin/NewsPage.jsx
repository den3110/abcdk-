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
  useCreateSeoNewsReadyArticlesMutation,
  useGetSeoNewsArticlesQuery,
  useGetSeoNewsCandidatesQuery,
  useGetSeoNewsSettingsQuery,
  usePushSeoNewsDraftsMutation,
  useRunSeoNewsPendingCandidatesMutation,
  useRunSeoNewsSyncMutation,
  useUpdateSeoNewsSettingsMutation,
} from "../../slices/adminApiSlice";

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
  const [runSync, { isLoading: runningSync }] = useRunSeoNewsSyncMutation();
  const [createSeoNewsReadyArticles, { isLoading: creatingReadyArticles }] =
    useCreateSeoNewsReadyArticlesMutation();
  const [runPendingCandidates, { isLoading: runningPendingCandidates }] =
    useRunSeoNewsPendingCandidatesMutation();
  const [pushSeoNewsDrafts, { isLoading: pushingDrafts }] =
    usePushSeoNewsDraftsMutation();

  const [form, setForm] = useState(DEFAULT_FORM);
  const [runResult, setRunResult] = useState(null);
  const [message, setMessage] = useState({ type: "success", text: "" });
  const [fetchingMore, setFetchingMore] = useState(false);
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
    () => (candidates || []).filter((item) => item?.status === "pending").length,
    [candidates]
  );

  const draftArticles = useMemo(() => {
    if (Array.isArray(draftArticlesData)) return draftArticlesData;
    if (Array.isArray(draftArticlesData?.items)) return draftArticlesData.items;
    return [];
  }, [draftArticlesData]);
  const generatedDraftArticles = useMemo(() => {
    if (Array.isArray(generatedDraftArticlesData)) return generatedDraftArticlesData;
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

  const refreshAll = () => {
    refetchSettings();
    refetchCandidates();
    refetchDraftArticles();
    refetchGeneratedDraftArticles();
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
          Math.min(1, Number(form.reviewPassScore) || 0)
        ),
        maxArticlesPerRun: Math.max(1, Number(form.maxArticlesPerRun) || 1),
        maxArticlesPerDay: Math.max(1, Number(form.maxArticlesPerDay) || 1),
        targetArticlesPerDay: Math.max(
          1,
          Number(form.targetArticlesPerDay) || 1
        ),
        discoveryProvider: form.discoveryProvider,
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

  const handleRunNow = async () => {
    try {
      const result = await runSync({
        discoveryMode: form.discoveryProvider,
      }).unwrap();
      setRunResult(result);
      setMessage({ type: "success", text: "Pipeline run completed" });
      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || "Run failed",
      });
    }
  };

  const handleRunPendingCandidates = async () => {
    if (!pendingCandidatesCount) {
      setMessage({ type: "info", text: "No pending candidates to run" });
      return;
    }

    try {
      const result = await runPendingCandidates({
        limit: pendingCandidatesCount,
      }).unwrap();
      setRunResult(result);
      setMessage({
        type: "success",
        text: `Processed pending candidates: ${result?.processedLimit || 0}`,
      });
      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error?.data?.message ||
          error?.error ||
          "Run pending candidates failed",
      });
    }
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
    if (fetchingMore) return;

    try {
      setFetchingMore(true);
      let external = 0;
      let generated = 0;
      let published = 0;
      let draft = 0;
      let roundsDone = 0;
      let lastResult = null;

      const totalRounds = Math.min(Math.max(Number(rounds) || 1, 1), 6);

      for (let i = 0; i < totalRounds; i += 1) {
        const result = await runSync({
          discoveryMode: form.discoveryProvider,
        }).unwrap();

        lastResult = result;
        roundsDone += 1;
        external += Number(result?.stats?.externalGenerated) || 0;
        generated += Number(result?.stats?.evergreenGenerated) || 0;
        published += Number(result?.stats?.published) || 0;
        draft += Number(result?.stats?.draft) || 0;

        const producedThisRound =
          (Number(result?.stats?.externalGenerated) || 0) +
          (Number(result?.stats?.evergreenGenerated) || 0);

        if (!producedThisRound && i > 0) {
          break;
        }
      }

      if (lastResult) {
        setRunResult(lastResult);
      }

      setMessage({
        type: "success",
        text: `Fetch done (${roundsDone} round): external ${external}, generated ${generated}, published ${published}, draft ${draft}`,
      });
      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.data?.message || error?.error || "Fetch more failed",
      });
    } finally {
      setFetchingMore(false);
    }
  };

  const handleCreateReadyArticles = async (count = 3) => {
    try {
      const result = await createSeoNewsReadyArticles({
        count,
        forcePublish: true,
      }).unwrap();

      setRunResult({
        stats: {
          externalGenerated: 0,
          evergreenGenerated: Number(result?.generated) || 0,
          reviewPassed: Number(result?.reviewPassed) || 0,
          reviewFailed: Number(result?.reviewFailed) || 0,
          published: Number(result?.published) || 0,
          draft: Number(result?.draft) || 0,
        },
        generation: result,
      });
      setMessage({
        type: "success",
        text: `Created ready AI articles: ${result?.generated || 0}, published: ${
          result?.published || 0
        }, draft: ${result?.draft || 0}`,
      });
      refreshAll();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error?.data?.message ||
          error?.error ||
          "Create ready AI articles failed",
      });
    }
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
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
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
            color={Number(settings?.missingToTarget) > 0 ? "warning" : "success"}
            variant={Number(settings?.missingToTarget) > 0 ? "filled" : "outlined"}
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
        {loadingSettings ? (
          <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch checked={!!form.enabled} onChange={onSwitch("enabled")} />
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
                disabled={runningSync}
                onClick={handleRunNow}
              >
                Run now
              </Button>
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={runningSync || fetchingMore}
                onClick={() => handleFetchMoreArticles(1)}
              >
                Fetch More
              </Button>
              <Button
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={runningSync || fetchingMore}
                onClick={() => handleFetchMoreArticles(3)}
              >
                Fetch x3
              </Button>
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                disabled={creatingReadyArticles}
                onClick={() => handleCreateReadyArticles(3)}
              >
                Create 3 Ready AI Posts
              </Button>
              <Button
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={refreshAll}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>

      {runResult ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Last run summary
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`External: ${runResult?.stats?.externalGenerated || 0}`} />
            <Chip label={`Generated: ${runResult?.stats?.evergreenGenerated || 0}`} />
            <Chip label={`Passed: ${runResult?.stats?.reviewPassed || 0}`} color="success" />
            <Chip label={`Failed: ${runResult?.stats?.reviewFailed || 0}`} color="warning" />
            <Chip label={`Published: ${runResult?.stats?.published || 0}`} color="primary" />
            <Chip label={`Draft: ${runResult?.stats?.draft || 0}`} />
            <Chip
              label={`Competitor blocked: ${
                runResult?.crawl?.errorsByType?.COMPETITOR_BLOCKED || 0
              }`}
              color="warning"
              variant="outlined"
            />
          </Stack>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Link Candidates
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
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
              disabled={runningSync || fetchingMore}
            >
              Fetch more
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              onClick={handleRunPendingCandidates}
              disabled={runningPendingCandidates || pendingCandidatesCount === 0}
            >
              Run pending
            </Button>
            {loadingCandidates || runningPendingCandidates ? (
              <CircularProgress size={18} />
            ) : null}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        {!loadingCandidates && (!candidates || candidates.length === 0) ? (
          <Alert severity="info">No candidate links</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {(candidates || []).map((item) => (
            <Paper key={item._id || item.url} variant="outlined" sx={{ p: 1.25 }}>
              <Stack spacing={0.75}>
                <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: "break-word" }}>
                  {item.title || item.url}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
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
            Draft Articles (Crawled)
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
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
            {loadingDraftArticles || publishingBusy ? <CircularProgress size={18} /> : null}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        {!loadingDraftArticles && draftArticles.length === 0 ? (
          <Alert severity="info">No draft crawled articles</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {draftArticles.map((item) => (
            <Paper key={item._id || item.slug} variant="outlined" sx={{ p: 1.25 }}>
              <Stack spacing={0.75}>
                <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: "break-word" }}>
                  {item.title || item.slug}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                  {item.sourceUrl || item.slug}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={item.status || "draft"} />
                  <Chip size="small" label={item.origin || "external"} variant="outlined" />
                  <Chip size="small" label={`review: ${item?.review?.status || "pending"}`} variant="outlined" />
                  <Chip size="small" label={formatDateTime(item.createdAt)} variant="outlined" />
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
            Draft Articles (AI Generated)
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
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

        {!loadingGeneratedDraftArticles && generatedDraftArticles.length === 0 ? (
          <Alert severity="info">No draft AI articles</Alert>
        ) : null}

        <Stack spacing={1.25}>
          {generatedDraftArticles.map((item) => (
            <Paper key={item._id || item.slug} variant="outlined" sx={{ p: 1.25 }}>
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
                  <Chip size="small" label={item.origin || "generated"} variant="outlined" />
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
