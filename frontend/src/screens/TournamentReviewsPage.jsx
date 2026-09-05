// src/screens/TournamentReviewsPage.jsx — Trang đánh giá giải đấu (MUI, /tournament/:id/reviews)
import { useParams, Link } from "react-router-dom";
import { Container, Box, Typography, Button, Stack } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { useGetTournamentQuery } from "../slices/tournamentsApiSlice";
import TournamentReviews from "../components/TournamentReviews.jsx";

export default function TournamentReviewsPage() {
  const { id } = useParams();
  const { data: t } = useGetTournamentQuery(id, { skip: !id });

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Button
          component={Link}
          to={`/tournament/${id}`}
          startIcon={<ArrowBackRoundedIcon />}
          size="small"
          color="inherit"
        >
          Về trang giải
        </Button>
      </Stack>
      {t?.name && (
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>
          {t.name}
        </Typography>
      )}
      <Box sx={{ mt: -2 }}>
        <TournamentReviews tournamentId={id} />
      </Box>
    </Container>
  );
}
