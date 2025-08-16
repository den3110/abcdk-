// src/pages/draw/DrawPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Chip,
  Divider,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  useMediaQuery,
  useTheme,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  TextField,
  Grid,
  Card,
} from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Container as RBContainer } from "react-bootstrap";
import { Bracket, Seed, SeedItem, SeedTeam } from "react-brackets";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link as RouterLink,
} from "react-router-dom";
import { useSelector } from "react-redux";

import {
  useGetTournamentQuery,
  useListTournamentBracketsQuery,
  useStartDrawMutation,
  useDrawNextMutation,
  useDrawCommitMutation,
  useDrawCancelMutation,
  useGetDrawStatusQuery,
  useGetRegistrationsQuery,
  useGetBracketQuery,
  useGenerateGroupMatchesMutation,
  useListTournamentMatchesQuery,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";
import { toast } from "react-toastify";

/* -------------------- utils -------------------- */
function labelBracketType(b) {
  switch (b?.type) {
    case "group":
      return "Vòng bảng";
    case "knockout":
      return "Knockout";
    case "double_elim":
      return "Double Elimination";
    case "swiss":
      return "Swiss System";
    case "gsl":
      return "GSL";
    default:
      return b?.type || "—";
  }
}
const nameFromPlayer = (p) => p?.fullName || p?.name || p?.nickname || "N/A";
const safePairName = (reg, evType = "double") => {
  if (!reg) return "—";
  if (evType === "single") return nameFromPlayer(reg?.player1);
  const p1 = nameFromPlayer(reg?.player1);
  const p2 = nameFromPlayer(reg?.player2);
  return p2 ? `${p1} & ${p2}` : p1;
};
const idOf = (x) => String(x?._id ?? x);

/* Round code helpers */
const sizeFromRoundCode = (code) => {
  if (!code) return 2;
  if (code === "F") return 2;
  if (code === "SF") return 4;
  if (code === "QF") return 8;
  if (/^R\d+$/i.test(code)) return parseInt(code.slice(1), 10);
  return 2;
};
function nextPow2(n) {
  let p = 1;
  const need = Math.max(2, n | 0);
  while (p < need) p <<= 1;
  return p;
}

function codeLabelForSize(size) {
  // size = số đội tham gia ở round này (2,4,8,16,32,...)
  if (size === 2) return { code: "F", label: "Chung kết (F)" };
  if (size === 4) return { code: "SF", label: "Bán kết (SF)" };
  if (size === 8) return { code: "QF", label: "Tứ kết (QF)" };

  // Từ 16 trở lên dùng cách gọi "Vòng 1/n", với n = size/2
  const denom = Math.max(2, size / 2);
  return { code: `R${size}`, label: `Vòng 1/${denom} (R${size})` };
}

function buildKnockoutOptions(teamCount) {
  if (!Number.isFinite(teamCount) || teamCount < 2) {
    return [{ code: "F", label: "Chung kết (F)", roundNumber: 1 }];
  }
  const full = nextPow2(teamCount);
  const out = [];
  for (let size = full, idx = 1; size >= 2; size >>= 1, idx++) {
    const { code, label } = codeLabelForSize(size);
    out.push({ code, label, roundNumber: idx });
  }
  return out;
}

/* -------------------- Group seating board -------------------- */
/**
 * Render lưới bảng (A, B, C,...) với Slot 1..N.
 * Cách fill:
 * - Nếu reveal có `group/bucket` → đẩy vào nhóm đó, slot trống kế tiếp.
 * - Nếu reveal không nói rõ → dùng thứ tự lần lượt theo bảng (A→B→C→...), theo slot (1..N).
 */
function GroupSeatingBoard({
  planned,
  groupsMeta,
  reveals,
  regIndex,
  eventType,
}) {
  // chuẩn hóa danh sách bảng
  const groups = useMemo(() => {
    // groupsMeta: [{code:'A', size:4}, ...] — đã được tính bên ngoài
    return (groupsMeta || []).map((g) => ({
      code: g.code,
      size: g.size,
      slots: Array.from({ length: g.size }, () => null),
    }));
  }, [groupsMeta]);

  // build map code -> group index
  const code2idx = useMemo(() => {
    const m = new Map();
    groups.forEach((g, i) => m.set(String(g.code), i));
    return m;
  }, [groups]);

  // Precompute order fallback: A:1..N, B:1..N, ...
  const fillOrder = useMemo(() => {
    const out = [];
    groups.forEach((g, gi) => {
      for (let s = 0; s < g.size; s++) out.push({ gi, slot: s });
    });
    return out;
  }, [groups]);

  // clone seats
  const seats = useMemo(
    () => groups.map((g) => ({ ...g, slots: g.slots.slice() })),
    [groups]
  );

  // pointer cho fallback order
  let fallbackPtr = 0;

  // helper to get display name from reveal item
  const getRevealName = (rv) => {
    if (!rv) return "—";
    const fromReveal =
      rv.teamName ||
      rv.name ||
      rv.team ||
      rv.displayName ||
      rv.AName ||
      rv.BName ||
      rv.id;
    if (fromReveal) return String(fromReveal);
    // nếu BE gửi regId
    const rid = rv.regId || rv.reg || rv.id || rv._id;
    if (rid && regIndex) {
      const reg = regIndex.get(String(rid));
      if (reg) return safePairName(reg, eventType);
    }
    return "—";
  };

  // điền lần lượt
  (reveals || []).forEach((rv) => {
    const targetCode = rv.group || rv.bucket || rv.groupCode;
    let gi = -1;
    if (targetCode && code2idx.has(String(targetCode))) {
      gi = code2idx.get(String(targetCode));
      // tìm slot trống đầu tiên trong group này
      const slot = seats[gi].slots.findIndex((x) => !x);
      if (slot >= 0) {
        seats[gi].slots[slot] = getRevealName(rv);
        return;
      }
    }
    // fallback: theo fillOrder (A:1..N, B:1..N,…)
    while (
      fallbackPtr < fillOrder.length &&
      seats[fillOrder[fallbackPtr].gi].slots[fillOrder[fallbackPtr].slot]
    ) {
      fallbackPtr++;
    }
    if (fallbackPtr < fillOrder.length) {
      const { gi: _gi, slot: _slot } = fillOrder[fallbackPtr++];
      seats[_gi].slots[_slot] = getRevealName(rv);
    }
  });

  return (
    <Grid container spacing={2}>
      {seats.map((g) => (
        <Grid item xs={12} sm={6} md={4} lg={3} key={g.code}>
          <Card variant="outlined" sx={{ p: 1.5 }}>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              Bảng {g.code}
            </Typography>
            <Stack spacing={0.75}>
              {g.slots.map((val, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1,
                    border: "1px dashed #ddd",
                    borderRadius: 1,
                    backgroundColor: val ? "#f8fbff" : "#fafafa",
                  }}
                >
                  <Typography variant="body2">
                    <b>Slot {idx + 1}:</b> {val || "—"}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

/* -------------------- Round-robin preview (auto) -------------------- */
function buildRR(teams) {
  // Circle method
  const N = teams.length;
  const isOdd = N % 2 === 1;
  const arr = isOdd ? teams.concat(["(BYE)"]) : teams.slice();
  const n = arr.length;
  const rounds = n - 1;
  const fixed = arr[0];
  let rot = arr.slice(1);

  const schedule = [];
  for (let r = 0; r < rounds; r++) {
    const left = [fixed].concat(rot.slice(0, (n - 1) / 2));
    const right = rot
      .slice((n - 1) / 2)
      .slice()
      .reverse();
    const pairs = [];
    for (let i = 0; i < left.length; i++) {
      const A = left[i];
      const B = right[i];
      if (A !== "(BYE)" && B !== "(BYE)") pairs.push({ A, B });
    }
    schedule.push(pairs);
    // rotate
    rot = [rot[rot.length - 1]].concat(rot.slice(0, rot.length - 1));
  }
  return schedule;
}

function RoundRobinPreview({ groupsMeta, regIndex }) {
  return (
    <Stack spacing={2}>
      {groupsMeta.map((g) => {
        // lấy tên team từ regIndex nếu có, nếu không hiển thị id ngắn
        const teamNames = (g.regIds || []).map((rid) => {
          const reg = regIndex?.get(String(rid));
          return reg
            ? safePairName(reg)
            : typeof rid === "string"
            ? `#${rid.slice(-6)}`
            : "—";
        });
        const schedule = buildRR(teamNames);
        return (
          <Paper key={String(g.code)} variant="outlined" sx={{ p: 2 }}>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              Lịch thi đấu — Bảng {g.code}
            </Typography>
            {!teamNames.length ? (
              <Typography color="text.secondary">Chưa có đội.</Typography>
            ) : (
              schedule.map((roundPairs, idx) => (
                <Box key={idx} sx={{ mb: 1.25 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Vòng {idx + 1}
                  </Typography>
                  <Stack spacing={0.5}>
                    {roundPairs.map((p, i2) => (
                      <Typography key={i2} variant="body2">
                        • {p.A} vs {p.B}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              ))
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}

/* -------------------- Knockout bracket view -------------------- */
function KnockoutBracketView({ roundCode, reveals }) {
  const size = sizeFromRoundCode(roundCode); // số team ở Round 1
  const rounds = Math.log2(size); // số vòng (QF=3,SF=2,F=1)
  const matchesPerRound = Array.from(
    { length: rounds },
    (_, i) => size >> (i + 1)
  ); // [size/2, size/4, ... 1]

  // chuẩn hóa dữ liệu round 1 từ reveals
  const r1Pairs = Array.from({ length: matchesPerRound[0] }, (_, i) => {
    const rv = reveals?.[i] || null;
    return {
      A: rv?.A?.name || rv?.AName || rv?.A || "—",
      B: rv?.B?.name || rv?.BName || rv?.B || "—",
    };
  });

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Stack direction="row" spacing={2} sx={{ minWidth: 560 }}>
        {/* Round columns */}
        {matchesPerRound.map((mCount, rIdx) => (
          <Box key={rIdx} sx={{ minWidth: 200 }}>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              {rIdx === rounds - 1
                ? "Chung kết"
                : rIdx === rounds - 2
                ? "Bán kết"
                : rIdx === rounds - 3
                ? "Tứ kết"
                : `Round ${rIdx + 1}`}
            </Typography>
            <Stack spacing={1.5}>
              {Array.from({ length: mCount }).map((_, i) => {
                const showPair = rIdx === 0 ? r1Pairs[i] : null;
                return (
                  <Paper key={i} variant="outlined" sx={{ p: 1.25 }}>
                    <Typography variant="body2">
                      <b>{rIdx === 0 ? `#${i + 1}` : "TBD"}</b>
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="body2">
                        {showPair ? showPair.A : "—"}
                      </Typography>
                      <Typography variant="body2">vs</Typography>
                      <Typography variant="body2">
                        {showPair ? showPair.B : "—"}
                      </Typography>
                    </Box>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

/* ========== KO helpers for react-brackets ========== */
// Lấy tên từ reveal
function getRevealTeamName(sideObj) {
  if (!sideObj) return "Chưa có đội";
  // Ưu tiên các field tên quen thuộc
  return (
    sideObj.name ||
    sideObj.teamName ||
    sideObj.displayName ||
    sideObj.AName ||
    sideObj.BName ||
    sideObj.nick ||
    sideObj.id ||
    "Chưa có đội"
  );
}

// Tiêu đề round theo số trận trong round đó
function koRoundTitleByMatchCount(cnt) {
  if (cnt === 1) return "Chung kết";
  if (cnt === 2) return "Bán kết";
  if (cnt === 4) return "Tứ kết";
  if (cnt === 8) return "Vòng 1/8";
  if (cnt === 16) return "Vòng 1/16";
  return `Vòng (${cnt} trận)`;
}

// Tạo rounds cho Bracket từ roundCode + reveals hiện có
function buildRoundsFromReveals(roundCode, reveals = []) {
  const size = sizeFromRoundCode(roundCode); // số đội ở round đầu
  const rCount = Math.max(1, Math.log2(size) | 0); // số cột (F=1, SF=2, QF=3,…)
  const matchesPerRound = Array.from(
    { length: rCount },
    (_, i) => size >> (i + 1)
  ); // [size/2, size/4, ..., 1]

  // Round 1: lấy từ reveals (mỗi reveal = 1 cặp)
  const r1Seeds = Array.from({ length: matchesPerRound[0] }, (_, i) => {
    const rv = reveals[i] || null;
    const A = rv
      ? getRevealTeamName(rv.A || { name: rv.AName })
      : "Chưa có đội";
    const B = rv
      ? getRevealTeamName(rv.B || { name: rv.BName })
      : "Chưa có đội";
    return {
      id: `R1-${i}`,
      teams: [{ name: A }, { name: B }],
    };
  });

  // Các round sau: placeholder “Winner of …”
  const rounds = [];
  rounds.push({
    title: koRoundTitleByMatchCount(matchesPerRound[0]),
    seeds: r1Seeds,
  });

  for (let r = 2; r <= rCount; r++) {
    const prevCnt = matchesPerRound[r - 2]; // số trận round trước
    const thisCnt = matchesPerRound[r - 1];
    const seeds = Array.from({ length: thisCnt }, (_, i) => {
      const aFrom = 2 * i + 1; // Winner of R{r-1} #{aFrom}
      const bFrom = 2 * i + 2; // Winner of R{r-1} #{bFrom}
      return {
        id: `R${r}-${i}`,
        teams: [
          { name: `Winner of R${r - 1} #${aFrom}` },
          { name: `Winner of R${r - 1} #${bFrom}` },
        ],
      };
    });
    rounds.push({
      title: koRoundTitleByMatchCount(thisCnt),
      seeds,
    });
  }

  return rounds;
}

/* ========== Seed UI giống trang mẫu (nhưng phiên bốc nên không click) ========== */
const DrawCustomSeed = ({ seed, breakpoint }) => {
  const nameA = seed?.teams?.[0]?.name || "Chưa có đội";
  const nameB = seed?.teams?.[1]?.name || "Chưa có đội";
  const isPlaceholder = nameA === "Chưa có đội" && nameB === "Chưa có đội";

  return (
    <Seed mobileBreakpoint={breakpoint} style={{ fontSize: 13 }}>
      <SeedItem style={{ cursor: "default" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <SeedTeam
            style={{
              paddingLeft: 6,
              opacity: isPlaceholder ? 0.7 : 1,
              fontStyle: isPlaceholder ? "italic" : "normal",
            }}
          >
            {nameA}
          </SeedTeam>
          <SeedTeam
            style={{
              paddingLeft: 6,
              opacity: isPlaceholder ? 0.7 : 1,
              fontStyle: isPlaceholder ? "italic" : "normal",
            }}
          >
            {nameB}
          </SeedTeam>
          <div style={{ fontSize: 11, opacity: 0.75 }}>
            {isPlaceholder ? "Chưa có đội" : "Dự kiến"}
          </div>
        </div>
      </SeedItem>
    </Seed>
  );
};

const CustomSeed = ({ seed, breakpoint }) => {
  const nameA = seed?.teams?.[0]?.name || "Chưa có đội";
  const nameB = seed?.teams?.[1]?.name || "Chưa có đội";
  return (
    <Seed mobileBreakpoint={breakpoint} style={{ fontSize: 13 }}>
      <SeedItem>
        <div style={{ display: "grid", gap: 4 }}>
          <SeedTeam>{nameA}</SeedTeam>
          <SeedTeam>{nameB}</SeedTeam>
        </div>
      </SeedItem>
    </Seed>
  );
};

// View knockout dùng react-brackets
function KnockoutRevealBracket({ roundCode, reveals }) {
  const rounds = useMemo(
    () => buildRoundsFromReveals(roundCode, reveals),
    [roundCode, reveals]
  );

  return (
    <Box sx={{ overflowX: "auto", pb: 1 }}>
      <Bracket
        rounds={rounds}
        renderSeedComponent={(props) => <DrawCustomSeed {...props} />}
        mobileBreakpoint={0} // luôn dùng layout desktop
      />
    </Box>
  );
}

const roundTitleByCount = (cnt) => {
  if (cnt === 1) return "Chung kết";
  if (cnt === 2) return "Bán kết";
  if (cnt === 4) return "Tứ kết";
  if (cnt === 8) return "Vòng 1/8";
  if (cnt === 16) return "Vòng 1/16";
  return `Vòng (${cnt} trận)`;
};
const labelDep = (prev) => {
  if (!prev) return "Chưa có đội";
  const r = prev.round ?? "?";
  const idx = (prev.order ?? 0) + 1;
  return `Winner of R${r} #${idx}`;
};
const matchSideName = (m, side, eventType) => {
  const pair = side === "A" ? m?.pairA : m?.pairB;
  const prev = side === "A" ? m?.previousA : m?.previousB;
  if (pair) return safePairName(pair, eventType);
  if (prev) return labelDep(prev);
  return "Chưa có đội";
};

/* ============================================================= */
/* ======================= MAIN COMPONENT ====================== */
/* ============================================================= */
export default function DrawPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const { id: tournamentId } = useParams();
  const [q] = useSearchParams();
  const preselectBracket = q.get("bracketId") || "";

  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = String(userInfo?.role || "").toLowerCase() === "admin";
  const { data: allMatches = [], isLoading: lMatches } =
    useListTournamentMatchesQuery({ tournamentId }, { skip: !tournamentId });
  const {
    data: tournament,
    isLoading: lt,
    error: et,
  } = useGetTournamentQuery(tournamentId);
  const {
    data: brackets = [],
    isLoading: lb,
    error: eb,
  } = useListTournamentBracketsQuery(tournamentId);

  const socket = useSocket();

  const [selBracketId, setSelBracketId] = useState(preselectBracket);
  const bracket =
    useMemo(
      () =>
        brackets.find((b) => String(b._id) === String(selBracketId)) || null,
      [brackets, selBracketId]
    ) || null;

  const { data: drawStatus, isLoading: ls } = useGetDrawStatusQuery(
    selBracketId,
    { skip: !selBracketId }
  );

  const drawType = useMemo(() => {
    if (!bracket) return "knockout";
    if (["group", "gsl", "swiss"].includes(bracket.type)) return "group";
    return "knockout";
  }, [bracket]);

  const [roundCode, setRoundCode] = useState("R16");
  const [usePrevWinners, setUsePrevWinners] = useState(false);

  const { data: bracketDetail } = useGetBracketQuery(selBracketId, {
    skip: !selBracketId,
  });

  const hasGroups = useMemo(() => {
    const g = bracketDetail?.groups || bracket?.groups || [];
    return Array.isArray(g) && g.length > 0;
  }, [bracketDetail, bracket]);

  const groupsRaw = useMemo(
    () => bracketDetail?.groups || bracket?.groups || [],
    [bracketDetail, bracket]
  );

  // phiên draw
  const [drawId, setDrawId] = useState(null);
  const [state, setState] = useState("idle"); // idle|running|committed|canceled
  const [reveals, setReveals] = useState([]); // group: từng team ; ko: từng cặp
  const [planned, setPlanned] = useState(null); // { planned: {groupSizes, byes?}, groups? }
  const [log, setLog] = useState([]);

  const [startDraw, { isLoading: starting }] = useStartDrawMutation();
  const [drawNext, { isLoading: revealing }] = useDrawNextMutation();
  const [drawCommit, { isLoading: committing }] = useDrawCommitMutation();
  const [drawCancel, { isLoading: canceling }] = useDrawCancelMutation();

  const [openGroupDlg, setOpenGroupDlg] = useState(false);
  const [tabMode, setTabMode] = useState("auto"); // 'auto' | 'manual'
  const [manualPairs, setManualPairs] = useState({}); // { groupId: [{a,b}] }
  const [generateGroupMatches, { isLoading: genLoading }] =
    useGenerateGroupMatchesMutation();
  const groupsMeta = useMemo(() => {
    // 1) Ưu tiên kế hoạch từ socket (planned.groups)
    const plist = planned?.groups;
    if (Array.isArray(plist) && plist.length) {
      return plist.map((g, idx) => {
        const code =
          g.code || g.name || g.label || String.fromCharCode(65 + idx);
        const sizeFromPlanned =
          g.size ??
          planned?.planned?.groupSizes?.[g.code || g.name] ??
          (Array.isArray(g.regIds) ? g.regIds.length : 0);
        return {
          code,
          size: Number(sizeFromPlanned) || 0,
          regIds: Array.isArray(g.regIds) ? g.regIds : [],
        };
      });
    }

    // 2) Fallback: từ bracketDetail/groups của bracket
    if (groupsRaw.length) {
      const sorted = groupsRaw
        .slice()
        .sort((a, b) =>
          String(a.name || a.code || "").localeCompare(
            String(b.name || b.code || ""),
            "vi",
            { numeric: true, sensitivity: "base" }
          )
        );
      return sorted.map((g, idx) => {
        const code = g.name || g.code || String.fromCharCode(65 + idx);
        const sizeFromConfig = Array.isArray(g.regIds)
          ? g.regIds.length
          : g.size || (planned?.planned?.groupSizes?.[g.name] ?? 0);
        return {
          code,
          size: Number(sizeFromConfig) || 0,
          regIds: Array.isArray(g.regIds) ? g.regIds : [],
        };
      });
    }

    return [];
  }, [planned, groupsRaw]);

  // Registrations (để map regId -> tên)
  const { data: regsData, isLoading: lRegs } = useGetRegistrationsQuery(
    tournamentId,
    { skip: !tournamentId }
  );

  const regIndex = useMemo(() => {
    const m = new Map();
    const push = (r) => r && m.set(idOf(r._id), r);
    if (!regsData) return m;
    if (Array.isArray(regsData)) regsData.forEach(push);
    if (Array.isArray(regsData?.list)) regsData.list.forEach(push);
    if (Array.isArray(regsData?.registrations))
      regsData.registrations.forEach(push);
    return m;
  }, [regsData]);

  // Số đội đăng ký → options KO
  const regCount = useMemo(() => {
    const d = regsData;
    if (!d) return 0;
    if (Array.isArray(d)) return d.length;
    if (Array.isArray(d?.list)) return d.list.length;
    if (Array.isArray(d?.registrations)) return d.registrations.length;
    return Number(d?.total || 0);
  }, [regsData]);

  const knockoutOptions = useMemo(
    () => buildKnockoutOptions(regCount),
    [regCount]
  );

  // roundNumber từ option (R16 -> 1, QF -> 2, ...)
  const selectedRoundNumber = useMemo(() => {
    const opt = knockoutOptions.find((o) => o.code === roundCode);
    return opt?.roundNumber ?? 1;
  }, [knockoutOptions, roundCode]);

  // toàn bộ trận KO của bracket hiện tại
  const koMatchesThisBracket = useMemo(
    () =>
      (allMatches || []).filter(
        (m) =>
          String(m.bracket?._id || m.bracket) === String(selBracketId) &&
          String(bracket?.type || "").toLowerCase() !== "group"
      ),
    [allMatches, selBracketId, bracket]
  );

  // các cặp của vòng đang xem (đã commit)
  const koPairsPersisted = useMemo(() => {
    const ms = koMatchesThisBracket
      .filter((m) => (m.round || 1) === selectedRoundNumber)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return ms.map((m) => ({
      AName: m.pairA
        ? safePairName(m.pairA, tournament?.eventType)
        : (m.previousA &&
            `Winner of R${m.previousA.round ?? "?"} #${
              (m.previousA.order ?? 0) + 1
            }`) ||
          "—",
      BName: m.pairB
        ? safePairName(m.pairB, tournament?.eventType)
        : (m.previousB &&
            `Winner of R${m.previousB.round ?? "?"} #${
              (m.previousB.order ?? 0) + 1
            }`) ||
          "—",
    }));
  }, [koMatchesThisBracket, selectedRoundNumber, tournament?.eventType]);
  const revealsForKO = useMemo(() => {
    if (state === "running" && Array.isArray(reveals) && reveals.length) {
      return reveals;
    }
    return koPairsPersisted;
  }, [state, reveals, koPairsPersisted]);

  function buildRoundsForKO({
    roundCode,
    reveals,
    matches,
    eventType,
    selectedRoundNumber,
  }) {
    // size & số vòng dự kiến kể từ round đang bốc
    const size = sizeFromRoundCode(roundCode);
    const roundsFromSize = Math.max(1, Math.log2(size) | 0);
    const lastRoundBySize = selectedRoundNumber + roundsFromSize - 1;

    // matches thật của nhánh này (mọi round >= round đang xem)
    const real = (matches || [])
      .filter((m) => (m.round || 1) >= selectedRoundNumber)
      .sort(
        (a, b) =>
          (a.round || 1) - (b.round || 1) || (a.order || 0) - (b.order || 0)
      );

    const maxRoundReal = real.length
      ? Math.max(...real.map((m) => m.round || 1))
      : selectedRoundNumber;

    const firstRound = selectedRoundNumber;
    const lastRound = Math.max(lastRoundBySize, maxRoundReal);

    // đếm số trận thật mỗi round
    const countByRoundReal = {};
    real.forEach((m) => {
      const r = m.round || 1;
      countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
    });

    // số trận "nên có" mỗi round: đi xuôi từ firstRound
    const revealsPairs = (reveals || []).map((rv) => ({
      A: rv?.A?.name || rv?.AName || rv?.A || "Chưa có đội",
      B: rv?.B?.name || rv?.BName || rv?.B || "Chưa có đội",
    }));

    const baseCount =
      countByRoundReal[firstRound] ||
      (revealsPairs.length ? revealsPairs.length : Math.max(1, size >> 1));

    const seedsCount = {};
    seedsCount[firstRound] = baseCount;
    for (let r = firstRound + 1; r <= lastRound; r++) {
      const half = Math.max(1, Math.ceil((seedsCount[r - 1] || 1) / 2));
      seedsCount[r] = countByRoundReal[r] || half;
    }

    // tạo rounds cho react-brackets
    const rounds = [];
    for (let r = firstRound; r <= lastRound; r++) {
      const need = seedsCount[r] || 1;
      const seeds = Array.from({ length: need }, (_, i) => ({
        id: `ph-${r}-${i}`,
        __match: null,
        teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
      }));

      const thisRoundMatches = real
        .filter((m) => (m.round || 1) === r)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      if (thisRoundMatches.length) {
        thisRoundMatches.forEach((m, i) => {
          if (i >= seeds.length) return;
          seeds[i] = {
            id: m._id || `${r}-${i}`,
            __match: m,
            teams: [
              { name: matchSideName(m, "A", eventType) },
              { name: matchSideName(m, "B", eventType) },
            ],
          };
        });
      } else if (r === firstRound && revealsPairs.length) {
        revealsPairs.forEach((p, i) => {
          if (i >= seeds.length) return;
          seeds[i] = {
            id: `rv-${r}-${i}`,
            __match: null,
            teams: [
              { name: p.A || "Chưa có đội" },
              { name: p.B || "Chưa có đội" },
            ],
          };
        });
      }

      rounds.push({ title: roundTitleByCount(need), seeds });
    }

    return rounds;
  }

  // Reset khi đổi bracket
  useEffect(() => {
    if (!selBracketId) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [selBracketId]);

  // Reset khi đổi vòng KO
  useEffect(() => {
    if (drawType !== "knockout") return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [roundCode, drawType]);
  // Helper: tìm code của vòng đầu tiên (nhiều đội nhất)
  const firstRoundCode = useMemo(() => {
    if (!knockoutOptions?.length) return "F";
    return knockoutOptions.reduce((best, cur) => {
      const sb = sizeFromRoundCode(best.code);
      const sc = sizeFromRoundCode(cur.code);
      return sc > sb ? cur : best;
    }).code;
  }, [knockoutOptions]);

  // roundCode hợp lệ -> nếu không thì set về vòng đầu tiên
  useEffect(() => {
    if (drawType !== "knockout") return;
    const valid = knockoutOptions.some((o) => o.code === roundCode);
    if (!valid) {
      setRoundCode(firstRoundCode);
    }
  }, [drawType, knockoutOptions, roundCode, firstRoundCode]);

  // Đồng bộ trạng thái draw từ server
  useEffect(() => {
    if (!drawStatus) return;
    setDrawId(drawStatus.drawId || null);
    setState(drawStatus.state || "idle");
    setReveals(Array.isArray(drawStatus.reveals) ? drawStatus.reveals : []);
  }, [drawStatus]);

  // auto chọn bracket đầu tiên
  useEffect(() => {
    if (!selBracketId && brackets.length) {
      setSelBracketId(brackets[0]._id);
    }
  }, [brackets, selBracketId]);

  // Socket: subscribe theo BRACKET (planned)
  useEffect(() => {
    if (!socket || !selBracketId) return;
    socket.emit("draw:subscribe", { bracketId: selBracketId });
    socket.emit("draw:join", { bracketId: selBracketId });

    const onPlanned = (payload) => {
      setPlanned(payload); // { planned: { groupSizes?, byes? }, groups? }
      setLog((lg) => lg.concat([{ t: Date.now(), type: "planned" }]));
    };

    socket.on("draw:planned", onPlanned);

    return () => {
      socket.off("draw:planned", onPlanned);
      socket.emit("draw:unsubscribe", { bracketId: selBracketId });
      socket.emit("draw:leave", { bracketId: selBracketId });
    };
  }, [socket, selBracketId]);

  // Socket: join theo DRAW (update/reveal/commit/cancel)
  useEffect(() => {
    if (!socket || !drawId) return;
    socket.emit("draw:join", { drawId });

    const onUpdate = (payload) => {
      if (payload?.state) setState(payload.state);
      if (Array.isArray(payload?.reveals)) setReveals(payload.reveals);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "update" }]));
    };
    const onRevealed = (payload) => {
      if (Array.isArray(payload?.reveals)) setReveals(payload.reveals);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "reveal" }]));
    };
    const onCommitted = () => {
      setState("committed");
      setLog((lg) => lg.concat([{ t: Date.now(), type: "commit" }]));
    };
    const onCanceled = () => {
      setState("canceled");
      setLog((lg) => lg.concat([{ t: Date.now(), type: "cancel" }]));
    };

    socket.on("draw:update", onUpdate);
    socket.on("draw:revealed", onRevealed);
    socket.on("draw:committed", onCommitted);
    socket.on("draw:canceled", onCanceled);

    return () => {
      socket.off("draw:update", onUpdate);
      socket.off("draw:revealed", onRevealed);
      socket.off("draw:committed", onCommitted);
      socket.off("draw:canceled", onCanceled);
      socket.emit("draw:leave", { drawId });
    };
  }, [socket, drawId]);

  if (!isAdmin) {
    return (
      <Box p={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Quay lại
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          Chỉ quản trị viên mới truy cập trang bốc thăm.
        </Alert>
      </Box>
    );
  }

  if (lt || lb || ls || lRegs || lMatches) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }

  if (et || eb) {
    return (
      <Box p={3}>
        <Alert severity="error">
          {(et?.data?.message || et?.error || eb?.data?.message || eb?.error) ??
            "Lỗi tải dữ liệu."}
        </Alert>
      </Box>
    );
  }

  const canOperate = Boolean(drawId && state === "running");

  const onStart = async () => {
    if (!selBracketId) return;
    try {
      const body =
        drawType === "group"
          ? { mode: "group" }
          : { mode: "knockout", round: roundCode, usePrevWinners };
      const resp = await startDraw({ bracketId: selBracketId, body }).unwrap();
      setDrawId(resp?.drawId);
      setState(resp?.state || "running");
      setReveals(Array.isArray(resp?.reveals) ? resp.reveals : []);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "start" }]));
    } catch (e) {
      const msg =
        e?.data?.message || e?.error || "Có lỗi khi bắt đầu bốc thăm.";
      toast.error(msg);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:start" }]));
    }
  };

  const onReveal = async () => {
    if (!canOperate) return;
    try {
      await drawNext({ drawId }).unwrap();
    } catch (e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:reveal" }]));
    }
  };

  const onCommit = async () => {
    if (!canOperate) return;
    try {
      await drawCommit({ drawId }).unwrap();
    } catch (e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:commit" }]));
    }
  };

  const onCancel = async () => {
    if (!drawId) return;
    try {
      await drawCancel({ drawId }).unwrap();
    } catch (e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:cancel" }]));
    }
  };

  /* ---------- chuẩn hóa dữ liệu groupsMeta cho GroupSeatingBoard & RR preview ---------- */
  // Ưu tiên: planned.groups (nếu có) → [{code,size,regIds?}], fallback: bracketDetail.groups
  // ⚠️ Đặt ở TOP-LEVEL, trước mọi early return

  return (
    <RBContainer fluid="xl" className="py-4">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          Quay lại
        </Button>
        <Typography variant="h5" fontWeight={700} sx={{ ml: 1 }}>
          Bốc thăm • {tournament?.name}
        </Typography>
        {state !== "idle" && (
          <Chip
            size="small"
            sx={{ ml: 1 }}
            color={
              state === "running"
                ? "warning"
                : state === "committed"
                ? "success"
                : "default"
            }
            label={state}
          />
        )}
      </Stack>

      <Paper
        key={`${selBracketId}-${drawType === "knockout" ? roundCode : "group"}`}
        variant="outlined"
        sx={{ p: 2, flex: 1 }}
      >
        <Stack spacing={2}>
          <Alert severity="info">
            Chỉ admin mới thấy trang này. Thể loại giải:{" "}
            <b>{(tournament?.eventType || "").toUpperCase()}</b>
          </Alert>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Chọn Bracket</InputLabel>
              <Select
                label="Chọn Bracket"
                value={selBracketId}
                onChange={(e) => setSelBracketId(e.target.value)}
              >
                {brackets.map((b) => (
                  <MenuItem key={b._id} value={b._id}>
                    {b.name} — {labelBracketType(b)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {drawType === "knockout" && (
              <FormControl fullWidth>
                <InputLabel>Vòng cần bốc</InputLabel>
                <Select
                  label="Vòng cần bốc"
                  value={roundCode}
                  onChange={(e) => setRoundCode(e.target.value)}
                >
                  {knockoutOptions.map((r) => (
                    <MenuItem key={r.code} value={r.code}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {drawType === "knockout" && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={usePrevWinners}
                    onChange={(e) => setUsePrevWinners(e.target.checked)}
                  />
                }
                label="Lấy đội thắng ở vòng trước"
              />
            )}
          </Stack>

          <Divider />

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={<CasinoIcon />}
              disabled={!selBracketId || starting || state === "running"}
              onClick={onStart}
              sx={{ color: "white !important" }}
            >
              Bắt đầu bốc
            </Button>
            <Button
              variant="outlined"
              startIcon={<PlayArrowIcon />}
              disabled={!canOperate || revealing}
              onClick={onReveal}
            >
              Reveal tiếp
            </Button>
            <Button
              color="success"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              disabled={!canOperate || committing}
              onClick={onCommit}
              sx={{ color: "white !important" }}
            >
              Ghi kết quả (Commit)
            </Button>
            <Button
              color="error"
              variant="outlined"
              startIcon={<CancelIcon />}
              disabled={!drawId || canceling}
              onClick={onCancel}
            >
              Huỷ phiên
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }}>
        {/* Reveal board */}
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography fontWeight={700} gutterBottom>
            Kết quả bốc (reveal)
          </Typography>

          {drawType === "group" ? (
            groupsMeta.length ? (
              <GroupSeatingBoard
                planned={planned}
                groupsMeta={groupsMeta}
                reveals={reveals}
                regIndex={regIndex}
                eventType={
                  tournament?.eventType?.toLowerCase()?.includes("single")
                    ? "single"
                    : "double"
                }
              />
            ) : (
              <Typography color="text.secondary">
                Chưa có thông tin bảng/slot để hiển thị.
              </Typography>
            )
          ) : (
            <Box sx={{ overflowX: "auto", pb: 1 }}>
              <Bracket
                rounds={buildRoundsForKO({
                  roundCode,
                  // chỉ dùng reveals khi đang bốc; đã commit thì rely on matches đã lưu
                  reveals: state === "running" ? reveals : [],
                  matches: koMatchesThisBracket,
                  eventType: tournament?.eventType
                    ?.toLowerCase()
                    ?.includes("single")
                    ? "single"
                    : "double",
                  selectedRoundNumber,
                })}
                renderSeedComponent={CustomSeed}
                mobileBreakpoint={0}
              />
            </Box>
          )}
        </Paper>

        {/* Quick links & Planned/Log */}
        <Paper variant="outlined" sx={{ p: 2, width: { md: 380 } }}>
          <Typography fontWeight={700} gutterBottom>
            Liên kết nhanh
          </Typography>
          <Stack spacing={1}>
            <Button
              component={RouterLink}
              to={`/tournament/${tournamentId}/bracket`}
              variant="outlined"
            >
              Xem sơ đồ giải
            </Button>
            {selBracketId && (
              <Button
                component={RouterLink}
                to={`/tournament/${tournamentId}/bracket?tab=${Math.max(
                  0,
                  brackets.findIndex(
                    (b) => String(b._id) === String(selBracketId)
                  )
                )}`}
                variant="outlined"
              >
                Mở Bracket đang bốc
              </Button>
            )}
            {drawType === "group" && hasGroups && (
              <Button
                variant="contained"
                onClick={() => setOpenGroupDlg(true)}
                sx={{ color: "white !important" }}
              >
                Bốc thăm trận trong bảng
              </Button>
            )}
          </Stack>

          {planned && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontWeight={700} gutterBottom>
                Kế hoạch (planned)
              </Typography>
              {planned?.planned?.groupSizes && (
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Group sizes: {JSON.stringify(planned.planned.groupSizes)}
                </Typography>
              )}
              {Number.isFinite(planned?.planned?.byes) && (
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Byes: {planned.planned.byes}
                </Typography>
              )}
            </>
          )}

          {!!log.length && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography fontWeight={700} gutterBottom>
                Log
              </Typography>
              <Stack spacing={0.5} sx={{ maxHeight: 220, overflowY: "auto" }}>
                {log
                  .slice(-80)
                  .reverse()
                  .map((row, i) => (
                    <Typography
                      key={i}
                      variant="caption"
                      sx={{ display: "block" }}
                    >
                      • {row.type} @ {new Date(row.t).toLocaleTimeString()}
                    </Typography>
                  ))}
              </Stack>
            </>
          )}
        </Paper>
      </Stack>

      {/* Dialog: Group matches */}
      {drawType === "group" && (
        <Dialog
          open={openGroupDlg}
          onClose={() => setOpenGroupDlg(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Bốc thăm trận trong bảng</DialogTitle>
          <DialogContent dividers>
            <Tabs
              value={tabMode}
              onChange={(_, v) => setTabMode(v)}
              sx={{ mb: 2 }}
            >
              <Tab value="auto" label="Tự động (vòng tròn)" />
              <Tab value="manual" label="Thủ công (ghép cặp)" />
            </Tabs>

            {tabMode === "auto" ? (
              groupsMeta.length ? (
                <RoundRobinPreview
                  groupsMeta={groupsMeta}
                  regIndex={regIndex}
                />
              ) : (
                <Alert severity="info">
                  Chưa có dữ liệu bảng để tạo preview vòng tròn.
                </Alert>
              )
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {(groupsRaw || []).map((g) => {
                  const teamIds = (g.regIds || []).map(String);
                  return (
                    <Paper key={String(g._id)} variant="outlined" sx={{ p: 2 }}>
                      <Typography fontWeight={700} gutterBottom>
                        Bảng {g.name}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        sx={{ mb: 1 }}
                      >
                        {teamIds.map((id) => (
                          <Chip key={id} label={id.slice(-6)} />
                        ))}
                      </Stack>

                      {/* Simple manual pair UI: nhập 2 id → Thêm cặp */}
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ mb: 1 }}
                      >
                        <TextField
                          size="small"
                          label="RegId A"
                          placeholder="Nhập ObjectId A"
                          id={`a-${g._id}`}
                        />
                        <TextField
                          size="small"
                          label="RegId B"
                          placeholder="Nhập ObjectId B"
                          id={`b-${g._id}`}
                        />
                        <Button
                          variant="outlined"
                          onClick={() => {
                            const a = document
                              .getElementById(`a-${g._id}`)
                              ?.value.trim();
                            const b = document
                              .getElementById(`b-${g._id}`)
                              ?.value.trim();
                            if (!a || !b || a === b) return;
                            // local state add
                            // (giữ nguyên như bản của bạn – bạn sẽ xử lý sau)
                          }}
                        >
                          Thêm cặp
                        </Button>
                      </Stack>

                      <Typography variant="body2" color="text.secondary">
                        Bạn sẽ hoàn thiện phần thủ công sau (UI giữ nguyên như
                        yêu cầu).
                      </Typography>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenGroupDlg(false)}>Đóng</Button>
            <Button
              onClick={async () => {
                try {
                  if (!selBracketId) return;
                  if (tabMode === "auto") {
                    await generateGroupMatches({
                      bracketId: selBracketId,
                      mode: "auto",
                    }).unwrap();
                  } else {
                    // giữ nguyên như cũ (bạn sẽ hoàn thiện sau)
                    await generateGroupMatches({
                      bracketId: selBracketId,
                      mode: "manual",
                      matches: [],
                    }).unwrap();
                  }
                  setOpenGroupDlg(false);
                  toast.success("Đã tạo trận trong bảng.");
                } catch (e) {
                  toast.error(
                    e?.data?.message || e?.error || "Tạo trận thất bại."
                  );
                }
              }}
              disabled={genLoading}
              variant="contained"
              sx={{ color: "white !important" }}
            >
              Tạo trận
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </RBContainer>
  );
}
