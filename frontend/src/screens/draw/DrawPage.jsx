import React, { useEffect, useMemo, useState, useRef } from "react";
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
} from "@mui/material";
import { Tooltip } from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import CelebrationIcon from "@mui/icons-material/Celebration";
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

/* ===================== FX helpers (no extra deps) ===================== */
// WebAudio beep cue (no external assets)
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
  const beep = (
    freq = 880,
    duration = 0.12,
    type = "triangle",
    gain = 0.02
  ) => {
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
  };
  return { beep };
}

// Lazy confetti (dynamic import; fails silently if not available)
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
  } catch (e) {
    // no-op
  }
}

/* -------------------- utils -------------------- */
function labelBracketType(b) {
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
function GroupSeatingBoard({
  groupsMeta,
  reveals,
  regIndex,
  eventType,
  lastHighlight,
}) {
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
                      <b>Slot {idx + 1}:</b> {val || "—"}
                    </Typography>
                  </Box>
                );
              })}
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

function buildPlayoffOptions(bracket, bracketDetail, regsCount) {
  // số cặp vòng 1
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

  // số vòng tối đa
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
      code: `R${teams}`, // để gửi lên API
      label: `Vòng ${r}`, // hiển thị
      roundNumber: r,
      pairCount: pairs,
    });
    pairs = Math.floor(pairs / 2);
    if (pairs <= 0) break;
  }
  return out;
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
              <span style={{ display: "block" }}>{nameA}</span>
            </Tooltip>
          </SeedTeam>

          <SeedTeam title={nameB} style={teamStyle}>
            <Tooltip title={nameB} arrow placement="bottom">
              <span style={{ display: "block" }}>{nameB}</span>
            </Tooltip>
          </SeedTeam>
        </div>
      </SeedItem>
    </Seed>
  );
};

/* ===================== Live Draw Overlay ===================== */
function useNamesPool(regIndex, eventType) {
  return useMemo(() => {
    const arr = [];
    regIndex?.forEach((reg) => arr.push(safePairName(reg, eventType)));
    // fallback demo names if empty
    if (!arr.length) return ["—", "—", "—", "—"];
    return arr;
  }, [regIndex, eventType]);
}

function Ticker({
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
      const r = Math.floor(Math.random() * pool.length);
      setText(pool[r]);
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
}

function CountdownSplash({ seconds = 3, onDone }) {
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
    </Box>
  );
}

function RevealOverlay({
  open,
  mode,
  data,
  pool,
  muted,
  onClose,
  onAfterShow,
  autoCloseMs = 120,
}) {
  const [phase, setPhase] = useState("spinning"); // spinning -> show -> done
  const { beep } = useAudioCue(!muted);

  const closeRef = useRef();
  const scheduleAutoClose = () => {
    if (!autoCloseMs) return;
    clearTimeout(closeRef.current);
    closeRef.current = setTimeout(() => onClose?.(), autoCloseMs);
  };
  useEffect(() => () => clearTimeout(closeRef.current), []);

  useEffect(() => {
    if (!open) return;
    setPhase("spinning");
    // cue sounds
    setTimeout(() => beep(880, 0.08), 120);
    setTimeout(() => beep(940, 0.08), 280);
    setTimeout(() => beep(990, 0.08), 420);
  }, [open]); // eslint-disable-line

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
                setPhase("show");
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
                  setPhase("show");
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
      <style>{`
        @keyframes popIn { 0%{ transform: scale(0.6); opacity: 0 } 70%{ transform: scale(1.05); opacity: 1 } 100%{ transform: scale(1); } }
        @keyframes fadeOut { to { opacity: 0; transform: translateY(-6px) } }
        @keyframes pulseGlow { 0%{ opacity: 0 } 50%{ opacity: 1 } 100%{ opacity: 0 } }
      `}</style>
    </Box>
  );
}

/* ============================================================= */
/* ======================= MAIN COMPONENT ====================== */
/* ============================================================= */

/* ====== Dialog bốc thăm trận trong bảng (controlled) ====== */
function GroupMatchesDialog({
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
          onClick={async () => {
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

  const [openGroupDlg, setOpenGroupDlg] = useState(false);

  // ===== FX feature toggles =====
  const [fxEnabled, setFxEnabled] = useState(true);
  const [fxMuted, setFxMuted] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState("group");
  const [overlayData, setOverlayData] = useState(null);
  const [lastHighlight, setLastHighlight] = useState(null); // {type: 'group', groupCode, slotIndex}

  const { beep } = useAudioCue(!fxMuted);

  /* ===== Queries ===== */
  const { data: allMatches = [], isLoading: lMatches } =
    useListTournamentMatchesQuery(
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
    const t = String(bracket.type || "").toLowerCase();
    if (["group", "gsl", "swiss"].includes(t)) return "group";
    if (t === "roundelim") return "po";
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

  const koEntrantSize = useMemo(() => {
    const prefillPairsLen =
      Number(
        (bracketDetail?.prefill?.pairs && bracketDetail.prefill.pairs.length) ||
          (bracket?.prefill?.pairs && bracket.prefill.pairs.length) ||
          0
      ) || 0;
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

  const knockoutOptions = useMemo(() => {
    if (drawType === "po") {
      return buildPlayoffOptions(bracket, bracketDetail, regCount);
    }
    return buildKnockoutOptions(koEntrantSize);
  }, [drawType, bracket, bracketDetail, regCount, koEntrantSize]);

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

  // reset on bracket/type change
  useEffect(() => {
    if (!selBracketId) return;
    setRoundTouched(false);
    setRoundCode(null);
  }, [selBracketId, drawType]);

  useEffect(() => {
    if (!selBracketId) return;
    if (!(drawType === "knockout" || drawType === "po")) return;
    if (roundTouched) return;
    if (!roundCode && firstRoundCode) setRoundCode(firstRoundCode);
  }, [selBracketId, drawType, firstRoundCode, roundTouched, roundCode]);

  useEffect(() => {
    updateURL({
      bracketId: selBracketId || "",
      round:
        selBracketId && (drawType === "knockout" || drawType === "po")
          ? roundCode || firstRoundCode || ""
          : "",
    });
  }, [selBracketId, drawType, roundCode, firstRoundCode]); // eslint-disable-line

  // Draw session state
  const [drawId, setDrawId] = useState(null);
  const [state, setState] = useState("idle"); // idle|running|committed|canceled
  const [reveals, setReveals] = useState([]);
  const [planned, setPlanned] = useState(null);
  const [log, setLog] = useState([]);

  useEffect(() => {
    if (!selBracketId) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [selBracketId]);

  useEffect(() => {
    if (!(drawType === "knockout" || drawType === "po")) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [roundCode, drawType]);

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
      if (fxEnabled) fireConfettiBurst();
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
  }, [socket, drawId, refetchBracket, fxEnabled]);

  // Groups raw (persisted)
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
    if (state === "running" && Array.isArray(reveals) && reveals.length)
      return reveals;
    return koPairsPersisted;
  }, [state, reveals, koPairsPersisted]);

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

  // Build rounds for KO
  function buildRoundsForKO({
    roundCode,
    reveals,
    matches,
    eventType,
    selectedRoundNumber,
    selBracketId,
    bracket,
    bracketDetail,
    isPO = false,
  }) {
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
      // PO: bám theo maxRounds cấu hình (nếu có), không dựng đủ cây KO
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

    const seedsCount = {};
    seedsCount[firstRound] = firstRoundPairs;
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
      // --- NEW: Dùng revealsPairs để "điền sống" tên ở vòng đầu khi match còn trống ---
      if (r === firstRound && revealsPairs.length) {
        for (let i = 0; i < Math.min(seeds.length, revealsPairs.length); i++) {
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
      // else if (r === firstRound && revealsPairs.length) {
      //   revealsPairs.forEach((p, i) => {
      //     if (i >= seeds.length) return;
      //     seeds[i] = {
      //       id: `rv-${selBracketId}-${r}-${i}`,
      //       __match: null,
      //       teams: [
      //         { name: p.A || "Chưa có đội" },
      //         { name: p.B || "Chưa có đội" },
      //       ],
      //     };
      //   });
      // }

      const localNo = r - firstRound + 1;
      const title = isPO ? `Vòng ${localNo}` : roundTitleByCount(need);
      rounds.push({ title, seeds });
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
              mode: drawType === "po" ? "po" : "knockout",
              round: roundCode || firstRoundCode,
              ...(drawType === "knockout" ? { usePrevWinners } : {}), // PO không gửi
            };
      const resp = await startDraw({ bracketId: selBracketId, body }).unwrap();
      setDrawId(resp?.drawId);
      setState(resp?.state || "running");
      setReveals(Array.isArray(resp?.reveals) ? resp.reveals : []);
      if (resp?.planned) setPlanned(resp);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "start" }]));
      if (fxEnabled) setShowCountdown(true);
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
  const namesPool = useNamesPool(regIndex, eventType);

  // ==== FX triggers on new reveal (theo slot vừa lộ mặt) ====
  const prevRevealsRef = useRef([]);
  useEffect(() => {
    if (!fxEnabled || state !== "running" || !Array.isArray(reveals)) {
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
          // Tìm group/slot để highlight
          const key =
            c.groupCode ||
            c.groupKey ||
            (typeof c.group === "string" ? c.group : "");
          const slotIndex = reveals
            .slice(0, i)
            .filter(
              (x) => (x.groupCode || x.groupKey || x.group) === key
            ).length;
          const teamName = c.teamName || c.name || c.displayName || "—";
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
  }, [reveals, drawType, state, fxEnabled, beep]);

  // Auto clear highlight after a bit
  useEffect(() => {
    if (!lastHighlight) return;
    const t = setTimeout(() => setLastHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [lastHighlight]);

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
        <Box sx={{ flex: 1 }} />
        {/* FX toggles for stream */}
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

      <Paper
        key={`${selBracketId || "none"}-${
          drawType === "knockout" || drawType === "po"
            ? roundCode || firstRoundCode || "R?"
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
                onChange={(e) => {
                  const id = e.target.value;
                  setSelBracketId(id);
                }}
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
            {" "}
            Kết quả bốc (reveal){" "}
          </Typography>

          {!selBracketId ? (
            <Alert severity="info">Hãy chọn một Bracket để bắt đầu.</Alert>
          ) : drawType === "group" ? (
            groupsMeta.length ? (
              <GroupSeatingBoard
                key={`grp-${selBracketId}-${state}`}
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
              key={`ko-${selBracketId}-${roundCode || firstRoundCode}-${state}`}
              sx={{ overflowX: "auto", pb: 1, position: "relative" }}
            >
              <Bracket
                rounds={buildRoundsForKO({
                  roundCode: roundCode || firstRoundCode,
                  reveals: state === "running" ? revealsForKO : [],
                  matches: koMatchesThisBracket,
                  eventType,
                  selectedRoundNumber,
                  selBracketId,
                  bracket,
                  bracketDetail,
                  isPO: drawType === "po",
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

            {selBracketId && drawType === "group" && hasGroups && (
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

      {/* Live FX Overlays */}
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
            // subtle confetti for KO pairs
            if (overlayMode === "ko") fireConfettiBurst();
          }}
        />
      )}
    </RBContainer>
  );
}
