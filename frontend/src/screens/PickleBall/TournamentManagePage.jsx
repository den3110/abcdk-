// src/pages/admin/parts/TournamentManagePage.jsx
/* eslint-disable react/prop-types, no-unused-vars, no-empty */
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
import { skipToken } from "@reduxjs/toolkit/query";
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
  Group as ManagersIcon,
  Stadium as StadiumIcon,
  HowToReg as RefereeIcon,
  Movie as MovieIcon,
  Print as PrintIcon,
  AutoAwesome as AutoAwesomeIcon,
  CloudUpload as CloudUploadIcon,
  InsertLink as InsertLinkIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
  useAdminSetMatchLiveUrlMutation,
  useAdminBatchSetMatchLiveUrlMutation,
  useVerifyRefereeQuery,
  useAnalyzeRegistrationPosterMutation,
  useUploadRegistrationPosterTemplateMutation,
  useSetRegistrationPosterTemplateUrlMutation,
} from "../../slices/tournamentsApiSlice";

import {
  useBatchAssignRefereeMutation,
  useListTournamentRefereesQuery,
} from "../../slices/refereeScopeApiSlice";

import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";
import { useSocket } from "../../context/SocketContext";
import { useSocketRoomSet } from "../../hook/useSocketRoomSet";
import VideoDialog from "../../components/VideoDialog";
import AssignCourtStationDialog from "../../components/AssignCourtStationDialog";
import AssignRefDialog from "../../components/AssignRefDialog";
import TournamentCourtClusterDialog from "../../components/TournamentCourtClusterDialog";
import ManageRefereesDialog from "../../components/RefereeManagerDialog";
import TournamentManagersDialog from "../../components/TournamentManagersDialog";
import LiveSetupDialog from "../../components/LiveSetupDialog";
import BulkAssignRefDialog from "../../components/BulkAssignRefDialog";
import TeamTournamentManageView from "../../components/teamTournament/TeamTournamentManageView";
import SEOHead from "../../components/SEOHead";
import RefereeScoreDialog from "../../components/referee/RefereeScoreDialog";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";
import { formatDateTime } from "../../i18n/format";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../../utils/tournamentName";
import { getMatchSideDisplayName } from "../../utils/matchDisplay";

const POSTER_NAME_FONT_OPTIONS = [
  { value: "", label: "Mặc định AI" },
  { value: "FreeSans, Arial, sans-serif", label: "FreeSans" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Arial Black, Arial, sans-serif", label: "Arial Black" },
  { value: "Impact, Arial Black, sans-serif", label: "Impact" },
  { value: "Montserrat, Arial, sans-serif", label: "Montserrat" },
];
const POSTER_AI_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

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

const pairLabel = (pair, eventType = "double", displayMode = "nickname") =>
  getTournamentPairName(pair, eventType, displayMode, { separator: " / " });

/* Cặp đã có đội thật chưa (có VĐV/tên) */
const hasResolvedPair = (p) =>
  !!(
    p &&
    (p.player1 ||
      p.player2 ||
      (Array.isArray(p.players) && p.players.length) ||
      p.name ||
      p.teamName ||
      p.label ||
      p.displayName)
  );

const isConcreteTeamLabel = (value) => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(BYE|TBD|Registration|Chưa có đội|—)$/i.test(text)) return false;
  return !/^[WL]\s*-/i.test(text);
};

/* Tên đội hiển thị: ưu tiên tên đã resolve sẵn (__sideA/__sideB, tính như sơ đồ),
   nếu không có thì dùng resolver chung (đội thật → seed → "W-V…" → "—"). */
const teamLabel = (match, side) => {
  const pre = side === "A" ? match?.__sideA : match?.__sideB;
  return pre || getMatchSideDisplayName(match, side, "—");
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

const WEB_LOGO_URL = "/icon-192.png";

const getTypeLabel = (t, type) => {
  const key = String(type || "").toLowerCase();
  if (key === "group") return t("tournaments.overview.types.group");
  if (key === "po" || key === "playoff" || key === "roundelim") {
    return t("tournaments.overview.types.playoff");
  }
  if (key === "knockout" || key === "ko") {
    return t("tournaments.overview.types.knockout");
  }
  if (key === "double_elim" || key === "doubleelim") {
    return t("tournaments.overview.types.doubleElim");
  }
  if (key === "swiss") return "Swiss";
  if (key === "gsl") return "GSL";
  return type || t("tournaments.overview.typeFallback");
};

const getManageStatusMeta = (t, status) => {
  const key = String(status || "").toLowerCase();
  const map = {
    scheduled: {
      color: "default",
      label: t("tournaments.overview.status.scheduled"),
    },
    queued: { color: "default", label: t("tournaments.overview.status.queued") },
    assigned: {
      color: "warning",
      label: t("tournaments.overview.status.assigned"),
    },
    live: { color: "warning", label: t("tournaments.overview.status.live") },
    finished: {
      color: "success",
      label: t("tournaments.overview.status.finished"),
    },
  };
  return map[key] || { color: "default", label: status || "—" };
};

const statusChipLocalized = (t, status) => {
  const meta = getManageStatusMeta(t, status);
  const rawStatus = String(status || "").toLowerCase();

  if (["live", "ongoing", "playing", "inprogress"].includes(rawStatus)) {
    return (
      <Chip
        size="small"
        label={meta.label}
        sx={{ bgcolor: "#f57c00", color: "#fff", fontWeight: 600 }}
      />
    );
  }
  if (rawStatus === "assigned") {
    return (
      <Chip
        size="small"
        label={meta.label}
        sx={{ bgcolor: "#fbc02d", color: "#000", fontWeight: 600 }}
      />
    );
  }

  return <Chip size="small" color={meta.color} label={meta.label} />;
};

const refereeNames = (m) => {
  const pickOne = (u) => personNickname(u);
  const r1 = m?.referee || m?.mainReferee || null;
  const list = m?.referees || m?.refs || m?.assignedReferees || null;
  if (Array.isArray(list) && list.length) return list.map(pickOne).join(", ");
  if (r1) return pickOne(r1);
  return "";
};

const normalizeEntityId = (value) => {
  const raw = value?._id ?? value?.id ?? value;
  return raw == null ? "" : String(raw).trim();
};

const normalizeMatchRefereeIds = (match) =>
  Array.from(
    new Set(
      [
        ...(Array.isArray(match?.referee) ? match.referee : [match?.referee]),
        ...(Array.isArray(match?.referees) ? match.referees : []),
        ...(Array.isArray(match?.courtStationReferees)
          ? match.courtStationReferees
          : []),
      ]
        .map(normalizeEntityId)
        .filter(Boolean),
    ),
  );

const isUserRefereeOfMatch = (match, user) => {
  const userId = normalizeEntityId(user);
  if (!userId) return false;
  return normalizeMatchRefereeIds(match).includes(userId);
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
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;margin:16px;background:#fff;color:#000}
    table{width:100%;border-collapse:collapse}
    td,th{border:1px solid #000;padding:6px;font-size:12px}
    .no-border td,.no-border th{border:none}
    .title{font-size:22px;font-weight:700;text-align:left}
    .section-title{font-weight:700}
    .small{font-size:11px}
    @media screen {
      body{background:var(--bg,#fff);color:var(--fg,#000)}
      td,th{border-color:var(--border,#000)}
    }
    @media print {
      body{background:#fff !important;color:#000 !important}
      td,th{border-color:#000 !important}
    }
  `;
  const pointRow = () => `
    <tr>
      <td style="border:1px solid var(--border,black)"></td>
      ${Array.from(
        { length: 22 },
        (_, i) =>
          `<td style="border:1px solid var(--border,black)">${
            i < 10 ? `&nbsp;${i}&nbsp;` : i
          }</td>`,
      ).join("")}
      <td style="border:1px solid var(--border,black)"></td>
      <td style="border:1px solid var(--border,black)"></td>
      <td style="border:1px solid var(--border,black)"></td>
    </tr>`;
  return `<!DOCTYPE html>
  <html><head><meta charset="utf-8" />
    <title>Biên bản trọng tài - ${code}</title>
    <style>${css}</style>
    <script>
      (function(){
        const dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
        if(dark){
          document.documentElement.style.setProperty('--bg','#1a1a1a');
          document.documentElement.style.setProperty('--fg','#e0e0e0');
          document.documentElement.style.setProperty('--border','#666');
        }
      })();
    </script>
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

const namedCourtText = (value) => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return !text || isMongoId(text) ? "" : text;
  }
  if (typeof value === "object") {
    return (
      namedCourtText(value.name) ||
      namedCourtText(value.label) ||
      namedCourtText(value.code) ||
      namedCourtText(value.title) ||
      namedCourtText(value.displayName) ||
      (Number.isFinite(value.number) ? `Sân ${value.number}` : "") ||
      (Number.isFinite(value.no) ? `Sân ${value.no}` : "")
    );
  }
  return "";
};

const courtLabel = (m) => {
  return (
    namedCourtText(m?.courtStationLabel) ||
    namedCourtText(m?.courtStationName) ||
    namedCourtText(m?.courtLabel) ||
    namedCourtText(m?.courtName) ||
    namedCourtText(m?.courtStation) ||
    namedCourtText(m?.courtAssigned) ||
    namedCourtText(m?.assignedCourt) ||
    namedCourtText(m?.court) ||
    namedCourtText(m?.courtCode) ||
    namedCourtText(m?.courtTitle) ||
    "—"
  );
};

const matchCode = (m) => {
  if (!m) return "—";
  if (m.displayCode) return m.displayCode;
  if (m.code) return m.code;
  if (m.globalCode) return m.globalCode;
  const r = Number.isFinite(m?.globalRound)
    ? m.globalRound
    : Number.isFinite(m?.round)
      ? m.round
      : "?";
  const t = Number.isFinite(m?.order) ? m.order + 1 : undefined;
  return `V${r}${t ? `-T${t}` : ""}`;
};

const parseMatchCodeParts = (m) => {
  const raw = String(
    m?.displayCode || m?.code || m?.globalCode || m?.matchCode || "",
  ).trim();
  const hit = raw.match(/^V(\d+)(?:-[^-]+)?-T(\d+)$/i);
  if (!hit) return { round: NaN, order: NaN };
  return {
    round: Number(hit[1]),
    order: Number(hit[2]) - 1,
  };
};

const matchRoundNumber = (m) => {
  const direct = Number(m?.round ?? m?.rrRound);
  if (Number.isFinite(direct)) return direct;
  const global = Number(m?.globalRound);
  if (Number.isFinite(global)) return global;
  return parseMatchCodeParts(m).round;
};

const matchOrderNumber = (m) => {
  const direct = Number(m?.order ?? m?.meta?.order);
  if (Number.isFinite(direct)) return direct;
  return parseMatchCodeParts(m).order;
};

const uniqueFiniteNumbers = (...values) =>
  Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    ),
  );

const matchRoundCandidates = (m) =>
  uniqueFiniteNumbers(
    m?.round ?? m?.rrRound,
    m?.globalRound,
    parseMatchCodeParts(m).round,
  );

const matchOrderCandidates = (m) =>
  uniqueFiniteNumbers(m?.order ?? m?.meta?.order, parseMatchCodeParts(m).order);

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
  if (v.color === "warning") {
    return (
      <Chip
        size="small"
        label={v.label}
        sx={{ bgcolor: "#f57c00", color: "#fff", fontWeight: 600 }}
      />
    );
  }
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
    hasResolvedPair(m?.pairA) ||
    isConcreteTeamLabel(m?.__sideA || m?.resolvedSideNameA || m?.teamAName)
  );
  const bOK = !!(
    hasResolvedPair(m?.pairB) ||
    isConcreteTeamLabel(m?.__sideB || m?.resolvedSideNameB || m?.teamBName)
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

const extractRealtimeMatchPayload = (payload) =>
  payload?.data ?? payload?.snapshot ?? payload?.match ?? payload ?? null;

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
      const nextVersion = Number(
        partial?.liveVersion ??
          partial?.version ??
          (partial?.updatedAt ? new Date(partial.updatedAt).getTime() : 0),
      );
      const prevVersion = Number(
        prev?.liveVersion ??
          prev?.version ??
          (prev?.updatedAt ? new Date(prev.updatedAt).getTime() : 0),
      );
      const next =
        prevVersion > 0 && nextVersion > 0 && nextVersion < prevVersion
          ? prev
          : { ...prev, ...partial };
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
    (onStoreChange) => liveStore.subscribe(matchId, onStoreChange),
    [liveStore, matchId],
  );
  const getSnapshot = useCallback(
    () => liveStore.get(matchId),
    [liveStore, matchId],
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
    "liveVersion",
    "version",
    "updatedAt",
    "scoreA",
    "scoreB",
    "setsWonA",
    "setsWonB",
    "scores",
    "gameScores",
    "currentGame",
    "sets",
    "serve",
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
  canStartReferee = false,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onStartReferee,
}) {
  const st = String(match?.status || "").toLowerCase();
  const canAssignCourt = !(st === "live" || st === "finished");
  const canStartMatch = Boolean(canStartReferee && onStartReferee);
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
      {canStartMatch ? (
        <Chip
          size="small"
          color="warning"
          variant="filled"
          icon={<SportsIcon />}
          label="Bắt trận"
          onClick={() => onStartReferee(match)}
        />
      ) : null}
    </Box>
  );
});

const ActionChipsLocalized = React.memo(function ActionChipsLocalized(props) {
  const { t, locale } = useLanguage();
  const st = String(props.match?.status || "").toLowerCase();
  const canAssignCourt = !(st === "live" || st === "finished");
  const canStartMatch = Boolean(props.canStartReferee && props.onStartReferee);

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
        label={t("tournaments.manage.refereeReport")}
        onClick={() => props.onExportRefNote?.(props.match)}
      />
      <Chip
        size="small"
        color="info"
        variant={props.match?.video ? "filled" : "outlined"}
        icon={<MovieIcon />}
        label={
          props.match?.video
            ? t("tournaments.manage.editVideo")
            : t("tournaments.manage.attachVideo")
        }
        onClick={() => props.onOpenVideo(props.match)}
      />
      {props.match?.video && (
        <Chip
          size="small"
          color="error"
          variant="outlined"
          label={t("tournaments.manage.removeVideo")}
          onClick={() => props.onDeleteVideo(props.match)}
        />
      )}
      {canAssignCourt && (
        <Chip
          size="small"
          color="secondary"
          variant="outlined"
          icon={<StadiumIcon />}
          label={t("tournaments.manage.assignCourt")}
          onClick={() => props.onAssignCourt(props.match)}
        />
      )}
      <Chip
        size="small"
        color="primary"
        variant="outlined"
        icon={<RefereeIcon />}
        label={t("tournaments.manage.assignSingleReferee")}
        onClick={() => props.onAssignRef(props.match)}
      />
      {canStartMatch ? (
        <Chip
          size="small"
          color="warning"
          variant="filled"
          icon={<SportsIcon />}
          label="Bắt trận"
          onClick={() => props.onStartReferee(props.match)}
        />
      ) : null}
    </Box>
  );
});

/* ======= NEW: Desktop two-line rows ======= */
const MatchDesktopRows = React.memo(function MatchDesktopRows({
  match,
  liveStore,
  eventType = "double",
  displayMode = "nickname",
  canStartReferee = false,
  onRowClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onStartReferee,
  checked = false,
  onToggleSelect,
}) {
  const { t, locale } = useLanguage();
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
        <Typography noWrap>
          {teamLabel(merged, "A")}
        </Typography>
      </TableCell>
      <TableCell sx={{ width: 220, maxWidth: 220, py: 0.5 }}>
        <Typography noWrap>
          {teamLabel(merged, "B")}
        </Typography>
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
        {statusChipLocalized(t, merged?.status)}
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
        <ActionChipsLocalized
          match={merged}
          canStartReferee={canStartReferee}
          onOpenVideo={onOpenVideo}
          onDeleteVideo={onDeleteVideo}
          onAssignCourt={onAssignCourt}
          onAssignRef={onAssignRef}
          onExportRefNote={onExportRefNote}
          onStartReferee={onStartReferee}
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
  eventType = "double",
  displayMode = "nickname",
  canStartReferee = false,
  onCardClick,
  onOpenVideo,
  onDeleteVideo,
  onAssignCourt,
  onAssignRef,
  onExportRefNote,
  onStartReferee,
  checked = false,
  onToggleSelect,
}) {
  const { t, locale } = useLanguage();
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
            {statusChipLocalized(t, merged?.status)}
          </Stack>
        }
        subheader={
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Chip
              size="small"
              label={t("tournaments.manage.courtChip", {
                court: courtLabel(merged),
              })}
            />
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
              {t("tournaments.manage.pairA")}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {teamLabel(merged, "A")}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.manage.pairB")}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {teamLabel(merged, "B")}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t("tournaments.manage.score")}
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

          <ActionChipsLocalized
            match={merged}
            canStartReferee={canStartReferee}
            onOpenVideo={onOpenVideo}
            onDeleteVideo={onDeleteVideo}
            onAssignCourt={onAssignCourt}
            onAssignRef={onAssignRef}
            onExportRefNote={onExportRefNote}
            onStartReferee={onStartReferee}
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
  const { t } = useLanguage();
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
            label={t("tournaments.manage.videoUrlLabel")}
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

const BulkVideoDialogLocalized = React.memo(function BulkVideoDialogLocalized({
  open,
  selectedCount = 0,
  busy = false,
  onClose,
  onSubmit,
}) {
  const { t, locale } = useLanguage();
  const [url, setUrl] = React.useState("");

  React.useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const handleSubmit = React.useCallback(() => {
    const value = (url || "").trim();
    if (!value || !selectedCount || busy) return;
    onSubmit?.(value);
  }, [url, selectedCount, busy, onSubmit]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" keepMounted>
      <DialogTitle>
        {t("tournaments.manage.bulkVideoTitle", { count: selectedCount })}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            autoFocus
            label={t("tournaments.manage.videoUrlLabel")}
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <Alert severity="info">{t("tournaments.manage.bulkVideoHint")}</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          {t("common.close", undefined, "Close")}
        </Button>
        <Button
          variant="contained"
          startIcon={<MovieIcon />}
          disabled={busy || !url.trim() || !selectedCount}
          onClick={handleSubmit}
        >
          {t("tournaments.manage.attachVideo")}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

/* ---------------- Component chính ---------------- */
export default function TournamentManagePage() {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);

  // Queries
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
    refetch: refetchTour,
  } = useGetTournamentQuery(id);
  const displayMode = getTournamentNameDisplayMode(tour);
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
  } = useAdminListMatchesByTournamentQuery(
    {
      tid: id,
      page: 1,
      pageSize: 1000,
    },
    { refetchOnMountOrArgChange: true, refetchOnFocus: true },
  );
  const { data: verifyRefereeRes } = useVerifyRefereeQuery(
    me?._id && id ? id : skipToken,
  );

  const [setLiveUrl, { isLoading: savingVideo }] =
    useAdminSetMatchLiveUrlMutation();
  const [batchSetLiveUrl, { isLoading: batchingVideo }] =
    useAdminBatchSetMatchLiveUrlMutation();
  const [analyzeRegistrationPoster, { isLoading: analyzingPoster }] =
    useAnalyzeRegistrationPosterMutation();
  const [
    uploadRegistrationPosterTemplate,
    { isLoading: uploadingPosterTemplate },
  ] = useUploadRegistrationPosterTemplateMutation();
  const [setPosterTemplateUrl, { isLoading: settingPosterUrl }] =
    useSetRegistrationPosterTemplateUrlMutation();
  const [posterTemplateDragging, setPosterTemplateDragging] = useState(false);
  const posterTemplateInputRef = useRef(null);
  const [posterUrlDialogOpen, setPosterUrlDialogOpen] = useState(false);
  const [posterUrlInput, setPosterUrlInput] = useState("");
  const [posterUrlPreviewError, setPosterUrlPreviewError] = useState(false);
  const [posterNameFontFamily, setPosterNameFontFamily] = useState("");
  const [posterAiExtraPrompt, setPosterAiExtraPrompt] = useState("");
  const posterAiJobStatusRef = useRef({ id: "", status: "" });

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
  const canReferee = !!verifyRefereeRes?.isReferee;
  const canOpenRefereeCenter = isAdmin || canReferee;
  const posterTemplateUrl = tour?.registrationPosterConfig?.templateUrl || "";
  const posterAiJob = tour?.registrationPosterConfig?.aiJob || null;
  const posterAiStatus = String(posterAiJob?.status || "");
  const posterAiStartedAt = Date.parse(
    posterAiJob?.startedAt || posterAiJob?.requestedAt || "",
  );
  const posterAiStale =
    posterAiStatus === "running" &&
    Number.isFinite(posterAiStartedAt) &&
    Date.now() - posterAiStartedAt > POSTER_AI_RUNNING_TIMEOUT_MS;
  const posterAiRunning =
    posterAiStatus === "running" &&
    !posterAiStale &&
    tour?.registrationPosterConfig?.needsAnalysis !== false;
  const posterTemplateBusy =
    uploadingPosterTemplate || analyzingPoster || settingPosterUrl;
  const savedPosterNameFontFamily =
    tour?.registrationPosterConfig?.text?.fontFamily || "";
  const savedPosterAiExtraPrompt =
    tour?.registrationPosterConfig?.aiExtraPrompt || "";
  const canManageManagers = useMemo(
    () =>
      isAdmin ||
      String(tour?.createdBy?._id || tour?.createdBy || "") ===
        String(me?._id || me?.id || ""),
    [isAdmin, me?._id, me?.id, tour?.createdBy],
  );

  useEffect(() => {
    setPosterNameFontFamily(savedPosterNameFontFamily);
  }, [savedPosterNameFontFamily]);

  useEffect(() => {
    setPosterAiExtraPrompt(savedPosterAiExtraPrompt);
  }, [savedPosterAiExtraPrompt]);

  useEffect(() => {
    if (!posterAiRunning) return undefined;
    const timer = window.setInterval(() => {
      refetchTour();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [posterAiRunning, refetchTour]);

  useEffect(() => {
    const jobId = String(posterAiJob?.id || "");
    const status = String(posterAiJob?.status || "");
    const previous = posterAiJobStatusRef.current;

    if (
      jobId &&
      previous.id === jobId &&
      previous.status === "running" &&
      status === "succeeded"
    ) {
      toast.success("AI poster đã xử lý xong.");
    }
    if (
      jobId &&
      previous.id === jobId &&
      previous.status === "running" &&
      status === "failed"
    ) {
      toast.error(posterAiJob?.error || "AI poster thất bại.");
    }
    if (
      jobId &&
      status === "running" &&
      posterAiStale &&
      !previous.stale
    ) {
      toast.error("AI poster chạy quá lâu, bạn có thể bấm chạy lại.");
    }

    posterAiJobStatusRef.current = { id: jobId, status, stale: posterAiStale };
  }, [posterAiJob?.error, posterAiJob?.id, posterAiJob?.status, posterAiStale]);

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
      const type = (b?.type || "").toString().toLowerCase();
      if (!type) return;
      if (!uniq.has(type))
        uniq.set(type, {
          type,
          label: getTypeLabel(t, type),
          weight: typeOrderWeight(type),
        });
    });
    if (uniq.size === 0) {
      uniq.set("group", {
        type: "group",
        label: getTypeLabel(t, "group"),
        weight: 1,
      });
    }
    return Array.from(uniq.values()).sort((a, b) => a.weight - b.weight);
  }, [brackets, t, typeOrderWeight]);

  const [tab, setTab] = useState(typesAvailable[0]?.type || "group");
  useEffect(() => {
    if (!typesAvailable.find((t) => t.type === tab))
      setTab(typesAvailable[0]?.type || "group");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesAvailable]);

  const bracketsOfTab = useMemo(() => {
    const list = (brackets || []).filter(
      (b) => String(b?.type || "").toLowerCase() === String(tab).toLowerCase(),
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
    [],
  );
  const allMatchesBase = useMemo(() => {
    const rawList = matchPage?.list || [];
    const evType = tour?.eventType;

    // Index trận để tra nguồn (giống SƠ ĐỒ):
    const byId = new Map();
    const byBRO = new Map(); // `${bracketId}:${round}:${order}`
    const bySRO = new Map(); // `${stage}:${round}:${order}`
    const bracketById = new Map();
    const matchesByBracketId = new Map();
    const addIndex = (map, key, match) => {
      const bucket = map.get(key);
      if (bucket) bucket.push(match);
      else map.set(key, [match]);
    };
    const displayRoundOf = (m) => {
      const fromCode = parseMatchCodeParts(m).round;
      return Number.isFinite(fromCode) ? fromCode : matchRoundNumber(m);
    };
    const sortableDisplayRound = (m) => {
      const value = displayRoundOf(m);
      return Number.isFinite(value) ? value : -1;
    };
    const sortableMatchOrder = (m) => {
      const value = matchOrderNumber(m);
      return Number.isFinite(value) ? value : 0;
    };
    const pickIndexedSource = (matches, owner) => {
      const list = Array.isArray(matches) ? matches : matches ? [matches] : [];
      const ownerId = String(owner?._id || owner?.id || "");
      const candidates = list.filter(
        (candidate) =>
          String(candidate?._id || candidate?.id || "") !== ownerId,
      );
      if (candidates.length <= 1) return candidates[0] || null;

      const ownerRound = displayRoundOf(owner);
      const sameBranch = candidates.filter(
        (candidate) =>
          String(candidate?.branch || "main") ===
            String(owner?.branch || "main") &&
          String(candidate?.phase || "") === String(owner?.phase || ""),
      );
      const branchCandidates = sameBranch.length ? sameBranch : candidates;
      const previousCandidates = Number.isFinite(ownerRound)
        ? branchCandidates.filter((candidate) => {
            const candidateRound = displayRoundOf(candidate);
            return Number.isFinite(candidateRound) && candidateRound < ownerRound;
          })
        : [];
      return (previousCandidates.length ? previousCandidates : branchCandidates)
        .slice()
        .sort((a, b) => sortableDisplayRound(b) - sortableDisplayRound(a))[0];
    };
    (brackets || []).forEach((bracket) => {
      const id = String(bracket?._id || bracket?.id || "");
      if (id) bracketById.set(id, bracket);
    });
    for (const m of rawList) {
      byId.set(String(m._id), m);
      const bid = String(m?.bracket?._id || m?.bracket || "");
      const bracket = bracketById.get(bid);
      const stage = Number(m?.bracket?.stage ?? bracket?.stage);
      const rounds = matchRoundCandidates(m);
      const orders = matchOrderCandidates(m);
      if (bid) {
        if (!matchesByBracketId.has(bid)) matchesByBracketId.set(bid, []);
        matchesByBracketId.get(bid).push(m);
      }
      for (const r of rounds) {
        for (const o of orders) {
          if (bid) addIndex(byBRO, `${bid}:${r}:${o}`, m);
          if (Number.isFinite(stage)) addIndex(bySRO, `${stage}:${r}:${o}`, m);
        }
      }
    }

    // Tìm trận nguồn từ seed (matchId, hoặc stage/bracket + round + order)
    const findSource = (m, seed) => {
      if (!seed) return null;
      const mid = String(seed?.ref?.matchId || "");
      if (mid && byId.has(mid)) return byId.get(mid);
      const r = Number(seed?.ref?.round);
      const o = Number(seed?.ref?.order);
      if (!Number.isFinite(r) || !Number.isFinite(o)) return null;
      const stage = Number(seed?.ref?.stageIndex ?? seed?.ref?.stage);
      if (Number.isFinite(stage)) {
        const hit = pickIndexedSource(bySRO.get(`${stage}:${r}:${o}`), m);
        if (hit) return hit;
      }
      const bid = String(m?.bracket?._id || m?.bracket || "");
      return bid ? pickIndexedSource(byBRO.get(`${bid}:${r}:${o}`), m) : null;
    };

    const getPlannedSeed = (m, side) => {
      if (!m) return null;

      const localRound = matchRoundNumber(m) || 1;
      const localOrder = matchOrderNumber(m);
      if (!Number.isFinite(localOrder)) return null;

      const matchBracketId = String(m?.bracket?._id || m?.bracket || "");
      const matchBracket =
        (m?.bracket && typeof m.bracket === "object" ? m.bracket : null) ||
        bracketById.get(matchBracketId) ||
        null;
      const sourceType = String(
        matchBracket?.type || m?.type || m?.format || "",
      ).toLowerCase();
      if (sourceType !== "knockout" && sourceType !== "ko") return null;

      if (localRound > 1) {
        const bracketMatches = matchesByBracketId.get(matchBracketId) || [];
        const sameBranch = (candidate) =>
          String(candidate?.branch || "main") === String(m?.branch || "main") &&
          String(candidate?.phase || "") === String(m?.phase || "");
        const byOrder = (a, b) => sortableMatchOrder(a) - sortableMatchOrder(b);
        const currentRoundMatches = bracketMatches
          .filter((candidate) =>
            matchRoundCandidates(candidate).includes(localRound),
          )
          .filter(sameBranch)
          .sort(byOrder);
        const currentIndex = currentRoundMatches.findIndex(
          (candidate) => String(candidate?._id || "") === String(m?._id || ""),
        );
        const sourceSlot =
          (currentIndex >= 0 ? currentIndex : localOrder) * 2 +
          (side === "B" ? 1 : 0);
        const previousRoundMatches = bracketMatches
          .filter((candidate) =>
            matchRoundCandidates(candidate).includes(localRound - 1),
          )
          .filter(sameBranch)
          .sort(byOrder);
        const sourceMatch = previousRoundMatches[sourceSlot] || null;
        const stageIndex = Number(sourceMatch?.bracket?.stage ?? matchBracket?.stage ?? 0);
        const sourceRoundValue = matchRoundNumber(sourceMatch);
        const sourceOrderValue = matchOrderNumber(sourceMatch);
        const sourceRound = Number.isFinite(sourceRoundValue)
          ? sourceRoundValue
          : localRound - 1;
        const sourceOrder = Number.isFinite(sourceOrderValue)
          ? sourceOrderValue
          : localOrder * 2 + (side === "B" ? 1 : 0);
        const ref = {
          stageIndex,
          stage: stageIndex,
          round: sourceRound,
          order: sourceOrder,
        };
        if (sourceMatch?._id) ref.matchId = sourceMatch._id;
        return {
          type: "stageMatchWinner",
          ref,
          label: `W-V${localRound - 1}-T${sourceOrder + 1}`,
        };
      }

      const seedRows = Array.isArray(matchBracket?.prefill?.seeds)
        ? matchBracket.prefill.seeds
        : Array.isArray(matchBracket?.config?.blueprint?.seeds)
          ? matchBracket.config.blueprint.seeds
          : [];
      if (!seedRows.length) return null;

      const pairNo = localOrder + 1;
      const planned =
        seedRows.find((entry) => Number(entry?.pair) === pairNo) ||
        seedRows[localOrder] ||
        null;
      const plannedSeed = side === "A" ? planned?.A : planned?.B;
      return plannedSeed?.type ? plannedSeed : null;
    };

    // Trận có đúng 1 bên là BYE
    const isByeObj = (mm) => {
      if (!mm) return false;
      const a =
        mm.seedA?.type === "bye" || /\bBYE\b/i.test(mm.seedA?.label || "");
      const b =
        mm.seedB?.type === "bye" || /\bBYE\b/i.test(mm.seedB?.label || "");
      return (a ? 1 : 0) + (b ? 1 : 0) === 1;
    };
    const SEED_REF_TYPES = [
      "matchWinner",
      "matchLoser",
      "stageMatchWinner",
      "stageMatchLoser",
    ];
    const isUseful = (v) => v && !/^(BYE|TBD|Registration)$/i.test(v);

    // Resolve tên đội ĐÚNG NHƯ SƠ ĐỒ (đệ quy có kiểm soát cho BYE-carry):
    const resolveName = (m, side, depth = 0) => {
      if (!m || depth > 12) return "";
      const pair = side === "A" ? m.pairA : m.pairB;
      if (hasResolvedPair(pair)) return pairLabel(pair, evType, displayMode);

      const rawSeed = side === "A" ? m.seedA : m.seedB;
      const plannedSeed = getPlannedSeed(m, side);
      const rawSeedType = String(rawSeed?.type || "");
      const isEmptyRegistrationSeed =
        rawSeedType === "registration" &&
        !rawSeed?.label &&
        !rawSeed?.ref?.registration &&
        !rawSeed?.ref?.reg &&
        !rawSeed?.ref?.id &&
        !rawSeed?.ref?._id;
      const seed =
        rawSeed?.type && !isEmptyRegistrationSeed
          ? rawSeed
          : plannedSeed || rawSeed;
      const seedType = String(seed?.type || "");
      const isLoser =
        seedType === "matchLoser" || seedType === "stageMatchLoser";

      // Tìm trận nguồn: previousA/B trước, rồi tới seed ref
      const prev = side === "A" ? m.previousA : m.previousB;
      let src = prev ? byId.get(String(prev._id || prev)) : null;
      if (!src && SEED_REF_TYPES.includes(seedType)) src = findSource(m, seed);

      if (src) {
        if (isByeObj(src)) {
          // Trận nguồn là BYE: gánh nhãn của bên KHÔNG bye (đệ quy)
          if (!isLoser) {
            const byeA =
              src.seedA?.type === "bye" ||
              /\bBYE\b/i.test(src.seedA?.label || "");
            const carried = resolveName(src, byeA ? "B" : "A", depth + 1);
            if (isUseful(carried)) return carried;
          }
        } else if (src.status === "finished" && src.winner) {
          const sourceSide = isLoser
            ? src.winner === "A"
              ? "B"
              : "A"
            : src.winner === "A"
              ? "A"
              : "B";
          const wp = sourceSide === "A" ? src.pairA : src.pairB;
          if (hasResolvedPair(wp)) return pairLabel(wp, evType, displayMode);
          const carried = resolveName(src, sourceSide, depth + 1);
          if (isUseful(carried)) return carried;
        }
      }
      if (src && SEED_REF_TYPES.includes(seedType)) {
        const sourceCode = matchCode(src);
        if (sourceCode && sourceCode !== "—") {
          return `${isLoser ? "L" : "W"}-${sourceCode}`;
        }
      }
      // Còn lại: seed / "W-V…" (resolver chung)
      const matchWithSeed = seed
        ? {
            ...m,
            [side === "A" ? "seedA" : "seedB"]: seed,
          }
        : m;
      return getMatchSideDisplayName(matchWithSeed, side, "");
    };

    return rawList.map((m) => {
      const sideA = resolveName(m, "A");
      const sideB = resolveName(m, "B");
      return {
        ...m,
        __sideA: sideA,
        __sideB: sideB,
        resolvedSideNameA: isConcreteTeamLabel(sideA)
          ? sideA
          : m?.resolvedSideNameA,
        resolvedSideNameB: isConcreteTeamLabel(sideB)
          ? sideB
          : m?.resolvedSideNameB,
      };
    });
  }, [brackets, matchPage, displayMode, tour?.eventType]);

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
    return hasUnassigned
      ? [t("tournaments.manage.unassignedCourt"), ...arr]
      : arr;
  }, [allMatchesBase, naturalCompare, t]);

  useEffect(() => {
    setCourtFilter((prev) => prev.filter((x) => courtOptions.includes(x)));
  }, [courtOptions]);

  // Viewer
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = useCallback(
    (mid) => setViewer({ open: true, matchId: mid }),
    [],
  );
  const closeMatch = useCallback(
    () => setViewer({ open: false, matchId: null }),
    [],
  );
  const [refereeViewer, setRefereeViewer] = useState({
    open: false,
    matchId: null,
    initialMatch: null,
  });
  const closeRefereeMatch = useCallback(
    () =>
      setRefereeViewer({
        open: false,
        matchId: null,
        initialMatch: null,
      }),
    [],
  );
  const openRefereeMatch = useCallback(
    (match) => {
      const matchId = normalizeEntityId(match);
      if (!matchId) return;
      setRefereeViewer({
        open: true,
        matchId,
        initialMatch: match || null,
      });
    },
    [],
  );
  const canStartRefereeMatch = useCallback(
    (match) => {
      const status = String(match?.status || "").toLowerCase();
      if (!match?._id || status === "finished") return false;
      return isAdmin || isUserRefereeOfMatch(match, me);
    },
    [isAdmin, me],
  );

  // Dialog gán video
  const [videoDlg, setVideoDlg] = useState({ open: false, match: null });
  const openVideoDlg = useCallback(
    (m) => setVideoDlg({ open: true, match: m }),
    [],
  );
  const deleteVideoDlg = useCallback(
    (m) => setVideoDlg({ open: true, match: { ...m, video: "" } }),
    [],
  );
  const closeVideoDlg = useCallback(
    () => setVideoDlg({ open: false, match: null }),
    [],
  );
  const onSaveVideo = useCallback(
    async (url) => {
      try {
        await setLiveUrl({
          matchId: videoDlg.match._id,
          video: url || "",
        }).unwrap();
        toast.success(
          url
            ? t("tournaments.manage.videoAssigned")
            : t("tournaments.manage.videoRemoved"),
        );
        closeVideoDlg();
      } catch (e) {
        toast.error(
          e?.data?.message || e?.error || "Không lưu được link video",
        );
      }
    },
    [setLiveUrl, videoDlg.match, closeVideoDlg, t],
  );

  // Court/Ref manager
  const [managerMgrOpen, setManagerMgrOpen] = useState(false);
  const [manageCourtClustersOpen, setManageCourtClustersOpen] = useState(false);
  const [refMgrOpen, setRefMgrOpen] = useState(false);
  const openManageCourts = useCallback(
    () => setManageCourtClustersOpen(true),
    [],
  );
  const closeManageCourts = useCallback(
    () => setManageCourtClustersOpen(false),
    [],
  );
  const handleCourtClustersUpdated = useCallback(() => {
    refetchMatches?.();
    refetchTour?.();
  }, [refetchMatches, refetchTour]);

  const [courtDlg, setCourtDlg] = useState({ open: false, match: null });
  const [refDlg, setRefDlg] = useState({ open: false, match: null });
  const openAssignCourt = useCallback(
    (m) => setCourtDlg({ open: true, match: m }),
    [],
  );
  const closeAssignCourt = useCallback(
    () => setCourtDlg({ open: false, match: null }),
    [],
  );
  const openAssignRef = useCallback(
    (m) => setRefDlg({ open: true, match: m }),
    [],
  );
  const closeAssignRef = useCallback(
    () => setRefDlg({ open: false, match: null }),
    [],
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
    [selectedMatchIds],
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
    [idOfRef],
  );

  const submitBatchAssign = useCallback(async () => {
    const ids = Array.from(selectedMatchIds);
    const refs = pickedRefs.map(idOfRef).filter(Boolean);
    if (!ids.length)
      return toast.info(t("tournaments.manage.noMatchesSelected"));
    if (!refs.length) {
      return toast.info(t("tournaments.manage.selectRefereesHint"));
    }
    try {
      await batchAssign({ ids, referees: refs }).unwrap();
      toast.success(
        t("tournaments.manage.bulkRefereeAssigned", { count: ids.length }),
      );
      setBulkDlgOpen(false);
      clearSelection();
      setPickedRefs([]);
      await refetchMatches?.();
    } catch (e) {
      toast.error(
        e?.data?.message || t("tournaments.manage.assignRefereesFailed"),
      );
    }
  }, [
    selectedMatchIds,
    pickedRefs,
    idOfRef,
    batchAssign,
    refetchMatches,
    clearSelection,
    t,
  ]);

  const submitBatchSetVideo = useCallback(
    async (urlParam) => {
      const ids = Array.from(selectedMatchIds);
      const url = (urlParam || "").trim();
      if (!ids.length)
        return toast.info(t("tournaments.manage.noMatchesSelected"));
      if (!url) return toast.info(t("tournaments.manage.enterValidVideoUrl"));
      try {
        await batchSetLiveUrl({ ids, video: url }).unwrap();
        toast.success(
          t("tournaments.manage.bulkVideoAssigned", { count: ids.length }),
        );
        setBulkVideoDlg({ open: false, url: "" });
        clearSelection();
        await refetchMatches?.();
      } catch (e) {
        toast.error(
          e?.data?.message || t("tournaments.manage.assignVideoFailed"),
        );
      }
    },
    [selectedMatchIds, batchSetLiveUrl, refetchMatches, clearSelection, t],
  );

  /* ====== Live store + realtime ====== */
  const liveStore = useMemo(() => createLiveStore(), []);
  const [orderVersion, setOrderVersion] = useState(0);
  const [isPending, startTransition] = useTransition();
  const viewerInitialMatch = useMemo(() => {
    void orderVersion;
    const matchId = String(viewer.matchId || "");
    if (!matchId) return null;
    const baseMatch =
      allMatchesBase.find((match) => String(match?._id || match?.id || "") === matchId) ||
      null;
    if (!baseMatch) return null;
    return { ...baseMatch, ...(liveStore.get(matchId) || {}) };
  }, [allMatchesBase, liveStore, orderVersion, viewer.matchId]);

  const handleExportRefNote = useCallback(
    (m) => {
      try {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        const html = buildRefReportHTML({
          tourName: tour?.name || "",
          code: matchCode(merged),
          court: courtLabel(merged),
          referee: refereeNames(merged),
          team1: teamLabel(merged, "A"),
          team2: teamLabel(merged, "B"),
          logoUrl: WEB_LOGO_URL,
        });
        const w = window.open("", "_blank");
        if (!w) {
          toast.error(
            "Trình duyệt chặn popup. Hãy cho phép cửa sổ bật lên để in.",
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
        toast.error(t("tournaments.manage.openRefereeReportFailed"));
      }
    },
    [liveStore, t, tour],
  );

  const getLiveStatus = useCallback(
    (m) => liveStore.get(String(m?._id))?.status ?? m?.status,
    [liveStore],
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
          m?.pool?.name || m?.pool?.id || m?.groupCode || "",
        ).trim();

        if (rawGroupCode) {
          // ✅ Chuẩn hóa: A→1, B→2,...
          const groupCode = normalizeGroupCode(rawGroupCode);
          const key = `${stage}_${groupCode}`;

          const live = liveStore.get(String(m._id)) || {};
          const st = String(live.status ?? m?.status ?? "").toLowerCase();
          const isDone = isByeMatch(m) || st === "finished";

          // console.log(`📋 Trận ${m.code}:`, {
          //   stage,
          //   rawGroupCode,
          //   normalizedGroupCode: groupCode, // ← thêm log này
          //   key,
          //   status: m?.status,
          //   isDone,
          // });

          if (!groupStatusMap.has(key)) {
            groupStatusMap.set(key, true);
          }
          if (!isDone) {
            groupStatusMap.set(key, false);
          }
        }
      }
    }

    // console.log("🎯 Group Status Map:", Array.from(groupStatusMap.entries()));

    // ✅ Chuyển sang boolean: done = (total === finished && total > 0)
    const groupDoneMap = new Map();
    for (const [key, stats] of groupStatusMap.entries()) {
      groupDoneMap.set(key, stats.total > 0 && stats.total === stats.finished);
    }

    // ✅ Hàm kiểm tra trận KO có thể hiện không
    const canShowKOMatch = (m, bracket) => {
      const bracketType = String(bracket?.type || "").toLowerCase();
      if (bracketType !== "knockout" && bracketType !== "ko") return true;

      // ✅ FIX: Lấy seed của TRẬN này, không phải của bracket!
      const seedA = m?.seedA;
      const seedB = m?.seedB;

      if (!seedA && !seedB) {
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
        }
      }

      // ✅ Check seed B
      if (seedB?.type === "groupRank") {
        const stage = seedB.ref?.stage || 1;
        const rawGroupCode = String(seedB.ref?.groupCode || "").trim();
        if (rawGroupCode) {
          const groupCode = normalizeGroupCode(rawGroupCode);
          sourceGroups.add(`${stage}_${groupCode}`);
        }
      }

      if (sourceGroups.size === 0) {
        return true;
      }

      for (const groupKey of sourceGroups) {
        const isFinished = groupStatusMap.get(groupKey);

        if (isFinished !== true) {
          return false;
        }
      }

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
            teamLabel(merged, "A"),
            teamLabel(merged, "B"),
            courtLabel(merged),
            merged?.status,
            merged?.video,
            scoreSummary(merged),
          ].join(" "),
        );
        if (!text.includes(kw)) continue;
      }

      // court filter (giữ nguyên code cũ)
      if (courtFilter.length) {
        const merged = { ...m, ...(liveStore.get(String(m._id)) || {}) };
        const lbl = courtLabel(merged);
        const isUn = lbl === "—";
        const matchByCourt =
          (isUn &&
            courtFilter.includes(t("tournaments.manage.unassignedCourt"))) ||
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
        : (a?.round ?? 0);
      const brd = Number.isFinite(b?.globalRound)
        ? b.globalRound
        : (b?.round ?? 0);
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
    liveStore,
    courtFilter,
    showBye,
    brackets,
    t,
  ]);

  // LIVE Setup — TOÀN GIẢI
  const [liveSetup, setLiveSetup] = useState({
    open: false,
    bracketId: null,
    bracketName: "",
  });
  const openLiveSetup = useCallback(
    () => setLiveSetup({ open: true, bracketId: null, bracketName: "" }),
    [],
  );
  const closeLiveSetup = useCallback(
    () => setLiveSetup((s) => ({ ...s, open: false })),
    [],
  );
  const handleAnalyzeRegistrationPoster = useCallback(async () => {
    if (!posterTemplateUrl) {
      toast.error("Bạn cần tải ảnh mẫu poster trước");
      return;
    }
    try {
      const result = await analyzeRegistrationPoster({
        id,
        save: true,
        fontFamily: posterNameFontFamily || undefined,
        extraPrompt: posterAiExtraPrompt.trim() || undefined,
      }).unwrap();
      if (result?.queued) {
        toast.info("AI poster đang chạy nền, bạn có thể tiếp tục thao tác.");
        refetchTour();
        return;
      }
      const confidence = Number(result?.analysis?.confidence || 0);
      const suffix = confidence
        ? ` (${Math.round(confidence * 100)}%)`
        : "";
      toast.success(`AI đã lưu layout poster${suffix}`);
      refetchTour();
    } catch (error) {
      toast.error(
        error?.data?.message ||
          error?.message ||
          "AI phân tích poster thất bại",
      );
    }
  }, [
    analyzeRegistrationPoster,
    id,
    posterAiExtraPrompt,
    posterNameFontFamily,
    posterTemplateUrl,
    refetchTour,
  ]);

  const handlePosterTemplateFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        toast.error("Chỉ hỗ trợ file ảnh poster");
        return;
      }

      try {
        await uploadRegistrationPosterTemplate({ id, file }).unwrap();
        toast.success("Đã tải ảnh mẫu poster");
        refetchTour();
      } catch (error) {
        toast.error(
          error?.data?.message ||
            error?.message ||
            "Không tải được ảnh mẫu poster",
        );
        return;
      }

      try {
        const result = await analyzeRegistrationPoster({
          id,
          save: true,
          fontFamily: posterNameFontFamily || undefined,
          extraPrompt: posterAiExtraPrompt.trim() || undefined,
        }).unwrap();
        if (result?.queued) {
          toast.info("Đã tải mẫu, AI poster đang chạy nền.");
          refetchTour();
          return;
        }
        const confidence = Number(result?.analysis?.confidence || 0);
        const suffix = confidence
          ? ` (${Math.round(confidence * 100)}%)`
          : "";
        toast.success(`AI đã lưu layout poster${suffix}`);
        refetchTour();
      } catch (error) {
        toast.error(
          error?.data?.message ||
            error?.message ||
            "Đã tải mẫu, nhưng AI phân tích poster thất bại",
        );
      }
    },
    [
      analyzeRegistrationPoster,
      id,
      posterAiExtraPrompt,
      posterNameFontFamily,
      refetchTour,
      uploadRegistrationPosterTemplate,
    ],
  );

  const handlePosterTemplateUrl = useCallback(
    async (rawUrl) => {
      const url = String(rawUrl || "").trim();
      if (!url) {
        toast.error("Bạn cần nhập link ảnh mẫu");
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        toast.error("Link ảnh phải bắt đầu bằng http:// hoặc https://");
        return;
      }

      try {
        await setPosterTemplateUrl({ id, url }).unwrap();
        toast.success("Đã dùng link làm ảnh mẫu poster");
        setPosterUrlDialogOpen(false);
        setPosterUrlInput("");
        refetchTour();
      } catch (error) {
        toast.error(
          error?.data?.message ||
            error?.message ||
            "Không dùng được link ảnh mẫu",
        );
        return;
      }

      try {
        const result = await analyzeRegistrationPoster({
          id,
          save: true,
          fontFamily: posterNameFontFamily || undefined,
          extraPrompt: posterAiExtraPrompt.trim() || undefined,
        }).unwrap();
        if (result?.queued) {
          toast.info("Đã dùng link, AI poster đang chạy nền.");
          refetchTour();
          return;
        }
        const confidence = Number(result?.analysis?.confidence || 0);
        const suffix = confidence ? ` (${Math.round(confidence * 100)}%)` : "";
        toast.success(`AI đã lưu layout poster${suffix}`);
        refetchTour();
      } catch (error) {
        toast.error(
          error?.data?.message ||
            error?.message ||
            "Đã dùng link, nhưng AI phân tích poster thất bại",
        );
      }
    },
    [
      analyzeRegistrationPoster,
      id,
      posterAiExtraPrompt,
      posterNameFontFamily,
      refetchTour,
      setPosterTemplateUrl,
    ],
  );

  const openPosterUrlDialog = useCallback(() => {
    setPosterUrlInput(
      /^https?:\/\//i.test(posterTemplateUrl) ? posterTemplateUrl : "",
    );
    setPosterUrlPreviewError(false);
    setPosterUrlDialogOpen(true);
  }, [posterTemplateUrl]);

  // Socket realtime
  const socket = useSocket();
  const matchRefetchTimer = useRef(null);
  const bracketRefetchTimer = useRef(null);
  const tournamentRoomIds = useMemo(() => (id ? [String(id)] : []), [id]);
  const tournamentIdsRef = useRef(new Set());
  useEffect(() => {
    tournamentIdsRef.current = new Set(tournamentRoomIds);
  }, [tournamentRoomIds]);

  useSocketRoomSet(socket, tournamentRoomIds, {
    subscribeEvent: "tournament:subscribe",
    unsubscribeEvent: "tournament:unsubscribe",
    payloadKey: "tournamentId",
    onResync: () => {
      scheduleBracketsRefetch();
      scheduleMatchesRefetch();
    },
  });

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
        String(payload?.matchId || payload?.id || payload?._id || payload?.data?._id || "") ||
        String(
          payload?.match?._id || payload?.match?.id || payload?.matchId || "",
        );
      if (!mid) return;

      const data = extractRealtimeMatchPayload(payload);
      const partial = pickRealtimeFields(data);
      if (Object.keys(partial).length === 0) return;

      const statusChanged = liveStore.set(mid, partial);
      if (statusChanged) {
        startTransition(() => setOrderVersion((v) => v + 1));
        // Khi 1 trận KẾT THÚC, đội thắng mới quyết định đội ở các trận sau.
        // Realtime không kèm `winner`, nên refetch danh sách (debounced) để
        // resolver hiển thị đúng đội — đồng bộ với sơ đồ/popup.
        if (String(partial.status || "").toLowerCase() === "finished") {
          scheduleMatchesRefetch();
        }
      }
    },
    [liveStore, startTransition, scheduleMatchesRefetch],
  );

  useEffect(() => {
    if (!socket) return;
    const onMatchSnapshot = (p) => applySnapshot(p);
    const onMatchUpdated = (p) => {
      applySnapshot(p);
    };
    const onInvalidate = (payload) => {
      const tournamentId = String(payload?.tournamentId || "").trim();
      if (tournamentId && !tournamentIdsRef.current.has(tournamentId)) {
        return;
      }
      scheduleBracketsRefetch();
      scheduleMatchesRefetch();
    };

    socket.on("tournament:match:update", onMatchSnapshot);
    socket.on("match:update", onMatchUpdated);
    socket.on("tournament:invalidate", onInvalidate);

    return () => {
      socket.off("tournament:match:update", onMatchSnapshot);
      socket.off("match:update", onMatchUpdated);
      socket.off("tournament:invalidate", onInvalidate);
      if (matchRefetchTimer.current) clearTimeout(matchRefetchTimer.current);
      if (bracketRefetchTimer.current)
        clearTimeout(bracketRefetchTimer.current);
    };
  }, [socket, applySnapshot, scheduleMatchesRefetch, scheduleBracketsRefetch]);

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
          teamLabel(merged, "A"),
          teamLabel(merged, "B"),
          courtLabel(merged),
          Number.isFinite(merged?.order) ? `T${merged.order + 1}` : "—",
          scoreSummary(merged),
        ];
      }),
    [liveStore],
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
      // pdfmake v0.2.x exports font files directly, v0.1.x uses pdfMake.vfs
      pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.default || pdfFonts;

      const data = buildExportPayload();
      const title = t("tournaments.manage.exportTitle", {
        name: tour?.name || t("tournaments.manage.fallbackName"),
      });
      const sub = t("tournaments.manage.exportSubtitle", {
        type: getTypeLabel(t, tab),
        time: formatDateTime(new Date(), locale),
      });

      const content = [
        { text: title, style: "title" },
        { text: sub, margin: [0, 2, 0, 10], style: "sub" },
      ];

      data.forEach((sec, idx) => {
        content.push({
          text: t("tournaments.manage.exportSectionTitle", {
            name: sec.bracket?.name || "Bracket",
            type: getTypeLabel(t, sec.bracket?.type),
          }),
          style: "h2",
          margin: [0, idx === 0 ? 0 : 8, 0, 6],
        });

        const tableBody = [
          [
            t("tournaments.manage.exportHeaders.matchCode"),
            t("tournaments.manage.exportHeaders.pairA"),
            t("tournaments.manage.exportHeaders.pairB"),
            t("tournaments.manage.exportHeaders.court"),
            t("tournaments.manage.exportHeaders.order"),
            t("tournaments.manage.exportHeaders.score"),
          ],
          ...sec.rows.map((r) =>
            r.map((cell) => (cell == null ? "" : String(cell))),
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
          text: t("tournaments.manage.exportPage", {
            current: currentPage,
            total: pageCount,
          }),
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
      toast.error(t("tournaments.manage.exportPdfFailed"));
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
          text: t("tournaments.manage.exportTitle", {
            name: tour?.name || t("tournaments.manage.fallbackName"),
          }),
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: t("tournaments.manage.exportSubtitle", {
                type: getTypeLabel(t, tab),
                time: formatDateTime(new Date(), locale),
              }),
              size: 18,
            }),
          ],
        }),
        new Paragraph({ text: "" }),
      );

      data.forEach((sec) => {
        sections.push(
          new Paragraph({
            text: t("tournaments.manage.exportSectionTitle", {
              name: sec.bracket?.name || "Bracket",
              type: getTypeLabel(t, sec.bracket?.type),
            }),
            heading: HeadingLevel.HEADING_2,
          }),
        );
        const head = [
          t("tournaments.manage.exportHeaders.matchCode"),
          t("tournaments.manage.exportHeaders.pairA"),
          t("tournaments.manage.exportHeaders.pairB"),
          t("tournaments.manage.exportHeaders.court"),
          t("tournaments.manage.exportHeaders.order"),
          t("tournaments.manage.exportHeaders.score"),
        ].map(
          (label) =>
            new TableCell({
              children: [new Paragraph({ text: label })],
            }),
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
                    }),
                ),
              }),
          ),
        ];
        sections.push(
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
          new Paragraph({ text: "" }),
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
      toast.error(t("tournaments.manage.exportWordFailed"));
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

  const visibleMatchCount = useMemo(
    () =>
      Array.from(groupedLists.values()).reduce(
        (sum, list) => sum + list.length,
        0,
      ),
    [groupedLists],
  );
  const currentTabLabel = useMemo(() => getTypeLabel(t, tab), [t, tab]);
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "tournament_manage",
      entityTitle:
        tour?.name ||
        t("tournaments.manage.seoTitle", {
          name: t("tournaments.manage.fallbackName"),
        }),
      sectionTitle: currentTabLabel,
      pageSummary:
        "Không gian quản lý giải hiện tại với lịch đấu, sân, trọng tài, live và video trận.",
      activeLabels: [
        currentTabLabel,
        canManageManagers ? "Có quyền quản trị" : "Có quyền quản lý",
        sortKey === "time"
          ? "Sắp theo thời gian"
          : sortKey === "order"
            ? "Sắp theo thứ tự"
            : "Sắp theo vòng",
        sortDir === "asc" ? "Tăng dần" : "Giảm dần",
        showBye ? "Hiện trận BYE" : "Ẩn trận BYE",
        q ? `Tìm: ${q}` : "",
        courtFilter.length
          ? `${courtFilter.length} bộ lọc sân`
          : "Tất cả sân",
      ],
      visibleActions: [
        "Phân công trọng tài",
        "Gán video",
        "Thiết lập live",
        "Xuất PDF",
        "Xuất Word",
      ],
      highlights: bracketsOfTab
        .slice(0, 4)
        .map((bracket) => {
          const count = groupedLists.get(String(bracket?._id || ""))?.length || 0;
          return `${bracket?.name || "Bracket"} (${count} trận)`;
        }),
      metrics: [
        `Tổng trận: ${allMatchesBase.length}`,
        `Đang hiển thị: ${visibleMatchCount}`,
        `Số bracket hiện tại: ${bracketsOfTab.length}`,
        `Đã chọn: ${selectedMatchIds.size}`,
        `Đã gắn video: ${
          allMatchesBase.filter((match) => Boolean(match?.video)).length
        }`,
      ],
    }),
    [
      tour?.name,
      t,
      currentTabLabel,
      canManageManagers,
      sortKey,
      sortDir,
      showBye,
      q,
      courtFilter,
      bracketsOfTab,
      groupedLists,
      allMatchesBase,
      visibleMatchCount,
      selectedMatchIds.size,
    ],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      search: (nextValue) => {
        setQ(String(nextValue || ""));
      },
      tab: (nextValue) => {
        setTab(String(nextValue || typesAvailable[0]?.type || "group"));
      },
      sortKey: (nextValue) => {
        setSortKey(String(nextValue || "round"));
      },
      sortDir: (nextValue) => {
        setSortDir(String(nextValue || "asc"));
      },
      showBye: (nextValue) => {
        setShowBye(Boolean(nextValue));
      },
      courtFilter: (nextValue) => {
        const nextValues = Array.isArray(nextValue)
          ? nextValue
          : String(nextValue || "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
        setCourtFilter(nextValues);
      },
    }),
    [typesAvailable],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: ["set_page_state", "prefill_text", "focus_element", "navigate"],
    actionHandlers: chatBotActionHandlers,
  });

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
            t("tournaments.manage.loadError")}
        </Alert>
      </Box>
    );
  }
  if (!canManage) {
    return (
      <Box p={3}>
        <Alert severity="warning">{t("tournaments.manage.noAccess")}</Alert>
        <Button component={Link} to={`/tournament/${id}`} sx={{ mt: 2 }}>
          {t("tournaments.manage.backToTournament")}
        </Button>
      </Box>
    );
  }

  if (String(tour?.tournamentMode || "").toLowerCase() === "team") {
    return (
      <TeamTournamentManageView
        tournamentId={id}
        tour={tour}
        canManage={canManage}
      />
    );
  }

  /* ---------- UI ---------- */
  return (
    <Box p={{ xs: 2, md: 3 }}>
      <SEOHead
        title={t("tournaments.manage.seoTitle", {
          name: tour?.name || t("tournaments.manage.fallbackName"),
        })}
        noIndex={true}
      />
      <input
        ref={posterTemplateInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(event) => {
          handlePosterTemplateFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <Dialog
        open={posterUrlDialogOpen}
        onClose={() => {
          if (!settingPosterUrl) setPosterUrlDialogOpen(false);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Dùng link ảnh làm mẫu poster</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Link ảnh mẫu (URL)"
              placeholder="https://..."
              value={posterUrlInput}
              onChange={(event) => {
                setPosterUrlInput(event.target.value);
                setPosterUrlPreviewError(false);
              }}
              disabled={settingPosterUrl}
            />
            <Typography variant="caption" color="text.secondary">
              Dán link ảnh trực tiếp (jpg/png/webp…). Ảnh sẽ được dùng làm mẫu và
              AI tự phân tích layout.
            </Typography>

            {/^https?:\/\//i.test(posterUrlInput.trim()) ? (
              <Box
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  minHeight: 160,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  p: 1,
                }}
              >
                {posterUrlPreviewError ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ p: 2, textAlign: "center" }}
                  >
                    Không xem trước được ảnh (có thể do trang chặn hotlink). Bạn
                    vẫn có thể thử bấm “Dùng link” — hệ thống sẽ tự kiểm tra.
                  </Typography>
                ) : (
                  <Box
                    component="img"
                    src={posterUrlInput.trim()}
                    alt="Xem trước ảnh mẫu"
                    onError={() => setPosterUrlPreviewError(true)}
                    sx={{
                      maxWidth: "100%",
                      maxHeight: 320,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                )}
              </Box>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPosterUrlDialogOpen(false)}
            disabled={settingPosterUrl}
          >
            Hủy
          </Button>
          <Button
            variant="contained"
            startIcon={
              settingPosterUrl ? (
                <CircularProgress size={16} />
              ) : (
                <InsertLinkIcon />
              )
            }
            onClick={() => handlePosterTemplateUrl(posterUrlInput)}
            disabled={
              settingPosterUrl ||
              !/^https?:\/\//i.test(posterUrlInput.trim())
            }
          >
            Dùng link &amp; chạy AI
          </Button>
        </DialogActions>
      </Dialog>
      {/* Header */}
      <Stack spacing={1.5} mb={2}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
          sx={{ gap: 1 }}
        >
          <Typography variant="h5" noWrap>
            {t("tournaments.manage.pageTitle", {
              name: tour?.name || t("tournaments.manage.fallbackName"),
            })}
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
            {canManageManagers ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<ManagersIcon />}
                onClick={() => setManagerMgrOpen(true)}
              >
                {t("tournaments.manage.manageManagers")}
              </Button>
            ) : null}

            <Button
              variant="outlined"
              size="small"
              startIcon={<RefereeIcon />}
              onClick={() => setRefMgrOpen(true)}
            >
              {t("tournaments.manage.manageReferees")}
            </Button>

            {/* Quản lý sân TOÀN GIẢI */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<StadiumIcon />}
              onClick={() => openManageCourts()}
            >
              {t("tournaments.manage.manageCourts")}
            </Button>

            {/* Thiết lập LIVE TOÀN GIẢI */}
            <Tooltip title={t("tournaments.manage.liveSetupAllHint")} arrow>
              <Button
                variant="outlined"
                size="small"
                startIcon={<MovieIcon />}
                onClick={openLiveSetup}
              >
                {t("tournaments.manage.liveSetup")}
              </Button>
            </Tooltip>

            <Box
              onDragOver={(event) => {
                event.preventDefault();
                if (!posterTemplateBusy) setPosterTemplateDragging(true);
              }}
              onDragLeave={() => setPosterTemplateDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setPosterTemplateDragging(false);
                if (!posterTemplateBusy) {
                  handlePosterTemplateFile(event.dataTransfer.files?.[0]);
                }
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1,
                py: 0.5,
                minHeight: 40,
                border: "1px dashed",
                borderColor: posterTemplateDragging
                  ? "primary.main"
                  : "divider",
                borderRadius: 1,
                bgcolor: posterTemplateDragging
                  ? "action.hover"
                  : "transparent",
              }}
            >
              <Button
                variant={posterTemplateUrl ? "outlined" : "contained"}
                size="small"
                startIcon={
                  uploadingPosterTemplate ? (
                    <CircularProgress size={16} />
                  ) : (
                    <CloudUploadIcon />
                  )
                }
                onClick={() => posterTemplateInputRef.current?.click()}
                disabled={posterTemplateBusy}
              >
                {posterTemplateUrl ? "Đổi mẫu poster" : "Tải mẫu poster"}
              </Button>
              <Tooltip title="Dùng link ảnh làm mẫu poster">
                <span>
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<InsertLinkIcon />}
                    onClick={openPosterUrlDialog}
                    disabled={posterTemplateBusy}
                  >
                    Dán link
                  </Button>
                </span>
              </Tooltip>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { md: "none", lg: "block" } }}
              >
                Kéo thả ảnh mẫu
              </Typography>
              {posterTemplateUrl ? (
                <Chip size="small" color="success" label="Đã có mẫu" />
              ) : null}
              {posterAiRunning ? (
                <Chip size="small" color="warning" label="AI đang chạy" />
              ) : posterAiStale ? (
                <Tooltip title="Job AI poster chạy quá lâu, bạn có thể bấm chạy lại">
                  <Chip size="small" color="error" label="AI kẹt" />
                </Tooltip>
              ) : posterAiJob?.status === "failed" ? (
                <Tooltip title={posterAiJob?.error || "AI poster thất bại"}>
                  <Chip size="small" color="error" label="AI lỗi" />
                </Tooltip>
              ) : null}
            </Box>

            <TextField
              select
              size="small"
              label="Font tên"
              value={posterNameFontFamily}
              onChange={(event) => setPosterNameFontFamily(event.target.value)}
              disabled={!canManage || posterTemplateBusy}
              sx={{ minWidth: 150 }}
            >
              {POSTER_NAME_FONT_OPTIONS.map((option) => (
                <MenuItem key={option.value || "ai"} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              label="Prompt bổ sung"
              placeholder="VD: thay đúng chữ HỌ TÊN, giữ nguyên VĐV"
              value={posterAiExtraPrompt}
              onChange={(event) => setPosterAiExtraPrompt(event.target.value)}
              disabled={!canManage || posterTemplateBusy}
              inputProps={{ maxLength: 1200 }}
              sx={{ minWidth: 260, maxWidth: 360 }}
            />

            <Button
              variant="outlined"
              size="small"
              startIcon={
                analyzingPoster ? (
                  <CircularProgress size={16} />
                ) : (
                  <AutoAwesomeIcon />
                )
              }
              onClick={handleAnalyzeRegistrationPoster}
              disabled={!canManage || posterTemplateBusy}
            >
              {posterAiRunning || posterAiStale ? "Chạy lại AI" : "AI poster"}
            </Button>

            {/* Export menu (desktop) */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={openExportMenu}
              disabled={exporting || bracketsOfTab.length === 0}
            >
              {t("tournaments.manage.exportFiles")}
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
                  primary={
                    exporting
                      ? t("tournaments.manage.exportPdfLoading")
                      : t("tournaments.manage.exportPdf")
                  }
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
                  primary={
                    exporting
                      ? t("tournaments.manage.exportWordLoading")
                      : t("tournaments.manage.exportWord")
                  }
                />
              </MenuItem>
            </Menu>

            <Button
              component={Link}
              to={`/tournament/${id}`}
              variant="outlined"
              size="small"
            >
              {t("tournaments.manage.overview")}
            </Button>
            {canOpenRefereeCenter ? (
              <Button
                component={Link}
                to={`/tournament/${id}/referee`}
                variant="contained"
                size="small"
                color="warning"
                startIcon={<SportsIcon />}
              >
                Trọng tài
              </Button>
            ) : null}
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
                {t("tournaments.manage.actions")}
              </Button>
              <Menu
                anchorEl={actionAnchor}
                open={Boolean(actionAnchor)}
                onClose={closeActionMenu}
                keepMounted
              >
                {canManageManagers ? (
                  <MenuItem
                    onClick={() => {
                      closeActionMenu();
                      setManagerMgrOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <ManagersIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={t("tournaments.manage.manageManagers")}
                    />
                  </MenuItem>
                ) : null}

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    setRefMgrOpen(true);
                  }}
                >
                  <ListItemIcon>
                    <RefereeIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={t("tournaments.manage.manageReferees")}
                  />
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
                  <ListItemText
                    primary={t("tournaments.manage.manageCourts")}
                  />
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
                  <ListItemText primary={t("tournaments.manage.liveSetup")} />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    posterTemplateInputRef.current?.click();
                  }}
                  disabled={posterTemplateBusy}
                >
                  <ListItemIcon>
                    {uploadingPosterTemplate ? (
                      <CircularProgress size={18} />
                    ) : (
                      <CloudUploadIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      posterTemplateUrl ? "Đổi mẫu poster" : "Tải mẫu poster"
                    }
                  />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    openPosterUrlDialog();
                  }}
                  disabled={posterTemplateBusy}
                >
                  <ListItemIcon>
                    <InsertLinkIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Dán link ảnh mẫu" />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    handleAnalyzeRegistrationPoster();
                  }}
                  disabled={!canManage || posterTemplateBusy}
                >
                  <ListItemIcon>
                    {analyzingPoster ? (
                      <CircularProgress size={18} />
                    ) : (
                      <AutoAwesomeIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      posterAiRunning || posterAiStale
                        ? "Chạy lại AI"
                        : "AI poster"
                    }
                  />
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
                    primary={
                      exporting
                        ? t("tournaments.manage.exportPdfLoading")
                        : t("tournaments.manage.exportPdf")
                    }
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
                      exporting
                        ? t("tournaments.manage.exportWordLoading")
                        : t("tournaments.manage.exportWord")
                    }
                  />
                </MenuItem>

                <Divider />

                {canOpenRefereeCenter ? (
                  <MenuItem
                    component={Link}
                    to={`/tournament/${id}/referee`}
                    onClick={closeActionMenu}
                  >
                    <ListItemIcon>
                      <SportsIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary="Trọng tài" />
                  </MenuItem>
                ) : null}

                <MenuItem
                  component={Link}
                  to={`/tournament/${id}`}
                  onClick={closeActionMenu}
                >
                  <ListItemText
                    primary={t("tournaments.manage.tournamentPage")}
                  />
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
              placeholder={t("tournaments.manage.searchPlaceholder")}
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
              label={t("tournaments.manage.sortLabel")}
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
              <MenuItem value="round">
                {t("tournaments.manage.sortRound")}
              </MenuItem>
              <MenuItem value="order">
                {t("tournaments.manage.sortOrder")}
              </MenuItem>
              <MenuItem value="time">
                {t("tournaments.manage.sortTime")}
              </MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label={t("tournaments.manage.directionLabel")}
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value)}
            >
              <MenuItem value="asc">
                {t("tournaments.manage.directionAsc")}
              </MenuItem>
              <MenuItem value="desc">
                {t("tournaments.manage.directionDesc")}
              </MenuItem>
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
                <TextField
                  {...params}
                  label={t("tournaments.manage.courtFilterLabel")}
                  placeholder={t("tournaments.manage.courtFilterPlaceholder")}
                />
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
              label={t("tournaments.manage.showBye")}
            />

            <Stack
              direction="row"
              justifyContent={{ xs: "flex-start", md: "flex-end" }}
            >
              <Chip
                size="small"
                variant="outlined"
                label={t("tournaments.manage.bracketSummary", {
                  count: bracketsOfTab.length,
                  type: getTypeLabel(t, tab),
                })}
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
            {typesAvailable.map((typeItem) => (
              <Tab
                key={typeItem.type}
                label={getTypeLabel(t, typeItem.type)}
                value={typeItem.type}
              />
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
                  label={t("tournaments.manage.selectedMatches", {
                    count: selectedMatchIds.size,
                  })}
                />
                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<RefereeIcon />}
                  onClick={() => setBulkDlgOpen(true)}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {t("tournaments.manage.assignReferees")}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<MovieIcon />}
                  onClick={() => setBulkVideoDlg({ open: true, url: "" })}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {t("tournaments.manage.assignVideo")}
                </Button>
                <Button
                  size="small"
                  onClick={clearSelection}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {t("tournaments.manage.clearSelection")}
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
                      label={t("tournaments.manage.selectedMatches", {
                        count: selectedMatchIds.size,
                      })}
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
                      {t("tournaments.manage.assignReferees")}
                    </Button>
                    <Button
                      variant="outlined"
                      fullWidth
                      startIcon={<MovieIcon />}
                      onClick={() => setBulkVideoDlg({ open: true, url: "" })}
                    >
                      {t("tournaments.manage.assignVideo")}
                    </Button>
                    <Button fullWidth onClick={clearSelection}>
                      {t("tournaments.manage.clearSelection")}
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
          {t("tournaments.manage.emptyType", { type: getTypeLabel(t, tab) })}
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
                    label={getTypeLabel(t, b?.type)}
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
                                selectedMatchIds.has(String(m._id)),
                              )
                            }
                            onChange={(e) =>
                              toggleSelectAllIn(list, e.target.checked)
                            }
                          />
                        </TableCell>
                        <TableCell sx={{ width: 100 }}>
                          {t("tournaments.manage.exportHeaders.matchCode")}
                        </TableCell>
                        <TableCell sx={{ width: 220 }}>
                          {t("tournaments.manage.exportHeaders.pairA")}
                        </TableCell>
                        <TableCell sx={{ width: 220 }}>
                          {t("tournaments.manage.exportHeaders.pairB")}
                        </TableCell>
                        <TableCell sx={{ width: 96 }}>
                          {t("tournaments.manage.exportHeaders.court")}
                        </TableCell>
                        <TableCell sx={{ width: 68 }}>Thứ tự</TableCell>
                        <TableCell sx={{ width: 110 }}>
                          {t("tournaments.manage.exportHeaders.score")}
                        </TableCell>
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
                              eventType={tour?.eventType || "double"}
                              displayMode={displayMode}
                              canStartReferee={canStartRefereeMatch(m)}
                              onRowClick={(mid) => openMatch(mid)}
                              onOpenVideo={openVideoDlg}
                              onDeleteVideo={deleteVideoDlg}
                              onAssignCourt={openAssignCourt}
                              onAssignRef={openAssignRef}
                              onExportRefNote={handleExportRefNote}
                              onStartReferee={openRefereeMatch}
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
                        <Grid key={k} item size={{ xs: 12 }}>
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
                              selectedMatchIds.has(String(m._id)),
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
                              selectedMatchIds.has(String(m._id)),
                            ).length
                          } đã chọn`}
                        />
                      </Stack>

                      <Grid container spacing={1.2}>
                        {list.map((m) => (
                          <Grid key={m._id} item size={{ xs: 12, sm: 6 }}>
                            <MatchCard
                              match={m}
                              liveStore={liveStore}
                              eventType={tour?.eventType || "double"}
                              displayMode={displayMode}
                              canStartReferee={canStartRefereeMatch(m)}
                              onCardClick={(mid) => openMatch(mid)}
                              onOpenVideo={openVideoDlg}
                              onDeleteVideo={deleteVideoDlg}
                              onAssignCourt={openAssignCourt}
                              onAssignRef={openAssignRef}
                              onExportRefNote={handleExportRefNote}
                              onStartReferee={openRefereeMatch}
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

      <AssignCourtStationDialog
        open={courtDlg.open}
        match={courtDlg.match}
        tournamentId={id}
        allowedClusters={tour?.allowedCourtClusters || []}
        canOverride={isAdmin}
        onClose={closeAssignCourt}
        onAssigned={() => {
          refetchMatches?.();
          refetchTour?.();
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

      <TournamentCourtClusterDialog
        open={manageCourtClustersOpen}
        onClose={closeManageCourts}
        tournament={tour}
        canOverride={isAdmin}
        onUpdated={handleCourtClustersUpdated}
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

      <TournamentManagersDialog
        open={managerMgrOpen}
        tournamentId={id}
        onClose={() => setManagerMgrOpen(false)}
        onChanged={() => {
          refetchTour?.();
        }}
      />

      {/* Thiết lập LIVE TOÀN GIẢI */}
      <LiveSetupDialog
        open={liveSetup.open}
        onClose={closeLiveSetup}
        tournamentId={id}
        bracketId={liveSetup.bracketId}
        allowedClusters={tour?.allowedCourtClusters || []}
      />

      {/* Popup xem/tracking trận */}
      <ResponsiveMatchViewer
        open={viewer.open}
        matchId={viewer.matchId}
        initialMatch={viewerInitialMatch}
        onClose={closeMatch}
      />
      <RefereeScoreDialog
        open={refereeViewer.open}
        matchId={refereeViewer.matchId}
        initialMatch={refereeViewer.initialMatch}
        onClose={closeRefereeMatch}
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
      <BulkVideoDialogLocalized
        open={bulkVideoDlg.open}
        selectedCount={selectedMatchIds.size}
        busy={batchingVideo}
        onClose={() => setBulkVideoDlg({ open: false, url: "" })}
        onSubmit={submitBatchSetVideo}
      />
    </Box>
  );
}
