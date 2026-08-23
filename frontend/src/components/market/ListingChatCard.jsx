// src/components/market/ListingChatCard.jsx — thẻ sản phẩm Chợ hiển thị trong tin nhắn
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatPrice } from "../../constants/market";

export default function ListingChatCard({ listing, isMine }) {
  const navigate = useNavigate();
  if (!listing) return null;
  const img = listing.images?.[0]?.url || listing.images?.[0] || "";
  const sold = listing.status === "sold";
  return (
    <Box
      onClick={() => listing._id && navigate(`/marketplace/${listing._id}`)}
      sx={{
        mt: 0.75,
        width: 244,
        maxWidth: "100%",
        borderRadius: 2,
        overflow: "hidden",
        cursor: "pointer",
        bgcolor: isMine ? "rgba(255,255,255,0.15)" : "background.paper",
        border: "1px solid",
        borderColor: isMine ? "rgba(255,255,255,0.35)" : "divider",
      }}
    >
      <Box sx={{ display: "flex", gap: 1, p: 1, alignItems: "center" }}>
        <Box
          sx={{
            width: 54,
            height: 54,
            borderRadius: 1.5,
            overflow: "hidden",
            flexShrink: 0,
            bgcolor: "action.hover",
          }}
        >
          {img ? (
            <Box component="img" src={img} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 24 }}>🛍️</Box>
          )}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: isMine ? "rgba(255,255,255,0.9)" : "primary.main" }}>
            🛍️ Sản phẩm trên Chợ
          </Typography>
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: isMine ? "#fff" : "text.primary" }}>
            {listing.title}
          </Typography>
          <Typography sx={{ fontSize: 13.5, fontWeight: 900, color: isMine ? "#fff" : "primary.main" }}>
            {sold ? "Đã bán" : formatPrice(listing.price, listing.type)}
          </Typography>
        </Box>
      </Box>
      <Box
        sx={{
          textAlign: "center",
          py: 0.5,
          fontSize: 12,
          fontWeight: 800,
          color: "#fff",
          bgcolor: isMine ? "rgba(255,255,255,0.25)" : "primary.main",
        }}
      >
        Xem sản phẩm →
      </Box>
    </Box>
  );
}
