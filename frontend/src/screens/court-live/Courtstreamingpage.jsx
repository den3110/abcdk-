// pages/CourtStreamingPage.jsx
// Trang streaming riêng cho từng sân, nhận courtId từ URL
// URL patterns hỗ trợ:
//   - /streaming/:courtId  (ví dụ: /streaming/court_123)
//   - /streaming?courtId=court_123

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Paper,
  Typography,
  Alert,
  Button,
  CircularProgress,
  Breadcrumbs,
  Link,
} from "@mui/material";
import { Home, Stadium, ArrowBack } from "@mui/icons-material";
import FacebookLiveStreamerAutoRTK from "./Facebooklivestreamerautortk";
import { useGetCourtInfoQuery } from "../../slices/liveStreamingApiSlice";
// import FacebookLiveStreamerAutoRTK from "../features/streaming/FacebookLiveStreamerAutoRTK";
// import { useGetCourtInfoQuery } from "../features/streaming/liveStreamingApiSlice";

export default function CourtStreamingPage() {
  const navigate = useNavigate();

  // Hỗ trợ 2 patterns:
  // 1. /streaming/:courtId
  const { courtId: courtIdFromParams } = useParams();

  // 2. /streaming?courtId=xxx
  const [searchParams] = useSearchParams();
  const courtIdFromQuery = searchParams.get("courtId");

  // Ưu tiên params trước, fallback sang query
  const courtId = courtIdFromParams || courtIdFromQuery;

  // Lấy thông tin sân để hiển thị tên
  const {
    data: courtInfo,
    isLoading: loadingCourt,
    error: courtError,
  } = useGetCourtInfoQuery(courtId, {
    skip: !courtId,
  });

  // apiUrl: .env full -> .env base -> same-origin
  const apiUrl = useMemo(() => {
    const full = import.meta.env.VITE_API_URL + "/api/overlay/match";
    if (full) return full.replace(/\/+$/, "");

    const apiBase = import.meta.env.VITE_API_URL;

    if (apiBase) return `${apiBase.replace(/\/+$/, "")}/api/overlay/match`;

    return `${import.meta.env.VITE_API_URL}/api/overlay/match`;
  }, []);


  // Nếu không có courtId
  if (!courtId) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">
          <Typography variant="h6" gutterBottom>
            Thiếu Court ID
          </Typography>
          <Typography variant="body2" gutterBottom>
            URL phải có courtId. Ví dụ:
          </Typography>
          <ul>
            <li>
              <code>/streaming/court_123</code>
            </li>
            <li>
              <code>/streaming?courtId=court_123</code>
            </li>
          </ul>
          <Button
            variant="contained"
            onClick={() => navigate("/")}
            sx={{ mt: 2 }}
          >
            Về trang chủ
          </Button>
        </Alert>
      </Container>
    );
  }

  // Loading state
  if (loadingCourt) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress size={60} />
      </Box>
    );
  }

  // Error state
  if (courtError) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">
          <Typography variant="h6" gutterBottom>
            Không thể tải thông tin sân
          </Typography>
          <Typography variant="body2">
            Court ID: <code>{courtId}</code>
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Error: {courtError?.message || JSON.stringify(courtError)}
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate(-1)}
            startIcon={<ArrowBack />}
            sx={{ mt: 2 }}
          >
            Quay lại
          </Button>
        </Alert>
      </Container>
    );
  }

  const courtName = courtInfo?.name || `Court ${courtId}`;
  const tournamentName = courtInfo?.tournament?.name || "Tournament";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {/* Header with breadcrumbs */}
      <Box sx={{ bgcolor: "primary.main", color: "primary.contrastText", py: 2, mb: 3 }}>
        <Container maxWidth="xl">
          <Breadcrumbs
            sx={{
              color: "white",
              "& .MuiBreadcrumbs-separator": { color: "white" },
            }}
          >
            <Link
              component="button"
              onClick={() => navigate("/")}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: "white",
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              <Home fontSize="small" />
              Trang chủ
            </Link>
            <Link
              component="button"
              onClick={() => navigate("/streaming")}
              sx={{
                color: "white",
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              Streaming
            </Link>
            <Typography
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <Stadium fontSize="small" />
              {courtName}
            </Typography>
          </Breadcrumbs>

          <Typography variant="h4" fontWeight="bold" sx={{ mt: 2 }}>
            🎥 Live Streaming - {courtName}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            {tournamentName}
          </Typography>
        </Container>
      </Box>

      {/* Main streaming component */}
      <FacebookLiveStreamerAutoRTK
        courtId={courtId}
        wsUrl={"wss://pickletour.vn/ws/rtmp"}
        enableAutoMode={true}
        pollInterval={5000}
        apiUrl={apiUrl}
      />
    </Box>
  );
}
