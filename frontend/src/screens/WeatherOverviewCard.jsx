// src/components/weather/WeatherOverviewCard.jsx
import React, { useMemo } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Grid from "@mui/material/Grid";

// Icons
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import NightlightIcon from "@mui/icons-material/Nightlight";
import CloudIcon from "@mui/icons-material/Cloud";
import CloudQueueIcon from "@mui/icons-material/CloudQueue";
import GrainIcon from "@mui/icons-material/Grain";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import AirIcon from "@mui/icons-material/Air";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import DeviceThermostatIcon from "@mui/icons-material/DeviceThermostat";
import VisibilityIcon from "@mui/icons-material/Visibility";

function getConditionLabel(code) {
  const map = {
    Clear: "Trời quang",
    MostlyClear: "Gần như quang",
    PartlyCloudy: "Ít mây",
    MostlyCloudy: "Nhiều mây",
    Cloudy: "U ám",
    Drizzle: "Mưa phùn",
    Rain: "Mưa",
    HeavyRain: "Mưa to",
    Thunderstorms: "Giông bão",
    Fog: "Sương mù",
    Haze: "Mù khói",
    Breezy: "Gió nhẹ",
    Windy: "Gió mạnh",
  };
  return map[code] || code || "Không rõ";
}

function getConditionIcon(code, daylight) {
  if (code === "Clear" || code === "MostlyClear") {
    return daylight ? <WbSunnyIcon fontSize="large" /> : <NightlightIcon fontSize="large" />;
  }
  if (code === "PartlyCloudy") return <CloudQueueIcon fontSize="large" />;
  if (code === "MostlyCloudy" || code === "Cloudy") return <CloudIcon fontSize="large" />;
  if (code === "Thunderstorms") return <ThunderstormIcon fontSize="large" />;
  if (code === "Drizzle" || code === "Rain" || code === "HeavyRain") {
    return <GrainIcon fontSize="large" />;
  }
  return daylight ? <WbSunnyIcon fontSize="large" /> : <NightlightIcon fontSize="large" />;
}

function formatHour(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function uvLevel(uv) {
  if (uv == null) return null;
  if (uv < 3) return "Thấp";
  if (uv < 6) return "Vừa";
  if (uv < 8) return "Cao";
  if (uv < 11) return "Rất cao";
  return "Nguy hiểm";
}

/**
 * props.weather = {
 *   current,
 *   hourly: [],
 *   daily: [],
 *   alerts: [],
 *   attribution
 * }
 */
export function WeatherOverviewCard({ weather, title = "Thời tiết tổng quan", locationLabel }) {
  const current = weather?.current;
  const hourly = useMemo(() => (weather?.hourly || []).slice(0, 6), [weather]);
  const daily = useMemo(() => (weather?.daily || []).slice(0, 5), [weather]);

  if (!current) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary" fontStyle="italic">
            Chưa có dữ liệu thời tiết.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const conditionText = getConditionLabel(current.conditionCode);
  const uvText = uvLevel(current.uvIndex);
  const alerts = weather?.alerts || [];

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardHeader
        title={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6" fontWeight={600}>
              {title}
            </Typography>
            {locationLabel && (
              <Typography variant="body2" color="text.secondary">
                • {locationLabel}
              </Typography>
            )}
          </Stack>
        }
        subheader={
          current.asOf
            ? `Cập nhật lúc ${formatHour(current.asOf)}`
            : undefined
        }
      />

      <CardContent sx={{ pt: 0 }}>
        <Grid container spacing={2}>
          {/* Khối bên trái: thời tiết hiện tại */}
          <Grid size={{ xs: 12, md: 5 }}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: (theme) =>
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.04)",
                }}
              >
                {getConditionIcon(current.conditionCode, current.daylight)}
              </Box>
              <Box>
                <Typography variant="h3" fontWeight={600}>
                  {Math.round(current.temperature)}°
                </Typography>
                <Typography variant="body1">
                  {conditionText}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
                  <Chip
                    size="small"
                    icon={<DeviceThermostatIcon />}
                    label={`Cảm giác: ${Math.round(
                      current.temperatureApparent
                    )}°`}
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    icon={<WaterDropIcon />}
                    label={`Độ ẩm: ${Math.round(current.humidity * 100)}%`}
                    variant="outlined"
                  />
                  {typeof current.uvIndex === "number" && (
                    <Chip
                      size="small"
                      label={`UV ${current.uvIndex} • ${uvText}`}
                      color={current.uvIndex >= 6 ? "warning" : "default"}
                      variant="outlined"
                    />
                  )}
                </Stack>
              </Box>
            </Stack>

            <Stack direction="row" spacing={2} sx={{ mt: 2 }} flexWrap="wrap">
              <Stack direction="row" spacing={1} alignItems="center">
                <AirIcon fontSize="small" />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Gió
                  </Typography>
                  <Typography variant="body2">
                    {Math.round(current.windSpeed)} km/h
                    {current.windGust
                      ? ` (giật ${Math.round(current.windGust)} km/h)`
                      : ""}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <VisibilityIcon fontSize="small" />
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Tầm nhìn
                  </Typography>
                  <Typography variant="body2">
                    {Math.round(current.visibility / 1000)} km
                  </Typography>
                </Box>
              </Stack>
            </Stack>

            {alerts.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography
                  variant="body2"
                  color="error"
                  fontWeight={600}
                  sx={{ mb: 0.5 }}
                >
                  ⚠ Có cảnh báo thời tiết
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {alerts[0].details || alerts[0].description || "Vui lòng kiểm tra chi tiết trên trang cảnh báo thời tiết."}
                </Typography>
              </Box>
            )}

            {weather.attribution?.serviceName && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 2, display: "block" }}
              >
                Dữ liệu thời tiết bởi {weather.attribution.serviceName}
              </Typography>
            )}
          </Grid>

          {/* Divider */}
          <Grid
            size={{ xs: 12, md: 7 }}
            sx={{
              borderLeft: {
                xs: "none",
                md: (theme) =>
                  theme.palette.mode === "dark"
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(0,0,0,0.06)",
              },
              pl: { xs: 0, md: 2 },
              mt: { xs: 2, md: 0 },
            }}
          >
            {/* Giờ tới */}
            <Typography variant="subtitle2" gutterBottom>
              Trong vài giờ tới
            </Typography>
            {hourly.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Không có dữ liệu dự báo theo giờ.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  overflowX: "auto",
                  pb: 1,
                  mb: 2,
                }}
              >
                {hourly.map((h) => {
                  const chance =
                    typeof h.precipitationChance === "number"
                      ? Math.round(h.precipitationChance * 100)
                      : null;
                  return (
                    <Box
                      key={h.forecastStart}
                      sx={{
                        minWidth: 88,
                        px: 1,
                        py: 1,
                        borderRadius: 2,
                        border: (theme) =>
                          theme.palette.mode === "dark"
                            ? "1px solid rgba(255,255,255,0.12)"
                            : "1px solid rgba(0,0,0,0.08)",
                      }}
                    >
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        {formatHour(h.forecastStart)}
                      </Typography>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 0.5,
                        }}
                      >
                        <Typography variant="body2" fontWeight={500}>
                          {Math.round(h.temperature)}°
                        </Typography>
                        <Tooltip title={getConditionLabel(h.conditionCode)}>
                          <Box>{getConditionIcon(h.conditionCode, h.daylight)}</Box>
                        </Tooltip>
                      </Box>
                      {chance != null && (
                        <Typography
                          variant="caption"
                          color={
                            chance >= 60
                              ? "error.main"
                              : chance >= 30
                              ? "warning.main"
                              : "text.secondary"
                          }
                          sx={{ display: "block", mt: 0.5 }}
                        >
                          {chance}% mưa
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}

            <Divider sx={{ mb: 2 }} />

            {/* Nhiều ngày tới */}
            <Typography variant="subtitle2" gutterBottom>
              Dự báo vài ngày tới
            </Typography>
            {daily.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Không có dữ liệu dự báo theo ngày.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {daily.map((d) => (
                  <Box
                    key={d.forecastStart}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      px: 1,
                      py: 0.75,
                      borderRadius: 2,
                      "&:hover": {
                        bgcolor: (theme) =>
                          theme.palette.mode === "dark"
                            ? "rgba(255,255,255,0.04)"
                            : "rgba(0,0,0,0.02)",
                      },
                    }}
                  >
                    <Box sx={{ minWidth: 120 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {formatDate(d.forecastStart)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {getConditionLabel(d.conditionCode)}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        minWidth: 120,
                        justifyContent: "center",
                      }}
                    >
                      {getConditionIcon(d.conditionCode, true)}
                      <Typography variant="body2">
                        {Math.round(d.temperatureMin)}° /{" "}
                        <b>{Math.round(d.temperatureMax)}°</b>
                      </Typography>
                    </Box>

                    <Box sx={{ minWidth: 100, textAlign: "right" }}>
                      {typeof d.precipitationChance === "number" && (
                        <Typography
                          variant="caption"
                          color={
                            d.precipitationChance >= 0.6
                              ? "error.main"
                              : d.precipitationChance >= 0.3
                              ? "warning.main"
                              : "text.secondary"
                          }
                        >
                          {Math.round(d.precipitationChance * 100)}% mưa
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
