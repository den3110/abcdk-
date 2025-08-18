// src/layouts/tournament/TournamentBracket.jsx
import { useMemo, useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import {
  Box,
  TextField,
  Tabs,
  Tab,
  Paper,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Alert,
  TableContainer,
  Divider,
  CircularProgress,
  Chip,
  Stack,
  IconButton,
  Button,
  Link as MuiLink,
  useMediaQuery,
  useTheme,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import {
  Close as CloseIcon,
  EmojiEvents as TrophyIcon,
  PlayCircle as PlayIcon,
  ContentCopy as ContentCopyIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { Bracket, Seed, SeedItem, SeedTeam } from "react-brackets";
import { useParams, useSearchParams } from "react-router-dom";

import {
  useGetTournamentQuery,
  useListTournamentBracketsQuery,
  useListTournamentMatchesQuery,
  useGetMatchPublicQuery,
} from "../../slices/tournamentsApiSlice";
import { useSelector } from "react-redux";
import { useLiveMatch } from "../../hook/useLiveMatch";

/* ===================== Helpers ===================== */
function safePairName(pair, eventType = "double") {
  if (!pair) return "—";
  const p1 =
    pair.player1?.fullName ||
    pair.player1?.name ||
    pair.player1?.nickname ||
    "N/A";
  const p2 =
    pair.player2?.fullName ||
    pair.player2?.name ||
    pair.player2?.nickname ||
    "";
  const isSingle = String(eventType).toLowerCase() === "single";
  if (isSingle) return p1;
  return p2 ? `${p1} & ${p2}` : p1;
}
function depLabel(prev) {
  if (!prev) return "TBD";
  const r = prev.round ?? "?";
  const idx = (prev.order ?? 0) + 1;
  return `Winner of R${r} #${idx}`;
}
function matchSideLabel(m, side) {
  const pair = side === "A" ? m.pairA : m.pairB;
  const prev = side === "A" ? m.previousA : m.previousB;
  if (pair)
    return safePairName(
      m[side === "A" ? "pairA" : "pairB"],
      m?.tournament?.eventType
    );
  if (prev) return depLabel(prev);
  return "Chưa có đội";
}
function resultLabel(m) {
  if (m?.status === "finished") {
    if (m?.winner === "A") return "Đội A thắng";
    if (m?.winner === "B") return "Đội B thắng";
    return "Hoà/Không xác định";
  }
  if (m?.status === "live") return "Đang diễn ra";
  return "Chưa diễn ra";
}
function roundTitleByCount(cnt) {
  if (cnt === 1) return "Chung kết";
  if (cnt === 2) return "Bán kết";
  if (cnt === 4) return "Tứ kết";
  if (cnt === 8) return "Vòng 1/8";
  if (cnt === 16) return "Vòng 1/16";
  return `Vòng (${cnt} trận)`;
}

// ========== extra helpers cho KO placeholder theo quy mô ==========
const ceilPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
const UNGROUPED = "__UNGROUPED__";
const getGroupKey = (m) => {
  const g = m.group ?? m.groupName ?? m.pool ?? m.table ?? m.groupLabel ?? null;
  if (typeof g === "string" && g.trim()) return g.trim();
  if (g && typeof g === "object")
    return g.name || g.code || g.label || g._id || UNGROUPED;
  if (typeof m.groupIndex === "number")
    return String.fromCharCode(65 + m.groupIndex);
  return UNGROUPED;
};

// ⭐ Lấy “quy mô” từ chính bracket (ưu tiên), hỗ trợ nhiều tên field
const readBracketScale = (br) => {
  const cands = [
    br?.drawScale,
    br?.targetScale,
    br?.maxSlots,
    br?.capacity,
    br?.size,
    br?.scale,
    br?.meta?.drawSize,
    br?.meta?.scale,
  ]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 2);
  if (!cands.length) return 0;
  // dùng giá trị lớn nhất rồi làm tròn lên 2^n
  return ceilPow2(Math.max(...cands));
};

/* ======== Build rounds (có placeholder) cho react-brackets ======== */
function placeholderSeed(r, idx) {
  return {
    id: `placeholder-${r}-${idx}`,
    __match: null,
    teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
  };
}
function buildEmptyRoundsByScale(scale /* 2^n */) {
  const rounds = [];
  let matches = Math.max(1, Math.floor(scale / 2));
  let r = 1;
  while (matches >= 1) {
    const seeds = Array.from({ length: matches }, (_, i) =>
      placeholderSeed(r, i)
    );
    rounds.push({ title: roundTitleByCount(matches), seeds });
    matches = Math.floor(matches / 2);
    r += 1;
  }
  return rounds;
}

// Xây rounds + placeholder, có thể ép số cột tối thiểu = minRounds và mở rộng tới chung kết
function buildRoundsWithPlaceholders(
  brMatches,
  { minRounds = 0, extendForward = true } = {}
) {
  const real = (brMatches || [])
    .slice()
    .sort(
      (a, b) =>
        (a.round || 1) - (b.round || 1) || (a.order || 0) - (b.order || 0)
    );

  const roundsHave = Array.from(new Set(real.map((m) => m.round || 1))).sort(
    (a, b) => a - b
  );
  const lastRound = roundsHave.length ? Math.max(...roundsHave) : 1;

  // đảm bảo có đủ cột bên trái (nếu muốn ép tối thiểu minRounds)
  let firstRound = roundsHave.length ? Math.min(...roundsHave) : 1;
  const haveColsInitial = roundsHave.length ? lastRound - firstRound + 1 : 1;
  if (minRounds && haveColsInitial < minRounds) {
    firstRound = Math.max(1, lastRound - (minRounds - 1));
  }

  // đếm số trận thật theo round
  const countByRoundReal = {};
  real.forEach((m) => {
    const r = m.round || 1;
    countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
  });

  // seedsCount cho các round đang có
  const seedsCount = {};
  seedsCount[lastRound] = countByRoundReal[lastRound] || 1;
  for (let r = lastRound - 1; r >= firstRound; r--) {
    seedsCount[r] = countByRoundReal[r] || seedsCount[r + 1] * 2;
  }

  // ⭐ NEW: mở rộng VỀ SAU cho tới khi còn 1 trận (tức là có final)
  if (extendForward) {
    let cur = lastRound;
    while ((seedsCount[cur] || 1) > 1) {
      const nxt = cur + 1;
      seedsCount[nxt] = Math.ceil((seedsCount[cur] || 1) / 2);
      cur = nxt;
    }
  }

  const roundNums = Object.keys(seedsCount)
    .map(Number)
    .sort((a, b) => a - b);

  // build data cho react-brackets (điền trận thật nếu có, còn lại placeholder)
  return roundNums.map((r) => {
    const need = seedsCount[r];
    const seeds = Array.from({ length: need }, (_, i) => ({
      id: `placeholder-${r}-${i}`,
      __match: null,
      teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
    }));

    const ms = real
      .filter((m) => (m.round || 1) === r)
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    ms.forEach((m, idx) => {
      let i = Number.isInteger(m.order)
        ? m.order
        : seeds.findIndex((s) => s.__match === null);
      if (i < 0 || i >= seeds.length) i = Math.min(idx, seeds.length - 1);

      const sideLabel = (side) => {
        const pair = side === "A" ? m.pairA : m.pairB;
        const prev = side === "A" ? m.previousA : m.previousB;
        if (pair)
          return safePairName(
            side === "A" ? m.pairA : m.pairB,
            m?.tournament?.eventType
          );
        if (prev) return depLabel(prev);
        return "Chưa có đội";
      };

      seeds[i] = {
        id: m._id || `${r}-${i}`,
        date: m?.scheduledAt
          ? new Date(m.scheduledAt).toDateString()
          : undefined,
        __match: m,
        teams: [{ name: sideLabel("A") }, { name: sideLabel("B") }],
      };
    });

    return { title: roundTitleByCount(need), seeds };
  });
}

/* ========== Custom seed (click mở viewer) ========== */
const RED = "#F44336";
const CustomSeed = ({ seed, breakpoint, onOpen }) => {
  const m = seed.__match || null;
  const nameA = seed.teams?.[0]?.name || "Chưa có đội";
  const nameB = seed.teams?.[1]?.name || "Chưa có đội";
  const winA = m?.status === "finished" && m?.winner === "A";
  const winB = m?.status === "finished" && m?.winner === "B";
  const isPlaceholder =
    !m && nameA === "Chưa có đội" && nameB === "Chưa có đội";
  const isFinal = Boolean(m && !m?.nextMatch);

  const RightTick = (props) => (
    <span
      {...props}
      style={{
        position: "absolute",
        right: -8,
        top: "50%",
        transform: "translateY(-50%)",
        width: 8,
        height: 2,
        background: RED,
        opacity: 0.9,
      }}
    />
  );

  return (
    <Seed mobileBreakpoint={breakpoint} style={{ fontSize: 13 }}>
      <SeedItem
        onClick={() => m && onOpen?.(m)}
        style={{ cursor: m ? "pointer" : "default" }}
      >
        <div style={{ position: "relative", display: "grid", gap: 4 }}>
          {isFinal && (winA || winB) && (
            <TrophyIcon
              sx={{
                position: "absolute",
                right: -22,
                top: -12,
                fontSize: 20,
                color: RED,
              }}
            />
          )}

          <SeedTeam
            style={{
              fontWeight: winA ? 700 : 400,
              borderLeft: winA ? `4px solid ${RED}` : "4px solid transparent",
              paddingLeft: 6,
              opacity: isPlaceholder ? 0.7 : 1,
              fontStyle: isPlaceholder ? "italic" : "normal",
            }}
          >
            {nameA}
          </SeedTeam>
          <SeedTeam
            style={{
              fontWeight: winB ? 700 : 400,
              borderLeft: winB ? `4px solid ${RED}` : "4px solid transparent",
              paddingLeft: 6,
              opacity: isPlaceholder ? 0.7 : 1,
              fontStyle: isPlaceholder ? "italic" : "normal",
            }}
          >
            {nameB}
          </SeedTeam>

          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {m
              ? resultLabel(m)
              : isPlaceholder
              ? "Chưa có đội"
              : "Chưa diễn ra"}
          </div>
          {(winA || winB) && <RightTick />}
        </div>
      </SeedItem>
    </Seed>
  );
};
CustomSeed.propTypes = {
  seed: PropTypes.shape({
    __match: PropTypes.shape({
      status: PropTypes.string,
      winner: PropTypes.string,
    }),
    teams: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string })),
  }).isRequired,
  breakpoint: PropTypes.number,
  onOpen: PropTypes.func,
};

/* ===================== Match viewer shared utils ===================== */
function ytEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
  } catch {}
  return null;
}
function extractStreams(m) {
  const arr = [];
  const raw =
    m?.streams ||
    m?.meta?.streams ||
    (m?.videoUrl ? [{ label: "YouTube", url: m.videoUrl }] : []);
  for (const s of raw || []) {
    if (s?.url) arr.push({ label: s.label || "Link", url: s.url });
  }
  return arr;
}
function lastGameScore(gameScores) {
  if (!Array.isArray(gameScores) || !gameScores.length) return { a: 0, b: 0 };
  return gameScores[gameScores.length - 1] || { a: 0, b: 0 };
}
function countGamesWon(gameScores) {
  let A = 0,
    B = 0;
  for (const g of gameScores || []) {
    if ((g?.a ?? 0) > (g?.b ?? 0)) A++;
    else if ((g?.b ?? 0) > (g?.a ?? 0)) B++;
  }
  return { A, B };
}

/* ===== Shared content to reuse in Drawer/Dialog ===== */
function MatchContent({ m, isLoading, liveLoading, onClose }) {
  const { userInfo } = useSelector((s) => s.auth || {});
  const userId =
    userInfo?._id || userInfo?.id || userInfo?.userId || userInfo?.uid;

  const roleStr = String(userInfo?.role || "").toLowerCase();
  const roles = new Set(
    [...(userInfo?.roles || []), ...(userInfo?.permissions || [])]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase())
  );

  const isAdmin = !!(
    userInfo?.isAdmin ||
    roleStr === "admin" ||
    roles.has("admin") ||
    roles.has("superadmin") ||
    roles.has("tournament:admin")
  );

  const tour =
    m?.tournament && typeof m.tournament === "object" ? m.tournament : null;

  const ownerId =
    (tour?.owner &&
      (tour.owner._id || tour.owner.id || tour.owner.userId || tour.owner)) ||
    (tour?.createdBy &&
      (tour.createdBy._id ||
        tour.createdBy.id ||
        tour.createdBy.userId ||
        tour.createdBy)) ||
    (tour?.organizer &&
      (tour.organizer._id ||
        tour.organizer.id ||
        tour.organizer.userId ||
        tour.organizer)) ||
    null;

  const managerIds = new Set(
    [
      ...(tour?.managers || []),
      ...(tour?.organizers || []),
      ...(tour?.staff || []),
      ...(tour?.moderators || []),
    ]
      .map((u) =>
        typeof u === "string"
          ? u
          : u?._id || u?.id || u?.userId || u?.uid || u?.email
      )
      .filter(Boolean)
  );

  const canManageFlag =
    m?.permissions?.canManage ||
    tour?.permissions?.canManage ||
    userInfo?.permissions?.includes?.("tournament:manage");

  const isManager = !!(
    tour &&
    userId &&
    (managerIds.has(userId) || ownerId === userId || canManageFlag)
  );

  const canSeeOverlay = isAdmin || isManager;

  const streams = extractStreams(m);
  const teamA = m?.pairA
    ? safePairName(m.pairA, m?.tournament?.eventType)
    : depLabel(m?.previousA);
  const teamB = m?.pairB
    ? safePairName(m.pairB, m?.tournament?.eventType)
    : depLabel(m?.previousB);

  const status = m?.status || "scheduled";
  const winnerSide = m?.status === "finished" ? m?.winner : "";
  const gamesWon = countGamesWon(m?.gameScores);
  const curr = lastGameScore(m?.gameScores);

  const leading =
    status === "live"
      ? curr.a > curr.b
        ? "A"
        : curr.b > curr.a
        ? "B"
        : ""
      : m?.status === "finished"
      ? winnerSide
      : "";

  const origin =
    typeof window !== "undefined" && window?.location?.origin
      ? window.location.origin
      : "";
  const overlayUrl =
    m?._id && origin
      ? `${origin}/overlay/score?matchId=${m._id}&theme=dark&size=md&showSets=1`
      : "";

  const yt = streams.find((s) => ytEmbed(s.url));
  const ytSrc = ytEmbed(yt?.url);

  if (isLoading || liveLoading) {
    return (
      <Box py={4} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (!m) return <Alert severity="error">Không tải được dữ liệu trận.</Alert>;

  return (
    <Stack spacing={2}>
      {status === "live" ? (
        ytSrc ? (
          <Box sx={{ position: "relative", pt: "56.25%" }}>
            <iframe
              src={ytSrc}
              title="Live"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                inset: 0,
                border: 0,
                width: "100%",
                height: "100%",
              }}
            />
          </Box>
        ) : (
          <Alert icon={<PlayIcon />} severity="info">
            Trận đang live.{" "}
            {streams.length
              ? "Chọn link bên dưới để xem trực tiếp."
              : "Chưa có link phát trực tiếp."}
          </Alert>
        )
      ) : (
        <Alert icon={<PlayIcon />} severity="info">
          {status === "scheduled"
            ? "Trận chưa diễn ra. "
            : "Trận đã kết thúc. "}
          {streams.length
            ? "Bạn có thể mở liên kết xem video:"
            : "Chưa có liên kết video."}
        </Alert>
      )}

      {streams.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap">
          {streams.map((s, i) => (
            <Button
              key={i}
              variant="outlined"
              size="small"
              component={MuiLink}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              underline="none"
            >
              {s.label}
            </Button>
          ))}
        </Stack>
      )}

      {overlayUrl && canSeeOverlay && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Overlay tỉ số trực tiếp
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                size="small"
                fullWidth
                value={overlayUrl}
                InputProps={{ readOnly: true }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyIcon />}
                  onClick={() => navigator.clipboard.writeText(overlayUrl)}
                >
                  Copy link
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={<OpenInNewIcon />}
                  component={MuiLink}
                  href={overlayUrl}
                  target="_blank"
                  rel="noreferrer"
                  underline="none"
                  sx={{ color: "white !important" }}
                >
                  Mở overlay
                </Button>
              </Stack>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Mẹo: dán link này vào OBS/StreamYard (Browser Source) để hiển thị
              tỉ số ở góc màn hình.
            </Typography>
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={700} gutterBottom>
          Điểm số
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
        >
          <Box flex={1}>
            <Typography variant="body2" color="text.secondary">
              Đội A
            </Typography>
            <Typography variant="h6">{teamA}</Typography>
          </Box>
          <Box textAlign="center" minWidth={140}>
            {status === "live" && (
              <Typography variant="caption" color="text.secondary">
                Ván hiện tại
              </Typography>
            )}
            <Typography variant="h4" fontWeight={800}>
              {curr.a} – {curr.b}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sets: {gamesWon.A} – {gamesWon.B}
            </Typography>
            {!!leading && (
              <Chip
                size="small"
                color="primary"
                sx={{ mt: 0.5 }}
                label={leading === "A" ? "A đang dẫn" : "B đang dẫn"}
              />
            )}
          </Box>
          <Box flex={1} textAlign={{ xs: "left", sm: "right" }}>
            <Typography variant="body2" color="text.secondary">
              Đội B
            </Typography>
            <Typography variant="h6">{teamB}</Typography>
          </Box>
        </Stack>

        {!!m?.gameScores?.length && (
          <Table size="small" sx={{ mt: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>Set</TableCell>
                <TableCell align="center">A</TableCell>
                <TableCell align="center">B</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {m.gameScores.map((g, idx) => (
                <TableRow key={idx}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell align="center">{g.a ?? 0}</TableCell>
                  <TableCell align="center">{g.b ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {status === "finished" && winnerSide && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Đội thắng: <b>{winnerSide === "A" ? teamA : teamB}</b>
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Chip size="small" label={`Best of: ${m.rules?.bestOf ?? 3}`} />
          <Chip
            size="small"
            label={`Điểm thắng: ${m.rules?.pointsToWin ?? 11}`}
          />
          {m.rules?.winByTwo && <Chip size="small" label="Phải chênh 2" />}
          {m.referee?.name && (
            <Chip size="small" label={`Trọng tài: ${m.referee.name}`} />
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

/* ===== Responsive viewer: Drawer (mobile) / Dialog (desktop) ===== */
function ResponsiveMatchViewer({ open, matchId, onClose }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;

  const { data: base, isLoading } = useGetMatchPublicQuery(matchId, {
    skip: !matchId || !open,
  });
  const { loading: liveLoading, data: live } = useLiveMatch(
    open ? matchId : null,
    token
  );
  const m = live || base;
  const status = m?.status || "scheduled";

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "92vh",
            maxHeight: "100vh",
            minHeight: "80vh",
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            pt: 1.25,
            maxWidth: 1000,
            mx: "auto",
            width: "100%",
            pb: 6,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 4,
              bgcolor: "text.disabled",
              borderRadius: 2,
              mx: "auto",
              mb: 1.25,
            }}
          />
          <Box sx={{ position: "relative", pb: 1 }}>
            <Typography variant="h6">
              Trận đấu • {m ? `R${m.round || 1} #${m.order ?? 0}` : ""}
              <Chip
                size="small"
                sx={{ ml: 1 }}
                label={
                  status === "live"
                    ? "Đang diễn ra"
                    : status === "finished"
                    ? "Hoàn thành"
                    : "Dự kiến"
                }
                color={
                  status === "live"
                    ? "warning"
                    : status === "finished"
                    ? "success"
                    : "default"
                }
              />
            </Typography>
            <IconButton
              onClick={onClose}
              sx={{ position: "absolute", right: -6, top: -6 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={{ overflowY: "auto", pr: { md: 1 }, pb: 1 }}>
            <MatchContent
              m={m}
              isLoading={isLoading}
              liveLoading={liveLoading}
              onClose={onClose}
            />
          </Box>
        </Box>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 6 }}>
        Trận đấu • {m ? `R${m.round || 1} #${m.order ?? 0}` : ""}
        <Chip
          size="small"
          sx={{ ml: 1 }}
          label={
            status === "live"
              ? "Đang diễn ra"
              : status === "finished"
              ? "Hoàn thành"
              : "Dự kiến"
          }
          color={
            status === "live"
              ? "warning"
              : status === "finished"
              ? "success"
              : "default"
          }
        />
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <MatchContent
          m={m}
          isLoading={isLoading}
          liveLoading={liveLoading}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ===================== BXH group ===================== */
function GroupStandingsTable({ rows, eventType }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  if (isMobile) {
    return (
      <Stack spacing={1} sx={{ mb: 2 }}>
        {rows.length ? (
          rows.map((row, idx) => (
            <Paper
              key={row.pair?._id || idx}
              variant="outlined"
              sx={{ p: 1.25 }}
            >
              <Stack direction="row" alignItems="center" spacing={1}>
                <Chip
                  size="small"
                  label={`#${idx + 1}`}
                  sx={{ minWidth: 40 }}
                />
                <Typography
                  sx={{ fontWeight: 600, flex: 1 }}
                  title={safePairName(row.pair, eventType)}
                >
                  {safePairName(row.pair, eventType)}
                </Typography>
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`${row.win}-${row.loss}`}
                />
              </Stack>
            </Paper>
          ))
        ) : (
          <Paper variant="outlined" sx={{ p: 2, textAlign: "center" }}>
            Chưa có dữ liệu BXH.
          </Paper>
        )}
      </Stack>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
      <Table
        size="small"
        sx={{ tableLayout: "fixed", minWidth: { xs: "auto", sm: 480 } }}
      >
        <TableHead style={{ display: "table-header-group" }}>
          <TableRow>
            <TableCell sx={{ width: 56, fontWeight: 700 }}>#</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Cặp</TableCell>
            <TableCell align="center" sx={{ width: 90, fontWeight: 700 }}>
              Thắng
            </TableCell>
            <TableCell align="center" sx={{ width: 90, fontWeight: 700 }}>
              Thua
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? (
            rows.map((row, idx) => (
              <TableRow key={row.pair?._id || idx}>
                <TableCell>{idx + 1}</TableCell>
                <TableCell>{safePairName(row.pair, eventType)}</TableCell>
                <TableCell align="center">{row.win}</TableCell>
                <TableCell align="center">{row.loss}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4} align="center">
                Chưa có dữ liệu BXH.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
GroupStandingsTable.propTypes = {
  rows: PropTypes.array.isRequired,
  eventType: PropTypes.string,
};

/* ===================== Component chính ===================== */
export default function TournamentBracket() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const { id: tourId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data: tour,
    isLoading: l1,
    error: e1,
  } = useGetTournamentQuery(tourId);
  const {
    data: brackets = [],
    isLoading: l2,
    error: e2,
  } = useListTournamentBracketsQuery(tourId);
  const {
    data: allMatches = [],
    isLoading: l3,
    error: e3,
  } = useListTournamentMatchesQuery(
    { tournamentId: tourId },
    {
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    }
  );

  const loading = l1 || l2 || l3;
  const error = e1 || e2 || e3;

  const matches = useMemo(
    () =>
      (allMatches || []).filter(
        (m) => String(m.tournament?._id || m.tournament) === String(tourId)
      ),
    [allMatches, tourId]
  );

  const byBracket = useMemo(() => {
    const m = {};
    (brackets || []).forEach((b) => (m[b._id] = []));
    (matches || []).forEach((mt) => {
      const bid = mt.bracket?._id || mt.bracket;
      if (m[bid]) m[bid].push(mt);
    });
    return m;
  }, [brackets, matches]);

  const groupStandings = useMemo(() => {
    const map = {};
    (brackets || [])
      .filter((b) => b.type === "group")
      .forEach((b) => {
        const rows = {};
        (byBracket[b._id] || []).forEach((m) => {
          const aId = m.pairA?._id;
          const bId = m.pairB?._id;
          if (!aId || !bId) return;
          rows[aId] ||= { pair: m.pairA, win: 0, loss: 0 };
          rows[bId] ||= { pair: m.pairB, win: 0, loss: 0 };
          if (m.winner === "A") {
            rows[aId].win += 1;
            rows[bId].loss += 1;
          } else if (m.winner === "B") {
            rows[bId].win += 1;
            rows[aId].loss += 1;
          }
        });
        map[b._id] = Object.values(rows).sort(
          (x, y) =>
            y.win - x.win ||
            x.loss - y.loss ||
            (x.pair?.player1?.fullName || "").localeCompare(
              y.pair?.player1?.fullName || ""
            )
        );
      });
    return map;
  }, [brackets, byBracket]);

  // Tab <-> URL sync
  const readTabFromUrl = (count) => {
    const v = Number(searchParams.get("tab"));
    return Number.isFinite(v) && v >= 0 && v < count ? v : 0;
  };
  const [tab, setTab] = useState(0);
  useEffect(() => {
    const v = readTabFromUrl(brackets.length || 0);
    if (v !== tab) setTab(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, brackets.length]);

  const onTabChange = (_e, v) => {
    setTab(v);
    const next = new URLSearchParams(searchParams);
    next.set("tab", String(v));
    setSearchParams(next, { replace: true });
  };

  // Viewer state
  const [open, setOpen] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState(null);
  const openMatch = (m) => {
    setActiveMatchId(m._id);
    setOpen(true);
  };
  const closeMatch = () => setOpen(false);

  // Nếu KO chưa có trận → dựng khung trống theo QUY MÔ (nếu có), nếu không có thì ước lượng từ group-top2
  const buildEmptyRoundsForKO = useCallback(
    (koBracket) => {
      // 1) thử đọc quy mô từ chính bracket
      const scaleFromBracket = readBracketScale(koBracket);
      if (scaleFromBracket) return buildEmptyRoundsByScale(scaleFromBracket);

      // 2) không có quy mô → ước lượng từ stage trước (group) * 2 top
      const groupBrs = (brackets || []).filter((b) => b.type === "group");
      let source = null;
      if (groupBrs.length) {
        const cand = groupBrs.filter((g) =>
          Number.isFinite(g.stage) && Number.isFinite(koBracket?.stage)
            ? g.stage < koBracket.stage
            : true
        );
        source =
          cand.sort((a, b) => (b.stage ?? 0) - (a.stage ?? 0))[0] ||
          groupBrs[0];
      }

      let entrants = 0;
      if (source) {
        const gMatches = byBracket[source._id] || [];
        const groups = new Set(
          gMatches.map(getGroupKey).filter((k) => k && k !== UNGROUPED)
        );
        entrants = groups.size * 2; // mặc định Top 2 mỗi bảng
      }

      const fallback = 4; // nếu không biết gì, hiển thị bán kết
      const scale = ceilPow2(Math.max(entrants, fallback));
      return buildEmptyRoundsByScale(scale);
    },
    [brackets, byBracket]
  );

  const winnerPair = (m) => {
    if (!m || m.status !== "finished" || !m.winner) return null;
    return m.winner === "A" ? m.pairA : m.pairB;
  };

  if (loading) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">
          {error?.data?.message || error?.error || "Lỗi tải dữ liệu."}
        </Alert>
      </Box>
    );
  }
  if (!brackets.length) {
    return (
      <Box p={3}>
        <Alert severity="info">Chưa có bracket nào cho giải này.</Alert>
      </Box>
    );
  }

  // Label không ellipsis
  const tabLabels = brackets.map((b) => (
    <Stack key={b._id} direction="row" spacing={1} alignItems="center">
      <Typography>{b.name}</Typography>
      <Chip
        size="small"
        label={b.type === "group" ? "Group" : "Knockout"}
        color={b.type === "group" ? "default" : "primary"}
        variant="outlined"
        sx={{ ml: 0.5 }}
      />
    </Stack>
  ));

  const current = brackets[tab];
  const currentMatches = byBracket[current._id] || [];
  const uniqueRoundsCount = new Set(currentMatches.map((m) => m.round ?? 1))
    .size;

  // ★ minRounds từ QUY MÔ nếu có (không còn mặc định 3)
  const scaleForCurrent = readBracketScale(current);
  const roundsFromScale = scaleForCurrent
    ? Math.ceil(Math.log2(scaleForCurrent))
    : 0;
  const minRoundsForCurrent = Math.max(uniqueRoundsCount, roundsFromScale);

  return (
    <Box sx={{ width: "100%", pb: { xs: 6, sm: 0 } }}>
      <Typography variant="h5" sx={{ mb: 2, mt: 2 }} fontWeight="bold">
        Sơ đồ giải: {tour?.name}
      </Typography>

      <Tabs
        value={tab}
        onChange={onTabChange}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2 }}
      >
        {tabLabels.map((node, i) => (
          <Tab
            key={brackets[i]._id}
            label={node}
            sx={{ maxWidth: "none", minHeight: 44, px: 1.5 }}
          />
        ))}
      </Tabs>

      {/* ===== Nội dung mỗi tab = đúng bracket ===== */}
      {current.type === "group" ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Bảng: {current.name}
          </Typography>

          <Typography variant="subtitle1" gutterBottom>
            Bảng xếp hạng
          </Typography>
          <GroupStandingsTable
            rows={groupStandings[current._id] || []}
            eventType={tour?.eventType}
          />

          <Typography variant="subtitle1" gutterBottom>
            Các trận trong bảng
          </Typography>

          {isMobile ? (
            <Stack spacing={1}>
              {currentMatches.length ? (
                currentMatches
                  .slice()
                  .sort(
                    (a, b) =>
                      (a.round || 1) - (b.round || 1) ||
                      (a.order || 0) - (b.order || 0)
                  )
                  .map((m) => (
                    <Paper
                      key={m._id}
                      variant="outlined"
                      onClick={() => openMatch(m)}
                      sx={{
                        p: 1.25,
                        cursor: "pointer",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Chip size="small" label={`R${m.round || 1}`} />
                        <Box flex={1} minWidth={0}>
                          <Typography title={matchSideLabel(m, "A")}>
                            {matchSideLabel(m, "A")}
                          </Typography>
                          <Typography title={matchSideLabel(m, "B")}>
                            {matchSideLabel(m, "B")}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={resultLabel(m)}
                        />
                      </Stack>
                    </Paper>
                  ))
              ) : (
                <Paper variant="outlined" sx={{ p: 2, textAlign: "center" }}>
                  Chưa có trận nào.
                </Paper>
              )}
            </Stack>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" sx={{ tableLayout: "fixed", minWidth: 640 }}>
                <TableHead style={{ display: "table-header-group" }}>
                  <TableRow>
                    <TableCell sx={{ width: 80, fontWeight: 700 }}>
                      Vòng
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Đội A</TableCell>
                    <TableCell
                      align="center"
                      sx={{ width: 72, fontWeight: 700 }}
                    >
                      vs
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Đội B</TableCell>
                    <TableCell
                      align="center"
                      sx={{ width: 180, fontWeight: 700 }}
                    >
                      Kết quả
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {currentMatches.length ? (
                    currentMatches
                      .slice()
                      .sort(
                        (a, b) =>
                          (a.round || 1) - (b.round || 1) ||
                          (a.order || 0) - (b.order || 0)
                      )
                      .map((m) => (
                        <TableRow
                          key={m._id}
                          hover
                          onClick={() => openMatch(m)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>R{m.round || 1}</TableCell>
                          <TableCell>{matchSideLabel(m, "A")}</TableCell>
                          <TableCell align="center">vs</TableCell>
                          <TableCell>{matchSideLabel(m, "B")}</TableCell>
                          <TableCell align="center">{resultLabel(m)}</TableCell>
                        </TableRow>
                      ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        Chưa có trận nào.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      ) : (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Nhánh knock-out: {current.name}
          </Typography>

          {(() => {
            const finalLike =
              currentMatches.find((m) => !m?.nextMatch) ||
              currentMatches
                .slice()
                .sort((a, c) => (c.round || 1) - (a.round || 1))[0] ||
              null;
            const champion = winnerPair(finalLike);

            // rounds để render:
            // - có trận thật => fill + placeholder cho đủ cột (minRounds theo quy mô nếu có)
            // - chưa có trận => dựng khung trống theo QUY MÔ
            const roundsToRender =
              currentMatches.length > 0
                ? buildRoundsWithPlaceholders(currentMatches, {
                    /* ... */
                  })
                : current.drawRounds && current.drawRounds > 0
                ? buildEmptyRoundsByScale(2 ** current.drawRounds)
                : buildEmptyRoundsForKO(current); // fallback cũ

            return (
              <>
                {champion && (
                  <Alert severity="success" sx={{ mb: 1 }}>
                    Vô địch: <b>{safePairName(champion, tour?.eventType)}</b>
                  </Alert>
                )}

                <Box sx={{ overflowX: { xs: "auto", sm: "visible" }, pb: 1 }}>
                  <Bracket
                    rounds={roundsToRender}
                    renderSeedComponent={(props) => (
                      <CustomSeed {...props} onOpen={openMatch} />
                    )}
                    mobileBreakpoint={0}
                  />
                </Box>

                {currentMatches.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    * Chưa bốc thăm / chưa lấy đội từ vòng trước — tạm hiển thị
                    khung theo <b>quy mô</b> (hoặc ước lượng top2 mỗi bảng). Khi
                    có trận thật, nhánh sẽ tự cập nhật.
                  </Typography>
                )}
              </>
            );
          })()}
        </Paper>
      )}

      <ResponsiveMatchViewer
        open={open}
        matchId={activeMatchId}
        onClose={closeMatch}
      />
    </Box>
  );
}
