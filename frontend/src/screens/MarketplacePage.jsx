// src/screens/MarketplacePage.jsx — Chợ PickleTour (danh sách + tìm kiếm + lọc)
import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
import BookmarkRoundedIcon from "@mui/icons-material/BookmarkRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import LocalOfferRoundedIcon from "@mui/icons-material/LocalOfferRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ListingCard from "../components/market/ListingCard";
import { CATEGORIES, CONDITIONS, TYPES, SORTS } from "../constants/market";
import {
  useListListingsQuery,
  useToggleSaveListingMutation,
} from "../slices/marketApiSlice";

export default function MarketplacePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sellerFilter = searchParams.get("seller") || "";
  const userInfo = useSelector((s) => s.auth?.userInfo);

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [province, setProvince] = useState("");
  const [priceRange, setPriceRange] = useState([0, 20000000]);
  const [priceActive, setPriceActive] = useState(false);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);

  const params = useMemo(() => {
    const p = { sort, page, limit: 24 };
    if (q) p.q = q;
    if (category) p.category = category;
    if (condition) p.condition = condition;
    if (type) p.type = type;
    if (province) p.province = province;
    if (sellerFilter) p.seller = sellerFilter;
    if (priceActive) {
      p.minPrice = priceRange[0];
      p.maxPrice = priceRange[1];
    }
    return p;
  }, [q, category, condition, type, sort, province, sellerFilter, priceActive, priceRange, page]);

  const { data, isFetching, isLoading } = useListListingsQuery(params);
  const [toggleSave] = useToggleSaveListingMutation();

  const items = data?.items || [];
  const hasMore = data?.hasMore;

  const resetPage = () => setPage(1);

  const onToggleSave = async (item) => {
    if (!userInfo) {
      toast.info("Vui lòng đăng nhập để lưu tin");
      navigate("/login");
      return;
    }
    try {
      await toggleSave(item._id).unwrap();
    } catch {
      toast.error("Không lưu được tin");
    }
  };

  const submitSearch = (e) => {
    e?.preventDefault?.();
    setQ(search.trim());
    resetPage();
  };

  const activeFilters =
    (condition ? 1 : 0) + (type ? 1 : 0) + (province ? 1 : 0) + (priceActive ? 1 : 0);

  return (
    <Box sx={{ bgcolor: "background.default", minHeight: "100vh", pb: 6 }}>
      {/* Hero */}
      <Box
        sx={{
          background: "linear-gradient(120deg,#0d6efd 0%,#3b82f6 45%,#6366f1 100%)",
          color: "#fff",
          pt: { xs: 3, md: 5 },
          pb: { xs: 8, md: 9 },
          px: 2,
        }}
      >
        <Container maxWidth="lg" sx={{ px: { xs: 0, sm: 2 } }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 1.5,
            }}
          >
            <Box>
              <Typography
                sx={{ fontWeight: 900, fontSize: { xs: 26, md: 34 }, display: "flex", alignItems: "center", gap: 1 }}
              >
                <StorefrontRoundedIcon sx={{ fontSize: { xs: 28, md: 38 } }} /> Chợ PickleTour
              </Typography>
              <Typography sx={{ opacity: 0.92, mt: 0.5, fontSize: { xs: 13, md: 15 } }}>
                Mua bán · trao đổi giày, vợt, quần áo pickleball an toàn cùng người chơi đã xác minh
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<BookmarkRoundedIcon />}
                onClick={() => navigate("/marketplace/saved")}
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,.6)", "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.12)" } }}
              >
                Tin đã lưu
              </Button>
              <Button
                variant="outlined"
                startIcon={<LocalOfferRoundedIcon />}
                onClick={() => navigate("/marketplace/offers")}
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,.6)", "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.12)" } }}
              >
                Đề nghị của tôi
              </Button>
              <Button
                variant="outlined"
                startIcon={<Inventory2RoundedIcon />}
                onClick={() => navigate("/marketplace/mine")}
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,.6)", "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.12)" } }}
              >
                Tin của tôi
              </Button>
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={() => navigate("/marketplace/new")}
                sx={{ bgcolor: "#fff", color: "#0d6efd", fontWeight: 800, "&:hover": { bgcolor: "#f1f5f9" } }}
              >
                Đăng tin
              </Button>
            </Box>
          </Box>

          {/* Search */}
          <Box component="form" onSubmit={submitSearch} sx={{ mt: 3, maxWidth: 720 }}>
            <TextField
              fullWidth
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm giày Nike, vợt Joola, áo thi đấu…"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ color: "text.secondary" }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button type="submit" variant="contained" sx={{ borderRadius: 2 }}>
                      Tìm
                    </Button>
                  </InputAdornment>
                ),
                sx: { bgcolor: "background.paper", borderRadius: 3, pr: 0.5 },
              }}
            />
          </Box>
        </Container>
      </Box>

      {/* Body */}
      <Container maxWidth="lg" sx={{ mt: { xs: -5, md: -6 } }}>
        {/* Category chips */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            overflowX: "auto",
            pb: 1.5,
            "&::-webkit-scrollbar": { height: 0 },
          }}
        >
          <Chip
            label="Tất cả"
            onClick={() => {
              setCategory("");
              resetPage();
            }}
            color={category === "" ? "primary" : "default"}
            sx={{ fontWeight: 700, bgcolor: category === "" ? undefined : "background.paper" }}
          />
          {CATEGORIES.map((c) => (
            <Chip
              key={c.key}
              label={`${c.emoji} ${c.label}`}
              onClick={() => {
                setCategory(c.key === category ? "" : c.key);
                resetPage();
              }}
              color={category === c.key ? "primary" : "default"}
              sx={{
                fontWeight: 700,
                whiteSpace: "nowrap",
                bgcolor: category === c.key ? undefined : "background.paper",
              }}
            />
          ))}
        </Box>

        {/* Toolbar: sort + filter */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 2,
          }}
        >
          <Typography sx={{ fontSize: 14, color: "text.secondary" }}>
            {data?.total != null ? `${data.total} tin đăng` : "Đang tải…"}
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Select
              size="small"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                resetPage();
              }}
              sx={{ bgcolor: "background.paper", borderRadius: 2, fontSize: 14 }}
            >
              {SORTS.map((s) => (
                <MenuItem key={s.key} value={s.key}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
            <Button
              variant="outlined"
              startIcon={<TuneRoundedIcon />}
              onClick={() => setDrawer(true)}
              sx={{ bgcolor: "background.paper" }}
            >
              Lọc{activeFilters ? ` (${activeFilters})` : ""}
            </Button>
          </Box>
        </Box>

        {/* Grid */}
        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : items.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
            <StorefrontRoundedIcon sx={{ fontSize: 56, opacity: 0.4 }} />
            <Typography sx={{ mt: 1, fontWeight: 600 }}>Chưa có tin đăng phù hợp</Typography>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => navigate("/marketplace/new")}
              sx={{ mt: 2 }}
            >
              Đăng tin đầu tiên
            </Button>
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: "grid",
                gap: { xs: 1.25, sm: 2 },
                gridTemplateColumns: {
                  xs: "repeat(2,1fr)",
                  sm: "repeat(3,1fr)",
                  md: "repeat(4,1fr)",
                },
              }}
            >
              {items.map((it) => (
                <ListingCard
                  key={it._id}
                  item={it}
                  onToggleSave={onToggleSave}
                  canSave={!it.isOwner}
                />
              ))}
            </Box>
            {hasMore && (
              <Box sx={{ display: "grid", placeItems: "center", mt: 3 }}>
                <Button
                  variant="outlined"
                  disabled={isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {isFetching ? "Đang tải…" : "Xem thêm"}
                </Button>
              </Box>
            )}
          </>
        )}
      </Container>

      {/* Filter drawer */}
      <Drawer anchor="right" open={drawer} onClose={() => setDrawer(false)}>
        <Box sx={{ width: 320, p: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 18 }}>Bộ lọc</Typography>
            <IconButton onClick={() => setDrawer(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Box>
          <Divider sx={{ mb: 2 }} />

          <Typography sx={{ fontWeight: 700, mb: 1 }}>Hình thức</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
            {TYPES.map((t) => (
              <Chip
                key={t.key}
                label={`${t.emoji} ${t.label}`}
                onClick={() => setType(t.key === type ? "" : t.key)}
                color={type === t.key ? "primary" : "default"}
                sx={{ fontWeight: 600 }}
              />
            ))}
          </Box>

          <Typography sx={{ fontWeight: 700, mb: 1 }}>Tình trạng</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
            {CONDITIONS.map((c) => (
              <Chip
                key={c.key}
                label={c.label}
                onClick={() => setCondition(c.key === condition ? "" : c.key)}
                color={condition === c.key ? "primary" : "default"}
                sx={{ fontWeight: 600 }}
              />
            ))}
          </Box>

          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Khoảng giá</Typography>
          <Box sx={{ px: 1 }}>
            <Slider
              value={priceRange}
              min={0}
              max={20000000}
              step={100000}
              onChange={(e, v) => {
                setPriceRange(v);
                setPriceActive(true);
              }}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) =>
                v >= 1000000 ? `${(v / 1000000).toFixed(1)}tr` : `${v / 1000}k`
              }
            />
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
              {priceRange[0].toLocaleString("vi-VN")} – {priceRange[1].toLocaleString("vi-VN")} ₫
            </Typography>
          </Box>

          <Typography sx={{ fontWeight: 700, mt: 2, mb: 1 }}>Khu vực</Typography>
          <TextField
            fullWidth
            size="small"
            placeholder="Tỉnh/Thành phố"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          />

          <Box sx={{ display: "flex", gap: 1, mt: 3 }}>
            <Button
              fullWidth
              variant="text"
              onClick={() => {
                setCondition("");
                setType("");
                setProvince("");
                setPriceActive(false);
                setPriceRange([0, 20000000]);
              }}
            >
              Xoá lọc
            </Button>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                resetPage();
                setDrawer(false);
              }}
            >
              Áp dụng
            </Button>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
