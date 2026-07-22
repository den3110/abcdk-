import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";

import SEOHead from "../../components/SEOHead.jsx";
import { UnifiedStreamPlayer } from "../../components/video";
import { useGetLiveFeedQuery } from "../../slices/liveApiSlice";

const asTrimmed = (value) => String(value || "").trim();

const scoreInt = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const isReadyStream = (stream) => stream?.ready !== false;

const streamKeyOf = (stream) =>
  asTrimmed(stream?.key || stream?.url || stream?.embedUrl || stream?.playUrl);

const pickDefaultStreamKey = (streams = [], preferredKey = "") => {
  const normalizedPreferred = asTrimmed(preferredKey);
  if (normalizedPreferred) {
    const preferred = streams.find(
      (stream) => streamKeyOf(stream) === normalizedPreferred,
    );
    if (preferred) return streamKeyOf(preferred);
  }

  const ready = streams.find(isReadyStream);
  return streamKeyOf(ready || streams[0] || null);
};

function currentScoreOf(match) {
  const scores = Array.isArray(match?.gameScores) ? match.gameScores : [];
  const current =
    scores[Math.max(0, Math.min(scores.length - 1, Number(match?.currentGame || scores.length) - 1))] ||
    scores[scores.length - 1] ||
    null;

  return {
    a: scoreInt(match?.score?.a ?? current?.a ?? current?.A ?? current?.scoreA),
    b: scoreInt(match?.score?.b ?? current?.b ?? current?.B ?? current?.scoreB),
  };
}

export default function LiveWatchPage() {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const [activeStreamKey, setActiveStreamKey] = useState("");
  const [muted, setMuted] = useState(false);

  const { data, isLoading, isFetching, isError } = useGetLiveFeedQuery(
    {
      matchId,
      page: 1,
      limit: 1,
      mode: "all",
      source: "all",
      replayState: "all",
      sort: "smart",
    },
    { skip: !matchId },
  );

  const match = Array.isArray(data?.items) ? data.items[0] : null;
  const streams = useMemo(
    () => (Array.isArray(match?.streams) ? match.streams : []),
    [match?.streams],
  );

  useEffect(() => {
    if (!streams.length) {
      setActiveStreamKey("");
      return;
    }

    setActiveStreamKey((current) => {
      if (current && streams.some((stream) => streamKeyOf(stream) === current)) {
        return current;
      }
      return pickDefaultStreamKey(streams, match?.feedPreferredStreamKey);
    });
  }, [match?.feedPreferredStreamKey, streams]);

  const activeStream =
    streams.find((stream) => streamKeyOf(stream) === activeStreamKey) ||
    streams.find(isReadyStream) ||
    streams[0] ||
    null;
  const openUrl =
    asTrimmed(activeStream?.openUrl) ||
    asTrimmed(match?.primaryOpenUrl) ||
    asTrimmed(activeStream?.url) ||
    asTrimmed(activeStream?.playUrl);
  const score = currentScoreOf(match);
  const title = match
    ? `${match.teamAName || "Đội A"} vs ${match.teamBName || "Đội B"}`
    : "Xem trận đấu";
  const objectFit = asTrimmed(match?.preferredObjectFit) || "contain";
  const useNativeControls = Boolean(
    match?.useNativeControls || activeStream?.meta?.useNativeControls,
  );

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        bgcolor: "#03060a",
        color: "#fff",
        p: { xs: 1.5, md: 2 },
      }}
    >
      <SEOHead
        title={`${title} - PickleTour`}
        description="Xem video trận đấu trên PickleTour."
      />

      <Stack spacing={2} sx={{ maxWidth: 1680, mx: "auto" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate(-1)}
              sx={{
                color: "#fff",
                borderColor: "rgba(255,255,255,0.22)",
                textTransform: "none",
                flexShrink: 0,
              }}
            >
              Quay lại
            </Button>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "rgba(255,255,255,0.62)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {match?.tournament?.name || "PickleTour"}
                {match?.displayCode ? ` · ${match.displayCode}` : ""}
              </Typography>
            </Box>
          </Stack>

          {openUrl ? (
            <Button
              variant="contained"
              component="a"
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              endIcon={<OpenInNewIcon />}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Mở link trực tiếp
            </Button>
          ) : null}
        </Stack>

        {isLoading || (isFetching && !match) ? (
          <Paper
            sx={{
              minHeight: "calc(100dvh - 116px)",
              display: "grid",
              placeItems: "center",
              bgcolor: "rgba(255,255,255,0.04)",
              color: "#fff",
            }}
          >
            <CircularProgress />
          </Paper>
        ) : isError || !match ? (
          <Alert severity="warning">
            Không tìm thấy video công khai cho trận này.
          </Alert>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 340px" },
              gap: 2,
              minHeight: { lg: "calc(100dvh - 116px)" },
            }}
          >
            <Paper
              sx={{
                bgcolor: "#000",
                border: "1px solid rgba(255,255,255,0.12)",
                overflow: "hidden",
                minHeight: { xs: 280, md: 520, lg: 0 },
                height: { xs: "56.25vw", md: "calc(100dvh - 116px)" },
                maxHeight: { xs: 620, lg: "none" },
              }}
            >
              {activeStream ? (
                <UnifiedStreamPlayer
                  source={activeStream}
                  autoplay
                  muted={muted}
                  onMutedChange={setMuted}
                  useNativeControls={useNativeControls}
                  chromeMode="default"
                  fillContainer
                  objectFit={objectFit}
                />
              ) : (
                <Box
                  sx={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    color: "rgba(255,255,255,0.68)",
                  }}
                >
                  Trận này chưa có nguồn video.
                </Box>
              )}
            </Paper>

            <Paper
              sx={{
                bgcolor: "rgba(255,255,255,0.06)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.12)",
                p: 2,
                alignSelf: { lg: "stretch" },
              }}
            >
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    label={match.status === "live" ? "Đang live" : "Xem lại"}
                    color={match.status === "live" ? "error" : "success"}
                    size="small"
                  />
                  {match.stageLabel ? (
                    <Chip label={match.stageLabel} size="small" />
                  ) : null}
                  {match.courtLabel ? (
                    <Chip label={`Sân ${match.courtLabel}`} size="small" />
                  ) : null}
                </Stack>

                <Box>
                  <Typography
                    variant="caption"
                    sx={{ color: "rgba(255,255,255,0.58)", fontWeight: 700 }}
                  >
                    Tỉ số
                  </Typography>
                  <Typography sx={{ fontSize: 48, fontWeight: 900, lineHeight: 1 }}>
                    {score.a} - {score.b}
                  </Typography>
                </Box>

                <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />

                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 800 }}>
                    {match.teamAName || "Đội A"}
                  </Typography>
                  <Typography sx={{ color: "rgba(255,255,255,0.52)" }}>
                    vs
                  </Typography>
                  <Typography sx={{ fontWeight: 800 }}>
                    {match.teamBName || "Đội B"}
                  </Typography>
                </Stack>

                {streams.length > 1 ? (
                  <>
                    <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />
                    <Stack spacing={1}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "rgba(255,255,255,0.58)",
                          fontWeight: 700,
                        }}
                      >
                        Nguồn phát
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {streams.map((stream) => {
                          const key = streamKeyOf(stream);
                          const selected = key === streamKeyOf(activeStream);
                          return (
                            <Chip
                              key={key || stream?.label || stream?.providerLabel}
                              clickable
                              color={selected ? "primary" : "default"}
                              label={
                                stream?.label ||
                                stream?.displayLabel ||
                                stream?.providerLabel ||
                                "Video"
                              }
                              onClick={() => setActiveStreamKey(key)}
                            />
                          );
                        })}
                      </Stack>
                    </Stack>
                  </>
                ) : null}

                {match?.tournament?._id ? (
                  <Button
                    component={RouterLink}
                    to={`/tournament/${match.tournament._id}/bracket`}
                    variant="outlined"
                    sx={{
                      color: "#fff",
                      borderColor: "rgba(255,255,255,0.22)",
                      textTransform: "none",
                    }}
                  >
                    Về sơ đồ
                  </Button>
                ) : null}
              </Stack>
            </Paper>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
