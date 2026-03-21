/* eslint-disable react/prop-types */
// src/pages/MyTournamentsPage.jsx — Thêm chức năng Expandable cho List View (MUI v7 Grid v2)

import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
  Collapse,
  Grid,
} from "@mui/material";

// ⬇️ Icons
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import LockIcon from "@mui/icons-material/Lock";
import LoginIcon from "@mui/icons-material/Login";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import ScheduleIcon from "@mui/icons-material/Schedule";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PlaceIcon from "@mui/icons-material/Place";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import InfoIcon from "@mui/icons-material/Info";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";

import { useSelector } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";
import { useNavigate } from "react-router-dom";
import { useListMyTournamentsQuery } from "../slices/tournamentsApiSlice";
import ResponsiveMatchViewer from "./PickleBall/match/ResponsiveMatchViewer";
import { useSocket } from "../context/SocketContext";
import { useSocketRoomSet } from "../hook/useSocketRoomSet";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";
import {
  formatDate,
  formatDateTime,
} from "../i18n/format.js";

function normalizeGroupCode(code) {
  const s = String(code || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s; // Đã là số
  if (/^[A-Z]$/.test(s)) return String(s.charCodeAt(0) - 64); // A=1, B=2,...
  return s;
}

/* ================= Utils (Giữ nguyên) ================= */
const dateFmt = (s, locale) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d, locale)} ${formatDateTime(d, locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).split(", ").pop()}`;
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
function roundText(m, translate) {
  if (m.roundName) return m.roundName;
  if (m.phase) return m.phase;

  // ✅ SỬA: Hiển thị vòng bảng đẹp hơn
  if (m.format === "group") {
    // Có pool.name (tên bảng) → hiển thị "Bảng A", "Bảng B",...
    const poolName = m.pool?.name || m.groupCode;
    if (poolName) {
      // Nếu là số → "Bảng 1", "Bảng 2"
      if (/^\d+$/.test(String(poolName))) {
        return translate("myTournaments.rounds.groupName", {
          name: poolName,
        });
      }
      // Nếu là chữ → "Bảng A", "Bảng B"
      return translate("myTournaments.rounds.groupName", {
        name: String(poolName).toUpperCase(),
      });
    }

    // Fallback: có rrRound → "Vòng bảng - Lượt X"
    if (Number.isFinite(m.rrRound)) {
      return translate("myTournaments.rounds.groupRound", {
        round: m.rrRound + 1,
      });
    }

    // Không có gì → chỉ "Vòng bảng"
    return translate("myTournaments.rounds.group");
  }

  // ✅ Các format khác
  if (Number.isFinite(m.swissRound)) {
    return translate("myTournaments.rounds.swissRound", {
      round: m.swissRound + 1,
    });
  }

  if (Number.isFinite(m.round)) {
    // Knockout/Playoff
    if (m.format === "knockout" || m.format === "roundElim") {
      const roundNames = {
        1: translate("myTournaments.rounds.roundOf16"),
        2: translate("myTournaments.rounds.roundOf8"),
        3: translate("myTournaments.rounds.quarterfinal"),
        4: translate("myTournaments.rounds.semifinal"),
        5: translate("myTournaments.rounds.final"),
      };
      return (
        roundNames[m.round] ||
        translate("myTournaments.rounds.round", { round: m.round })
      );
    }
    return translate("myTournaments.rounds.round", { round: m.round });
  }

  return "—";
}

/* ========== Tone helpers (Giữ nguyên) ========== */
const toneToMuiColor = (tone) => {
  if (tone === "upcoming" || tone === "scheduled") return "primary";
  if (tone === "ongoing" || tone === "live") return "warning";
  if (tone === "finished") return "success";
  return "primary";
};

/* ================= Small UI bits (Giữ nguyên) ================= */

function StatusChipWithIcon({ status, translate }) {
  const map = {
    live: {
      label: translate("tournaments.statuses.ongoing"),
      color: "warning",
      Icon: PlayArrowIcon,
    },
    finished: {
      label: translate("tournaments.statuses.finished"),
      color: "success",
      Icon: EmojiEventsIcon,
    },
    scheduled: {
      label: translate("tournaments.statuses.upcoming"),
      color: "primary",
      Icon: PauseIcon,
    },
    upcoming: {
      label: translate("tournaments.statuses.upcoming"),
      color: "primary",
      Icon: PauseIcon,
    },
    ongoing: {
      label: translate("tournaments.statuses.ongoing"),
      color: "warning",
      Icon: PlayArrowIcon,
    },
  };
  const conf = map[status] || map.scheduled;
  const Icon = conf.Icon;
  return (
    <Chip
      size="small"
      label={conf.label}
      color={conf.color}
      icon={Icon ? <Icon sx={{ fontSize: 16 }} /> : undefined}
      sx={{ fontWeight: 600 }}
    />
  );
}

function ToggleChip({ active, label, onClick, tone }) {
  const color = toneToMuiColor(tone);
  const map = {
    upcoming: PauseIcon,
    scheduled: PauseIcon,
    ongoing: PlayArrowIcon,
    live: PlayArrowIcon,
    finished: EmojiEventsIcon,
  };
  const Icon = map[tone];

  return (
    <Chip
      label={label}
      onClick={onClick}
      variant={active ? "filled" : "outlined"}
      color={active ? color : "default"}
      size="small"
      icon={Icon ? <Icon sx={{ fontSize: 16 }} /> : undefined}
      sx={{ borderRadius: 999, fontWeight: 700 }}
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

function formatScoreFromMatch(m) {
  if (typeof m?.scoreText === "string" && m.scoreText.trim()) {
    return m.scoreText.trim();
  }
  const arr =
    (Array.isArray(m?.gameScores) && m.gameScores.length && m.gameScores) ||
    (Array.isArray(m?.sets) && m.sets) ||
    [];
  if (!arr.length) return "—";
  return arr
    .map((s) => `${s.a ?? s.home ?? 0}-${s.b ?? s.away ?? 0}`)
    .join("  |  ");
}
function ScoreBadge({ m }) {
  const text = formatScoreFromMatch(m);
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

/* ⬇️ UPDATED: TournamentListRow - Thêm tính năng mở rộng trận đấu */
function TournamentListRow({ t, onOpenMatch, translate, locale }) {
  const onOpen = useCallback((m) => onOpenMatch?.(m), [onOpenMatch]);
  const [expanded, setExpanded] = useState(false);

  const matches = Array.isArray(t.matches) ? t.matches : [];

  const summaryMatches = useMemo(() => {
    return matches
      .filter((m) => m.status === "live" || m.status === "scheduled")
      .slice(0, 2);
  }, [matches]);

  const remainingMatches = useMemo(() => {
    return matches
      .filter((m) => m.status === "live" || m.status === "scheduled")
      .slice(2);
  }, [matches]);

  const hasRemainingMatches = remainingMatches.length > 0;

  const statusColor = toneToMuiColor(t.status);
  const StatusIcon =
    t.status === "ongoing"
      ? AccessTimeIcon
      : t.status === "finished"
      ? EmojiEventsIcon
      : InfoIcon;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        p: 2,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      {/* Header Row */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", md: "center" }}
        useFlexGap
      >
        {/* Thông tin giải đấu */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="flex-start"
          sx={{ minWidth: 0, flex: 5, width: { xs: "100%", md: "auto" } }}
        >
          <StatusIcon color={statusColor} sx={{ mt: 0.5, flexShrink: 0 }} />
          <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <StatusChipWithIcon status={t.status} translate={translate} />
            </Stack>
            <Typography variant="h6" fontWeight={700} noWrap>
              {t.name || translate("myTournaments.tournamentFallback")}
            </Typography>
            <SmallMeta
              icon={PlaceIcon}
              text={t.location || translate("myTournaments.unknownLocation")}
            />
            <SmallMeta
              icon={CalendarMonthIcon}
              text={
                (t.startDate || t.startAt) && (t.endDate || t.endAt)
                  ? `${dateFmt(t.startDate || t.startAt, locale)} → ${dateFmt(
                      t.endDate || t.endAt,
                      locale
                    )}`
                  : "—"
              }
            />
          </Stack>
        </Stack>

        {/* Trận nổi bật */}
        <Box sx={{ flex: 7, minWidth: 0, width: { xs: "100%", md: "auto" } }}>
          {summaryMatches.length > 0 ? (
            <Stack spacing={1}>
              {summaryMatches.map((m) => {
                const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
                const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
                const status =
                  m.status || (m.winner ? "finished" : "scheduled");
                const accent =
                  status === "live"
                    ? "warning.main"
                    : status === "finished"
                    ? "success.main"
                    : "primary.main";

                return (
                  <Stack
                    key={m._id}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    onClick={() => onOpen(m)}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 1,
                      p: 0.75,
                      border: "1px solid",
                      borderColor: "divider",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 4,
                        height: 20,
                        borderRadius: 999,
                        bgcolor: accent,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      sx={{ minWidth: 0, flex: 1 }}
                      noWrap
                    >
                      {teamLabel(a, t.eventType)} vs {teamLabel(b, t.eventType)}
                    </Typography>
                    <SmallMeta
                      icon={ScheduleIcon}
                      text={roundText(m, translate)}
                    />
                    <SmallMeta
                      icon={AccessTimeIcon}
                      text={dateFmt(
                        m.scheduledAt || m.startTime || m.time,
                        locale
                      )}
                    />
                  </Stack>
                );
              })}
              {hasRemainingMatches && (
                <Button
                  onClick={() => setExpanded((v) => !v)}
                  size="small"
                  variant="outlined"
                  endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{
                    mt: 0.5,
                    alignSelf: "flex-start",
                  }}
                  >
                  {expanded
                    ? translate("myTournaments.collapseList")
                    : translate("myTournaments.viewAllMatches", {
                        count: remainingMatches.length + summaryMatches.length,
                      })}
                </Button>
              )}
            </Stack>
          ) : (
            <Typography
              color="text.secondary"
              fontStyle="italic"
              variant="body2"
              sx={{ mt: { xs: 1, md: 0 } }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <InfoIcon fontSize="small" />{" "}
                <span>{translate("myTournaments.noScheduledMatches")}</span>
              </Stack>
            </Typography>
          )}
        </Box>
      </Stack>

      {/* Danh sách trận còn lại (collapse) */}
      {hasRemainingMatches && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box
            sx={{
              pt: 2,
              borderTop: "1px solid",
              borderColor: "divider",
              mt: 2,
            }}
          >
            <Stack spacing={1.25}>
              {remainingMatches.map((m) => (
                <MatchRow
                  key={m._id}
                  m={m}
                  onOpen={onOpen}
                  eventType={t.eventType}
                />
              ))}
            </Stack>
          </Box>
        </Collapse>
      )}
    </Card>
  );
}

function MatchRow({ m, onOpen, eventType, translate, locale }) {
  const a = m.teamA || m.home || m.teams?.[0] || m.pairA;
  const b = m.teamB || m.away || m.teams?.[1] || m.pairB;
  const status = m.status || (m.winner ? "finished" : "scheduled");
  const court = m.courtName || m.court || "";
  const when = m.scheduledAt || m.startTime || m.time;

  const accent =
    status === "live"
      ? "warning.main"
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
              <StatusChipWithIcon status={status} translate={translate} />
            </Stack>
            <Typography noWrap fontWeight={600}>
              {teamLabel(b, eventType)}
            </Typography>
            <ScoreBadge m={m} />
            <Stack
              direction="row"
              flexWrap="wrap"
              spacing={1.5}
              useFlexGap
              sx={{ mt: 0.5 }}
            >
              <SmallMeta icon={AccessTimeIcon} text={dateFmt(when, locale)} />
              {!!court && (
                <SmallMeta
                  icon={SportsTennisIcon}
                  text={translate("myTournaments.court", { name: court })}
                />
              )}
              <SmallMeta
                icon={ScheduleIcon}
                text={roundText(m, translate)}
              />
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

function Banner({ t, collapsed, onToggle, translate }) {
  const statusText =
    t.status === "ongoing"
      ? translate("tournaments.statuses.ongoing")
      : t.status === "finished"
      ? translate("tournaments.statuses.finished")
      : translate("tournaments.statuses.upcoming");
  const statusColor =
    t.status === "ongoing"
      ? "warning"
      : t.status === "finished"
      ? "success"
      : "primary";
  const uri = t.image || t.cover || t.bannerUrl || null;
  const StatusIcon =
    t.status === "ongoing"
      ? PlayArrowIcon
      : t.status === "finished"
      ? EmojiEventsIcon
      : PauseIcon;

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
              {t.name || translate("myTournaments.tournamentFallback")}
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
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Chip
              label={statusText}
              color={statusColor}
              icon={<StatusIcon sx={{ fontSize: 16 }} />}
              sx={{
                fontWeight: 600,
                color: statusColor === "warning" ? "inherit" : "#fff",
              }}
            />
            <IconButton
              size="small"
              onClick={onToggle}
              sx={{
                color: "#fff",
                bgcolor: "rgba(255,255,255,0.12)",
                "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
              }}
              title={
                collapsed
                  ? translate("myTournaments.expandDetails")
                  : translate("myTournaments.collapse")
              }
            >
              {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}

function TournamentCard({ t, onOpenMatch, translate, locale }) {
  const [collapsed, setCollapsed] = useState(t.status === "finished");
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
      <Banner
        t={t}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        translate={translate}
      />

      <Collapse in={!collapsed} timeout="auto" unmountOnExit>
        <CardContent sx={{ p: { xs: 1.5, md: 2 }, pt: 1.5 }}>
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.5 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <AccessTimeIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              <Typography variant="body2" color="text.secondary" noWrap>
                {(t.startDate || t.startAt) && (t.endDate || t.endAt)
                  ? `${dateFmt(t.startDate || t.startAt, locale)}  →  ${dateFmt(
                      t.endDate || t.endAt,
                      locale
                    )}`
                  : "—"}
              </Typography>
            </Stack>
          </Stack>

          {/* SEARCH + FILTER TRẬN */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "center" }}
            sx={{ mb: 1.5 }}
          >
            <TextField
              value={matchQuery}
              onChange={(e) => setMatchQuery(e.target.value)}
              size="small"
              placeholder={translate("myTournaments.matchSearchPlaceholder")}
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
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 1.5 }}
          >
            <ToggleChip
              label={translate("tournaments.statuses.upcoming")}
              active={statusFilter.has("scheduled")}
              onClick={() => toggleStatus("scheduled")}
              tone="scheduled"
            />
            <ToggleChip
              label={translate("tournaments.statuses.ongoing")}
              active={statusFilter.has("live")}
              onClick={() => toggleStatus("live")}
              tone="live"
            />
            <ToggleChip
              label={translate("tournaments.statuses.finished")}
              active={statusFilter.has("finished")}
              onClick={() => toggleStatus("finished")}
              tone="finished"
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
                {translate("myTournaments.reset")}
              </Button>
            )}
          </Stack>

          {/* LIST MATCHES */}
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
                {translate("myTournaments.noFilteredMatches")}
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
                      ? translate("myTournaments.collapse")
                      : translate("myTournaments.viewAllMatches", {
                          count: filteredMatches.length,
                        })}
                  </Button>
                </Box>
              )}
            </Stack>
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
}

/* ======= Login Prompt (Giữ nguyên) ======= */
function LoginPrompt() {
  const navigate = useNavigate();
  const { t } = useLanguage();
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
            {t("myTournaments.loginTitle").replace(" Giải của tôi", "")}{" "}
            <Typography component="span" fontWeight={600}>
              {t("myTournaments.title")}
            </Typography>
          </Typography>
          <Typography color="text.secondary">
            {t("myTournaments.loginBody")}
          </Typography>
          <Button
            onClick={() => navigate("/login")}
            variant="contained"
            startIcon={<LoginIcon />}
            size="medium"
          >
            {t("common.actions.login")}
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}

/* ================= Page ================= */
const LS_VIEW_MODE_KEY = "myTournamentsViewMode";

export default function MyTournamentsPage() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up("md"));
  const { t: translate, locale } = useLanguage();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [matchId, setMatchId] = useState(null);

  const [viewMode, setViewMode] = useState("card");

  // Load viewMode
  useEffect(() => {
    const savedMode = localStorage.getItem(LS_VIEW_MODE_KEY);
    if (savedMode && (savedMode === "list" || savedMode === "card")) {
      setViewMode(savedMode);
    }
  }, []);

  // Save viewMode
  const handleViewModeChange = useCallback((event, nextMode) => {
    if (nextMode !== null) {
      setViewMode(nextMode);
      localStorage.setItem(LS_VIEW_MODE_KEY, nextMode);
    }
  }, []);

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

  const socket = useSocket();
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);
  const joinedMatchesRef = useRef(new Set());
  const subscribedBracketsRef = useRef(new Set());
  const allMatchesInitial = useMemo(() => {
    const arr = [];
    for (const t of tournamentsRaw) {
      if (Array.isArray(t.matches)) arr.push(...t.matches);
    }
    return arr;
  }, [tournamentsRaw]);
  const allMatchIdsKey = useMemo(
    () =>
      allMatchesInitial
        .map((m) => String(m?._id))
        .filter(Boolean)
        .sort()
        .join(","),
    [allMatchesInitial]
  );
  const allBracketIdsKey = useMemo(() => {
    const ids = [];
    for (const m of allMatchesInitial) {
      const bid =
        (m?.bracket && (m.bracket._id || m.bracket)) ||
        (m?.group && (m.group._id || m.group?.bracketId));
      if (bid) ids.push(String(bid));
    }
    return Array.from(new Set(ids)).sort().join(",");
  }, [allMatchesInitial]);
  const flushPending = useCallback(() => {
    if (!pendingRef.current.size) return;
    const mp = liveMapRef.current;
    for (const [mid, inc] of pendingRef.current) {
      const cur = mp.get(mid);
      mp.set(mid, { ...(cur || {}), ...inc });
    }
    pendingRef.current.clear();
    setLiveBump((x) => x + 1);
  }, []);
  const queueUpsert = useCallback(
    (incRaw) => {
      const inc = incRaw?.data ?? incRaw?.match ?? incRaw;
      if (!inc?._id) return;
      const normalizeEntity = (v) => {
        if (v == null) return v;
        if (typeof v === "string" || typeof v === "number") return v;
        if (typeof v === "object") {
          return {
            _id: v._id ?? (typeof v.id === "string" ? v.id : undefined),
            name:
              (typeof v.name === "string" && v.name) ||
              (typeof v.label === "string" && v.label) ||
              (typeof v.title === "string" && v.title) ||
              "",
          };
        }
        return v;
      };
      if (inc.court) inc.court = normalizeEntity(inc.court);
      if (inc.venue) inc.venue = normalizeEntity(inc.venue);
      if (inc.location) inc.location = normalizeEntity(inc.location);

      pendingRef.current.set(String(inc._id), inc);
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flushPending();
      });
    },
    [flushPending]
  );
  useEffect(() => {
    const mp = new Map();
    for (const m of allMatchesInitial) {
      if (m?._id) mp.set(String(m._id), m);
    }
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [allMatchesInitial]);
  const diffSet = (curSet, nextArr) => {
    const nextSet = new Set(nextArr);
    const added = [];
    const removed = [];
    nextSet.forEach((id) => {
      if (!curSet.has(id)) added.push(id);
    });
    curSet.forEach((id) => {
      if (!nextSet.has(id)) removed.push(id);
    });
    return { added, removed, nextSet };
  };

  const tournamentRoomIds = useMemo(
    () =>
      (tournamentsRaw || [])
        .map((t) => String(t?._id))
        .filter(Boolean),
    [tournamentsRaw]
  );

  useSocketRoomSet(socket, tournamentRoomIds, {
    subscribeEvent: "tournament:subscribe",
    unsubscribeEvent: "tournament:unsubscribe",
    payloadKey: "tournamentId",
  });

  useEffect(() => {
    if (!socket) return;
    const onUpsert = (payload) => queueUpsert(payload);
    const onRemove = (payload) => {
      const id = String(payload?.id ?? payload?._id ?? "");
      if (!id) return;
      if (liveMapRef.current.has(id)) {
        liveMapRef.current.delete(id);
        setLiveBump((x) => x + 1);
      }
    };

    socket.on("tournament:match:update", onUpsert);
    socket.on("match:deleted", onRemove);
    return () => {
      socket.off("tournament:match:update", onUpsert);
      socket.off("match:deleted", onRemove);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, queueUpsert]);
  useEffect(() => {
    subscribedBracketsRef.current = new Set();
    joinedMatchesRef.current = new Set();
  }, [allBracketIdsKey, allMatchIdsKey]);

  const tournamentsLive = useMemo(() => {
    const getLive = (m) => liveMapRef.current.get(String(m?._id)) || m;

    return tournamentsRaw.map((t) => {
      const base = { ...t };

      // ✅ Lấy trạng thái bảng từ backend
      const groupStatusMap = t.groupCompletionStatus || {};

      const allMatches = Array.isArray(t.matches) ? t.matches : [];

      // Lọc trận KO
      const filteredMatches = allMatches.filter((m) => {
        if (m.format !== "knockout") return true;

        // Kiểm tra seedA
        if (m.seedA?.type === "groupRank") {
          const stage = m.seedA.ref?.stage || m.stageIndex || 1;
          const rawCode = String(m.seedA.ref?.groupCode || "").trim();
          if (rawCode) {
            const groupCode = normalizeGroupCode(rawCode);
            const key = `${stage}_${groupCode}`;
            if (groupStatusMap[key] !== true) return false; // Bảng chưa xong → ẨN
          }
        }

        // Kiểm tra seedB
        if (m.seedB?.type === "groupRank") {
          const stage = m.seedB.ref?.stage || m.stageIndex || 1;
          const rawCode = String(m.seedB.ref?.groupCode || "").trim();
          if (rawCode) {
            const groupCode = normalizeGroupCode(rawCode);
            const key = `${stage}_${groupCode}`;
            if (groupStatusMap[key] !== true) return false; // Bảng chưa xong → ẨN
          }
        }

        return true; // Hiện trận
      });

      base.matches = filteredMatches.map(getLive);
      return base;
    });
  }, [tournamentsRaw, liveBump]);

  const [tourQuery, setTourQuery] = useState("");
  const [tourStatus] = useState(new Set(["upcoming", "ongoing", "finished"]));
  const tournaments = useMemo(() => {
    const q = stripVN(tourQuery);
    const filtered = tournamentsLive.filter((t) => {
      if (!tourStatus.has(t.status)) return false;
      if (!q) return true;
      const hay = [t.name, t.location].map(stripVN).join(" | ");
      return hay.includes(q);
    });

    const rank = { ongoing: 0, upcoming: 1, finished: 2 };
    const getStart = (t) =>
      new Date(t.startDate || t.startAt || 0).getTime() || 0;

    return filtered.slice().sort((a, b) => {
      const ra = rank[a.status] ?? 99;
      const rb = rank[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      return getStart(a) - getStart(b);
    });
  }, [tournamentsLive, tourQuery, tourStatus]);

  const handleOpenMatch = useCallback((m) => {
    setMatchId(m?._id);
    setViewerOpen(true);
  }, []);

  if (!isAuthed) return <LoginPrompt />;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <SEOHead title={translate("myTournaments.title")} noIndex={true} />
      {/* Sticky header */}
      <Box
        sx={{
          position: "sticky",
          // cao AppBar: xs ~56px, md+ ~64px
          top: { xs: 56, md: 64 },
          // thấp hơn Header một lớp, vẫn nằm trên content
          zIndex: (t) => t.zIndex.appBar - 1,
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
            <Typography variant="h5" fontWeight={600}>
              {translate("myTournaments.title")}
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", sm: "center" }}
              useFlexGap
            >
              <TextField
                value={tourQuery}
                onChange={(e) => setTourQuery(e.target.value)}
                size="small"
                placeholder={translate("myTournaments.searchPlaceholder")}
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

              {isMdUp && (
                <ToggleButtonGroup
                  value={viewMode}
                  exclusive
                  onChange={handleViewModeChange}
                  size="small"
                  sx={{ ml: { sm: "auto" } }}
                >
                  <ToggleButton
                    value="list"
                    aria-label="list view"
                    title={translate("myTournaments.listMode")}
                  >
                    <ViewListIcon />
                  </ToggleButton>
                  <ToggleButton
                    value="card"
                    aria-label="card view"
                    title={translate("myTournaments.cardMode")}
                  >
                    <GridViewIcon />
                  </ToggleButton>
                </ToggleButtonGroup>
              )}

              {!!tournaments?.length && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    ml: { sm: isMdUp ? 1 : "auto" },
                    alignSelf: { xs: "flex-start", sm: "center" },
                  }}
                >
                  {translate("myTournaments.matchingCount", {
                    count: tournaments.length,
                  })}
                </Typography>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* MAIN CONTENT */}
      <Container maxWidth="xl" sx={{ pt: 2, pb: 4 }}>
        {isLoading ? (
          <Stack spacing={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                variant="rounded"
                height={isMdUp && viewMode === "list" ? 100 : 220}
              />
            ))}
          </Stack>
        ) : isError ? (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography color="error">
              {translate("myTournaments.loadError")}
            </Typography>
            <Button onClick={refetch} sx={{ mt: 1 }} variant="outlined">
              {translate("common.actions.retry")}
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
              {translate("myTournaments.emptyTitle")}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {translate("myTournaments.emptyBody")}
            </Typography>
          </Box>
        ) : isMdUp && viewMode === "list" ? (
          /* Giao diện LIST cho Desktop */
          <Stack spacing={1.5}>
            {tournaments.map((t) => (
              <TournamentListRow
                key={t._id}
                t={t}
                onOpenMatch={handleOpenMatch}
                translate={translate}
                locale={locale}
              />
            ))}
          </Stack>
        ) : (
          /* Giao diện CARD (Mobile & Desktop/Card mode) */
          <Grid container spacing={2}>
            {tournaments.map((t) => (
              <Grid
                key={t._id}
                size={{ xs: 12, sm: 12, md: 6, lg: 4 }} // MUI v7 Grid v2 API
              >
                <TournamentCard
                  t={t}
                  onOpenMatch={handleOpenMatch}
                  translate={translate}
                  locale={locale}
                />
              </Grid>
            ))}
          </Grid>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Button
            onClick={refetch}
            disabled={isFetching}
            variant="outlined"
            size="small"
          >
            {isFetching
              ? translate("myTournaments.refreshing")
              : translate("myTournaments.refresh")}
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
