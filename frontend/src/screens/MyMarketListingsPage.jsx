// src/screens/MyMarketListingsPage.jsx — quản lý tin của tôi
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import ListingCard from "../components/market/ListingCard";
import { useMyListingsQuery } from "../slices/marketApiSlice";

const TABS = [
  { key: "", label: "Tất cả" },
  { key: "available", label: "Đang bán" },
  { key: "reserved", label: "Giữ chỗ" },
  { key: "sold", label: "Đã bán" },
  { key: "hidden", label: "Đã ẩn" },
];

export default function MyMarketListingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("");
  const { data, isLoading } = useMyListingsQuery(tab || undefined);
  const items = data?.items || [];

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography sx={{ fontWeight: 900, fontSize: 24, display: "flex", alignItems: "center", gap: 1 }}>
          <Inventory2RoundedIcon /> Tin của tôi
        </Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => navigate("/marketplace/new")}>
          Đăng tin
        </Button>
      </Box>

      <Tabs
        value={tab}
        onChange={(e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: "1px solid", borderColor: "divider" }}
      >
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} sx={{ fontWeight: 700 }} />
        ))}
      </Tabs>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography sx={{ fontWeight: 600 }}>Chưa có tin nào ở mục này</Typography>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => navigate("/marketplace/new")} sx={{ mt: 2 }}>
            Đăng tin mới
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
            <ListingCard key={it._id} item={it} canSave={false} />
          ))}
        </Box>
      )}
    </Container>
  );
}
