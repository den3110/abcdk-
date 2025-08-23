// src/layouts/tournament/TournamentBracket.jsx
import {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  useLayoutEffect,
  useContext,
  createContext,
} from "react";
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
  GlobalStyles,
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
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

/* ===================== Helpers ===================== */
export const safePairName = (pair, eventType = "double") => {
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
};

export const preferName = (p) =>
  (p?.fullName && String(p.fullName).trim()) ||
  (p?.name && String(p.name).trim()) ||
  (p?.nickname && String(p.nickname).trim()) ||
  "N/A";

export const preferNick = (p) =>
  (p?.nickname && String(p.nickname).trim()) ||
  (p?.nickName && String(p.nickName).trim()) ||
  (p?.nick && String(p.nick).trim()) ||
  "";

export const nameWithNick = (p) => {
  if (!p) return "—";
  const nm = preferName(p);
  const nk = preferNick(p);
  if (!nk) return nm;
  return nm.toLowerCase() === nk.toLowerCase() ? nm : `${nm} (${nk})`;
};

export const pairLabelWithNick = (pair, eventType = "double") => {
  if (!pair) return "—";
  const isSingle = String(eventType).toLowerCase() === "single";
  const a = nameWithNick(pair.player1);
  if (isSingle) return a;
  const b = pair.player2 ? nameWithNick(pair.player2) : "";
  return b ? `${a} & ${b}` : a;
};

/* ----- NEW: seed label helpers ----- */
export const seedLabel = (seed) => {
  if (!seed || !seed.type) return "Chưa có đội";
  if (seed.label) return seed.label;

  switch (seed.type) {
    case "groupRank": {
      const st = seed.ref?.stage ?? seed.ref?.stageIndex ?? "?";
      const g = seed.ref?.groupCode;
      const r = seed.ref?.rank ?? "?";
      return g ? `V${st}-B${g}-#${r}` : `V${st}-#${r}`;
    }
    case "stageMatchWinner": {
      const r = seed.ref?.round ?? "?";
      const t = (seed.ref?.order ?? -1) + 1;
      return `W-V${r}-T${t}`;
    }
    case "stageMatchLoser": {
      const r = seed.ref?.round ?? "?";
      const t = (seed.ref?.order ?? -1) + 1;
      return `L-V${r}-T${t}`;
    }
    case "matchWinner": {
      const r = seed.ref?.round ?? "?";
      const t = (seed.ref?.order ?? -1) + 1;
      return `W-R${r} #${t}`;
    }
    case "matchLoser": {
      const r = seed.ref?.round ?? "?";
      const t = (seed.ref?.order ?? -1) + 1;
      return `L-R${r} #${t}`;
    }
    case "bye":
      return "BYE";
    case "registration":
      return "Registration";
    default:
      return "TBD";
  }
};

export const depLabel = (prev) => {
  if (!prev) return "TBD";
  const r = prev.round ?? "?";
  const idx = (prev.order ?? 0) + 1;
  return `Winner of R${r} #${idx}`;
};

export const matchSideLabel = (m, side) => {
  const pair = side === "A" ? m.pairA : m.pairB;
  const prev = side === "A" ? m.previousA : m.previousB;
  const seed = side === "A" ? m.seedA : m.seedB;
  if (pair)
    return pairLabelWithNick(
      side === "A" ? m.pairA : m.pairB,
      m?.tournament?.eventType
    );
  if (prev) return depLabel(prev);
  if (seed && seed.type) return seedLabel(seed);
  return "Chưa có đội";
};

export const resultLabel = (m) => {
  if (m?.status === "finished") {
    if (m?.winner === "A") return "Đội A thắng";
    if (m?.winner === "B") return "Đội B thắng";
    return "Hoà/Không xác định";
  }
  if (m?.status === "live") return "Đang diễn ra";
  return "Chưa diễn ra";
};

function roundTitleByCount(cnt) {
  if (cnt === 1) return "Chung kết";
  if (cnt === 2) return "Bán kết";
  if (cnt === 4) return "Tứ kết";
  if (cnt === 8) return "Vòng 1/8";
  if (cnt === 16) return "Vòng 1/16";
  return `Vòng (${cnt} trận)`;
}
const ceilPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
const isPow2 = (n) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

/** Đọc quy mô KO từ nhiều field cũ (fallback) */
const readBracketScale = (br) => {
  const teamsFromRoundKey = (k) => {
    if (!k) return 0;
    const up = String(k).toUpperCase();
    if (up === "F") return 2;
    if (up === "SF") return 4;
    if (up === "QF") return 8;
    if (/^R\d+$/i.test(up)) return parseInt(up.slice(1), 10);
    return 0;
  };

  const fromKey =
    teamsFromRoundKey(br?.ko?.startKey) ||
    teamsFromRoundKey(br?.prefill?.roundKey);

  const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
    ? br.prefill.pairs.length * 2
    : 0;
  const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
    ? br.prefill.seeds.length * 2
    : 0;

  const cands = [
    br?.drawScale,
    br?.targetScale,
    br?.maxSlots,
    br?.capacity,
    br?.size,
    br?.scale,
    br?.meta?.drawSize,
    br?.meta?.scale,
    fromKey,
    fromPrefillPairs,
    fromPrefillSeeds,
  ]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 2);

  if (!cands.length) return 0;
  return ceilPow2(Math.max(...cands));
};

/* ===================== 🆕 Gate: chỉ hiện cúp/nhà vô địch khi bracket KO đầy đủ ===================== */
function computeChampionGate(allMatches) {
  const M = (allMatches || []).slice();
  if (!M.length) return { allowed: false, matchId: null, pair: null };

  const byR = new Map();
  for (const m of M) {
    const r = Number(m.round || 1);
    byR.set(r, (byR.get(r) || 0) + 1);
  }
  const rounds = Array.from(byR.keys()).sort((a, b) => a - b);
  if (!rounds.length) return { allowed: false, matchId: null, pair: null };

  const rmin = rounds[0];
  const rmax = rounds[rounds.length - 1];

  for (let r = rmin; r <= rmax; r++)
    if (!byR.get(r)) return { allowed: false, matchId: null, pair: null };

  const c0 = byR.get(rmin) || 0;

  if (rounds.length === 1) {
    if (c0 !== 1) return { allowed: false, matchId: null, pair: null };
    const finals = M.filter((m) => Number(m.round || 1) === rmax);
    const fm = finals.length === 1 ? finals[0] : null;
    const done =
      fm &&
      String(fm.status || "").toLowerCase() === "finished" &&
      (fm.winner === "A" || fm.winner === "B");
    const champion = done ? (fm.winner === "A" ? fm.pairA : fm.pairB) : null;
    return {
      allowed: !!done,
      matchId: done ? fm._id || null : null,
      pair: champion,
    };
  }

  if (c0 < 2) return { allowed: false, matchId: null, pair: null };

  let exp = c0;
  for (let r = rmin + 1; r <= rmax; r++) {
    const cr = byR.get(r);
    const maxAllowed = Math.ceil(exp / 2);
    if (!Number.isFinite(cr) || cr < 1 || cr > maxAllowed) {
      return { allowed: false, matchId: null, pair: null };
    }
    exp = cr;
  }
  if (byR.get(rmax) !== 1) return { allowed: false, matchId: null, pair: null };

  const finals = M.filter((m) => Number(m.round || 1) === rmax);
  const fm = finals.length === 1 ? finals[0] : null;
  if (
    !fm ||
    String(fm.status || "").toLowerCase() !== "finished" ||
    !fm.winner
  ) {
    return { allowed: false, matchId: null, pair: null };
  }
  const champion = fm.winner === "A" ? fm.pairA : fm.pairB;
  return { allowed: true, matchId: fm._id || null, pair: champion };
}

/* ===================== Fix lệch: đồng bộ chiều cao theo vòng ===================== */
const SEED_MIN_H = 88;
const HeightSyncContext = createContext({ get: () => 0, report: () => {} });

function HeightSyncProvider({ roundsKey, children }) {
  const [maxByRound, setMaxByRound] = useState({});
  const api = useMemo(
    () => ({
      get: (r) => maxByRound[r] || 0,
      report: (r, h) =>
        setMaxByRound((prev) => {
          const cur = prev[r] || 0;
          return h > cur ? { ...prev, [r]: h } : prev;
        }),
    }),
    [maxByRound]
  );
  useEffect(() => setMaxByRound({}), [roundsKey]);
  return (
    <HeightSyncContext.Provider value={api}>
      {children}
    </HeightSyncContext.Provider>
  );
}
function useResizeHeight(ref, onHeight) {
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const report = () => onHeight(el.offsetHeight || 0);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [ref, onHeight]);
}

/* ========== Custom seed (wrap + sync height) ========== */
const RED = "#F44336";
const CustomSeed = ({ seed, breakpoint, onOpen, championMatchId }) => {
  const m = seed.__match || null;
  const roundNo = Number(seed.__round || m?.round || 1);
  const nameA =
    seed.teams?.[0]?.name || (m ? matchSideLabel(m, "A") : "Chưa có đội");
  const nameB =
    seed.teams?.[1]?.name || (m ? matchSideLabel(m, "B") : "Chưa có đội");
  const winA = m?.status === "finished" && m?.winner === "A";
  const winB = m?.status === "finished" && m?.winner === "B";
  const isPlaceholder =
    !m && nameA === "Chưa có đội" && nameB === "Chưa có đội";
  const isChampion =
    !!m &&
    !!championMatchId &&
    String(m._id) === String(championMatchId) &&
    (winA || winB);

  const hideAdvanceTick = seed.__lastCol === true;
  const showAdvanceTick = !hideAdvanceTick && (winA || winB);

  const wrapRef = useRef(null);
  const sync = useContext(HeightSyncContext);
  useResizeHeight(wrapRef, (h) =>
    sync.report(roundNo, Math.max(h, SEED_MIN_H))
  );
  const syncedMinH = Math.max(SEED_MIN_H, sync.get(roundNo));

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

  const lineStyle = (isWin) => ({
    display: "block",
    fontWeight: isWin ? 700 : 400,
    borderLeft: isWin ? `4px solid ${RED}` : "4px solid transparent",
    paddingLeft: 6,
    opacity: isPlaceholder ? 0.7 : 1,
    fontStyle: isPlaceholder ? "italic" : "normal",
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "unset",
    wordBreak: "break-word",
    lineHeight: 1.25,
  });

  return (
    <Seed mobileBreakpoint={breakpoint} style={{ fontSize: 13 }}>
      <SeedItem
        onClick={() => m && onOpen?.(m)}
        style={{
          cursor: m ? "pointer" : "default",
          minHeight: syncedMinH,
        }}
      >
        <div
          ref={wrapRef}
          style={{ position: "relative", display: "grid", gap: 4 }}
        >
          {isChampion && (
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

          <SeedTeam style={lineStyle(winA)}>{nameA}</SeedTeam>
          <SeedTeam style={lineStyle(winB)}>{nameB}</SeedTeam>

          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {m
              ? resultLabel(m)
              : isPlaceholder
              ? "Chưa có đội"
              : "Chưa diễn ra"}
          </div>

          {showAdvanceTick && <RightTick />}
        </div>
      </SeedItem>
    </Seed>
  );
};

CustomSeed.propTypes = {
  seed: PropTypes.shape({
    __match: PropTypes.shape({
      _id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      status: PropTypes.string,
      winner: PropTypes.string,
      round: PropTypes.number,
    }),
    __round: PropTypes.number,
    __lastCol: PropTypes.bool,
    teams: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string })),
  }).isRequired,
  breakpoint: PropTypes.number,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};







/* ===================== Legend BXH ===================== */
const TIEBREAK_LABELS = {
  h2h: "đối đầu",
  setsDiff: "hiệu số set",
  pointsDiff: "hiệu số điểm",
  pointsFor: "tổng điểm ghi được",
};
function StandingsLegend({ points, tiebreakers }) {
  const tb = (tiebreakers || [])
    .map((k) => TIEBREAK_LABELS[k] || k)
    .join(" → ");
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2" fontWeight={700}>
          Chú thích
        </Typography>
        <Typography variant="body2">
          <b>P</b> = trận đã đấu,&nbsp; <b>W</b> = thắng,&nbsp; <b>D</b> =
          hòa,&nbsp; <b>L</b> = thua.
        </Typography>
        <Typography variant="body2">
          <b>Set (+/−)</b> = set ghi được − set thua;&nbsp; <b>Điểm (+/−)</b> =
          điểm ghi được − điểm thua.
        </Typography>
        <Typography variant="body2">
          <b>Pts</b> = W×{points.win} + D×{points.draw} + L×{points.loss}.
        </Typography>
        {!!tb && (
          <Typography variant="body2">
            Xếp hạng theo: <b>Pts</b> {tb ? `→ ${tb}` : ""} → tên.
          </Typography>
        )}
      </Stack>
    </Alert>
  );
}

/* ========== Team history dialog (trong bảng) ========== */
function buildGroupIndex(bracket) {
  const byKey = new Map();
  const byRegId = new Map();
  for (const g of bracket?.groups || []) {
    const key = String(g.name || g.code || g._id || "").trim() || "—";
    const label = key;
    const regSet = new Set(g.regIds?.map(String) || []);
    byKey.set(key, { label, regSet });
    regSet.forEach((rid) => byRegId.set(String(rid), key));
  }
  return { byKey, byRegId };
}

/* ===================== BXH theo nhóm ===================== */
function lastGameScoreLocal(gameScores) {
  if (!Array.isArray(gameScores) || !gameScores.length) return { a: 0, b: 0 };
  return gameScores[gameScores.length - 1] || { a: 0, b: 0 };
}
function countGamesWonLocal(gameScores) {
  let A = 0,
    B = 0;
  for (const g of gameScores || []) {
    if ((g?.a ?? 0) > (g?.b ?? 0)) A++;
    else if ((g?.b ?? 0) > (g?.a ?? 0)) B++;
  }
  return { A, B };
}
function sumPointsLocal(gameScores) {
  let a = 0,
    b = 0;
  for (const g of gameScores || []) {
    a += Number(g?.a ?? 0);
    b += Number(g?.b ?? 0);
  }
  return { a, b };
}

function TeamHistoryDialog({
  open,
  onClose,
  teamRow,
  groupKey,
  bracket,
  matches,
  points,
  eventType,
  onOpenMatch,
}) {
  const titleName = safePairName(teamRow?.pair, eventType) || "—";
  const groupLabel =
    bracket?.groups?.find?.(
      (g) => String(g.name || g.code || g._id || "") === String(groupKey)
    )?.name ||
    groupKey ||
    "—";

  const { byRegId } = useMemo(() => buildGroupIndex(bracket || {}), [bracket]);
  const teamId = teamRow?.id && String(teamRow.id);

  const list = useMemo(() => {
    if (!teamId) return [];
    const arr = (matches || []).filter((m) => {
      const aId = m.pairA?._id && String(m.pairA._id);
      const bId = m.pairB?._id && String(m.pairB._id);
      if (!aId || !bId) return false;
      const ga = byRegId.get(aId);
      const gb = byRegId.get(bId);
      return (
        ga === groupKey && gb === groupKey && (aId === teamId || bId === teamId)
      );
    });

    const normed = arr.map((m) => {
      const side = String(m.pairA?._id) === teamId ? "A" : "B";
      const opp = side === "A" ? m.pairB : m.pairA;

      const gw = countGamesWonLocal(m.gameScores || []);
      const pt = sumPointsLocal(m.gameScores || []);
      const setsSelf = side === "A" ? gw.A : gw.B;
      const setsOpp = side === "A" ? gw.B : gw.A;
      const ptsSelf = side === "A" ? pt.a : pt.b;
      const ptsOpp = side === "A" ? pt.b : pt.a;

      const finished = String(m.status || "").toLowerCase() === "finished";
      let outcome = "—";
      if (finished) {
        if (m.winner === side) outcome = "Thắng";
        else if (m.winner && m.winner !== side) outcome = "Thua";
        else outcome = "Hòa";
      } else if (String(m.status || "").toLowerCase() === "live") {
        outcome = "Đang diễn ra";
      } else {
        outcome = "Chưa diễn ra";
      }

      return {
        match: m,
        round: m.round || 1,
        order: m.order ?? 0,
        opponentName: pairLabelWithNick(opp, eventType),
        status: m.status,
        outcome,
        setsSelf,
        setsOpp,
        ptsSelf,
        ptsOpp,
      };
    });

    return normed.sort((a, b) => a.round - b.round || a.order - b.order);
  }, [matches, byRegId, groupKey, teamId, eventType]);

  const summary = useMemo(() => {
    const S = {
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      sf: 0,
      sa: 0,
      pf: 0,
      pa: 0,
      pts: 0,
    };
    for (const r of list) {
      const finished = String(r.status || "").toLowerCase() === "finished";
      if (!finished) continue;
      S.played += 1;
      S.sf += r.setsSelf;
      S.sa += r.setsOpp;
      S.pf += r.ptsSelf;
      S.pa += r.ptsOpp;
      if (r.outcome === "Thắng") {
        S.win += 1;
        S.pts += points?.win ?? 3;
      } else if (r.outcome === "Thua") {
        S.loss += 1;
        S.pts += points?.loss ?? 0;
      } else {
        S.draw += 1;
        S.pts += points?.draw ?? 1;
      }
    }
    S.setDiff = S.sf - S.sa;
    S.pointDiff = S.pf - S.pa;
    return S;
  }, [list, points]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pr: 6 }}>
        Lịch sử đấu • {titleName} — Bảng {groupLabel}
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
          <Chip size="small" label={`P:${summary.played}`} />
          <Chip size="small" label={`W:${summary.win}`} />
          {!!summary.draw && <Chip size="small" label={`D:${summary.draw}`} />}
          <Chip size="small" label={`L:${summary.loss}`} />
          <Chip
            size="small"
            label={`Set:+${summary.sf}/-${summary.sa} (${
              summary.setDiff >= 0 ? "+" : ""
            }${summary.setDiff})`}
          />
          <Chip
            size="small"
            label={`Điểm:+${summary.pf}/-${summary.pa} (${
              summary.pointDiff >= 0 ? "+" : ""
            }${summary.pointDiff})`}
          />
          <Chip
            size="small"
            color="primary"
            variant="outlined"
            label={`Pts:${summary.pts}`}
          />
        </Stack>

        {list.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 72, fontWeight: 700 }}>Vòng</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Đối thủ</TableCell>
                <TableCell align="center" sx={{ width: 160, fontWeight: 700 }}>
                  Trạng thái/KQ
                </TableCell>
                <TableCell align="center" sx={{ width: 110, fontWeight: 700 }}>
                  Sets
                </TableCell>
                <TableCell align="center" sx={{ width: 130, fontWeight: 700 }}>
                  Điểm
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((r) => (
                <TableRow
                  key={r.match._id}
                  hover
                  onClick={() => onOpenMatch?.(r.match)}
                  sx={{ cursor: onOpenMatch ? "pointer" : "default" }}
                >
                  <TableCell>R{r.round}</TableCell>
                  <TableCell>{r.opponentName}</TableCell>
                  <TableCell align="center">{r.outcome}</TableCell>
                  <TableCell align="center">
                    {r.setsSelf}–{r.setsOpp}
                  </TableCell>
                  <TableCell align="center">
                    {r.ptsSelf}–{r.ptsOpp}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Alert severity="info">Chưa có trận nào trong bảng.</Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

function computeGroupTablesForBracket(bracket, matches, eventType) {
  const { byKey, byRegId } = buildGroupIndex(bracket);

  const PWIN = bracket?.config?.roundRobin?.points?.win ?? 3;
  const PDRAW = bracket?.config?.roundRobin?.points?.draw ?? 1;
  const PLOSS = bracket?.config?.roundRobin?.points?.loss ?? 0;
  const tiebreakers = bracket?.config?.roundRobin?.tiebreakers || [];

  const stats = new Map();
  const h2h = new Map();

  const ensureRow = (key, regId, pairObj) => {
    if (!stats.has(key)) stats.set(key, new Map());
    const g = stats.get(key);
    if (!g.has(regId)) {
      g.set(regId, {
        id: regId,
        pair: pairObj || null,
        played: 0,
        win: 0,
        draw: 0,
        loss: 0,
        sf: 0,
        sa: 0,
        pf: 0,
        pa: 0,
        setDiff: 0,
        pointDiff: 0,
        pts: 0,
      });
    } else if (pairObj && !g.get(regId).pair) {
      g.get(regId).pair = pairObj;
    }
    return g.get(regId);
  };

  const addH2H = (key, aId, bId, delta) => {
    if (!h2h.has(key)) h2h.set(key, new Map());
    const G = h2h.get(key);
    if (!G.has(aId)) G.set(aId, new Map());
    const row = G.get(aId).get(bId) || {
      pts: 0,
      sf: 0,
      sa: 0,
      pf: 0,
      pa: 0,
    };
    row.pts += delta.pts || 0;
    row.sf += delta.sf || 0;
    row.sa += delta.sa || 0;
    row.pf += delta.pf || 0;
    row.pa += delta.pa || 0;
    G.get(aId).set(bId, row);
  };

  (matches || []).forEach((m) => {
    const aId = m.pairA?._id && String(m.pairA._id);
    const bId = m.pairB?._id && String(m.pairB._id);
    if (!aId || !bId) return;

    const ga = byRegId.get(aId);
    const gb = byRegId.get(bId);
    if (!ga || !gb || ga !== gb) return;

    const rowA = ensureRow(ga, aId, m.pairA);
    const rowB = ensureRow(gb, bId, m.pairB);

    const finished = String(m.status || "").toLowerCase() === "finished";
    if (!finished) return;

    const winner = String(m.winner || "").toUpperCase();
    const gw = countGamesWonLocal(m.gameScores || []);
    const pt = sumPointsLocal(m.gameScores || []);

    rowA.played += 1;
    rowB.played += 1;

    rowA.sf += gw.A;
    rowA.sa += gw.B;
    rowB.sf += gw.B;
    rowB.sa += gw.A;

    rowA.pf += pt.a;
    rowA.pa += pt.b;
    rowB.pf += pt.b;
    rowB.pa += pt.a;

    if (winner === "A") {
      rowA.win += 1;
      rowB.loss += 1;
      rowA.pts += PWIN;
      rowB.pts += PLOSS;

      addH2H(ga, aId, bId, {
        pts: PWIN,
        sf: gw.A,
        sa: gw.B,
        pf: pt.a,
        pa: pt.b,
      });
      addH2H(gb, bId, aId, {
        pts: PLOSS,
        sf: gw.B,
        sa: gw.A,
        pf: pt.b,
        pa: pt.a,
      });
    } else if (winner === "B") {
      rowB.win += 1;
      rowA.loss += 1;
      rowB.pts += PWIN;
      rowA.pts += PLOSS;

      addH2H(gb, bId, aId, {
        pts: PWIN,
        sf: gw.B,
        sa: gw.A,
        pf: pt.b,
        pa: pt.a,
      });
      addH2H(ga, aId, bId, {
        pts: PLOSS,
        sf: gw.A,
        sa: gw.B,
        pf: pt.a,
        pa: pt.b,
      });
    } else {
      rowA.draw += 1;
      rowB.draw += 1;
      rowA.pts += PDRAW;
      rowB.pts += PDRAW;

      addH2H(ga, aId, bId, {
        pts: PDRAW,
        sf: gw.A,
        sa: gw.B,
        pf: pt.a,
        pa: pt.b,
      });
      addH2H(gb, bId, aId, {
        pts: PDRAW,
        sf: gw.B,
        sa: gw.A,
        pf: pt.b,
        pa: pt.a,
      });
    }

    rowA.setDiff = rowA.sf - rowA.sa;
    rowB.setDiff = rowB.sf - rowB.sa;
    rowA.pointDiff = rowA.pf - rowA.pa;
    rowB.pointDiff = rowB.pf - rowB.pa;
  });

  const cmpForGroup = (key) => (x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    for (const tb of tiebreakers) {
      if (tb === "h2h") {
        const G = h2h.get(key);
        const a = G?.get(x.id)?.get(y.id)?.pts ?? 0;
        const b = G?.get(y.id)?.get(x.id)?.pts ?? 0;
        if (a !== b) return b - a;
        continue;
      }
      if (tb === "setsDiff") {
        if (y.setDiff !== x.setDiff) return y.setDiff - x.setDiff;
        continue;
      }
      if (tb === "pointsDiff") {
        if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff;
        continue;
      }
      if (tb === "pointsFor") {
        if (y.pf !== x.pf) return y.pf - x.pf;
        continue;
      }
    }
    const nx = safePairName(x.pair, eventType) || "";
    const ny = safePairName(y.pair, eventType) || "";
    return nx.localeCompare(ny);
  };

  const out = [];
  for (const [key, { label, regSet }] of byKey.entries()) {
    const rowsMap = stats.get(key) || new Map();
    const filteredRows = Array.from(rowsMap.values()).filter((r) =>
      regSet.has(String(r.id))
    );
    filteredRows.forEach((r) => {
      r.setDiff = r.sf - r.sa;
      r.pointDiff = r.pf - r.pa;
    });
    const rows = filteredRows.sort(cmpForGroup(key));
    out.push({ key, label, rows });
  }

  return {
    groups: out,
    points: { win: PWIN, draw: PDRAW, loss: PLOSS },
    tiebreakers,
  };
}

function GroupStandings({ data, eventType, bracket, matches, onOpenMatch }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { groups, points, tiebreakers } = data || { groups: [] };

  const [histOpen, setHistOpen] = useState(false);
  const [histTeam, setHistTeam] = useState(null);
  const [histGroupKey, setHistGroupKey] = useState(null);

  const openHistory = (gKey, row) => {
    setHistGroupKey(gKey);
    setHistTeam(row);
    setHistOpen(true);
  };
  const closeHistory = () => setHistOpen(false);

  if (!groups?.length) {
    return (
      <Paper variant="outlined" sx={{ p: 2, textAlign: "center", mb: 2 }}>
        Chưa có dữ liệu BXH.
      </Paper>
    );
  }

  return (
    <Stack spacing={2} sx={{ mb: 2 }}>
      <StandingsLegend points={points} tiebreakers={tiebreakers} />

      {groups.map((g) => {
        const rows = g.rows || [];

        if (isMobile) {
          return (
            <Paper key={g.key} variant="outlined" sx={{ p: 1.25 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                Bảng {g.label}
              </Typography>
              <Stack spacing={1}>
                {rows.length ? (
                  rows.map((row, idx) => (
                    <Paper
                      key={row.id || idx}
                      variant="outlined"
                      sx={{
                        p: 1,
                        display: "grid",
                        gridTemplateColumns: "48px 1fr auto",
                        gap: 8,
                      }}
                    >
                      <Chip size="small" label={`#${idx + 1}`} />
                      <MuiLink
                        component="button"
                        underline="hover"
                        onClick={() => openHistory(g.key, row)}
                        sx={{ fontWeight: 600, textAlign: "left" }}
                        title={safePairName(row.pair, eventType)}
                      >
                        {safePairName(row.pair, eventType)}
                      </MuiLink>
                      <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={`${row.pts} pts`}
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ gridColumn: "1 / -1" }}
                      >
                        <Chip size="small" label={`P:${row.played}`} />
                        <Chip size="small" label={`W:${row.win}`} />
                        {!!row.draw && (
                          <Chip size="small" label={`D:${row.draw}`} />
                        )}
                        <Chip size="small" label={`L:${row.loss}`} />
                        <Chip
                          size="small"
                          label={`Set:+${row.sf}/-${row.sa} (${
                            row.setDiff >= 0 ? "+" : ""
                          }${row.setDiff})`}
                        />
                        <Chip
                          size="small"
                          label={`Điểm:+${row.pf}/-${row.pa} (${
                            row.pointDiff >= 0 ? "+" : ""
                          }${row.pointDiff})`}
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
            </Paper>
          );
        }

        return (
          <TableContainer key={g.key} component={Paper} variant="outlined">
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 700, px: 2, pt: 1.25 }}
            >
              Bảng {g.label}
            </Typography>
            <Table size="small" sx={{ tableLayout: "fixed", minWidth: 760 }}>
              <TableHead style={{ display: "table-header-group" }}>
                <TableRow>
                  <TableCell sx={{ width: 48, fontWeight: 700 }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Cặp</TableCell>
                  <TableCell align="center" sx={{ width: 52, fontWeight: 700 }}>
                    P
                  </TableCell>
                  <TableCell align="center" sx={{ width: 52, fontWeight: 700 }}>
                    W
                  </TableCell>
                  <TableCell align="center" sx={{ width: 52, fontWeight: 700 }}>
                    D
                  </TableCell>
                  <TableCell align="center" sx={{ width: 52, fontWeight: 700 }}>
                    L
                  </TableCell>
                  <TableCell
                    align="center"
                    sx={{ width: 120, fontWeight: 700 }}
                  >
                    Set (+/-)
                  </TableCell>
                  <TableCell
                    align="center"
                    sx={{ width: 140, fontWeight: 700 }}
                  >
                    Điểm (+/-)
                  </TableCell>
                  <TableCell align="center" sx={{ width: 70, fontWeight: 700 }}>
                    Pts
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length ? (
                  rows.map((row, idx) => (
                    <TableRow key={row.id || idx}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>
                        <MuiLink
                          component="button"
                          underline="hover"
                          onClick={() => openHistory(g.key, row)}
                          title={safePairName(row.pair, eventType)}
                          sx={{ fontWeight: 600 }}
                        >
                          {safePairName(row.pair, eventType)}
                        </MuiLink>
                      </TableCell>
                      <TableCell align="center">{row.played}</TableCell>
                      <TableCell align="center">{row.win}</TableCell>
                      <TableCell align="center">{row.draw}</TableCell>
                      <TableCell align="center">{row.loss}</TableCell>
                      <TableCell align="center">
                        {row.sf}-{row.sa} ({row.setDiff >= 0 ? "+" : ""}
                        {row.setDiff})
                      </TableCell>
                      <TableCell align="center">
                        {row.pf}-{row.pa} ({row.pointDiff >= 0 ? "+" : ""}
                        {row.pointDiff})
                      </TableCell>
                      <TableCell align="center" style={{ fontWeight: 700 }}>
                        {row.pts}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      Chưa có dữ liệu BXH.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        );
      })}

      <TeamHistoryDialog
        open={histOpen}
        onClose={closeHistory}
        teamRow={histTeam}
        groupKey={histGroupKey}
        bracket={bracket}
        matches={matches}
        points={points}
        eventType={eventType}
        onOpenMatch={onOpenMatch}
      />
    </Stack>
  );
}

GroupStandings.propTypes = {
  data: PropTypes.shape({
    groups: PropTypes.array,
    points: PropTypes.object,
    tiebreakers: PropTypes.array,
  }),
  eventType: PropTypes.string,
  bracket: PropTypes.object,
  matches: PropTypes.array,
  onOpenMatch: PropTypes.func,
};

/* ===================== 🆕 RoundElim builder ===================== */
/**
 * Xây rounds cho round-elim non-2^n:
 *  - R1 = số seed của prefill (ưu tiên) hoặc số trận R1 thực; nếu không có: 1
 *  - Vr (r>=2): floor(#matches(Vr-1)/2), tối thiểu 1
 *  - Số cột k: ưu tiên meta.maxRounds; fallback = round lớn nhất có dữ liệu
 *  - Cột cuối gắn __lastCol=true để ẩn tick “đi tiếp”
 */
function buildRoundElimRounds(bracket, brMatches) {
  const r1FromPrefill =
    Array.isArray(bracket?.prefill?.seeds) && bracket.prefill.seeds.length
      ? bracket.prefill.seeds.length
      : 0;
  const r1FromMatches = (brMatches || []).filter(
    (m) => (m.round || 1) === 1
  ).length;
  const r1Pairs = Math.max(1, r1FromPrefill || r1FromMatches || 1);

  let k =
    Number(bracket?.meta?.maxRounds) ||
    Number(bracket?.config?.roundElim?.maxRounds) ||
    0;
  if (!k) {
    const maxR =
      Math.max(
        0,
        ...((brMatches || []).map((m) => Number(m.round || 1)) || [])
      ) || 1;
    k = Math.max(1, maxR);
  }

  const matchesInRound = (r) => {
    if (r === 1) return r1Pairs;
    let prev = r1Pairs;
    for (let i = 2; i <= r; i++) prev = Math.floor(prev / 2) || 1;
    return Math.max(1, prev);
  };

  const rounds = [];
  for (let r = 1; r <= k; r++) {
    const need = matchesInRound(r);
    const seeds = Array.from({ length: need }, (_, i) => ({
      id: `re-${r}-${i}`,
      __match: null,
      __round: r,
      teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
    }));

    const ms = (brMatches || [])
      .filter((m) => (m.round || 1) === r)
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    ms.forEach((m, idx) => {
      let i = Number.isInteger(m.order)
        ? m.order
        : seeds.findIndex((s) => s.__match === null);
      if (i < 0 || i >= seeds.length) i = Math.min(idx, seeds.length - 1);

      const sideLabel = (side) => matchSideLabel(m, side); // đã support seedA/seedB

      seeds[i] = {
        id: m._id || `re-${r}-${i}`,
        date: m?.scheduledAt
          ? new Date(m.scheduledAt).toDateString()
          : undefined,
        __match: m,
        __round: r,
        teams: [{ name: sideLabel("A") }, { name: sideLabel("B") }],
      };
    });

    rounds.push({ title: `Vòng ${r}`, seeds });
  }

  const last = rounds[rounds.length - 1];
  if (last) last.seeds = last.seeds.map((s) => ({ ...s, __lastCol: true }));

  return rounds;
}

function buildEmptyRoundsByScale(scale /* 2^n */) {
  const rounds = [];
  let matches = Math.max(1, Math.floor(scale / 2));
  let r = 1;
  while (matches >= 1) {
    const seeds = Array.from({ length: matches }, (_, i) => ({
      id: `placeholder-${r}-${i}`,
      __match: null,
      __round: r,
      teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
    }));
    rounds.push({ title: roundTitleByCount(matches), seeds });
    matches = Math.floor(matches / 2);
    r += 1;
  }
  const last = rounds[rounds.length - 1];
  if (last) last.seeds = last.seeds.map((s) => ({ ...s, __lastCol: true }));
  return rounds;
}

/* ===================== 🆕 Prefill → KO rounds ===================== */
/* Ưu tiên prefill.seeds; fallback prefill.pairs (cũ) */
function buildRoundsFromPrefill(prefill, koMeta) {
  const useSeeds =
    prefill && Array.isArray(prefill.seeds) && prefill.seeds.length > 0;
  const usePairs =
    !useSeeds && Array.isArray(prefill?.pairs) && prefill.pairs.length > 0;
  if (!useSeeds && !usePairs) return [];

  const firstCount = useSeeds ? prefill.seeds.length : prefill.pairs.length;

  const totalRounds =
    (koMeta && Number(koMeta.rounds)) ||
    Math.ceil(Math.log2(Math.max(2, firstCount * 2)));

  const rounds = [];
  let cnt = firstCount;
  for (let r = 1; r <= totalRounds && cnt >= 1; r++) {
    const seeds = Array.from({ length: cnt }, (_, i) => {
      if (r === 1) {
        if (useSeeds) {
          const s = prefill.seeds[i] || {};
          const nameA = seedLabel(s.A);
          const nameB = seedLabel(s.B);
          return {
            id: `pf-${r}-${i}`,
            __match: null,
            __round: r,
            teams: [{ name: nameA }, { name: nameB }],
          };
        } else {
          const p = prefill.pairs[i] || {};
          const nameA = p?.a?.name || "Chưa có đội";
          const nameB = p?.b?.name || "Chưa có đội";
          return {
            id: `pf-${r}-${i}`,
            __match: null,
            __round: r,
            teams: [{ name: nameA }, { name: nameB }],
          };
        }
      }
      return {
        id: `pf-${r}-${i}`,
        __match: null,
        __round: r,
        teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
      };
    });

    rounds.push({ title: roundTitleByCount(cnt), seeds });
    cnt = Math.floor(cnt / 2);
  }
  const last = rounds[rounds.length - 1];
  if (last) last.seeds = last.seeds.map((s) => ({ ...s, __lastCol: true }));
  return rounds;
}

/** KO: trải tới chung kết (+ __round), có seedA/seedB fallback */
function buildRoundsWithPlaceholders(
  brMatches,
  { minRounds = 0, extendForward = true, expectedFirstRoundPairs = 0 } = {}
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

  let firstRound = roundsHave.length ? Math.min(...roundsHave) : 1;
  const haveColsInitial = roundsHave.length ? lastRound - firstRound + 1 : 1;
  if (minRounds && haveColsInitial < minRounds) {
    firstRound = Math.max(1, lastRound - (minRounds - 1));
  }

  const countByRoundReal = {};
  real.forEach((m) => {
    const r = m.round || 1;
    countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
  });

  const seedsCount = {};

  if (firstRound === 1 && expectedFirstRoundPairs > 0) {
    seedsCount[1] = Math.max(countByRoundReal[1] || 0, expectedFirstRoundPairs);
  } else if (countByRoundReal[lastRound]) {
    seedsCount[lastRound] = countByRoundReal[lastRound];
  } else {
    seedsCount[lastRound] = 1;
  }

  for (let r = lastRound - 1; r >= firstRound; r--) {
    seedsCount[r] = countByRoundReal[r] || (seedsCount[r + 1] || 1) * 2;
  }

  if (extendForward) {
    let cur = firstRound;
    if (firstRound !== 1 && seedsCount[1]) cur = 1;
    while ((seedsCount[cur] || 1) > 1) {
      const nxt = cur + 1;
      seedsCount[nxt] = Math.ceil((seedsCount[cur] || 1) / 2);
      cur = nxt;
    }
  }

  const roundNums = Object.keys(seedsCount)
    .map(Number)
    .sort((a, b) => a - b);

  const res = roundNums.map((r) => {
    const need = seedsCount[r];
    const seeds = Array.from({ length: need }, (_, i) => [
      { name: "Chưa có đội" },
      { name: "Chưa có đội" },
    ]).map((teams, i) => ({
      id: `placeholder-${r}-${i}`,
      __match: null,
      __round: r,
      teams,
    }));

    const ms = real
      .filter((m) => (m.round || 1) === r)
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    ms.forEach((m, idx) => {
      let i = Number.isInteger(m.order)
        ? m.order
        : seeds.findIndex((s) => s.__match === null);
      if (i < 0 || i >= seeds.length) i = Math.min(idx, seeds.length - 1);

      const sideLabel = (side) => matchSideLabel(m, side);

      seeds[i] = {
        id: m._id || `${r}-${i}`,
        date: m?.scheduledAt
          ? new Date(m.scheduledAt).toDateString()
          : undefined,
        __match: m,
        __round: r,
        teams: [{ name: sideLabel("A") }, { name: sideLabel("B") }],
      };
    });

    return { title: roundTitleByCount(need), seeds };
  });

  const last = res[res.length - 1];
  if (last) last.seeds = last.seeds.map((s) => ({ ...s, __lastCol: true }));

  return res;
}

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

  // KO placeholder khi chưa có trận
  const buildEmptyRoundsForKO = useCallback((koBracket) => {
    const scaleFromBracket = readBracketScale(koBracket);
    if (scaleFromBracket) return buildEmptyRoundsByScale(scaleFromBracket);
    const fallback = 4; // bán kết
    const scale = ceilPow2(fallback);
    return buildEmptyRoundsByScale(scale);
  }, []);

  // === Memo phụ thuộc tab/brackets/matches
  const current = brackets?.[tab] || null;
  const currentMatches = useMemo(
    () => (current ? byBracket[current._id] || [] : []),
    [byBracket, current]
  );

  // 🆕: rounds dựng từ prefill mới (seeds)
  const prefillRounds = useMemo(() => {
    if (!current?.prefill) return null;
    const r = buildRoundsFromPrefill(current.prefill, current?.ko);
    return r && r.length ? r : null;
  }, [current]);

  const groupData = useMemo(() => {
    if (current?.type !== "group") return null;
    return computeGroupTablesForBracket(
      current,
      currentMatches,
      tour?.eventType
    );
  }, [current, currentMatches, tour?.eventType]);

  const { byRegId: groupIndex } = useMemo(
    () => buildGroupIndex(current || {}),
    [current]
  );
  const matchGroupLabel = (m) => {
    const aId = m.pairA?._id && String(m.pairA._id);
    const bId = m.pairB?._id && String(m.pairB._id);
    const ga = aId && groupIndex.get(aId);
    const gb = bId && groupIndex.get(bId);
    return ga && gb && ga === gb ? ga : "—";
  };

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

  const tabLabels = brackets.map((b) => {
    const t =
      b.type === "group"
        ? "Group"
        : b.type === "roundElim"
        ? "Round Elim"
        : "Knockout";
    return (
      <Stack key={b._id} direction="row" spacing={1} alignItems="center">
        <Typography>{b.name}</Typography>
        <Chip size="small" label={t} color="default" variant="outlined" />
      </Stack>
    );
  });

  const uniqueRoundsCount = new Set(currentMatches.map((m) => m.round ?? 1))
    .size;
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

      {current.type === "group" ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Vòng bảng: {current.name}
          </Typography>

          <Typography variant="subtitle1" gutterBottom>
            Bảng xếp hạng
          </Typography>

          <GroupStandings
            data={groupData}
            eventType={tour?.eventType}
            bracket={current}
            matches={currentMatches}
            onOpenMatch={openMatch}
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
                      String(matchGroupLabel(a)).localeCompare(
                        String(matchGroupLabel(b))
                      ) ||
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
                        <Chip
                          size="small"
                          label={`Bảng ${matchGroupLabel(m)}`}
                        />
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
              <Table size="small" sx={{ tableLayout: "fixed", minWidth: 780 }}>
                <TableHead style={{ display: "table-header-group" }}>
                  <TableRow>
                    <TableCell sx={{ width: 120, fontWeight: 700 }}>
                      Bảng
                    </TableCell>
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
                      sx={{ width: 200, fontWeight: 700 }}
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
                          String(matchGroupLabel(a)).localeCompare(
                            String(matchGroupLabel(b))
                          ) ||
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
                          <TableCell>Bảng {matchGroupLabel(m)}</TableCell>
                          <TableCell>R{m.round || 1}</TableCell>
                          <TableCell>{matchSideLabel(m, "A")}</TableCell>
                          <TableCell align="center">vs</TableCell>
                          <TableCell>{matchSideLabel(m, "B")}</TableCell>
                          <TableCell align="center">{resultLabel(m)}</TableCell>
                        </TableRow>
                      ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        Chưa có trận nào.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      ) : current.type === "roundElim" ? (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Vòng loại rút gọn (Round Elimination): {current.name}
          </Typography>

          {(() => {
            const reRounds = buildRoundElimRounds(current, currentMatches);
            const roundsKeyRE = `${current._id}:${reRounds.length}:${reRounds
              .map((r) => r.seeds.length)
              .join(",")}`;

            return (
              <>
                <GlobalStyles
                  styles={{
                    ".re-bracket .sc-gEvEer:last-of-type .sc-dcJsrY::after, \
           .re-bracket .sc-gEvEer:last-of-type .sc-dcJsrY::before, \
           .re-bracket .sc-gEvEer:last-of-type .sc-imWYAI::after, \
           ": {
                      content: '""',
                      display: "none !important",
                      border: "0 !important",
                      width: 0,
                      height: 0,
                    },
                  }}
                />
                <Box
                  className="re-bracket"
                  sx={{ overflowX: { xs: "auto", sm: "visible" }, pb: 1 }}
                >
                  <HeightSyncProvider roundsKey={roundsKeyRE}>
                    <Bracket
                      rounds={reRounds}
                      renderSeedComponent={(props) => (
                        <CustomSeed
                          {...props}
                          onOpen={openMatch}
                          championMatchId={null}
                        />
                      )}
                      mobileBreakpoint={0}
                    />
                  </HeightSyncProvider>
                </Box>

                {currentMatches.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    * Chưa bốc cặp — đang hiển thị khung theo vòng cắt (V1..Vk).
                  </Typography>
                )}
              </>
            );
          })()}
        </Paper>
      ) : (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Nhánh knock-out: {current.name}
          </Typography>

          {(() => {
            const championGate = computeChampionGate(currentMatches);
            const finalMatchId = championGate.allowed
              ? championGate.matchId
              : null;
            const championPair = championGate.allowed
              ? championGate.pair
              : null;

            const expectedFirstRoundPairs =
              Array.isArray(current?.prefill?.seeds) &&
              current.prefill.seeds.length
                ? current.prefill.seeds.length
                : Array.isArray(current?.prefill?.pairs) &&
                  current.prefill.pairs.length
                ? current.prefill.pairs.length
                : scaleForCurrent
                ? Math.floor(scaleForCurrent / 2)
                : 0;

            const roundsToRender =
              currentMatches.length > 0
                ? buildRoundsWithPlaceholders(currentMatches, {
                    minRounds: minRoundsForCurrent,
                    extendForward: true,
                    expectedFirstRoundPairs,
                  })
                : prefillRounds
                ? prefillRounds
                : current.drawRounds && current.drawRounds > 0
                ? buildEmptyRoundsByScale(2 ** current.drawRounds)
                : buildEmptyRoundsForKO(current);

            const roundsKeyKO = `${current._id}:${
              roundsToRender.length
            }:${roundsToRender.map((r) => r.seeds.length).join(",")}`;

            return (
              <>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mb: 1 }}
                  flexWrap="wrap"
                >
                  {current?.ko?.startKey && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Bắt đầu: ${current.ko.startKey}`}
                    />
                  )}
                  {current?.prefill?.isVirtual && (
                    <Chip
                      size="small"
                      color="warning"
                      variant="outlined"
                      label="Prefill ảo"
                    />
                  )}
                  {current?.prefill?.source?.fromName && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Nguồn: ${current.prefill.source.fromName}`}
                    />
                  )}
                  {current?.prefill?.roundKey && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`RoundKey: ${current.prefill.roundKey}`}
                    />
                  )}
                </Stack>

                {championPair && (
                  <Alert severity="success" sx={{ mb: 1 }}>
                    Vô địch:{" "}
                    <b>{pairLabelWithNick(championPair, tour?.eventType)}</b>
                  </Alert>
                )}

                <Box sx={{ overflowX: { xs: "auto", sm: "visible" }, pb: 1 }}>
                  <HeightSyncProvider roundsKey={roundsKeyKO}>
                    <Bracket
                      rounds={roundsToRender}
                      renderSeedComponent={(props) => (
                        <CustomSeed
                          {...props}
                          onOpen={openMatch}
                          championMatchId={finalMatchId}
                        />
                      )}
                      mobileBreakpoint={0}
                    />
                  </HeightSyncProvider>
                </Box>

                {currentMatches.length === 0 && prefillRounds && (
                  <Typography variant="caption" color="text.secondary">
                    * Đang hiển thị khung <b>prefill</b>
                    {current?.prefill?.isVirtual
                      ? " (ảo theo seeding)"
                      : ""}{" "}
                    bắt đầu từ{" "}
                    <b>
                      {current?.ko?.startKey ||
                        current?.prefill?.roundKey ||
                        "?"}
                    </b>
                    . Khi có trận thật, nhánh sẽ tự cập nhật.
                  </Typography>
                )}

                {currentMatches.length === 0 && !prefillRounds && (
                  <Typography variant="caption" color="text.secondary">
                    * Chưa bốc thăm / chưa lấy đội từ vòng trước — tạm hiển thị
                    khung theo <b>quy mô</b>. Khi có trận thật, nhánh sẽ tự cập
                    nhật.
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
