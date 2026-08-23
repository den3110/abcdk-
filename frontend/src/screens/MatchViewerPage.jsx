// src/screens/MatchViewerPage.jsx — trang chi tiết 1 trận đấu (từ link chia sẻ trên bảng tin)
// Dùng lại MatchContent (đã render đủ tỉ số, set, tay giao, trạng thái, live...).
// Lưu ý: route param đặt tên "matchId" (KHÔNG phải "id") để MatchContent không nhầm
// idParam thành tournamentId.
import { useParams, useNavigate, Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import MatchContent from "./PickleBall/match/MatchContent";
import { useGetMatchPublicQuery } from "../slices/tournamentsApiSlice";

export default function MatchViewerPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const {
    data: match,
    isLoading,
    isError,
    refetch,
  } = useGetMatchPublicQuery(matchId, {
    skip: !matchId,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const tour =
    match?.tournament && typeof match.tournament === "object"
      ? match.tournament
      : null;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", pb: 6 }}>
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Button
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate(-1)}
          sx={{ mb: 2 }}
        >
          Quay lại
        </Button>

        {/* Header giải đấu */}
        {tour && (
          <Box
            component={RouterLink}
            to={`/tournament/${tour._id || tour.id}`}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              p: 1.5,
              mb: 2,
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
              textDecoration: "none",
              color: "inherit",
              "&:hover": { borderColor: "primary.main" },
            }}
          >
            <Avatar
              src={tour.image}
              variant="rounded"
              sx={{ width: 44, height: 44, bgcolor: "primary.main" }}
            >
              <EmojiEventsRoundedIcon />
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                Giải đấu
              </Typography>
              <Typography sx={{ fontWeight: 800 }} noWrap>
                {tour.name || "Giải đấu"}
              </Typography>
            </Box>
          </Box>
        )}

        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
            <CircularProgress />
          </Box>
        ) : isError || !match ? (
          <Box sx={{ textAlign: "center", py: 10 }}>
            <Typography sx={{ fontWeight: 700 }}>
              Không tìm thấy trận đấu
            </Typography>
            <Typography sx={{ color: "text.secondary", mt: 0.5 }}>
              Trận đấu có thể đã bị xoá hoặc chưa công khai.
            </Typography>
            <Button variant="contained" onClick={() => navigate("/feed")} sx={{ mt: 3 }}>
              Về bảng tin
            </Button>
          </Box>
        ) : (
          <Box
            sx={{
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              p: { xs: 1, sm: 2 },
            }}
          >
            <MatchContent
              m={match}
              isLoading={false}
              liveLoading={false}
              onSaved={() => refetch()}
            />
          </Box>
        )}
      </Container>
    </Box>
  );
}
