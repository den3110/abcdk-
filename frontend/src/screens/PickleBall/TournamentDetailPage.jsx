import {
  Box,
  Container,
  Typography,
  Skeleton, // 👈 thêm Skeleton
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import { TournamentWeatherSection } from "../TournamentWeatherSection";

function TournamentDetailPage() {
  const { id } = useParams();

  const {
    data: tournament,
    isLoading,
    isError,
    error,
  } = useGetTournamentQuery(id, {
    skip: !id,
  });

  if (!id) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3 }}>
          <Typography>Thiếu id giải đấu</Typography>
        </Box>
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Skeleton cho title / tên giải */}
          <Skeleton variant="text" width={260} height={40} />

          {/* Skeleton cho weather card */}
          <Box
            sx={{
              mt: 1,
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Skeleton variant="text" width={180} height={28} />
            <Skeleton variant="text" width={140} height={24} />
            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <Skeleton variant="rounded" width={80} height={80} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
                <Skeleton variant="text" width="70%" />
              </Box>
            </Box>
          </Box>
        </Box>
      </Container>
    );
  }

  if (isError) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3 }}>
          <Typography color="error">
            Không tải được thông tin giải đấu
          </Typography>
          {process.env.NODE_ENV === "development" && (
            <Typography variant="body2">{JSON.stringify(error)}</Typography>
          )}
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ mt: 3 }}>
        <TournamentWeatherSection
          tournamentId={id}
          locationLabel={tournament?.location || tournament?.name}
        />
      </Box>
    </Container>
  );
}

export default TournamentDetailPage;
