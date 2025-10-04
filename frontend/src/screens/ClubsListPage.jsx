import React, { useMemo, useState } from "react";
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
  Skeleton,
  Button,
  MenuItem,
  Chip,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
// import ClubCard from "@/components/clubs/ClubCard";
// import ClubCreateDialog from "@/components/clubs/ClubCreateDialog";
import { useListClubsQuery } from "../slices/clubsApiSlice";
import ClubCard from "../components/ClubCard";

const SPORT_OPTIONS = ["pickleball", "tennis"];

export default function ClubsListPage() {
  const [tab, setTab] = useState("all"); // all | mine
  const [q, setQ] = useState("");
  const [sport, setSport] = useState("");
  const [province, setProvince] = useState("");
  const [openCreate, setOpenCreate] = useState(false);

  const params = useMemo(() => {
    const p = {};
    if (q.trim()) p.q = q.trim();
    if (sport) p.sport = sport;
    if (province) p.province = province;
    if (tab === "mine") p.mine = true;
    return p;
  }, [q, sport, province, tab]);

  const { data, isLoading, refetch } = useListClubsQuery(params);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5">Câu lạc bộ</Typography>
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
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

      <Grid container spacing={2}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Grid key={i} item xs={12} sm={6} md={4} lg={3}>
                <Skeleton
                  variant="rectangular"
                  height={200}
                  sx={{ borderRadius: 3 }}
                />
              </Grid>
            ))
          : (data?.items || []).map((club) => (
              <Grid key={club._id} item xs={12} sm={6} md={4} lg={3}>
                <ClubCard club={club} />
              </Grid>
            ))}
      </Grid>

      <ClubCreateDialog
        open={openCreate}
        onClose={(ok) => {
          setOpenCreate(false);
          if (ok) refetch();
        }}
      />
    </Container>
  );
}
