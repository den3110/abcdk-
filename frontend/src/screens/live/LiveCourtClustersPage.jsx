import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Grid,
  InputAdornment,
  OutlinedInput,
  Pagination,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import LottieEmptyState from "../../components/LottieEmptyState";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useRegisterChatBotPageSnapshot } from "../../context/ChatBotPageContext.jsx";
import {
  useGetLiveClusterQuery,
  useGetLiveClustersQuery,
  useGetLiveMatchesQuery,
} from "../../slices/liveApiSlice";
import ResponsiveMatchViewer from "../PickleBall/match/ResponsiveMatchViewer";
import LiveMatchCard from "./LiveMatchCard";

const REFRESH_MS = 15000;
const ARCHIVE_LIMIT = 12;

const sid = (value) => String(value?._id || value?.id || value || "").trim();

function teamLine(match) {
  return `${match?.pairA?.name || "Đội A"} vs ${match?.pairB?.name || "Đội B"}`;
}

function statusLabel(status) {
  switch (String(status || "").toLowerCase()) {
    case "live":
      return "LIVE";
    case "assigned":
      return "Đã gán sân";
    case "queued":
      return "Chờ vào sân";
    case "finished":
      return "Hoàn thành";
    default:
      return status || "Chờ";
  }
}

function groupMatchesByTournament(items = []) {
  const map = new Map();
  items.forEach((item) => {
    const tournamentId = sid(item?.tournament?._id || item?.tournament?.name || "unknown");
    const current =
      map.get(tournamentId) ||
      {
        key: tournamentId,
        tournament: item?.tournament || { name: "Không rõ giải" },
        items: [],
      };
    current.items.push(item);
    map.set(tournamentId, current);
  });
  return Array.from(map.values());
}

export default function LiveCourtClustersPage() {
  const { t } = useLanguage();
  const [keyword, setKeyword] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [selectedStation, setSelectedStation] = useState(null);
  const [archiveTournamentId, setArchiveTournamentId] = useState("all");
  const [archivePage, setArchivePage] = useState(1);

  const {
    data: clusters = [],
    isFetching: isFetchingClusters,
    refetch: refetchClusters,
  } = useGetLiveClustersQuery(undefined, {
    pollingInterval: REFRESH_MS,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const {
    data: clusterDetail,
    isFetching: isFetchingCluster,
    refetch: refetchCluster,
  } = useGetLiveClusterQuery(selectedClusterId, {
    skip: !selectedClusterId,
    pollingInterval: 5000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!clusters.length) return setSelectedClusterId("");
    setSelectedClusterId((prev) =>
      prev && clusters.some((item) => sid(item) === prev) ? prev : sid(clusters[0])
    );
  }, [clusters]);

  useEffect(() => {
    if (!selectedStation) return;
    const stations = Array.isArray(clusterDetail?.stations) ? clusterDetail.stations : [];
    const refreshed = stations.find((item) => sid(item) === sid(selectedStation));
    if (refreshed) setSelectedStation(refreshed);
  }, [clusterDetail?.stations, selectedStation]);

  useEffect(() => {
    setArchivePage(1);
  }, [archiveTournamentId]);

  const stations = useMemo(() => {
    const raw = Array.isArray(clusterDetail?.stations) ? clusterDetail.stations : [];
    const query = String(keyword || "").trim().toLowerCase();
    if (!query) return raw;
    return raw.filter((station) => {
      const haystack = [
        station?.name,
        station?.code,
        station?.currentMatch?.code,
        station?.currentMatch?.displayCode,
        station?.currentMatch?.tournament?.name,
        teamLine(station?.currentMatch),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [clusterDetail?.stations, keyword]);

  const summary = useMemo(() => {
    const total = stations.length;
    const live = stations.filter(
      (station) => String(station?.status || "").toLowerCase() === "live"
    ).length;
    const active = stations.filter((station) => Boolean(station?.currentMatch)).length;
    return { total, live, active };
  }, [stations]);

  const archiveQueryArgs = useMemo(
    () => ({
      statuses: "finished",
      excludeFinished: false,
      all: true,
      tournamentId: archiveTournamentId === "all" ? "" : archiveTournamentId,
      page: archivePage,
      limit: ARCHIVE_LIMIT,
    }),
    [archivePage, archiveTournamentId]
  );

  const {
    data: archiveResp,
    isLoading: isLoadingArchive,
    isFetching: isFetchingArchive,
    refetch: refetchArchive,
  } = useGetLiveMatchesQuery(archiveQueryArgs, {
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const archiveItems = useMemo(
    () => (Array.isArray(archiveResp?.items) ? archiveResp.items : []),
    [archiveResp?.items]
  );
  const archiveTournaments = useMemo(
    () => (Array.isArray(archiveResp?.tournaments) ? archiveResp.tournaments : []),
    [archiveResp?.tournaments]
  );
  const archivePages = Math.max(1, Number(archiveResp?.pages || 1));
  const archiveTotal = Number(archiveResp?.count || 0);
  const archiveGroups = useMemo(
    () => groupMatchesByTournament(archiveItems),
    [archiveItems]
  );
  const liveSearchPlaceholder = useMemo(() => {
    const translated = t("common.actions.search");
    return translated && translated !== "common.actions.search"
      ? translated
      : "Tìm theo sân, mã trận, giải...";
  }, [t]);

  const archiveTournamentName = useMemo(() => {
    if (archiveTournamentId === "all") return "";
    return (
      archiveTournaments.find((item) => sid(item?._id) === sid(archiveTournamentId))?.name || ""
    );
  }, [archiveTournamentId, archiveTournaments]);
  const hasKeyword = Boolean(String(keyword || "").trim());
  const clusterEmptyCopy = useMemo(() => {
    if (hasKeyword) {
      return {
        title: "Không tìm thấy sân phù hợp",
        description:
          "Thử đổi từ khóa hoặc chuyển sang cụm sân khác. Chỉ những sân có trận đang live và có video công khai mới xuất hiện ở đây.",
      };
    }

    return {
      title: "Cụm này chưa có sân nào sẵn sàng",
      description:
        "Khi có trận đang live và có video/live stream công khai, hệ thống sẽ tự đưa sân vào khu vực này.",
    };
  }, [hasKeyword]);
  const archiveEmptyCopy = useMemo(() => {
    if (archiveTournamentName) {
      return {
        title: `Chưa có trận đã live ở ${archiveTournamentName}`,
        description:
          "Khi giải này có trận đã phát và còn video công khai, nội dung sẽ tự hiện ở bên dưới.",
      };
    }

    return {
      title: "Chưa có trận đã live nào",
      description:
        "Danh sách này chỉ hiện những trận đã từng live và vẫn có video/stream công khai để xem lại.",
    };
  }, [archiveTournamentName]);
  const selectedClusterName = useMemo(
    () =>
      clusters.find((cluster) => sid(cluster) === sid(selectedClusterId))
        ?.name || "",
    [clusters, selectedClusterId],
  );
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "live_clusters",
      entityTitle: "Live PickleTour",
      sectionTitle: selectedClusterName || "Cụm sân trực tiếp",
      pageSummary:
        "Trang live tổng với cụm sân đang phát, trận trực tiếp và kho trận đã phát gần đây.",
      activeLabels: [
        selectedClusterName || "",
        keyword ? `Tìm: ${keyword}` : "",
        archiveTournamentName
          ? `Lọc archive: ${archiveTournamentName}`
          : "Archive tất cả giải",
      ],
      visibleActions: ["Đổi cụm sân", "Tìm sân hoặc trận", "Xem archive"],
      highlights: stations
        .slice(0, 4)
        .map((station) => station?.name || station?.code || ""),
      metrics: [
        `Cụm sân: ${clusters.length}`,
        `Sân hiện có: ${summary.total}`,
        `Đang live: ${summary.live}`,
        `Có trận: ${summary.active}`,
        `Archive: ${archiveTotal}`,
      ],
    }),
    [
      selectedClusterName,
      keyword,
      archiveTournamentName,
      stations,
      clusters.length,
      summary,
      archiveTotal,
    ],
  );

  useRegisterChatBotPageSnapshot(chatBotSnapshot);

  return (
    <>
      <SEOHead
        title="PickleTour Live Theo Cụm Sân"
        description="Xem live PickleTour theo cụm sân vật lý và xem lại các trận đã live theo từng giải."
      />

      <Box sx={{ maxWidth: 1440, mx: "auto", px: { xs: 2, md: 4 }, py: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h3" fontWeight={800} gutterBottom>
              Live Theo Cụm Sân
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Chọn cụm sân rồi chọn đúng sân vật lý để xem. Nếu sân đổi sang nội dung khác,
              viewer sẽ tự theo sân đó.
            </Typography>
          </Box>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            alignItems={{ md: "center" }}
          >
            <OutlinedInput
              fullWidth
              placeholder={liveSearchPlaceholder}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              startAdornment={
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              }
            />
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                refetchClusters();
                refetchCluster();
                refetchArchive();
              }}
            >
              Làm mới
            </Button>
          </Stack>

          <Grid container spacing={2}>
            {clusters.map((cluster) => {
              const active = sid(cluster) === selectedClusterId;
              return (
                <Grid item xs={12} md={4} lg={3} key={sid(cluster)}>
                  <Card
                    onClick={() => setSelectedClusterId(sid(cluster))}
                    sx={{
                      p: 2,
                      cursor: "pointer",
                      border: "2px solid",
                      borderColor: active ? "primary.main" : "transparent",
                      boxShadow: active ? 4 : 1,
                      transition: "all 0.2s ease",
                      "&:hover": { boxShadow: 4 },
                    }}
                  >
                    <Stack spacing={1}>
                      <Typography variant="h6" fontWeight={700}>
                        {cluster.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {cluster.venueName || cluster.description || "Cụm sân PickleTour"}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={`${cluster.stationsCount || 0} sân`} />
                        <Chip
                          size="small"
                          color={cluster.liveCount > 0 ? "error" : "default"}
                          label={`${cluster.liveCount || 0} LIVE`}
                          sx={
                            cluster.liveCount > 0
                              ? {
                                  animation: "pulseLive 1.5s infinite ease-in-out",
                                  "@keyframes pulseLive": {
                                    "0%": { opacity: 0.7 },
                                    "50%": { opacity: 1, boxShadow: "0 0 8px rgba(211, 47, 47, 0.6)" },
                                    "100%": { opacity: 0.7 },
                                  },
                                }
                              : {}
                          }
                        />
                      </Stack>
                    </Stack>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {!clusters.length && !isFetchingClusters ? (
            <LottieEmptyState
              title="Chưa có cụm sân nào sẵn sàng để xem"
              description="Chỉ những cụm có trận đang live và có video công khai mới hiện ở đây."
              minHeight={360}
            />
          ) : null}

          {clusterDetail?.cluster ? (
            <Stack spacing={2}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h4" fontWeight={800}>
                    {clusterDetail.cluster.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {clusterDetail.cluster.venueName ||
                      clusterDetail.cluster.description ||
                      "Không có mô tả"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Chip label={`${summary.total} sân`} />
                  <Chip color="error" label={`${summary.live} LIVE`} />
                  <Chip color="info" label={`${summary.active} sân có trận`} />
                  <Chip
                    color={isFetchingCluster ? "warning" : "success"}
                    label={isFetchingCluster ? "Đang đồng bộ" : "Tự cập nhật"}
                  />
                </Stack>
              </Stack>

              {stations.length === 0 ? (
                <LottieEmptyState
                  title={clusterEmptyCopy.title}
                  description={clusterEmptyCopy.description}
                  minHeight={320}
                />
              ) : (
                <Grid container spacing={2}>
                  {stations.map((station) => (
                    <Grid item xs={12} md={6} xl={4} key={sid(station)}>
                      <Card sx={{ p: 2, height: "100%" }}>
                        <Stack spacing={1.5} height="100%">
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <Box>
                              <Typography variant="h6" fontWeight={700}>
                                {station.name || station.code || "Sân"}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {station.code || sid(station)}
                              </Typography>
                            </Box>
                            <Chip
                              size="small"
                              color={
                                String(station?.status || "").toLowerCase() === "live"
                                  ? "error"
                                  : "default"
                              }
                              label={statusLabel(station?.status)}
                            />
                          </Stack>

                          {station.currentMatch ? (
                            <>
                              <Typography variant="body2" fontWeight={700}>
                                {station.currentMatch.displayCode ||
                                  station.currentMatch.code ||
                                  "Trận hiện tại"}
                              </Typography>
                              <Typography variant="body2">{teamLine(station.currentMatch)}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {station.currentMatch?.tournament?.name || "Không rõ giải"}
                              </Typography>
                              <Box sx={{ flex: 1 }} />
                              <Button
                                fullWidth
                                variant="contained"
                                startIcon={<PlayCircleOutlineIcon />}
                                onClick={() => setSelectedStation(station)}
                              >
                                Xem sân này
                              </Button>
                            </>
                          ) : (
                            <Alert severity="info">Sân này hiện chưa có trận để xem.</Alert>
                          )}
                        </Stack>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </Stack>
          ) : null}

          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={2}
              alignItems={{ md: "center" }}
            >
              <Box>
                <Typography variant="h4" fontWeight={800}>
                  Các trận đã live
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Lấy toàn bộ các trận đã có live/video và lọc theo từng giải.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {isFetchingArchive ? <CircularProgress size={20} /> : null}
                <Chip label={`${archiveTotal} trận`} color="info" variant="outlined" />
              </Stack>
            </Stack>

            <Autocomplete
              options={[{ _id: "all", name: "Tất cả giải", count: 0 }, ...archiveTournaments]}
              getOptionLabel={(opt) =>
                opt._id === "all" ? "Tất cả giải" : `${opt.name} (${opt.count} trận)`
              }
              value={
                archiveTournamentId === "all"
                  ? { _id: "all", name: "Tất cả giải", count: 0 }
                  : archiveTournaments.find((t) => t._id === archiveTournamentId) || {
                      _id: "all",
                      name: "Tất cả giải",
                      count: 0,
                    }
              }
              onChange={(_, val) => setArchiveTournamentId(val ? val._id : "all")}
              renderInput={(params) => (
                <TextField {...params} label="Lọc theo giải đấu" placeholder="Gõ tên giải cần tìm..." />
              )}
              disableClearable
              size="small"
              sx={{ width: { xs: "100%", md: 400 } }}
            />

            {isLoadingArchive ? (
              <Stack alignItems="center" sx={{ py: 6 }}>
                <CircularProgress />
              </Stack>
            ) : archiveItems.length === 0 ? (
              <LottieEmptyState
                title={archiveEmptyCopy.title}
                description={archiveEmptyCopy.description}
                minHeight={320}
              />
            ) : (
              <Stack spacing={3}>
                {archiveGroups.map((group) => (
                  <Stack spacing={1.5} key={group.key}>
                    <Typography variant="h5" fontWeight={700}>
                      {group.tournament?.name || "Không rõ giải"}
                    </Typography>
                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
                        "@media (min-width:600px)": {
                          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                        },
                        "@media (min-width:900px)": {
                          gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                        },
                        alignItems: "stretch",
                      }}
                    >
                      {group.items.map((item) => (
                        <Box key={item._id} sx={{ display: "flex", minWidth: 0 }}>
                          <LiveMatchCard item={item} />
                        </Box>
                      ))}
                    </Box>
                  </Stack>
                ))}

                {archivePages > 1 ? (
                  <Stack direction="row" justifyContent="center">
                    <Pagination
                      color="primary"
                      page={archivePage}
                      count={archivePages}
                      onChange={(_, value) => setArchivePage(value)}
                      shape="rounded"
                    />
                  </Stack>
                ) : null}
              </Stack>
            )}
          </Stack>
        </Stack>
      </Box>

      <ResponsiveMatchViewer
        open={Boolean(selectedStation)}
        matchId={selectedStation?.currentMatch?._id || ""}
        courtStationId={selectedStation?._id || ""}
        initialMatch={selectedStation?.currentMatch || null}
        onClose={() => setSelectedStation(null)}
      />
    </>
  );
}
