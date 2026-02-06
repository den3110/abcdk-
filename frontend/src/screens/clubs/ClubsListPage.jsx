// src/pages/clubs/ClubsListPage.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Box,
  Container,
  Stack,
  Typography,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  Button,
  MenuItem,
  Alert,
  Card,
  CardHeader,
  CardContent,
  Skeleton,
  Paper,
  Divider,
  Chip,
  useTheme,
  useMediaQuery,
  Fade,
  IconButton,
  Grid,
} from "@mui/material";
// Import Grid2 cho MUI v6

import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import GroupOffOutlined from "@mui/icons-material/GroupOffOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import InboxOutlined from "@mui/icons-material/InboxOutlined";
import FilterListIcon from "@mui/icons-material/FilterList";
import ClearIcon from "@mui/icons-material/Clear";

import { useSelector } from "react-redux";
import { toast } from "react-toastify";

import ClubCreateDialog from "../../components/ClubCreateDialog";
import ClubCard from "../../components/ClubCard";
import { useListClubsQuery } from "../../slices/clubsApiSlice";
import { useThemeMode } from "../../context/ThemeContext.jsx";

const SPORT_OPTIONS = ["pickleball"];

// --- Modern Skeleton ---
function ClubCardSkeleton() {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 4,
        overflow: "hidden",
        height: "100%",
        border: "1px solid rgba(0,0,0,0.08)",
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          pt: "56.25%",
          bgcolor: "action.hover",
        }}
      >
        <Skeleton
          variant="rectangular"
          sx={{ position: "absolute", inset: 0 }}
          animation="wave"
        />
      </Box>
      <CardHeader
        sx={{ pb: 0.5 }}
        avatar={<Skeleton variant="circular" width={48} height={48} />}
        title={<Skeleton variant="text" width="60%" height={24} />}
        subheader={<Skeleton variant="text" width="30%" />}
      />
      <CardContent sx={{ pt: 1 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Skeleton
            variant="rounded"
            width={60}
            height={24}
            sx={{ borderRadius: 2 }}
          />
          <Skeleton
            variant="rounded"
            width={80}
            height={24}
            sx={{ borderRadius: 2 }}
          />
        </Stack>
        <Skeleton variant="text" width="100%" />
        <Skeleton variant="text" width="80%" />
      </CardContent>
    </Card>
  );
}

const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string"
    ? err.data
    : "Có lỗi xảy ra, vui lòng thử lại.");

const tabStyles = {
  minHeight: 40,
  borderRadius: 3,
  textTransform: "none",
  fontWeight: 600,
  fontSize: "0.9rem",
  color: "text.secondary",
  "&.Mui-selected": {
    color: "background.paper",
    bgcolor: "text.primary",
  },
  transition: "all 0.2s",
};

export default function ClubsListPage() {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [tab, setTab] = useState("all");

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // === THAY ĐỔI Ở ĐÂY: Mặc định là "pickleball" ===
  const [sport, setSport] = useState("pickleball");

  const [province, setProvince] = useState("");
  const [openCreate, setOpenCreate] = useState(false);

  const authUser =
    useSelector((s) => s.auth?.userInfo) ||
    useSelector((s) => s.user?.userInfo) ||
    null;
  const isAuth = !!(authUser?._id || authUser?.token);

  const wantMine = tab === "mine";
  const hasFilters = !!(q || sport || province);

  const params = useMemo(() => {
    const p = {};
    if (q) p.q = q;
    if (sport) p.sport = sport;
    if (province) p.province = province;
    if (wantMine) p.mine = true;
    return p;
  }, [q, sport, province, wantMine]);

  const shouldSkip = wantMine && !isAuth;

  const { data, isLoading, isFetching, error, refetch, isUninitialized } =
    useListClubsQuery(params, {
      skip: shouldSkip,
      refetchOnFocus: false,
      refetchOnReconnect: false,
    });

  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!error) {
      notifiedRef.current = false;
      return;
    }
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      const msg =
        error?.status === 401 && wantMine
          ? "Bạn cần đăng nhập để xem danh sách CLB của tôi."
          : getApiErrMsg(error);
      toast.error(msg);
    }
  }, [error, wantMine]);

  const clearFilters = () => {
    setQInput("");
    setSport(""); // Xóa filter sẽ về "Tất cả", nếu muốn về "pickleball" thì điền "pickleball" vào đây
    setProvince("");
  };

  const showSkeleton =
    !shouldSkip && (isLoading || isUninitialized || (isFetching && !data));
  const items = data?.items || [];
  const noResults = !showSkeleton && !shouldSkip && items.length === 0;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", pb: 8 }}>
      {/* === HERO SECTION === */}
      <Box
        sx={{
          bgcolor: "background.paper",
          pt: 4,
          pb: 3,
          borderBottom: "1px solid",
          borderColor: "divider",
          boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
        }}
      >
        <Container maxWidth="xl">
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={2}
          >
            <Box>
              <Typography
                variant="h5"
                fontWeight={800}
                sx={{
                  background:
                    "linear-gradient(135deg, #1e88e5 0%, #1565c0 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  mb: 0.5,
                }}
              >
                Cộng đồng & Câu lạc bộ
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Kết nối, giao lưu và tham gia các giải đấu hấp dẫn
              </Typography>
            </Box>

            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setOpenCreate(true)}
              sx={{
                borderRadius: "50px",
                px: 3,
                py: 1.2,
                fontWeight: 700,
                textTransform: "none",
                boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
                background: "linear-gradient(45deg, #212121 30%, #424242 90%)",
                "&:hover": {
                  boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                },
              }}
            >
              Tạo CLB Mới
            </Button>
          </Stack>

          {/* === FILTER BAR === */}
          <Paper
            elevation={0}
            sx={{
              mt: 4,
              p: 1,
              borderRadius: 4,
              border: "1px solid #e0e0e0",
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: "center",
              gap: 2,
              bgcolor: "action.hover",
            }}
          >
            {/* Search Input */}
            <TextField
              fullWidth
              placeholder="Tìm kiếm CLB..."
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              variant="standard"
              InputProps={{
                disableUnderline: true,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: "text.secondary", ml: 1 }} />
                  </InputAdornment>
                ),
                endAdornment: qInput && (
                  <IconButton size="small" onClick={() => setQInput("")}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                ),
                sx: {
                  bgcolor: "background.paper",
                  borderRadius: 3,
                  px: 1,
                  py: 0.8,
                  height: 48,
                  boxShadow: "0 2px 5px rgba(0,0,0,0.03)",
                },
              }}
              sx={{ flex: 2 }}
            />

            <Divider
              orientation="vertical"
              flexItem
              sx={{ display: { xs: "none", md: "block" } }}
            />

            {/* Select Sport */}
            <TextField
              select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              variant="standard"
              InputProps={{
                disableUnderline: true,
                startAdornment: (
                  <FilterListIcon
                    fontSize="small"
                    sx={{ mr: 1, color: "text.secondary" }}
                  />
                ),
                sx: {
                  height: 48,
                  bgcolor: "background.paper",
                  borderRadius: 3,
                  px: 2,
                  minWidth: 180,
                  boxShadow: "0 2px 5px rgba(0,0,0,0.03)",
                },
              }}
              sx={{ flex: 1, width: { xs: "100%", md: "auto" } }}
            >
              <MenuItem value="">
                <Typography color="text.secondary">Tất cả môn</Typography>
              </MenuItem>
              {SPORT_OPTIONS.map((s) => (
                <MenuItem
                  key={s}
                  value={s}
                  sx={{ textTransform: "capitalize" }}
                >
                  {s}
                </MenuItem>
              ))}
            </TextField>

            {/* Select Province */}
            <TextField
              placeholder="Tỉnh/Thành phố"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              variant="standard"
              InputProps={{
                disableUnderline: true,
                sx: {
                  height: 48,
                  bgcolor: "background.paper",
                  borderRadius: 3,
                  px: 2,
                  minWidth: 180,
                  boxShadow: "0 2px 5px rgba(0,0,0,0.03)",
                },
              }}
              sx={{ flex: 1, width: { xs: "100%", md: "auto" } }}
            />
          </Paper>

          {/* === TABS === */}
          <Stack direction="row" alignItems="center" spacing={2} mt={3}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              TabIndicatorProps={{ style: { display: "none" } }}
              sx={{
                minHeight: 40,
                "& .MuiTabs-flexContainer": { gap: 1 },
              }}
            >
              <Tab label="Khám phá" value="all" sx={tabStyles} disableRipple />
              <Tab
                label={
                  <Box display="flex" alignItems="center" gap={1}>
                    CLB của tôi{" "}
                    {isAuth && (
                      <Chip
                        label="Member"
                        size="small"
                        sx={{
                          height: 16,
                          fontSize: "0.6rem",
                          bgcolor: "primary.main",
                          color: "#fff",
                        }}
                      />
                    )}
                  </Box>
                }
                value="mine"
                sx={tabStyles}
                disableRipple
              />
            </Tabs>
          </Stack>
        </Container>
      </Box>

      {/* === CONTENT SECTION === */}
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {wantMine && !isAuth && (
          <Fade in>
            <Alert
              severity="info"
              sx={{ mb: 4, borderRadius: 3 }}
              variant="outlined"
            >
              Vui lòng{" "}
              <Button color="inherit" size="small" sx={{ fontWeight: 700 }}>
                Đăng nhập
              </Button>{" "}
              để xem danh sách CLB bạn đang tham gia.
            </Alert>
          </Fade>
        )}

        <Grid container spacing={3}>
          {showSkeleton &&
            Array.from({ length: 8 }).map((_, i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <ClubCardSkeleton />
              </Grid>
            ))}

          {!showSkeleton &&
            !noResults &&
            !shouldSkip &&
            items.map((club) => (
              <Grid key={club._id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <Fade in timeout={500}>
                  <Box height="100%">
                    <ClubCard club={club} />
                  </Box>
                </Fade>
              </Grid>
            ))}
        </Grid>

        {noResults && (
          <Fade in>
            <Box
              sx={{
                py: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                color: "text.secondary",
                textAlign: "center",
              }}
            >
              {wantMine ? (
                <>
                  <Box
                    sx={{
                      p: 3,
                      bgcolor: "action.hover",
                      borderRadius: "50%",
                      mb: 2,
                    }}
                  >
                    <GroupOffOutlined
                      sx={{ fontSize: 48, color: "text.disabled" }}
                    />
                  </Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    Bạn chưa tham gia CLB nào
                  </Typography>
                  <Typography sx={{ mb: 3, maxWidth: 400 }}>
                    Hãy bắt đầu bằng việc tạo CLB riêng của bạn hoặc khám phá
                    các CLB đang hoạt động.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setOpenCreate(true)}
                    sx={{ borderRadius: 20, px: 4 }}
                  >
                    Tạo CLB ngay
                  </Button>
                </>
              ) : hasFilters ? (
                <>
                  <Box
                    sx={{
                      p: 3,
                      bgcolor: "action.hover",
                      borderRadius: "50%",
                      mb: 2,
                    }}
                  >
                    <SearchOffOutlined
                      sx={{ fontSize: 48, color: "text.disabled" }}
                    />
                  </Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    Không tìm thấy kết quả
                  </Typography>
                  <Typography sx={{ mb: 3 }}>
                    Không có CLB nào khớp với từ khóa hoặc bộ lọc hiện tại.
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={clearFilters}
                    sx={{ borderRadius: 20 }}
                  >
                    Xóa bộ lọc tìm kiếm
                  </Button>
                </>
              ) : (
                <>
                  <Box
                    sx={{
                      p: 3,
                      bgcolor: "action.hover",
                      borderRadius: "50%",
                      mb: 2,
                    }}
                  >
                    <InboxOutlined
                      sx={{ fontSize: 48, color: "text.disabled" }}
                    />
                  </Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    Chưa có CLB nào
                  </Typography>
                  <Typography sx={{ mb: 3 }}>
                    Hệ thống hiện tại chưa có CLB nào được tạo.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => setOpenCreate(true)}
                    sx={{ borderRadius: 20 }}
                  >
                    Tạo CLB đầu tiên
                  </Button>
                </>
              )}
            </Box>
          </Fade>
        )}
      </Container>

      <ClubCreateDialog
        open={openCreate}
        onClose={(ok) => {
          setOpenCreate(false);
          if (ok) {
            toast.success("Tạo CLB thành công!");
            refetch();
          }
        }}
      />
    </Box>
  );
}
