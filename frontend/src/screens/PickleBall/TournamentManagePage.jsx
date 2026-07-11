// src/pages/admin/parts/TournamentManagePage.jsx
/* eslint-disable react/prop-types, no-unused-vars, no-empty */
import pdfMakeLib from "pdfmake/build/pdfmake";
import * as pdfFontsLib from "pdfmake/build/vfs_fonts";
import * as docxLib from "docx";
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
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
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
  Switch,
  List,
  ListItemButton,
} from "@mui/material";
import {
  Close as CloseIcon,
  OpenInNew as OpenInNewIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sort as SortIcon,
  Sports as SportsIcon,
  FileDownload as FileDownloadIcon,
  PictureAsPdf as PictureAsPdfIcon,
  Description as DescriptionIcon,
  Group as ManagersIcon,
  Stadium as StadiumIcon,
  HowToReg as RefereeIcon,
  SportsScore as ScoreboardIcon,
  Movie as MovieIcon,
  LiveTv as LiveMonitorIcon,
  Print as PrintIcon,
  AutoAwesome as AutoAwesomeIcon,
  CloudUpload as CloudUploadIcon,
  InsertLink as InsertLinkIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  tournamentsApiSlice,
  useGetTournamentQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
  useAdminSetMatchLiveUrlMutation,
  useAdminBatchSetMatchLiveUrlMutation,
  useVerifyRefereeQuery,
  useAnalyzeRegistrationPosterMutation,
  useUploadRegistrationPosterTemplateMutation,
  useSetRegistrationPosterTemplateUrlMutation,
  useUpdateOverlayMutation,
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
import TournamentCourtLiveMonitorDialog from "../../components/TournamentCourtLiveMonitorDialog";
import BulkAssignRefDialog from "../../components/BulkAssignRefDialog";
import TeamTournamentManageView from "../../components/teamTournament/TeamTournamentManageView";
import SEOHead from "../../components/SEOHead";
import RefereeScoreDialog from "../../components/referee/RefereeScoreDialog";
import OverlayWidgetsPanel from "../../components/overlay/OverlayWidgetsPanel";
import {
  ActionChipsLocalized,
  BulkVideoDialogLocalized,
  MatchCard,
  MatchCardSkeleton,
  MatchDesktopRows,
  MatchListSectionBlock,
  MatchListSectionRow,
  MatchStatusDialog,
  TableSkeletonRows,
} from "./components/TournamentManageParts";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";
import { formatDateTime } from "../../i18n/format";
import {
  getTournamentNameDisplayMode,
  getTournamentPairName,
} from "../../utils/tournamentName";
import {
  getMatchSideDisplayName,
  isNewerOrEqualMatchPayload,
  mergeMatchPayload,
  normalizeMatchDisplay,
} from "../../utils/matchDisplay";

const POSTER_NAME_FONT_OPTIONS = [
  { value: "", label: "Mặc định AI" },
  { value: "FreeSans, Arial, sans-serif", label: "FreeSans" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Arial Black, Arial, sans-serif", label: "Arial Black" },
  { value: "Impact, Arial Black, sans-serif", label: "Impact" },
  { value: "Montserrat, Arial, sans-serif", label: "Montserrat" },
];
const POSTER_AI_RUNNING_TIMEOUT_MS = 10 * 60 * 1000;
const MANAGE_UI_VERSION_STORAGE_KEY = "pickletour.manage.uiVersion";
const OVERLAY_NAME_STYLE_OPTIONS = [
  {
    value: "1",
    label: "1 - Tự động",
    helper: "App tự cân chữ, giảm font và viết tắt khi tên quá dài.",
  },
  {
    value: "2",
    label: "2 - Giữ nguyên",
    helper: "Không viết hoa, ưu tiên giữ nguyên tên và chỉ co chữ.",
  },
  {
    value: "3",
    label: "3 - Gọn họ",
    helper: "Ví dụ Nguyễn Văn An thành N Văn An khi cần.",
  },
  {
    value: "4",
    label: "4 - Gọn tối đa",
    helper: "Rút gọn mạnh hơn cho tên rất dài.",
  },
];

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

const statusChipLocalized = (t, status, onClick) => {
  const meta = getManageStatusMeta(t, status);
  const rawStatus = String(status || "").toLowerCase();
  const clickableProps = onClick ? { onClick, clickable: true } : {};
  const clickableSx = onClick ? { cursor: "pointer" } : {};

  if (["live", "ongoing", "playing", "inprogress"].includes(rawStatus)) {
    return (
      <Chip
        size="small"
        label={meta.label}
        sx={{
          bgcolor: "#f57c00",
          color: "#fff",
          fontWeight: 600,
          ...clickableSx,
        }}
        {...clickableProps}
      />
    );
  }
  if (rawStatus === "assigned") {
    return (
      <Chip
        size="small"
        label={meta.label}
        sx={{
          bgcolor: "#fbc02d",
          color: "#000",
          fontWeight: 600,
          ...clickableSx,
        }}
        {...clickableProps}
      />
    );
  }

  return (
    <Chip
      size="small"
      color={meta.color}
      label={meta.label}
      sx={clickableSx}
      {...clickableProps}
    />
  );
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

const isByeLabel = (value) => {
  const label = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return label === "bye";
};

const isByeSeed = (seed) => seed?.type === "bye" || isByeLabel(seed?.label);

const isByePair = (pair) =>
  isByeLabel(pair?.name) ||
  isByeLabel(pair?.teamName) ||
  isByeLabel(pair?.label) ||
  isByeLabel(pair?.displayName);

/** Trận BYE: chỉ khi seed/cặp/nhãn đội thật sự là BYE. */
const isByeMatch = (m) => {
  if (!m) return false;
  return Boolean(
    m?.isBye ||
      m?.bye ||
      isByeSeed(m?.seedA) ||
      isByeSeed(m?.seedB) ||
      isByePair(m?.pairA) ||
      isByePair(m?.pairB) ||
      isByeLabel(m?.__sideA) ||
      isByeLabel(m?.__sideB) ||
      isByeLabel(m?.resolvedSideNameA) ||
      isByeLabel(m?.resolvedSideNameB) ||
      isByeLabel(m?.teamAName) ||
      isByeLabel(m?.teamBName),
  );
};

const isManageFinishedMatch = (m, status) => {
  const matchStatus = String(status ?? m?.status ?? "").toLowerCase();
  return matchStatus === "finished" || isByeMatch(m);
};

const manageDisplayStatus = (m, status) =>
  isManageFinishedMatch(m, status) ? "finished" : (status ?? m?.status);

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

const detailValue = (value) => {
  const output = String(value ?? "").trim();
  return output || "—";
};

const formatOptionalDateTime = (value, locale) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDateTime(date, locale);
};

const liveLogEntries = (match) =>
  Array.isArray(match?.liveEvents)
    ? match.liveEvents
    : Array.isArray(match?.liveLog)
      ? match.liveLog
      : [];

const LIVE_ACTION_CACHE_LIMIT = 12;

const trimLiveActionCache = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  let next = snapshot;
  ["liveEvents", "liveLog"].forEach((key) => {
    if (
      Array.isArray(next?.[key]) &&
      next[key].length > LIVE_ACTION_CACHE_LIMIT
    ) {
      if (next === snapshot) next = { ...snapshot };
      next[key] = next[key].slice(-LIVE_ACTION_CACHE_LIMIT);
    }
  });
  return next;
};

const findLiveLogEntry = (match, types, { fromEnd = false } = {}) => {
  const typeSet = new Set(types.map((type) => String(type).toLowerCase()));
  const entries = liveLogEntries(match);

  if (fromEnd) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (typeSet.has(String(entry?.type || "").toLowerCase())) return entry;
    }
    return null;
  }

  for (const entry of entries) {
    if (typeSet.has(String(entry?.type || "").toLowerCase())) return entry;
  }
  return null;
};

const liveActorName = (actor) => {
  if (!actor || typeof actor !== "object") return "";
  const name = personNickname(actor);
  return name && name !== "\u2014" ? name : "";
};

const matchStartedAt = (match) =>
  match?.startedAt || findLiveLogEntry(match, ["start"])?.at || "";

const matchFinishedAt = (match) =>
  match?.finishedAt ||
  findLiveLogEntry(match, ["finish", "forfeit"], { fromEnd: true })?.at ||
  "";

const matchStarterName = (match) => {
  const startEntry = findLiveLogEntry(match, ["start"]);
  const status = String(match?.status || "").toLowerCase();
  const liveByCanRepresentStart =
    status === "live" && Boolean(match?.startedAt || startEntry?.at);
  return (
    liveActorName(startEntry?.by) ||
    liveActorName(match?.startedBy) ||
    liveActorName(match?.startBy) ||
    (liveByCanRepresentStart ? liveActorName(match?.liveBy) : "") ||
    refereeNames(match)
  );
};

const statusWinnerLabel = (match) => {
  const winner = String(match?.winner || "").toUpperCase();
  if (winner === "A") return teamLabel(match, "A");
  if (winner === "B") return teamLabel(match, "B");
  return "—";
};

const dashboardGameIndexOf = (match) => {
  const index = Number(match?.currentGame ?? match?.gameIndex ?? 0);
  return Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
};

const dashboardCurrentGameScore = (match) => {
  const list =
    (Array.isArray(match?.gameScores) && match.gameScores) ||
    (Array.isArray(match?.scores) && match.scores) ||
    [];
  return _normGame(list[dashboardGameIndexOf(match)]) || { a: 0, b: 0 };
};

const liveActionLabel = (entry, match) => {
  const type = String(entry?.type || entry?.event || "").toLowerCase();
  const payload = entry?.payload || entry?.data || {};
  if (type === "point") {
    const side = String(payload?.team || entry?.team || "").toUpperCase();
    return side === "A" || side === "B"
      ? `Cộng điểm ${teamLabel(match, side)}`
      : "Cộng điểm";
  }
  if (type === "serve") return "Đổi giao";
  if (type === "slots") return "Đổi tay / vị trí";
  if (type === "start") return "Bắt đầu trận";
  if (type === "undo") return "Hoàn tác";
  if (type === "finish") return "Kết thúc trận";
  if (type === "forfeit") return "Xử thua";
  if (type === "break") return "Tạm dừng";
  if (type === "court") return "Cập nhật sân";
  if (type === "rules") return "Cập nhật luật";
  return entry?.label || entry?.message || "Cập nhật";
};

const compactTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const recentLiveActions = (match, limit = 3) => {
  const entries = liveLogEntries(match);
  const actions = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const label = liveActionLabel(entry, match);
    const actor =
      liveActorName(entry?.by) ||
      liveActorName(entry?.actor) ||
      liveActorName(entry?.user) ||
      "";
    actions.push({
      label,
      actor,
      time: compactTime(entry?.at || entry?.createdAt || entry?.time),
    });
    if (actions.length >= limit) break;
  }
  return actions;
};

const serveLabel = (match) => {
  const side = String(match?.serve?.side || "").toUpperCase();
  const server = Number(match?.serve?.order ?? match?.serve?.server ?? 0);
  if (side !== "A" && side !== "B") return "—";
  return `${teamLabel(match, side)}${server ? ` · tay ${server}` : ""}`;
};

const RefereeLiveDashboardRow = React.memo(function RefereeLiveDashboardRow({
  match,
  liveStore,
  onOpenRefereeMatch,
}) {
  const live = useLiveMatch(liveStore, match?._id || match?.id);
  const merged = live ? { ...match, ...live } : match;
  const currentGame = dashboardCurrentGameScore(merged);
  const actions = recentLiveActions(merged, 3);

  return (
    <TableRow hover sx={{ "& td": { py: 1, verticalAlign: "top" } }}>
      <TableCell sx={{ minWidth: 112, fontWeight: 800 }}>
        {matchCode(merged)}
      </TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <Stack spacing={0.4}>
          <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>
            {teamLabel(merged, "A")}
          </Typography>
          <Typography sx={{ color: "text.secondary", fontSize: 12 }}>vs</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>
            {teamLabel(merged, "B")}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 104 }}>
        <Stack spacing={0.5}>
          <Typography sx={{ fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>
            {currentGame.a} - {currentGame.b}
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            {scoreSummary(merged)}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell sx={{ minWidth: 180 }}>{serveLabel(merged)}</TableCell>
      <TableCell sx={{ minWidth: 150 }}>{courtLabel(merged)}</TableCell>
      <TableCell sx={{ minWidth: 180 }}>
        {refereeNames(merged) || matchStarterName(merged) || "—"}
      </TableCell>
      <TableCell sx={{ minWidth: 240 }}>
        {actions.length ? (
          <Stack spacing={0.55}>
            {actions.map((action, index) => (
              <Box key={`${action.time || "action"}-${index}`}>
                <Typography sx={{ fontWeight: index === 0 ? 800 : 600, fontSize: 13 }}>
                  {action.label}
                </Typography>
                <Typography sx={{ color: "text.secondary", fontSize: 12 }}>
                  {[action.time, action.actor].filter(Boolean).join(" · ") || "—"}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography sx={{ color: "text.secondary", fontSize: 13 }}>
            Chưa có thao tác
          </Typography>
        )}
      </TableCell>
      <TableCell align="right" sx={{ minWidth: 126 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => onOpenRefereeMatch?.(merged)}
          sx={{ whiteSpace: "nowrap" }}
        >
          Mở chấm
        </Button>
      </TableCell>
    </TableRow>
  );
});

const RefereeLiveDashboardDialog = React.memo(function RefereeLiveDashboardDialog({
  open,
  onClose,
  matches,
  liveStore,
  onOpenRefereeMatch,
}) {
  const refereeCount = useMemo(() => {
    const names = new Set();
    matches.forEach((match) => {
      refereeNames(match)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
    });
    return names.size;
  }, [matches]);

  const courtCount = useMemo(() => {
    const courts = new Set();
    matches.forEach((match) => {
      const label = courtLabel(match);
      if (label && label !== "—") courts.add(label);
    });
    return courts.size;
  }, [matches]);

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <DialogTitle sx={{ py: 1.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.2}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <ScoreboardIcon color="primary" />
            <Box>
              <Typography sx={{ fontWeight: 900, fontSize: 20 }}>
                Quản lý toàn bộ chấm trận
              </Typography>
              <Typography sx={{ color: "text.secondary", fontSize: 13 }}>
                Theo dõi các trận đang live và thao tác mới nhất của trọng tài.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
            <Chip size="small" color="warning" label={`${matches.length} trận live`} />
            <Chip size="small" variant="outlined" label={`${refereeCount} trọng tài`} />
            <Chip size="small" variant="outlined" label={`${courtCount} sân`} />
            <IconButton onClick={onClose} aria-label="Đóng">
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 1, md: 1.5 }, bgcolor: "background.default" }}>
        {matches.length ? (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
              height: "calc(100vh - 112px)",
              overflow: "auto",
            }}
          >
            <Table stickyHeader size="small" sx={{ minWidth: 1180 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Mã trận</TableCell>
                  <TableCell>Cặp đấu</TableCell>
                  <TableCell>Tỉ số</TableCell>
                  <TableCell>Đội giao</TableCell>
                  <TableCell>Sân</TableCell>
                  <TableCell>Trọng tài</TableCell>
                  <TableCell>Thao tác gần nhất</TableCell>
                  <TableCell align="right">Mở</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {matches.map((match) => (
                  <RefereeLiveDashboardRow
                    key={String(match?._id || match?.id)}
                    match={match}
                    liveStore={liveStore}
                    onOpenRefereeMatch={onOpenRefereeMatch}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box
            sx={{
              minHeight: "calc(100vh - 140px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <Stack spacing={1}>
              <Typography sx={{ fontWeight: 900, fontSize: 20 }}>
                Chưa có trận nào đang live
              </Typography>
              <Typography sx={{ color: "text.secondary" }}>
                Khi trọng tài bắt đầu trận, trận đó sẽ xuất hiện ở dashboard này.
              </Typography>
            </Stack>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
});

const extractRealtimeMatchPayload = (payload) =>
  payload?.data ?? payload?.snapshot ?? payload?.match ?? payload ?? null;

const LIST_AFFECTING_LIVE_FIELDS = new Set([
  "status",
  "video",
  "courtAssigned",
  "assignedCourt",
  "court",
  "courtId",
  "courtLabel",
  "courtName",
  "courtStation",
  "courtStationId",
  "courtStationLabel",
  "courtStationName",
  "referee",
  "referees",
  "assignedReferees",
  "mainReferee",
  "startedAt",
  "finishedAt",
]);

const sameLiveValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return false;
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
      if (prev && !isNewerOrEqualMatchPayload(prev, partial)) return false;
      const incoming = normalizeMatchDisplay(partial, prev);
      const next = trimLiveActionCache(
        mergeMatchPayload(prev, incoming, prev) || incoming || prev,
      );
      map.set(key, next);
      const changedFields = Object.keys(incoming || partial || {}).filter(
        (field) => !sameLiveValue(prev?.[field], next?.[field]),
      );
      if (!changedFields.length) return false;
      const subs = listeners.get(key);
      if (subs) subs.forEach((fn) => fn());
      return changedFields.some((field) => LIST_AFFECTING_LIVE_FIELDS.has(field));
    },
    prune(validIds) {
      const valid = new Set(
        Array.from(validIds || [])
          .map((id) => String(id || ""))
          .filter(Boolean),
      );
      if (!valid.size) return;
      for (const key of map.keys()) {
        if (!valid.has(key)) map.delete(key);
      }
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
  const liveMatchId = String(matchId || "");
  const subscribe = useCallback(
    (onStoreChange) =>
      liveMatchId ? liveStore.subscribe(liveMatchId, onStoreChange) : () => {},
    [liveStore, liveMatchId],
  );
  const getSnapshot = useCallback(
    () => (liveMatchId ? liveStore.get(liveMatchId) : null),
    [liveStore, liveMatchId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
    "court",
    "courtId",
    "courtLabel",
    "courtName",
    "courtStation",
    "courtStationId",
    "courtStationLabel",
    "courtStationName",
    "referee",
    "referees",
    "assignedReferees",
    "mainReferee",
    "video",
    "startedAt",
    "finishedAt",
    "startedBy",
    "finishedBy",
    "liveEvents",
    "liveLog",
  ];
  const out = {};
  keys.forEach((k) => {
    if (k in src) out[k] = src[k];
  });
  if ("liveBy" in src && String(src.status || "").toLowerCase() !== "finished") {
    out.liveBy = src.liveBy;
  }
  return out;
};

/* ---------------- Component chính ---------------- */
export default function TournamentManagePage() {
  const { t, locale } = useLanguage();
  const theme = useTheme();
  const dispatch = useDispatch();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const matchStatusDialogHelpers = useMemo(
    () => ({
      detailValue,
      getManageStatusMeta,
      matchCode,
      statusChipLocalized,
      teamLabel,
      courtLabel,
      scoreSummary,
      statusWinnerLabel,
      matchStarterName,
      formatOptionalDateTime,
      matchStartedAt,
      matchFinishedAt,
    }),
    [],
  );
  const matchListItemHelpers = useMemo(
    () => ({
      matchCode,
      courtLabel,
      manageDisplayStatus,
      statusChipLocalized,
      teamLabel,
      scoreSummary,
    }),
    [],
  );

  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const manageUiVersion = String(
    searchParams.get("ui") || searchParams.get("manageUi") || "",
  ).toLowerCase();
  const isManageV2 = manageUiVersion === "v2" || manageUiVersion === "2";
  useEffect(() => {
    const hasUrlVersion = searchParams.has("ui") || searchParams.has("manageUi");
    if (hasUrlVersion) {
      try {
        window.localStorage.setItem(
          MANAGE_UI_VERSION_STORAGE_KEY,
          isManageV2 ? "v2" : "v1",
        );
      } catch {}
      return;
    }

    let storedVersion = "";
    try {
      storedVersion = String(
        window.localStorage.getItem(MANAGE_UI_VERSION_STORAGE_KEY) || "",
      ).toLowerCase();
    } catch {}
    if (!["v2", "2", "1", "true"].includes(storedVersion)) return;

    const next = new URLSearchParams(searchParams);
    next.set("ui", "v2");
    setSearchParams(next, { replace: true });
  }, [isManageV2, searchParams, setSearchParams]);
  const handleManageV2Switch = useCallback(
    (event) => {
      const enabled = Boolean(event.target.checked);
      try {
        window.localStorage.setItem(
          MANAGE_UI_VERSION_STORAGE_KEY,
          enabled ? "v2" : "v1",
        );
      } catch {}

      const next = new URLSearchParams(searchParams);
      if (enabled) {
        next.set("ui", "v2");
      } else {
        next.delete("ui");
        next.delete("manageUi");
        next.delete("settings");
        next.delete("settingsTab");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
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
  const matchListQueryArgs = useMemo(
    () => ({
      tid: id,
      page: 1,
      pageSize: 1000,
    }),
    [id],
  );
  const {
    data: matchPage,
    isLoading: mLoading,
    error: mErr,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery(matchListQueryArgs, {
    refetchOnMountOrArgChange: 30,
    refetchOnFocus: false,
  });
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
  const [updateOverlay, { isLoading: savingOverlaySettings }] =
    useUpdateOverlayMutation();
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
  const overlayNameStyleValue = useMemo(() => {
    const value = String(tour?.overlay?.overlayNameStyle || "1");
    return OVERLAY_NAME_STYLE_OPTIONS.some((option) => option.value === value)
      ? value
      : "1";
  }, [tour?.overlay?.overlayNameStyle]);
  const selectedOverlayNameStyle = useMemo(
    () =>
      OVERLAY_NAME_STYLE_OPTIONS.find(
        (option) => option.value === overlayNameStyleValue,
      ) || OVERLAY_NAME_STYLE_OPTIONS[0],
    [overlayNameStyleValue],
  );
  const handleOverlayNameStyleChange = useCallback(
    async (event) => {
      const next = String(event.target.value || "1");
      if (next === overlayNameStyleValue) return;
      try {
        await updateOverlay({ id, body: { overlayNameStyle: next } }).unwrap();
        toast.success("Đã lưu kiểu hiển thị tên overlay");
        refetchTour?.();
      } catch (error) {
        toast.error(
          error?.data?.message || "Không lưu được kiểu hiển thị tên overlay",
        );
      }
    },
    [id, overlayNameStyleValue, refetchTour, updateOverlay],
  );
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

  const normalizeTabValue = useCallback((value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    if (raw === "ko") return "knockout";
    if (raw === "round-elim" || raw === "round_elim") return "roundelim";
    return raw;
  }, []);

  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "group";
    const initial = new URLSearchParams(window.location.search).get("tab");
    return normalizeTabValue(initial) || "group";
  });

  const selectTab = useCallback(
    (nextValue, options = {}) => {
      const fallback = typesAvailable[0]?.type || "group";
      const normalized = normalizeTabValue(nextValue) || fallback;
      setTab(normalized);

      const next = new URLSearchParams(searchParams);
      next.set("tab", normalized);
      setSearchParams(next, { replace: Boolean(options.replace) });
    },
    [normalizeTabValue, searchParams, setSearchParams, typesAvailable],
  );

  useEffect(() => {
    if (brLoading) return;

    const urlTab = normalizeTabValue(searchParams.get("tab"));
    const urlTabExists = typesAvailable.some((item) => item.type === urlTab);
    if (urlTabExists) {
      if (tab !== urlTab) setTab(urlTab);
      return;
    }

    if (!typesAvailable.find((item) => item.type === tab)) {
      selectTab(typesAvailable[0]?.type || "group", { replace: true });
    }
  }, [
    brLoading,
    normalizeTabValue,
    searchParams,
    selectTab,
    tab,
    typesAvailable,
  ]);

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
      // Seed trỏ sang stage KHÁC stage của trận chủ mà không tìm thấy trận nguồn —
      // trận đó có thể KHÔNG TỒN TẠI (blueprint sơ loại bị rút gọn, vd chỉ sinh
      // V2-T1..T5 nhưng seed vẫn trỏ V2-T6). KHÔNG rơi xuống tra theo bracket của
      // TRẬN CHỦ (vớ nhầm trận cùng round/order của chính nhánh này → "W-V2-T6"
      // hiển thị "W-V4-T6"); trả null để nhãn dựng từ seed (getMatchSideDisplayName).
      const ownerStage = Number(m?.bracket?.stage ?? bracketById.get(bid)?.stage);
      if (
        Number.isFinite(stage) &&
        Number.isFinite(ownerStage) &&
        stage !== ownerStage
      ) {
        return null;
      }
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
      return a || b;
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
          const sourceByeA =
            src.seedA?.type === "bye" ||
            /\bBYE\b/i.test(src.seedA?.label || "");
          const sourceByeB =
            src.seedB?.type === "bye" ||
            /\bBYE\b/i.test(src.seedB?.label || "");
          if (isLoser || (sourceByeA && sourceByeB)) return "BYE";
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
  const [refereeDashboardOpen, setRefereeDashboardOpen] = useState(false);
  const [courtLiveMonitorOpen, setCourtLiveMonitorOpen] = useState(false);
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
  const openRefereeDashboard = useCallback(() => setRefereeDashboardOpen(true), []);
  const closeRefereeDashboard = useCallback(() => setRefereeDashboardOpen(false), []);
  const openCourtLiveMonitor = useCallback(
    () => setCourtLiveMonitorOpen(true),
    [],
  );
  const closeCourtLiveMonitor = useCallback(
    () => setCourtLiveMonitorOpen(false),
    [],
  );
  const canStartRefereeMatch = useCallback(
    (match) => {
      const status = String(match?.status || "").toLowerCase();
      if (!match?._id || status === "finished" || isByeMatch(match)) return false;
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
  const [statusDlg, setStatusDlg] = useState({
    open: false,
    matchId: "",
    match: null,
  });
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
  const openStatusDetail = useCallback((m) => {
    setStatusDlg({
      open: true,
      matchId: String(m?._id || m?.id || ""),
      match: m || null,
    });
  }, []);
  const closeStatusDetail = useCallback(
    () => setStatusDlg({ open: false, matchId: "", match: null }),
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
  const patchAdminMatchCache = useCallback(
    (matchId, patch) => {
      const normalizedId = String(matchId || patch?._id || patch?.id || "").trim();
      if (!normalizedId || !patch || typeof patch !== "object") return;

      dispatch(
        tournamentsApiSlice.util.updateQueryData(
          "adminListMatchesByTournament",
          matchListQueryArgs,
          (draft) => {
            const list = Array.isArray(draft?.list) ? draft.list : null;
            if (!list) return;
            const index = list.findIndex(
              (item) => String(item?._id || item?.id || "") === normalizedId,
            );
            if (index < 0) return;
            const current = list[index];
            const normalizedPatch = normalizeMatchDisplay(patch, current) || patch;
            list[index] =
              mergeMatchPayload(current, normalizedPatch, current) || {
                ...current,
                ...normalizedPatch,
              };
          },
        ),
      );
    },
    [dispatch, matchListQueryArgs],
  );
  const statusLiveMatch = useLiveMatch(liveStore, statusDlg.matchId);
  useEffect(() => {
    if (!allMatchesBase.length) return;
    liveStore.prune(
      allMatchesBase.map((match) => match?._id || match?.id).filter(Boolean),
    );
  }, [allMatchesBase, liveStore]);
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

  const statusDetailMatch = useMemo(() => {
    const matchId = String(statusDlg.matchId || "");
    if (!matchId) return statusDlg.match;
    const baseMatch =
      allMatchesBase.find((match) => String(match?._id || match?.id || "") === matchId) ||
      null;
    const mergedMatch = {
      ...(baseMatch || {}),
      ...(statusDlg.match || {}),
      ...(statusLiveMatch || {}),
    };
    const displayStatus = manageDisplayStatus(mergedMatch, mergedMatch?.status);
    return displayStatus === mergedMatch?.status
      ? mergedMatch
      : { ...mergedMatch, status: displayStatus };
  }, [allMatchesBase, statusDlg.match, statusDlg.matchId, statusLiveMatch]);
  const refereeDashboardMatches = useMemo(() => {
    void orderVersion;
    return allMatchesBase
      .map((match) => {
        const matchId = String(match?._id || match?.id || "");
        return { ...match, ...(liveStore.get(matchId) || {}) };
      })
      .filter((match) => String(match?.status || "").toLowerCase() === "live" && !isByeMatch(match))
      .sort((left, right) => {
        const leftCourt = courtLabel(left);
        const rightCourt = courtLabel(right);
        const courtCompare = naturalCompare(leftCourt, rightCourt);
        if (courtCompare !== 0) return courtCompare;
        return naturalCompare(matchCode(left), matchCode(right));
      });
  }, [allMatchesBase, liveStore, naturalCompare, orderVersion]);

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
  const normalizeBracketTypeKey = useCallback(
    (value) => normalizeTabValue(value) || String(value || "").toLowerCase(),
    [normalizeTabValue],
  );

  const completedBracketTypes = useMemo(() => {
    void orderVersion;
    const bracketById = new Map();
    (brackets || []).forEach((bracket) => {
      const bracketId = String(bracket?._id || bracket?.id || "");
      if (bracketId) bracketById.set(bracketId, bracket);
    });

    const stats = new Map();
    const ensureStats = (typeKey) => {
      if (!stats.has(typeKey)) stats.set(typeKey, { total: 0, done: 0 });
      return stats.get(typeKey);
    };

    allMatchesBase.forEach((match) => {
      const bracketId = String(match?.bracket?._id || match?.bracket || "");
      const bracket = bracketById.get(bracketId);
      const typeKey = normalizeBracketTypeKey(
        match?.bracket?.type || bracket?.type || "",
      );
      if (!typeKey) return;

      const matchId = String(match?._id || match?.id || "");
      const merged = {
        ...match,
        ...(matchId ? liveStore.get(matchId) || {} : {}),
      };
      const item = ensureStats(typeKey);
      item.total += 1;
      if (isManageFinishedMatch(merged, merged?.status)) {
        item.done += 1;
      }
    });

    const completed = new Map();
    stats.forEach((item, typeKey) => {
      completed.set(typeKey, item.total > 0 && item.done === item.total);
    });
    return completed;
  }, [
    allMatchesBase,
    brackets,
    liveStore,
    normalizeBracketTypeKey,
    orderVersion,
  ]);

  const getBracketTypeTabLabel = useCallback(
    (type) => {
      const label = getTypeLabel(t, type);
      return completedBracketTypes.get(normalizeBracketTypeKey(type))
        ? `${label} (đã xong)`
        : label;
    },
    [completedBracketTypes, normalizeBracketTypeKey, t],
  );

  const groupedLists = useMemo(() => {
    void orderVersion;
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
            manageDisplayStatus(merged, merged?.status),
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
      const pa = statusPriority(manageDisplayStatus(a, getLiveStatus(a)));
      const pb = statusPriority(manageDisplayStatus(b, getLiveStatus(b)));
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
    orderVersion,
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

  const applyRealtimeMatchPayload = useCallback(
    (payload, options = {}) => {
      if (!payload) return false;
      const data = extractRealtimeMatchPayload(payload);
      const mid = String(
        payload?.matchId ||
          payload?.id ||
          payload?._id ||
          payload?.data?.matchId ||
          payload?.data?._id ||
          payload?.snapshot?.matchId ||
          payload?.snapshot?._id ||
          payload?.match?._id ||
          payload?.match?.id ||
          data?.matchId ||
          data?._id ||
          data?.id ||
          "",
      ).trim();
      if (!mid) return false;

      const partial = pickRealtimeFields(data);
      if (Object.keys(partial).length === 0) return false;

      patchAdminMatchCache(mid, data && typeof data === "object" ? data : partial);
      const listChanged = liveStore.set(mid, partial);
      if (listChanged || options.forceListVersion) {
        startTransition(() => setOrderVersion((v) => v + 1));
        // Khi 1 trận KẾT THÚC, đội thắng mới quyết định đội ở các trận sau.
        // Realtime không kèm `winner`, nên refetch danh sách (debounced) để
        // resolver hiển thị đúng đội — đồng bộ với sơ đồ/popup.
        if (String(partial.status || "").toLowerCase() === "finished") {
          scheduleMatchesRefetch();
        }
      }
      return true;
    },
    [
      liveStore,
      patchAdminMatchCache,
      scheduleMatchesRefetch,
      startTransition,
    ],
  );

  const applySnapshot = useCallback(
    (payload) => {
      applyRealtimeMatchPayload(payload);
    },
    [applyRealtimeMatchPayload],
  );

  const handleRefereeMatchChanged = useCallback(
    (payload) => {
      const applied = applyRealtimeMatchPayload(payload, {
        forceListVersion: true,
      });
      if (!applied) {
        scheduleMatchesRefetch();
      }
    },
    [applyRealtimeMatchPayload, scheduleMatchesRefetch],
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
      const pdfMake = pdfMakeLib;
      const pdfFonts = pdfFontsLib;
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
      const docx = docxLib;
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
  const [v2SettingsOpen, setV2SettingsOpen] = useState(() => {
    const raw = String(searchParams.get("settings") || "").toLowerCase();
    return isManageV2 && ["1", "true", "open"].includes(raw);
  });
  const [v2SettingsSection, setV2SettingsSection] = useState(
    () => String(searchParams.get("settingsTab") || "courts") || "courts",
  );
  const pendingV2SettingsUrlSyncRef = useRef(null);
  const updateV2SettingsUrl = useCallback(
    (open, section = v2SettingsSection) => {
      const normalizedSection = section || "courts";
      const next = new URLSearchParams(searchParams);
      if (open) {
        next.set("settings", "1");
        next.set("settingsTab", normalizedSection);
      } else {
        next.delete("settings");
        next.delete("settingsTab");
      }
      pendingV2SettingsUrlSyncRef.current = {
        open: Boolean(open),
        section: open ? normalizedSection : "",
      };
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, v2SettingsSection],
  );
  const closeV2Settings = useCallback(() => {
    setV2SettingsOpen(false);
    updateV2SettingsUrl(false);
  }, [updateV2SettingsUrl]);
  const toggleV2Settings = useCallback(() => {
    setV2SettingsOpen((open) => {
      const nextOpen = !open;
      updateV2SettingsUrl(nextOpen, v2SettingsSection);
      return nextOpen;
    });
  }, [updateV2SettingsUrl, v2SettingsSection]);
  const selectV2SettingsSection = useCallback(
    (section) => {
      setV2SettingsSection(section);
      if (v2SettingsOpen) updateV2SettingsUrl(true, section);
    },
    [updateV2SettingsUrl, v2SettingsOpen],
  );
  useEffect(() => {
    if (!isManageV2) return;
    const rawOpen = String(searchParams.get("settings") || "").toLowerCase();
    const nextOpen = ["1", "true", "open"].includes(rawOpen);
    const nextSection = String(searchParams.get("settingsTab") || "").trim();
    const pendingSync = pendingV2SettingsUrlSyncRef.current;
    if (pendingSync) {
      const currentSection = nextOpen ? nextSection || "courts" : "";
      if (nextOpen !== pendingSync.open || currentSection !== pendingSync.section) {
        return;
      }
      pendingV2SettingsUrlSyncRef.current = null;
    }
    if (v2SettingsOpen !== nextOpen) setV2SettingsOpen(nextOpen);
    if (nextOpen && nextSection && nextSection !== v2SettingsSection) {
      setV2SettingsSection(nextSection);
    }
  }, [isManageV2, searchParams, v2SettingsOpen, v2SettingsSection]);
  const onMobileExportPDF = async () => {
    closeActionMenu();
    await handleExportPDF();
  };
  const onMobileExportWord = async () => {
    closeActionMenu();
    await handleExportWord();
  };

  const v2SettingsItems = [
    ...(canManageManagers
      ? [
          {
            value: "managers",
            label: "Người quản lý",
            icon: <ManagersIcon fontSize="small" />,
          },
        ]
      : []),
    {
      value: "referees",
      label: "Trọng tài",
      icon: <RefereeIcon fontSize="small" />,
    },
    {
      value: "courts",
      label: "Sân",
      icon: <StadiumIcon fontSize="small" />,
    },
    {
      value: "live",
      label: "Live",
      icon: <MovieIcon fontSize="small" />,
    },
    {
      value: "overlay",
      label: "Overlay",
      icon: <ScoreboardIcon fontSize="small" />,
    },
    {
      value: "poster",
      label: "Poster",
      icon: <AutoAwesomeIcon fontSize="small" />,
    },
    {
      value: "export",
      label: "Xuất file",
      icon: <FileDownloadIcon fontSize="small" />,
    },
    {
      value: "links",
      label: "Điều hướng",
      icon: <OpenInNewIcon fontSize="small" />,
    },
  ];

  const renderV2SettingsContent = () => {
    if (v2SettingsSection === "managers" && canManageManagers) {
      return (
        <TournamentManagersDialog
          inline
          open
          tournamentId={id}
          onClose={closeV2Settings}
          onChanged={() => {
            refetchTour?.();
          }}
        />
      );
    }

    if (v2SettingsSection === "referees") {
      return (
        <ManageRefereesDialog
          inline
          open
          tournamentId={id}
          onClose={closeV2Settings}
          onChanged={() => {
            refetchMatches?.();
            refetchBrackets?.();
          }}
        />
      );
    }

    if (v2SettingsSection === "courts") {
      return (
        <TournamentCourtClusterDialog
          inline
          open
          onClose={closeV2Settings}
          tournament={tour}
          canOverride={isAdmin}
          onUpdated={handleCourtClustersUpdated}
        />
      );
    }

    if (v2SettingsSection === "live") {
      return (
        <LiveSetupDialog
          inline
          open
          onClose={closeV2Settings}
          tournamentId={id}
          bracketId={liveSetup.bracketId}
          allowedClusters={tour?.allowedCourtClusters || []}
        />
      );
    }

    if (v2SettingsSection === "overlay") {
      return (
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Overlay tỉ số</Typography>
            <Typography variant="body2" color="text.secondary">
              Chọn cách app live tự xử lý tên đội dài trên scoreboard.
            </Typography>
          </Box>

          <Button
            component={Link}
            to={`/tournament/${id}/overlay-studio?tournamentId=${id}`}
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            disabled={!canManage}
            sx={{ alignSelf: "flex-start" }}
          >
            Mở Overlay Studio
          </Button>

          <TextField
            select
            size="small"
            label="Kiểu hiển thị tên"
            value={overlayNameStyleValue}
            onChange={handleOverlayNameStyleChange}
            disabled={!canManage || savingOverlaySettings}
            fullWidth
          >
            {OVERLAY_NAME_STYLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Typography variant="body2" color="text.secondary">
            {selectedOverlayNameStyle.helper}
          </Typography>

          {savingOverlaySettings ? (
            <Chip size="small" color="info" label="Đang lưu..." />
          ) : null}

          <Divider sx={{ my: 1 }} />

          <OverlayWidgetsPanel
            tournamentId={id}
            overlay={tour?.overlay}
            canManage={canManage}
            onSaved={() => refetchTour?.()}
          />
        </Stack>
      );
    }

    if (v2SettingsSection === "poster") {
      return (
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Poster giải đấu</Typography>
            <Typography variant="body2" color="text.secondary">
              Tải mẫu, dán link và chạy AI poster bằng đúng cấu hình hiện tại.
            </Typography>
          </Box>

          <Paper
            variant="outlined"
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
              p: 2,
              borderStyle: "dashed",
              borderColor: posterTemplateDragging ? "primary.main" : "divider",
              bgcolor: posterTemplateDragging ? "action.hover" : "transparent",
            }}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant={posterTemplateUrl ? "outlined" : "contained"}
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
              <Button
                variant="outlined"
                startIcon={<InsertLinkIcon />}
                onClick={openPosterUrlDialog}
                disabled={posterTemplateBusy}
              >
                Dán link
              </Button>
              {posterTemplateUrl ? (
                <Chip size="small" color="success" label="Đã có mẫu" />
              ) : null}
              {posterAiRunning ? (
                <Chip size="small" color="warning" label="AI đang chạy" />
              ) : posterAiStale ? (
                <Chip size="small" color="error" label="AI kẹt" />
              ) : posterAiJob?.status === "failed" ? (
                <Chip size="small" color="error" label="AI lỗi" />
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Có thể kéo thả ảnh mẫu vào vùng này.
            </Typography>
          </Paper>

          <TextField
            select
            size="small"
            label="Font tên"
            value={posterNameFontFamily}
            onChange={(event) => setPosterNameFontFamily(event.target.value)}
            disabled={!canManage || posterTemplateBusy}
            fullWidth
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
            multiline
            minRows={3}
            fullWidth
          />

          <Button
            variant="contained"
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
        </Stack>
      );
    }

    if (v2SettingsSection === "export") {
      return (
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Xuất file</Typography>
            <Typography variant="body2" color="text.secondary">
              Xuất dữ liệu theo tab bracket đang mở.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            onClick={handleExportPDF}
            disabled={exporting || bracketsOfTab.length === 0}
          >
            {exporting
              ? t("tournaments.manage.exportPdfLoading")
              : t("tournaments.manage.exportPdf")}
          </Button>
          <Button
            variant="outlined"
            startIcon={<DescriptionIcon />}
            onClick={handleExportWord}
            disabled={exporting || bracketsOfTab.length === 0}
          >
            {exporting
              ? t("tournaments.manage.exportWordLoading")
              : t("tournaments.manage.exportWord")}
          </Button>
        </Stack>
      );
    }

    if (v2SettingsSection === "links") {
      return (
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6">Điều hướng</Typography>
            <Typography variant="body2" color="text.secondary">
              Mở các màn hình liên quan của giải đấu.
            </Typography>
          </Box>
          <Button
            component={Link}
            to={`/tournament/${id}`}
            variant="outlined"
            onClick={closeV2Settings}
          >
            {t("tournaments.manage.overview")}
          </Button>
          {canOpenRefereeCenter ? (
            <Button
              component={Link}
              to={`/tournament/${id}/referee`}
              variant="contained"
              color="warning"
              startIcon={<SportsIcon />}
              onClick={closeV2Settings}
            >
              Trọng tài
            </Button>
          ) : null}
        </Stack>
      );
    }

    return null;
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
        selectTab(nextValue || typesAvailable[0]?.type || "group");
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
    [selectTab, typesAvailable],
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
  const manageActionGroupSx = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 0.75,
    p: 0.75,
    minHeight: 48,
    minWidth: 0,
    maxWidth: "100%",
    border: "1px solid",
    borderColor: "divider",
    borderRadius: 1.5,
    bgcolor: "background.paper",
    "& .MuiButton-root": {
      minHeight: 34,
      whiteSpace: "nowrap",
      flexShrink: 0,
    },
    "& .MuiFormControl-root": {
      minWidth: 0,
    },
  };
  const manageV2DividerColor = (muiTheme) =>
    muiTheme.palette.mode === "dark"
      ? "rgba(148, 163, 184, 0.16)"
      : "rgba(15, 23, 42, 0.14)";
  const hideManageMatchContent = isManageV2 && v2SettingsOpen;

  return (
    <Box
      sx={{
        px: { xs: 1, sm: 1.5, md: 2.5, lg: 3 },
        pt: { xs: 0.75, md: 1 },
        pb: { xs: 2, md: 3 },
        minWidth: 0,
        overflowX: "hidden",
        mx: {
          xs: 0,
          md: -3,
          lg: -5,
          xl: -7,
        },
      }}
    >
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
      <Stack spacing={{ xs: 1, md: 1.25 }} mb={{ xs: 1.5, md: 2 }} sx={{ mt: { xs: 1.25, md: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5} flexWrap="wrap">
          <Stack
            direction="row"
            alignItems="center"
            gap={1}
            flexWrap="wrap"
            sx={{ minWidth: 0, flex: "1 1 260px" }}
          >
            <Typography
              variant="h5"
              sx={{
                lineHeight: 1.15,
                minWidth: 0,
                fontSize: { xs: 24, sm: 28, md: 30 },
                overflowWrap: "anywhere",
              }}
            >
              {t("tournaments.manage.pageTitle", {
                name: tour?.name || t("tournaments.manage.fallbackName"),
              })}
            </Typography>
            <Tooltip title={isManageV2 ? "Đang dùng giao diện v2" : "Chuyển sang giao diện v2"} arrow>
              <FormControlLabel
                label="V2"
                labelPlacement="start"
                sx={{
                  m: 0,
                  gap: 0.25,
                  flexShrink: 0,
                  "& .MuiFormControlLabel-label": {
                    color: "text.secondary",
                    fontSize: 13,
                    fontWeight: 700,
                  },
                }}
                control={
                  <Switch
                    size="small"
                    checked={isManageV2}
                    onChange={handleManageV2Switch}
                    inputProps={{ "aria-label": "Chuyển giao diện v2" }}
                  />
                }
              />
            </Tooltip>
          </Stack>
          {isManageV2 ? (
            <Tooltip title="Mở cài đặt quản lý" arrow>
              <IconButton
                color="primary"
                aria-label="Mở cài đặt quản lý"
                onClick={toggleV2Settings}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  bgcolor: v2SettingsOpen ? "action.selected" : "transparent",
                  flexShrink: 0,
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>

        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems="flex-start"
          justifyContent="flex-end"
          sx={{
            gap: 1,
            width: "100%",
            display: isManageV2 ? "none" : undefined,
          }}
        >
          {isManageV2 ? (
            <Tooltip title="Mở cài đặt quản lý" arrow>
              <IconButton
                color="primary"
                aria-label="Mở cài đặt quản lý"
                onClick={toggleV2Settings}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  bgcolor: v2SettingsOpen ? "action.selected" : "transparent",
                  alignSelf: { xs: "flex-end", md: "center" },
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <>
          {/* Desktop actions */}
          <Stack
            direction="row"
            useFlexGap
            flexWrap="wrap"
            sx={{
              display: { xs: "none", md: "flex" },
              gap: 1,
              alignItems: "stretch",
              maxWidth: "100%",
              width: "100%",
              justifyContent: { md: "flex-start", lg: "flex-end" },
            }}
          >
            <Box
              sx={{
                ...manageActionGroupSx,
                flex: { md: "1 1 100%", lg: "0 1 auto" },
                justifyContent: { md: "flex-start", lg: "flex-end" },
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

            <Button
              variant="outlined"
              size="small"
              startIcon={<ScoreboardIcon />}
              onClick={openRefereeDashboard}
            >
              Quản lý chấm trận ({refereeDashboardMatches.length})
            </Button>

            <Button
              variant="outlined"
              size="small"
              startIcon={<LiveMonitorIcon />}
              onClick={openCourtLiveMonitor}
            >
              Quản lý live sân
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

            <TextField
              select
              size="small"
              label="Tên overlay"
              value={overlayNameStyleValue}
              onChange={handleOverlayNameStyleChange}
              disabled={!canManage || savingOverlaySettings}
              sx={{ flex: "0 1 190px", minWidth: 170, maxWidth: 220 }}
            >
              {OVERLAY_NAME_STYLE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            </Box>

            <Box
              sx={{
                ...manageActionGroupSx,
                flex: { md: "1 1 100%", lg: "1 1 620px", xl: "1 1 680px" },
                justifyContent: { md: "flex-start", xl: "flex-end" },
              }}
            >
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
                flexWrap: "wrap",
                gap: 1,
                px: 1,
                py: 0.5,
                flex: { md: "1 1 360px", xl: "0 1 auto" },
                minWidth: { md: 280 },
                maxWidth: "100%",
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
              sx={{ flex: "0 1 180px", minWidth: 150, maxWidth: 220 }}
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
              sx={{ flex: "1 1 260px", minWidth: 220, maxWidth: { md: "100%", xl: 360 } }}
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

            </Box>

            {/* Export menu (desktop) */}
            <Box
              sx={{
                ...manageActionGroupSx,
                flex: { md: "1 1 100%", lg: "0 1 auto" },
                justifyContent: { md: "flex-start", lg: "flex-end" },
              }}
            >
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
            </Box>
          </Stack>

          {/* Mobile actions */}
          <Box sx={{ display: { xs: "block", md: "none" }, width: "100%" }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              justifyContent="flex-end"
              spacing={1}
            >
              <TextField
                select
                size="small"
                label="Tên overlay"
                value={overlayNameStyleValue}
                onChange={handleOverlayNameStyleChange}
                disabled={!canManage || savingOverlaySettings}
                sx={{ minWidth: { sm: 190 } }}
              >
                {OVERLAY_NAME_STYLE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>

              <Button
                variant="outlined"
                size="small"
                onClick={openActionMenu}
                startIcon={<MovieIcon />}
                sx={{ width: { xs: "100%", sm: "auto" } }}
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
                    openRefereeDashboard();
                  }}
                >
                  <ListItemIcon>
                    <ScoreboardIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={`Quản lý chấm trận (${refereeDashboardMatches.length})`}
                  />
                </MenuItem>

                <MenuItem
                  onClick={() => {
                    closeActionMenu();
                    openCourtLiveMonitor();
                  }}
                >
                  <ListItemIcon>
                    <LiveMonitorIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary="Quản lý live sân" />
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
            </>
          )}
        </Stack>

        {isManageV2 && v2SettingsOpen ? (
          <Paper
            variant="outlined"
            sx={{
              overflow: "hidden",
              borderColor: manageV2DividerColor,
              height: {
                xs: "calc(100dvh - 170px)",
                sm: "min(720px, calc(100dvh - 190px))",
                md: "min(760px, calc(100dvh - 220px))",
              },
            }}
          >
            <Box
              sx={{
                height: "100%",
                minHeight: 0,
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "300px minmax(0, 1fr)",
                  lg: "320px minmax(0, 1fr)",
                },
                gridTemplateRows: {
                  xs: "auto minmax(0, 1fr)",
                  md: "1fr",
                },
              }}
            >
              <Box
                sx={(muiTheme) => ({
                  borderRight: {
                    md: `1px solid ${manageV2DividerColor(muiTheme)}`,
                  },
                  borderBottom: {
                    xs: `1px solid ${manageV2DividerColor(muiTheme)}`,
                    md: 0,
                  },
                  bgcolor: "background.default",
                  p: { xs: 1, md: 2 },
                  minWidth: 0,
                  minHeight: 0,
                  overflow: { xs: "hidden", md: "auto" },
                })}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                  mb={{ xs: 1, md: 2 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                      Cài đặt
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      Quản lý giải v2
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label="Đóng cài đặt"
                    onClick={closeV2Settings}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>

                <List
                  disablePadding
                  sx={{
                    display: { xs: "flex", md: "block" },
                    gap: { xs: 1, md: 0 },
                    overflowX: { xs: "auto", md: "visible" },
                    scrollbarWidth: "thin",
                    pb: { xs: 0.5, md: 0 },
                  }}
                >
                  {v2SettingsItems.map((item) => (
                    <ListItemButton
                      key={item.value}
                      selected={v2SettingsSection === item.value}
                      onClick={() => selectV2SettingsSection(item.value)}
                      sx={{
                        borderRadius: 1,
                        flexShrink: 0,
                        minWidth: { xs: 150, md: "auto" },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText primary={item.label} />
                    </ListItemButton>
                  ))}
                </List>
              </Box>

              <Box
                sx={{
                  p: { xs: 1.5, md: 2.5 },
                  minWidth: 0,
                  minHeight: 0,
                  overflow: "auto",
                }}
              >
                {renderV2SettingsContent()}
              </Box>
            </Box>
          </Paper>
        ) : null}

        {/* Filter bar */}
        {hideManageMatchContent ? null : (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          <Box
            p={{ xs: 1, sm: 1.25, md: 1.5 }}
            display="grid"
            sx={{
              gap: 1,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "minmax(240px, 1.35fr) minmax(170px, 0.85fr) minmax(130px, 0.65fr)",
                lg: "minmax(260px, 420px) 200px 140px minmax(200px, 320px) 190px auto",
              },
              alignItems: "center",
              "& .MuiFormControl-root, & .MuiAutocomplete-root": {
                minWidth: 0,
              },
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
              sx={{
                minWidth: 0,
                gridColumn: { xs: "1", sm: "1 / span 1", lg: "auto" },
              }}
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
              justifyContent={{ xs: "flex-start", lg: "flex-end" }}
              sx={{ gridColumn: { xs: "1", sm: "2", md: "3", lg: "auto" } }}
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
        )}

        {/* Tabs */}
        {hideManageMatchContent ? null : (
          <Paper variant="outlined" sx={{ mt: 1, overflow: "hidden" }}>
            <Tabs
              value={tab}
              onChange={(_, v) => selectTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                px: { xs: 0.5, sm: 1 },
                minHeight: { xs: 42, sm: 48 },
                "& .MuiTab-root": {
                  minHeight: { xs: 42, sm: 48 },
                  px: { xs: 1.25, sm: 2 },
                  fontSize: { xs: 13, sm: 14 },
                },
              }}
            >
              {typesAvailable.map((typeItem) => (
                <Tab
                  key={typeItem.type}
                  label={getBracketTypeTabLabel(typeItem.type)}
                  value={typeItem.type}
                />
              ))}
            </Tabs>
          </Paper>
        )}
      </Stack>

      {/* === Floating Action Bar (hiện khi có chọn) === */}
      {!hideManageMatchContent && selectedMatchIds.size > 0 && (
        <>
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <Box
              sx={{
                position: "fixed",
                left: "50%",
                transform: "translateX(-50%)",
                top: { xs: 72, md: 86 },
                zIndex: 1300,
                width: "min(920px, calc(100vw - 24px))",
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
                  flexWrap: "wrap",
                  justifyContent: "center",
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
              <Paper elevation={8} sx={{ borderRadius: 3, px: 1.5, py: 1.25 }}>
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

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
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
      {!hideManageMatchContent && (bracketsOfTab.length === 0 ? (
        <Alert severity="info">
          {t("tournaments.manage.emptyType", { type: getTypeLabel(t, tab) })}
        </Alert>
      ) : (
        bracketsOfTab.map((b) => {
          const bid = String(b?._id);
          const list = groupedLists.get(bid) || [];
          const allSelected = isAllSelectedIn(list);
          const activeMatches = list.filter(
            (m) => !isManageFinishedMatch(m, getLiveStatus(m)),
          );
          const finishedMatches = list.filter(
            (m) => isManageFinishedMatch(m, getLiveStatus(m)),
          );
          const splitFinishedMatches =
            activeMatches.length > 0 && finishedMatches.length > 0;

          return (
            <Paper
              key={bid}
              variant="outlined"
              sx={{
                mb: 2,
                overflow: "hidden",
                contentVisibility: "auto",
                containIntrinsicSize: "520px",
              }}
            >
              <Box p={{ xs: 1.25, sm: 1.5, md: 2 }} pb={0}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  flexWrap="wrap"
                >
                  <Typography
                    variant="h6"
                    sx={{
                      minWidth: 0,
                      flex: { xs: "1 1 100%", sm: "1 1 auto" },
                      overflowWrap: "anywhere",
                    }}
                  >
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
              {!isMobile && (
                <Box>
                  <TableContainer sx={{ overflowX: "auto" }}>
                    <Table
                      size="small"
                      sx={{
                        tableLayout: "fixed",
                        minWidth: 1130,
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
                          <TableCell sx={{ width: 150 }}>
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
                      ) : list.length === 0 ? (
                        <TableBody>
                            <TableRow>
                              <TableCell colSpan={9} align="center">
                                <Typography color="text.secondary">
                                  Chưa có trận nào.
                                </Typography>
                              </TableCell>
                            </TableRow>
                        </TableBody>
                      ) : (
                        <>
                          {activeMatches.length > 0 && (
                            <TableBody>
                              {splitFinishedMatches && (
                                <MatchListSectionRow
                                  colSpan={9}
                                  color="primary"
                                  label="Trận đang xử lý"
                                />
                              )}
                              {activeMatches.map((m) => (
                                <React.Fragment key={m._id}>
                                    <MatchDesktopRows
                                      match={m}
                                      liveStore={liveStore}
                                      helpers={matchListItemHelpers}
                                      eventType={tour?.eventType || "double"}
                                    displayMode={displayMode}
                                    canStartReferee={canStartRefereeMatch(m)}
                                    onRowClick={openMatch}
                                    onOpenVideo={openVideoDlg}
                                    onDeleteVideo={deleteVideoDlg}
                                    onAssignCourt={openAssignCourt}
                                    onAssignRef={openAssignRef}
                                    onExportRefNote={handleExportRefNote}
                                    onOpenStatus={openStatusDetail}
                                    onStartReferee={openRefereeMatch}
                                    checked={selectedMatchIds.has(String(m._id))}
                                    onToggleSelect={toggleSelectMatch}
                                  />
                                </React.Fragment>
                              ))}
                            </TableBody>
                          )}
                          {finishedMatches.length > 0 && (
                            <TableBody>
                              {splitFinishedMatches && (
                                <MatchListSectionRow
                                  colSpan={9}
                                  color="success"
                                  label="Trận đã kết thúc"
                                />
                              )}
                              {finishedMatches.map((m) => (
                                <React.Fragment key={m._id}>
                                    <MatchDesktopRows
                                      match={m}
                                      liveStore={liveStore}
                                      helpers={matchListItemHelpers}
                                      eventType={tour?.eventType || "double"}
                                    displayMode={displayMode}
                                    canStartReferee={canStartRefereeMatch(m)}
                                    onRowClick={openMatch}
                                    onOpenVideo={openVideoDlg}
                                    onDeleteVideo={deleteVideoDlg}
                                    onAssignCourt={openAssignCourt}
                                    onAssignRef={openAssignRef}
                                    onExportRefNote={handleExportRefNote}
                                    onOpenStatus={openStatusDetail}
                                    onStartReferee={openRefereeMatch}
                                    checked={selectedMatchIds.has(String(m._id))}
                                    onToggleSelect={toggleSelectMatch}
                                  />
                                </React.Fragment>
                              ))}
                            </TableBody>
                          )}
                        </>
                      )}
                    </Table>
                  </TableContainer>
                </Box>
              )}

              {/* Mobile cards */}
              {isMobile && (
                <Box>
                  <Box p={{ xs: 1.25, sm: 1.5 }} pt={1}>
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
                            inputProps={{
                              "aria-label": "Chọn tất cả (mobile)",
                            }}
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

                        <Stack spacing={1.25}>
                          {activeMatches.length > 0 && (
                            <Box>
                              {splitFinishedMatches && (
                                <MatchListSectionBlock
                                  color="primary"
                                  label="Trận đang xử lý"
                                />
                              )}
                              <Grid container spacing={1.2}>
                                {activeMatches.map((m) => (
                                  <Grid key={m._id} item size={{ xs: 12, sm: 6 }}>
                                    <MatchCard
                                      match={m}
                                      liveStore={liveStore}
                                      helpers={matchListItemHelpers}
                                      eventType={tour?.eventType || "double"}
                                      displayMode={displayMode}
                                      canStartReferee={canStartRefereeMatch(m)}
                                      onCardClick={openMatch}
                                      onOpenVideo={openVideoDlg}
                                      onDeleteVideo={deleteVideoDlg}
                                      onAssignCourt={openAssignCourt}
                                      onAssignRef={openAssignRef}
                                      onExportRefNote={handleExportRefNote}
                                      onOpenStatus={openStatusDetail}
                                      onStartReferee={openRefereeMatch}
                                      checked={selectedMatchIds.has(String(m._id))}
                                      onToggleSelect={toggleSelectMatch}
                                    />
                                  </Grid>
                                ))}
                              </Grid>
                            </Box>
                          )}
                          {finishedMatches.length > 0 && (
                            <Box>
                              {splitFinishedMatches && (
                                <MatchListSectionBlock
                                  color="success"
                                  label="Trận đã kết thúc"
                                />
                              )}
                              <Grid container spacing={1.2}>
                                {finishedMatches.map((m) => (
                                  <Grid key={m._id} item size={{ xs: 12, sm: 6 }}>
                                    <MatchCard
                                      match={m}
                                      liveStore={liveStore}
                                      helpers={matchListItemHelpers}
                                      eventType={tour?.eventType || "double"}
                                      displayMode={displayMode}
                                      canStartReferee={canStartRefereeMatch(m)}
                                      onCardClick={openMatch}
                                      onOpenVideo={openVideoDlg}
                                      onDeleteVideo={deleteVideoDlg}
                                      onAssignCourt={openAssignCourt}
                                      onAssignRef={openAssignRef}
                                      onExportRefNote={handleExportRefNote}
                                      onOpenStatus={openStatusDetail}
                                      onStartReferee={openRefereeMatch}
                                      checked={selectedMatchIds.has(String(m._id))}
                                      onToggleSelect={toggleSelectMatch}
                                    />
                                  </Grid>
                                ))}
                              </Grid>
                            </Box>
                          )}
                        </Stack>
                      </>
                    )}
                  </Box>
                </Box>
              )}
            </Paper>
          );
        })
      ))}

      <MatchStatusDialog
        open={statusDlg.open}
        match={statusDetailMatch}
        onClose={closeStatusDetail}
        t={t}
        locale={locale}
        helpers={matchStatusDialogHelpers}
      />

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

      <TournamentCourtLiveMonitorDialog
        open={courtLiveMonitorOpen}
        onClose={closeCourtLiveMonitor}
        tournamentId={id}
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

      <RefereeLiveDashboardDialog
        open={refereeDashboardOpen}
        onClose={closeRefereeDashboard}
        matches={refereeDashboardMatches}
        liveStore={liveStore}
        onOpenRefereeMatch={openRefereeMatch}
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
        onMatchChanged={handleRefereeMatchChanged}
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
