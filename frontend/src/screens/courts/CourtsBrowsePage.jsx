/* eslint-disable react/prop-types */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  TextField,
  InputAdornment,
  Grid,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  Skeleton,
  Button,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PlaceIcon from "@mui/icons-material/Place";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import StorefrontIcon from "@mui/icons-material/Storefront";
import { useListVenuesQuery } from "../../slices/venuesApiSlice";
import { imgSrc, fmtVND } from "./courtShared";

function VenueCard({ venue, onOpen }) {
  const cover = imgSrc(venue?.images?.[0]);
  return (
    <Card
      elevation={0}
      sx={{
        height: "100%",
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        transition: "transform .15s ease, box-shadow .15s ease",
        "&:hover": { transform: "translateY(-3px)", boxShadow: 4 },
      }}
    >
      <CardActionArea
        onClick={() => onOpen(venue._id)}
        sx={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "stretch" }}
      >
        {cover ? (
          <CardMedia component="img" height="160" image={cover} alt={venue.name} />
        ) : (
          <Box
            sx={{
              height: 160,
              display: "grid",
              placeItems: "center",
              background:
                "linear-gradient(135deg, rgba(25,118,210,.15), rgba(76,175,80,.15))",
            }}
          >
            <SportsTennisIcon sx={{ fontSize: 56, color: "primary.main", opacity: 0.6 }} />
          </Box>
        )}
        <CardContent sx={{ flex: 1, width: "100%" }}>
          <Typography variant="subtitle1" fontWeight={800} noWrap title={venue.name}>
            {venue.name}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, color: "text.secondary" }}>
            <PlaceIcon sx={{ fontSize: 16 }} />
            <Typography variant="body2" noWrap>
              {venue.address || venue.province || "—"}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" icon={<SportsTennisIcon />} label={`${venue.courtCount || 0} sân`} />
            {venue.province ? <Chip size="small" variant="outlined" label={venue.province} /> : null}
            {venue.defaultPricePerHour > 0 ? (
              <Chip
                size="small"
                color="primary"
                label={`từ ${fmtVND(venue.defaultPricePerHour)}/giờ`}
              />
            ) : null}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function CourtsBrowsePage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [applied, setApplied] = useState({ keyword: "", province: "" });

  const { data, isLoading, isFetching } = useListVenuesQuery({
    keyword: applied.keyword,
    province: applied.province,
    page: 1,
    limit: 30,
  });

  const items = data?.items || [];
  const loading = isLoading || isFetching;

  const doSearch = () => setApplied({ keyword: keyword.trim(), province: province.trim() });
  const onKey = (e) => {
    if (e.key === "Enter") doSearch();
  };

  const skeletons = useMemo(() => Array.from({ length: 8 }), []);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={900}>
            Đặt sân
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tìm sân pickleball gần bạn và đặt theo khung giờ.
          </Typography>
        </Box>
        <Button
          startIcon={<StorefrontIcon />}
          variant="outlined"
          onClick={() => navigate("/owner/venues")}
        >
          Quản lý sân của tôi
        </Button>
      </Stack>

      <Box
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 3,
          borderRadius: 3,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} sm={6} md={7}>
            <TextField
              fullWidth
              size="small"
              placeholder="Tên sân hoặc địa chỉ…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={onKey}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={8} sm={4} md={3}>
            <TextField
              fullWidth
              size="small"
              placeholder="Tỉnh/TP"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              onKeyDown={onKey}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <PlaceIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={4} sm={2} md={2}>
            <Button fullWidth variant="contained" onClick={doSearch}>
              Tìm
            </Button>
          </Grid>
        </Grid>
      </Box>

      <Grid container spacing={2}>
        {loading
          ? skeletons.map((_, i) => (
              <Grid item xs={12} sm={6} md={3} key={i}>
                <Skeleton variant="rounded" height={280} sx={{ borderRadius: 3 }} />
              </Grid>
            ))
          : items.map((v) => (
              <Grid item xs={12} sm={6} md={3} key={v._id}>
                <VenueCard venue={v} onOpen={(id) => navigate(`/courts/${id}`)} />
              </Grid>
            ))}
      </Grid>

      {!loading && items.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <SportsTennisIcon sx={{ fontSize: 64, opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>Không tìm thấy sân phù hợp.</Typography>
        </Box>
      )}
    </Container>
  );
}
