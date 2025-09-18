// src/pages/ServiceUnavailable.jsx
import React from "react";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Paper,
  LinearProgress,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import HomeIcon from "@mui/icons-material/Home";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { Link, useSearchParams } from "react-router-dom";

const AUTO_RETRY_SECONDS = 15;

export default function ServiceUnavailable({
  homePath = "/",
  supportEmail = "contact@pickletour.vn",
  onRetry, // optional: custom retry handler
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [search] = useSearchParams();
  const reqId = search.get("reqId") || search.get("requestId") || null;

  // Countdown & auto retry
  const [sec, setSec] = React.useState(AUTO_RETRY_SECONDS);
  React.useEffect(() => {
    const t = setInterval(() => setSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => {
    if (sec === 0) {
      if (typeof onRetry === "function") onRetry();
      else window.location.reload();
    }
  }, [sec, onRetry]);

  const handleRetry = () => {
    if (typeof onRetry === "function") onRetry();
    else window.location.reload();
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: { xs: 4, md: 6 },
        background:
          theme.palette.mode === "dark"
            ? `radial-gradient(1200px 600px at 10% -10%, rgba(144,202,249,0.08), transparent),
               radial-gradient(800px 400px at 110% 110%, rgba(129,199,132,0.08), transparent)`
            : `radial-gradient(1200px 600px at 10% -10%, rgba(25,118,210,0.06), transparent),
               radial-gradient(800px 400px at 110% 110%, rgba(46,125,50,0.06), transparent)`,
      }}
    >
      <Container maxWidth="md" sx={{ width: "100%" }}>
        <Paper
          elevation={0}
          sx={{
            borderRadius: 3,
            p: { xs: 3, sm: 4 },
            border: "1px solid",
            borderColor: "divider",
            backdropFilter: "blur(6px)",
            bgcolor:
              theme.palette.mode === "dark"
                ? "rgba(22,24,28,0.6)"
                : "rgba(255,255,255,0.7)",
          }}
        >
          {/* Header */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems="center"
          >
            <Box
              sx={{
                width: 84,
                height: 84,
                borderRadius: "22px",
                display: "grid",
                placeItems: "center",
                bgcolor:
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(25,118,210,0.08)",
                flexShrink: 0,
              }}
            >
              <ErrorOutlineIcon sx={{ fontSize: 44, color: "warning.main" }} />
            </Box>

            <Box sx={{ flex: 1, textAlign: { xs: "center", sm: "left" } }}>
              <Typography
                variant={isMobile ? "h3" : "h2"}
                fontWeight={800}
                lineHeight={1.1}
              >
                503
              </Typography>
              <Typography variant="h5" fontWeight={700} sx={{ mt: 0.5 }}>
                Dịch vụ tạm thời gián đoạn
              </Typography>
              <Typography sx={{ mt: 1.25 }} color="text.secondary">
                Máy chủ đang bận hoặc hệ thống đang bảo trì. Bạn vui lòng thử
                lại sau ít phút. Chúng tôi rất xin lỗi vì sự bất tiện này.
              </Typography>
            </Box>
          </Stack>

          {/* Illustration */}
          <Box
            aria-hidden
            sx={{
              mt: 3,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg
              width="100%"
              height="160"
              viewBox="0 0 640 160"
              role="img"
              focusable="false"
              style={{ maxWidth: 720, opacity: 0.9 }}
            >
              <defs>
                <linearGradient id="g1" x1="0" x2="1">
                  <stop
                    offset="0%"
                    stopColor={theme.palette.primary.light}
                    stopOpacity="0.4"
                  />
                  <stop
                    offset="100%"
                    stopColor={theme.palette.success.light}
                    stopOpacity="0.4"
                  />
                </linearGradient>
              </defs>
              <rect
                x="0"
                y="120"
                width="640"
                height="24"
                fill="url(#g1)"
                rx="12"
              />
              <g opacity="0.6">
                <circle
                  cx="80"
                  cy="92"
                  r="8"
                  fill={theme.palette.warning.main}
                />
                <circle
                  cx="160"
                  cy="82"
                  r="10"
                  fill={theme.palette.primary.main}
                />
                <circle
                  cx="240"
                  cy="88"
                  r="7"
                  fill={theme.palette.success.main}
                />
                <circle
                  cx="320"
                  cy="78"
                  r="9"
                  fill={theme.palette.error.main}
                />
                <circle
                  cx="400"
                  cy="88"
                  r="7"
                  fill={theme.palette.secondary.main}
                />
                <circle
                  cx="480"
                  cy="82"
                  r="10"
                  fill={theme.palette.info.main}
                />
                <circle
                  cx="560"
                  cy="92"
                  r="8"
                  fill={theme.palette.warning.main}
                />
              </g>
            </svg>
          </Box>

          {/* Countdown */}
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={((AUTO_RETRY_SECONDS - sec) / AUTO_RETRY_SECONDS) * 100}
              sx={{ height: 8, borderRadius: 999 }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.75, textAlign: "center" }}
            >
              Tự thử lại sau <b>{sec}s</b>…
            </Typography>
          </Box>

          {/* Actions */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ mt: 3 }}
            justifyContent="center"
          >
            <Button
              onClick={handleRetry}
              startIcon={<RefreshIcon />}
              variant="contained"
              size="large"
            >
              Thử lại ngay
            </Button>
            <Button
              component={Link}
              to={homePath}
              startIcon={<HomeIcon />}
              variant="outlined"
              size="large"
            >
              Về trang chủ
            </Button>
            <Button
              href={`mailto:${supportEmail}`}
              startIcon={<SupportAgentIcon />}
              variant="text"
              size="large"
            >
              Liên hệ hỗ trợ
            </Button>
          </Stack>

          {/* Diagnostics */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ mt: 3 }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="center"
          >
            <Typography variant="caption" color="text.secondary">
              Mã trạng thái: <b>503</b>
            </Typography>
            {reqId && (
              <Typography variant="caption" color="text.secondary">
                Request ID: <code>{reqId}</code>
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Thời gian: {new Date().toLocaleString("vi-VN")}
            </Typography>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
