// src/screens/SavedMarketPage.jsx — tin đã lưu
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import ListingCard from "../components/market/ListingCard";
import {
  useSavedListingsQuery,
  useToggleSaveListingMutation,
} from "../slices/marketApiSlice";

export default function SavedMarketPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useSavedListingsQuery(1);
  const [toggleSave] = useToggleSaveListingMutation();
  const items = data?.items || [];

  const onToggleSave = async (item) => {
    try {
      await toggleSave(item._id).unwrap();
      refetch();
    } catch {
      toast.error("Thao tác thất bại");
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Typography sx={{ fontWeight: 900, fontSize: 24, display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <BookmarkRoundedIcon /> Tin đã lưu
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <BookmarkRoundedIcon sx={{ fontSize: 56, opacity: 0.4 }} />
          <Typography sx={{ mt: 1, fontWeight: 600 }}>Bạn chưa lưu tin nào</Typography>
          <Button variant="contained" onClick={() => navigate("/marketplace")} sx={{ mt: 2 }}>
            Khám phá Chợ
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gap: { xs: 1.25, sm: 2 },
            gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(3,1fr)", md: "repeat(4,1fr)" },
          }}
        >
          {items.map((it) => (
            <ListingCard key={it._id} item={it} onToggleSave={onToggleSave} canSave={!it.isOwner} />
          ))}
        </Box>
      )}
    </Container>
  );
}
