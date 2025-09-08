// src/pages/MyTournamentsPage.jsx — items full width (normal MUI Container)
import React, { useMemo, useState, useCallback } from "react";
import {
  Box,
  Stack,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Button,
  Skeleton,
  Container,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import LockIcon from "@mui/icons-material/Lock";
import LoginIcon from "@mui/icons-material/Login";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import EventIcon from "@mui/icons-material/Event";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PlaceIcon from "@mui/icons-material/Place";
import { useSelector } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";
import { useNavigate } from "react-router-dom";
import { useListMyTournamentsQuery } from "../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./PickleBall/match/ResponsiveMatchViewer";

/* ================= Utils (giữ nguyên) ================= */
const dateFmt = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};
const stripVN = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const nameWithNick = (p) => {
  if (!p) return "—";
  const nick = p.nickName || p.nickname || p.nick || p.alias;
  return nick?.trim() || p.fullName || p.name || "—";
};
const teamLabel = (team, eventType) => {
  if (!team) return "—";
  if (team.name) return team.name;
  const players =
    team.players ||
    team.members ||
    [team.player1, team.player2].filter(Boolean) ||
    [];
  if (!players.length) return "—";
  if (eventType === "single") return nameWithNick(players[0]);
  if (players.length === 1) return nameWithNick(players[0]);
  return `${nameWithNick(players[0])} & ${nameWithNick(players[1])}`;
};
function roundText(m) {
  if (m.roundName) return m.roundName;
  if (m.phase) return m.phase;
  if (Number.isFinite(m.rrRound)) return `Vòng bảng ${m.rrRound}`;
  if (Number.isFinite(m.swissRound)) return `Swiss ${m.swissRound}`;
  if (Number.isFinite(m.round)) return `Vòng ${m.round}`;
  return "—";
}

/* ================= Small UI bits ================= */
function ToggleChip({ active, label, onClick }) {
  return (
    <Chip
      label={label}
      onClick={onClick}
      variant={active ? "filled" : "outlined"}
      color={active ? "primary" : "default"}
      size="small"
      sx={{ borderRadius: 999, fontWeight: 700 }}
    />
  );
}
function StatusChip({ status }) {
  const map = {
    live: { label: "Đang diễn ra", color: "error" },
    finished: { label: "Đã kết thúc", color: "success" },
    scheduled: { label: "Sắp diễn ra", color: "primary" },
  };
  const conf = map[status] || map.scheduled;
  return (
    <Chip
      size="small"
      label={conf.label}
      color={conf.color}
      sx={{ fontWeight: 600 }}
    />
  );
}
function SmallMeta({ icon, text }) {
  const Icon = icon;
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      sx={{ minWidth: 0 }}
    >
      <Icon sx={{ fontSize: 16, color: "text.secondary" }} />
      <Typography variant="caption" color="text.secondary" noWrap>
        {text}
      </Typography>
    </Stack>
  );
}
function ScoreBadge({ sets }) {
  const text =
    Array.isArray(sets) && sets.length
      ? sets
          .map((s) => `${s.a ?? s.home ?? 0}-${s.b ?? s.away ?? 0}`)
          .join("  |  ")
      : "—";
  return (
    <Box
      sx={{
        alignSelf: "flex-start",
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: (t) =>
          t.palette.mode === "dark" ? "action.selected" : "grey.50",
      }}
    >
      <Typography fontWeight={600} variant="body2">
        {text}
      </Typography>
    </Box>
  );
}

/* ================= Rows / Cards ================= */
function MatchRow({ m, onOpen, eventType }) {
  const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
  const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
  const status = m.status || (m.winner ? "finished" : "scheduled");
  const court = m.courtName || m.court || "";
  const when = m.scheduledAt || m.startTime || m.time;
  const accent =
    status === "live"
      ? "error.main"
      : status === "finished"
      ? "success.main"
      : "primary.main";

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <CardActionArea onClick={() => onOpen?.(m)}>
        <Box sx={{ display: "flex", gap: 1.5, p: 1.5 }}>
          <Box sx={{ width: 4, borderRadius: 999, bgcolor: accent }} />
          <Stack sx={{ flex: 1, gap: 0.5, minWidth: 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ minWidth: 0 }}
            >
              <Typography noWrap fontWeight={600}>
                {teamLabel(a, eventType)}
              </Typography>
              <StatusChip status={status} />
            </Stack>
            <Typography noWrap fontWeight={600}>
              {teamLabel(b, eventType)}
            </Typography>
            <ScoreBadge sets={m.sets || m.gameScores} />
            <Stack
              direction="row"
              flexWrap="wrap"
              spacing={1.5}
              useFlexGap
              sx={{ mt: 0.5 }}
            >
              <SmallMeta icon={EventIcon} text={dateFmt(when)} />
              {!!court && (
                <SmallMeta icon={SportsTennisIcon} text={`Sân ${court}`} />
              )}
              <SmallMeta icon={ScheduleIcon} text={roundText(m)} />
            </Stack>
          </Stack>
          <Box sx={{ alignSelf: "center", pl: 0.5 }}>
            <ChevronRightIcon sx={{ color: "text.secondary" }} />
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}

function Banner({ t }) {
  const status = t.status;
  const statusText =
    status === "ongoing"
      ? "Đang diễn ra"
      : status === "finished"
      ? "Đã kết thúc"
      : "Sắp diễn ra";
  const statusColor =
    status === "ongoing"
      ? "warning"
      : status === "finished"
      ? "success"
      : "primary";
  const uri = t.image || t.cover || t.bannerUrl || null;

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: { xs: 140, md: 180 },
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          overflow: "hidden",
          bgcolor: "#11161c",
        }}
      >
        {uri && (
          <Box
            component="img"
            src={uri}
            alt={t.name || "Giải đấu"}
            loading="lazy"
            style={{ objectFit: "cover" }}
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
        )}
        <Box
          sx={{ position: "absolute", inset: 0, bgcolor: "rgba(0,0,0,0.22)" }}
        />
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)",
          }}
        />
        <Stack
          direction="row"
          alignItems="flex-end"
          spacing={1.25}
          sx={{ position: "absolute", inset: 0, p: 1.75 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={600} color="#fff" noWrap>
              {t.name || "Giải đấu"}
            </Typography>
            {!!t.location && (
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                sx={{ mt: 0.5, opacity: 0.9, maxWidth: "100%" }}
              >
                <PlaceIcon sx={{ fontSize: 16, color: "#fff" }} />
                <Typography color="#fff" noWrap>
                  {t.location}
                </Typography>
              </Stack>
            )}
          </Box>
          <Chip
            label={statusText}
            color={statusColor}
            sx={{ fontWeight: 600, color: "#fff" }}
          />
        </Stack>
      </Box>
    </Box>
  );
}

function TournamentCard({ t, onOpenMatch }) {
  const [expanded, setExpanded] = useState(false);
  const [matchQuery, setMatchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    new Set(["scheduled", "live", "finished"])
  );
  const matches = Array.isArray(t.matches) ? t.matches : [];
  const filteredMatches = useMemo(() => {
    const q = stripVN(matchQuery);
    return matches.filter((m) => {
      const status = m.status || (m.winner ? "finished" : "scheduled");
      if (!statusFilter.has(status)) return false;
      if (!q) return true;
      const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
      const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
      const hay = [
        teamLabel(a, t.eventType),
        teamLabel(b, t.eventType),
        roundText(m),
        m.courtName || m.court || "",
      ]
        .map(stripVN)
        .join(" | ");
      return hay.includes(q);
    });
  }, [matches, matchQuery, statusFilter, t.eventType]);

  const shown = expanded ? filteredMatches : filteredMatches.slice(0, 5);
  const hasMore = filteredMatches.length > shown.length;
  const toggleStatus = (key) =>
    setStatusFilter((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      if (n.size === 0) n.add(key);
      return n;
    });

  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      <Banner t={t} />
      <CardContent sx={{ p: { xs: 1.5, md: 2 }, pt: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <CalendarMonthIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          <Typography variant="body2" color="text.secondary">
            {(t.startDate || t.startAt) && (t.endDate || t.endAt)
              ? `${dateFmt(t.startDate || t.startAt)}  →  ${dateFmt(
                  t.endDate || t.endAt
                )}`
              : "—"}
          </Typography>
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "stretch", sm: "center" }}
        >
          <TextField
            value={matchQuery}
            onChange={(e) => setMatchQuery(e.target.value)}
            size="small"
            placeholder="Tìm trận (VĐV, vòng, sân...)"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: "text.secondary" }} />
                </InputAdornment>
              ),
              endAdornment: matchQuery ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setMatchQuery("")}>
                    <CloseIcon />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ToggleChip
              label="Sắp diễn ra"
              active={statusFilter.has("scheduled")}
              onClick={() => toggleStatus("scheduled")}
            />
            <ToggleChip
              label="Đang diễn ra"
              active={statusFilter.has("live")}
              onClick={() => toggleStatus("live")}
            />
            <ToggleChip
              label="Đã kết thúc"
              active={statusFilter.has("finished")}
              onClick={() => toggleStatus("finished")}
            />
            {(!!matchQuery || statusFilter.size !== 3) && (
              <Button
                onClick={() => {
                  setMatchQuery("");
                  setStatusFilter(new Set(["scheduled", "live", "finished"]));
                }}
                size="small"
                variant="text"
              >
                Reset
              </Button>
            )}
          </Stack>
        </Stack>

        {filteredMatches.length === 0 ? (
          <Box
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              p: 2,
              textAlign: "center",
              mt: 1.25,
            }}
          >
            <Typography fontSize={28} mb={0.5}>
              🎾
            </Typography>
            <Typography color="text.secondary">
              Không có trận phù hợp bộ lọc.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.25} sx={{ mt: 1.25 }}>
            {shown.map((m) => (
              <MatchRow
                key={m._id}
                m={m}
                onOpen={onOpenMatch}
                eventType={t.eventType}
              />
            ))}
            {hasMore && (
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                <Button
                  onClick={() => setExpanded((v) => !v)}
                  variant="outlined"
                  size="small"
                >
                  {expanded
                    ? "Thu gọn"
                    : `Xem tất cả ${filteredMatches.length} trận`}
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/* ======= Login Prompt (giữ nguyên) ======= */
function LoginPrompt() {
  const navigate = useNavigate();
  return (
    <Box
      sx={{ display: "grid", placeItems: "center", minHeight: "60vh", p: 3 }}
    >
      <Card
        variant="outlined"
        sx={{ maxWidth: 520, width: "100%", p: 2.5, borderRadius: 2 }}
      >
        <Stack spacing={1.25} alignItems="center" textAlign="center">
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.light",
            }}
          >
            <LockIcon sx={{ color: "primary.contrastText" }} />
          </Box>
          <Typography variant="h6" fontWeight={600}>
            Hãy đăng nhập để xem{" "}
            <Typography component="span" fontWeight={600}>
              Giải của tôi
            </Typography>
          </Typography>
          <Typography color="text.secondary">
            Sau khi đăng nhập, bạn sẽ thấy danh sách các giải mình đã tham gia,
            lịch thi đấu và kết quả cá nhân.
          </Typography>
          <Button
            onClick={() => navigate("/login")}
            variant="contained"
            startIcon={<LoginIcon />}
            size="medium"
          >
            Đăng nhập
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}

/* ================= Page ================= */
export default function MyTournamentsPage() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const [viewerOpen, setViewerOpen] = useState(false);
  const [matchId, setMatchId] = useState(null);

  const { userInfo } = useSelector((s) => s?.auth || {});
  const isAuthed = !!(userInfo?.token || userInfo?._id || userInfo?.email);

  const queryArg = isAuthed
    ? { withMatches: 1, matchLimit: 200, page: 1, limit: 50 }
    : skipToken;
  const { data, isLoading, isError, refetch, isFetching } =
    useListMyTournamentsQuery(queryArg);

  const tournamentsRaw = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [data]);

  const [tourQuery, setTourQuery] = useState("");
  const [tourStatus, setTourStatus] = useState(
    new Set(["upcoming", "ongoing", "finished"])
  );

  const tournaments = useMemo(() => {
    const q = stripVN(tourQuery);
    return tournamentsRaw.filter((t) => {
      if (!tourStatus.has(t.status)) return false;
      if (!q) return true;
      const hay = [t.name, t.location].map(stripVN).join(" | ");
      return hay.includes(q);
    });
  }, [tournamentsRaw, tourQuery, tourStatus]);

  const handleOpenMatch = useCallback((m) => {
    setMatchId(m?._id);
    setViewerOpen(true);
  }, []);
  const toggleTourStatus = (key) =>
    setTourStatus((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      if (n.size === 0) n.add(key);
      return n;
    });

  if (!isAuthed) return <LoginPrompt />;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      {/* Sticky header trong Container "bình thường" */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: (t) => t.zIndex.appBar,
          backdropFilter: "saturate(180%) blur(6px)",
          bgcolor: (t) =>
            t.palette.mode === "dark"
              ? "rgba(10,10,10,0.8)"
              : "rgba(255,255,255,0.8)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Stack spacing={1}>
            <Typography variant={"h5"} fontWeight={600} >
              Giải của tôi
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                value={tourQuery}
                onChange={(e) => setTourQuery(e.target.value)}
                size="small"
                placeholder="Tìm giải (tên, địa điểm)"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ color: "text.secondary" }} />
                    </InputAdornment>
                  ),
                  endAdornment: tourQuery ? (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setTourQuery("")}>
                        <CloseIcon />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <ToggleChip
                  label="Sắp diễn ra"
                  active={tourStatus.has("upcoming")}
                  onClick={() => toggleTourStatus("upcoming")}
                />
                <ToggleChip
                  label="Đang diễn ra"
                  active={tourStatus.has("ongoing")}
                  onClick={() => toggleTourStatus("ongoing")}
                />
                <ToggleChip
                  label="Đã kết thúc"
                  active={tourStatus.has("finished")}
                  onClick={() => toggleTourStatus("finished")}
                />
                {(!!tourQuery || tourStatus.size !== 3) && (
                  <Button
                    onClick={() => {
                      setTourQuery("");
                      setTourStatus(
                        new Set(["upcoming", "ongoing", "finished"])
                      );
                    }}
                    size="small"
                    variant="text"
                  >
                    Reset
                  </Button>
                )}
              </Stack>
              {!!tournaments?.length && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: { sm: "auto" } }}
                >
                  {tournaments.length} giải phù hợp
                </Typography>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* MAIN: Container chuẩn, item full width bằng Stack */}
      <Container maxWidth="xl" sx={{ pt: 2, pb: 4 }}>
        {isLoading ? (
          <Stack spacing={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={220} />
            ))}
          </Stack>
        ) : isError ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="error">
              Có lỗi khi tải dữ liệu. Vui lòng thử lại.
            </Typography>
            <Button onClick={refetch} sx={{ mt: 1 }} variant="outlined">
              Thử lại
            </Button>
          </Box>
        ) : tournaments.length === 0 ? (
          <Box
            sx={{
              py: 8,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <Typography fontSize={42} mb={0.5}>
              🏆
            </Typography>
            <Typography fontWeight={600} variant="h6">
              Chưa có giải nào
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Tham gia giải để theo dõi lịch đấu và kết quả của bạn tại đây.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            {tournaments.map((t) => (
              <TournamentCard key={t._id} t={t} onOpenMatch={handleOpenMatch} />
            ))}
          </Stack>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Button
            onClick={refetch}
            disabled={isFetching}
            variant="outlined"
            size="small"
          >
            {isFetching ? "Đang làm mới..." : "Làm mới"}
          </Button>
        </Box>
      </Container>

      <ResponsiveMatchViewer
        open={viewerOpen}
        matchId={matchId}
        onClose={() => setViewerOpen(false)}
      />
    </Box>
  );
}
