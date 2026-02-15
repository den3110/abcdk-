// src/pages/admin/CourtLiveStudioPage.jsx
/* eslint-disable react/prop-types */
import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  AppBar,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Toolbar,
  Typography,
  Alert,
  Chip,
  Stack,
  Button,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import HlsPlayer from "react-hls-player";
import {
  Stream as StreamIcon,
  Sensors as SensorsIcon,
  VideocamOff as VideocamOffIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Scoreboard as ScoreboardIcon,
} from "@mui/icons-material";
import SEOHead from "../../components/SEOHead";

import { useAdminListCourtsByTournamentQuery } from "../../slices/courtsApiSlice";
import { useCreateFacebookLiveForMatchMutation } from "../../slices/adminMatchLiveApiSlice";
import LiveStudioCourts from "./LiveStudioCourts";

/* ---- utils: chuẩn hoá destinations cho Studio ---- */
const splitRtmpUrl = (url) => {
  if (!url || !/^rtmps?:\/\//i.test(url))
    return { server_url: "", stream_key: "" };
  const trimmed = url.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return { server_url: trimmed, stream_key: "" };
  return {
    server_url: trimmed.slice(0, idx),
    stream_key: trimmed.slice(idx + 1),
  };
};

const normalizeDestinations = (raw) => {
  let arr = [];
  if (Array.isArray(raw?.destinations)) arr = raw.destinations;
  else if (Array.isArray(raw)) arr = raw;
  else if (raw?.server_url || raw?.secure_stream_url || raw?.stream_key) {
    arr = [{ platform: raw.platform || "facebook", ...raw }];
  }

  return arr
    .map((d) => {
      const platform = String(d.platform || "").toLowerCase() || "facebook";
      let server_url = d.server_url || "";
      let stream_key = d.stream_key || "";
      const secure_stream_url = d.secure_stream_url || "";
      if ((!server_url || !stream_key) && secure_stream_url) {
        const s = splitRtmpUrl(secure_stream_url);
        server_url = server_url || s.server_url;
        stream_key = stream_key || s.stream_key;
      }
      return { platform, server_url, stream_key, secure_stream_url };
    })
    .filter((d) => d.platform);
};

export default function CourtLiveStudioPage() {
  const navigate = useNavigate();
  const { tid, bid, courtId } = useParams();

  // ✅ Tab visibility để pause polling khi không focus
  const [isTabVisible, setIsTabVisible] = React.useState(true);

  React.useEffect(() => {
    const handleVisibility = () => {
      setIsTabVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ✅ RTK Query: giảm polling, chỉ poll khi tab visible
  const {
    data: courtsResp,
    isLoading,
    isError,
  } = useAdminListCourtsByTournamentQuery(
    { tid, bracketId: bid },
    {
      refetchOnMountOrArgChange: true,
      pollingInterval: isTabVisible ? 5000 : 0, // 5s thay vì 1.5s, tắt khi blur
      skip: !tid || !bid,
    }
  );

  // ✅ Memoize courts array với deep comparison
  const courts = React.useMemo(
    () => (Array.isArray(courtsResp?.items) ? courtsResp.items : []),
    [courtsResp?.items] // ← Chỉ dùng .items thay vì toàn bộ courtsResp
  );

  // ✅ Memoize court object
  const court = React.useMemo(
    () => courts.find((c) => String(c?._id) === String(courtId)),
    [courts, courtId]
  );

  const courtLabel = React.useMemo(() => {
    if (!court) return `Sân #${String(courtId).slice(-4)}`;
    return (
      court.name ||
      court.label ||
      court.code ||
      (Number.isFinite(court.number)
        ? `Sân ${court.number}`
        : `Sân #${String(courtId).slice(-4)}`)
    );
  }, [court, courtId]);

  const currentMatchId = court?.currentMatch?._id || null;
  const liveEnabled = !!court?.liveConfig?.enabled;
  const defaultUrl = (court?.liveConfig?.videoUrl || "").trim();

  // ✅ Stable Map với shallow comparison
  const courtStateMap = React.useMemo(() => {
    const m = new Map();
    for (const c of courts) {
      const cm = c?.currentMatch;
      if (cm) {
        const id = String(cm._id || cm.id || cm);
        const status = cm.status || c?.status || null;
        // ← Chỉ set nếu chưa có hoặc khác
        if (!m.has(String(c._id)) || m.get(String(c._id)).status !== status) {
          m.set(String(c._id), { _id: id, status });
        }
      }
    }
    return m;
  }, [courts]); // ← courts đã stable rồi

  // ✅ STABLE callbacks - KHÔNG đổi reference trừ khi deps thật sự thay đổi
  const fetchCourtState = React.useCallback(
    async (cid) => {
      const s = courtStateMap.get(String(cid));
      if (!s) return { currentMatch: null };
      return { currentMatch: { _id: s._id, status: s.status } };
    },
    [courtStateMap]
  );

  // ✅ Stable empty resolver
  const resolveTargets = React.useCallback(async () => [], []);

  // ✅ Mutation với stable callback
  const [createLiveMut] = useCreateFacebookLiveForMatchMutation();
  const createLive = React.useCallback(
    async (mid) => {
      try {
        const res = await createLiveMut(mid).unwrap();
        return normalizeDestinations(res);
      } catch (error) {
        console.error("Failed to create live:", error);
        return [];
      }
    },
    [createLiveMut]
  );

  // ✅ Stable URLs
  const urls = React.useMemo(() => {
    const origin =
      (typeof window !== "undefined" && window.location.origin) || "";
    return {
      overlayApiUrl: origin + "/api/overlay/match",
      wsUrl: "wss://pickletour.vn/ws/rtmp",
    };
  }, []);



  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <SEOHead title={`Live Studio - ${courtLabel}`} noIndex={true} />
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }} noWrap>
            Live Studio — {courtLabel}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              icon={<SportsTennisIcon />}
              label={`Bracket: ${bid}`}
              size="small"
            />
            {liveEnabled ? (
              <Chip
                color="success"
                icon={<LiveTvIcon />}
                label="LIVE config: ON"
                size="small"
              />
            ) : (
              <Chip
                color="default"
                icon={<LiveTvIcon />}
                label="LIVE config: OFF"
                size="small"
              />
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        sx={{ flex: 1, overflow: "auto", bgcolor: "background.default", py: 2 }}
      >
        <Container maxWidth="xl">
          {isLoading ? (
            <Box py={6} textAlign="center">
              <CircularProgress />
            </Box>
          ) : isError ? (
            <Alert severity="error">Không tải được thông tin sân.</Alert>
          ) : !court ? (
            <Alert severity="warning">Không tìm thấy sân.</Alert>
          ) : (
            <>
              {!liveEnabled && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Sân này hiện <strong>chưa bật LIVE config</strong>. Bạn vẫn có
                  thể mở studio và phát thủ công, nhưng nên bật LIVE ở Live
                  Setup để đồng bộ.
                </Alert>
              )}

              {defaultUrl && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  Gợi ý URL hiện tại của sân: <strong>{defaultUrl}</strong>
                </Alert>
              )}

              {/* ✅ BỎ pollIntervalMs - chỉ dùng polling ở page level */}
              <LiveStudioCourts
                courtId={courtId}
                matchId={currentMatchId}
                wsUrl={urls.wsUrl}
                apiUrl={urls.overlayApiUrl}
                autoOnLive
                autoCreateIfMissing
                /* ← BỎ pollIntervalMs */
                fetchCourtState={fetchCourtState}
                resolveTargets={resolveTargets}
                createLive={createLive}
              />

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ mt: 2 }}
              >
                <Button variant="outlined" onClick={() => navigate(-1)}>
                  Quay lại
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate(`/tournament/${tid}/manage`)}
                >
                  Về trang quản lý giải
                </Button>
              </Stack>
            </>
          )}
        </Container>
      </Box>
    </Box>
  );
}
