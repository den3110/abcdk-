// pages/StreamingDashboard.jsx
// Dashboard chọn sân để stream

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Paper,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
} from "@mui/material";
import {
  Stadium,
  PlayArrow,
  OpenInNew,
  Refresh,
  LiveTv,
} from "@mui/icons-material";
import { useAdminListCourtsByTournamentQuery } from "../../slices/courtsApiSlice";

// Import API hooks (điều chỉnh path cho phù hợp với project của bạn)
// import { useAdminListCourtsByTournamentQuery } from "../features/courts/courtsApiSlice";

export default function StreamingDashboard() {
  const navigate = useNavigate();

  // State để chọn tournament
  const [selectedTournamentId, setSelectedTournamentId] = useState("");

  // Giả sử bạn có danh sách tournaments (có thể lấy từ API hoặc Redux store)
  // Thay thế bằng hook thực tế của bạn
  const tournaments = [
    { _id: "tournament_1", name: "Giải A" },
    { _id: "tournament_2", name: "Giải B" },
  ];

  // Lấy danh sách sân theo tournament
  const {
    data: courtsData,
    isLoading,
    error,
    refetch,
  } = useAdminListCourtsByTournamentQuery(
    { tid: selectedTournamentId },
    { skip: !selectedTournamentId }
  );

  const courts = courtsData || [];

  const handleOpenStreaming = (courtId, newTab = false) => {
    const url = `/streaming/${courtId}`;
    if (newTab) {
      window.open(url, "_blank");
    } else {
      navigate(url);
    }
  };

  // Helper để hiển thị status sân
  const getStatusChip = (court) => {
    const statusMap = {
      idle: { label: "Rảnh", color: "default" },
      assigned: { label: "Đã gán", color: "info" },
      live: { label: "Đang live", color: "error" },
      maintenance: { label: "Bảo trì", color: "warning" },
    };

    const status = statusMap[court.status] || statusMap.idle;

    return (
      <Chip
        label={status.label}
        color={status.color}
        size="small"
        icon={court.status === "live" ? <LiveTv /> : undefined}
      />
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: 4 }}>
      <Container maxWidth="xl">
        {/* Header */}
        <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            <Stadium sx={{ fontSize: 40, color: "primary.main" }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h4" fontWeight="bold">
                Streaming Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Chọn sân để bắt đầu streaming
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={refetch}
              disabled={!selectedTournamentId || isLoading}
            >
              Refresh
            </Button>
          </Box>

          {/* Tournament selector */}
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>Chọn giải đấu</InputLabel>
            <Select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
              label="Chọn giải đấu"
            >
              <MenuItem value="">-- Chọn giải --</MenuItem>
              {tournaments.map((t) => (
                <MenuItem key={t._id} value={t._id}>
                  {t.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Paper>

        {/* No tournament selected */}
        {!selectedTournamentId && (
          <Alert severity="info">
            Vui lòng chọn giải đấu để xem danh sách sân
          </Alert>
        )}

        {/* Loading */}
        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error */}
        {error && (
          <Alert severity="error">
            Lỗi khi tải danh sách sân: {error?.message || "Unknown error"}
          </Alert>
        )}

        {/* Courts grid */}
        {selectedTournamentId && !isLoading && !error && (
          <>
            {courts.length === 0 ? (
              <Alert severity="warning">Không có sân nào trong giải này</Alert>
            ) : (
              <>
                <Box
                  sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}
                >
                  <Typography variant="h6">
                    Danh sách sân ({courts.length})
                  </Typography>
                  <Chip
                    label={`${courts.filter((c) => c.status === "live").length
                      } đang live`}
                    color="error"
                    size="small"
                  />
                </Box>

                <Grid container spacing={2}>
                  {courts.map((court) => (
                    <Grid item size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={court._id}>
                      <Card
                        elevation={2}
                        sx={{
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          transition: "all 0.3s",
                          "&:hover": {
                            elevation: 8,
                            transform: "translateY(-4px)",
                          },
                          // Highlight nếu đang live
                          ...(court.status === "live" && {
                            borderLeft: "4px solid",
                            borderColor: "error.main",
                          }),
                        }}
                      >
                        <CardContent sx={{ flex: 1 }}>
                          {/* Court name */}
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              mb: 1,
                            }}
                          >
                            <Stadium color="primary" />
                            <Typography variant="h6" fontWeight="bold">
                              {court.name}
                            </Typography>
                          </Box>

                          {/* Status */}
                          <Box sx={{ mb: 1 }}>{getStatusChip(court)}</Box>

                          <Divider sx={{ my: 1 }} />

                          {/* Court info */}
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            gutterBottom
                          >
                            Cluster: {court.cluster || "Main"}
                          </Typography>

                          {/* Current match info */}
                          {court.currentMatch && (
                            <Alert severity="info" sx={{ mt: 1, py: 0.5 }}>
                              <Typography variant="caption">
                                Có trận đang chơi
                              </Typography>
                            </Alert>
                          )}

                          {/* Live config info */}
                          {court.liveConfig?.enabled && (
                            <Chip
                              label="Auto Live Enabled"
                              color="success"
                              size="small"
                              sx={{ mt: 1 }}
                            />
                          )}
                        </CardContent>

                        <CardActions sx={{ p: 2, pt: 0 }}>
                          <Button
                            variant="contained"
                            fullWidth
                            startIcon={<PlayArrow />}
                            onClick={() => handleOpenStreaming(court._id)}
                            color={
                              court.status === "live" ? "error" : "primary"
                            }
                          >
                            {court.status === "live"
                              ? "Xem Stream"
                              : "Bắt đầu Stream"}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => handleOpenStreaming(court._id, true)}
                            sx={{ ml: 1 }}
                          >
                            <OpenInNew fontSize="small" />
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </>
        )}

        {/* Quick access section */}
        {selectedTournamentId && courts.length > 0 && (
          <Paper elevation={2} sx={{ p: 3, mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              🚀 Quick Access
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Mở nhanh streaming cho sân:
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 2 }}>
              {courts.slice(0, 6).map((court) => (
                <Chip
                  key={court._id}
                  label={court.name}
                  onClick={() => handleOpenStreaming(court._id)}
                  clickable
                  color={court.status === "live" ? "error" : "default"}
                  icon={<Stadium />}
                />
              ))}
            </Box>
          </Paper>
        )}

        {/* Instructions */}
        <Paper elevation={1} sx={{ p: 3, mt: 3, bgcolor: "info.light" }}>
          <Typography variant="body2" component="div">
            <strong>💡 Hướng dẫn:</strong>
            <ul style={{ marginTop: 8, marginBottom: 0 }}>
              <li>Chọn giải đấu để xem danh sách sân</li>
              <li>Click "Bắt đầu Stream" để mở trang streaming của sân</li>
              <li>
                Click icon <OpenInNew fontSize="small" /> để mở trong tab mới
              </li>
              <li>Sân đang live sẽ được highlight màu đỏ</li>
              <li>Hệ thống tự động detect và stream theo trận</li>
            </ul>
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
}
