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
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Autocomplete,
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
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slide,
  FormControlLabel,
} from "@mui/material";
import {
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
  Print as PrintIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
  useAdminSetMatchLiveUrlMutation,
  useAdminBatchSetMatchLiveUrlMutation,
} from "../../slices/tournamentsApiSlice";

import {
  useBatchAssignRefereeMutation,
  useListTournamentRefereesQuery,
} from "../../slices/refereeScopeApiSlice";

import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";
import VideoDialog from "../../components/VideoDialog";
import AssignCourtDialog from "../../components/AssignCourtDialog";
import AssignRefDialog from "../../components/AssignRefDialog";
import CourtManagerDialog from "../../components/CourtManagerDialog";
import ManageRefereesDialog from "../../components/RefereeManagerDialog";
import LiveSetupDialog from "../../components/LiveSetupDialog";
import BulkAssignRefDialog from "../../components/BulkAssignRefDialog";

/* ---------------- helpers ---------------- */
// ✅ Hàm chuẩn hóa: A→1, B→2, C→3, D→4, hoặc giữ nguyên số
const normalizeGroupCode = (code) => {
  const s = String(code || "")
    .trim()
    .toUpperCase();
  if (!s) return "";

  // Nếu đã là số → giữ nguyên
  if (/^\d+$/.test(s)) return s;

  // Chữ cái A-Z → số 1-26
  if (/^[A-Z]$/.test(s)) {
    return String(s.charCodeAt(0) - 64); // A=65 → 65-64=1
  }

  // Trường hợp khác giữ nguyên (Group1, Bảng A,...)
  return s;
};

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

const personNickname = (p) =>
  p?.nickname ||
  p?.nickName ||
  p?.nick ||
  p?.displayName ||
  p?.fullName ||
  p?.name ||
  "—";

const pairLabel = (pair) => {
  if (!pair) return "—";
  if (pair.name) return pair.name;
  const ps = [pair.player1, pair.player2].filter(Boolean).map(personNickname);
  return ps.join(" / ") || "—";
};

const TYPE_LABEL = (t) => {
  const key = String(t || "").toLowerCase();
  if (key === "group") return "Vòng bảng";
  if (key === "po" || key === "playoff" || key === "roundelim")
    return "Playoff";
  if (key === "knockout" || key === "ko") return "Knockout";
  if (key === "double_elim" || key === "doubleelim") return "Double Elim";
  if (key === "swiss") return "Swiss";
  if (key === "gsl") return "GSL";
  return t || "Khác";
};

const WEB_LOGO_URL = "/icon.png";

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

/** Trận BYE: có cờ isBye/bye hoặc thiếu 1 cặp đấu hợp lệ */
const isByeMatch = (m) => {
  if (m?.isBye || m?.bye) return true;
  const aOK = !!(
    m?.pairA &&
    (m.pairA.name || m.pairA.player1 || m.pairA.player2)
  );
  const bOK = !!(
    m?.pairB &&
    (m.pairB.name || m.pairB.player1 || m.pairB.player2)
  );
  return !(aOK && bOK);
};

const scoreSummary = (m) => {
  if (isByeMatch(m)) return "BYE";
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

/* ========= Live store ========= */
function createLiveStore() {
  const map = new Map();
  const listeners = new Map();
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
      return prev.status !== next.status;
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
    () => liveStore.subscribe(matchId, () => {}),
    [liveStore, matchId]
  );
  const getSnapshot = useCallback(
    () => liveStore.get(matchId),
    [liveStore, matchId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ============== Skeletons ============== */
const TableSkeletonRows = React.memo(function TableSkeletonRows({
  rows = 8,
  cols = 8,
}) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c} sx={{ py: 0.5 }}>
              <Skeleton variant="text" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
});
function MatchCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardHeader
        sx={{ py: 1 }}
        avatar={<Skeleton variant="circular" width={22} height={22} />}
        title={<Skeleton variant="text" width="60%" />}
        subheader={
          <Stack direction="row" spacing={0.5}>
            <Skeleton variant="rounded" width={56} height={20} />
            <Skeleton variant="rounded" width={44} height={20} />
          </Stack>
        }
        action={<Skeleton variant="circular" width={24} height={24} />}
      />
      <Divider />
      <CardContent sx={{ py: 1 }}>
        <Stack spacing={0.5}>
          <Skeleton variant="text" width="90%" />
          <Skeleton variant="text" width="85%" />
          <Skeleton variant="rounded" width={120} height={22} />
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ===== pick realtime fields ===== */
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
      sx={{ display: "flex", flexWrap: "wrap", columnGap: 0.75, rowGap: 0.75 }}
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

/* ======= NEW: Desktop two-line rows ======= */
const MatchDesktopRows = React.memo(function MatchDesktopRows({
  match,
  liveStore,
  onRowClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  checked = false,
  onToggleSelect,
}) {
  const live = useLiveMatch(liveStore, match._id);
  const merged = live ? { ...match, ...live } : match;

  const MainRow = (
    <TableRow
      hover
      onClick={() => onRowClick(match._id)}
      sx={{
        cursor: "pointer",
        "& td, & th": { borderBottom: "none !important" },
      }}
    >
      <TableCell
        padding="checkbox"
        sx={{ width: 56, minWidth: 56, py: 0.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect?.(match._id);
          }}
          size="small"
        />
      </TableCell>
      <TableCell sx={{ width: 100, whiteSpace: "nowrap", py: 0.5 }}>
        {matchCode(merged)}
      </TableCell>
      <TableCell sx={{ width: 220, maxWidth: 220, py: 0.5 }}>
        <Typography noWrap>{pairLabel(merged?.pairA)}</Typography>
      </TableCell>
      <TableCell sx={{ width: 220, maxWidth: 220, py: 0.5 }}>
        <Typography noWrap>{pairLabel(merged?.pairB)}</Typography>
      </TableCell>
      <TableCell sx={{ width: 96, whiteSpace: "nowrap", py: 0.5 }}>
        {courtLabel(merged)}
      </TableCell>
      <TableCell sx={{ width: 68, whiteSpace: "nowrap, py: 0.5" }}>
        {Number.isFinite(merged?.order) ? `T${merged.order + 1}` : "—"}
      </TableCell>
      <TableCell sx={{ width: 110, whiteSpace: "nowrap", py: 0.5 }}>
        {scoreSummary(merged)}
      </TableCell>
      <TableCell sx={{ width: 110, whiteSpace: "nowrap", py: 0.5 }}>
        {statusChip(merged?.status)}
      </TableCell>
      <TableCell
        onClick={(e) => e.stopPropagation()}
        align="center"
        sx={{ width: 76, py: 0.5 }}
      >
        {merged?.video ? (
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
        ) : (
          <Chip size="small" variant="outlined" label="—" />
        )}
      </TableCell>
    </TableRow>
  );

  const ActionRow = (
    <TableRow>
      <TableCell sx={{ width: 56, minWidth: 56, py: 0.25 }} />
      <TableCell colSpan={8} sx={{ py: 0.75, whiteSpace: "normal" }}>
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

  return (
    <>
      {MainRow}
      {ActionRow}
    </>
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
  checked = false,
  onToggleSelect,
}) {
  const live = useLiveMatch(liveStore, match._id);
  const merged = live ? { ...match, ...live } : match;
  const code = matchCode(merged);

  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        cursor: "pointer",
        position: "relative",
        "&:hover": { boxShadow: 2 },
      }}
      onClick={() => onCardClick(match._id)}
    >
      <Box
        sx={{ position: "absolute", top: 6, right: 6, zIndex: 2 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect?.(match._id);
          }}
          size="small"
          inputProps={{ "aria-label": "Chọn trận" }}
        />
      </Box>
      <CardHeader
        sx={{ py: 1 }}
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
      <CardContent sx={{ py: 1 }}>
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

/* ===== Batch video dialog ===== */
const BulkVideoDialog = React.memo(function BulkVideoDialog({
  open,
  selectedCount = 0,
  busy = false,
  onClose,
  onSubmit,
}) {
  const [url, setUrl] = React.useState("");
  React.useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const handleSubmit = React.useCallback(() => {
    const v = (url || "").trim();
    if (!v || !selectedCount || busy) return;
    onSubmit?.(v);
  }, [url, selectedCount, busy, onSubmit]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" keepMounted>
      <DialogTitle>Gán video cho {selectedCount} trận</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label="Link video (Facebook, YouTube, v.v.)"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <Alert severity="info">
            Link này sẽ được áp dụng cho tất cả các trận đang chọn.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
        <Button
          variant="contained"
          startIcon={<MovieIcon />}
          disabled={busy || !url.trim() || !selectedCount}
          onClick={handleSubmit}
        >
          Gán
        </Button>
      </DialogActions>
    </Dialog>
  );
});

/* ---------------- Component chính ---------------- */
export default function TournamentManagePage() {
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
  const [batchSetLiveUrl, { isLoading: batchingVideo }] =
    useAdminBatchSetMatchLiveUrlMutation();

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
  const typeOrderWeight = useCallback((t) => {
    const k = String(t || "").toLowerCase();
    if (k === "group") return 1;
    if (k === "roundelim" || k === "playoff") return 2;
    if (k === "knockout" || k === "ko") return 3;
    return 9;
  }, []);
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
  }, [brackets, typeOrderWeight]);

  const [tab, setTab] = useState(typesAvailable[0]?.type || "group");
  useEffect(() => {
    if (!typesAvailable.find((t) => t.type === tab))
      setTab(typesAvailable[0]?.type || "group");
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
  const [showBye, setShowBye] = useState(true); // NEW: Hiện trận BYE

  // NEW: Lọc theo Sân (đa lựa chọn)
  const [courtFilter, setCourtFilter] = useState([]); // array<string>
  const naturalCompare = useCallback(
    (a, b) =>
      String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    []
  );
  const allMatchesBase = matchPage?.list || [];

  // Tập hợp danh sách sân
  const courtOptions = useMemo(() => {
    const s = new Set();
    let hasUnassigned = false;
    for (const m of allMatchesBase) {
      const lbl = courtLabel(m);
      if (lbl && lbl !== "—") s.add(lbl);
      else hasUnassigned = true;
    }
    const arr = Array.from(s).sort(naturalCompare);
    return hasUnassigned ? ["Chưa gán sân", ...arr] : arr;
  }, [allMatchesBase, naturalCompare]);

  useEffect(() => {
    setCourtFilter((prev) => prev.filter((x) => courtOptions.includes(x)));
  }, [courtOptions]);

  // Viewer
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = useCallback(
    (mid) => setViewer({ open: true, matchId: mid }),
    []
  );
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

  // Court/Ref manager
  const [manageCourts, setManageCourts] = useState({
    open: false,
    bracketId: null,
    bracketName: "",
  });
  const [refMgrOpen, setRefMgrOpen] = useState(false);
  const openManageCourts = useCallback((bid = null, bname = "") => {
    setManageCourts({
      open: true,
      bracketId: bid ? String(bid) : null,
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

  /* ====== Selection ====== */
  const [selectedMatchIds, setSelectedMatchIds] = useState(() => new Set());
  const toggleSelectMatch = useCallback((mid) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      const key = String(mid);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedMatchIds(new Set()), []);
  const isAllSelectedIn = useCallback(
    (arr) =>
      arr.length > 0 && arr.every((m) => selectedMatchIds.has(String(m._id))),
    [selectedMatchIds]
  );
  const toggleSelectAllIn = useCallback((arr, checked) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      arr.forEach((m) => {
        const key = String(m._id);
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  }, []);

  // Batch assign
  const [bulkDlgOpen, setBulkDlgOpen] = useState(false);
  const [pickedRefs, setPickedRefs] = useState([]);
  const [bulkVideoDlg, setBulkVideoDlg] = useState({ open: false, url: "" });

  const [batchAssign, { isLoading: batching }] =
    useBatchAssignRefereeMutation();
  const {
    data: refData,
    isLoading: refsLoading,
    error: refsErr,
  } = useListTournamentRefereesQuery({ tid: id }, { skip: false });

  const refOptions = useMemo(() => {
    const list = Array.isArray(refData?.items)
      ? refData.items
      : Array.isArray(refData)
      ? refData
      : [];
    return list;
  }, [refData]);

  const idOfRef = useCallback((r) => String(r?._id ?? r?.id ?? ""), []);
  const labelOfRef = useCallback(
    (r) =>
      r?.name || r?.nickname || (idOfRef(r) ? `#${idOfRef(r).slice(-4)}` : ""),
    [idOfRef]
  );

  const submitBatchAssign = useCallback(async () => {
    const ids = Array.from(selectedMatchIds);
    const refs = pickedRefs.map(idOfRef).filter(Boolean);
    if (!ids.length) return toast.info("Chưa chọn trận nào.");
    if (!refs.length) return toast.info("Hãy chọn ít nhất 1 trọng tài.");
    try {
      await batchAssign({ ids, referees: refs }).unwrap();
      toast.success(`Đã gán trọng tài cho ${ids.length} trận`);
      setBulkDlgOpen(false);
      clearSelection();
      setPickedRefs([]);
      await refetchMatches?.();
    } catch (e) {
      toast.error(e?.data?.message || "Gán trọng tài thất bại");
    }
  }, [
    selectedMatchIds,
    pickedRefs,
    idOfRef,
    batchAssign,
    refetchMatches,
    clearSelection,
  ]);

  const submitBatchSetVideo = useCallback(
    async (urlParam) => {
      const ids = Array.from(selectedMatchIds);
      const url = (urlParam || "").trim();
      if (!ids.length) return toast.info("Chưa chọn trận nào.");
      if (!url) return toast.info("Hãy nhập link video hợp lệ.");
      try {
        await batchSetLiveUrl({ ids, video: url }).unwrap();
        toast.success(`Đã gán video cho ${ids.length} trận`);
        setBulkVideoDlg({ open: false, url: "" });
        clearSelection();
        await refetchMatches?.();
      } catch (e) {
        toast.error(e?.data?.message || "Gán video thất bại");
      }
    },
    [selectedMatchIds, batchSetLiveUrl, refetchMatches, clearSelection]
  );

  /* ====== Live store + realtime ====== */
  const liveStore = useMemo(() => createLiveStore(), []);
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
            } else setTimeout(tryPrint, 100);
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
  const [orderVersion, setOrderVersion] = useState(0);
  const [isPending, startTransition] = useTransition();

  const getLiveStatus = useCallback(
    (m) => liveStore.get(String(m?._id))?.status ?? m?.status,
    [liveStore]
  );

  // ======= NHÓM & LỌC =======
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

    // Map bracket
    const bracketMap = new Map();
    (brackets || []).forEach((b) => {
      const id = String(b?._id || b?.id || "");
      if (id) bracketMap.set(id, b);
    });

    // ✅ LOGIC MỚI: Tính trạng thái từng BẢNG theo stage_groupCode
    const groupStatusMap = new Map();

    for (const m of allMatchesBase) {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      if (!bid) continue;

      const bracket = bracketMap.get(bid);
      const btype = String(bracket?.type || "").toLowerCase();

      if (btype === "group") {
        const stage = bracket?.stage || 1;
        const rawGroupCode = String(
          m?.pool?.name || m?.pool?.id || m?.groupCode || ""
        ).trim();

        if (rawGroupCode) {
          // ✅ Chuẩn hóa: A→1, B→2,...
          const groupCode = normalizeGroupCode(rawGroupCode);
          const key = `${stage}_${groupCode}`;

          const live = liveStore.get(String(m._id)) || {};
          const st = String(live.status ?? m?.status ?? "").toLowerCase();
          const isDone = isByeMatch(m) || st === "finished";

          console.log(`📋 Trận ${m.code}:`, {
            stage,
            rawGroupCode,
            normalizedGroupCode: groupCode, // ← thêm log này
            key,
            status: m?.status,
            isDone,
          });

          if (!groupStatusMap.has(key)) {
            groupStatusMap.set(key, true);
          }
          if (!isDone) {
            groupStatusMap.set(key, false);
          }
        }
      }
    }

    console.log("🎯 Group Status Map:", Array.from(groupStatusMap.entries()));

    // ✅ Chuyển sang boolean: done = (total === finished && total > 0)
    const groupDoneMap = new Map();
    for (const [key, stats] of groupStatusMap.entries()) {
      groupDoneMap.set(key, stats.total > 0 && stats.total === stats.finished);
    }

    console.log("📊 Group Status:", Array.from(groupDoneMap.entries()));

    // ✅ Hàm kiểm tra trận KO có thể hiện không
    const canShowKOMatch = (m, bracket) => {
      const bracketType = String(bracket?.type || "").toLowerCase();
      if (bracketType !== "knockout" && bracketType !== "ko") return true;

      console.log(`🔍 Check trận ${m?.code || m?._id}:`, {
        bracketType,
        hasSeeds: !!(m?.seedA || m?.seedB), // ← Sửa: check seed của TRẬN này
      });

      // ✅ FIX: Lấy seed của TRẬN này, không phải của bracket!
      const seedA = m?.seedA;
      const seedB = m?.seedB;

      if (!seedA && !seedB) {
        console.log(`  ↳ Không có seed → HIỆN`);
        return true;
      }

      const sourceGroups = new Set();

      // ✅ Check seed A
      if (seedA?.type === "groupRank") {
        const stage = seedA.ref?.stage || 1;
        const rawGroupCode = String(seedA.ref?.groupCode || "").trim();
        if (rawGroupCode) {
          const groupCode = normalizeGroupCode(rawGroupCode);
          sourceGroups.add(`${stage}_${groupCode}`);
          console.log(
            `  ↳ Seed A: stage=${stage}, raw="${rawGroupCode}", normalized="${groupCode}"`
          );
        }
      }

      // ✅ Check seed B
      if (seedB?.type === "groupRank") {
        const stage = seedB.ref?.stage || 1;
        const rawGroupCode = String(seedB.ref?.groupCode || "").trim();
        if (rawGroupCode) {
          const groupCode = normalizeGroupCode(rawGroupCode);
          sourceGroups.add(`${stage}_${groupCode}`);
          console.log(
            `  ↳ Seed B: stage=${stage}, raw="${rawGroupCode}", normalized="${groupCode}"`
          );
        }
      }

      if (sourceGroups.size === 0) {
        console.log(
          `  ↳ Không có bảng nguồn (hoặc seed không phải groupRank) → HIỆN`
        );
        return true;
      }

      console.log(`  ↳ Cần check các bảng:`, Array.from(sourceGroups));

      for (const groupKey of sourceGroups) {
        const isFinished = groupStatusMap.get(groupKey);
        console.log(
          `    - Bảng "${groupKey}": ${
            isFinished === true ? "✅ xong" : "❌ chưa xong"
          }`
        );

        if (isFinished !== true) {
          console.log(`  ➡️ KẾT LUẬN: ẨN trận ${m.code || m._id}`);
          return false;
        }
      }

      console.log(`  ➡️ KẾT LUẬN: HIỆN trận ${m.code || m._id}`);
      return true;
    };
    // ✅ Lọc trận
    for (const m of allMatchesBase) {
      const bid = String(m?.bracket?._id || m?.bracket || "");
      if (!bid) continue;

      const bracket = bracketMap.get(bid);

      // Kiểm tra nguồn từ vòng bảng
      if (!canShowKOMatch(m, bracket)) continue;

      // filter BYE
      if (!showBye && isByeMatch(m)) continue;

      // keyword search (giữ nguyên code cũ)
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
            scoreSummary(merged),
          ].join(" ")
        );
        if (!text.includes(kw)) continue;
      }

      // court filter (giữ nguyên code cũ)
      if (courtFilter.length) {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        const lbl = courtLabel(merged);
        const isUn = lbl === "—";
        const matchByCourt =
          (isUn && courtFilter.includes("Chưa gán sân")) ||
          (!!lbl && lbl !== "—" && courtFilter.includes(lbl));
        if (!matchByCourt) continue;
      }

      push(bid, m);
    }

    const sorter = (a, b) => {
      const pa = statusPriority(getLiveStatus(a));
      const pb = statusPriority(getLiveStatus(b));
      if (pa !== pb) return pa - pb;

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
    courtFilter,
    showBye,
    brackets,
  ]);

  // LIVE Setup — TOÀN GIẢI
  const [liveSetup, setLiveSetup] = useState({
    open: false,
    bracketId: null,
    bracketName: "",
  });
  const openLiveSetup = useCallback(
    () => setLiveSetup({ open: true, bracketId: null, bracketName: "" }),
    []
  );
  const closeLiveSetup = useCallback(
    () => setLiveSetup((s) => ({ ...s, open: false })),
    []
  );

  // Socket realtime
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
      if (statusChanged) startTransition(() => setOrderVersion((v) => v + 1));
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
      const pdfFonts = await import("pdfmake/build/vfs_fonts");
      pdfMake.vfs = pdfFonts.pdfMake.vfs;

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
          ["Mã trận", "Cặp A", "Cặp B", "Sân", "Thứ tự", "Tỉ số"],
          ...sec.rows.map((r) =>
            r.map((cell) => (cell == null ? "" : String(cell)))
          ),
        ];

        content.push({
          table: {
            headerRows: 1,
            widths: [50, 160, 160, 80, 55, 65],
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
        const head = [
          "Mã trận",
          "Cặp A",
          "Cặp B",
          "Sân",
          "Thứ tự",
          "Tỉ số",
        ].map((t) => new TableCell({ children: [new Paragraph({ text: t })] }));
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

  // ======= Header hành động (Mobile Dropdown) =======
  const [actionAnchor, setActionAnchor] = useState(null);
  const openActionMenu = (e) => setActionAnchor(e.currentTarget);
  const closeActionMenu = () => setActionAnchor(null);
  const onMobileExportPDF = async () => {
    closeActionMenu();
    await handleExportPDF();
  };
  const onMobileExportWord = async () => {
    closeActionMenu();
    await handleExportWord();
  };

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
      <Stack spacing={1.5} mb={2}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
          sx={{ gap: 1 }}
        >
          <Typography variant="h5" noWrap>
            Quản lý giải: {tour?.name}
          </Typography>

          {/* Desktop actions */}
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            flexWrap="wrap"
            sx={{
              display: { xs: "none", md: "flex" },
              "& > *": { flexShrink: 0 },
              maxWidth: "100%",
              justifyContent: "flex-end",
            }}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefereeIcon />}
              onClick={() => setRefMgrOpen(true)}
            >
              Quản lý trọng tài
            </Button>

            {/* Quản lý sân TOÀN GIẢI */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<StadiumIcon />}
              onClick={() => openManageCourts()}
            >
              Quản lý sân
            </Button>

            {/* Thiết lập LIVE TOÀN GIẢI */}
            <Tooltip title="Áp dụng TOÀN GIẢI" arrow>
              <Button
                variant="outlined"
                size="small"
                startIcon={<MovieIcon />}
                onClick={openLiveSetup}
              >
                Thiết lập LIVE
              </Button>
            </Tooltip>

            {/* Export menu (desktop) */}
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
              Tổng quan
            </Button>
          </Stack>

          {/* Mobile actions */}
          <Box sx={{ display: { xs: "block", md: "none" }, width: "100%" }}>
            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="outlined"
                size="small"
                onClick={openActionMenu}
                startIcon={<MovieIcon />}
              >
                Hành động
              </Button>
              <Menu
                anchorEl={actionAnchor}
                open={Boolean(actionAnchor)}
                onClose={closeActionMenu}
                keepMounted
              >
                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    setRefMgrOpen(true);
                  }}
                >
                  <ListItemIcon>
                    <RefereeIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Quản lý trọng tài" />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    openManageCourts();
                  }}
                >
                  <ListItemIcon>
                    <StadiumIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Quản lý sân" />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    openLiveSetup();
                  }}
                >
                  <ListItemIcon>
                    <MovieIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Thiết lập LIVE" />
                </MenuItem>

                <Divider />

                <MenuItem
                  onClick={onMobileExportPDF}
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
                  onClick={onMobileExportWord}
                  disabled={exporting || bracketsOfTab.length === 0}
                >
                  <ListItemIcon>
                    <DescriptionIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      exporting ? "Đang xuất Word…" : "Xuất Word (.docx)"
                    }
                  />
                </MenuItem>

                <Divider />

                <MenuItem
                  component={Link}
                  to={`/tournament/${id}`}
                  onClick={closeActionMenu}
                >
                  <ListItemText primary="Trang giải" />
                </MenuItem>
              </Menu>
            </Stack>
          </Box>
        </Stack>

        {/* Filter bar */}
        <Paper variant="outlined">
          <Box
            p={2}
            display="grid"
            sx={{
              gap: 1,
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(260px, 420px) 200px 140px minmax(200px, 320px) 200px auto",
              },
              alignItems: "center",
            }}
          >
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
            >
              <MenuItem value="asc">Tăng dần</MenuItem>
              <MenuItem value="desc">Giảm dần</MenuItem>
            </TextField>

            {/* Lọc theo Sân */}
            <Autocomplete
              multiple
              size="small"
              options={courtOptions}
              disableCloseOnSelect
              value={courtFilter}
              onChange={(_, val) => setCourtFilter(val)}
              renderOption={(props, option, { selected }) => (
                <li {...props} key={option}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                  {option}
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Sân" placeholder="Chọn sân" />
              )}
            />

            {/* NEW: Hiện trận BYE */}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={showBye}
                  onChange={(e) => setShowBye(e.target.checked)}
                />
              }
              label="Hiện trận BYE"
            />

            <Stack
              direction="row"
              justifyContent={{ xs: "flex-start", md: "flex-end" }}
            >
              <Chip
                size="small"
                variant="outlined"
                label={`${bracketsOfTab.length} bracket • ${TYPE_LABEL(tab)}`}
              />
            </Stack>
          </Box>
        </Paper>

        {/* Tabs */}
        <Paper variant="outlined" sx={{ mt: 1 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 1 }}
          >
            {typesAvailable.map((t) => (
              <Tab key={t.type} label={TYPE_LABEL(t.type)} value={t.type} />
            ))}
          </Tabs>
        </Paper>
      </Stack>

      {/* === Floating Action Bar (hiện khi có chọn) === */}
      {selectedMatchIds.size > 0 && (
        <>
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <Box
              sx={{
                position: "fixed",
                left: "50%",
                transform: "translateX(-50%)",
                top: { xs: 72, md: 86 },
                zIndex: 1300,
              }}
            >
              <Paper
                elevation={6}
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 999,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`Đã chọn ${selectedMatchIds.size} trận`}
                />
                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<RefereeIcon />}
                  onClick={() => setBulkDlgOpen(true)}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Gán trọng tài
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<MovieIcon />}
                  onClick={() => setBulkVideoDlg({ open: true, url: "" })}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Gán video
                </Button>
                <Button
                  size="small"
                  onClick={clearSelection}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Bỏ chọn
                </Button>
              </Paper>
            </Box>
          </Box>
          {/* Mobile action bar (xs only) */}
          <Slide in={selectedMatchIds.size > 0} direction="up">
            <Box
              sx={{
                display: { xs: "block", md: "none" },
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 80,
                zIndex: 1300,
                px: 1.5,
                pb: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
              }}
            >
              <Paper
                elevation={8}
                sx={{ borderRadius: "16px 16px 0 0", px: 2, py: 1.25 }}
              >
                <Stack spacing={1}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={`Đã chọn ${selectedMatchIds.size} trận`}
                    />
                    <Box sx={{ flexGrow: 1 }} />
                  </Stack>

                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      fullWidth
                      startIcon={<RefereeIcon />}
                      onClick={() => setBulkDlgOpen(true)}
                    >
                      Gán trọng tài
                    </Button>
                    <Button
                      variant="outlined"
                      fullWidth
                      startIcon={<MovieIcon />}
                      onClick={() => setBulkVideoDlg({ open: true, url: "" })}
                    >
                      Gán video
                    </Button>
                    <Button fullWidth onClick={clearSelection}>
                      Bỏ chọn
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          </Slide>
        </>
      )}

      {/* Bracket list */}
      {bracketsOfTab.length === 0 ? (
        <Alert severity="info">
          Chưa có bracket thuộc loại {TYPE_LABEL(tab)}.
        </Alert>
      ) : (
        bracketsOfTab.map((b) => {
          const bid = String(b?._id);
          const list = groupedLists.get(bid) || [];
          const allSelected = isAllSelectedIn(list);

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

                  <Box sx={{ flexGrow: 1 }} />
                </Stack>
              </Box>

              {/* Desktop table — fixed layout */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <TableContainer>
                  <Table
                    size="small"
                    sx={{
                      tableLayout: "fixed",
                      "& th, & td": {
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        py: 0.5,
                      },
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell
                          padding="checkbox"
                          sx={{ width: 56, minWidth: 56 }}
                        >
                          <Checkbox
                            size="small"
                            checked={allSelected}
                            indeterminate={
                              !allSelected &&
                              list.some((m) =>
                                selectedMatchIds.has(String(m._id))
                              )
                            }
                            onChange={(e) =>
                              toggleSelectAllIn(list, e.target.checked)
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ width: 100 }}>Mã trận</TableCell>
                        <TableCell sx={{ width: 220 }}>Cặp A</TableCell>
                        <TableCell sx={{ width: 220 }}>Cặp B</TableCell>
                        <TableCell sx={{ width: 96 }}>Sân</TableCell>
                        <TableCell sx={{ width: 68 }}>Thứ tự</TableCell>
                        <TableCell sx={{ width: 110 }}>Tỉ số</TableCell>
                        <TableCell sx={{ width: 110 }}>Trạng thái</TableCell>
                        <TableCell sx={{ width: 76 }} align="center">
                          Video
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
                            <MatchDesktopRows
                              key={m._id}
                              match={m}
                              liveStore={liveStore}
                              onRowClick={(mid) => openMatch(mid)}
                              onOpenVideo={openVideoDlg}
                              onDeleteVideo={deleteVideoDlg}
                              onAssignCourt={openAssignCourt}
                              onAssignRef={openAssignRef}
                              onExportRefNote={handleExportRefNote}
                              checked={selectedMatchIds.has(String(m._id))}
                              onToggleSelect={toggleSelectMatch}
                            />
                          ))
                        )}
                      </TableBody>
                    )}
                  </Table>
                </TableContainer>
              </Box>

              {/* Mobile cards */}
              <Box sx={{ display: { xs: "block", md: "none" } }}>
                <Box p={2} pt={1}>
                  {mLoading ? (
                    <Grid container spacing={1.2}>
                      {Array.from({ length: 6 }).map((_, k) => (
                        <Grid key={k} item xs={12}>
                          <MatchCardSkeleton />
                        </Grid>
                      ))}
                    </Grid>
                  ) : list.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={2}>
                      Chưa có trận nào.
                    </Typography>
                  ) : (
                    <>
                      {/* Select-all cho mobile */}
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{ mb: 1 }}
                      >
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={
                            !allSelected &&
                            list.some((m) =>
                              selectedMatchIds.has(String(m._id))
                            )
                          }
                          onChange={(e) =>
                            toggleSelectAllIn(list, e.target.checked)
                          }
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          inputProps={{ "aria-label": "Chọn tất cả (mobile)" }}
                        />
                        <Typography variant="body2">Chọn tất cả</Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${
                            list.filter((m) =>
                              selectedMatchIds.has(String(m._id))
                            ).length
                          } đã chọn`}
                        />
                      </Stack>

                      <Grid container spacing={1.2}>
                        {list.map((m) => (
                          <Grid key={m._id} item xs={12} sm={6}>
                            <MatchCard
                              match={m}
                              liveStore={liveStore}
                              onCardClick={(mid) => openMatch(mid)}
                              onOpenVideo={openVideoDlg}
                              onDeleteVideo={deleteVideoDlg}
                              onAssignCourt={openAssignCourt}
                              onAssignRef={openAssignRef}
                              onExportRefNote={handleExportRefNote}
                              checked={selectedMatchIds.has(String(m._id))}
                              onToggleSelect={toggleSelectMatch}
                            />
                          </Grid>
                        ))}
                      </Grid>
                    </>
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

      {/* Court Manager TOÀN GIẢI */}
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
          refetchMatches?.();
          refetchBrackets?.();
        }}
      />

      {/* Thiết lập LIVE TOÀN GIẢI */}
      <LiveSetupDialog
        open={liveSetup.open}
        onClose={closeLiveSetup}
        tournamentId={id}
        bracketId={liveSetup.bracketId}
      />

      {/* Popup xem/tracking trận */}
      <ResponsiveMatchViewer
        open={viewer.open}
        matchId={viewer.matchId}
        onClose={closeMatch}
      />

      {/* ===== Dialog gán trọng tài (batch) ===== */}
      <BulkAssignRefDialog
        open={bulkDlgOpen}
        onClose={() => setBulkDlgOpen(false)}
        tournamentId={id}
        selectedMatchIds={selectedMatchIds}
        onAssigned={() => {
          refetchMatches?.();
        }}
      />

      {/* ===== Dialog gán video (batch) ===== */}
      <BulkVideoDialog
        open={bulkVideoDlg.open}
        selectedCount={selectedMatchIds.size}
        busy={batchingVideo}
        onClose={() => setBulkVideoDlg({ open: false, url: "" })}
        onSubmit={submitBatchSetVideo}
      />
    </Box>
  );
}
