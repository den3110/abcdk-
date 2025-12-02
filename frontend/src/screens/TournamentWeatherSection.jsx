import React from "react";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Skeleton from "@mui/material/Skeleton";
import { WeatherOverviewCard } from "./WeatherOverviewCard";
import { useGetTournamentWeatherQuery } from "../slices/weatherApiSlice";

export function TournamentWeatherSection({ tournamentId, locationLabel }) {
  // nếu chưa có tournamentId thì khỏi gọi
  const {
    data: weather,
    isLoading,
    isFetching,
    isError,
    error,
  } = useGetTournamentWeatherQuery(tournamentId, {
    skip: !tournamentId,
  });

  if (!tournamentId) return null;

  // 🔄 Skeleton khi loading / fetching
  if (isLoading || isFetching) {
    return (
      <Box
        sx={{
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {/* title */}
        <Skeleton variant="text" width={220} height={32} />

        {/* location */}
        <Skeleton variant="text" width={260} height={24} />

        {/* khối current weather */}
        <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
          <Skeleton
            variant="rounded"
            width={90}
            height={90}
            sx={{ borderRadius: 3 }}
          />
          <Box
            sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}
          >
            <Skeleton variant="text" width="50%" />
            <Skeleton variant="text" width="40%" />
            <Skeleton variant="text" width="60%" />
          </Box>
        </Box>

        {/* mini forecast skeleton */}
        <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <Box
              key={idx}
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="rounded" width="100%" height={40} />
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  // ❌ Lỗi
  if (isError) {
    // RTK Query error có thể là { status, data } hoặc SerializedError
    const message =
      error?.data?.message ||
      error?.error ||
      "Không lấy được dữ liệu thời tiết.";

    return (
      <Alert severity="warning" sx={{ borderRadius: 2 }}>
        {message}
      </Alert>
    );
  }

  if (!weather) return null;

  // ✅ Data OK
  return (
    <WeatherOverviewCard
      weather={weather}
      title="Thời tiết tại sân"
      locationLabel={locationLabel}
    />
  );
}
