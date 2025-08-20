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
import { useSelector, useDispatch } from "react-redux";
import { toast } from "react-toastify";

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
  return p2 ? `${p1} & ${p2}` : p1 || "—";
};
const idOf = (x) => String(x?._id ?? x);
const asId = (x) => {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object")
    return x._id || x.id || x.value?._id || x.value?.id || null;
  return null;
};
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toUpperCase();

const sizeFromRoundCode = (code) => {
  if (!code) return 2;
  const up = String(code).toUpperCase();
  if (up === "F") return 2;
  if (up === "SF") return 4;
  if (up === "QF") return 8;
  if (/^R\d+$/i.test(up)) return parseInt(up.slice(1), 10);
  return 2;
};
function nextPow2(n) {
  let p = 1;
  const need = Math.max(2, n | 0);
  while (p < need) p <<= 1;
  return p;
}
function codeLabelForSize(size) {
  if (size === 2) return { code: "F", label: "Chung kết (F)" };
  if (size === 4) return { code: "SF", label: "Bán kết (SF)" };
  if (size === 8) return { code: "QF", label: "Tứ kết (QF)" };
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
function GroupSeatingBoard({ groupsMeta, reveals, regIndex, eventType }) {
  const seats = useMemo(() => {
    const map = new Map();
    (groupsMeta || []).forEach((g, idx) => {
      const code = g.code ?? String.fromCharCode(65 + idx);
      map.set(norm(code), {
        code,
        size: Number(g.size) || 0,
        slots: Array.from({ length: Number(g.size) || 0 }, () => null),
      });
    });

    (reveals || []).forEach((rv) => {
      const key =
        rv.groupCode ||
        rv.groupKey ||
        (typeof rv.group === "string" ? rv.group : "");
      const nm = (() => {
        const by =
          rv.teamName ||
          rv.name ||
          rv.team ||
          rv.displayName ||
          rv.AName ||
          rv.BName;
        if (by) return String(by);
        const rid = asId(rv.regId ?? rv.reg ?? rv.id ?? rv._id);
        if (rid && regIndex?.get(String(rid)))
          return safePairName(regIndex.get(String(rid)), eventType);
        return "—";
      })();
      const g = map.get(norm(key));
      if (g) {
        const slot = g.slots.findIndex((x) => !x);
        if (slot >= 0) g.slots[slot] = nm;
      }
    });

    return Array.from(map.values());
  }, [groupsMeta, reveals, regIndex, eventType]);

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

/* -------------------- Round-robin preview -------------------- */
function buildRR(teams) {
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
    rot = [rot[rot.length - 1]].concat(rot.slice(0, rot.length - 1));
  }
  return schedule;
}

// ⬇️ Cập nhật: nhận doubleRound và nhân đôi lịch khi cần
function RoundRobinPreview({ groupsMeta, regIndex, doubleRound = false }) {
  return (
    <Stack spacing={2}>
      {groupsMeta.map((g) => {
        const teamNames = (g.regIds || []).map((rid) => {
          const reg = regIndex?.get(String(rid));
          return reg
            ? reg.player2
              ? `${
                  reg.player1?.fullName ||
                  reg.player1?.name ||
                  reg.player1?.nickname
                } & ${
                  reg.player2?.fullName ||
                  reg.player2?.name ||
                  reg.player2?.nickname
                }`
              : reg.player1?.fullName ||
                reg.player1?.name ||
                reg.player1?.nickname
            : typeof rid === "string"
            ? `#${rid.slice(-6)}`
            : "—";
        });

        const schedule1 = buildRR(teamNames);
        const schedule = doubleRound
          ? schedule1.concat(
              schedule1.map((roundPairs) =>
                roundPairs.map((p) => ({ A: p.B, B: p.A }))
              )
            )
          : schedule1;

        const totalMatches =
          ((teamNames.length * (teamNames.length - 1)) / 2) *
          (doubleRound ? 2 : 1);

        return (
          <Paper key={String(g.code)} variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography fontWeight={700}>
                Lịch thi đấu — Bảng {g.code}{" "}
                {doubleRound ? "(2 lượt)" : "(1 lượt)"}
              </Typography>
              <Chip size="small" label={`Tổng: ${totalMatches} trận`} />
            </Stack>

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

/* -------------------- KO render helpers -------------------- */
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
  if (pair) return safePairName(m[side === "A" ? "pairA" : "pairB"], eventType);
  if (prev) return labelDep(prev);
  return "Chưa có đội";
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

/* ============================================================= */
/* ======================= MAIN COMPONENT ====================== */
/* ============================================================= */
export default function DrawPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { id: tournamentId } = useParams();

  const [q, setQ] = useSearchParams();
  const preselectBracket = q.get("bracketId") || "";
  const preselectRound = q.get("round") || null;

  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = String(userInfo?.role || "").toLowerCase() === "admin";

  // ===== NEW: state dialog controlled
  const [openGroupDlg, setOpenGroupDlg] = useState(false);

  /* ===== Queries: ép refetch, bỏ cache reuse ===== */
  const { data: allMatches = [], isLoading: lMatches } =
    useListTournamentMatchesQuery(
      { tournamentId },
      {
        skip: !tournamentId,
        refetchOnMountOrArgChange: true,
        refetchOnFocus: true,
        refetchOnReconnect: true,
        // RTKQ >= 1.9
        forceRefetch: () => true,
      }
    );

  const {
    data: tournament,
    isLoading: lt,
    error: et,
  } = useGetTournamentQuery(tournamentId, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
    forceRefetch: () => true,
  });

  const {
    data: brackets = [],
    isLoading: lb,
    error: eb,
  } = useListTournamentBracketsQuery(tournamentId, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
    forceRefetch: () => true,
  });

  const [startDraw, { isLoading: starting }] = useStartDrawMutation();
  const [drawNext, { isLoading: revealing }] = useDrawNextMutation();
  const [drawCommit, { isLoading: committing }] = useDrawCommitMutation();
  const [drawCancel, { isLoading: canceling }] = useDrawCancelMutation();

  const { data: regsData, isLoading: lRegs } = useGetRegistrationsQuery(
    tournamentId,
    {
      skip: !tournamentId,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
      forceRefetch: () => true,
    }
  );

  const [selBracketId, setSelBracketId] = useState(preselectBracket);
  const bracket =
    useMemo(
      () =>
        brackets.find((b) => String(b._id) === String(selBracketId)) || null,
      [brackets, selBracketId]
    ) || null;

  const { data: bracketDetail, refetch: refetchBracket } = useGetBracketQuery(
    selBracketId,
    {
      skip: !selBracketId,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
      forceRefetch: () => true,
    }
  );

  const { data: drawStatus, isLoading: ls } = useGetDrawStatusQuery(
    selBracketId,
    {
      skip: !selBracketId,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
      forceRefetch: () => true,
    }
  );

  const socket = useSocket();

  /* ===== URL helpers ===== */
  const updateURL = (patch = {}) => {
    const sp = new URLSearchParams(q);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") sp.delete(k);
      else sp.set(k, String(v));
    });
    setQ(sp, { replace: true });
  };

  /* ===== Derives ===== */
  const drawType = useMemo(() => {
    if (!bracket) return "knockout";
    if (["group", "gsl", "swiss"].includes(bracket.type)) return "group";
    return "knockout";
  }, [bracket]);

  // Reg index
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

  const firstRoundCode = useMemo(() => {
    if (!knockoutOptions?.length) return "F";
    return knockoutOptions.reduce((best, cur) => {
      const sb = sizeFromRoundCode(best.code);
      const sc = sizeFromRoundCode(cur.code);
      return sc > sb ? cur : best;
    }).code;
  }, [knockoutOptions]);

  const [roundCode, setRoundCode] = useState(preselectRound);
  const [roundTouched, setRoundTouched] = useState(Boolean(preselectRound));
  const [usePrevWinners, setUsePrevWinners] = useState(false);

  // Đồng bộ round default khi chưa chọn tay
  useEffect(() => {
    if (drawType !== "knockout") return;
    if (roundTouched) return;
    if (!roundCode && firstRoundCode) {
      setRoundCode(firstRoundCode);
    }
  }, [drawType, firstRoundCode, roundTouched, roundCode]);

  // Đồng bộ URL mỗi khi bracket/round thay đổi
  useEffect(() => {
    if (!selBracketId) return;
    updateURL({
      bracketId: selBracketId,
      round: drawType === "knockout" ? roundCode || firstRoundCode || "" : "",
    });
  }, [selBracketId, drawType, roundCode, firstRoundCode]); // eslint-disable-line

  // Auto chọn bracket đầu tiên nếu URL chưa có
  useEffect(() => {
    if (!selBracketId && brackets.length) {
      setSelBracketId(brackets[0]._id);
    }
  }, [brackets, selBracketId]);

  // Trạng thái phiên draw
  const [drawId, setDrawId] = useState(null);
  const [state, setState] = useState("idle"); // idle|running|committed|canceled
  const [reveals, setReveals] = useState([]);
  const [planned, setPlanned] = useState(null);
  const [log, setLog] = useState([]);

  // Reset khi đổi bracket
  useEffect(() => {
    if (!selBracketId) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [selBracketId]); // eslint-disable-line

  // Reset khi đổi vòng KO
  useEffect(() => {
    if (drawType !== "knockout") return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [roundCode, drawType]);

  // Đồng bộ trạng thái draw từ server
  useEffect(() => {
    if (!drawStatus) return;
    const s = drawStatus.state || "idle";
    if (s === "running") {
      setDrawId(drawStatus.drawId || null);
      setState("running");
      setReveals(Array.isArray(drawStatus.reveals) ? drawStatus.reveals : []);
    } else if (s === "canceled") {
      setDrawId(null);
      setState("idle");
      setReveals([]);
    } else {
      setDrawId(null);
      setState(s);
      setReveals([]);
    }
  }, [drawStatus]);

  // Socket subscribe (planned theo BRACKET)
  useEffect(() => {
    if (!socket || !selBracketId) return;
    socket.emit("draw:join", { bracketId: selBracketId });
    const onPlanned = (payload) => {
      setPlanned(payload);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "planned" }]));
    };
    socket.on("draw:planned", onPlanned);
    return () => {
      socket.off("draw:planned", onPlanned);
      socket.emit("draw:leave", { bracketId: selBracketId });
    };
  }, [socket, selBracketId]);

  // Socket subscribe (update theo DRAW)
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
      refetchBracket?.();
    };
    const onCanceled = () => {
      setState("canceled");
      setReveals([]);
      setDrawId(null);
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
  }, [socket, drawId, refetchBracket]);

  // Groups raw (persisted)
  const groupsRaw = useMemo(
    () => bracketDetail?.groups || bracket?.groups || [],
    [bracketDetail, bracket]
  );

  // ===== NEW: meta nhóm theo planned khi đang chạy nhưng chưa có persisted
  const plannedGroupsMeta = useMemo(() => {
    if (drawType !== "group") return [];
    const sizes =
      planned?.planned?.groupSizes ||
      planned?.groupSizes ||
      (Array.isArray(planned?.groups) ? planned.groups.map((g) => g.size) : []);
    if (!Array.isArray(sizes) || sizes.length === 0) return [];
    return sizes.map((size, idx) => ({
      code: String.fromCharCode(65 + idx),
      size: Number(size) || 0,
      regIds: [],
    }));
  }, [drawType, planned]);

  // ===== UPDATED: groupsMeta ưu tiên persisted; fallback planned khi running
  const groupsMeta = useMemo(() => {
    const persisted = (groupsRaw || [])
      .slice()
      .sort((a, b) =>
        String(a.name || a.code || "").localeCompare(
          String(b.name || b.code || ""),
          "vi",
          { numeric: true, sensitivity: "base" }
        )
      )
      .map((g, idx) => ({
        code: g.name || g.code || String.fromCharCode(65 + idx),
        size: Array.isArray(g.regIds) ? g.regIds.length : Number(g.size) || 0,
        regIds: Array.isArray(g.regIds) ? g.regIds : [],
      }));

    const persistedFilled = persisted.some(
      (g) => g.size > 0 || (g.regIds && g.regIds.length)
    );

    // 👇 ƯU TIÊN planned khi đang chạy (chưa commit)
    if (state === "running" && plannedGroupsMeta.length) {
      return plannedGroupsMeta;
    }

    // Sau khi commit/idle: nếu đã có dữ liệu lưu trên bracket thì dùng persisted
    if (persistedFilled) return persisted;

    // Fallback: nếu chưa có gì trên bracket mà đã có planned (ví dụ vừa start xong)
    if (plannedGroupsMeta.length) return plannedGroupsMeta;

    return persisted; // cuối cùng: có thể là mảng rỗng
  }, [groupsRaw, state, plannedGroupsMeta]);

  const hasGroups = useMemo(() => (groupsMeta?.length || 0) > 0, [groupsMeta]);

  // KO data
  const selectedRoundNumber = useMemo(() => {
    const opt = knockoutOptions.find((o) => o.code === roundCode);
    return opt?.roundNumber ?? 1;
  }, [knockoutOptions, roundCode]);

  const koMatchesThisBracket = useMemo(
    () =>
      (allMatches || []).filter(
        (m) =>
          String(m.bracket?._id || m.bracket) === String(selBracketId) &&
          String(bracket?.type || "").toLowerCase() !== "group"
      ),
    [allMatches, selBracketId, bracket]
  );

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

  const revealsForGroup = useMemo(() => {
    if (state === "running" && Array.isArray(reveals) && reveals.length) {
      return reveals;
    }
    const out = [];
    (groupsMeta || []).forEach((g) => {
      const ids = Array.isArray(g.regIds) ? g.regIds : [];
      ids.forEach((ridRaw) => {
        const rid = asId(ridRaw);
        out.push({ group: g.code, groupCode: g.code, regId: rid });
      });
    });
    return out;
  }, [state, reveals, groupsMeta]);

  /* ====== Unique keys to force remounts ====== */
  const brChartKey = useMemo(
    () =>
      `br-${selBracketId}-${roundCode}-${selectedRoundNumber}-${state}-${
        Array.isArray(revealsForKO) ? revealsForKO.length : 0
      }-${koMatchesThisBracket.length}`,
    [
      selBracketId,
      roundCode,
      selectedRoundNumber,
      state,
      revealsForKO,
      koMatchesThisBracket.length,
    ]
  );

  // NEW: force remount group board when planned/reveals change
  const groupBoardKey = useMemo(() => {
    const sizes = planned?.planned?.groupSizes || planned?.groupSizes || [];
    const sig = Array.isArray(sizes) ? sizes.join("-") : "none";
    const rv = Array.isArray(reveals) ? reveals.length : 0;
    return `grp-${selBracketId}-${state}-${sig}-${rv}`;
  }, [selBracketId, state, planned, reveals]);

  /* ====== Build rounds for KO ====== */
  function buildRoundsForKO({
    roundCode,
    reveals,
    matches,
    eventType,
    selectedRoundNumber,
    selBracketId,
  }) {
    const size = sizeFromRoundCode(roundCode);
    const roundsFromSize = Math.max(1, Math.log2(size) | 0);
    const lastRoundBySize = selectedRoundNumber + roundsFromSize - 1;

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

    const countByRoundReal = {};
    real.forEach((m) => {
      const r = m.round || 1;
      countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
    });

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

    const rounds = [];
    for (let r = firstRound; r <= lastRound; r++) {
      const need = seedsCount[r] || 1;
      const seeds = Array.from({ length: need }, (_, i) => ({
        id: `ph-${selBracketId}-${r}-${i}`, // UNIQUE
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
            id: m._id || `${selBracketId}-${r}-${i}`, // UNIQUE
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
            id: `rv-${selBracketId}-${r}-${i}`, // UNIQUE
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

  /* ===== Handlers ===== */
  const canOperate = Boolean(drawId && state === "running");
  const onStart = async () => {
    if (!selBracketId) return;
    try {
      const body =
        drawType === "group"
          ? { mode: "group" }
          : {
              mode: "knockout",
              round: roundCode || firstRoundCode,
              usePrevWinners,
            };
      const resp = await startDraw({ bracketId: selBracketId, body }).unwrap();
      setDrawId(resp?.drawId);
      setState(resp?.state || "running");
      setReveals(Array.isArray(resp?.reveals) ? resp.reveals : []);
      // NEW: nếu backend trả planned thì set luôn, không cần đợi socket
      if (resp?.planned) setPlanned(resp);
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
      setDrawId(null);
      setState("idle");
      setReveals([]);
      toast.success("Đã huỷ phiên bốc. Bạn có thể bắt đầu phiên mới.");
      setLog((lg) => lg.concat([{ t: Date.now(), type: "cancel" }]));
    } catch (e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:cancel" }]));
    }
  };

  const eventType = tournament?.eventType?.toLowerCase()?.includes("single")
    ? "single"
    : "double";

  /* ===== Render ===== */
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
        key={`${selBracketId}-${
          drawType === "knockout" ? roundCode || firstRoundCode : "group"
        }`}
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
                onChange={(e) => {
                  const id = e.target.value;
                  setSelBracketId(id);
                }}
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
                  value={roundCode || ""}
                  onChange={(e) => {
                    setRoundTouched(true);
                    setRoundCode(e.target.value);
                  }}
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
                key={groupBoardKey}
                groupsMeta={groupsMeta}
                reveals={revealsForGroup}
                regIndex={regIndex}
                eventType={eventType}
              />
            ) : (
              <Typography color="text.secondary">
                Chưa có thông tin bảng/slot để hiển thị.
              </Typography>
            )
          ) : (
            <Box
              key={`${brChartKey}-wrap`}
              sx={{ overflowX: "auto", pb: 1, position: "relative" }}
            >
              <Bracket
                key={brChartKey}
                rounds={buildRoundsForKO({
                  roundCode: roundCode || firstRoundCode,
                  reveals: state === "running" ? revealsForKO : [],
                  matches: koMatchesThisBracket,
                  eventType,
                  selectedRoundNumber,
                  selBracketId,
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

      {/* Dialog: Group matches (controlled) */}
      <GroupMatchesDialog
        open={openGroupDlg}
        onClose={() => setOpenGroupDlg(false)}
        groupsMeta={groupsMeta}
        regIndex={regIndex}
        selBracketId={selBracketId}
      />
    </RBContainer>
  );
}

/* ====== Dialog bốc thăm trận trong bảng (controlled) ====== */
function GroupMatchesDialog({
  open,
  onClose,
  groupsMeta,
  regIndex,
  selBracketId,
}) {
  const [tabMode, setTabMode] = useState("auto");
  const [doubleRound, setDoubleRound] = useState(false); // ⬅️ NEW
  const [generateGroupMatches, { isLoading: genLoading }] =
    useGenerateGroupMatchesMutation();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Bốc thăm trận trong bảng</DialogTitle>
      <DialogContent dividers>
        <Tabs value={tabMode} onChange={(_, v) => setTabMode(v)} sx={{ mb: 2 }}>
          <Tab value="auto" label="Tự động (vòng tròn)" />
          <Tab value="manual" label="Thủ công (ghép cặp)" />
        </Tabs>

        {tabMode === "auto" && (
          <FormControlLabel
            sx={{ mb: 2 }}
            control={
              <Checkbox
                checked={doubleRound}
                onChange={(e) => setDoubleRound(e.target.checked)}
              />
            }
            label="Đánh 2 lượt (home–away)"
          />
        )}

        {tabMode === "auto" ? (
          groupsMeta.length ? (
            <RoundRobinPreview
              groupsMeta={groupsMeta}
              regIndex={regIndex}
              doubleRound={doubleRound} // ⬅️ NEW
            />
          ) : (
            <Alert severity="info">
              Chưa có dữ liệu bảng để tạo preview vòng tròn.
            </Alert>
          )
        ) : (
          <Alert severity="info">UI thủ công sẽ thêm sau.</Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
        <Button
          onClick={async () => {
            try {
              if (!selBracketId) return;
              if (tabMode === "auto") {
                await generateGroupMatches({
                  bracketId: selBracketId,
                  mode: "auto",
                  doubleRound, // ⬅️ NEW: gửi xuống BE
                }).unwrap();
              } else {
                await generateGroupMatches({
                  bracketId: selBracketId,
                  mode: "manual",
                  matches: [],
                }).unwrap();
              }
              toast.success("Đã tạo trận trong bảng.");
              onClose();
            } catch (e) {
              toast.error(e?.data?.message || e?.error || "Tạo trận thất bại.");
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
  );
}
