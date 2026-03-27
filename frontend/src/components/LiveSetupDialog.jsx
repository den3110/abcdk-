/* eslint-disable react/prop-types */
import React from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Stadium as StadiumIcon,
  Movie as MovieIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "react-toastify";
import ResponsiveModal from "./ResponsiveModal";
import {
  useAdminBulkSetCourtLiveConfigMutation,
  useAdminListCourtsByTournamentQuery,
  useAdminSetCourtLiveConfigMutation,
} from "../slices/courtsApiSlice";
import { useAdminListMatchesByTournamentQuery } from "../slices/tournamentsApiSlice";
import {
  useGetTournamentCourtClusterRuntimeQuery,
  useUpdateAdminCourtStationMutation,
} from "../slices/courtClustersAdminApiSlice";

const sid = (value) => String(value?._id || value?.id || value || "").trim();

const normalizeLiveConfig = (config = {}) => ({
  enabled: !!config?.enabled,
  videoUrl: String(config?.videoUrl || "").trim(),
  overrideExisting: !!config?.overrideExisting,
  advancedSettingEnabled:
    typeof config?.advancedSettingEnabled === "boolean"
      ? config.advancedSettingEnabled
      : !!config?.advancedRandomEnabled,
  pageMode:
    String(
      config?.pageMode || config?.randomPageMode || "default",
    ).toLowerCase() === "custom"
      ? "custom"
      : "default",
  pageConnectionId:
    config?.pageConnectionId || config?.randomPageConnectionId || null,
  pageConnectionName:
    config?.pageConnectionName || config?.randomPageConnectionName || "",
  advancedSetting:
    config?.advancedSetting && typeof config.advancedSetting === "object"
      ? config.advancedSetting
      : null,
});

const countByStatus = (matches = []) => {
  let total = matches.length;
  let live = 0;
  let notFinished = 0;
  matches.forEach((match) => {
    const status = String(match?.status || "").toLowerCase();
    if (status === "live") live += 1;
    if (status !== "finished") notFinished += 1;
  });
  return { total, live, notFinished };
};

const mostCommonUrl = (matches = []) => {
  const freq = new Map();
  matches.forEach((match) => {
    const url = String(match?.video || "").trim();
    if (!url) return;
    freq.set(url, (freq.get(url) || 0) + 1);
  });
  if (!freq.size) return "";
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

const fallbackStationCounts = (item) => {
  const queueLength = Array.isArray(item?.queueItems) ? item.queueItems.length : 0;
  const currentCount = item?.currentMatch ? 1 : 0;
  const total = currentCount + queueLength;
  const live = String(item?.status || "").toLowerCase() === "live" ? 1 : 0;
  return {
    total,
    live,
    notFinished: total,
  };
};

const normalizeAllowedClusters = (clusters = []) =>
  (Array.isArray(clusters) ? clusters : [])
    .map((item) => ({
      _id: sid(item),
      name: String(item?.name || "").trim(),
      venueName: String(item?.venueName || "").trim(),
    }))
    .filter((item) => item._id);

const buildLegacyCourtItems = (courtsResp) => {
  const items = Array.isArray(courtsResp)
    ? courtsResp
    : Array.isArray(courtsResp?.items)
      ? courtsResp.items
      : [];
  return items.map((court) => ({
    ...court,
    _id: String(court._id),
    entityType: "court",
    displayLabel:
      court.name ||
      court.label ||
      court.code ||
      (Number.isFinite(court.number)
        ? `Sân ${court.number}`
        : `Sân #${String(court._id).slice(-4)}`),
    liveConfig: normalizeLiveConfig(court.liveConfig),
  }));
};

const buildStationItems = (runtime) =>
  (Array.isArray(runtime?.stations) ? runtime.stations : []).map((station) => ({
    ...station,
    _id: sid(station),
    entityType: "station",
    displayLabel:
      String(station?.name || "").trim() ||
      String(station?.code || "").trim() ||
      `Sân #${sid(station).slice(-4)}`,
    liveConfig: normalizeLiveConfig(station?.liveConfig),
  }));

const getItemMatches = (item, matchesByItemId) =>
  Array.isArray(matchesByItemId.get(item._id)) ? matchesByItemId.get(item._id) : [];

export default function LiveSetupDialog({
  open,
  onClose,
  tournamentId,
  bracketId,
  buildCourtLiveUrl,
  allowedClusters = [],
}) {
  const clusterOptions = React.useMemo(
    () => normalizeAllowedClusters(allowedClusters),
    [allowedClusters],
  );
  const hasClusterMode = clusterOptions.length > 0;

  const [selectedClusterId, setSelectedClusterId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setSelectedClusterId((current) => {
      if (!hasClusterMode) return "";
      if (current && clusterOptions.some((item) => item._id === current)) return current;
      return clusterOptions[0]?._id || "";
    });
  }, [open, hasClusterMode, clusterOptions]);

  const buildLiveUrl = React.useCallback(
    (tid, bid, item) => {
      if (buildCourtLiveUrl) {
        return buildCourtLiveUrl.length >= 3
          ? buildCourtLiveUrl(tid, bid ?? null, item)
          : buildCourtLiveUrl(tid, item);
      }
      if (item?.entityType === "station") return "/live";
      return `/streaming/${item?._id}`;
    },
    [buildCourtLiveUrl],
  );

  const {
    data: courtsResp,
    isLoading: courtsLoading,
    isError: courtsErr,
    refetch: refetchCourts,
  } = useAdminListCourtsByTournamentQuery(
    { tid: tournamentId },
    { skip: !open || !tournamentId || hasClusterMode },
  );

  const {
    data: runtime,
    isLoading: runtimeLoading,
    isFetching: runtimeFetching,
    error: runtimeError,
    refetch: refetchRuntime,
  } = useGetTournamentCourtClusterRuntimeQuery(
    { tournamentId, clusterId: selectedClusterId },
    {
      skip: !open || !tournamentId || !selectedClusterId || !hasClusterMode,
    },
  );

  const {
    data: matchPage,
    isLoading: matchesLoading,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery(
    { tid: tournamentId, page: 1, pageSize: 1000 },
    { skip: !open || !tournamentId },
  );

  React.useEffect(() => {
    if (!open || !tournamentId) return;
    refetchMatches?.();
    if (hasClusterMode) {
      if (selectedClusterId) refetchRuntime?.();
      return;
    }
    refetchCourts?.();
  }, [
    open,
    tournamentId,
    hasClusterMode,
    selectedClusterId,
    refetchMatches,
    refetchRuntime,
    refetchCourts,
  ]);

  const items = React.useMemo(
    () =>
      hasClusterMode
        ? buildStationItems(runtime)
        : buildLegacyCourtItems(courtsResp),
    [hasClusterMode, runtime, courtsResp],
  );

  const matchesAll = React.useMemo(
    () => (Array.isArray(matchPage?.list) ? matchPage.list : []),
    [matchPage],
  );

  const matchesByItemId = React.useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item._id, []));

    matchesAll.forEach((match) => {
      const key = hasClusterMode
        ? sid(match?.courtStationId || match?.courtStation?._id)
        : sid(match?.courtAssigned || match?.assignedCourt || match?.court);
      if (key && map.has(key)) {
        map.get(key).push(match);
      }
    });

    return map;
  }, [items, matchesAll, hasClusterMode]);

  const [form, setForm] = React.useState({});
  const [overrideExisting, setOverrideExisting] = React.useState(false);
  const [busy, setBusy] = React.useState(new Set());
  const initialFormRef = React.useRef({});

  React.useEffect(() => {
    if (!open) return;
    const next = {};
    items.forEach((item) => {
      next[item._id] = {
        enabled: !!item?.liveConfig?.enabled,
        videoUrl: String(item?.liveConfig?.videoUrl || "").trim(),
      };
    });
    setForm(next);
    setOverrideExisting(false);
    initialFormRef.current = next;
  }, [open, items]);

  const [setCourtCfg, { isLoading: savingLegacy }] =
    useAdminSetCourtLiveConfigMutation();
  const [bulkSetCourtCfg, { isLoading: bulkSavingLegacy }] =
    useAdminBulkSetCourtLiveConfigMutation();
  const [updateStation, { isLoading: savingStation }] =
    useUpdateAdminCourtStationMutation();

  const setItemBusy = React.useCallback((itemId, nextBusy) => {
    setBusy((current) => {
      const cloned = new Set(current);
      if (nextBusy) cloned.add(itemId);
      else cloned.delete(itemId);
      return cloned;
    });
  }, []);

  const onChangeItemField = React.useCallback((itemId, patch) => {
    setForm((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] || {}), ...patch },
    }));
  }, []);

  const saveStationLiveConfig = React.useCallback(
    async (item, nextValues) => {
      const nextConfig = {
        ...normalizeLiveConfig(item?.liveConfig),
        enabled: !!nextValues.enabled,
        videoUrl: String(nextValues.videoUrl || "").trim(),
        overrideExisting: !!overrideExisting,
      };
      await updateStation({
        clusterId: selectedClusterId,
        stationId: item._id,
        liveConfig: nextConfig,
      }).unwrap();
      await refetchRuntime?.();
    },
    [overrideExisting, selectedClusterId, updateStation, refetchRuntime],
  );

  const saveLegacyCourtLiveConfig = React.useCallback(
    async (item, nextValues) => {
      await setCourtCfg({
        courtId: item._id,
        enabled: !!nextValues.enabled,
        videoUrl: String(nextValues.videoUrl || "").trim(),
        overrideExisting,
      }).unwrap();
      await refetchCourts?.();
    },
    [overrideExisting, setCourtCfg, refetchCourts],
  );

  const saveItem = React.useCallback(
    async (itemId, valuesOverride = null, options = {}) => {
      const {
        showSuccessToast = true,
        rollbackValues = null,
      } = options;
      const item = items.find((entry) => entry._id === itemId);
      if (!item) return;
      const values = valuesOverride || form[itemId] || {
        enabled: false,
        videoUrl: "",
      };

      setItemBusy(itemId, true);
      try {
        if (hasClusterMode) {
          await saveStationLiveConfig(item, values);
        } else {
          await saveLegacyCourtLiveConfig(item, values);
        }
        if (showSuccessToast) {
          toast.success("Đã lưu cấu hình LIVE cho sân");
        }
        initialFormRef.current = {
          ...initialFormRef.current,
          [itemId]: {
            enabled: !!values.enabled,
            videoUrl: String(values.videoUrl || "").trim(),
          },
        };
      } catch (error) {
        if (rollbackValues) {
          setForm((current) => ({
            ...current,
            [itemId]: rollbackValues,
          }));
        }
        toast.error(error?.data?.message || "Lưu cấu hình LIVE thất bại");
      } finally {
        setItemBusy(itemId, false);
      }
    },
    [
      items,
      form,
      hasClusterMode,
      saveStationLiveConfig,
      saveLegacyCourtLiveConfig,
      setItemBusy,
    ],
  );

  const handleToggleEnabled = React.useCallback(
    async (itemId, checked) => {
      const previousValues = form[itemId] || {
        enabled: false,
        videoUrl: "",
      };
      const nextValues = {
        ...previousValues,
        enabled: checked,
      };
      onChangeItemField(itemId, { enabled: checked });
      await saveItem(itemId, nextValues, {
        showSuccessToast: false,
        rollbackValues: previousValues,
      });
    },
    [form, onChangeItemField, saveItem],
  );

  const saveAll = React.useCallback(async () => {
    const changedItems = items
      .map((item) => {
        const current = form[item._id] || { enabled: false, videoUrl: "" };
        const previous = initialFormRef.current[item._id] || {
          enabled: false,
          videoUrl: "",
        };
        const changed =
          !!current.enabled !== !!previous.enabled ||
          String(current.videoUrl || "").trim() !==
            String(previous.videoUrl || "").trim();
        return changed ? { item, current } : null;
      })
      .filter(Boolean);

    if (!changedItems.length) {
      toast.info("Không có thay đổi nào để lưu.");
      return;
    }

    try {
      if (hasClusterMode) {
        const results = await Promise.allSettled(
          changedItems.map(({ item, current }) =>
            updateStation({
              clusterId: selectedClusterId,
              stationId: item._id,
              liveConfig: {
                ...normalizeLiveConfig(item?.liveConfig),
                enabled: !!current.enabled,
                videoUrl: String(current.videoUrl || "").trim(),
                overrideExisting: !!overrideExisting,
              },
            }).unwrap(),
          ),
        );
        const ok = results.filter((result) => result.status === "fulfilled").length;
        if (!ok) {
          throw new Error("Không lưu được cấu hình LIVE cho sân nào.");
        }
        toast.success(`Đã lưu cấu hình LIVE cho ${ok} sân`);
        await refetchRuntime?.();
      } else {
        const payload = changedItems.map(({ item, current }) => ({
          courtId: item._id,
          enabled: !!current.enabled,
          videoUrl: String(current.videoUrl || "").trim(),
          overrideExisting: !!overrideExisting,
        }));
        await bulkSetCourtCfg({ tid: tournamentId, items: payload }).unwrap();
        toast.success(`Đã lưu cấu hình LIVE cho ${payload.length} sân`);
        await refetchCourts?.();
      }

      const nextSnap = { ...initialFormRef.current };
      changedItems.forEach(({ item, current }) => {
        nextSnap[item._id] = {
          enabled: !!current.enabled,
          videoUrl: String(current.videoUrl || "").trim(),
        };
      });
      initialFormRef.current = nextSnap;
    } catch (error) {
      toast.error(error?.data?.message || error?.message || "Lưu cấu hình LIVE thất bại");
    }
  }, [
    items,
    form,
    hasClusterMode,
    selectedClusterId,
    overrideExisting,
    updateStation,
    refetchRuntime,
    bulkSetCourtCfg,
    tournamentId,
    refetchCourts,
  ]);

  const loadingAny =
    matchesLoading ||
    (hasClusterMode ? runtimeLoading || runtimeFetching : courtsLoading);
  const savingAny = savingLegacy || bulkSavingLegacy || savingStation;

  const renderItemCounts = React.useCallback(
    (item) => {
      const matches = getItemMatches(item, matchesByItemId);
      return matches.length ? countByStatus(matches) : fallbackStationCounts(item);
    },
    [matchesByItemId],
  );

  const renderItemSampleUrl = React.useCallback(
    (item) => {
      const matches = getItemMatches(item, matchesByItemId);
      return (
        mostCommonUrl(matches) ||
        String(item?.currentMatch?.video || "").trim() ||
        String(item?.liveConfig?.videoUrl || "").trim()
      );
    },
    [matchesByItemId],
  );

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="xl"
      icon={<MovieIcon />}
      title="Thiết lập LIVE — Toàn giải"
      paperSx={{
        width: { xs: "100%", sm: "96vw" },
        maxWidth: 1500,
        height: { xs: "100%", md: "90vh" },
      }}
      contentProps={{ sx: { pt: 1 } }}
      actions={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="contained"
            onClick={saveAll}
            startIcon={<MovieIcon />}
            disabled={savingAny || items.length === 0}
          >
            Lưu tất cả sân
          </Button>
        </>
      }
    >
      {loadingAny && <LinearProgress sx={{ mb: 2 }} />}

      <Stack spacing={2}>
        <Alert severity="info">
          {hasClusterMode ? (
            <>
              Cấu hình LIVE theo <b>sân trong cụm sân</b>. Khi trận được gán vào
              sân, cấu hình LIVE mặc định của sân sẽ được áp dụng cho trận đó.
            </>
          ) : (
            <>
              Cấu hình LIVE theo <b>sân legacy</b>. Khi trọng tài bắt đầu trận
              hoặc server áp dụng, URL LIVE mặc định của sân sẽ được gán cho
              trận thuộc sân đó.
            </>
          )}
        </Alert>

        {hasClusterMode && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6">Cụm sân đang dùng cho LIVE</Typography>
              <TextField
                select
                label="Cụm sân"
                value={selectedClusterId}
                onChange={(event) => setSelectedClusterId(event.target.value)}
                fullWidth
              >
                {clusterOptions.map((cluster) => (
                  <MenuItem key={cluster._id} value={cluster._id}>
                    {[cluster.name, cluster.venueName].filter(Boolean).join(" · ")}
                  </MenuItem>
                ))}
              </TextField>
              {runtime?.cluster && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    size="small"
                    color="primary"
                    label={`Đang xem: ${runtime.cluster.name || "Cụm sân"}`}
                  />
                  {Number(runtime?.sharedTournamentCount || 0) > 1 && (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label={`Dùng chung ${runtime.sharedTournamentCount} giải`}
                    />
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        )}

        <Stack direction="row" alignItems="center" spacing={1}>
          <Checkbox
            size="small"
            checked={overrideExisting}
            onChange={(event) => setOverrideExisting(event.target.checked)}
          />
          <Typography variant="body2">
            Cho phép <b>ghi đè</b> link LIVE đã có trong trận
          </Typography>
        </Stack>

        {hasClusterMode && runtimeError ? (
          <Alert severity="error">
            {runtimeError?.data?.message ||
              runtimeError?.error ||
              "Không tải được runtime cụm sân."}
          </Alert>
        ) : courtsErr ? (
          <Alert severity="error">Không tải được danh sách sân.</Alert>
        ) : items.length === 0 ? (
          <Alert severity="warning">
            {hasClusterMode
              ? "Chưa có sân nào trong cụm sân đang dùng."
              : "Chưa có sân trong giải này."}
          </Alert>
        ) : (
          <>
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{ display: { xs: "none", md: "block" } }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Sân</TableCell>
                    <TableCell>Trận (tổng / live / chưa kết thúc)</TableCell>
                    <TableCell>URL mẫu từ trận</TableCell>
                    <TableCell sx={{ width: 80 }}>Bật</TableCell>
                    <TableCell>URL LIVE mặc định</TableCell>
                    <TableCell align="right">Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => {
                    const counts = renderItemCounts(item);
                    const sampleUrl = renderItemSampleUrl(item);
                    const values = form[item._id] || {
                      enabled: false,
                      videoUrl: "",
                    };
                    const isBusy = busy.has(item._id);
                    return (
                      <TableRow key={item._id}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              size="small"
                              icon={<StadiumIcon />}
                              label={item.displayLabel}
                            />
                            {item?.code && (
                              <Chip size="small" variant="outlined" label={item.code} />
                            )}
                          </Stack>
                        </TableCell>

                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {counts.total} / {counts.live} / {counts.notFinished}
                        </TableCell>

                        <TableCell sx={{ maxWidth: 320 }}>
                          {sampleUrl ? (
                            <Tooltip title={sampleUrl} arrow>
                              <Typography variant="body2" noWrap>
                                {sampleUrl}
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              (chưa có)
                            </Typography>
                          )}
                        </TableCell>

                        <TableCell sx={{ width: 80 }}>
                          <Checkbox
                            size="small"
                            checked={!!values.enabled}
                            sx={{ mx: 0.5 }}
                            disabled={isBusy || savingAny}
                            onChange={(event) =>
                              handleToggleEnabled(item._id, event.target.checked)
                            }
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 320 }}>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="https://... để trống nếu muốn tắt/xóa"
                            value={values.videoUrl}
                            onChange={(event) =>
                              onChangeItemField(item._id, {
                                videoUrl: event.target.value,
                              })
                            }
                          />
                        </TableCell>

                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<OpenInNewIcon />}
                              component={RouterLink}
                              to={buildLiveUrl(tournamentId, bracketId ?? null, item)}
                              target="_blank"
                              rel="noopener"
                            >
                              {hasClusterMode ? "Mở LIVE" : "Mở studio LIVE"}
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack spacing={1} sx={{ display: { xs: "flex", md: "none" } }}>
              {items.map((item) => {
                const counts = renderItemCounts(item);
                const sampleUrl = renderItemSampleUrl(item);
                const values = form[item._id] || {
                  enabled: false,
                  videoUrl: "",
                };
                const isBusy = busy.has(item._id);

                return (
                  <Paper
                    key={item._id}
                    variant="outlined"
                    sx={{ p: 1.25, borderRadius: 2 }}
                  >
                    <Stack spacing={1.25}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                      >
                        <Chip
                          size="small"
                          icon={<StadiumIcon />}
                          label={item.displayLabel}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {counts.total} / {counts.live} / {counts.notFinished}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Typography variant="caption">Bật</Typography>
                          <Checkbox
                            size="small"
                            checked={!!values.enabled}
                            sx={{ p: 0.5 }}
                            disabled={isBusy || savingAny}
                            onChange={(event) =>
                              handleToggleEnabled(item._id, event.target.checked)
                            }
                          />
                        </Stack>
                      </Stack>

                      <Typography variant="caption" color="text.secondary">
                        Tích bật/tắt sẽ lưu ngay. Đổi URL rồi bấm “Lưu tất cả sân”.
                      </Typography>

                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          URL mẫu từ trận
                        </Typography>
                        {sampleUrl ? (
                          <Tooltip title={sampleUrl} arrow>
                            <Typography variant="body2" noWrap>
                              {sampleUrl}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            (chưa có)
                          </Typography>
                        )}
                      </Box>

                      <TextField
                        size="small"
                        fullWidth
                        placeholder="URL LIVE mặc định https://..."
                        value={values.videoUrl}
                        onChange={(event) =>
                          onChangeItemField(item._id, {
                            videoUrl: event.target.value,
                          })
                        }
                      />

                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<OpenInNewIcon />}
                          component={RouterLink}
                          to={buildLiveUrl(tournamentId, bracketId ?? null, item)}
                          target="_blank"
                          rel="noopener"
                        >
                          {hasClusterMode ? "Mở LIVE" : "Mở studio LIVE"}
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </Stack>
    </ResponsiveModal>
  );
}
