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
  Grid,
  Button,
  MenuItem,
  Alert,
  Card,
  CardHeader,
  CardContent,
  Skeleton,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import GroupOffOutlined from "@mui/icons-material/GroupOffOutlined";
import SearchOffOutlined from "@mui/icons-material/SearchOffOutlined";
import InboxOutlined from "@mui/icons-material/InboxOutlined";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";

import ClubCreateDialog from "../../components/ClubCreateDialog";
import ClubCard from "../../components/ClubCard";
import { useListClubsQuery } from "../../slices/clubsApiSlice";

const SPORT_OPTIONS = ["pickleball"];

// --- Skeleton khớp layout ClubCard ---
function ClubCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      {/* Cover 16:9 */}
      <Box sx={{ position: "relative", width: "100%", pt: "56.25%" }}>
        <Skeleton
          variant="rectangular"
          sx={{ position: "absolute", inset: 0 }}
        />
      </Box>
      {/* Avatar + title/subtitle */}
      <CardHeader
        sx={{ pb: 0.5 }}
        avatar={<Skeleton variant="circular" width={40} height={40} />}
        title={<Skeleton variant="text" width="70%" />}
        subheader={<Skeleton variant="text" width="40%" />}
      />
      {/* Chips + 2 dòng mô tả */}
      <CardContent sx={{ pt: 1.5 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Skeleton variant="rounded" width={64} height={24} />
          <Skeleton variant="rounded" width={72} height={24} />
          <Skeleton variant="rounded" width={52} height={24} />
        </Stack>
        <Skeleton variant="text" width="100%" />
        <Skeleton variant="text" width="85%" />
      </CardContent>
    </Card>
  );
}

// rút gọn message lỗi từ RTKQ error
const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string"
    ? err.data
    : "Có lỗi xảy ra, vui lòng thử lại.");

export default function ClubsListPage() {
  const [tab, setTab] = useState("all"); // all | mine

  // debounce search
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const [sport, setSport] = useState("");
  const [province, setProvince] = useState("");
  const [openCreate, setOpenCreate] = useState(false);

  // xác định đã đăng nhập chưa
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

  // SKIP nếu tab = mine mà chưa đăng nhập → tránh gọi & loop
  const shouldSkip = wantMine && !isAuth;

  const { data, isLoading, isFetching, error, refetch, isUninitialized } =
    useListClubsQuery(params, {
      skip: shouldSkip,
      refetchOnFocus: false,
      refetchOnReconnect: false,
    });

  // toast lỗi 1 lần/đợt lỗi
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
    setSport("");
    setProvince("");
  };

  // show skeleton chỉ khi tải lần đầu (không chớp khi refetch)
  const showSkeleton =
    !shouldSkip && (isLoading || isUninitialized || (isFetching && !data));
  const items = data?.items || [];
  const noResults = !showSkeleton && !shouldSkip && items.length === 0;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5" fontWeight={600}>
          Câu lạc bộ
        </Typography>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => setOpenCreate(true)}
        >
          Tạo CLB
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="Tìm CLB..."
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          select
          label="Môn"
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">Tất cả</MenuItem>
          {SPORT_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Tỉnh/Thành"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          sx={{ minWidth: 200 }}
        />
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Tất cả" value="all" />
        <Tab label="CLB của tôi" value="mine" />
      </Tabs>

      {/* Nếu đang ở tab "của tôi" mà chưa đăng nhập → chỉ báo, không gọi API */}
      {wantMine && !isAuth && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Vui lòng đăng nhập để xem danh sách CLB của bạn.
        </Alert>
      )}

      {/* Loading → Skeleton đẹp */}
      {showSkeleton && (
        <Grid container spacing={2}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Grid key={i} item xs={12} sm={6} md={4} lg={3}>
              <ClubCardSkeleton />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Empty-state có icon */}
      {noResults && (
        <Box
          sx={{
            py: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            color: "text.secondary",
          }}
        >
          {wantMine ? (
            <>
              <GroupOffOutlined sx={{ fontSize: 64, mb: 1 }} />
              <Typography variant="h6" gutterBottom>
                Bạn chưa tham gia CLB nào
              </Typography>
              <Typography sx={{ mb: 2 }}>
                Hãy tạo CLB mới hoặc tham gia một CLB public.
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setOpenCreate(true)}
              >
                Tạo CLB
              </Button>
            </>
          ) : hasFilters ? (
            <>
              <SearchOffOutlined sx={{ fontSize: 64, mb: 1 }} />
              <Typography variant="h6" gutterBottom>
                Không tìm thấy CLB phù hợp
              </Typography>
              <Typography sx={{ mb: 2 }}>
                Hãy thử xoá bộ lọc hoặc từ khoá tìm kiếm.
              </Typography>
              <Button onClick={clearFilters}>Xóa bộ lọc</Button>
            </>
          ) : (
            <>
              <InboxOutlined sx={{ fontSize: 64, mb: 1 }} />
              <Typography variant="h6" gutterBottom>
                Danh sách trống
              </Typography>
              <Typography sx={{ mb: 2 }}>Chưa có CLB nào được tạo.</Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setOpenCreate(true)}
              >
                Tạo CLB
              </Button>
            </>
          )}
        </Box>
      )}

      {/* Kết quả */}
      {!showSkeleton && !noResults && !shouldSkip && (
        <Grid container spacing={2}>
          {items.map((club) => (
            <Grid key={club._id} item xs={12} sm={6} md={4} lg={3}>
              <ClubCard club={club} />
            </Grid>
          ))}
        </Grid>
      )}

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
    </Container>
  );
}
