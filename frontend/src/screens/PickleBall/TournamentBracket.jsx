import { useMemo, useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import {
  Box,
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
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Button,
  Link as MuiLink,
} from "@mui/material";
import {
  Close as CloseIcon,
  EmojiEvents as TrophyIcon,
  PlayCircle as PlayIcon,
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
// 🔧 thêm eventType để biết single/double
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
  if (isSingle) return p1; // single: chỉ hiện player1
  return p2 ? `${p1} & ${p2}` : p1; // double: có p2 thì hiện "p1 & p2"
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
  // 🔧 truyền eventType từ match.tournament
  if (pair) return safePairName(pair, m?.tournament?.eventType);
  if (prev) return depLabel(prev);
  return "Chưa có đội";
}
function resultLabel(m) {
  if (m?.status === "finished") {
    if (m?.winner === "A") return "Đôi A thắng";
    if (m?.winner === "B") return "Đôi B thắng";
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

/* ======== Build rounds (có placeholder) cho react-brackets ======== */
function placeholderSeed(r, idx) {
  return {
    id: `placeholder-${r}-${idx}`,
    __match: null,
    teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
  };
}
function buildRoundsWithPlaceholders(brMatches, { minRounds = 3 } = {}) {
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

  let firstRound = roundsHave.length ? Math.min(...roundsHave) : 1;
  if (minRounds != null) {
    const haveCols = lastRound - firstRound + 1;
    if (haveCols < minRounds)
      firstRound = Math.max(1, lastRound - (minRounds - 1));
  }

  const countByRoundReal = {};
  real.forEach((m) => {
    const r = m.round || 1;
    countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
  });

  const seedsCount = {};
  seedsCount[lastRound] = countByRoundReal[lastRound] || 1;
  for (let r = lastRound - 1; r >= firstRound; r--) {
    seedsCount[r] = countByRoundReal[r] || seedsCount[r + 1] * 2;
  }

  const roundNums = Object.keys(seedsCount)
    .map(Number)
    .sort((a, b) => a - b);

  return roundNums.map((r) => {
    const need = seedsCount[r];
    const seeds = Array.from({ length: need }, (_, i) => placeholderSeed(r, i));

    const ms = real
      .filter((m) => (m.round || 1) === r)
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    ms.forEach((m, idx) => {
      let i = Number.isInteger(m.order)
        ? m.order
        : seeds.findIndex((s) => s.__match === null);
      if (i < 0 || i >= seeds.length) i = Math.min(idx, seeds.length - 1);
      seeds[i] = {
        id: m._id || `${r}-${i}`,
        date: m?.scheduledAt
          ? new Date(m.scheduledAt).toDateString()
          : undefined,
        __match: m,
        teams: [
          { name: matchSideLabel(m, "A") },
          { name: matchSideLabel(m, "B") },
        ],
      };
    });

    return { title: roundTitleByCount(need), seeds };
  });
}

/* ========== Custom seed (click mở popup) ========== */
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

/* ===================== Popup xem trận (realtime) ===================== */
function ytEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // youtube watch?v= → embed/
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
  // linh hoạt nhiều field: m.streams: [{label, url}], hoặc m.videoUrl, hoặc m.meta.streams
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

function MatchDialog({ open, matchId, onClose }) {
  // token (nếu có) để referee thao tác; khán giả không cần
  const { userInfo } = useSelector((s) => s.auth || {});
  const token = userInfo?.token;

  const { data: base, isLoading } = useGetMatchPublicQuery(matchId, {
    skip: !matchId || !open,
  });
  const { loading: liveLoading, data: live } = useLiveMatch(
    open ? matchId : null,
    token
  );

  const m = live || base; // ưu tiên snapshot realtime nếu có
  const streams = extractStreams(m);

  // 🔧 dùng m.tournament.eventType để render tên cặp
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

  const yt = streams.find((s) => ytEmbed(s.url));
  const ytSrc = ytEmbed(yt?.url);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 5 }}>
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
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {isLoading || liveLoading ? (
          <Box py={4} textAlign="center">
            <CircularProgress />
          </Box>
        ) : !m ? (
          <Alert severity="error">Không tải được dữ liệu trận.</Alert>
        ) : (
          <Stack spacing={2}>
            {/* STREAM AREA */}
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

            {/* LINKS */}
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
                  >
                    {s.label}
                  </Button>
                ))}
              </Stack>
            )}

            {/* SCOREBOARD */}
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
                  {/* Tí số */}
                  <Typography variant="h4" fontWeight={800}>
                    {curr.a} – {curr.b}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Sets: {gamesWon.A} – {gamesWon.B}
                  </Typography>
                  {leading && (
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

              {/* lịch sử set */}
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

              {/* Winner khi finished */}
              {status === "finished" && winnerSide && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  Đội thắng: <b>{winnerSide === "A" ? teamA : teamB}</b>
                </Alert>
              )}

              {/* Thông tin khác */}
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <Chip size="small" label={`Best of: ${m.rules?.bestOf ?? 3}`} />
                <Chip
                  size="small"
                  label={`Điểm thắng: ${m.rules?.pointsToWin ?? 11}`}
                />
                {m.rules?.winByTwo && (
                  <Chip size="small" label="Phải chênh 2" />
                )}
                {m.referee?.name && (
                  <Chip size="small" label={`Trọng tài: ${m.referee.name}`} />
                )}
              </Stack>
            </Paper>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ===================== BXH group ===================== */
// 🔧 thêm eventType để render tên đúng
function GroupStandingsTable({ rows, onOpenMatch, eventType }) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
      <Table size="small" sx={{ tableLayout: "fixed", minWidth: 480 }}>
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
                {/* 🔧 dùng eventType để ẩn player2 nếu single */}
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

/* ===================== Component chính: Tabs = từng bracket ===================== */
export default function DemoTournamentStages() {
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
  } = useListTournamentMatchesQuery({ tournamentId: tourId });

  const loading = l1 || l2 || l3;
  const error = e1 || e2 || e3;

  // chỉ match thuộc giải này
  const matches = useMemo(
    () =>
      (allMatches || []).filter(
        (m) => String(m.tournament?._id || m.tournament) === String(tourId)
      ),
    [allMatches, tourId]
  );

  // group theo bracket
  const byBracket = useMemo(() => {
    const m = {};
    (brackets || []).forEach((b) => (m[b._id] = []));
    (matches || []).forEach((mt) => {
      const bid = mt.bracket?._id || mt.bracket;
      if (m[bid]) m[bid].push(mt);
    });
    return m;
  }, [brackets, matches]);

  // BXH vòng bảng cho từng bracket
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

  // ====== Tab <-> URL sync (tab = index của bracket) ======
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

  // ===== Popup state =====
  const [open, setOpen] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState(null);
  const openMatch = (m) => {
    setActiveMatchId(m._id);
    setOpen(true);
  };
  const closeMatch = () => setOpen(false);

  const buildRoundsForKnockout = useCallback(
    (bracketId) => {
      const brMatches = (byBracket[bracketId] || [])
        .slice()
        .sort(
          (a, c) =>
            (a.round || 1) - (c.round || 1) || (a.order || 0) - (c.order || 0)
        );
      const uniqueRounds = new Set(brMatches.map((m) => m.round ?? 1));
      return buildRoundsWithPlaceholders(brMatches, {
        minRounds: Math.max(3, uniqueRounds.size),
      });
    },
    [byBracket]
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

  const tabLabels = brackets.map((b) => (
    <Stack key={b._id} direction="row" spacing={1} alignItems="center">
      <span>{b.name}</span>
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

  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="h5" sx={{ mb: 2, mt: 2 }} fontWeight={"bold"}>
        Sơ đồ giải: {tour?.name}
      </Typography>

      <Tabs value={tab} onChange={onTabChange} sx={{ mb: 2 }}>
        {tabLabels.map((node, i) => (
          <Tab key={brackets[i]._id} label={node} />
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
          {/* 🔧 truyền eventType của giải để hiển thị tên đúng */}
          <GroupStandingsTable
            rows={groupStandings[current._id] || []}
            onOpenMatch={undefined}
            eventType={tour?.eventType}
          />

          <Typography variant="subtitle1" gutterBottom>
            Các trận trong bảng
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" sx={{ tableLayout: "fixed", minWidth: 640 }}>
              <TableHead style={{ display: "table-header-group" }}>
                <TableRow>
                  <TableCell sx={{ width: 80, fontWeight: 700 }}>
                    Vòng
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Đôi A</TableCell>
                  <TableCell align="center" sx={{ width: 72, fontWeight: 700 }}>
                    vs
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Đôi B</TableCell>
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

            return (
              <>
                {champion && (
                  <Alert severity="success" sx={{ mb: 1 }}>
                    {/* 🔧 hiển thị theo eventType của giải */}
                    Vô địch: <b>{safePairName(champion, tour?.eventType)}</b>
                  </Alert>
                )}

                {currentMatches.length === 0 ? (
                  <Alert severity="info">Chưa có trận nào.</Alert>
                ) : (
                  <Bracket
                    rounds={buildRoundsForKnockout(current._id)}
                    renderSeedComponent={(props) => (
                      <CustomSeed {...props} onOpen={openMatch} />
                    )}
                    mobileBreakpoint={0}
                  />
                )}
              </>
            );
          })()}
        </Paper>
      )}

      {/* ====== MATCH POPUP ====== */}
      <MatchDialog open={open} matchId={activeMatchId} onClose={closeMatch} />
    </Box>
  );
}
