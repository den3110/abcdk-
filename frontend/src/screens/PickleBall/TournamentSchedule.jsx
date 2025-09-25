// src/pages/TournamentSchedule.jsx
import React, { useMemo, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Grid,
  Card,
  CardHeader,
  CardContent,
  Chip,
  Stack,
  Typography,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Alert,
  Skeleton,
  Button,
  TextField,
  MenuItem,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import StadiumIcon from "@mui/icons-material/Stadium";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  useGetTournamentQuery,
  useListPublicMatchesByTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

/* ---------- helpers ---------- */

function displayMatchCode(m) {
  // 1) Ưu tiên globalCode nếu có (kể cả 0 hoặc số)
  const gc = m?.globalCode;
  const hasGc =
    gc === 0 ||
    typeof gc === "number" ||
    (typeof gc === "string" && gc.trim() !== "");
  if (hasGc) return String(gc).trim();

  // 2) Fallback sang code nếu có
  const code = m?.code;
  const hasCode =
    code === 0 ||
    typeof code === "number" ||
    (typeof code === "string" && code.trim() !== "");
  if (hasCode) return String(code).trim();

  // 3) Cuối cùng mới dựng từ bracket.order + order như logic cũ
  const bo = m?.bracket?.order;
  const ord = m?.order;

  const hasBo =
    bo === 0 || typeof bo === "number" || (typeof bo === "string" && bo !== "");
  const hasOrd =
    ord === 0 ||
    typeof ord === "number" ||
    (typeof ord === "string" && ord !== "");

  if (hasBo && hasOrd) {
    const boTxt = Number.isFinite(Number(bo)) ? String(Number(bo)) : String(bo);
    const ordNum = Number(ord);
    const ordTxt = Number.isFinite(ordNum) ? String(ordNum) : String(ord);
    return `R${boTxt}#${ordTxt}`;
  }
  if (hasOrd) {
    const ordNum = Number(ord);
    const ordTxt = Number.isFinite(ordNum) ? String(ordNum) : String(ord);
    return `#${ordTxt}`;
  }

  // 4) Nếu không có gì, trả label mặc định
  return "Trận";
}
function matchCodeByOrder(m) {
  const o = m?.order;
  if (o === 0 || o) {
    const n = Number(o);
    const ordTxt = Number.isFinite(n) ? String(n).padStart(2, "0") : String(o);
    return `#${ordTxt}`; // ví dụ: #01, #12
  }
  return m?.code || "Trận";
}

const isLive = (m) =>
  ["live", "ongoing", "playing", "inprogress"].includes(
    String(m?.status || "").toLowerCase()
  );
const isFinished = (m) => String(m?.status || "").toLowerCase() === "finished";
const isScheduled = (m) =>
  ["scheduled", "upcoming", "pending", "queued", "assigning"].includes(
    String(m?.status || "").toLowerCase()
  );

function orderKey(m) {
  const bo = m?.bracket?.order ?? 9999;
  const r = m?.round ?? 9999;
  const o = m?.order ?? 9999;
  const codeNum =
    typeof m?.code === "string" ? Number(m.code.replace(/[^\d]/g, "")) : 9999;
  const ts = m?.createdAt ? new Date(m.createdAt).getTime() : 9e15;
  return [bo, r, o, codeNum, ts];
}
function pairToName(pair) {
  if (!pair) return null;
  const p1 = pair.player1?.nickName || pair.player1?.fullName;
  const p2 = pair.player2?.nickName || pair.player2?.fullName;
  const name = [p1, p2].filter(Boolean).join(" / ");
  return name || null;
}
function seedToName(seed) {
  return seed?.label || null;
}
function teamNameFrom(m, side) {
  if (!m) return "TBD";
  const pair = side === "A" ? m.pairA : m.pairB;
  const seed = side === "A" ? m.seedA : m.seedB;
  return pairToName(pair) || seedToName(seed) || "TBD";
}
function scoreText(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim())
    return m.scoreText;
  if (Array.isArray(m?.gameScores) && m.gameScores.length) {
    return m.gameScores.map((s) => `${s?.a ?? 0}-${s?.b ?? 0}`).join(", ");
  }
  return "";
}
function courtNameOf(m) {
  return (
    (m?.courtName && m.courtName.trim()) ||
    m?.court?.name ||
    m?.courtLabel ||
    "Chưa phân sân"
  );
}

/* ---------- Chips ---------- */
function ChipRow({ children, sx }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        columnGap: 0.75,
        rowGap: 0.75,
        px: 0.5,
        py: 0.25,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
function StatusChip({ m }) {
  if (isLive(m))
    return <Chip size="small" color="warning" label="Đang diễn ra" />;
  if (isFinished(m))
    return <Chip size="small" color="success" label="Đã diễn ra" />;
  return <Chip size="small" color="info" label="Sắp diễn ra" />;
}
function ScoreChip({ text }) {
  if (!text) return null;
  return <Chip size="small" variant="outlined" label={text} />;
}
function WinnerChip({ m }) {
  const side = m?.winner === "A" ? "A" : m?.winner === "B" ? "B" : null;
  if (!side) return null;
  return (
    <Chip
      size="small"
      color="success"
      icon={<EmojiEventsIcon />}
      label={`Winner: ${teamNameFrom(m, side)}`}
    />
  );
}

/* ---------- Small components ---------- */
function SectionTitle({ children, right }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "flex-start", sm: "center" }}
      justifyContent="space-between"
      gap={1}
      mb={2}
    >
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {children}
      </Typography>
      {right}
    </Stack>
  );
}

function CourtCard({ court, queueLimit = 4, onOpenMatch }) {
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 1.25,
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        mb={1}
        gap={1}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {court.name}
        </Typography>
        <ChipRow sx={{ px: 0 }}>
          {court.live.length > 0 && (
            <Chip size="small" color="success" label="ĐANG DIỄN RA" />
          )}
          {court.queue.length > 0 && (
            <Chip
              size="small"
              color="warning"
              icon={<ScheduleIcon fontSize="small" />}
              label={`${court.queue.length} trận tiếp theo`}
            />
          )}
        </ChipRow>
      </Stack>

      {/* live matches – clickable */}
      {court.live.map((m) => (
        <Box
          key={m._id}
          onClick={() => onOpenMatch?.(m._id)}
          role="button"
          tabIndex={0}
          sx={{
            borderLeft: "4px solid",
            borderColor: "success.main",
            p: 1,
            borderRadius: 1,
            mb: 1,
            bgcolor: (t) =>
              t.palette.mode === "light" ? "success.50" : "success.900",
            cursor: "pointer",
            transition: "transform .12s ease, box-shadow .12s ease",
            "&:hover": { transform: "translateY(-1px)", boxShadow: 1 },
            "&:focus-visible": {
              outline: "2px solid",
              outlineColor: "primary.main",
            },
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            gap={1}
            flexWrap="wrap"
          >
            <Stack direction="row" alignItems="center" gap={0.75}>
              <PlayArrowIcon fontSize="small" />
              <Typography fontWeight={700}>{displayMatchCode(m)}</Typography>
            </Stack>

            <Typography sx={{ opacity: 0.9 }}>
              {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
            </Typography>

            <Box sx={{ flex: 1 }} />

            <ChipRow sx={{ ml: { sm: 0.5 } }}>
              <ScoreChip text={scoreText(m)} />
              <StatusChip m={m} />
            </ChipRow>
          </Stack>
        </Box>
      ))}

      {/* queue – clickable rows */}
      {court.queue.slice(0, queueLimit).map((m) => (
        <List dense disablePadding key={m._id}>
          <ListItem disableGutters>
            <ListItemButton
              onClick={() => onOpenMatch?.(m._id)}
              sx={{
                px: 0,
                py: 0.5,
                borderRadius: 1,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <ScheduleIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    gap={1}
                    flexWrap="wrap"
                  >
                    <Typography fontWeight={700}>
                      {displayMatchCode(m)}
                    </Typography>
                    <Typography sx={{ opacity: 0.9 }}>
                      {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
                    </Typography>
                  </Stack>
                }
                secondary={
                  <ChipRow>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={m.bracket?.name || m.phase || "—"}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={courtNameOf(m)}
                    />
                  </ChipRow>
                }
              />
            </ListItemButton>
          </ListItem>
        </List>
      ))}
    </Box>
  );
}

function MatchRow({ m, onOpenMatch }) {
  return (
    <ListItem
      disableGutters
      sx={{
        my: 0.75,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: isLive(m)
          ? "success.light"
          : isFinished(m)
          ? "divider"
          : "info.light",
        bgcolor: isLive(m)
          ? (t) => (t.palette.mode === "light" ? "success.50" : "success.900")
          : "transparent",
      }}
    >
      <ListItemButton
        onClick={() => onOpenMatch?.(m._id)}
        sx={{
          py: { xs: 1, sm: 1.25 },
          px: 1,
          borderRadius: 1.5,
          alignItems: "flex-start",
        }}
      >
        <ListItemIcon sx={{ minWidth: 28, mt: 0.25 }}>
          {isLive(m) ? (
            <PlayArrowIcon fontSize="small" />
          ) : isFinished(m) ? (
            <EmojiEventsIcon fontSize="small" />
          ) : (
            <ScheduleIcon fontSize="small" />
          )}
        </ListItemIcon>

        <ListItemText
          primary={
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "flex-start", sm: "center" }}
              gap={1}
              flexWrap="wrap"
            >
              <Typography fontWeight={700}>{displayMatchCode(m)}</Typography>
              <Typography sx={{ opacity: 0.9 }}>
                {teamNameFrom(m, "A")} vs {teamNameFrom(m, "B")}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <ChipRow sx={{ mr: 0.5 }}>
                <ScoreChip text={scoreText(m)} />
                <StatusChip m={m} />
              </ChipRow>
            </Stack>
          }
          secondary={
            <ChipRow>
              <Chip
                size="small"
                variant="outlined"
                label={m.bracket?.name || m.phase || "—"}
              />
              <Chip size="small" variant="outlined" label={courtNameOf(m)} />
              {isFinished(m) && <WinnerChip m={m} />}
            </ChipRow>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

/* ---------- Page ---------- */
export default function TournamentSchedule() {
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | live | upcoming | finished

  // state để mở viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);

  const openViewer = (mid) => {
    setSelectedMatchId(mid);
    setViewerOpen(true);
  };
  const closeViewer = () => {
    setViewerOpen(false);
    setSelectedMatchId(null);
  };

  const theme = useTheme();
  const upSm = useMediaQuery(theme.breakpoints.up("sm"));
  const upMd = useMediaQuery(theme.breakpoints.up("md"));

  const {
    data: tournament,
    isLoading: tLoading,
    error: tError,
  } = useGetTournamentQuery(id);
  const {
    data: matchesResp,
    isLoading: mLoading,
    error: mError,
  } = useListPublicMatchesByTournamentQuery({
    tid: id,
    params: { limit: 500 },
  });

  const loading = tLoading || mLoading;
  const errorMsg =
    (tError && (tError.data?.message || tError.error)) ||
    (mError && (mError.data?.message || mError.error));

  const matches = useMemo(() => matchesResp?.list ?? [], [matchesResp]);

  const allSorted = useMemo(() => {
    return [...matches].sort((a, b) => {
      const ak = orderKey(a);
      const bk = orderKey(b);
      for (let i = 0; i < ak.length; i++)
        if (ak[i] !== bk[i]) return ak[i] - bk[i];
      return 0;
    });
  }, [matches]);

  const filteredAll = useMemo(() => {
    const qnorm = q.trim().toLowerCase();
    return allSorted.filter((m) => {
      if (status === "live" && !isLive(m)) return false;
      if (
        status === "upcoming" &&
        !(isScheduled(m) && !isLive(m) && !isFinished(m))
      )
        return false;
      if (status === "finished" && !isFinished(m)) return false;
      if (!qnorm) return true;
      const formattedCode = displayMatchCode(m);
      const hay = [
        formattedCode,
        teamNameFrom(m, "A"),
        teamNameFrom(m, "B"),
        m.bracket?.name,
        courtNameOf(m),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(qnorm);
    });
  }, [allSorted, q, status]);

  // group by court
  const courts = useMemo(() => {
    const map = new Map();
    allSorted.forEach((m) => {
      const name = courtNameOf(m);
      if (!map.has(name)) map.set(name, { live: [], queue: [] });
      if (isLive(m)) map.get(name).live.push(m);
      else if (isScheduled(m)) map.get(name).queue.push(m);
    });
    map.forEach((v) => {
      v.queue.sort((a, b) => {
        const ak = orderKey(a);
        const bk = orderKey(b);
        for (let i = 0; i < ak.length; i++)
          if (ak[i] !== bk[i]) return ak[i] - bk[i];
        return 0;
      });
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [allSorted]);

  const queueLimit = upMd ? 6 : upSm ? 4 : 3;

  return (
    <Container
      maxWidth="lg"
      disableGutters
      sx={{
        // không padding ở mobile, thêm lại từ sm+
        px: { sm: 2 },
        py: { xs: 2, sm: 3 },
      }}
    >
      {/* header */}
      <SectionTitle
        right={
          <Button
            component={RouterLink}
            to={`/tournament/${id}/bracket`}
            variant="outlined"
            size="small"
            startIcon={<ArrowBackIcon />}
          >
            Về sơ đồ
          </Button>
        }
      >
        Lịch thi đấu {tournament?.name ? `– ${tournament.name}` : ""}
      </SectionTitle>

      {/* filters (sticky on mobile) */}
      <Box
        sx={{
          position: { xs: "sticky", md: "static" },
          top: { xs: 8, sm: 12 },
          zIndex: 2,
          bgcolor: "background.paper",
          border: { xs: "1px solid", md: "none" },
          borderColor: { xs: "divider", md: "transparent" },
          p: { xs: 1, sm: 0 },
          mb: 2,
          borderRadius: { xs: 0, md: 2 }, // 0 ở mobile để sát mép
          boxShadow: { xs: 1, md: 0 },
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <TextField
            size="small"
            placeholder="Tìm mã trận, người chơi, sân, bracket..."
            fullWidth
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputProps={{ "aria-label": "Tìm kiếm trận đấu" }}
          />
          <TextField
            select
            size="small"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ width: { xs: "100%", sm: 220 } }}
          >
            <MenuItem value="all">Tất cả</MenuItem>
            <MenuItem value="live">Đang diễn ra</MenuItem>
            <MenuItem value="upcoming">Sắp diễn ra</MenuItem>
            <MenuItem value="finished">Đã diễn ra</MenuItem>
          </TextField>
        </Stack>
      </Box>

      {/* loading / error */}
      {loading && (
        <Box my={3}>
          <Grid container spacing={{ xs: 0, md: 2 }}>
            <Grid item xs={12} md={5}>
              <Card
                sx={{
                  width: 1,
                  borderRadius: { xs: 0, md: 3 },
                  overflow: "hidden",
                }}
              >
                <CardHeader
                  avatar={<StadiumIcon color="primary" />}
                  title={<Skeleton width={160} />}
                  subheader={<Skeleton width={220} />}
                />
                <Divider />
                <CardContent>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} height={72} sx={{ mb: 1 }} />
                  ))}
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={7}>
              <Card
                sx={{
                  width: 1,
                  borderRadius: { xs: 0, md: 3 },
                  overflow: "hidden",
                }}
              >
                <CardHeader
                  title={<Skeleton width={220} />}
                  subheader={<Skeleton width={160} />}
                />
                <Divider />
                <CardContent>
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} height={64} sx={{ mb: 1 }} />
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      )}

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMsg}
        </Alert>
      )}

      {!loading && !errorMsg && (
        <Grid container spacing={{ xs: 0, md: 2 }}>
          {/* LEFT: on-court */}
          <Grid
            item
            xs={12}
            md={5}
            sx={{
              "@media (max-width:625px)": { width: "100%", marginBottom: 4 },
            }}
          >
            <Card
              sx={{
                width: 1,
                borderRadius: { xs: 0, md: 3 },
                overflow: "hidden",
              }}
            >
              <CardHeader
                avatar={<StadiumIcon color="primary" />}
                title="Các trận đấu trên sân"
                subheader="Đang diễn ra & hàng chờ"
                sx={{
                  "& .MuiCardHeader-avatar": { mr: 1 },
                  "& .MuiCardHeader-title": { fontWeight: 700 },
                }}
              />
              <Divider />
              <CardContent sx={{ pt: 2 }}>
                {courts.length === 0 && (
                  <Alert severity="info">
                    Chưa có trận nào đang diễn ra hoặc trong hàng chờ.
                  </Alert>
                )}
                <Stack spacing={2}>
                  {courts.map((c) => (
                    <CourtCard
                      key={c.name}
                      court={c}
                      queueLimit={queueLimit}
                      onOpenMatch={openViewer}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Grid>

          {/* RIGHT: all matches */}
          <Grid
            item
            xs={12}
            md={7}
            sx={{
              "@media (max-width:625px)": { width: "100%", marginBottom: 4 },
            }}
          >
            <Card
              sx={{
                width: 1,
                borderRadius: { xs: 0, md: 3 },
                overflow: "hidden",
              }}
            >
              <CardHeader
                title="Danh sách tất cả các trận"
                subheader={`Sắp xếp theo thứ tự trận • ${filteredAll.length} trận`}
                sx={{ "& .MuiCardHeader-title": { fontWeight: 700 } }}
              />
              <Divider />
              <CardContent sx={{ pt: 1 }}>
                {filteredAll.length === 0 ? (
                  <Alert severity="info">Không có trận phù hợp bộ lọc.</Alert>
                ) : (
                  <List disablePadding>
                    {filteredAll.map((m) => (
                      <MatchRow key={m._id} m={m} onOpenMatch={openViewer} />
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Viewer */}
      <ResponsiveMatchViewer
        open={viewerOpen}
        matchId={selectedMatchId}
        onClose={closeViewer}
      />
    </Container>
  );
}
