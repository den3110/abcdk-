// components/EventLiveBanner.jsx — banner "cực hot" trang chủ dẫn vào trang xem live giải.
import React from "react";
import { Box, Container, Typography, Button, Stack } from "@mui/material";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import { Link as RouterLink } from "react-router-dom";
import { useGetEventLiveConfigQuery } from "../slices/eventLiveApiSlice";

const CSS = `@keyframes elvBnPulse{0%{opacity:1}50%{opacity:.4}100%{opacity:1}}
@keyframes elvBnShine{to{background-position:200% center}}`;

export default function EventLiveBanner() {
  const { data } = useGetEventLiveConfigQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });

  if (!data?.enabled || !data?.configured) return null;
  const name = data.eventName || "Giải đấu đang diễn ra";

  return (
    <Container maxWidth="lg" sx={{ mt: 2 }}>
      <style>{CSS}</style>
      <Box
        component={RouterLink}
        to="/live/event"
        sx={{
          display: "block",
          textDecoration: "none",
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
          p: { xs: 2, sm: 2.5 },
          background:
            "linear-gradient(110deg,#0b1220 0%,#7f1d1d 55%,#dc2626 130%)",
          border: "1px solid rgba(255,255,255,.12)",
          boxShadow: "0 8px 30px rgba(220,38,38,.25)",
          transition: "transform .15s ease, box-shadow .15s ease",
          "&:hover": {
            transform: "translateY(-2px)",
            boxShadow: "0 12px 40px rgba(220,38,38,.4)",
          },
        }}
      >
        {data.bannerImageUrl && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${data.bannerImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.28,
            }}
          />
        )}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1.5}
          sx={{ position: "relative" }}
        >
          <Box
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1.5,
              bgcolor: "rgba(0,0,0,.35)",
              color: "#fff",
              fontWeight: 900,
              fontSize: 12,
              letterSpacing: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: "#ff2d2d",
                boxShadow: "0 0 8px #ff2d2d",
                animation: "elvBnPulse 1.2s infinite",
              }}
            />
            LIVE
          </Box>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{
                fontWeight: 900,
                color: "#fff",
                lineHeight: 1.2,
                fontSize: { xs: 16, sm: 18 },
                background: "linear-gradient(90deg,#fff,#ffd7d7,#fff)",
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                animation: "elvBnShine 4s linear infinite",
              }}
            >
              {name}
            </Typography>
            <Typography sx={{ color: "rgba(255,255,255,.85)", fontSize: 13, mt: 0.25 }}>
              Xem trực tiếp nhiều sân · nhiều góc camera ngay trên app
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<LiveTvIcon />}
            sx={{
              bgcolor: "#fff",
              color: "#dc2626",
              fontWeight: 900,
              textTransform: "none",
              borderRadius: 2,
              whiteSpace: "nowrap",
              "&:hover": { bgcolor: "#ffeaea" },
            }}
          >
            Xem trực tiếp
          </Button>
        </Stack>
      </Box>
    </Container>
  );
}
