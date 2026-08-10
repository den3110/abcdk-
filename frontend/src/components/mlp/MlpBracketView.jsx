// components/mlp/MlpBracketView.jsx — Bracket view for MLP tournaments (web).
// Thay thế bracket chuẩn khi tournament.tournamentMode === "mlp".
import React, { useMemo } from "react";
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

  const dualsByRound = useMemo(() => {
    const map = new Map();
    duals.forEach((d) => {
      const r = Number(d?.round || 1);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(d);
    });
    return Array.from(map.keys())
      .sort((a, b) => a - b)
      .map((r) => ({
        round: r,
        items: (map.get(r) || []).sort(
          (a, b) => Number(a?.order || 0) - Number(b?.order || 0),
        ),
      }));
  }, [duals]);

  if (dLoading || sLoading || tLoading) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  const go = (path) => navigate(`/tournament/${tourId}/mlp/${path}`);

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
            label="MLP Format"
            sx={{
              bgcolor: "#FEF3C7",
              color: "#B45309",
              fontWeight: 800,
              border: "1px solid #FCD34D",
            }}
          />
          <Typography variant="body2" color="text.secondary">
            {teams.length} team · {duals.length} dual match
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

      <Grid container spacing={2}>
        {/* Standings sidebar */}
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
                  {standings.slice(0, 8).map((row, idx) => {
                    const rankBg =
                      idx === 0
                        ? "#FEF3C7"
                        : idx === 1
                          ? "#F1F5F9"
                          : idx === 2
                            ? "#FEE2E2"
                            : "transparent";
                    return (
                      <Stack
                        key={String(row?.team?._id || idx)}
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        sx={{
                          bgcolor: rankBg,
                          p: 1,
                          borderRadius: 1.5,
                        }}
                      >
                        <Typography
                          fontWeight={900}
                          sx={{ minWidth: 32, textAlign: "center" }}
                        >
                          {idx === 0
                            ? "🥇"
                            : idx === 1
                              ? "🥈"
                              : idx === 2
                                ? "🥉"
                                : `#${idx + 1}`}
                        </Typography>
                        <Avatar
                          src={row?.team?.logo}
                          sx={{
                            width: 32,
                            height: 32,
                            bgcolor: "#E0E7FF",
                            color: "#4338CA",
                            fontWeight: 800,
                          }}
                        >
                          {(row?.team?.shortName || row?.team?.name || "?")
                            .charAt(0)
                            .toUpperCase()}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography fontWeight={700} noWrap>
                            {row?.team?.name || "—"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            W {row?.wins || 0} · L {row?.losses || 0} · Slot{" "}
                            {row?.slotsFor || 0}-{row?.slotsAgainst || 0}
                          </Typography>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Dual matches by round */}
        <Grid item xs={12} md={standings.length > 0 ? 8 : 12}>
          {dualsByRound.length === 0 ? (
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent sx={{ textAlign: "center", py: 6 }}>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  Chưa có dual match nào — BTC vào trang MLP Duals để sinh.
                </Typography>
                <Button variant="contained" onClick={() => go("duals")}>
                  Vào MLP Duals
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Stack spacing={2.5}>
              {dualsByRound.map(({ round, items }) => (
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
                        onOpen={() =>
                          navigate(
                            `/tournament/${tourId}/mlp/dual/${dl._id}`,
                          )
                        }
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}

function DualCard({ dual, onOpen }) {
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
        borderRadius: 3,
        cursor: "pointer",
        "&:hover": { boxShadow: 3 },
      }}
      onClick={onOpen}
    >
      <CardContent>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1.5 }}
        >
          {statusChip}
          {finished && dual?.finishedAt && (
            <Typography variant="caption" color="text.disabled">
              {new Date(dual.finishedAt).toLocaleDateString("vi-VN")}
            </Typography>
          )}
        </Stack>

        <Stack spacing={0.5}>
          <TeamRow
            team={dual?.teamA}
            score={dual?.slotWinsA}
            isWinner={teamAWinner}
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
          />
        </Stack>

        {/* Sub-match summary */}
        {Array.isArray(dual?.subMatches) && dual.subMatches.length > 0 && (
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
                w === "A"
                  ? "#DBEAFE"
                  : w === "B"
                    ? "#FEE2E2"
                    : "#F1F5F9";
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

        {/* DreamBreaker */}
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

function TeamRow({ team, score, isWinner }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        p: 1,
        borderRadius: 1.5,
        bgcolor: isWinner ? "#F0FDF4" : "#F8FAFC",
        border: isWinner ? "1px solid #10B981" : "1px solid transparent",
      }}
    >
      <Avatar
        src={team?.logo}
        sx={{
          width: 36,
          height: 36,
          bgcolor: "#E0E7FF",
          color: "#4338CA",
          fontWeight: 800,
        }}
      >
        {(team?.shortName || team?.name || "?").charAt(0).toUpperCase()}
      </Avatar>
      <Typography
        sx={{ flex: 1, fontWeight: 700, color: isWinner ? "#065F46" : "#0F172A" }}
        noWrap
      >
        {team?.name || "—"}
      </Typography>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 900,
          color: isWinner ? "#065F46" : "#0F172A",
        }}
      >
        {score ?? 0}
      </Typography>
      {isWinner && <CheckCircle sx={{ color: "#10B981", fontSize: 20 }} />}
    </Stack>
  );
}
