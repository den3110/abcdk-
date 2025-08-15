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
} from "@mui/material";
import CasinoIcon from "@mui/icons-material/Casino";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { Container as RBContainer } from "react-bootstrap";

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
} from "../../slices/tournamentsApiSlice";
import { useSocket } from "../../context/SocketContext";
import {
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tab,
  Tabs,
  TextField,
} from "@mui/material";
import {
  useGetBracketQuery,
  useGenerateGroupMatchesMutation,
} from "../../slices/tournamentsApiSlice";
import { toast } from "react-toastify";

// const ROUND_OPTIONS = [
//   { code: "R2048", label: "1/2048 (R2048)" },
//   { code: "R1024", label: "1/1024 (R1024)" },
//   { code: "R512", label: "1/512 (R512)" },
//   { code: "R256", label: "1/256 (R256)" },
//   { code: "R128", label: "1/128 (R128)" },
//   { code: "R64", label: "1/64 (R64)" },
//   { code: "R32", label: "1/32 (R32)" },
//   { code: "R16", label: "1/16 (R16)" },
//   { code: "QF", label: "Tứ kết (QF)" },
//   { code: "SF", label: "Bán kết (SF)" },
//   { code: "F", label: "Chung kết (F)" },
// ];

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

// tên team/cặp hiển thị cho reveal/preview
const nameFromPlayer = (p) => p?.fullName || p?.name || p?.nickname || "N/A";
export const safePairName = (reg, evType = "double") => {
  if (!reg) return "—";
  if (evType === "single") return nameFromPlayer(reg?.player1);
  const p1 = nameFromPlayer(reg?.player1);
  const p2 = nameFromPlayer(reg?.player2);
  return p2 ? `${p1} & ${p2}` : p1;
};

export default function DrawPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const navigate = useNavigate();
  const { id: tournamentId } = useParams();
  const [q] = useSearchParams();
  const preselectBracket = q.get("bracketId") || "";

  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = String(userInfo?.role || "").toLowerCase() === "admin";

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
  // Load trạng thái draw của bracket hiện tại (kể cả khi committed)

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
  // group nếu là group/gsl/swiss, còn lại knockout
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

  const groups = useMemo(
    () => bracketDetail?.groups || bracket?.groups || [],
    [bracketDetail, bracket]
  );
  // phiên draw
  const [drawId, setDrawId] = useState(null);
  const [state, setState] = useState("idle"); // idle|running|committed|canceled
  const [reveals, setReveals] = useState([]); // group: từng team->group ; ko: từng cặp
  const [planned, setPlanned] = useState(null); // kế hoạch (group sizes/byes/cặp dự kiến)
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

  const addManualPair = (groupId, a, b) => {
    if (!a || !b || a === b) return;
    setManualPairs((prev) => {
      const list = prev[groupId] || [];
      if (
        list.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
      )
        return prev;
      return { ...prev, [groupId]: list.concat([{ a, b }]) };
    });
  };

  const onGenerateGroupMatches = async () => {
    try {
      if (!selBracketId) return;
      if (tabMode === "auto") {
        await generateGroupMatches({
          bracketId: selBracketId,
          mode: "auto",
        }).unwrap();
      } else {
        const matches = [];
        Object.entries(manualPairs).forEach(([gid, list]) => {
          list.forEach((p) =>
            matches.push({ groupId: gid, pairA: p.a, pairB: p.b })
          );
        });
        if (!matches.length) {
          alert("Chưa chọn cặp nào.");
          return;
        }
        await generateGroupMatches({
          bracketId: selBracketId,
          mode: "manual",
          matches,
        }).unwrap();
      }
      setOpenGroupDlg(false);
      setManualPairs({});
      alert("Đã tạo trận trong bảng.");
    } catch (e) {
      alert(e?.data?.message || e?.error || "Tạo trận thất bại.");
    }
  };

  function nextPow2(n) {
    let p = 1;
    const need = Math.max(2, n | 0);
    while (p < need) p <<= 1;
    return p;
  }
  function codeLabelForSize(size) {
    if (size >= 16) return { code: `R${size}`, label: `1/${size} (R${size})` };
    if (size === 8) return { code: "QF", label: "Tứ kết (QF)" };
    if (size === 4) return { code: "SF", label: "Bán kết (SF)" };
    if (size === 2) return { code: "F", label: "Chung kết (F)" };
    // fallback (hiếm)
    return { code: `R${size}`, label: `1/${size} (R${size})` };
  }
  function buildKnockoutOptions(teamCount) {
    if (!Number.isFinite(teamCount) || teamCount < 2) {
      return [{ code: "F", label: "Chung kết (F)", roundNumber: 1 }];
    }
    const full = nextPow2(teamCount); // làm tròn lên lũy thừa 2
    const totalRounds = Math.log2(full); // tổng số vòng
    const out = [];
    for (let size = full, idx = 1; size >= 2; size >>= 1, idx++) {
      const { code, label } = codeLabelForSize(size);
      out.push({ code, label, roundNumber: idx /* vòng 1..N */ });
    }
    return out;
  }

  // Số đội đăng ký trong giải -> suy ra các vòng knockout hợp lệ
  const { data: regsData, isLoading: lRegs } = useGetRegistrationsQuery(
    tournamentId,
    { skip: !tournamentId }
  );
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

  // Khi đổi bracket → reset toàn bộ kết quả bốc hiện tại (tránh giữ của bracket cũ)
  useEffect(() => {
    if (!selBracketId) return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    setLog([]);
  }, [selBracketId]);

  // Khi đổi vòng cần bốc (knockout) → reset kết quả hiện tại cho vòng mới
  useEffect(() => {
    if (drawType !== "knockout") return;
    setDrawId(null);
    setState("idle");
    setReveals([]);
    setPlanned(null);
    // không xoá log nếu bạn muốn xem lịch sử người dùng, nhưng nên clear cho “vòng” mới:
    setLog([]);
  }, [roundCode, drawType]);

  // khi đổi bracket / regCount, nếu roundCode hiện tại không hợp lệ thì set về option đầu
  useEffect(() => {
    if (drawType !== "knockout") return;
    if (!knockoutOptions.find((o) => o.code === roundCode)) {
      setRoundCode(knockoutOptions[0]?.code || "F");
    }
  }, [drawType, knockoutOptions, roundCode]);

  // Khi đổi bracket hoặc reload, đồng bộ từ server
  useEffect(() => {
    if (!drawStatus) return;
    setDrawId(drawStatus.drawId || null);
    setState(drawStatus.state || "idle");
    setReveals(Array.isArray(drawStatus.reveals) ? drawStatus.reveals : []);
  }, [drawStatus]);

  // auto chọn bracket đầu tiên nếu chưa có
  useEffect(() => {
    if (!selBracketId && brackets.length) {
      setSelBracketId(brackets[0]._id);
    }
  }, [brackets, selBracketId]);

  // ─────────────────────────────────────────────────────────────
  // Socket: subscribe theo BRACKET (để nhận draw:planned)
  useEffect(() => {
    if (!socket || !selBracketId) return;

    // 2 loại API backend từng dùng: draw:subscribe hoặc draw:join (theo bracket)
    socket.emit("draw:subscribe", { bracketId: selBracketId });
    socket.emit("draw:join", { bracketId: selBracketId });

    const onPlanned = (payload) => {
      // payload: { bracketId, planned, groups }
      setPlanned(payload);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "planned" }]));
    };

    socket.on("draw:planned", onPlanned);

    return () => {
      socket.off("draw:planned", onPlanned);
      // rời cả 2 kênh cho chắc
      socket.emit("draw:unsubscribe", { bracketId: selBracketId });
      socket.emit("draw:leave", { bracketId: selBracketId });
    };
  }, [socket, selBracketId]);
  // ─────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  // Socket: join theo DRAW (để nhận update/revealed/committed/canceled)
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
  // ─────────────────────────────────────────────────────────────

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

  if (lt || lb || ls || lRegs) {
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
          ? { mode: "group" } // BE tự dùng config group hiện tại (round-robin/swiss/gsl)
          : { mode: "knockout", round: roundCode, usePrevWinners };

      const resp = await startDraw({ bracketId: selBracketId, body }).unwrap();
      // resp dự kiến: { drawId, state, reveals: [] }
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
    } catch(e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:reveal" }]));
    }
  };

  const onCommit = async () => {
    if (!canOperate) return;
    try {
      await drawCommit({ drawId }).unwrap();
    } catch(e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:commit" }]));
    }
  };

  const onCancel = async () => {
    if (!drawId) return;
    try {
      await drawCancel({ drawId }).unwrap();
    } catch(e) {
      toast.error(e?.data?.message || e?.error);
      setLog((lg) => lg.concat([{ t: Date.now(), type: "error:cancel" }]));
    }
  };

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

      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {/* Reveals */}
        <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography fontWeight={700} gutterBottom>
            Kết quả bốc (reveal)
          </Typography>

          {reveals.length === 0 ? (
            <Typography color="text.secondary">Chưa có reveal nào.</Typography>
          ) : drawType === "group" ? (
            <Stack spacing={1}>
              {reveals.map((rv, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`#${i + 1}`} />
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`Bảng ${rv.group || rv.bucket || "?"}`}
                  />
                  <Typography sx={{ fontWeight: 600 }}>
                    {rv.teamName || rv.name}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          ) : (
            <Stack spacing={1}>
              {reveals.map((pair, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={`Cặp ${i + 1}`} />
                  <Typography sx={{ fontWeight: 600 }}>
                    {pair.A?.name || pair.AName || "—"}
                  </Typography>
                  <Typography color="text.secondary">vs</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {pair.B?.name || pair.BName || "—"}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* Quick links + Planned (nếu có) */}
        <Paper variant="outlined" sx={{ p: 2, width: { md: 360 } }}>
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
              <Alert severity="info">
                Hệ thống sẽ tạo lịch thi đấu vòng tròn (round-robin) cho từng
                bảng.
              </Alert>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {groups.map((g) => {
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

                      {/* Simple manual pair UI: chọn 2 id rồi “Thêm cặp” */}
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
                            addManualPair(String(g._id), a, b);
                          }}
                        >
                          Thêm cặp
                        </Button>
                      </Stack>

                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Các cặp đã chọn:
                      </Typography>
                      <Stack spacing={0.5}>
                        {(manualPairs[String(g._id)] || []).map((p, idx) => (
                          <Typography key={idx} variant="body2">
                            • {p.a} vs {p.b}
                          </Typography>
                        ))}
                        {!(manualPairs[String(g._id)] || []).length && (
                          <Typography variant="body2" color="text.secondary">
                            Chưa có cặp nào.
                          </Typography>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenGroupDlg(false)}>Đóng</Button>
            <Button
              onClick={onGenerateGroupMatches}
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
