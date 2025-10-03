// src/pages/admin/parts/TournamentManagePage.jsx
/* eslint-disable react/prop-types */
import React, {
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Grid,
  Card,
  CardHeader,
  CardContent,
  Divider,
  Skeleton,
  CircularProgress,
  Menu,
  ListItemIcon,
  ListItemText,
  Avatar,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  LinkOff as LinkOffIcon,
  OpenInNew as OpenInNewIcon,
  Search as SearchIcon,
  Sort as SortIcon,
  Sports as SportsIcon,
  FileDownload as FileDownloadIcon,
  PictureAsPdf as PictureAsPdfIcon,
  Description as DescriptionIcon,
  Stadium as StadiumIcon,
  HowToReg as RefereeIcon,
  Movie as MovieIcon,
  PersonSearch as PersonSearchIcon,
  Add as AddIcon,
  RemoveCircleOutline as RemoveIcon,
  Print as PrintIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
  useAdminSetMatchLiveUrlMutation,
  useAdminSearchRefereesQuery,
} from "../../slices/tournamentsApiSlice";

import {
  useListTournamentRefereesQuery,
  useUpsertTournamentRefereesMutation,
} from "../../slices/refereeScopeApiSlice";

import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";
import VideoDialog from "../../components/VideoDialog";
import AssignCourtDialog from "../../components/AssignCourtDialog";
import AssignRefDialog from "../../components/AssignRefDialog";
import CourtManagerDialog from "../../components/CourtManagerDialog";
import ResponsiveModal from "../../components/ResponsiveModal";

/* ---------------- helpers ---------------- */
/* ----- helpers: tỉ số ----- */
const _num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const _normGame = (g) => {
  if (!g) return null;
  if (typeof g === "object" && !Array.isArray(g)) {
    const a =
      _num(g?.a) ??
      _num(g?.A) ??
      _num(g?.scoreA) ??
      _num(g?.left) ??
      (Array.isArray(g?.scores) ? _num(g.scores[0]) : null);
    const b =
      _num(g?.b) ??
      _num(g?.B) ??
      _num(g?.scoreB) ??
      _num(g?.right) ??
      (Array.isArray(g?.scores) ? _num(g.scores[1]) : null);
    if (a != null && b != null) return { a, b };
  }
  if (Array.isArray(g) && g.length >= 2) {
    const a = _num(g[0]);
    const b = _num(g[1]);
    if (a != null && b != null) return { a, b };
  }
  return null;
};

const scoreSummary = (m) => {
  if (!m?.pairA || !m?.pairB) {
    return String(m?.status || "").toLowerCase() === "finished" ? "BYE" : "—";
  }
  const raw =
    (Array.isArray(m?.gameScores) && m.gameScores) ||
    (Array.isArray(m?.scores) && m.scores) ||
    (Array.isArray(m?.sets) && m.sets) ||
    [];

  const games = raw.map(_normGame).filter(Boolean);
  let wa = 0,
    wb = 0;
  games.forEach((p) => {
    if (p.a > p.b) wa++;
    else if (p.b > p.a) wb++;
  });

  const aSets = _num(m?.scoreA) ?? _num(m?.setsWonA) ?? (games.length ? wa : 0);
  const bSets = _num(m?.scoreB) ?? _num(m?.setsWonB) ?? (games.length ? wb : 0);

  const main =
    aSets || bSets ? `${aSets}–${bSets}` : games.length ? `${wa}–${wb}` : "—";

  const detail = games.length
    ? `(${games.map((p) => `${p.a}–${p.b}`).join(", ")})`
    : "";

  return detail ? `${main} ${detail}` : main;
};

const TYPE_LABEL = (t) => {
  const key = String(t || "").toLowerCase();
  if (key === "group") return "Vòng bảng";
  if (key === "po" || key === "playoff") return "Playoff";
  if (key === "knockout" || key === "ko") return "Knockout";
  if (key === "double_elim" || key === "doubleelim") return "Double Elim";
  if (key === "swiss") return "Swiss";
  if (key === "gsl") return "GSL";
  return t || "Khác";
};

const WEB_LOGO_URL = "/icon.png";

const personNickname = (p) =>
  p?.nickname ||
  p?.nickName ||
  p?.nick ||
  p?.displayName ||
  p?.fullName ||
  p?.name ||
  "—";

const refereeNames = (m) => {
  const pickOne = (u) => personNickname(u);
  const r1 = m?.referee || m?.mainReferee || null;
  const list = m?.referees || m?.refs || m?.assignedReferees || null;
  if (Array.isArray(list) && list.length) return list.map(pickOne).join(", ");
  if (r1) return pickOne(r1);
  return "";
};

const buildRefReportHTML = ({
  tourName,
  code,
  court,
  referee,
  team1,
  team2,
  logoUrl,
}) => {
  const css = `
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;margin:16px}
    table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #000;padding:6px;font-size:12px}
    .no-border td,.no-border th{border:none}
    .title{font-size:22px;font-weight:700;text-align:left}
    .section-title{font-weight:700}
    .small{font-size:11px}
  `;
  const pointRow = () => `
    <tr>
      <td style="border:1px solid black"></td>
      ${Array.from(
        { length: 22 },
        (_, i) =>
          `<td style="border:1px solid black">${
            i < 10 ? `&nbsp;${i}&nbsp;` : i
          }</td>`
      ).join("")}
      <td style="border:1px solid black"></td>
      <td style="border:1px solid black"></td>
      <td style="border:1px solid black"></td>
    </tr>`;
  return `<!DOCTYPE html>
  <html><head><meta charset="utf-8" />
    <title>Biên bản trọng tài - ${code}</title>
    <style>${css}</style>
  </head>
  <body>
    <table class="no-border" style="width:100%">
      <tr class="no-border">
        <td class="no-border" style="width:80px"><img style="width:96px" src="${
          logoUrl || "/logo.png"
        }" alt="logo" /></td>
        <td class="no-border" colspan="3"><div class="title" id="printTourname">${
          tourName || ""
        }</div></td>
      </tr>
      <tr>
        <td rowspan="2">TRẬN ĐẤU:</td>
        <td rowspan="2"><div style="font-weight:700;font-size:22px" id="printMatchCode">${code}</div></td>
        <td style="width:100px">SÂN:</td>
        <td style="min-width:150px"><b id="printMatchCourt">${
          court || ""
        }</b></td>
      </tr>
      <tr>
        <td style="width:100px">TRỌNG TÀI:</td>
        <td style="min-width:150px"><b id="printMatchReferee">${
          referee || ""
        }</b></td>
      </tr>
    </table>
    <br/>
    <table>
      <tr><td>ĐỘI 1</td><td colspan="26"><b id="printTeam1">${
        team1 || ""
      }</b></td></tr>
      <tr><td>SERVER</td><td colspan="22">ĐIỂM</td><td colspan="2">TIMEOUT</td><td>TW/TF</td></tr>
      ${pointRow()}${pointRow()}${pointRow()}
    </table>
    <br/>
    <div style="height:90px;">
      <table class="no-border" style="width:100%">
        <tr class="no-border">
          <td class="no-border" style="text-align:center;width:300px"><b>Đội thắng</b></td>
          <td class="no-border" style="text-align:center;width:300px"><b>Trọng tài</b></td>
          <td class="no-border" style="text-align:center;width:300px"><b>Đội thua</b></td>
        </tr>
      </table>
    </div>
    <table>
      <tr><td>ĐỘI 2</td><td colspan="26"><b id="printTeam21">${
        team2 || ""
      }</b></td></tr>
      <tr><td>SERVER</td><td colspan="22">ĐIỂM</td><td colspan="2">TIMEOUT</td><td>TW/TF</td></tr>
      ${pointRow()}${pointRow()}${pointRow()}
    </table>
  </body></html>`;
};

const pairLabel = (pair) => {
  if (!pair) return "—";
  if (pair.name) return pair.name;
  const ps = [pair.player1, pair.player2].filter(Boolean).map(personNickname);
  return ps.join(" / ") || "—";
};

const isMongoId = (s) => typeof s === "string" && /^[a-f0-9]{24}$/i.test(s);

const courtLabel = (m) => {
  const c = m?.courtAssigned || m?.assignedCourt || m?.court || null;
  const directName =
    m?.courtName || m?.courtLabel || m?.courtCode || m?.courtTitle || null;
  if (directName && String(directName).trim()) return String(directName).trim();
  if (!c) return "—";
  if (typeof c === "string") {
    if (!c.trim() || isMongoId(c)) return "—";
    return c.trim();
  }
  if (c.name) return c.name;
  if (c.label) return c.label;
  if (c.code) return c.code;
  if (Number.isFinite(c.number)) return `Sân ${c.number}`;
  if (Number.isFinite(c.no)) return `Sân ${c.no}`;
  return "—";
};

const matchCode = (m) => {
  if (!m) return "—";
  if (m.code) return m.code;
  const r = Number.isFinite(m?.globalRound)
    ? m.globalRound
    : Number.isFinite(m?.round)
    ? m.round
    : "?";
  const t = Number.isFinite(m?.order) ? m.order + 1 : undefined;
  return `V${r}${t ? `-T${t}` : ""}`;
};

const statusChip = (st) => {
  const map = {
    scheduled: { color: "default", label: "Chưa xếp" },
    queued: { color: "info", label: "Trong hàng chờ" },
    assigned: { color: "secondary", label: "Đã gán sân" },
    live: { color: "warning", label: "Đang thi đấu" },
    finished: { color: "success", label: "Đã kết thúc" },
  };
  const v = map[String(st || "").toLowerCase()] || {
    color: "default",
    label: st || "—",
  };
  return <Chip size="small" color={v.color} label={v.label} />;
};

const statusText = (st) => {
  const map = {
    scheduled: "Chưa xếp",
    queued: "Trong hàng chờ",
    assigned: "Đã gán sân",
    live: "Đang thi đấu",
    finished: "Đã kết thúc",
  };
  return map[String(st || "").toLowerCase()] || st || "—";
};

const statusPriority = (st) => {
  switch (String(st || "").toLowerCase()) {
    case "live":
      return 0;
    case "queued":
      return 1;
    case "assigned":
      return 2;
    case "scheduled":
      return 3;
    case "finished":
      return 4;
    default:
      return 5;
  }
};

/* ========= Live store: subscribe theo matchId để tránh re-render cả list ========= */
function createLiveStore() {
  const map = new Map(); // matchId -> partial snapshot
  const listeners = new Map(); // matchId -> Set<fn>

  return {
    get(id) {
      return map.get(String(id)) || null;
    },
    set(id, partial) {
      const key = String(id);
      const prev = map.get(key) || {};
      const next = { ...prev, ...partial };
      map.set(key, next);
      const subs = listeners.get(key);
      if (subs) subs.forEach((fn) => fn());
      return prev.status !== next.status; // báo xem có đổi status không (để re-sort)
    },
    subscribe(id, cb) {
      const key = String(id);
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
        if (!set.size) listeners.delete(key);
      };
    },
  };
}
function useLiveMatch(liveStore, matchId) {
  const subscribe = useCallback(
    (cb) => liveStore.subscribe(matchId, cb),
    [liveStore, matchId]
  );
  const getSnapshot = useCallback(
    () => liveStore.get(matchId),
    [liveStore, matchId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ============== Skeletons ============== */
function TableSkeletonRows({ rows = 8, cols = 8 }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
function MatchCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardHeader
        sx={{ py: 1.2 }}
        avatar={<Skeleton variant="circular" width={24} height={24} />}
        title={<Skeleton variant="text" width="60%" />}
        subheader={
          <Stack direction="row" spacing={0.5}>
            <Skeleton variant="rounded" width={60} height={22} />
            <Skeleton variant="rounded" width={48} height={22} />
          </Stack>
        }
        action={<Skeleton variant="circular" width={28} height={28} />}
      />
      <Divider />
      <CardContent sx={{ py: 1.25 }}>
        <Stack spacing={0.5}>
          <Skeleton variant="text" width="90%" />
          <Skeleton variant="text" width="85%" />
          <Skeleton variant="rounded" width={120} height={24} />
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ===== NEW: pick field realtime cần thiết ===== */
const pickRealtimeFields = (src = {}) => {
  const keys = [
    "status",
    "scoreA",
    "scoreB",
    "setsWonA",
    "setsWonB",
    "scores",
    "gameScores",
    "sets",
    "courtAssigned",
    "assignedCourt",
  ];
  const out = {};
  keys.forEach((k) => {
    if (k in src) out[k] = src[k];
  });
  return out;
};

/* ---------------- Row & Card (memo) ---------------- */
const ActionChips = React.memo(function ActionChips({
  match,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
}) {
  const st = String(match?.status || "").toLowerCase();
  const canAssignCourt = !(st === "live" || st === "finished");
  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      sx={{ display: "flex", flexWrap: "wrap", columnGap: 1, rowGap: 1 }}
    >
      <Chip
        size="small"
        color="primary"
        variant="filled"
        icon={<PrintIcon />}
        label="Biên bản TT"
        onClick={() => onExportRefNote?.(match)}
      />
      <Chip
        size="small"
        color="info"
        variant={match?.video ? "filled" : "outlined"}
        icon={<MovieIcon />}
        label={match?.video ? "Sửa video" : "Gắn video"}
        onClick={() => onOpenVideo(match)}
      />
      {match?.video && (
        <Chip
          size="small"
          color="error"
          variant="outlined"
          icon={<LinkOffIcon />}
          label="Xoá video"
          onClick={() => onDeleteVideo(match)}
        />
      )}
      {canAssignCourt && (
        <Chip
          size="small"
          color="secondary"
          variant="outlined"
          icon={<StadiumIcon />}
          label="Gán sân"
          onClick={() => onAssignCourt(match)}
        />
      )}
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        icon={<RefereeIcon />}
        label="Gán trọng tài"
        onClick={() => onAssignRef(match)}
      />
    </Box>
  );
});

const MatchRow = React.memo(function MatchRow({
  match,
  liveStore,
  onRowClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
}) {
  const live = useLiveMatch(liveStore, match._id);
  const merged = live ? { ...match, ...live } : match;

  return (
    <TableRow
      hover
      onClick={() => onRowClick(match._id)}
      sx={{ cursor: "pointer" }}
    >
      <TableCell sx={{ whiteSpace: "nowrap" }}>{matchCode(merged)}</TableCell>
      <TableCell>{pairLabel(merged?.pairA)}</TableCell>
      <TableCell>{pairLabel(merged?.pairB)}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{courtLabel(merged)}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {Number.isFinite(merged?.order) ? `T${merged.order + 1}` : "—"}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {scoreSummary(merged)}
      </TableCell>
      <TableCell>{statusChip(merged?.status)}</TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        {merged?.video ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
          >
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label="Đã gắn"
              icon={<MovieIcon />}
            />
            <Tooltip title={merged.video} arrow>
              <IconButton
                size="small"
                component="a"
                href={merged.video}
                target="_blank"
                rel="noopener"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <Chip size="small" variant="outlined" label="Chưa có" />
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        <ActionChips
          match={merged}
          onOpenVideo={onOpenVideo}
          onDeleteVideo={onDeleteVideo}
          onAssignCourt={onAssignCourt}
          onAssignRef={onAssignRef}
          onExportRefNote={onExportRefNote}
        />
      </TableCell>
    </TableRow>
  );
});

const MatchCard = React.memo(function MatchCard({
  match,
  liveStore,
  onCardClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
}) {
  const live = useLiveMatch(liveStore, match._id);
  const merged = live ? { ...match, ...live } : match;
  const code = matchCode(merged);

  return (
    <Card
      variant="outlined"
      sx={{ height: "100%", cursor: "pointer", "&:hover": { boxShadow: 2 } }}
      onClick={() => onCardClick(match._id)}
    >
      <CardHeader
        sx={{ py: 1.2 }}
        avatar={<SportsIcon fontSize="small" />}
        titleTypographyProps={{ variant: "subtitle2", noWrap: true }}
        title={
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            flexWrap="wrap"
          >
            <Typography variant="subtitle2" noWrap>
              {code}
            </Typography>
            {statusChip(merged?.status)}
          </Stack>
        }
        subheader={
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Chip size="small" label={`Sân: ${courtLabel(merged)}`} />
            {Number.isFinite(merged?.order) && (
              <Chip
                size="small"
                variant="outlined"
                label={`T${merged.order + 1}`}
              />
            )}
          </Stack>
        }
      />
      <Divider />
      <CardContent sx={{ py: 1.25 }}>
        <Stack spacing={0.75}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Cặp A
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {pairLabel(merged?.pairA)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Cặp B
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {pairLabel(merged?.pairB)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Tỉ số
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {scoreSummary(merged)}
            </Typography>
          </Box>

          <Box onClick={(e) => e.stopPropagation()}>
            {merged?.video ? (
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                flexWrap="wrap"
              >
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label="Có video"
                  icon={<MovieIcon />}
                />
                <Tooltip title={merged.video} arrow>
                  <IconButton
                    size="small"
                    component="a"
                    href={merged.video}
                    target="_blank"
                    rel="noopener"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ) : (
              <Chip size="small" variant="outlined" label="Chưa có video" />
            )}
          </Box>

          <ActionChips
            match={merged}
            onOpenVideo={onOpenVideo}
            onDeleteVideo={onDeleteVideo}
            onAssignCourt={onAssignCourt}
            onAssignRef={onAssignRef}
            onExportRefNote={onExportRefNote}
          />
        </Stack>
      </CardContent>
    </Card>
  );
});

/* ===== Dialog quản lý trọng tài theo GIẢI (UI giữ nguyên) ===== */
function ManageRefereesDialog({ open, tournamentId, onClose, onChanged }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: assigned = [],
    isLoading: loadingAssigned,
    refetch: refetchAssigned,
  } = useListTournamentRefereesQuery(
    { tid: tournamentId, q: "" },
    { skip: !open || !tournamentId }
  );

  const { data: candidates = [], isLoading: loadingSearch } =
    useAdminSearchRefereesQuery(
      { tid: tournamentId, q: debouncedQ },
      { skip: !open || !tournamentId }
    );

  const [upsert, { isLoading: saving }] = useUpsertTournamentRefereesMutation();

  const handleAdd = async (userId) => {
    try {
      await upsert({ tid: tournamentId, add: [userId] }).unwrap();
      toast.success("Đã thêm trọng tài vào giải");
      refetchAssigned?.();
      onChanged?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Thêm trọng tài thất bại");
    }
  };

  const handleRemove = async (userId) => {
    try {
      await upsert({ tid: tournamentId, remove: [userId] }).unwrap();
      toast.success("Đã bỏ trọng tài khỏi giải");
      refetchAssigned?.();
      onChanged?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Bỏ trọng tài thất bại");
    }
  };

  const isAssigned = (id) =>
    (assigned || []).some((u) => String(u._id) === String(id));

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      icon={<RefereeIcon fontSize="small" />}
      title={
        <Stack direction="row" alignItems="center" spacing={1}>
          <span>Quản lý trọng tài của giải</span>
        </Stack>
      }
      actions={<Button onClick={onClose}>Đóng</Button>}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={5} sx={{ width: isMobile ? "100%" : "auto" }}>
          <Card variant="outlined">
            <CardHeader title="Đang là trọng tài" />
            <Divider />
            <CardContent sx={{ pt: 1 }}>
              {loadingAssigned ? (
                <Box textAlign="center" py={2}>
                  <CircularProgress size={22} />
                </Box>
              ) : (assigned?.length || 0) === 0 ? (
                <Alert severity="info">Chưa có trọng tài nào.</Alert>
              ) : (
                <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                  {assigned.map((u) => (
                    <Stack
                      key={u._id}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{
                        py: 0.75,
                        px: 1.25,
                        borderRadius: 1,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Avatar sx={{ width: 28, height: 28 }}>
                          {(personNickname(u)[0] || "U").toUpperCase()}
                        </Avatar>
                        <Typography variant="body2">
                          {personNickname(u)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {u?.email || u?.phone || ""}
                        </Typography>
                      </Stack>
                      <Tooltip title="Bỏ khỏi giải" arrow>
                        <span>
                          <IconButton
                            edge="end"
                            onClick={() => handleRemove(u._id)}
                            disabled={saving}
                            size="small"
                          >
                            <RemoveIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7} sx={{ width: isMobile ? "100%" : "auto" }}>
          <Card variant="outlined">
            <CardHeader title="Tìm người để thêm trọng tài" />
            <Divider />
            <CardContent>
              <TextField
                fullWidth
                placeholder="Nhập tên/nickname/email để tìm…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonSearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <Box mt={1.5}>
                {loadingSearch ? (
                  <Box textAlign="center" py={2}>
                    <CircularProgress size={22} />
                  </Box>
                ) : (candidates?.length || 0) === 0 ? (
                  <Alert severity="info">Không có kết quả phù hợp.</Alert>
                ) : (
                  <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                    {candidates.map((u) => {
                      const already = isAssigned(u._id);
                      return (
                        <Stack
                          key={u._id}
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{
                            py: 0.75,
                            px: 1.25,
                            borderRadius: 1,
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1.25}
                            alignItems="center"
                          >
                            <Avatar sx={{ width: 28, height: 28 }}>
                              {(personNickname(u)[0] || "U").toUpperCase()}
                            </Avatar>
                            <Typography variant="body2">
                              {personNickname(u)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {u?.email || u?.phone || ""}
                            </Typography>
                          </Stack>
                          <Tooltip
                            title={already ? "Đã trong giải" : "Thêm vào giải"}
                            arrow
                          >
                            <span>
                              <IconButton
                                edge="end"
                                onClick={() => handleAdd(u._id)}
                                disabled={saving || already}
                                size="small"
                              >
                                <AddIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </ResponsiveModal>
  );
}

/* ---------------- Component chính ---------------- */
export default function TournamentManagePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);

  // Queries
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: brackets = [],
    isLoading: brLoading,
    error: brErr,
    refetch: refetchBrackets,
  } = useAdminGetBracketsQuery(id);
  const {
    data: matchPage,
    isLoading: mLoading,
    error: mErr,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery({
    tid: id,
    page: 1,
    pageSize: 1000,
  });

  const [setLiveUrl, { isLoading: savingVideo }] =
    useAdminSetMatchLiveUrlMutation();

  // Quyền
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManager = useMemo(() => {
    if (!me?._id || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers))
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    return !!tour?.isManager;
  }, [tour, me]);
  const canManage = isAdmin || isManager;

  // Tabs
  const typeOrderWeight = (t) => {
    const k = String(t || "").toLowerCase();
    if (k === "group") return 1;
    if (k === "po" || k === "playoff") return 2;
    if (k === "knockout" || k === "ko") return 3;
    return 9;
  };
  const typesAvailable = useMemo(() => {
    const uniq = new Map();
    (brackets || []).forEach((b) => {
      const t = (b?.type || "").toString().toLowerCase();
      if (!t) return;
      if (!uniq.has(t))
        uniq.set(t, {
          type: t,
          label: TYPE_LABEL(t),
          weight: typeOrderWeight(t),
        });
    });
    if (uniq.size === 0)
      uniq.set("group", { type: "group", label: "Vòng bảng", weight: 1 });
    return Array.from(uniq.values()).sort((a, b) => a.weight - b.weight);
  }, [brackets]);

  const [tab, setTab] = useState(typesAvailable[0]?.type || "group");
  useEffect(() => {
    if (!typesAvailable.find((t) => t.type === tab)) {
      setTab(typesAvailable[0]?.type || "group");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesAvailable]);

  const bracketsOfTab = useMemo(() => {
    const list = (brackets || []).filter(
      (b) => String(b?.type || "").toLowerCase() === String(tab).toLowerCase()
    );
    return list.sort((a, b) => {
      if ((a?.stage ?? 0) !== (b?.stage ?? 0))
        return (a?.stage ?? 0) - (b?.stage ?? 0);
      if ((a?.order ?? 0) !== (b?.order ?? 0))
        return (a?.order ?? 0) - (b?.order ?? 0);
      return new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0);
    });
  }, [brackets, tab]);

  // Lọc/sort
  const [q, setQ] = useState("");
  const qDeferred = useDeferredValue(q);
  const [sortKey, setSortKey] = useState("round"); // round | order | time
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  // Viewer
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = useCallback((mid) => {
    setViewer({ open: true, matchId: mid });
  }, []);
  const closeMatch = useCallback(
    () => setViewer({ open: false, matchId: null }),
    []
  );

  // Dialog gán video
  const [videoDlg, setVideoDlg] = useState({ open: false, match: null });
  const openVideoDlg = useCallback(
    (m) => setVideoDlg({ open: true, match: m }),
    []
  );
  const deleteVideoDlg = useCallback(
    (m) => setVideoDlg({ open: true, match: { ...m, video: "" } }),
    []
  );
  const closeVideoDlg = useCallback(
    () => setVideoDlg({ open: false, match: null }),
    []
  );
  const onSaveVideo = useCallback(
    async (url) => {
      try {
        await setLiveUrl({
          matchId: videoDlg.match._id,
          video: url || "",
        }).unwrap();
        toast.success(url ? "Đã gán link video" : "Đã xoá link video");
        closeVideoDlg();
      } catch (e) {
        toast.error(
          e?.data?.message || e?.error || "Không lưu được link video"
        );
      }
    },
    [setLiveUrl, videoDlg.match, closeVideoDlg]
  );

  const [manageCourts, setManageCourts] = useState({
    open: false,
    bracketId: null,
    bracketName: "",
  });

  const [refMgrOpen, setRefMgrOpen] = useState(false);
  const openManageCourts = useCallback((bid, bname) => {
    setManageCourts({
      open: true,
      bracketId: String(bid),
      bracketName: bname || "",
    });
  }, []);
  const closeManageCourts = useCallback(
    () => setManageCourts((s) => ({ ...s, open: false })),
    []
  );

  const [courtDlg, setCourtDlg] = useState({ open: false, match: null });
  const [refDlg, setRefDlg] = useState({ open: false, match: null });
  const openAssignCourt = useCallback(
    (m) => setCourtDlg({ open: true, match: m }),
    []
  );
  const closeAssignCourt = useCallback(
    () => setCourtDlg({ open: false, match: null }),
    []
  );
  const openAssignRef = useCallback(
    (m) => setRefDlg({ open: true, match: m }),
    []
  );
  const closeAssignRef = useCallback(
    () => setRefDlg({ open: false, match: null }),
    []
  );

  /* ====== Live store + re-sort khi status đổi ====== */
  const liveStore = useMemo(() => createLiveStore(), []);
  const [orderVersion, setOrderVersion] = useState(0);
  const [isPending, startTransition] = useTransition();

  const allMatchesBase = matchPage?.list || [];

  /* ======= Filter + Sort theo bracket ======= */
  const getLiveStatus = useCallback(
    (m) => liveStore.get(String(m?._id))?.status ?? m?.status,
    [liveStore]
  );

  const groupedLists = useMemo(() => {
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/[-\s]/g, "");

    const kw = norm(qDeferred);
    const byBracket = new Map();

    const push = (bid, m) => {
      if (!byBracket.has(bid)) byBracket.set(bid, []);
      byBracket.get(bid).push(m);
    };

    for (const m of allMatchesBase) {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      if (!bid) continue;

      if (kw) {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        const text = norm(
          [
            matchCode(merged),
            pairLabel(merged?.pairA),
            pairLabel(merged?.pairB),
            courtLabel(merged),
            merged?.status,
            merged?.video,
            scoreSummary(merged), // chỉ tính khi search để nhẹ UI
          ].join(" ")
        );
        if (!text.includes(kw)) continue;
      }

      push(bid, m);
    }

    const sorter = (a, b) => {
      // 1) Ưu tiên LIVE (status realtime)
      const pa = statusPriority(getLiveStatus(a));
      const pb = statusPriority(getLiveStatus(b));
      if (pa !== pb) return pa - pb;

      // 2) Theo tiêu chí người dùng
      const dir = sortDir === "asc" ? 1 : -1;

      if (sortKey === "order") {
        const ao = Number.isFinite(a?.order) ? a.order : 0;
        const bo = Number.isFinite(b?.order) ? b.order : 0;
        return (ao - bo) * dir;
      }

      if (sortKey === "time") {
        const ta = new Date(a?.scheduledAt || a?.createdAt || 0).getTime();
        const tb = new Date(b?.scheduledAt || b?.createdAt || 0).getTime();
        return (ta - tb) * dir;
      }

      // round
      const ar = Number.isFinite(a?.globalRound)
        ? a.globalRound
        : a?.round ?? 0;
      const brd = Number.isFinite(b?.globalRound)
        ? b.globalRound
        : b?.round ?? 0;
      if (ar !== brd) return (ar - brd) * dir;
      const ao = Number.isFinite(a?.order) ? a.order : 0;
      const bo = Number.isFinite(b?.order) ? b.order : 0;
      return (ao - bo) * dir;
    };

    for (const [bid, arr] of byBracket) arr.sort(sorter);
    return byBracket;
  }, [
    allMatchesBase,
    qDeferred,
    sortKey,
    sortDir,
    getLiveStatus,
    orderVersion,
    liveStore,
  ]);

  /* ======= Socket realtime ======= */
  const socket = useSocket();
  const joinedRef = useRef(new Set());
  const matchRefetchTimer = useRef(null);
  const bracketRefetchTimer = useRef(null);

  const scheduleMatchesRefetch = useCallback(() => {
    if (matchRefetchTimer.current) return;
    matchRefetchTimer.current = setTimeout(() => {
      refetchMatches?.();
      matchRefetchTimer.current = null;
    }, 600);
  }, [refetchMatches]);

  const scheduleBracketsRefetch = useCallback(() => {
    if (bracketRefetchTimer.current) return;
    bracketRefetchTimer.current = setTimeout(() => {
      refetchBrackets?.();
      bracketRefetchTimer.current = null;
    }, 800);
  }, [refetchBrackets]);

  const applySnapshot = useCallback(
    (payload) => {
      if (!payload) return;
      const mid =
        String(payload?.matchId || payload?.id || payload?._id || "") ||
        String(
          payload?.match?._id || payload?.match?.id || payload?.matchId || ""
        );
      if (!mid) return;

      const data = payload?.snapshot || payload?.match || payload;
      const partial = pickRealtimeFields(data);
      if (Object.keys(partial).length === 0) return;

      const statusChanged = liveStore.set(mid, partial);
      if (statusChanged) {
        startTransition(() => setOrderVersion((v) => v + 1));
      }
    },
    [liveStore, startTransition]
  );

  useEffect(() => {
    if (!socket) return;

    const bracketIds = (brackets || [])
      .map((b) => String(b._id))
      .filter(Boolean);
    const matchIds = (allMatchesBase || [])
      .map((m) => String(m._id))
      .filter(Boolean);

    const subscribeRooms = () => {
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:subscribe", { bracketId: bid })
        );
        matchIds.forEach((mid) => {
          if (!joinedRef.current.has(mid)) {
            socket.emit("match:join", { matchId: mid });
            socket.emit("match:snapshot:request", { matchId: mid });
            joinedRef.current.add(mid);
          }
        });
      } catch {}
    };

    const onConnected = () => subscribeRooms();
    const onMatchSnapshot = (p) => applySnapshot(p);
    const onScoreUpdated = (p) => applySnapshot(p);
    const onMatchUpdated = (p) => {
      applySnapshot(p);
      scheduleMatchesRefetch();
    };
    const onMatchDeleted = () => scheduleMatchesRefetch();
    const onRefilled = () => {
      scheduleBracketsRefetch();
      scheduleMatchesRefetch();
    };

    socket.on("connect", onConnected);
    socket.on("match:snapshot", onMatchSnapshot);
    socket.on("score:updated", onScoreUpdated);
    socket.on("match:updated", onMatchUpdated);
    socket.on("match:deleted", onMatchDeleted);
    socket.on("draw:refilled", onRefilled);
    socket.on("bracket:updated", onRefilled);

    subscribeRooms();

    return () => {
      socket.off("connect", onConnected);
      socket.off("match:snapshot", onMatchSnapshot);
      socket.off("score:updated", onScoreUpdated);
      socket.off("match:updated", onMatchUpdated);
      socket.off("match:deleted", onMatchDeleted);
      socket.off("draw:refilled", onRefilled);
      socket.off("bracket:updated", onRefilled);
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:unsubscribe", { bracketId: bid })
        );
      } catch {}
      if (matchRefetchTimer.current) clearTimeout(matchRefetchTimer.current);
      if (bracketRefetchTimer.current)
        clearTimeout(bracketRefetchTimer.current);
    };
  }, [
    socket,
    brackets,
    allMatchesBase,
    applySnapshot,
    scheduleMatchesRefetch,
    scheduleBracketsRefetch,
  ]);

  /* ---------- Export ---------- */
  const [exportAnchor, setExportAnchor] = useState(null);
  const [exporting, setExporting] = useState(false);
  const openExportMenu = (e) => setExportAnchor(e.currentTarget);
  const closeExportMenu = () => setExportAnchor(null);

  const buildRowsForBracket = useCallback(
    (matches) =>
      matches.map((m) => {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        return [
          matchCode(merged),
          pairLabel(merged?.pairA),
          pairLabel(merged?.pairB),
          courtLabel(merged),
          Number.isFinite(merged?.order) ? `T${merged.order + 1}` : "—",
          scoreSummary(merged),
        ];
      }),
    [liveStore]
  );

  const buildExportPayload = useCallback(() => {
    const payload = [];
    for (const b of bracketsOfTab) {
      const bid = String(b?._id);
      const list = groupedLists.get(bid) || [];
      payload.push({ bracket: b, rows: buildRowsForBracket(list) });
    }
    return payload;
  }, [bracketsOfTab, groupedLists, buildRowsForBracket]);

  const handleExportPDF = async () => {
    try {
      setExporting(true);
      const { default: pdfMake } = await import("pdfmake/build/pdfmake");
      const { vfs } = await import("pdfmake/build/vfs_fonts");
      pdfMake.vfs = vfs;

      const data = buildExportPayload();
      const title = `Quản lý giải: ${tour?.name || ""}`;
      const sub = `Loại: ${TYPE_LABEL(
        tab
      )} • Xuất lúc: ${new Date().toLocaleString()}`;

      const content = [
        { text: title, style: "title" },
        { text: sub, margin: [0, 2, 0, 10], style: "sub" },
      ];

      data.forEach((sec, idx) => {
        content.push({
          text: `${sec.bracket?.name || "Bracket"} — ${TYPE_LABEL(
            sec.bracket?.type
          )}`,
          style: "h2",
          margin: [0, idx === 0 ? 0 : 8, 0, 6],
        });

        const tableBody = [
          ["Mã", "Cặp A", "Cặp B", "Sân", "Thứ tự", "Tỉ số"],
          ...sec.rows.map((r) =>
            r.map((cell) => (cell == null ? "" : String(cell)))
          ),
        ];

        content.push({
          table: {
            headerRows: 1,
            widths: [50, 140, 140, 80, 55, 65],
            body: tableBody,
          },
          layout: "lightHorizontalLines",
          fontSize: 9,
        });
      });

      const docDefinition = {
        pageSize: "A4",
        pageMargins: [30, 30, 30, 40],
        defaultStyle: { font: "Roboto", fontSize: 10 },
        styles: {
          title: { fontSize: 16, bold: true },
          sub: { fontSize: 9, color: "#666" },
          h2: { fontSize: 12, bold: true },
        },
        footer: (currentPage, pageCount) => ({
          text: `Trang ${currentPage}/${pageCount}`,
          alignment: "left",
          margin: [30, 0, 0, 20],
          fontSize: 9,
          color: "#666",
        }),
      };

      const fname = `tournament_${(tour?.name || "export")
        .replace(/[^\p{L}\p{N}]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase()}_${tab}_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.pdf`;

      pdfMake.createPdf({ ...docDefinition, content }).download(fname);
    } catch (e) {
      toast.error("Xuất PDF thất bại");
      console.error(e);
    } finally {
      setExporting(false);
      closeExportMenu();
    }
  };

  const handleExportWord = async () => {
    try {
      setExporting(true);
      const docx = await import("docx");
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        HeadingLevel,
        Table,
        TableRow,
        TableCell,
        WidthType,
      } = docx;

      const data = buildExportPayload();
      const sections = [];

      sections.push(
        new Paragraph({
          text: `Quản lý giải: ${tour?.name || ""}`,
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Loại: ${TYPE_LABEL(tab)}`, size: 18 }),
            new TextRun({
              text: ` • Xuất lúc: ${new Date().toLocaleString()}`,
              size: 18,
            }),
          ],
        }),
        new Paragraph({ text: "" })
      );

      data.forEach((sec) => {
        sections.push(
          new Paragraph({
            text: `${sec.bracket?.name || "Bracket"} — ${TYPE_LABEL(
              sec.bracket?.type
            )}`,
            heading: HeadingLevel.HEADING_2,
          })
        );
        const head = ["Mã", "Cặp A", "Cặp B", "Sân", "Thứ tự", "Tỉ số"].map(
          (t) => new TableCell({ children: [new Paragraph({ text: t })] })
        );
        const rows = [
          new TableRow({ children: head }),
          ...sec.rows.map(
            (r) =>
              new TableRow({
                children: r.map(
                  (cell) =>
                    new TableCell({
                      width: { size: 1, type: WidthType.AUTO },
                      children: [new Paragraph({ text: String(cell || "") })],
                    })
                ),
              })
          ),
        ];
        sections.push(
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          new Paragraph({ text: "" })
        );
      });

      const doc = new Document({
        sections: [{ properties: {}, children: sections }],
      });
      const blob = await Packer.toBlob(doc);

      const fname = `tournament_${(tour?.name || "export")
        .replace(/[^\p{L}\p{N}]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase()}_${tab}_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}.docx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Xuất Word thất bại");
      console.error(e);
    } finally {
      setExporting(false);
      closeExportMenu();
    }
  };

  const handleExportRefNote = useCallback(
    (m) => {
      try {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        const html = buildRefReportHTML({
          tourName: tour?.name || "",
          code: matchCode(merged),
          court: courtLabel(merged),
          referee: refereeNames(merged),
          team1: pairLabel(merged?.pairA),
          team2: pairLabel(merged?.pairB),
          logoUrl: WEB_LOGO_URL,
        });
        const w = window.open("", "_blank");
        if (!w) {
          toast.error(
            "Trình duyệt chặn popup. Hãy cho phép cửa sổ bật lên để in."
          );
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();

        const tryPrint = () => {
          try {
            if (w.document && w.document.readyState === "complete") {
              w.focus?.();
              w.print?.();
            } else {
              setTimeout(tryPrint, 100);
            }
          } catch {}
        };
        tryPrint();
      } catch (e) {
        console.error(e);
        toast.error("Không mở được biên bản trọng tài");
      }
    },
    [tour, liveStore]
  );

  /* ---------- guards ---------- */
  if (tourLoading || brLoading) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (tourErr || brErr || mErr) {
    return (
      <Box p={3}>
        <Alert severity="error">
          {tourErr?.data?.message ||
            brErr?.data?.message ||
            mErr?.data?.message ||
            "Lỗi tải dữ liệu"}
        </Alert>
      </Box>
    );
  }
  if (!canManage) {
    return (
      <Box p={3}>
        <Alert severity="warning">Bạn không có quyền truy cập trang này.</Alert>
        <Button component={Link} to={`/tournament/${id}`} sx={{ mt: 2 }}>
          Quay lại trang giải
        </Button>
      </Box>
    );
  }

  /* ---------- UI ---------- */
  return (
    <Box p={{ xs: 2, md: 3 }}>
      {/* Header */}
      <Stack
        direction={isMobile ? "column" : "row"}
        alignItems="center"
        justifyContent="space-between"
        mb={2}
      >
        <Typography variant="h5" noWrap mb={isMobile ? 2 : 0}>
          Quản lý giải: {tour?.name}
        </Typography>
        <Stack direction={"row"} spacing={1}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefereeIcon />}
            onClick={() => setRefMgrOpen(true)}
          >
            Quản lý trọng tài
          </Button>

          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownloadIcon />}
            onClick={openExportMenu}
            disabled={exporting || bracketsOfTab.length === 0}
          >
            Xuất file
          </Button>
          <Menu
            anchorEl={exportAnchor}
            open={Boolean(exportAnchor)}
            onClose={closeExportMenu}
            keepMounted
          >
            <MenuItem
              onClick={handleExportPDF}
              disabled={exporting || bracketsOfTab.length === 0}
            >
              <ListItemIcon>
                <PictureAsPdfIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={exporting ? "Đang xuất PDF…" : "Xuất PDF"}
              />
            </MenuItem>
            <MenuItem
              onClick={handleExportWord}
              disabled={exporting || bracketsOfTab.length === 0}
            >
              <ListItemIcon>
                <DescriptionIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={exporting ? "Đang xuất Word…" : "Xuất Word (.docx)"}
              />
            </MenuItem>
          </Menu>

          <Button
            component={Link}
            to={`/tournament/${id}`}
            variant="outlined"
            size="small"
          >
            Trang giải
          </Button>
          {isAdmin && (
            <Button
              component={Link}
              to={`/tournament/${id}/draw`}
              variant="contained"
              size="small"
            >
              Bốc thăm
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        {/* Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {typesAvailable.map((t) => (
            <Tab key={t.type} label={TYPE_LABEL(t.type)} value={t.type} />
          ))}
        </Tabs>

        {/* Filter bar */}
        <Box p={2} display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            placeholder="Tìm trận, cặp đấu, sân, link…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240 }}
          />
          <TextField
            select
            size="small"
            label="Sắp xếp"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SortIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="round">Vòng (global → order)</MenuItem>
            <MenuItem value="order">Thứ tự (order)</MenuItem>
            <MenuItem value="time">Thời gian</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Chiều"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="asc">Tăng dần</MenuItem>
            <MenuItem value="desc">Giảm dần</MenuItem>
          </TextField>
          <Chip
            size="small"
            variant="outlined"
            label={`${bracketsOfTab.length} bracket • ${TYPE_LABEL(tab)}`}
            sx={{ ml: 1 }}
          />
        </Box>
      </Paper>

      {/* Bracket list */}
      {bracketsOfTab.length === 0 ? (
        <Alert severity="info">
          Chưa có bracket thuộc loại {TYPE_LABEL(tab)}.
        </Alert>
      ) : (
        bracketsOfTab.map((b) => {
          const bid = String(b?._id);
          const list = groupedLists.get(bid) || [];

          return (
            <Paper key={bid} variant="outlined" sx={{ mb: 2 }}>
              <Box p={2} pb={0}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  flexWrap="wrap"
                >
                  <Typography variant="h6" noWrap>
                    {b?.name || "Bracket"}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<StadiumIcon />}
                    onClick={() => openManageCourts(bid, b?.name)}
                  >
                    Quản lý sân
                  </Button>

                  <Chip
                    size="small"
                    variant="outlined"
                    label={TYPE_LABEL(b?.type)}
                  />
                  {typeof b?.stage === "number" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Stage ${b.stage}`}
                    />
                  )}
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`${list.length} trận`}
                  />
                </Stack>
              </Box>

              {/* Desktop */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>Mã</TableCell>
                        <TableCell sx={{ minWidth: 240 }}>Cặp A</TableCell>
                        <TableCell sx={{ minWidth: 240 }}>Cặp B</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>Sân</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Thứ tự
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Tỉ số
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Trạng thái
                        </TableCell>
                        <TableCell sx={{ minWidth: 200 }}>Link video</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Hành động
                        </TableCell>
                      </TableRow>
                    </TableHead>

                    {mLoading ? (
                      <TableSkeletonRows rows={8} cols={9} />
                    ) : (
                      <TableBody>
                        {list.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} align="center">
                              <Typography color="text.secondary">
                                Chưa có trận nào.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          list.map((m) => (
                            <MatchRow
                              key={m._id}
                              match={m}
                              liveStore={liveStore}
                              onRowClick={(id) => openMatch(id)}
                              onOpenVideo={openVideoDlg}
                              onDeleteVideo={deleteVideoDlg}
                              onAssignCourt={openAssignCourt}
                              onAssignRef={openAssignRef}
                              onExportRefNote={handleExportRefNote}
                            />
                          ))
                        )}
                      </TableBody>
                    )}
                  </Table>
                </TableContainer>
              </Box>

              {/* Mobile */}
              <Box sx={{ display: { xs: "block", md: "none" } }}>
                <Box p={2} pt={1}>
                  {mLoading ? (
                    <Grid container spacing={1.2}>
                      {Array.from({ length: 6 }).map((_, k) => (
                        <Grid key={k} item width={"100%"} xs={6}>
                          <MatchCardSkeleton />
                        </Grid>
                      ))}
                    </Grid>
                  ) : list.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={2}>
                      Chưa có trận nào.
                    </Typography>
                  ) : (
                    <Grid container spacing={1.2}>
                      {list.map((m) => (
                        <Grid key={m._id} item width={"100%"} xs={6}>
                          <MatchCard
                            match={m}
                            liveStore={liveStore}
                            onCardClick={(id) => openMatch(id)}
                            onOpenVideo={openVideoDlg}
                            onDeleteVideo={deleteVideoDlg}
                            onAssignCourt={openAssignCourt}
                            onAssignRef={openAssignRef}
                            onExportRefNote={handleExportRefNote}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  )}
                </Box>
              </Box>
            </Paper>
          );
        })
      )}

      {/* Dialog gán link video */}
      <VideoDialog
        open={videoDlg.open}
        match={videoDlg.match}
        initialUrl={videoDlg.match?.video || ""}
        onCancel={closeVideoDlg}
        onSave={onSaveVideo}
        saving={savingVideo}
        getMatchCode={matchCode}
      />

      <AssignCourtDialog
        open={courtDlg.open}
        match={courtDlg.match}
        tournamentId={id}
        onClose={closeAssignCourt}
        onAssigned={() => {
          refetchMatches?.();
        }}
      />

      {/* Dialog gán trọng tài theo TRẬN */}
      <AssignRefDialog
        open={refDlg.open}
        match={refDlg.match}
        tournamentId={id}
        onClose={closeAssignRef}
        onChanged={() => {
          refetchMatches?.();
        }}
      />

      {/* Popup quản lý sân */}
      <CourtManagerDialog
        open={manageCourts.open}
        onClose={closeManageCourts}
        tournamentId={id}
        bracketId={manageCourts.bracketId}
        bracketName={manageCourts.bracketName}
        tournamentName={tour?.name || ""}
      />

      <ManageRefereesDialog
        open={refMgrOpen}
        tournamentId={id}
        onClose={() => setRefMgrOpen(false)}
        onChanged={() => {
          // Nếu cần, có thể refetch danh sách trận/sơ đồ, thường không bắt buộc
          refetchMatches?.();
          refetchBrackets?.();
        }}
      />

      {/* Popup xem/tracking trận */}
      <ResponsiveMatchViewer
        open={viewer.open}
        matchId={viewer.matchId}
        onClose={closeMatch}
      />
    </Box>
  );
}
