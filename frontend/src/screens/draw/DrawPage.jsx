// DrawPage.jsx — add Card-Deck draw mode (Classic/Card), deal & flip animations, KO=flip 2 to pair; Group=flip 1 and auto-seat per cursor. Pool still disappears immediately after drawNext; Group board reads board.groups[*].slots (fallback groupsMeta+reveals).
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  memo,
} from "react";
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
  Switch,
  IconButton,
  Tooltip,
  Autocomplete,
  TextField,
  Fade,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import CelebrationIcon from "@mui/icons-material/Celebration";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import CloseIcon from "@mui/icons-material/Close";
import { Container as RBContainer } from "react-bootstrap";
import { Bracket, Seed, SeedItem, SeedTeam } from "react-brackets";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link as RouterLink,
} from "react-router-dom";
import { useSelector } from "react-redux";
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
  useAssignByesMutation,
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";
import PublicProfileDialog from "../../components/PublicProfileDialog";

/********************** FX helpers **********************/
// Ưu tiên server cursor; nếu không, suy từ slots hoặc reveals
function inferNextGroupCursor(board, groupsMeta, reveals) {
  const norm = (s) =>
    String(s ?? "")
      .trim()
      .toUpperCase();

  // 1) Server có cursor/next → dùng ngay
  const srv = board?.cursor || board?.next;
  if (srv && srv.groupCode != null) {
    const si = Number(srv.slotIndex ?? 0);
    return {
      groupCode: srv.groupCode,
      slotIndex: Number.isFinite(si) ? si : 0,
    };
  }

  // 2) Chuẩn bị danh sách bảng và kích thước kỳ vọng
  let groups = [];
  if (Array.isArray(board?.groups) && board.groups.length) {
    groups = board.groups.map((g, gi) => ({
      code: g?.key || g?.code || String.fromCharCode(65 + gi),
      slots: Array.isArray(g?.slots) ? g.slots : [],
    }));
  } else if (Array.isArray(groupsMeta) && groupsMeta.length) {
    groups = groupsMeta.map((g, gi) => ({
      code: g?.code || String.fromCharCode(65 + gi),
      slots: Array.from({ length: Number(g?.size) || 0 }, () => null),
    }));
  } else {
    return null;
  }

  // Map kích thước mong muốn theo meta
  const sizeMap = new Map();
  (groupsMeta || []).forEach((g, gi) => {
    const code = g?.code || String.fromCharCode(65 + gi);
    sizeMap.set(norm(code), Number(g?.size) || 0);
  });

  // Đếm số đã seat theo reveals (fallback khi slots trống/không cập nhật)
  const revealedByGroup = new Map();
  (reveals || []).forEach((rv) => {
    const key =
      rv?.groupCode ||
      rv?.groupKey ||
      (typeof rv?.group === "string" ? rv.group : "");
    const k = norm(key);
    if (!k) return;
    revealedByGroup.set(k, (revealedByGroup.get(k) || 0) + 1);
  });

  // 3) Tìm bảng đầu tiên còn chỗ trống
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const code = g.code;
    const k = norm(code);

    const slots = Array.isArray(g.slots) ? g.slots : [];
    const size = (slots.length ? slots.length : 0) || sizeMap.get(k) || 0;

    // ưu tiên đếm theo slots nếu slots có dữ liệu, ngược lại dùng reveals
    const seatedFromSlots = slots.length ? slots.filter(Boolean).length : null;
    const seated =
      seatedFromSlots != null ? seatedFromSlots : revealedByGroup.get(k) || 0;

    if (size > 0 && seated < size) {
      return { groupCode: code, slotIndex: seated };
    }
  }
  return null;
}

function useAudioCue(enabled) {
  const ctxRef = useRef(null);
  const ensure = () => {
    if (!enabled) return null;
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) ctxRef.current = new Ctx();
    }
    return ctxRef.current;
  };
  const beep = useCallback(
    (freq = 880, duration = 0.12, type = "triangle", gain = 0.02) => {
      const ctx = ensure();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime;
      osc.start(t);
      osc.stop(t + duration);
    },
    [enabled]
  );
  return { beep };
}
async function fireConfettiBurst() {
  try {
    const mod = await import(
      /* webpackIgnore: true */ "https://cdn.skypack.dev/canvas-confetti"
    );
    const confetti = mod.default || mod;
    confetti({ particleCount: 140, spread: 70, origin: { y: 0.6 } });
    setTimeout(
      () =>
        confetti({
          particleCount: 100,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
        }),
      180
    );
    setTimeout(
      () =>
        confetti({
          particleCount: 100,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
        }),
      180
    );
  } catch {}
}

/********************** utils **********************/
const labelBracketType = (b) => {
  switch (b?.type) {
    case "group":
      return "Vòng bảng";
    case "knockout":
      return "Knockout";
    case "roundElim":
      return "Play-off (Round Elim)";
    case "double_elim":
      return "Double Elimination";
    case "swiss":
      return "Swiss System";
    case "gsl":
      return "GSL";
    default:
      return b?.type || "—";
  }
};
const nameFromPlayer = (p) => p?.nickName || p?.fullName || p?.name || "N/A";
const safePairName = (reg, evType = "double") => {
  if (!reg) return "—";
  const p1 = nameFromPlayer(reg?.player1);
  if (evType === "single") return p1 || "—";
  const hasP2 = !!reg?.player2;
  if (!hasP2) return p1 || "—";
  const p2 = nameFromPlayer(reg?.player2);
  return p2 && p2 !== "N/A" ? `${p1} & ${p2}` : p1 || "—";
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
const nextPow2 = (n) => {
  let p = 1;
  const need = Math.max(2, n | 0);
  while (p < need) p <<= 1;
  return p;
};
const codeLabelForSize = (size) => {
  if (size === 2) return { code: "F", label: "Chung kết (F)" };
  if (size === 4) return { code: "SF", label: "Bán kết (SF)" };
  if (size === 8) return { code: "QF", label: "Tứ kết (QF)" };
  const denom = Math.max(2, size / 2);
  return { code: `R${size}`, label: `Vòng 1/${denom} (R${size})` };
};
const buildKnockoutOptions = (teamCount) => {
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
};

/********************** Pool (đội chờ bốc) **********************/
const PoolPanel = memo(function PoolPanel({
  title = "Pool đội chờ bốc",
  eventType,
  regIndex,
  poolIds,
  revealsGroup,
}) {
  const poolItems = useMemo(() => {
    if (Array.isArray(poolIds)) {
      return poolIds
        .map((id) => {
          const str = String(id);
          const reg = regIndex?.get(str);
          return {
            id: str,
            label: safePairName(reg, eventType) || `#${str.slice(-6)}`,
          };
        })
        .sort((a, b) =>
          a.label.localeCompare(b.label, "vi", { sensitivity: "base" })
        );
    }
    const revealed = new Set(
      (revealsGroup || []).map((rv) => {
        const id =
          (rv && (rv.regId || rv.reg || rv.id || rv._id)) ??
          rv?.pair?.registration ??
          null;
        const normId = typeof id === "object" ? id?._id || id?.id : id;
        return String(normId || "");
      })
    );
    const arr = [];
    regIndex?.forEach((reg, id) => {
      if (!revealed.has(String(id))) {
        arr.push({ id: String(id), label: safePairName(reg, eventType) });
      }
    });
    return arr.sort((a, b) =>
      a.label.localeCompare(b.label, "vi", { sensitivity: "base" })
    );
  }, [poolIds, revealsGroup, regIndex, eventType]);

  const [items, setItems] = useState(poolItems);
  const disappearingRef = useRef(new Set());
  const prevSetRef = useRef(new Set(poolItems.map((i) => i.id)));

  useEffect(() => {
    const next = poolItems;
    const nextSet = new Set(next.map((i) => i.id));
    const prevSet = prevSetRef.current;

    const removed = [...prevSet].filter((id) => !nextSet.has(id));
    if (removed.length) {
      removed.forEach((id) => disappearingRef.current.add(id));
      const t = setTimeout(() => {
        setItems(next);
        removed.forEach((id) => disappearingRef.current.delete(id));
        prevSetRef.current = new Set(next.map((i) => i.id));
      }, 420);
      return () => clearTimeout(t);
    }
    setItems(next);
    prevSetRef.current = nextSet;
  }, [poolItems]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography fontWeight={700}>{title}</Typography>
        <Chip size="small" label={`Còn lại: ${items.length}`} />
      </Stack>

      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Pool trống.
        </Typography>
      ) : (
        <Stack
          spacing={0.75}
          sx={{ maxHeight: 360, overflowY: "auto", pr: 0.5 }}
        >
          {items.map((it) => {
            const fading = disappearingRef.current.has(it.id);
            return (
              <Fade
                key={it.id}
                in={!fading}
                timeout={{ enter: 180, exit: 420 }}
              >
                <Box
                  sx={{
                    p: 1,
                    border: "1px dashed #e5e7eb",
                    borderRadius: 1,
                    background: "#fafafa",
                    transition: "transform .28s ease",
                    "&:hover": { transform: "translateY(-1px)" },
                  }}
                >
                  <Typography variant="body2">{it.label}</Typography>
                </Box>
              </Fade>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
});

/********************** Group seating (ưu tiên board.groups[*].slots) **********************/
const GroupSeatingBoard = memo(function GroupSeatingBoard({
  board,
  groupsMeta,
  reveals,
  regIndex,
  eventType,
  lastHighlight,
}) {
  if (board && Array.isArray(board.groups) && board.groups.length > 0) {
    return (
      <Grid container spacing={2}>
        {board.groups.map((g, gi) => {
          const code = g?.key || g?.code || String.fromCharCode(65 + gi);
          const slots = Array.isArray(g?.slots) ? g.slots : [];
          return (
            <Grid item xs={12} sm={6} md={4} lg={3} key={code}>
              <Card variant="outlined" sx={{ p: 1.5 }}>
                <Typography fontWeight={700} sx={{ mb: 1 }}>
                  Bảng {code}
                </Typography>
                <Stack spacing={0.75}>
                  {slots.map((regId, si) => {
                    const reg = regId ? regIndex?.get(String(regId)) : null;
                    const name = regId ? safePairName(reg, eventType) : "—";
                    const isHit =
                      lastHighlight &&
                      lastHighlight.type === "group" &&
                      norm(lastHighlight.groupCode) === norm(code) &&
                      lastHighlight.slotIndex === si;
                    return (
                      <Box
                        key={`${code}-${si}`}
                        sx={{
                          p: 1,
                          border: "1px dashed #ddd",
                          borderRadius: 1,
                          backgroundColor: regId
                            ? isHit
                              ? "#f0fff4"
                              : "#f8fbff"
                            : "#fafafa",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        {isHit && (
                          <Box
                            sx={{
                              position: "absolute",
                              inset: 0,
                              background:
                                "radial-gradient(ellipse at center, rgba(0,200,83,0.22), transparent 60%)",
                              animation: "pulseGlow 1.2s ease-out 2",
                              pointerEvents: "none",
                            }}
                          />
                        )}
                        <Typography variant="body2">
                          <b>Slot {si + 1}:</b> {name}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              </Card>
            </Grid>
          );
        })}
        <style>{`@keyframes pulseGlow { 0%{opacity:0} 50%{opacity:1} 100%{opacity:0} }`}</style>
      </Grid>
    );
  }

  // Fallback từ groupsMeta + reveals
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
      const rid =
        asId(rv.regId) ||
        asId(rv.reg) ||
        asId(rv.registration) ||
        asId(rv.id) ||
        asId(rv._id);
      const regDoc =
        rid && regIndex?.get(String(rid)) ? regIndex.get(String(rid)) : null;

      const p1 =
        rv.player1 ||
        rv.user1 ||
        rv.A ||
        rv?.pair?.player1 ||
        rv?.pairA?.player1;
      const p2 =
        rv.player2 ||
        rv.user2 ||
        rv.B ||
        rv?.pair?.player2 ||
        rv?.pairB?.player2;

      const nm =
        (regDoc && safePairName(regDoc, eventType)) ||
        (eventType === "single"
          ? (p1 && nameFromPlayer(p1)) || null
          : [p1, p2].filter(Boolean).map(nameFromPlayer).join(" & ")) ||
        rv.nickName ||
        rv.teamName ||
        rv.name ||
        rv.team ||
        rv.displayName ||
        rv.AName ||
        rv.BName ||
        "—";

      const g = map.get(norm(key));
      if (g) {
        const slot = g.slots.findIndex((x) => !x);
        if (slot >= 0) g.slots[slot] = { label: nm, reg: regDoc, p1, p2 };
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
              {g.slots.map((val, idx) => {
                const isHit =
                  lastHighlight &&
                  lastHighlight.type === "group" &&
                  lastHighlight.groupCode === g.code &&
                  lastHighlight.slotIndex === idx;
                return (
                  <Box
                    key={idx}
                    sx={{
                      p: 1,
                      border: "1px dashed #ddd",
                      borderRadius: 1,
                      backgroundColor: val
                        ? isHit
                          ? "#f0fff4"
                          : "#f8fbff"
                        : "#fafafa",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {isHit && (
                      <Box
                        sx={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "radial-gradient(ellipse at center, rgba(0,200,83,0.22), transparent 60%)",
                          animation: "pulseGlow 1.2s ease-out 2",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    <Typography variant="body2">
                      <b>Slot {idx + 1}:</b> {val?.label ?? "—"}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </Card>
        </Grid>
      ))}
      <style>{`@keyframes pulseGlow { 0%{opacity:0} 50%{opacity:1} 100%{opacity:0} }`}</style>
    </Grid>
  );
});

/********************** Round-robin preview **********************/
const buildRR = (teams) => {
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
      const A = left[i],
        B = right[i];
      if (A !== "(BYE)" && B !== "(BYE)") pairs.push({ A, B });
    }
    schedule.push(pairs);
    rot = [rot[rot.length - 1]].concat(rot.slice(0, rot.length - 1));
  }
  return schedule;
};
const RoundRobinPreview = memo(function RoundRobinPreview({
  groupsMeta,
  regIndex,
  doubleRound = false,
}) {
  return (
    <Stack spacing={2}>
      {groupsMeta.map((g) => {
        const teamNames = (g.regIds || []).map((rid) => {
          const reg = regIndex?.get(String(rid));
          return reg
            ? reg.player2
              ? `${
                  reg.player1?.nickName ||
                  reg.player1?.fullName ||
                  reg.player1?.name
                } & ${
                  reg.player2?.nickName ||
                  reg.player2?.fullName ||
                  reg.player2?.name
                }`
              : reg.player1?.nickName ||
                reg.player1?.fullName ||
                reg.player1?.name
            : typeof rid === "string"
            ? `#${String(rid).slice(-6)}`
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
});

/********************** KO render helpers **********************/
const buildPlayoffOptions = (bracket, bracketDetail, regsCount) => {
  const pairs1 =
    Number(bracketDetail?.meta?.expectedFirstRoundMatches) ||
    Number(bracket?.meta?.expectedFirstRoundMatches) ||
    (Array.isArray(bracketDetail?.prefill?.seeds)
      ? bracketDetail.prefill.seeds.length
      : 0) ||
    (Array.isArray(bracket?.prefill?.seeds)
      ? bracket.prefill.seeds.length
      : 0) ||
    Math.max(1, Math.floor((Number(regsCount) || 0) / 2));

  const maxRounds =
    Number(bracketDetail?.meta?.maxRounds) ||
    Number(bracket?.meta?.maxRounds) ||
    Number(bracketDetail?.ko?.rounds) ||
    Number(bracket?.ko?.rounds) ||
    Math.max(1, Math.ceil(Math.log2(Math.max(1, pairs1))));

  const out = [];
  let pairs = pairs1;
  for (let r = 1; r <= maxRounds; r++) {
    const teams = Math.max(2, pairs * 2);
    out.push({
      code: `R${teams}`,
      label: `Vòng ${r}`,
      roundNumber: r,
      pairCount: pairs,
    });
    pairs = Math.floor(pairs / 2);
    if (pairs <= 0) break;
  }
  return out;
};

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
  const prev = side === "A" ? m?.previousA : m?.previousB;
  const pair = side === "A" ? m?.pairA : m?.pairB;
  if (pair) return safePairName(pair, eventType);
  if (prev) return labelDep(prev);
  return "Chưa có đội";
};
const CustomSeed = memo(function CustomSeed({ seed, breakpoint }) {
  const nameA = seed?.teams?.[0]?.name || "Chưa có đội";
  const nameB = seed?.teams?.[1]?.name || "Chưa có đội";
  const nodeA = seed?.teams?.[0]?.node;
  const nodeB = seed?.teams?.[1]?.node;
  const ITEM_HEIGHT = 100;
  const teamStyle = {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: "18px",
  };
  return (
    <Seed mobileBreakpoint={breakpoint} style={{ fontSize: 13 }}>
      <SeedItem
        style={{
          padding: 8,
          height: ITEM_HEIGHT,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "grid",
            width: "100%",
            gap: 4,
            gridTemplateRows: "1fr 1fr",
          }}
        >
          <SeedTeam title={nameA} style={teamStyle}>
            <Tooltip title={nameA} arrow placement="top">
              <span style={{ display: "block" }}>{nodeA ?? nameA}</span>
            </Tooltip>
          </SeedTeam>
          <SeedTeam title={nameB} style={teamStyle}>
            <Tooltip title={nameB} arrow placement="bottom">
              <span style={{ display: "block" }}>{nodeB ?? nameB}</span>
            </Tooltip>
          </SeedTeam>
        </div>
      </SeedItem>
    </Seed>
  );
});
const seedRenderer = (...args) => {
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === "object" &&
    ("seed" in args[0] || "teams" in (args[0]?.seed || {}))
  ) {
    return <CustomSeed {...args[0]} />;
  }
  const seed = args[0];
  const maybeObj = args[1];
  const breakpoint =
    typeof maybeObj === "number" ? maybeObj : maybeObj?.breakpoint ?? 0;
  return <CustomSeed seed={seed} breakpoint={breakpoint} />;
};

/********************** Live FX overlays (Classic) **********************/
const useNamesPool = (regIndex, eventType) =>
  useMemo(() => {
    const arr = [];
    regIndex?.forEach((reg) => arr.push(safePairName(reg, eventType)));
    if (!arr.length) return ["—", "—", "—", "—"];
    return arr;
  }, [regIndex, eventType]);

const Ticker = memo(function Ticker({
  finalText,
  pool,
  duration = 1200,
  onDone,
  size = "42px",
  weight = 800,
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    let mounted = true;
    const fps = 18;
    const itv = setInterval(() => {
      if (!mounted) return;
      setText(pool[Math.floor(Math.random() * pool.length)]);
    }, 1000 / fps);
    const t = setTimeout(() => {
      if (!mounted) return;
      clearInterval(itv);
      setText(finalText);
      onDone?.();
    }, duration);
    return () => {
      mounted = false;
      clearInterval(itv);
      clearTimeout(t);
    };
  }, [finalText, pool, duration, onDone]);
  return (
    <Box
      sx={{
        fontSize: size,
        fontWeight: weight,
        letterSpacing: 0.2,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </Box>
  );
});

const CountdownSplash = memo(function CountdownSplash({ seconds = 3, onDone }) {
  const [n, setN] = useState(seconds);
  useEffect(() => {
    let i = seconds;
    setN(i);
    const tick = setInterval(() => {
      i -= 1;
      setN(i);
      if (i <= 0) {
        clearInterval(tick);
        onDone?.();
      }
    }, 750);
    return () => clearInterval(tick);
  }, [seconds, onDone]);
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        backdropFilter: "blur(2px)",
      }}
    >
      <Box
        sx={{
          fontSize: n > 0 ? 160 : 48,
          fontWeight: 900,
          animation:
            n > 0 ? "popIn 0.75s ease-out" : "fadeOut 0.4s ease-in forwards",
          textAlign: "center",
        }}
      >
        {n > 0 ? n : "BẮT ĐẦU!"}
      </Box>
      <style>{`
        @keyframes popIn { 0%{ transform: scale(0.6); opacity: 0 } 70%{ transform: scale(1.05); opacity: 1 } 100%{ transform: scale(1); } }
        @keyframes fadeOut { to { opacity: 0; transform: translateY(-6px) } }
      `}</style>
    </Box>
  );
});

const RevealOverlay = memo(function RevealOverlay({
  open,
  mode,
  data,
  pool,
  muted,
  onClose,
  onAfterShow,
  autoCloseMs = 120,
}) {
  const { beep } = useAudioCue(!muted);
  const closeRef = useRef();
  const scheduleAutoClose = useCallback(() => {
    if (!autoCloseMs) return;
    clearTimeout(closeRef.current);
    closeRef.current = setTimeout(() => onClose?.(), autoCloseMs);
  }, [autoCloseMs, onClose]);

  useEffect(() => () => clearTimeout(closeRef.current), []);
  useEffect(() => {
    if (!open) return;
    setTimeout(() => beep(880, 0.08), 120);
    setTimeout(() => beep(940, 0.08), 280);
    setTimeout(() => beep(990, 0.08), 420);
  }, [open, beep]);

  if (!open) return null;
  const isGroup = mode === "group";

  return (
    <Box
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.75)",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      <Box
        sx={{
          width: "min(1100px, 92vw)",
          p: { xs: 2, sm: 4 },
          borderRadius: 3,
          bgcolor: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 70px rgba(0,0,0,0.5)",
          textAlign: "center",
        }}
      >
        {isGroup ? (
          <>
            <Typography sx={{ opacity: 0.9, mb: 1, letterSpacing: 1 }}>
              BỐC VÀO BẢNG
            </Typography>
            <Box
              sx={{
                display: "flex",
                gap: 2,
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
                flexWrap: "wrap",
              }}
            >
              <Box
                sx={{
                  px: 2.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  fontSize: 18,
                }}
              >
                Bảng <b style={{ fontSize: 24 }}>{data.groupCode}</b>
              </Box>
              <Box
                sx={{
                  px: 2.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  fontSize: 18,
                }}
              >
                Slot <b style={{ fontSize: 24 }}>{data.slotIndex + 1}</b>
              </Box>
            </Box>
            <Ticker
              finalText={data.teamName}
              pool={pool}
              duration={1200}
              onDone={() => {
                onAfterShow?.();
                scheduleAutoClose();
              }}
            />
          </>
        ) : (
          <>
            <Typography sx={{ opacity: 0.9, mb: 1, letterSpacing: 1 }}>
              CẶP ĐẤU
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr auto 1fr" },
                alignItems: "center",
                gap: 2,
              }}
            >
              <Ticker finalText={data.AName} pool={pool} duration={1100} />
              <Box sx={{ fontWeight: 900, fontSize: 44, opacity: 0.9, mx: 2 }}>
                VS
              </Box>
              <Ticker
                finalText={data.BName}
                pool={pool}
                duration={1300}
                onDone={() => {
                  onAfterShow?.();
                  scheduleAutoClose();
                }}
              />
            </Box>
          </>
        )}
        <Typography
          variant="caption"
          sx={{ opacity: 0.7, display: "block", mt: 2 }}
        >
          Nhấn để đóng lớp hiệu ứng
        </Typography>
      </Box>
    </Box>
  );
});

/********************** CARD MODE OVERLAY **********************/
// ===== CardDeckOverlay.jsx (inline trong DrawPage.jsx cũng được) =====

/**
 * Props:
 * - open, onClose
 * - mode: 'group' | 'ko'
 * - cards: [{ id, label }]  // label = tên đội trong pool hiện tại (KHÔNG hiển thị mặt sau)
 * - onFlipOne: () => Promise<string|null>  // gọi drawNext; trả về tên đội vừa bốc
 * - muted?: boolean
 */
// ===== CardDeckOverlay.jsx (REPLACE TOÀN BỘ) =====
const CardDeckOverlay = memo(function CardDeckOverlay({
  open,
  onClose,
  mode = "group", // 'group' | 'ko'
  cards = [], // [{ id, label }]
  onFlipOne, // () => Promise<{name, meta?} | string | null>
  muted = false,
  reveals,
  targetInfo, // { groupCode, slotIndex } | null
}) {
  const HEADER_H = 52;
  // Bảng màu cơ bản + sinh màu vô hạn (không trùng) bằng golden-angle
  const pairPalette = useMemo(
    () => [
      "#00BCD4",
      "#FF9800",
      "#8BC34A",
      "#E91E63",
      "#9C27B0",
      "#3F51B5",
      "#FF5722",
      "#009688",
    ],
    []
  );
  const getDistinctPairColor = useCallback(
    (id) => {
      if (id < pairPalette.length) return pairPalette[id];
      const hue = (id * 137.508) % 360; // golden-angle
      return `hsl(${hue} 75% 55%)`;
    },
    [pairPalette]
  );

  // Snapshot deck khi mở overlay
  const initialDeck = useMemo(
    () =>
      cards.map((c, i) => ({
        key: c.id || `${i}`,
        label: null, // tên sau khi flip
        flipped: false, // đã lật?
        meta: null, // {type:'group'|'ko', groupCode, slotIndex, side, pairIndex}
        pairId: null, // id cặp (KO/PO)
        pairColor: null, // màu viền cặp
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  const [deck, setDeck] = useState(initialDeck);

  const initialCountRef = useRef(initialDeck.length);
  useEffect(() => {
    if (open) {
      setDeck(initialDeck);
      initialCountRef.current = initialDeck.length;
    }
  }, [open, initialDeck]);

  // layout grid cố định theo tổng số thẻ ban đầu
  const gridRef = useRef(null);
  const [layout, setLayout] = useState({
    cols: 1,
    rows: initialCountRef.current || 1,
    w: 120,
    h: 168,
    gap: 12,
  });

  // bên trong CardDeckOverlay
  const slots =
    layout.slots || layout.rows * layout.cols || initialCountRef.current;

  const displayDeck = useMemo(() => {
    const N = deck.length;
    if (N >= slots) return deck.slice(0, slots);
    const pad = Array.from({ length: slots - N }, (_, i) => ({
      key: `ghost-${i}`,
      label: "", // hiển thị trống
      flipped: true, // mặt trước để giữ viền/khung, nhưng không nội dung
      meta: null,
      pairId: null,
      pairColor: null,
      ghost: true, // cờ nhận diện ô trống
    }));
    return deck.concat(pad);
  }, [deck, slots]);
  // đặt trong CardDeckOverlay
  const pickGridRectangle = (N, W, H, GAP, AR) => {
    let M = N % 2 === 1 ? N + 1 : N; // nếu lẻ → cộng 1
    let best = null;

    // duyệt quanh phương án tốt (M..M+6) để dễ tìm lưới gần-vuông nhất nhưng vẫn fit
    for (let m = M; m <= M + 6; m++) {
      const r0 = Math.floor(Math.sqrt(m));
      for (let r = Math.max(1, r0 - 2); r <= r0 + 2; r++) {
        const c = Math.ceil(m / r);

        const widthLimit = (W - GAP * (c - 1)) / c;
        const heightLimit = (H - GAP * (r - 1)) / r;
        if (widthLimit <= 0 || heightLimit <= 0) continue;

        // thẻ phải fit cả chiều rộng và chiều cao
        const cardH = Math.min(heightLimit, widthLimit / AR);
        const cardW = cardH * AR;
        if (cardH <= 0 || cardW <= 0) continue;

        const score = cardH * cardW; // ưu tiên thẻ to nhất (vẫn fit)
        const cand = { rows: r, cols: c, w: cardW, h: cardH, m };
        if (!best || score > best.w * best.h) best = cand;
      }
    }
    return best;
  };

  const computeLayout = useCallback(() => {
    const GAP = 12,
      AR = 130 / 180; // w/h thẻ
    const el = gridRef.current;
    if (!el) return;

    const W = el.clientWidth || window.innerWidth || 0;
    // nếu overlay nằm trong flex:1 mà clientHeight=0 (hiếm), fallback chiều cao màn hình trừ header
    const headerH = 56; // ước lượng header của overlay
    const H =
      el.clientHeight && el.clientHeight > 0
        ? el.clientHeight
        : Math.max(200, (window.innerHeight || 0) - headerH - 24);

    const N = Math.max(1, initialCountRef.current || cards.length || 1);
    const best = pickGridRectangle(N, W, H, GAP, AR);
    if (best) {
      setLayout({
        cols: best.cols,
        rows: best.rows,
        w: Math.floor(best.w),
        h: Math.floor(best.h),
        gap: GAP,
        slots: best.rows * best.cols, // tổng ô cố định của lưới
      });
    }
  }, [cards.length]);

  useEffect(() => {
    if (!open) return;
    computeLayout();
    const obs = new ResizeObserver(() => computeLayout());
    gridRef.current && obs.observe(gridRef.current);
    const onWin = () => computeLayout();
    window.addEventListener("resize", onWin);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", onWin);
    };
  }, [open, computeLayout]);

  // Ghép cặp KO: lưu 2 index đã lật, set viền cùng màu
  const [pairBuffer, setPairBuffer] = useState([]); // [{idx, name}]
  const [pairCount, setPairCount] = useState(0); // tăng dần → màu mới
  const [pairLinks, setPairLinks] = useState({}); // pairId -> [idxA, idxB]
  const [lastPair, setLastPair] = useState(null);
  useEffect(() => {
    if (open) {
      setPairBuffer([]);
      setPairCount(0);
      setLastPair(null);
      setPairLinks({});
    }
  }, [open, mode]);

  // Hover: sáng thẻ và “đối tác” nếu có
  const [hoverIdx, setHoverIdx] = useState(null);
  const setHover = useCallback((i) => setHoverIdx(i), []);
  const clearHover = useCallback(() => setHoverIdx(null), []);

  const [busy, setBusy] = useState(false);

  // Lật 1 thẻ
  const flipCard = useCallback(
    async (idx) => {
      setDeck((d) => {
        const c = d[idx];
        if (!c || c.flipped) return d;
        const next = d.slice();
        next[idx] = { ...c, flipped: true };
        return next;
      });

      try {
        setBusy(true);
        const res = await onFlipOne?.();
        const obj = res && typeof res === "object" ? res : { name: res };
        const teamName = obj?.name ?? "—";
        const meta = obj?.meta ?? null;

        // Gán label + meta ngay cho thẻ
        setDeck((d) => {
          const c = d[idx];
          if (!c) return d;
          const next = d.slice();
          next[idx] = { ...c, label: teamName, flipped: true, meta };
          return next;
        });

        if (mode !== "group") {
          // KO/PO: gom 2 thẻ thành 1 cặp → tô cùng màu (mỗi cặp 1 màu khác nhau)
          setPairBuffer((buf) => {
            const nextBuf = [...buf, { idx, name: teamName }];
            if (nextBuf.length === 2) {
              const [a, b] = nextBuf;
              const pid = pairCount;
              const color = getDistinctPairColor(pid);

              setDeck((d) =>
                d.map((c, i) =>
                  i === a.idx || i === b.idx
                    ? { ...c, pairId: pid, pairColor: color }
                    : c
                )
              );
              setPairLinks((prev) => ({ ...prev, [pid]: [a.idx, b.idx] }));
              setLastPair([a.name, b.name]);
              setPairCount((n) => n + 1);
              return [];
            }
            return nextBuf;
          });
        }
      } catch {
        // lỗi → rollback flipped
        setDeck((d) => {
          const c = d[idx];
          if (!c) return d;
          const next = d.slice();
          next[idx] = { ...c, flipped: false, label: null, meta: null };
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [onFlipOne, mode, pairCount, getDistinctPairColor]
  );

  if (!open) return null;

  const remaining = deck.filter((c) => !c.flipped).length;

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2300,
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(ellipse at center, rgba(0,0,0,.84), rgba(0,0,0,.94))",
        color: "#fff",
      }}
    >
      {/* Header */}

      <Stack
        direction="row"
        alignItems="center"
        sx={{
          p: 1.25,
          px: 2,
          minHeight: HEADER_H,
          height: HEADER_H,
          flexWrap: "nowrap",
        }}
      >
        <Typography
          noWrap
          sx={{ fontWeight: 800, letterSpacing: 1, mr: 1, minWidth: 0 }}
        >
          Bốc thăm kiểu Thẻ bài {mode === "group" ? "— Vòng bảng" : "— KO / PO"}
        </Typography>

        <Chip size="small" sx={{ ml: 1 }} label={`Còn: ${remaining}`} />

        <Box sx={{ flex: 1, minWidth: 0 }} />

        {mode === "group" && targetInfo && (
          <Chip
            variant="outlined"
            sx={{
              mr: 1,
              color: "#fff",
              maxWidth: 320,
              "& .MuiChip-label": {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            }}
            label={`ĐANG BỐC: Bảng ${targetInfo.groupCode} · Slot ${
              Number(targetInfo.slotIndex) + 1
            }`}
          />
        )}

        <Tooltip title="Đóng">
          <IconButton onClick={onClose} sx={{ color: "#fff" }}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Pair banner (KO/PO) */}
      {mode !== "group" && lastPair && (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 10, // đặt ở dưới để không đè lên hàng thẻ đầu
            textAlign: "center",
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          <Box
            sx={{
              display: "inline-block",
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              bgcolor: "rgba(0,0,0,.35)",
              border: "1px solid rgba(255,255,255,.18)",
              fontWeight: 800,
              fontSize: 14,
              maxWidth: "min(90vw, 720px)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {lastPair[0]}{" "}
            <span style={{ opacity: 0.7, margin: "0 10px" }}>VS</span>{" "}
            {lastPair[1]}
          </Box>
        </Box>
      )}

      {/* Grid */}
      <Box
        ref={gridRef}
        sx={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${layout.cols}, ${layout.w}px)`,
          gridAutoRows: `${layout.h}px`,
          gap: `${layout.gap}px`,
          p: 16,
          alignContent: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {displayDeck.map((c, idx) => {
          const isGhost = c.ghost;
          const isHovered = !isGhost && hoverIdx === idx;

          const hoveredCard = hoverIdx != null ? displayDeck[hoverIdx] : null;
          const mateHighlighted =
            !isGhost &&
            hoveredCard &&
            hoveredCard.pairId != null &&
            c.pairId != null &&
            hoveredCard.pairId === c.pairId &&
            hoverIdx !== idx;

          const borderColor = c.pairColor || "rgba(255,255,255,.22)";
          const borderWidth =
            mode !== "group"
              ? isHovered
                ? 3
                : mateHighlighted
                ? 3
                : c.pairColor
                ? 2
                : 1
              : isHovered
              ? 2
              : 1;

          const glow =
            !isGhost && (isHovered || mateHighlighted)
              ? `0 0 0 3px rgba(255,255,255,0.18), 0 0 22px 2px ${
                  c.pairColor || "rgba(255,255,255,.45)"
                }`
              : "none";

          // 🆕 tên cặp: ưu tiên meta.pairIndex server trả về
          const pairTitle =
            mode !== "group"
              ? typeof c.meta?.pairIndex === "number"
                ? `Cặp #${Number(c.meta.pairIndex) + 1}`
                : c.pairId != null
                ? `Cặp #${c.pairId + 1}`
                : null
              : null;

          // 🆕 nếu cặp đã đủ 2 thẻ và thẻ kia đã lật, lấy tên để hiển thị "vs ..."
          let mateName = null;
          if (mode !== "group" && c.pairId != null) {
            const mates = pairLinks[c.pairId] || [];
            const otherIdx = mates.find((x) => x !== idx);
            if (typeof otherIdx === "number") {
              // thử lấy từ displayDeck trước, nếu không có thì lấy từ deck gốc
              const otherCard =
                (otherIdx < displayDeck.length && displayDeck[otherIdx]) ||
                (otherIdx < deck.length && deck[otherIdx]);
              if (otherCard?.label) {
                mateName = otherCard.label;
              }
            }
          }

          return (
            <Box
              key={c.key}
              onMouseEnter={() => !isGhost && setHover(idx)}
              onMouseLeave={clearHover}
              onClick={() => !isGhost && !busy && !c.flipped && flipCard(idx)}
              sx={{
                width: `${layout.w}px`,
                height: `${layout.h}px`,
                perspective: "1000px",
                cursor: isGhost
                  ? "default"
                  : busy || c.flipped
                  ? "default"
                  : "pointer",
                transition: "transform .18s ease",
                transform: !isGhost && isHovered ? "translateY(-2px)" : "none",
                opacity: isGhost ? 0.35 : 1,
                pointerEvents: isGhost ? "none" : "auto",
              }}
            >
              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  transformStyle: "preserve-3d",
                  transition: "transform .55s cubic-bezier(.2,.8,.2,1)",
                  transform: c.flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                {/* Mặt sau */}
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    backfaceVisibility: "hidden",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,.14)",
                    background: isGhost
                      ? "linear-gradient(145deg, rgba(255,255,255,.04), rgba(255,255,255,.02))"
                      : "linear-gradient(145deg, #3b3b4f, #1f1f27)",
                    boxShadow: isGhost
                      ? "none"
                      : "0 14px 28px rgba(0,0,0,.35) inset, 0 10px 22px rgba(0,0,0,.45)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {!isGhost && (
                    <Box sx={{ textAlign: "center", opacity: 0.95 }}>
                      <Box sx={{ fontSize: 30, fontWeight: 900, mb: 0.5 }}>
                        ?
                      </Box>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        Nhấn để lật
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Mặt trước */}
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    borderRadius: 10,
                    border: `${borderWidth}px solid ${borderColor}`,
                    background:
                      "linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.03))",
                    display: "grid",
                    placeItems: "center",
                    p: 1.2,
                    textAlign: "center",
                    boxShadow: glow,
                  }}
                >
                  {!isGhost && (
                    <Box sx={{ px: 0.5 }}>
                      {/* tên đội vừa bốc */}
                      <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                        {c.label || "…"}
                      </Typography>

                      {/* group mode: giữ nguyên */}
                      {mode === "group" && c.meta?.groupCode != null && (
                        <Typography
                          variant="caption"
                          sx={{ opacity: 0.85, display: "block", mt: 0.5 }}
                        >
                          Bảng {c.meta.groupCode} • Slot{" "}
                          {Number(c.meta.slotIndex) + 1}
                        </Typography>
                      )}

                      {/* 🆕 KO/PO: show tên cặp */}
                      {mode !== "group" && pairTitle && (
                        <Typography
                          variant="caption"
                          sx={{ opacity: 0.85, display: "block", mt: 0.35 }}
                        >
                          {pairTitle}
                          {/* nếu server gửi side thì show luôn cho ref biết */}
                          {c.meta?.side && (
                            <span style={{ opacity: 0.6 }}>
                              {" "}
                              • {c.meta.side === "A" ? "Side A" : "Side B"}
                            </span>
                          )}
                        </Typography>
                      )}

                      {/* 🆕 nếu cặp đã đủ 2 đội thì hiển thị vs */}
                      {mode !== "group" && mateName && (
                        <Typography
                          variant="caption"
                          sx={{ opacity: 0.6, display: "block", mt: 0.25 }}
                        >
                          vs {mateName}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

/********************** Prefill round logic **********************/
const getPreferredRoundCode = (bracket, bracketDetail) => {
  const seedsLen =
    (bracketDetail?.prefill?.seeds?.length ?? 0) ||
    (bracket?.prefill?.seeds?.length ?? 0) ||
    0;
  const pairsLen =
    (bracketDetail?.prefill?.pairs?.length ?? 0) ||
    (bracket?.prefill?.pairs?.length ?? 0) ||
    0;
  const firstPairs = pairsLen || seedsLen;

  const rawKey =
    bracketDetail?.prefill?.roundKey ||
    bracket?.prefill?.roundKey ||
    bracketDetail?.ko?.startKey ||
    bracket?.ko?.startKey ||
    bracketDetail?.meta?.startKey ||
    bracket?.meta?.startKey ||
    "";
  const upKey = String(rawKey).toUpperCase();

  if (firstPairs > 0) {
    const teams = Math.max(2, firstPairs * 2);
    return `R${teams}`;
  }
  if (/^R\d+$/i.test(upKey)) {
    const n = parseInt(upKey.slice(1), 10);
    if (Number.isFinite(n) && n >= 2) return `R${n}`;
  }
  const expPairs =
    Number(bracketDetail?.meta?.expectedFirstRoundMatches) ||
    Number(bracket?.meta?.expectedFirstRoundMatches) ||
    0;
  if (expPairs > 0) return `R${expPairs * 2}`;
  const drawSize =
    Number(bracketDetail?.meta?.drawSize) ||
    Number(bracket?.meta?.drawSize) ||
    0;
  if (drawSize >= 2) return `R${drawSize}`;
  return null;
};
const mergeOptionsWithPrefill = (options, prefillCode) => {
  if (!prefillCode) return options || [];
  const exists = (options || []).some(
    (o) => String(o.code).toUpperCase() === String(prefillCode).toUpperCase()
  );
  if (exists) return options || [];
  const size = sizeFromRoundCode(prefillCode);
  const { label } = codeLabelForSize(size);
  const merged = (options || []).concat([
    { code: prefillCode, label, roundNumber: 1 },
  ]);
  return merged.sort(
    (a, b) => sizeFromRoundCode(b.code) - sizeFromRoundCode(a.code)
  );
};

/********************** Dialog tạo trận vòng bảng **********************/
const GroupMatchesDialog = memo(function GroupMatchesDialog({
  open,
  onClose,
  groupsMeta,
  regIndex,
  selBracketId,
}) {
  const [tabMode, setTabMode] = useState("auto");
  const [doubleRound, setDoubleRound] = useState(false);
  const [generateGroupMatches, { isLoading: genLoading }] =
    useGenerateGroupMatchesMutation();

  const handleCreate = useCallback(async () => {
    try {
      if (!selBracketId) return;
      if (tabMode === "auto") {
        await generateGroupMatches({
          bracketId: selBracketId,
          mode: "auto",
          doubleRound,
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
  }, [selBracketId, tabMode, doubleRound, generateGroupMatches, onClose]);

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
              doubleRound={doubleRound}
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
          onClick={handleCreate}
          disabled={genLoading}
          variant="contained"
          sx={{ color: "white !important" }}
        >
          Tạo trận
        </Button>
      </DialogActions>
    </Dialog>
  );
});

/********************** Dialog BYE **********************/
const AssignByesDialog = memo(function AssignByesDialog({
  open,
  onClose,
  selBracketId,
  selectedRoundNumber,
  byeMatches,
  regIndex,
  refetchMatches,
  refetchBracket,
  assignByes,
  eventType,
}) {
  const [mode, setMode] = useState("manual");
  const [dryRun, setDryRun] = useState(true);
  const [randomSeed, setRandomSeed] = useState("");
  const [limit, setLimit] = useState("");
  const [manualTeams, setManualTeams] = useState([]);
  const [rank, setRank] = useState(3);
  const [rangeLo, setRangeLo] = useState("");
  const [rangeHi, setRangeHi] = useState("");
  const [takePerGroup, setTakePerGroup] = useState(1);
  const [useRoundFilter, setUseRoundFilter] = useState(true);
  const [selectedMatchIds, setSelectedMatchIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
  }, [open]);

  const regOptions = useMemo(() => {
    const arr = [];
    regIndex?.forEach((reg, id) => {
      arr.push({ id, label: safePairName(reg, eventType) });
    });
    return arr.sort((a, b) =>
      a.label.localeCompare(b.label, "vi", { sensitivity: "base" })
    );
  }, [regIndex, eventType]);

  const nameByRegId = useCallback(
    (id) => {
      const reg = regIndex?.get(String(id));
      return reg ? safePairName(reg, eventType) : `#${String(id).slice(-6)}`;
    },
    [regIndex, eventType]
  );

  const resetPreview = useCallback(() => setPreview(null), []);

  const handleSubmit = useCallback(async () => {
    if (!selBracketId) return;
    setSubmitting(true);
    try {
      const body = {
        ...(useRoundFilter ? { round: selectedRoundNumber } : {}),
        ...(selectedMatchIds.length ? { matchIds: selectedMatchIds } : {}),
        ...(limit ? { limit: Number(limit) } : {}),
        ...(randomSeed ? { randomSeed: Number(randomSeed) } : {}),
        dryRun: Boolean(dryRun),
        source: { mode, params: {} },
      };
      if (mode === "manual") {
        body.source.params.teamIds = manualTeams.map((x) => x.id || x);
        if (!body.source.params.teamIds?.length) {
          toast.warn("Chọn ít nhất 1 đội cho chế độ Manual.");
          setSubmitting(false);
          return;
        }
      } else if (mode === "topEachGroup") {
        if (rangeLo !== "" && rangeHi !== "") {
          body.source.params.range = [Number(rangeLo), Number(rangeHi)];
        } else {
          body.source.params.rank = Number(rank || 3);
        }
        body.source.params.takePerGroup = Number(takePerGroup || 1);
      } else if (mode === "bestOfTopN") {
        body.source.params.rank = Number(rank || 3);
      }

      const resp = await assignByes({ bracketId: selBracketId, body }).unwrap();

      if (dryRun) {
        setPreview(Array.isArray(resp?.preview) ? resp.preview : []);
      } else {
        toast.success(`Đã gán BYE cho ${resp?.assigned || 0} trận.`);
        await Promise.all([refetchMatches?.(), refetchBracket?.()]);
        onClose?.();
      }
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Bốc BYE thất bại.");
    } finally {
      setSubmitting(false);
    }
  }, [
    selBracketId,
    useRoundFilter,
    selectedRoundNumber,
    selectedMatchIds,
    limit,
    randomSeed,
    dryRun,
    mode,
    manualTeams,
    rank,
    rangeLo,
    rangeHi,
    takePerGroup,
    assignByes,
    refetchMatches,
    refetchBracket,
    onClose,
  ]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Bốc BYE cho Knockout</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel>Nguồn chọn đội</InputLabel>
            <Select
              label="Nguồn chọn đội"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                resetPreview();
              }}
            >
              <MenuItem value="manual">Chỉ định đội (manual)</MenuItem>
              <MenuItem value="topEachGroup">
                Random từ top 3/4… mỗi bảng
              </MenuItem>
              <MenuItem value="bestOfTopN">Top N tốt nhất toàn giải</MenuItem>
            </Select>
          </FormControl>

          {mode === "manual" && (
            <Autocomplete
              multiple
              options={regOptions}
              getOptionLabel={(o) => o.label}
              value={manualTeams}
              onChange={(_, v) => {
                setManualTeams(v);
                resetPreview();
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Chọn đội (Registration)"
                  placeholder="Gõ để tìm…"
                />
              )}
            />
          )}

          {mode === "topEachGroup" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Rank N (ví dụ 3)"
                type="number"
                value={rank}
                onChange={(e) => {
                  setRank(e.target.value);
                  resetPreview();
                }}
                helperText="Để trống nếu dùng khoảng"
                fullWidth
              />
              <TextField
                label="Khoảng từ (lo)"
                type="number"
                value={rangeLo}
                onChange={(e) => {
                  setRangeLo(e.target.value);
                  resetPreview();
                }}
                fullWidth
              />
              <TextField
                label="Khoảng đến (hi)"
                type="number"
                value={rangeHi}
                onChange={(e) => {
                  setRangeHi(e.target.value);
                  resetPreview();
                }}
                fullWidth
              />
              <TextField
                label="Lấy mỗi bảng"
                type="number"
                value={takePerGroup}
                onChange={(e) => {
                  setTakePerGroup(e.target.value);
                  resetPreview();
                }}
                fullWidth
              />
            </Stack>
          )}

          {mode === "bestOfTopN" && (
            <TextField
              label="Rank N (mặc định 3)"
              type="number"
              value={rank}
              onChange={(e) => {
                setRank(e.target.value);
                resetPreview();
              }}
              fullWidth
            />
          )}

          <Divider />

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems="center"
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={useRoundFilter}
                  onChange={(e) => {
                    setUseRoundFilter(e.target.checked);
                    resetPreview();
                  }}
                />
              }
              label={`Giới hạn theo Round hiện tại (R${selectedRoundNumber})`}
            />
            <Typography variant="body2" color="text.secondary">
              Hoặc chọn chi tiết từng match BYE:
            </Typography>
          </Stack>
          <Stack
            spacing={1}
            sx={{
              maxHeight: 180,
              overflowY: "auto",
              border: "1px dashed #ddd",
              p: 1,
              borderRadius: 1,
            }}
          >
            {byeMatches?.length ? (
              byeMatches.map((m) => {
                const id = String(m._id);
                const checked = selectedMatchIds.includes(id);
                return (
                  <FormControlLabel
                    key={id}
                    control={
                      <Checkbox
                        checked={checked}
                        onChange={(e) => {
                          setUseRoundFilter(false);
                          setSelectedMatchIds((old) =>
                            e.target.checked
                              ? [...old, id]
                              : old.filter((x) => x !== id)
                          );
                          resetPreview();
                        }}
                      />
                    }
                    label={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={`#${m.order ?? 0}`} />
                        <Typography variant="body2">
                          {m.pairA ? safePairName(m.pairA, eventType) : "—"} vs{" "}
                          {m.pairB ? safePairName(m.pairB, eventType) : "—"}
                        </Typography>
                      </Stack>
                    }
                  />
                );
              })
            ) : (
              <Typography variant="body2" color="text.secondary">
                Không có slot BYE trống ở round này.
              </Typography>
            )}
          </Stack>

          <Divider />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Limit (tuỳ chọn)"
              type="number"
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value);
                resetPreview();
              }}
              fullWidth
            />
            <TextField
              label="Random seed (tuỳ chọn)"
              type="number"
              value={randomSeed}
              onChange={(e) => {
                setRandomSeed(e.target.value);
                resetPreview();
              }}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
              }
              label="Dry run (xem trước)"
            />
          </Stack>

          {Array.isArray(preview) && (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography fontWeight={700} gutterBottom>
                Preview gán BYE
              </Typography>
              {preview.length === 0 ? (
                <Typography variant="body2">
                  Không có cặp nào được gán.
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {preview.map((p, idx) => (
                    <Typography key={idx} variant="body2">
                      • Match <b>{idx + 1}</b> — Side <b>{p.side}</b> ⇢{" "}
                      <i>{nameByRegId(p.teamId)}</i>
                    </Typography>
                  ))}
                </Stack>
              )}
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
        <Button
          disabled={submitting}
          onClick={handleSubmit}
          variant="contained"
          sx={{ color: "white !important" }}
        >
          {dryRun ? "Xem trước (Dry run)" : "Gán BYE"}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

/********************** MAIN **********************/
export default function DrawPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const { id: tournamentId } = useParams();

  const [q, setQ] = useSearchParams();
  const preselectBracket = q.get("bracketId") || "";
  const preselectRound = q.get("round") || null;

  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = String(userInfo?.role || "").toLowerCase() === "admin";

  const [openGroupDlg, setOpenGroupDlg] = useState(false);
  const [openAssignByeDlg, setOpenAssignByeDlg] = useState(false);

  // FX
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxMuted, setFxMuted] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false); // Classic overlay
  const [overlayMode, setOverlayMode] = useState("group");
  const [overlayData, setOverlayData] = useState(null);
  const [lastHighlight, setLastHighlight] = useState(null);
  const { beep } = useAudioCue(!fxMuted);

  // NEW: UI mode
  const [uiMode, setUiMode] = useState("classic"); // 'classic' | 'cards'
  const usingCardMode = uiMode === "cards";

  // Card overlay state
  const [cardOpen, setCardOpen] = useState(false);
  const [cardQueue, setCardQueue] = useState([]); // names to flip

  // NEW: snapshot deck của phiên bốc hiện tại (một lần/phiên)
  const [cardSnapshot, setCardSnapshot] = useState([]); // [{id, label}]
  const [cardGoneIds, setCardGoneIds] = useState([]); // ["regId", ...]

  const [cardOpenPending, setCardOpenPending] = useState(false);
  // NEW: helper mở thẻ có đợi countdown khi FX bật
  const openCardAfterCountdown = useCallback(() => {
    if (fxEnabled) {
      // đảm bảo có countdown và đánh dấu pending
      setShowCountdown(true);
      setCardOpen(false);
      setCardOpenPending(true);
    } else {
      setCardOpen(true);
    }
  }, [fxEnabled, setShowCountdown]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const openProfile = useCallback((uid) => {
    if (!uid) return;
    setProfileUserId(String(uid));
    setProfileOpen(true);
  }, []);

  // Queries
  const {
    data: allMatches = [],
    isLoading: lMatches,
    refetch: refetchMatches,
  } = useListTournamentMatchesQuery(
    { tournamentId },
    {
      skip: !tournamentId,
      refetchOnMountOrArgChange: true,
      refetchOnFocus: true,
      refetchOnReconnect: true,
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
  const [assignByes] = useAssignByesMutation();

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
  useEffect(() => {
    if (!showCountdown && cardOpenPending) {
      setCardOpen(true);
      setCardOpenPending(false);
    }
  }, [showCountdown, cardOpenPending]);
  // URL helpers
  const updateURL = useCallback(
    (patch = {}) => {
      const sp = new URLSearchParams(q);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      });
      setQ(sp, { replace: true });
    },
    [q, setQ]
  );

  // Derives
  const drawType = useMemo(() => {
    if (!bracket) return "knockout";
    const t = String(bracket.type || "").toLowerCase();
    if (["group", "gsl", "swiss"].includes(t)) return "group";
    if (t === "roundelim") return "po";
    return "knockout";
  }, [bracket]);

  // Reg map + count
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

  const koEntrantSize = useMemo(() => {
    const prefillPairsLen =
      Number(bracketDetail?.prefill?.pairs?.length || 0) ||
      Number(bracket?.prefill?.pairs?.length || 0) ||
      Number(bracketDetail?.prefill?.seeds?.length || 0) ||
      Number(bracket?.prefill?.seeds?.length || 0) ||
      0;
    if (prefillPairsLen > 0) return nextPow2(prefillPairsLen * 2);

    const startKey =
      bracket?.ko?.startKey ||
      bracket?.prefill?.roundKey ||
      bracketDetail?.ko?.startKey ||
      bracketDetail?.prefill?.roundKey ||
      bracket?.meta?.startKey;
    const fromKey = startKey ? sizeFromRoundCode(startKey) : 0;
    if (fromKey >= 2) return nextPow2(fromKey);

    const nums = [
      bracket?.ko?.startSize,
      bracketDetail?.ko?.startSize,
      bracket?.meta?.firstRoundSize,
      bracket?.qualifiers,
      bracket?.meta?.qualifiers,
      bracket?.maxSlots,
      bracket?.capacity,
      bracket?.size,
      bracket?.drawScale,
      bracket?.meta?.drawSize,
    ]
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n >= 2);
    if (nums.length) return nextPow2(Math.min(...nums));
    return nextPow2(regCount || 2);
  }, [bracket, bracketDetail, regCount]);

  const knockoutOptionsBase = useMemo(() => {
    if (drawType === "po")
      return buildPlayoffOptions(bracket, bracketDetail, regCount);
    return buildKnockoutOptions(koEntrantSize);
  }, [drawType, bracket, bracketDetail, regCount, koEntrantSize]);

  const preferredRoundCode = useMemo(
    () => getPreferredRoundCode(bracket, bracketDetail),
    [bracket, bracketDetail]
  );
  const knockoutOptionsFinal = useMemo(
    () => mergeOptionsWithPrefill(knockoutOptionsBase, preferredRoundCode),
    [knockoutOptionsBase, preferredRoundCode]
  );

  const largestRoundCode = useMemo(() => {
    if (!knockoutOptionsFinal?.length) return "F";
    return knockoutOptionsFinal.reduce((best, cur) => {
      const sb = sizeFromRoundCode(best.code);
      const sc = sizeFromRoundCode(cur.code);
      return sc > sb ? cur : best;
    }).code;
  }, [knockoutOptionsFinal]);

  const [roundCode, setRoundCode] = useState(preselectRound);
  const [roundTouched, setRoundTouched] = useState(Boolean(preselectRound));
  const [usePrevWinners, setUsePrevWinners] = useState(false);

  useEffect(() => {
    if (!selBracketId) return;
    setRoundTouched(false);
    setRoundCode(null);
  }, [selBracketId, drawType]);
  useEffect(() => {
    if (!selBracketId) return;
    if (!(drawType === "knockout" || drawType === "po")) return;
    if (roundTouched) return;
    const preferred = (
      preferredRoundCode ||
      largestRoundCode ||
      ""
    ).toUpperCase();
    if (!roundCode && preferred) setRoundCode(preferred);
  }, [
    selBracketId,
    drawType,
    roundTouched,
    roundCode,
    preferredRoundCode,
    largestRoundCode,
  ]);

  const selectRoundValue = useMemo(() => {
    const codes = new Set(
      knockoutOptionsFinal.map((o) => String(o.code).toUpperCase())
    );
    const candidate =
      (roundCode && String(roundCode).toUpperCase()) ||
      (preferredRoundCode && String(preferredRoundCode).toUpperCase()) ||
      (largestRoundCode && String(largestRoundCode).toUpperCase()) ||
      "";
    return codes.has(candidate)
      ? candidate
      : knockoutOptionsFinal[0]?.code?.toUpperCase() || "";
  }, [roundCode, preferredRoundCode, largestRoundCode, knockoutOptionsFinal]);

  useEffect(() => {
    const val = selectRoundValue;
    updateURL({
      bracketId: selBracketId || "",
      round:
        selBracketId && (drawType === "knockout" || drawType === "po")
          ? val || ""
          : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selBracketId, drawType, selectRoundValue]);

  // Draw session state
  const [drawId, setDrawId] = useState(null);
  const [state, setState] = useState("idle"); // idle|running|committed|canceled
  const [reveals, setReveals] = useState([]);
  const [planned, setPlanned] = useState(null);

  // draw doc (board & pool)
  const [drawDoc, setDrawDoc] = useState(null);

  useEffect(() => {
    if (!selBracketId) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setDrawDoc(null);
    setCardOpen(false);
    setCardQueue([]);
    setCardSnapshot([]);
    setCardGoneIds([]);
  }, [selBracketId]);
  useEffect(() => {
    if (!(drawType === "knockout" || drawType === "po")) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setDrawDoc(null);
    setCardOpen(false);
    setCardQueue([]);
    setCardSnapshot([]);
    setCardGoneIds([]);
  }, [selectRoundValue, drawType]);

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
    const doc = drawStatus?.doc || drawStatus?.draw || null;
    if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);
  }, [drawStatus]);

  // sockets
  useEffect(() => {
    if (!socket || !selBracketId) return;
    socket.emit("draw:join", { bracketId: selBracketId });
    const onPlanned = (payload) => setPlanned(payload);
    socket.on("draw:planned", onPlanned);
    return () => {
      socket.off("draw:planned", onPlanned);
      socket.emit("draw:leave", { bracketId: selBracketId });
    };
  }, [socket, selBracketId]);

  useEffect(() => {
    if (!socket || !drawId) return;
    socket.emit("draw:join", { drawId });
    const onUpdate = (payload) => {
      if (payload?.state) setState(payload.state);
      if (Array.isArray(payload?.reveals)) setReveals(payload.reveals);
      const doc = payload?.doc || payload?.draw || null;
      if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);
    };
    const onRevealed = (payload) => {
      if (Array.isArray(payload?.reveals)) setReveals(payload.reveals);
      const doc = payload?.doc || payload?.draw || null;
      if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);
    };
    const onCommitted = async () => {
      setState("committed");
      try {
        await Promise.all([refetchMatches?.(), refetchBracket?.()]);
      } catch {}
      if (fxEnabled) fireConfettiBurst();
    };
    const onCanceled = () => {
      try {
        setState("canceled");
        setReveals([]);
        setDrawId(null);
        setDrawDoc(null);
      } catch (e) {
        toast.error(
          e?.data?.message || e?.error || "Có lỗi khi bắt đầu bốc thăm."
        );
      }
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
  }, [socket, drawId, refetchBracket, refetchMatches, fxEnabled]);

  // groups
  const groupsRaw = useMemo(
    () => bracketDetail?.groups || bracket?.groups || [],
    [bracketDetail, bracket]
  );
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
    if (state === "running" && plannedGroupsMeta.length)
      return plannedGroupsMeta;
    if (persistedFilled) return persisted;
    if (plannedGroupsMeta.length) return plannedGroupsMeta;
    return persisted;
  }, [groupsRaw, state, plannedGroupsMeta]);
  const hasGroups = useMemo(() => (groupsMeta?.length || 0) > 0, [groupsMeta]);

  const selectedRoundNumber = useMemo(() => {
    const opt = knockoutOptionsFinal.find(
      (o) =>
        String(o.code).toUpperCase() === String(selectRoundValue).toUpperCase()
    );
    return opt?.roundNumber ?? 1;
  }, [knockoutOptionsFinal, selectRoundValue]);

  // matches + reveals
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
    // RUNNING: luôn theo reveals
    if (state === "running") return Array.isArray(reveals) ? reveals : [];
    // Sau commit/cancel: nếu matches còn đang load ⇒ vẫn tạm hiển thị reveals
    if (lMatches) return Array.isArray(reveals) ? reveals : [];
    // Có matches mới rồi thì dùng matches
    return koPairsPersisted;
  }, [state, reveals, lMatches, koPairsPersisted]);

  const revealsForGroup = useMemo(() => {
    if (state === "running" && Array.isArray(reveals) && reveals.length)
      return reveals;
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

  const buildRoundsForKO = useCallback(
    ({
      roundCode,
      reveals,
      matches,
      eventType,
      selectedRoundNumber,
      selBracketId,
      bracket,
      bracketDetail,
      isPO = false,
    }) => {
      const startTeams = sizeFromRoundCode(roundCode);
      const totalRoundsFromSize = Math.max(1, Math.log2(startTeams) | 0);
      const firstRound = selectedRoundNumber || 1;

      const poMaxRounds =
        isPO &&
        (Number(bracketDetail?.meta?.maxRounds) ||
          Number(bracket?.meta?.maxRounds) ||
          Number(bracketDetail?.ko?.rounds) ||
          Number(bracket?.ko?.rounds) ||
          1);

      const cutRoundsExplicit =
        Number(bracket?.config?.roundElim?.cutRounds) ||
        Number(bracketDetail?.config?.roundElim?.cutRounds) ||
        Number(bracket?.ko?.cutRounds) ||
        Number(bracketDetail?.ko?.cutRounds) ||
        0;

      let cutToTeams =
        Number(bracket?.meta?.expectedFirstRoundMatches) ||
        Number(bracketDetail?.meta?.expectedFirstRoundMatches) ||
        Number(bracket?.meta?.cutToTeams) ||
        Number(bracketDetail?.meta?.cutToTeams) ||
        0;
      if (cutToTeams > startTeams) cutToTeams = startTeams;
      if (cutToTeams < 0) cutToTeams = 0;

      let cutRounds = cutRoundsExplicit;
      if (!cutRounds && cutToTeams > 0) {
        const r = Math.ceil(Math.log2(Math.max(1, startTeams / cutToTeams)));
        cutRounds = Math.max(1, r + 1);
      }
      if (cutRounds) cutRounds = Math.min(cutRounds, totalRoundsFromSize);

      const realSorted = (matches || [])
        .slice()
        .sort(
          (a, b) =>
            (a.round || 1) - (b.round || 1) || (a.order ?? 0) - (b.order ?? 0)
        );

      const maxRoundReal = realSorted.length
        ? Math.max(...realSorted.map((m) => m.round || 1))
        : firstRound;

      let lastRound;
      if (isPO) {
        const limit = Math.max(1, poMaxRounds || 1);
        lastRound = firstRound + limit - 1;
      } else {
        const lastRoundWhenFull = firstRound + totalRoundsFromSize - 1;
        lastRound = cutRounds
          ? firstRound + cutRounds - 1
          : Math.max(lastRoundWhenFull, maxRoundReal);
      }

      const countByRoundReal = {};
      realSorted.forEach((m) => {
        const r = m.round || 1;
        countByRoundReal[r] = (countByRoundReal[r] || 0) + 1;
      });

      const revealsPairs = (reveals || []).map((rv) => ({
        A: rv?.A?.name || rv?.AName || rv?.A || "Chưa có đội",
        B: rv?.B?.name || rv?.BName || rv?.B || "Chưa có đội",
      }));

      const expectedFirstPairs = Math.max(1, Math.floor(startTeams / 2));
      const firstRoundPairs = Math.max(
        expectedFirstPairs,
        countByRoundReal[firstRound] || 0,
        revealsPairs.length || 0
      );

      const seedsCount = { [firstRound]: firstRoundPairs };
      for (let r = firstRound + 1; r <= lastRound; r++) {
        const expected = Math.max(1, Math.ceil(seedsCount[r - 1] / 2));
        const realCount = countByRoundReal[r] || 0;
        seedsCount[r] = Math.max(expected, realCount);
      }

      const rounds = [];
      for (let r = firstRound; r <= lastRound; r++) {
        const need = seedsCount[r] || 1;
        const seeds = Array.from({ length: need }, (_, i) => ({
          id: `ph-${selBracketId}-${r}-${i}`,
          __match: null,
          teams: [{ name: "Chưa có đội" }, { name: "Chưa có đội" }],
        }));

        const ms = realSorted
          .filter((m) => (m.round || 1) === r)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        if (ms.length) {
          ms.forEach((m, i) => {
            if (i >= seeds.length) return;
            seeds[i] = {
              id: m._id || `${selBracketId}-${r}-${i}`,
              __match: m,
              teams: [
                { name: matchSideName(m, "A", eventType) },
                { name: matchSideName(m, "B", eventType) },
              ],
            };
          });
        }

        if (r === firstRound && revealsPairs.length) {
          for (
            let i = 0;
            i < Math.min(seeds.length, revealsPairs.length);
            i++
          ) {
            const rp = revealsPairs[i];
            if (!rp) continue;
            const curA = seeds[i]?.teams?.[0]?.name;
            const curB = seeds[i]?.teams?.[1]?.name;
            if (
              rp.A &&
              rp.A !== "Chưa có đội" &&
              (!curA || curA === "Chưa có đội")
            )
              seeds[i].teams[0].name = rp.A;
            if (
              rp.B &&
              rp.B !== "Chưa có đội" &&
              (!curB || curB === "Chưa có đội")
            )
              seeds[i].teams[1].name = rp.B;
          }
        }

        const localNo = r - firstRound + 1;
        const title =
          drawType === "po" ? `Vòng ${localNo}` : roundTitleByCount(need);
        rounds.push({ title, seeds });
      }
      return rounds;
    },
    [drawType]
  );

  /* ===== Hoàn thành chỉ khi drawNext làm pool về 0 ===== */
  const [showDoneBanner, setShowDoneBanner] = useState(false);
  const lastRevealActionRef = useRef(false);
  const prevPoolCountRef = useRef(null);

  const eventType = tournament?.eventType?.toLowerCase()?.includes("single")
    ? "single"
    : "double";
  const namesPool = useNamesPool(regIndex, eventType);

  // START DRAW
  const onStart = useCallback(async () => {
    if (!selBracketId) return;
    try {
      const body =
        drawType === "group"
          ? { mode: "group" }
          : {
              mode: drawType === "po" ? "po" : "knockout",
              round: selectRoundValue,
              ...(drawType === "knockout" ? { usePrevWinners } : {}),
            };

      const resp = await startDraw({ bracketId: selBracketId, body }).unwrap();

      setDrawId(resp?.drawId);
      setState(resp?.state || "running");
      setReveals(Array.isArray(resp?.reveals) ? resp.reveals : []);
      if (resp?.planned) setPlanned(resp);

      const doc = resp?.doc || resp?.draw || resp;
      if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);

      // NEW: hiện thông báo từ server (nếu có)
      if (resp?.message) {
        const level =
          (resp?.state || "").toLowerCase() === "idle" ? "info" : "success";
        toast[level](resp.message);
      }

      if (fxEnabled) setShowCountdown(true);

      // --- RESET chung ---
      setShowDoneBanner(false);
      prevPoolCountRef.current = Array.isArray(doc?.pool)
        ? doc.pool.length
        : null;
      lastRevealActionRef.current = false;

      // --- NEW: PO: clear sạch mọi dấu vết để UI thật sự trắng ---
      // ✅ KO và PO: clear sạch để UI trắng thật sự, không lẫn dữ liệu cũ
      if (drawType === "knockout" || drawType === "po") {
        setReveals([]); // clear reveals
        prevRevealsRef.current = []; // overlay classic không bắt nhầm diff
        setOverlayOpen(false); // đóng overlay nếu còn mở
        setLastHighlight(null); // bỏ highlight slot cũ
        setCardQueue([]); // reset hàng đợi thẻ
        setShowDoneBanner(false); // tắt banner hoàn thành
        prevPoolCountRef.current = null;
      }

      // (không bắt buộc) ép refetch matches để sidebar/bye-info cập nhật sớm
      try {
        await refetchMatches?.();
      } catch {}

      // Auto open Card overlay nếu đang ở card mode
      if (uiMode === "cards") {
        setCardQueue([]);
        openCardAfterCountdown();
      }
    } catch (e) {
      console.log(e);
      toast.error(
        e?.data?.message || e?.error || "Có lỗi khi bắt đầu bốc thăm."
      );
    }
  }, [
    selBracketId,
    drawType,
    selectRoundValue,
    usePrevWinners,
    startDraw,
    fxEnabled,
    uiMode,
  ]);

  const canOperate = Boolean(drawId && state === "running");

  // === Classic "Reveal tiếp" (giữ nguyên hành vi hiện tại) ===
  // === Classic "Reveal tiếp" (GIỜ dùng resp.next để biết ngay tên + vị trí) ===
  const onReveal = useCallback(async () => {
    if (!canOperate) return;
    try {
      lastRevealActionRef.current = true;
      const resp = await drawNext({ drawId }).unwrap();

      // cập nhật state
      if (Array.isArray(resp?.reveals)) setReveals(resp.reveals);
      const doc = resp?.doc || resp?.draw || resp;
      if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);

      // === NEW: đọc thẳng từ resp.next
      const nx = resp?.next;
      if (nx && typeof nx === "object") {
        if (nx.type === "group") {
          // highlight slot vừa seat
          setLastHighlight({
            type: "group",
            groupCode: nx.groupCode,
            slotIndex: nx.slotIndex,
          });
          if (!fxMuted && fxEnabled) beep(520, 0.08);

          // classic overlay (khi không ở card mode)
          if (fxEnabled && !usingCardMode) {
            setOverlayMode("group");
            setOverlayData({
              groupCode: nx.groupCode,
              slotIndex: nx.slotIndex,
              teamName: nx.name || "—",
            });
            setOverlayOpen(true);
          }
        } else if (nx.type === "ko") {
          // Ko chỉ trả về 1 side; overlay hiển thị bên còn lại nếu đã có
          if (fxEnabled && !usingCardMode) {
            const pair = revealsForKO?.[nx.pairIndex] || {};
            const AName =
              nx.side === "A"
                ? nx.name || "—"
                : pair.AName || pair.A || "Chưa có đội";
            const BName =
              nx.side === "B"
                ? nx.name || "—"
                : pair.BName || pair.B || "Chưa có đội";
            setOverlayMode("ko");
            setOverlayData({ AName, BName });
            setOverlayOpen(true);
            setTimeout(() => beep(520, 0.08), 200);
          }
        }
      }

      // hoàn tất/bắn confetti khi pool = 0
      const prev = prevPoolCountRef.current ?? null;
      const cur = Array.isArray(doc?.pool) ? doc.pool.length : null;
      if (lastRevealActionRef.current && prev > 0 && cur === 0) {
        setShowDoneBanner(true);
        if (fxEnabled) fireConfettiBurst();
        toast.success(
          drawType === "group"
            ? "Bốc thăm vòng bảng đã hoàn thành!"
            : "Bốc thăm vòng này đã hoàn thành!"
        );
      }
      prevPoolCountRef.current = cur;
      lastRevealActionRef.current = false;
    } catch (e) {
      lastRevealActionRef.current = false;
      toast.error(e?.data?.message || e?.error);
    }
  }, [
    canOperate,
    drawNext,
    drawId,
    fxEnabled,
    fxMuted,
    beep,
    usingCardMode,
    revealsForKO,
    drawType,
  ]);

  // === Card mode reveal helper: call drawNext and return names just revealed ===
  // === Card mode reveal helper: gọi drawNext và TRẢ VỀ tên dựa trên resp.next ===
  const revealOnceForCards = useCallback(async () => {
    if (!canOperate) return [];
    try {
      lastRevealActionRef.current = true;
      const resp = await drawNext({ drawId }).unwrap();

      if (Array.isArray(resp?.reveals)) setReveals(resp.reveals);
      const doc = resp?.doc || resp?.draw || resp;
      if (doc?.board || Array.isArray(doc?.pool)) setDrawDoc(doc);

      const out = [];
      const nx = resp?.next;

      if (nx && typeof nx === "object") {
        if (nx.name) {
          out.push({
            name: nx.name,
            meta: {
              type: nx.type,
              groupCode: nx.groupCode,
              slotIndex: nx.slotIndex,
              side: nx.side,
              pairIndex: nx.pairIndex,
            },
          });
        }
        if (nx.type === "group") {
          setLastHighlight({
            type: "group",
            groupCode: nx.groupCode,
            slotIndex: nx.slotIndex,
          });
        }
      } else {
        // Fallback cũ — trả dạng object
        if (drawType === "group") {
          const last =
            (Array.isArray(resp?.reveals) ? resp.reveals : []).slice(-1)[0] ||
            {};
          const rid = asId(last?.regId ?? last?.reg ?? last?.id ?? last?._id);
          const name =
            (rid && regIndex.has(String(rid))
              ? safePairName(regIndex.get(String(rid)), eventType)
              : last?.nickName ||
                last?.teamName ||
                last?.name ||
                last?.team ||
                last?.displayName) || "—";
          out.push({ name, meta: null });
        } else {
          const prev = Array.isArray(reveals) ? [...reveals] : [];
          const cur = Array.isArray(resp?.reveals) ? resp.reveals : prev;
          const added = [];
          if (cur.length > prev.length) {
            const last = cur[cur.length - 1] || {};
            if (last?.AName || last?.A) added.push(last.AName || last.A);
            if (last?.BName || last?.B) added.push(last.BName || last.B);
          } else {
            const N = Math.max(prev.length, cur.length);
            for (let i = 0; i < N; i++) {
              const p = prev[i] || {};
              const c = cur[i] || {};
              const pA = p?.AName ?? p?.A ?? null,
                pB = p?.BName ?? p?.B ?? null;
              const cA = c?.AName ?? c?.A ?? null,
                cB = c?.BName ?? c?.B ?? null;
              if (cA && cA !== pA) added.push(cA);
              if (cB && cB !== pB) added.push(cB);
            }
          }
          out.push(
            ...added.filter(Boolean).map((nm) => ({ name: nm, meta: null }))
          );
        }
      }

      const prev = prevPoolCountRef.current ?? null;
      const curPool = Array.isArray(doc?.pool) ? doc.pool.length : null;
      if (lastRevealActionRef.current && prev > 0 && curPool === 0) {
        setShowDoneBanner(true);
        if (fxEnabled) fireConfettiBurst();
      }
      prevPoolCountRef.current = curPool;
      lastRevealActionRef.current = false;

      return out;
    } catch (e) {
      lastRevealActionRef.current = false;
      toast.error(e?.data?.message || e?.error || "Reveal thất bại.");
      return [];
    }
  }, [
    canOperate,
    drawNext,
    drawId,
    reveals,
    regIndex,
    eventType,
    drawType,
    fxEnabled,
  ]);
  // trong DrawPage.jsx
  const onFlipOneForCards = useCallback(async () => {
    if (cardQueue.length) {
      const [head, ...rest] = cardQueue;
      setCardQueue(rest);
      return head; // {name, meta}
    }
    const items = await revealOnceForCards(); // [{name, meta}, ...]
    if (items.length > 1) setCardQueue(items.slice(1));
    return items[0] || null;
  }, [revealOnceForCards, cardQueue]);
  // Classic overlay auto-open only if NOT in card mode
  const prevRevealsRef = useRef([]);
  useEffect(() => {
    if (
      !fxEnabled ||
      usingCardMode ||
      state !== "running" ||
      !Array.isArray(reveals)
    ) {
      prevRevealsRef.current = reveals || [];
      return;
    }
    let hit = null;
    const prev = prevRevealsRef.current || [];
    const n = Math.max(prev.length, reveals.length);
    for (let i = 0; i < n; i++) {
      const p = prev[i] || {};
      const c = reveals[i] || {};
      const pA = p?.AName || p?.A || null;
      const pB = p?.BName || p?.B || null;
      const cA = c?.AName || c?.A || null;
      const cB = c?.BName || c?.B || null;
      const newA = cA && !pA;
      const newB = cB && !pB;
      if (newA || newB) {
        if (drawType === "group") {
          const key =
            c.groupCode ||
            c.groupKey ||
            (typeof c.group === "string" ? c.group : "");
          const slotIndex = reveals
            .slice(0, i)
            .filter(
              (x) => (x.groupCode || x.groupKey || x.group) === key
            ).length;
          const rid = asId(c.regId ?? c.reg ?? c.id ?? c._id);
          const reg = rid && regIndex?.get(String(rid));
          const teamName = reg
            ? safePairName(reg, eventType)
            : c.nickName ||
              c.teamName ||
              c.name ||
              c.team ||
              c.displayName ||
              "—";
          setOverlayMode("group");
          setOverlayData({ groupCode: key, slotIndex, teamName });
          setOverlayOpen(true);
          setTimeout(() => beep(520, 0.08), 200);
          setTimeout(
            () =>
              setLastHighlight({ type: "group", groupCode: key, slotIndex }),
            1200
          );
        } else {
          hit = { AName: cA || "—", BName: cB || "—" };
        }
        break;
      }
    }
    if (hit && drawType !== "group") {
      setOverlayMode("ko");
      setOverlayData(hit);
      setOverlayOpen(true);
      setTimeout(() => beep(520, 0.08), 200);
    }
    prevRevealsRef.current = reveals;
  }, [
    reveals,
    drawType,
    state,
    fxEnabled,
    usingCardMode,
    beep,
    regIndex,
    eventType,
  ]);

  // Trận BYE còn trống của round hiện tại
  const byeMatchesThisRound = useMemo(() => {
    if (!selBracketId) return [];
    const isGroup = String(bracket?.type || "").toLowerCase() === "group";
    if (isGroup) return [];

    const roundNo = Number(selectedRoundNumber) || 1;
    const isByeSeed = (s) =>
      String(s?.type || "").toLowerCase() === "bye" ||
      String(s?.label || "").toUpperCase() === "BYE";

    return (allMatches || [])
      .filter((m) => {
        const sameBracket =
          String(m.bracket?._id || m.bracket) === String(selBracketId);
        const sameRound = (Number(m.round) || 1) === roundNo;
        const openByeA = isByeSeed(m.seedA) && !m.pairA;
        const openByeB = isByeSeed(m.seedB) && !m.pairB;
        const fallbackBye =
          String(m?.type || "").toLowerCase() === "bye" &&
          (!m.pairA || !m.pairB);

        return (
          sameBracket && sameRound && (openByeA || openByeB || fallbackBye)
        );
      })
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [allMatches, selBracketId, bracket?.type, selectedRoundNumber]);

  // ===== Card deck pool =====
  const cardDeck = useMemo(() => {
    // source priority: drawDoc.pool (ids) -> fallback by names from regIndex minus current revealed names
    if (Array.isArray(drawDoc?.pool) && drawDoc.pool.length) {
      return drawDoc.pool
        .map((id) => {
          const str = String(id);
          const reg = regIndex?.get(str);
          const label = safePairName(reg, eventType) || `#${str.slice(-6)}`;
          return { id: str, label };
        })
        .sort((a, b) =>
          a.label.localeCompare(b.label, "vi", { sensitivity: "base" })
        );
    }

    // fallback: derive pool by removing already revealed names (works for both modes)
    const out = [];
    const revealedNames = new Set();
    if (drawType === "group") {
      (revealsForGroup || []).forEach((rv) => {
        const rid = asId(rv.regId ?? rv.reg ?? rv.id ?? rv._id);
        const reg = rid && regIndex?.get(String(rid));
        if (reg) revealedNames.add(safePairName(reg, eventType));
      });
    } else {
      (revealsForKO || []).forEach((rv) => {
        const a = rv?.AName || rv?.A || null;
        const b = rv?.BName || rv?.B || null;
        if (a) revealedNames.add(a);
        if (b) revealedNames.add(b);
      });
    }
    regIndex?.forEach((reg, id) => {
      const label = safePairName(reg, eventType);
      if (!revealedNames.has(label)) out.push({ id: String(id), label });
    });
    return out.sort((a, b) =>
      a.label.localeCompare(b.label, "vi", { sensitivity: "base" })
    );
  }, [
    drawDoc?.pool,
    regIndex,
    eventType,
    revealsForGroup,
    revealsForKO,
    drawType,
  ]);

  // ĐANG BỐC VÀO BẢNG NÀO (chỉ group)
  const targetInfo = useMemo(() => {
    if (drawType !== "group") return null;
    return inferNextGroupCursor(drawDoc?.board, groupsMeta, revealsForGroup);
  }, [drawType, drawDoc?.board, groupsMeta, revealsForGroup]);
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
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 2, flexWrap: "wrap" }}
      >
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
        <Box sx={{ flex: 1 }} />
        <FormControlLabel
          control={
            <Switch
              checked={fxEnabled}
              onChange={(e) => setFxEnabled(e.target.checked)}
            />
          }
          label="Hiệu ứng livestream"
        />
        <Tooltip title={fxMuted ? "Bật âm" : "Tắt âm"}>
          <IconButton onClick={() => setFxMuted((v) => !v)}>
            {fxMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Bắn confetti">
          <IconButton onClick={() => fxEnabled && fireConfettiBurst()}>
            <CelebrationIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* NEW: UI mode switch */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.8 }}>
          Kiểu bốc:
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={uiMode}
          onChange={(_, v) => v && setUiMode(v)}
        >
          <ToggleButton value="classic">Classic</ToggleButton>
          <ToggleButton value="cards">Thẻ bài</ToggleButton>
        </ToggleButtonGroup>
        {state === "running" && uiMode === "cards" && (
          <Button
            size="small"
            variant="outlined"
            onClick={openCardAfterCountdown}
          >
            Mở giao diện thẻ
          </Button>
        )}
      </Stack>

      {showDoneBanner && drawType === "group" && state === "running" && (
        <Alert
          icon={<TaskAltIcon fontSize="inherit" />}
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setShowDoneBanner(false)}
        >
          Bốc thăm vòng bảng đã hoàn thành!
        </Alert>
      )}

      <Paper
        key={`${selBracketId || "none"}-${
          drawType === "knockout" || drawType === "po"
            ? selectRoundValue || "R?"
            : "group"
        }`}
        variant="outlined"
        sx={{ p: 2, flex: 1 }}
      >
        <Stack spacing={2}>
          <Alert severity="info">
            Chỉ admin mới thấy trang này. Thể loại giải:{" "}
            <b>{(tournament?.eventType || "").toUpperCase()}</b>
          </Alert>

          {/* ==== BRACKET SELECT ==== */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel>Chọn Bracket</InputLabel>
              <Select
                label="Chọn Bracket"
                value={selBracketId || ""}
                onChange={(e) => setSelBracketId(e.target.value)}
              >
                <MenuItem value="">
                  <em>— Chọn Bracket —</em>
                </MenuItem>
                {brackets.map((b) => (
                  <MenuItem key={b._id} value={b._id}>
                    {b.name} — {labelBracketType(b)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {selBracketId && (drawType === "knockout" || drawType === "po") && (
              <FormControl fullWidth>
                <InputLabel>Vòng cần bốc</InputLabel>
                <Select
                  label="Vòng cần bốc"
                  value={selectRoundValue}
                  onChange={(e) => {
                    setRoundTouched(true);
                    setRoundCode(String(e.target.value).toUpperCase());
                  }}
                >
                  {knockoutOptionsFinal.map((r) => (
                    <MenuItem key={r.code} value={String(r.code).toUpperCase()}>
                      {r.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {selBracketId && drawType === "knockout" && (
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
              onClick={async () => {
                await drawCommit({ drawId }).unwrap();
                // kéo nhanh dữ liệu mới về thay vì đợi socket/network
                try {
                  await Promise.all([refetchMatches?.(), refetchBracket?.()]);
                } catch {}
                setShowDoneBanner(false);
              }}
              sx={{ color: "white !important" }}
            >
              Ghi kết quả (Commit)
            </Button>
            <Button
              color="error"
              variant="outlined"
              startIcon={<CancelIcon />}
              disabled={!drawId || canceling}
              onClick={async () => {
                try {
                  await drawCancel({ drawId }).unwrap();
                  // kéo nhanh dữ liệu mới về thay vì đợi socket/network
                } catch (e) {
                  toast.error(
                    e?.data?.message || e?.error || "Có lỗi khi huỷ phiên bốc."
                  );
                }
                setDrawId(null);
                setState("idle");
                setReveals([]);
                setDrawDoc(null);
                setShowDoneBanner(false);
                setCardOpen(false);
                setCardQueue([]);
                setCardSnapshot([]);
                toast.success(
                  "Đã huỷ phiên bốc. Bạn có thể bắt đầu phiên mới."
                );
              }}
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

          {!selBracketId ? (
            <Alert severity="info">Hãy chọn một Bracket để bắt đầu.</Alert>
          ) : drawType === "group" ? (
            hasGroups || drawDoc?.board ? (
              <GroupSeatingBoard
                key={`grp-${selBracketId}-${state}`}
                board={drawDoc?.board || null}
                groupsMeta={groupsMeta}
                reveals={revealsForGroup}
                regIndex={regIndex}
                eventType={eventType}
                lastHighlight={lastHighlight}
              />
            ) : (
              <Typography color="text.secondary">
                Chưa có thông tin bảng/slot để hiển thị.
              </Typography>
            )
          ) : (
            <Box
              key={`ko-${selBracketId}-${selectRoundValue}-${state}`}
              sx={{ overflowX: "auto", pb: 1, position: "relative" }}
            >
              <Bracket
                rounds={buildRoundsForKO({
                  roundCode: selectRoundValue,
                  // ✅ RUNNING → chỉ lấy từ reveals; ngừng “đọc đè” từ matches
                  reveals: state === "running" ? revealsForKO : [],
                  matches:
                    state === "running" || lMatches ? [] : koMatchesThisBracket,

                  eventType,
                  selectedRoundNumber,
                  selBracketId,
                  bracket,
                  bracketDetail,
                  isPO: drawType === "po",
                })}
                renderSeedComponent={seedRenderer}
                renderSeed={seedRenderer}
                mobileBreakpoint={0}
              />
            </Box>
          )}
        </Paper>

        {/* Right column */}
        <Stack spacing={2} sx={{ width: { md: 380 } }}>
          {drawType === "group" ? (
            <PoolPanel
              title="Pool đội chờ bốc"
              eventType={eventType}
              regIndex={regIndex}
              poolIds={drawDoc?.pool || null}
              revealsGroup={revealsForGroup}
            />
          ) : (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={700} gutterBottom>
                Pool đội chờ bốc
              </Typography>
              <Alert severity="info">
                Pool áp dụng cho vòng bảng; với Knockout, nguồn đội phụ thuộc
                seeding/matches của round.
              </Alert>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
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
              {selBracketId &&
                drawType === "group" &&
                (hasGroups || drawDoc?.board) && (
                  <Button
                    variant="contained"
                    onClick={() => setOpenGroupDlg(true)}
                    sx={{ color: "white !important" }}
                  >
                    Bốc thăm trận trong bảng
                  </Button>
                )}
              {selBracketId &&
                (drawType === "knockout" || drawType === "po") && (
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={() => setOpenAssignByeDlg(true)}
                    startIcon={<CasinoIcon />}
                    sx={{ color: "white !important" }}
                  >
                    Bốc BYE (round {selectedRoundNumber})
                    {byeMatchesThisRound.length
                      ? ` • ${byeMatchesThisRound.length} slot`
                      : ""}
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
          </Paper>
        </Stack>
      </Stack>

      {/* Dialog: Group matches */}
      <GroupMatchesDialog
        open={openGroupDlg}
        onClose={() => setOpenGroupDlg(false)}
        groupsMeta={groupsMeta}
        regIndex={regIndex}
        selBracketId={selBracketId}
      />

      {/* Dialog: Assign BYEs */}
      <AssignByesDialog
        open={openAssignByeDlg}
        onClose={() => setOpenAssignByeDlg(false)}
        selBracketId={selBracketId}
        selectedRoundNumber={selectedRoundNumber}
        byeMatches={byeMatchesThisRound}
        regIndex={regIndex}
        refetchMatches={refetchMatches}
        refetchBracket={refetchBracket}
        assignByes={assignByes}
        eventType={eventType}
      />

      {/* Classic FX overlays */}
      {fxEnabled && showCountdown && (
        <CountdownSplash seconds={3} onDone={() => setShowCountdown(false)} />
      )}
      {fxEnabled && overlayOpen && overlayData && (
        <RevealOverlay
          open={overlayOpen}
          mode={overlayMode}
          data={overlayData}
          pool={namesPool}
          muted={fxMuted}
          onClose={() => setOverlayOpen(false)}
          onAfterShow={() => {
            if (overlayMode === "ko") fireConfettiBurst();
          }}
        />
      )}

      {/* Card Mode Overlay */}
      {cardOpen && (
        <CardDeckOverlay
          reveals={reveals}
          open={cardOpen}
          onClose={() => setCardOpen(false)}
          mode={drawType === "group" ? "group" : "ko"}
          cards={cardDeck}
          onFlipOne={onFlipOneForCards}
          muted={fxMuted}
          targetInfo={targetInfo}
        />
      )}

      <PublicProfileDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        userId={profileUserId}
      />
    </RBContainer>
  );
}
