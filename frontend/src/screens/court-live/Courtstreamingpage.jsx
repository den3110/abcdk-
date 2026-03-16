// pages/CourtStreamingPage.jsx
// Trang streaming riêng cho từng sân, nhận courtId từ URL
// URL patterns hỗ trợ:
//   - /streaming/:courtId  (ví dụ: /streaming/court_123)
//   - /streaming?courtId=court_123

import { useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
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
import { useLanguage } from "../../context/LanguageContext";
import SEOHead from "../../components/SEOHead";
// import FacebookLiveStreamerAutoRTK from "../features/streaming/FacebookLiveStreamerAutoRTK";
// import { useGetCourtInfoQuery } from "../features/streaming/liveStreamingApiSlice";

export default function CourtStreamingPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();

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
            {t("live.streamingPage.missingCourtIdTitle")}
          </Typography>
          <Typography variant="body2" gutterBottom>
            {t("live.streamingPage.missingCourtIdBody")}
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
            {t("live.streamingPage.home")}
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
            {t("live.streamingPage.loadCourtErrorTitle")}
          </Typography>
          <Typography variant="body2">
            {t("live.streamingPage.courtId")}: <code>{courtId}</code>
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("live.streamingPage.errorLabel")}:{" "}
            {courtError?.message || JSON.stringify(courtError)}
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate(-1)}
            startIcon={<ArrowBack />}
            sx={{ mt: 2 }}
          >
            {t("live.streamingPage.back")}
          </Button>
        </Alert>
      </Container>
    );
  }

  const courtName = courtInfo?.name || `Court ${courtId}`;
  const tournamentName =
    courtInfo?.tournament?.name || t("live.streamingPage.tournamentFallback");

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <SEOHead
        title={t("live.streamingPage.seoTitle", {
          court: courtName,
          tournament: tournamentName,
        })}
        description={t("live.streamingPage.seoDescription", {
          court: courtName,
          tournament: tournamentName,
        })}
        path={`/streaming/${courtId}`}
      />
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
              {t("live.streamingPage.home")}
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
              {t("live.streamingPage.breadcrumbsStreaming")}
            </Link>
            <Typography
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <Stadium fontSize="small" />
              {courtName}
            </Typography>
          </Breadcrumbs>

          <Typography variant="h4" fontWeight="bold" sx={{ mt: 2 }}>
            {t("live.streamingPage.liveTitle", { court: courtName })}
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
