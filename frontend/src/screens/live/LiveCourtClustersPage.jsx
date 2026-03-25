import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Grid,
  OutlinedInput,
  InputAdornment,
  Stack,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext.jsx";
import {
  useGetLiveClusterQuery,
  useGetLiveClustersQuery,
} from "../../slices/liveApiSlice";
import ResponsiveMatchViewer from "../PickleBall/match/ResponsiveMatchViewer";

const REFRESH_MS = 15000;

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

export default function LiveCourtClustersPage() {
  const { t } = useLanguage();
  const [keyword, setKeyword] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [selectedStation, setSelectedStation] = useState(null);

  const { data: clusters = [], isFetching: isFetchingClusters, refetch: refetchClusters } =
    useGetLiveClustersQuery(undefined, {
      pollingInterval: REFRESH_MS,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    });
  const { data: clusterDetail, isFetching: isFetchingCluster, refetch: refetchCluster } =
    useGetLiveClusterQuery(selectedClusterId, {
      skip: !selectedClusterId,
      pollingInterval: 5000,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    });

  useEffect(() => {
    if (!clusters.length) return setSelectedClusterId("");
    setSelectedClusterId((prev) => (prev && clusters.some((item) => sid(item) === prev) ? prev : sid(clusters[0])));
  }, [clusters]);

  useEffect(() => {
    if (!selectedStation) return;
    const stations = Array.isArray(clusterDetail?.stations) ? clusterDetail.stations : [];
    const refreshed = stations.find((item) => sid(item) === sid(selectedStation));
    if (refreshed) setSelectedStation(refreshed);
  }, [clusterDetail?.stations, selectedStation]);

  const stations = useMemo(() => {
    const raw = Array.isArray(clusterDetail?.stations) ? clusterDetail.stations : [];
    const q = String(keyword || "").trim().toLowerCase();
    if (!q) return raw;
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
      return haystack.includes(q);
    });
  }, [clusterDetail?.stations, keyword]);

  const summary = useMemo(() => {
    const total = stations.length;
    const live = stations.filter((station) => String(station?.status || "").toLowerCase() === "live").length;
    const active = stations.filter((station) => Boolean(station?.currentMatch)).length;
    return { total, live, active };
  }, [stations]);

  return (
    <>
      <SEOHead
        title="PickleTour Live Theo Cụm Sân"
        description="Xem live PickleTour theo cụm sân vật lý và tự theo nội dung mới khi cùng sân đổi trận."
      />
      <Box sx={{ maxWidth: 1440, mx: "auto", px: { xs: 2, md: 4 }, py: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h3" fontWeight={800} gutterBottom>
              Live Theo Cụm Sân
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Chọn cụm sân rồi chọn đúng sân vật lý để xem. Nếu sân đổi sang nội dung khác, viewer sẽ tự theo sân đó.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
            <OutlinedInput
              fullWidth
              placeholder={t("common.actions.search")}
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
                      border: "1px solid",
                      borderColor: active ? "primary.main" : "divider",
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
                        <Chip size="small" color="error" label={`${cluster.liveCount || 0} LIVE`} />
                      </Stack>
                    </Stack>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {!clusters.length && !isFetchingClusters ? (
            <Alert severity="info">Hiện chưa có cụm sân live nào đang bật.</Alert>
          ) : null}

          {clusterDetail?.cluster ? (
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                <Box>
                  <Typography variant="h4" fontWeight={800}>
                    {clusterDetail.cluster.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {clusterDetail.cluster.venueName || clusterDetail.cluster.description || "Không có mô tả"}
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

              <Grid container spacing={2}>
                {stations.map((station) => (
                  <Grid item xs={12} md={6} xl={4} key={sid(station)}>
                    <Card sx={{ p: 2, height: "100%" }}>
                      <Stack spacing={1.5} height="100%">
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
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
                            color={String(station?.status || "").toLowerCase() === "live" ? "error" : "default"}
                            label={statusLabel(station?.status)}
                          />
                        </Stack>

                        {station.currentMatch ? (
                          <>
                            <Typography variant="body2" fontWeight={700}>
                              {station.currentMatch.displayCode || station.currentMatch.code || "Trận hiện tại"}
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
            </Stack>
          ) : null}
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
