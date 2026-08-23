// src/screens/MyOffersPage.jsx — các đề nghị mua tôi đã gửi
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LocalOfferRoundedIcon from "@mui/icons-material/LocalOfferRounded";
import { useMyOffersQuery, useCancelOfferMutation } from "../slices/marketApiSlice";
import { formatPrice } from "../constants/market";

const STATUS = {
  pending: { label: "Chờ phản hồi", color: "#d97706" },
  accepted: { label: "Đã chấp nhận", color: "#16a34a" },
  rejected: { label: "Đã từ chối", color: "#dc2626" },
  cancelled: { label: "Đã huỷ", color: "#6b7280" },
};

export default function MyOffersPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useMyOffersQuery();
  const [cancelOffer] = useCancelOfferMutation();
  const items = data?.items || [];

  const onCancel = async (offerId) => {
    if (!window.confirm("Huỷ đề nghị này?")) return;
    try {
      await cancelOffer(offerId).unwrap();
      refetch();
    } catch {}
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography sx={{ fontWeight: 900, fontSize: 24, display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <LocalOfferRoundedIcon /> Đề nghị của tôi
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <LocalOfferRoundedIcon sx={{ fontSize: 56, opacity: 0.4 }} />
          <Typography sx={{ mt: 1, fontWeight: 600 }}>Bạn chưa gửi đề nghị nào</Typography>
          <Button variant="contained" onClick={() => navigate("/marketplace")} sx={{ mt: 2 }}>
            Khám phá Chợ
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {items.map((o) => {
            const l = o.listing || {};
            const st = STATUS[o.status] || STATUS.pending;
            const img = l.images?.[0]?.url || l.images?.[0] || "";
            return (
              <Box
                key={o._id}
                sx={{
                  display: "flex",
                  gap: 1.5,
                  p: 1.25,
                  borderRadius: 3,
                  border: "1px solid",
                  borderColor: "divider",
                  alignItems: "center",
                }}
              >
                <Box
                  onClick={() => l._id && navigate(`/marketplace/${l._id}`)}
                  sx={{ width: 72, height: 72, borderRadius: 2, overflow: "hidden", bgcolor: "action.hover", flexShrink: 0, cursor: "pointer" }}
                >
                  {img ? (
                    <Box component="img" src={img} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 28 }}>🛍️</Box>
                  )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    onClick={() => l._id && navigate(`/marketplace/${l._id}`)}
                    noWrap
                    sx={{ fontWeight: 700, cursor: "pointer", "&:hover": { color: "primary.main" } }}
                  >
                    {l.title || "Sản phẩm"}
                  </Typography>
                  <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                    Giá đăng: {formatPrice(l.price, "sell")}
                  </Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: 800, color: "primary.main" }}>
                    Bạn đề nghị: {formatPrice(o.amount, "sell")}
                  </Typography>
                  {o.message && (
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary", fontStyle: "italic" }} noWrap>
                      “{o.message}”
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
                  <Chip
                    size="small"
                    label={st.label}
                    sx={{ fontWeight: 700, color: "#fff", bgcolor: st.color }}
                  />
                  {o.status === "pending" && (
                    <Button size="small" color="inherit" onClick={() => onCancel(o._id)}>
                      Huỷ
                    </Button>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Container>
  );
}
