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
  Chip,
  Stack,
  Skeleton,
  Button,
  useTheme,
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";
import { useListVenuesQuery } from "../../slices/venuesApiSlice";
import { imgSrc, fmtVND } from "./courtShared";

function VenueCard({ venue, onOpen }) {
  const theme = useTheme();
  const cover = imgSrc(venue?.images?.[0]);
  return (
    <Box
      onClick={() => onOpen(venue._id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(venue._id)}
      sx={{
        height: "100%",
        borderRadius: 4,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: "background.paper",
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease, border-color .18s ease",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        "&:hover": {
          transform: "translateY(-4px)",
          borderColor: alpha(theme.palette.primary.main, 0.5),
          boxShadow: `0 14px 34px -16px ${alpha(theme.palette.common.black, 0.5)}`,
        },
        "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
      }}
    >
      <Box sx={{ position: "relative", aspectRatio: "16 / 10", bgcolor: "action.hover" }}>
        {cover ? (
          <Box component="img" src={cover} alt={venue.name} loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.18)}, ${alpha(theme.palette.success.main, 0.18)})` }}>
            <SportsTennisIcon sx={{ fontSize: 52, color: alpha(theme.palette.primary.main, 0.55) }} />
          </Box>
        )}
        {venue.defaultPricePerHour > 0 && (
          <Box
            sx={{
              position: "absolute",
              top: 10,
              right: 10,
              px: 1.25,
              py: 0.4,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.background.paper, 0.92),
              backdropFilter: "blur(4px)",
              fontSize: 12.5,
              fontWeight: 800,
              color: "primary.main",
            }}
          >
            từ {fmtVND(venue.defaultPricePerHour)}
          </Box>
        )}
      </Box>

      <Box sx={{ p: 1.75, flex: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.25 }} noWrap title={venue.name}>
          {venue.name}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", minWidth: 0 }}>
          <PlaceOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
          <Typography variant="body2" noWrap>{venue.address || venue.province || "Chưa cập nhật"}</Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pt: 0.5 }}>
          <Chip
            size="small"
            icon={<SportsTennisIcon sx={{ fontSize: 15 }} />}
            label={`${venue.courtCount || 0} sân`}
            sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.1), color: "primary.main", border: "none" }}
          />
          {venue.province && <Chip size="small" variant="outlined" label={venue.province} sx={{ fontWeight: 500 }} />}
        </Stack>
      </Box>
    </Box>
  );
}

export default function CourtsBrowsePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [applied, setApplied] = useState({ keyword: "", province: "" });

  const { data, isLoading, isFetching } = useListVenuesQuery({ keyword: applied.keyword, province: applied.province, page: 1, limit: 30 });
  const items = data?.items || [];
  const loading = isLoading || isFetching;

  const doSearch = () => setApplied({ keyword: keyword.trim(), province: province.trim() });
  const onKey = (e) => e.key === "Enter" && doSearch();
  const skeletons = useMemo(() => Array.from({ length: 8 }), []);

  const fieldSx = {
    "& .MuiOutlinedInput-root": { borderRadius: 3, bgcolor: "background.paper" },
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
      {/* Hero header */}
      <Box
        sx={{
          borderRadius: 5,
          p: { xs: 2.5, md: 4 },
          mb: 3,
          color: "#fff",
          position: "relative",
          overflow: "hidden",
          background: `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
        }}
      >
        <SportsTennisIcon sx={{ position: "absolute", right: -20, top: -20, fontSize: 200, color: alpha("#fff", 0.08), transform: "rotate(-15deg)" }} />
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "flex-end" }} spacing={1.5} sx={{ position: "relative" }}>
          <Box>
            <Typography sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              Đặt sân pickleball
            </Typography>
            <Typography sx={{ opacity: 0.9, mt: 0.5, fontSize: 14.5 }}>
              Tìm sân quanh bạn, chọn khung giờ và đặt trong vài chạm.
            </Typography>
          </Box>
          <Button
            startIcon={<StorefrontOutlinedIcon />}
            onClick={() => navigate("/owner/venues")}
            sx={{ bgcolor: alpha("#fff", 0.16), color: "#fff", fontWeight: 700, borderRadius: 2.5, backdropFilter: "blur(4px)", "&:hover": { bgcolor: alpha("#fff", 0.26) } }}
          >
            Quản lý sân của tôi
          </Button>
        </Stack>

        {/* Search bar nổi trên hero */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 2.5, position: "relative" }}>
          <TextField
            fullWidth size="small" placeholder="Tên sân hoặc địa chỉ…" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} onKeyDown={onKey}
            sx={fieldSx}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <TextField
            size="small" placeholder="Tỉnh/TP" value={province}
            onChange={(e) => setProvince(e.target.value)} onKeyDown={onKey}
            sx={{ ...fieldSx, minWidth: { sm: 200 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><PlaceOutlinedIcon fontSize="small" /></InputAdornment> }}
          />
          <Button variant="contained" onClick={doSearch} sx={{ bgcolor: "#fff", color: "primary.main", fontWeight: 800, borderRadius: 3, px: 3, boxShadow: "none", "&:hover": { bgcolor: alpha("#fff", 0.9), boxShadow: "none" } }}>
            Tìm
          </Button>
        </Stack>
      </Box>

      {/* Lưới sân */}
      <Grid container spacing={2.5}>
        {loading
          ? skeletons.map((_, i) => (
              <Grid item xs={12} sm={6} md={3} key={i}>
                <Box sx={{ borderRadius: 4, overflow: "hidden", border: `1px solid ${theme.palette.divider}` }}>
                  <Skeleton variant="rectangular" sx={{ aspectRatio: "16 / 10" }} />
                  <Box sx={{ p: 1.75 }}>
                    <Skeleton width="80%" height={24} />
                    <Skeleton width="55%" />
                    <Skeleton width="40%" height={28} sx={{ mt: 1 }} />
                  </Box>
                </Box>
              </Grid>
            ))
          : items.map((v) => (
              <Grid item xs={12} sm={6} md={3} key={v._id}>
                <VenueCard venue={v} onOpen={(id) => navigate(`/courts/${id}`)} />
              </Grid>
            ))}
      </Grid>

      {!loading && items.length === 0 && (
        <Box sx={{ textAlign: "center", py: 10, color: "text.secondary" }}>
          <Box sx={{ width: 88, height: 88, mx: "auto", mb: 2, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
            <SportsTennisIcon sx={{ fontSize: 44, color: alpha(theme.palette.primary.main, 0.6) }} />
          </Box>
          <Typography variant="h6" fontWeight={700} color="text.primary">Chưa tìm thấy sân nào</Typography>
          <Typography sx={{ mt: 0.5 }}>Thử bỏ bớt từ khoá hoặc tìm ở tỉnh/thành khác.</Typography>
        </Box>
      )}
    </Container>
  );
}
