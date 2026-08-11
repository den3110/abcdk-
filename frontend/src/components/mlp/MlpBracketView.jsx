// components/mlp/MlpBracketView.jsx — Bracket view for MLP tournaments (web).
// Thay thế bracket chuẩn khi tournament.tournamentMode === "mlp".
// - Nếu giải bật groupStage: render pools grid (mini BXH + duals) + knockout bracket.
// - Nếu flat mode: render duals theo round như cũ.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import {
  EmojiEvents,
  Groups,
  GridView,
  Shield,
  CheckCircle,
  Whatshot,
} from "@mui/icons-material";

import {
  useListMlpDualsQuery,
  useListMlpStandingsQuery,
  useListMlpTeamsQuery,
} from "../../slices/mlpApiSlice";

// ─────────────────────────────────────────────────────────────

// Sinh label placeholder từ sourceA/B khi teamA/B null.
export function placeholderLabel(source) {
  if (!source || !source.kind) return null;
  if (source.kind === "poolRank") {
    const rank = Number(source.poolRank) || 1;
    const label = rank === 1 ? "Nhất" : rank === 2 ? "Nhì" : rank === 3 ? "Ba" : `#${rank}`;
    return `${label} bảng ${source.poolKey || "?"}`;
  }
  if (source.kind === "winner") {
    return `Thắng T${(Number(source.fromMatchOrder) || 0) + 1}`;
  }
  return null;
}

function TeamRow({ team, score, isWinner, compact = false, placeholder }) {
  if (!team && placeholder) {
    return (
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{
          p: compact ? 0.5 : 1,
          borderRadius: 1.5,
          bgcolor: "#FEF3C7",
          border: "1px dashed #F59E0B",
        }}
      >
        <Avatar
          sx={{
            width: compact ? 24 : 36,
            height: compact ? 24 : 36,
            bgcolor: "#F59E0B",
            fontSize: compact ? 11 : 14,
          }}
        >
          ?
        </Avatar>
        <Typography
          sx={{ flex: 1, fontWeight: 700, fontStyle: "italic", color: "#92400E", fontSize: compact ? 12 : 14 }}
          noWrap
        >
          {placeholder}
        </Typography>
        <Typography variant={compact ? "body2" : "h5"} sx={{ fontWeight: 900, color: "#92400E" }}>
          –
        </Typography>
      </Stack>
    );
  }
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        p: compact ? 0.5 : 1,
        borderRadius: 1.5,
        bgcolor: isWinner ? "#F0FDF4" : "#F8FAFC",
        border: isWinner ? "1px solid #10B981" : "1px solid transparent",
      }}
    >
      <Avatar
        src={team?.logo}
        sx={{
          width: compact ? 24 : 36,
          height: compact ? 24 : 36,
          bgcolor: team?.color || "#E0E7FF",
          color: "#fff",
          fontWeight: 800,
          fontSize: compact ? 11 : 14,
        }}
      >
        {(team?.shortName || team?.name || "?").charAt(0).toUpperCase()}
      </Avatar>
      <Typography
        sx={{
          flex: 1,
          fontWeight: 700,
          fontSize: compact ? 12 : 14,
          color: isWinner ? "#065F46" : "#0F172A",
        }}
        noWrap
      >
        {team?.name || "TBD"}
      </Typography>
      <Typography
        variant={compact ? "body2" : "h5"}
        sx={{
          fontWeight: 900,
          color: isWinner ? "#065F46" : "#0F172A",
        }}
      >
        {score ?? 0}
      </Typography>
      {isWinner && (
        <CheckCircle
          sx={{ color: "#10B981", fontSize: compact ? 14 : 20 }}
        />
      )}
    </Stack>
  );
}

function DualCard({ dual, onOpen, compact = false }) {
  const status = String(dual?.status || "").toLowerCase();
  const finished = status === "finished";
  const tieBreak = status === "tie_break";
  const live = status === "live";
  const teamAWinner = dual?.winner === "A";
  const teamBWinner = dual?.winner === "B";

  const statusChip = finished ? (
    <Chip
      size="small"
      label="Đã kết thúc"
      color="success"
      variant="outlined"
    />
  ) : tieBreak ? (
    <Chip
      size="small"
      label="🏆 DreamBreaker"
      sx={{ bgcolor: "#FEF3C7", color: "#92400E", fontWeight: 800 }}
    />
  ) : live ? (
    <Chip size="small" label="Đang diễn ra" color="info" />
  ) : (
    <Chip size="small" label="Chưa bắt đầu" variant="outlined" />
  );

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        cursor: onOpen ? "pointer" : "default",
        "&:hover": onOpen ? { boxShadow: 3 } : undefined,
      }}
      onClick={onOpen}
    >
      <CardContent sx={{ p: compact ? 1 : 2, "&:last-child": { pb: compact ? 1 : 2 } }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1 }}
        >
          {statusChip}
          {dual.poolKey && (
            <Chip size="small" label={`Bảng ${dual.poolKey}`} variant="outlined" />
          )}
          {dual.phase === "knockout" && (
            <Chip
              size="small"
              label={`KO R${dual.knockoutRound || 1}`}
              color="secondary"
              variant="outlined"
            />
          )}
        </Stack>

        <Stack spacing={0.5}>
          <TeamRow
            team={dual?.teamA}
            score={dual?.slotWinsA}
            isWinner={teamAWinner}
            compact={compact}
            placeholder={placeholderLabel(dual?.sourceA)}
          />
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ textAlign: "center", fontWeight: 700 }}
          >
            vs
          </Typography>
          <TeamRow
            team={dual?.teamB}
            score={dual?.slotWinsB}
            isWinner={teamBWinner}
            compact={compact}
            placeholder={placeholderLabel(dual?.sourceB)}
          />
        </Stack>

        {!compact &&
          Array.isArray(dual?.subMatches) &&
          dual.subMatches.length > 0 && (
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 1.5 }}
            >
              {dual.subMatches.map((s) => {
                const w = s?.result?.winner;
                const bg =
                  w === "A" ? "#DBEAFE" : w === "B" ? "#FEE2E2" : "#F1F5F9";
                return (
                  <Chip
                    key={String(s._id)}
                    size="small"
                    label={`${s.slotKey} · ${s?.result?.scoreA ?? 0}-${s?.result?.scoreB ?? 0}`}
                    sx={{ bgcolor: bg, fontWeight: 700, fontSize: 11 }}
                  />
                );
              })}
            </Stack>
          )}

        {dual?.dreamBreaker?.triggered && (
          <Alert
            icon={<Whatshot fontSize="small" />}
            severity="warning"
            sx={{ mt: 1.5, py: 0.5 }}
          >
            <Typography variant="caption" fontWeight={800}>
              DreamBreaker: {dual.dreamBreaker.scoreA || 0} —{" "}
              {dual.dreamBreaker.scoreB || 0}
              {dual.dreamBreaker.winner
                ? ` · Winner: Team ${dual.dreamBreaker.winner}`
                : " · Đang diễn ra"}
            </Typography>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// Compact BXH row cho pool card.
function StandingsRow({ row, rank }) {
  const rankBg =
    rank === 1
      ? "#FEF3C7"
      : rank === 2
        ? "#F1F5F9"
        : rank === 3
          ? "#FEE2E2"
          : "transparent";
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ bgcolor: rankBg, p: 0.5, borderRadius: 1 }}
    >
      <Typography
        fontWeight={900}
        sx={{ minWidth: 22, textAlign: "center", fontSize: 12 }}
      >
        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`}
      </Typography>
      <Avatar
        src={row?.logo}
        sx={{
          width: 22,
          height: 22,
          bgcolor: row?.color || "#E0E7FF",
          color: "#fff",
          fontSize: 10,
          fontWeight: 800,
        }}
      >
        {(row?.shortName || row?.name || "?").charAt(0).toUpperCase()}
      </Avatar>
      <Typography
        sx={{ flex: 1, fontSize: 12, fontWeight: 700 }}
        noWrap
      >
        {row?.name}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {row?.wins || 0}-{row?.losses || 0}
      </Typography>
    </Stack>
  );
}

// Khối 1 bảng: header + BXH mini + list duals.
function PoolBox({ pool, standingsRows, duals, topPerPool, onOpenDual }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1 }}
        >
          <Typography variant="h6" fontWeight={900}>
            Bảng {pool.key}
          </Typography>
          <Chip
            size="small"
            label={`${standingsRows.length} đội`}
            variant="outlined"
          />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {standingsRows.length ? (
          <Stack spacing={0.5} sx={{ mb: 1.5 }}>
            {standingsRows.map((row, idx) => {
              const isTop = idx < (topPerPool || 0);
              return (
                <Box
                  key={String(row._id)}
                  sx={{
                    borderLeft: isTop
                      ? "3px solid #10B981"
                      : "3px solid transparent",
                    pl: 0.5,
                  }}
                >
                  <StandingsRow row={row} rank={idx + 1} />
                </Box>
              );
            })}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Chưa có đội trong bảng.
          </Typography>
        )}
        {duals.length > 0 && (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 700, textTransform: "uppercase" }}
            >
              Trận trong bảng
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {duals.slice(0, 6).map((dl) => (
                <DualCard
                  key={String(dl._id)}
                  dual={dl}
                  onOpen={onOpenDual ? () => onOpenDual(dl) : undefined}
                  compact
                />
              ))}
              {duals.length > 6 && (
                <Typography variant="caption" color="text.secondary">
                  … và {duals.length - 6} trận khác
                </Typography>
              )}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Horizontal knockout bracket: 1 column mỗi round.
function KnockoutBracket({ rounds, onOpenDual }) {
  if (!rounds.length) return null;
  const labels = {
    1: "Vòng 1",
    2: "Tứ kết",
    3: "Bán kết",
    4: "Chung kết",
  };
  // Nếu 4 rounds → r1=1/16, r2=1/8, ...; nếu ít hơn thì auto-name theo N.
  const totalRounds = rounds.length;
  const labelFor = (r) => {
    const remaining = totalRounds - r + 1;
    if (remaining === 1) return "Chung kết";
    if (remaining === 2) return "Bán kết";
    if (remaining === 3) return "Tứ kết";
    return `Vòng ${r}`;
  };
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={900} sx={{ mb: 1 }}>
          🏆 Sơ đồ Knockout
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Box
          sx={{
            display: "flex",
            gap: 3,
            overflowX: "auto",
            pb: 1,
          }}
        >
          {rounds.map(({ round, items }) => (
            <Box
              key={round}
              sx={{
                minWidth: 260,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-around",
                gap: 2,
              }}
            >
              <Typography
                variant="subtitle2"
                fontWeight={900}
                sx={{ textAlign: "center", mb: 0.5 }}
              >
                {labelFor(round)}
              </Typography>
              <Stack
                spacing={2}
                sx={{ flex: 1, justifyContent: "space-around" }}
              >
                {items.map((dl) => (
                  <DualCard
                    key={String(dl._id)}
                    dual={dl}
                    onOpen={onOpenDual ? () => onOpenDual(dl) : undefined}
                    compact
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────

export default function MlpBracketView({ tourId, tour }) {
  const navigate = useNavigate();
  const { data: dualsResp, isLoading: dLoading } = useListMlpDualsQuery(
    { tourId },
    { skip: !tourId, refetchOnFocus: true },
  );
  const { data: standingsResp, isLoading: sLoading } =
    useListMlpStandingsQuery(tourId, { skip: !tourId, refetchOnFocus: true });
  const { data: teamsResp, isLoading: tLoading } = useListMlpTeamsQuery(
    { tourId, status: "approved" },
    { skip: !tourId, refetchOnFocus: true },
  );

  const duals = Array.isArray(dualsResp?.items) ? dualsResp.items : [];
  const standings = Array.isArray(standingsResp?.items)
    ? standingsResp.items
    : [];
  const teams = Array.isArray(teamsResp?.items) ? teamsResp.items : [];
  const poolsStandings = Array.isArray(standingsResp?.pools)
    ? standingsResp.pools
    : null;
  const gs = tour?.mlpConfig?.groupStage || null;
  const useGroupStage = gs?.enabled === true;

  // Nhóm dual theo phase
  const grouped = useMemo(() => {
    const g = { group: new Map(), knockout: new Map(), legacy: new Map() };
    for (const d of duals) {
      if (d.phase === "group") {
        const k = d.poolKey || "?";
        if (!g.group.has(k)) g.group.set(k, []);
        g.group.get(k).push(d);
      } else if (d.phase === "knockout") {
        const r = d.knockoutRound || 1;
        if (!g.knockout.has(r)) g.knockout.set(r, []);
        g.knockout.get(r).push(d);
      } else {
        const r = d.round || 1;
        if (!g.legacy.has(r)) g.legacy.set(r, []);
        g.legacy.get(r).push(d);
      }
    }
    return g;
  }, [duals]);

  const koRounds = useMemo(
    () =>
      [...grouped.knockout.keys()]
        .sort((a, b) => a - b)
        .map((r) => ({
          round: r,
          items: grouped.knockout
            .get(r)
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0)),
        })),
    [grouped],
  );

  const legacyRounds = useMemo(
    () =>
      [...grouped.legacy.keys()]
        .sort((a, b) => a - b)
        .map((r) => ({
          round: r,
          items: grouped.legacy
            .get(r)
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0)),
        })),
    [grouped],
  );

  if (dLoading || sLoading || tLoading) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  const go = (path) => navigate(`/tournament/${tourId}/mlp/${path}`);
  const openDual = (dl) => {
    // Shell dual round 2+ chưa có teamA/B → chi tiết không có gì để xem.
    if (!dl?.teamA && !dl?.teamB) return;
    navigate(`/tournament/${tourId}/mlp/duals/${dl._id}`);
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", md: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Chip
            icon={<Shield sx={{ color: "#B45309 !important" }} />}
            label={useGroupStage ? "MLP · Vòng bảng + Knockout" : "MLP Format"}
            sx={{
              bgcolor: "#FEF3C7",
              color: "#B45309",
              fontWeight: 800,
              border: "1px solid #FCD34D",
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {teams.length} team · {duals.length} dual match
            {useGroupStage && poolsStandings
              ? ` · ${poolsStandings.length} bảng`
              : ""}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Groups />}
            onClick={() => go("teams")}
          >
            Teams
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<EmojiEvents />}
            onClick={() => go("standings")}
            color="success"
          >
            BXH
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<GridView />}
            onClick={() => go("duals")}
            color="warning"
          >
            Duals
          </Button>
        </Stack>
      </Stack>

      {useGroupStage ? (
        <Stack spacing={3}>
          {/* Pools grid */}
          {poolsStandings && poolsStandings.length > 0 ? (
            <Box>
              <Typography variant="h6" fontWeight={900} sx={{ mb: 1.5 }}>
                📊 Vòng bảng
              </Typography>
              <Grid container spacing={2}>
                {poolsStandings.map((p) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={p.key}>
                    <PoolBox
                      pool={p}
                      standingsRows={p.items || []}
                      duals={grouped.group.get(p.key) || []}
                      topPerPool={gs?.topPerPool}
                      onOpenDual={openDual}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ) : (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Chưa có bảng nào. BTC cần bốc thăm chia bảng và sinh dual matches.
            </Alert>
          )}

          {/* Knockout bracket */}
          {koRounds.length > 0 && (
            <KnockoutBracket rounds={koRounds} onOpenDual={openDual} />
          )}
          {koRounds.length === 0 && poolsStandings && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Sau khi kết thúc vòng bảng, BTC bấm "Sinh knockout" để tạo sơ đồ
              knockout từ top {gs?.topPerPool || 2} đội mỗi bảng.
            </Alert>
          )}
        </Stack>
      ) : (
        <Grid container spacing={2}>
          {standings.length > 0 && (
            <Grid item xs={12} md={4}>
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: 1 }}
                  >
                    <Typography variant="subtitle1" fontWeight={900}>
                      🏆 Bảng xếp hạng
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => go("standings")}
                      sx={{ textTransform: "none" }}
                    >
                      Đầy đủ →
                    </Button>
                  </Stack>
                  <Divider sx={{ mb: 1 }} />
                  <Stack spacing={0.75}>
                    {standings.slice(0, 8).map((row, idx) => (
                      <StandingsRow key={String(row._id)} row={row} rank={idx + 1} />
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          )}
          <Grid item xs={12} md={standings.length > 0 ? 8 : 12}>
            {legacyRounds.length === 0 ? (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ textAlign: "center", py: 6 }}>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    Chưa có dual match — BTC vào trang MLP Duals để sinh.
                  </Typography>
                  <Button variant="contained" onClick={() => go("duals")}>
                    Vào MLP Duals
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Stack spacing={2.5}>
                {legacyRounds.map(({ round, items }) => (
                  <Box key={round}>
                    <Typography
                      variant="subtitle1"
                      fontWeight={900}
                      sx={{ mb: 1 }}
                    >
                      Vòng {round}
                    </Typography>
                    <Stack spacing={1.5}>
                      {items.map((dl) => (
                        <DualCard
                          key={String(dl._id)}
                          dual={dl}
                          onOpen={() => openDual(dl)}
                        />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
