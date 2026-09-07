/* eslint-disable react/prop-types */
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  Alert,
  CircularProgress,
} from "@mui/material";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { useListFavoriteVenuesQuery } from "../../slices/venuesApiSlice";
import { imgSrc, fmtVND } from "./courtShared";

function FavoriteCard({ venue, onOpen }) {
  const cover = imgSrc(venue?.images?.[0]);
  return (
    <Card
      variant="outlined"
      onClick={() => onOpen(venue._id)}
      sx={{
        height: "100%",
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      {cover ? (
        <CardMedia
          component="img"
          image={cover}
          alt={venue.name}
          sx={{ height: 160, objectFit: "cover" }}
        />
      ) : (
        <Box sx={{ height: 160, display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
          <SportsTennisIcon sx={{ fontSize: 52, color: "text.disabled" }} />
        </Box>
      )}
      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.25 }} noWrap title={venue.name}>
          {venue.name}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", minWidth: 0 }}>
          <PlaceOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
          <Typography variant="body2" noWrap>
            {[venue.address, venue.province].filter(Boolean).join(", ") || "Chưa cập nhật"}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        {venue.defaultPricePerHour > 0 ? (
          <Chip
            size="small"
            color="primary"
            label={`từ ${fmtVND(venue.defaultPricePerHour)}/giờ`}
            sx={{ fontWeight: 700, alignSelf: "flex-start", mt: 0.5 }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function FavoriteVenuesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isFetching } = useListFavoriteVenuesQuery();
  const items = Array.isArray(data) ? data : data?.items || [];
  const loading = isLoading || isFetching;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
        <FavoriteIcon color="error" />
        <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: "-0.02em" }}>
          Sân yêu thích
        </Typography>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Alert severity="info">
          Chưa có sân yêu thích. Mở một cụm sân và bấm ♥ để lưu.
        </Alert>
      ) : (
        <Grid container spacing={2.5}>
          {items.map((v) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={v._id}>
              <FavoriteCard venue={v} onOpen={(id) => navigate(`/courts/${id}`)} />
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
