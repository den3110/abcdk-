// src/components/CourtManagerDialog.jsx
/* eslint-disable react/prop-types */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import QueuePlayNextIcon from "@mui/icons-material/QueuePlayNext";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import EditNoteIcon from "@mui/icons-material/EditNote";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StadiumIcon from "@mui/icons-material/Stadium";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { toast } from "react-toastify";
import { useSocket } from "../context/SocketContext";
import {
  useUpsertCourtsMutation,
  useBuildGroupsQueueMutation,
  useAssignNextHttpMutation,
  useDeleteCourtsMutation,   // bulk delete (giữ nguyên)
  useDeleteCourtMutation,    // NEW: delete 1 court
} from "../slices/adminCourtApiSlice";

/* 👉 chỉnh path cho khớp dự án của bạn */
import ResponsiveModal from "./ResponsiveModal";

/* ---------------- helpers / formatters ---------------- */

const GROUP_LIKE_SET = new Set(["group", "round_robin", "gsl", "swiss"]);
const KO_SET = new Set([
  "ko",
  "knockout",
  "double_elim",
  "roundelim",
  "elimination",
]);

const norm = (s) => String(s || "").toLowerCase();
const isGroupLike = (m) => {
  const bt = norm(m?.bracketType);
  const t1 = norm(m?.type);
  const t2 = norm(m?.format);
  if (GROUP_LIKE_SET.has(bt)) return true;
  if (KO_SET.has(bt)) return false;
  if (GROUP_LIKE_SET.has(t1) || GROUP_LIKE_SET.has(t2)) return true;
  if (KO_SET.has(t1) || KO_SET.has(t2)) return false;
  return !!m?.pool;
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

const viMatchStatus = (s) => {
  switch (s) {
    case "scheduled":
      return "Đã lên lịch";
    case "queued":
      return "Trong hàng đợi";
    case "assigned":
      return "Đã gán trận";
    case "live":
      return "Đang thi đấu";
    case "finished":
      return "Đã kết thúc";
    default:
      return s || "";
  }
};
const matchStatusColor = (s) => {
  switch (s) {
    case "assigned":
      return "info";
    case "live":
      return "warning";
    case "finished":
      return "success";
    default:
      return "default";
  }
};
const viCourtStatus = (st) => {
  if (st === "idle") return "Trống";
  if (st === "maintenance") return "Bảo trì";
  if (st === "live") return "Đang thi đấu";
  if (st === "assigned") return "Đã gán trận";
  return st || "";
};

const letterToIndex = (s) => {
  const ch = String(s || "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]$/.test(ch)) return ch.charCodeAt(0) - 64;
  return null;
};
const poolBoardLabel = (m) => {
  const p = m?.pool || {};
  if (isNum(p.index)) return `B${p.index}`;
  const raw = String(p.code || p.name || "").trim();
  if (!raw) return "B?";
  const byLetter = letterToIndex(raw);
  if (byLetter) return `B${byLetter}`;
  const m1 = raw.match(/^B(\d+)$/i);
  if (m1) return `B${m1[1]}`;
  if (/^\d+$/.test(raw)) return `B${raw}`;
  return raw;
};

/* ---------- Build mã trận (V/B/T) ---------- */

const isGlobalCodeString = (s) =>
  typeof s === "string" && /^V\d+(?:-B\d+)?-T\d+$/.test(s);

const codeFromLabelKeyish = (lk) => {
  const s = String(lk || "").trim();
  if (!s) return null;
  const nums = s.match(/\d+/g);
  if (!nums || nums.length < 2) return null;

  const v = Number(nums[0]);
  if (/#B\d+/i.test(s)) {
    const b = nums.length >= 3 ? Number(nums[1]) : 1;
    const t = Number(nums[nums.length - 1]);
    return `V${v}-B${b}-T${t}`;
  }
  const t = Number(nums[nums.length - 1]);
  return `V${v}-T${t}`;
};

const fallbackGlobalCode = (m, idx) => {
  const baseOrder =
    typeof m?.order === "number" && Number.isFinite(m.order)
      ? m.order
      : Number.isFinite(idx)
      ? idx
      : 0;
  const T = baseOrder + 1;

  if (isGroupLike(m)) {
    const rawB = poolBoardLabel(m);
    const hit = /^B(\d+)$/.exec(rawB);
    const B = hit ? Number(hit[1]) : 1;
    return `V1-B${B}-T${T}`;
  }

  const r = Number.isFinite(Number(m?.round)) ? Number(m.round) : 1;
  return `V${r}-T${T}`;
};

const buildMatchCode = (m, idx) => {
  if (!m) return "";
  if (isGlobalCodeString(m.codeDisplay)) return m.codeDisplay;
  if (isGlobalCodeString(m.globalCode)) return m.globalCode;
  if (isGlobalCodeString(m.code)) return m.code;

  const byLabel =
    codeFromLabelKeyish(m.labelKeyDisplay) || codeFromLabelKeyish(m.labelKey);
  if (isGlobalCodeString(byLabel)) return byLabel;

  return fallbackGlobalCode(m, idx);
};

/* ---------- Tên đội/ người ---------- */
const personName = (p) => {
  if (!p || typeof p !== "object") return "";
  const cands = [
    p.nickname,
    p.nickName,
    p.user?.nickname,
    p.user?.nickName,
    p.profile?.nickname,
    p.profile?.nickName,
    p.displayName,
    p.fullName,
    p.name,
    p.email,
    p.phone,
  ];
  for (const v of cands) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
};
const pairName = (pair) => {
  if (!pair) return "";
  const names = [];
  if (pair.player1) names.push(personName(pair.player1));
  if (pair.player2) names.push(personName(pair.player2));
  if (!names.filter(Boolean).length && Array.isArray(pair.participants)) {
    for (const it of pair.participants) names.push(personName(it?.user || it));
  }
  if (!names.filter(Boolean).length) {
    const label =
      pair.nickname ||
      pair.nickName ||
      pair.shortName ||
      pair.code ||
      pair.displayName ||
      pair.name ||
      "";
    return String(label || "").trim();
  }
  return names.filter(Boolean).join(" & ");
};

/* ---------------- Dialog nội bộ: chọn trận cụ thể để gán vào sân ---------------- */
function AssignSpecificDialog({ open, onClose, court, matches, onConfirm }) {
  const [value, setValue] = useState(null);
  const handleOk = () => {
    if (value) onConfirm(String(value._id || value.id));
  };
  useEffect(() => {
    if (!open) setValue(null);
  }, [open]);

  const optionLabel = useCallback((m) => {
    if (!m) return "";
    const code = buildMatchCode(m);
    const A = (m.pairA ? pairName(m.pairA) : "") || m.pairAName || "Đội A";
    const B = (m.pairB ? pairName(m.pairB) : "") || m.pairBName || "Đội B";
    const st = viMatchStatus(m.status);
    return `${code} · ${A} vs ${B} · ${st}`;
  }, []);

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="sm"
      icon={<StadiumIcon />}
      title="Gán trận vào sân"
      actions={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="contained" disabled={!value} onClick={handleOk}>
            Xác nhận gán
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Alert severity="info">
          Sân:{" "}
          <strong>
            {court?.name ||
              court?.label ||
              court?.title ||
              court?.code ||
              "(không rõ)"}
          </strong>
        </Alert>
        <Autocomplete
          options={matches || []}
          getOptionLabel={optionLabel}
          value={value}
          onChange={(e, v) => setValue(v || null)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Chọn trận để gán"
              placeholder="Nhập mã hoặc tên đội..."
            />
          )}
          isOptionEqualToValue={(o, v) =>
            String(o._id || o.id) === String(v._id || v.id)
          }
        />
        <Typography variant="caption" color="text.secondary">
          * Hệ thống sẽ thay thế trận đang gán (nếu có) bằng trận bạn chọn.
        </Typography>
      </Stack>
    </ResponsiveModal>
  );
}

/* ---------------- Dialog chính: Quản lý sân (TOÀN GIẢI) ---------------- */
export default function CourtManagerDialog({
  open,
  onClose,
  tournamentId,
  // giữ tương thích prop cũ nhưng KHÔNG dùng nữa:
  bracketId, // eslint-disable-line no-unused-vars
  bracketName, // eslint-disable-line no-unused-vars
  tournamentName,
}) {
  const socket = useSocket();

  // Cấu hình sân
  const [mode, setMode] = useState("count"); // "count" | "names"
  const [count, setCount] = useState(4);
  const [namesText, setNamesText] = useState("Sân 1\nSân 2\nSân 3\nSân 4");
  const [autoAssign, setAutoAssign] = useState(false);

  const names = useMemo(
    () =>
      namesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [namesText]
  );

  // Realtime state
  const [courts, setCourts] = useState([]);
  const [socketMatches, setSocketMatches] = useState([]);
  const [queue, setQueue] = useState([]);
  const notifQueueRef = useRef([]);

  // Mutations
  const [upsertCourts, { isLoading: savingCourts }] = useUpsertCourtsMutation();
  const [buildQueue, { isLoading: buildingQueue }] =
    useBuildGroupsQueueMutation();
  const [assignNextHttp] = useAssignNextHttpMutation();
  const [deleteCourts, { isLoading: deletingCourts }] =
    useDeleteCourtsMutation(); // bulk
  const [deleteCourt, { isLoading: deletingOne }] = useDeleteCourtMutation(); // NEW single

  // Join/leave socket room khi mở/đóng dialog — TOÀN GIẢI
  useEffect(() => {
    if (!open || !socket || !tournamentId) return;

    const room = { tournamentId };

    const onState = ({ courts, matches, queue }) => {
      setCourts(courts || []);
      setSocketMatches(matches || []);
      setQueue(
        (queue && Array.isArray(queue) ? queue : matches || []).map((m) => ({
          id: m._id || m.id,
          ...m,
        }))
      );
    };
    const onNotify = (msg) => {
      notifQueueRef.current = [msg, ...notifQueueRef.current].slice(0, 20);
    };
    const reqState = () => socket.emit("scheduler:requestState", room);

    socket.emit("scheduler:join", room);
    socket.on("scheduler:state", onState);
    socket.on("scheduler:notify", onNotify);
    socket.on?.("match:update", reqState);
    socket.on?.("match:finish", reqState);

    reqState();
    const interval = setInterval(reqState, 45000);

    return () => {
      clearInterval(interval);
      socket.emit("scheduler:leave", room);
      socket.off("scheduler:state", onState);
      socket.off("scheduler:notify", onNotify);
      socket.off?.("match:update", reqState);
      socket.off?.("match:finish", reqState);
    };
  }, [open, socket, tournamentId]);

  const matchMap = useMemo(() => {
    const map = new Map();
    for (const m of socketMatches) map.set(String(m._id || m.id), m);
    return map;
  }, [socketMatches]);

  const getMatchForCourt = (c) => {
    if (c?.currentMatchObj) return c.currentMatchObj;
    if (c?.currentMatch) return matchMap.get(String(c.currentMatch)) || null;
    return null;
  };
  const courtStatus = (c) => {
    const m = getMatchForCourt(c);
    if (c?.status) return c.status;
    if (!m) return "idle";
    if (m.status === "live") return "live";
    return "assigned";
  };
  const getMatchCodeForCourt = (c) => {
    const m = getMatchForCourt(c);
    if (!m) return "";
    if (isGlobalCodeString(m.codeDisplay)) return m.codeDisplay;
    return m.currentMatchCode || buildMatchCode(m);
  };
  const getTeamsForCourt = (c) => {
    const m = getMatchForCourt(c);
    if (!m) return { A: "", B: "" };
    const A = (m.pairA ? pairName(m.pairA) : "") || m.pairAName || "";
    const B = (m.pairB ? pairName(m.pairB) : "") || m.pairBName || "";
    return { A, B };
  };

  const selectableMatches = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (m) => {
      if (!m) return;
      const id = String(m._id || m.id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(m);
    };
    for (const m of queue || []) push(m);
    for (const m of socketMatches || []) {
      const st = String(m?.status || "");
      if (["scheduled", "queued", "assigned"].includes(st)) push(m);
    }

    const STATUS_RANK = {
      queued: 0,
      scheduled: 1,
      assigned: 2,
      live: 3,
      finished: 4,
    };
    const statusRank = (s) => STATUS_RANK[String(s || "").toLowerCase()] ?? 9;

    const parseTripletFromCode = (code) => {
      const m = /^V(\d+)(?:-B(\d+))?-T(\d+)$/.exec(String(code || "").trim());
      return m
        ? { v: Number(m[1]), b: m[2] ? Number(m[2]) : null, t: Number(m[3]) }
        : null;
    };
    const tripletOf = (m) => {
      const code =
        (isGlobalCodeString(m?.codeDisplay) && m.codeDisplay) ||
        (isGlobalCodeString(m?.globalCode) && m.globalCode) ||
        (isGlobalCodeString(m?.code) && m.code) ||
        codeFromLabelKeyish(m?.labelKeyDisplay) ||
        codeFromLabelKeyish(m?.labelKey) ||
        fallbackGlobalCode(m);
      return parseTripletFromCode(code) || { v: 999, b: 999, t: 999 };
    };

    out.sort((a, b) => {
      const ta = tripletOf(a);
      const tb = tripletOf(b);
      if (ta.v !== tb.v) return ta.v - tb.v;

      const ga = isGroupLike(a);
      const gb = isGroupLike(b);

      if (ga && gb) {
        if ((ta.t || 0) !== (tb.t || 0)) return (ta.t || 0) - (tb.t || 0);
        const ba = ta.b ?? 999,
          bb = tb.b ?? 999;
        if (ba !== bb) return ba - bb;
      } else if (!ga && !gb) {
        if ((ta.t || 0) !== (tb.t || 0)) return (ta.t || 0) - (tb.t || 0);
      } else {
        return ga ? -1 : 1;
      }

      const sdiff = statusRank(a.status) - statusRank(b.status);
      if (sdiff !== 0) return sdiff;

      return (Number(a.order) || 9999) - (Number(b.order) || 9999);
    });

    return out;
  }, [queue, socketMatches]);

  /* ---------- handlers ---------- */
  const requestState = () => {
    if (socket && tournamentId) {
      socket.emit("scheduler:requestState", { tournamentId });
    }
  };

  const handleSaveCourts = async () => {
    if (!tournamentId) {
      toast.error("Thiếu tournamentId.");
      return;
    }
    const payload =
      mode === "names"
        ? { tournamentId, names, autoAssign }
        : {
            tournamentId,
            count: Number(count) || 0,
            autoAssign,
          };
    try {
      await upsertCourts(payload).unwrap();
      toast.success(
        autoAssign
          ? "Đã lưu danh sách sân toàn giải. Tự động gán trận đang BẬT."
          : "Đã lưu danh sách sân toàn giải."
      );
      requestState();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Lỗi lưu sân");
    }
  };

  const handleBuildQueue = async () => {
    if (!tournamentId) return;
    try {
      const res = await buildQueue({
        tournamentId,
      }).unwrap();
      toast.success(
        `Đã xếp ${res?.totalQueued ?? 0} trận vào hàng đợi toàn giải.`
      );
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Xếp hàng đợi thất bại");
    } finally {
      requestState();
    }
  };

  const handleAssignNext = async (courtId) => {
    if (!tournamentId || !courtId) return;
    socket?.emit?.("scheduler:assignNext", {
      tournamentId,
      courtId,
    });
    await assignNextHttp({ tournamentId, courtId })
      .unwrap()
      .catch(() => {});
    requestState();
  };

  const handleResetAll = () => {
    if (!tournamentId) return;
    const ok = window.confirm(
      "Reset TẤT CẢ sân của giải (gỡ gán & xoá khỏi bộ lập lịch)?"
    );
    if (!ok) return;
    socket?.emit?.("scheduler:resetAll", { tournamentId });
    toast.success("Đã gửi lệnh reset tất cả sân .");
    requestState();
  };

  const handleDeleteAllCourts = async () => {
    if (!tournamentId) {
      toast.error("Thiếu tournamentId.");
      return;
    }
    const ok = window.confirm(
      "Bạn chắc chắn muốn XOÁ TẤT CẢ SÂN của giải này?\nHành động này không thể hoàn tác."
    );
    if (!ok) return;
    try {
      await deleteCourts({ tournamentId }).unwrap();
      toast.success("Đã xoá tất cả sân.");
      requestState();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Xoá sân thất bại");
    }
  };

  // NEW: per-court delete busy set
  const [busyDelete, setBusyDelete] = useState(() => new Set());

  // NEW: Xoá 1 sân
  const handleDeleteOneCourt = async (court) => {
    if (!tournamentId || !court) return;

    const courtId = court._id || court.id;
    const label =
      court?.name ||
      court?.label ||
      court?.title ||
      court?.code ||
      `#${String(courtId).slice(-4)}`;

    // Cảnh báo nếu sân đang có trận hoặc live
    const m = getMatchForCourt(court);
    const isLive = String(m?.status || "").toLowerCase() === "live";
    const note = isLive
      ? "\n⚠️ Sân đang có TRẬN ĐANG THI ĐẤU. Bạn vẫn muốn xoá sân?"
      : m
      ? "\nSân đang có trận được gán. Bạn vẫn muốn xoá sân?"
      : "";

    const ok = window.confirm(
      `Xoá sân "${label}"?${note}\nHành động này không thể hoàn tác.`
    );
    if (!ok) return;

    const next = new Set(busyDelete);
    next.add(String(courtId));
    setBusyDelete(next);

    try {
      await deleteCourt({ tournamentId, courtId }).unwrap();
      toast.success(`Đã xoá sân "${label}".`);
      requestState();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Xoá sân thất bại");
    } finally {
      setBusyDelete((s) => {
        const d = new Set(s);
        d.delete(String(courtId));
        return d;
      });
    }
  };

  // Dialog con: gán trận cụ thể
  const [assignDlgOpen, setAssignDlgOpen] = useState(false);
  const [assignDlgCourt, setAssignDlgCourt] = useState(null);
  const openAssignDlg = (court) => {
    setAssignDlgCourt(court || null);
    setAssignDlgOpen(true);
  };
  const closeAssignDlg = () => {
    setAssignDlgOpen(false);
    setAssignDlgCourt(null);
  };
  const confirmAssignSpecific = (matchId) => {
    if (!tournamentId || !assignDlgCourt || !matchId) return;
    socket?.emit?.("scheduler:assignSpecific", {
      tournamentId,
      courtId: assignDlgCourt._id || assignDlgCourt.id,
      matchId,
      replace: true,
    });
    toast.success("Đã yêu cầu gán trận vào sân.");
    requestState();
    closeAssignDlg();
  };

  /* ---------- UI ---------- */
  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      icon={<StadiumIcon />}
      title={
        <Stack direction="row" alignItems="center" spacing={1}>
          <span>
            Quản lý sân — Toàn giải
            {tournamentName ? ` • ${tournamentName}` : ""}
          </span>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Làm mới">
            <IconButton size="small" onClick={requestState}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      }
      actions={<Button onClick={onClose}>Đóng</Button>}
      contentProps={{ sx: { pt: 1 } }}
    >
      {/* Cấu hình sân */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Cấu hình sân cho toàn giải
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={7}>
            <PaperLike>
              <RadioGroup
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                row
                sx={{ mb: 1 }}
              >
                <FormControlLabel
                  value="count"
                  control={<Radio />}
                  label="Theo số lượng"
                />
                <FormControlLabel
                  value="names"
                  control={<Radio />}
                  label="Theo tên từng sân"
                />
              </RadioGroup>
              {mode === "count" ? (
                <TextField
                  type="number"
                  label="Số lượng sân"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  fullWidth
                  inputProps={{ min: 0 }}
                  sx={{ mb: 1.5 }}
                />
              ) : (
                <TextField
                  label="Tên sân (mỗi dòng 1 tên)"
                  value={namesText}
                  onChange={(e) => setNamesText(e.target.value)}
                  fullWidth
                  multiline
                  minRows={5}
                  sx={{ mb: 1.5 }}
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={autoAssign}
                    onChange={(e) => setAutoAssign(e.target.checked)}
                  />
                }
                label="Tự động gán trận sau khi lưu"
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={handleSaveCourts}
                  disabled={savingCourts}
                >
                  {savingCourts ? "Đang lưu..." : "Lưu danh sách sân"}
                </Button>
                <Tooltip title="Reset tất cả sân (gỡ gán & xoá khỏi bộ lập lịch)">
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<RestartAltIcon />}
                    onClick={handleResetAll}
                  >
                    Reset tất cả
                  </Button>
                </Tooltip>
                <Tooltip title="Xoá TẤT CẢ sân của giải (không thể hoàn tác)">
                  <Button
                    variant="contained"
                    color="error"
                    startIcon={<DeleteForeverIcon />}
                    onClick={handleDeleteAllCourts}
                    disabled={deletingCourts}
                  >
                    {deletingCourts ? "Đang xoá..." : "Xoá tất cả sân"}
                  </Button>
                </Tooltip>
              </Stack>
            </PaperLike>
          </Grid>

          {/* <Grid item xs={12} md={5}>
            <PaperLike>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Hàng đợi vòng bảng (toàn giải)
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Thuật toán: A1, B1, C1… sau đó A2, B2… (tránh VĐV đang thi
                đấu/chờ sân).
              </Typography>
              <Button
                variant="contained"
                startIcon={<QueuePlayNextIcon />}
                onClick={handleBuildQueue}
                disabled={buildingQueue}
              >
                {buildingQueue ? "Đang xếp..." : "Xếp hàng đợi"}
              </Button>
            </PaperLike>
          </Grid> */}
        </Grid>
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Danh sách sân + trận đang gán */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Danh sách sân ({courts.length})
      </Typography>

      {courts.length === 0 ? (
        <Alert severity="info">Chưa có sân nào cho giải này.</Alert>
      ) : (
        <Stack spacing={1}>
          {courts.map((c) => {
            const m = getMatchForCourt(c);
            const hasMatch = Boolean(m);
            const code = getMatchCodeForCourt(c);
            const teams = getTeamsForCourt(c);
            const cs = courtStatus(c);
            const cid = String(c._id || c.id);
            const deletingThis = busyDelete.has(cid) || deletingOne;

            return (
              <PaperRow key={cid}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <Chip
                    label={c.name || c.label || c.title || c.code || "Sân"}
                    color={
                      cs === "idle"
                        ? "default"
                        : cs === "live"
                        ? "success"
                        : cs === "maintenance"
                        ? "warning"
                        : "info"
                    }
                  />
                  <Typography variant="body2">{viCourtStatus(cs)}</Typography>

                  {hasMatch && (
                    <Chip
                      size="small"
                      color={matchStatusColor(m.status)}
                      label={`Trận: ${viMatchStatus(m.status)}`}
                    />
                  )}

                  {hasMatch && (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      flexWrap="wrap"
                    >
                      {code && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Mã: ${code}`}
                          sx={{ cursor: "default" }}
                        />
                      )}
                      {(teams.A || teams.B) && (
                        <Typography variant="body2" sx={{ opacity: 0.85 }}>
                          {teams.A || "Đội A"} <b>vs</b> {teams.B || "Đội B"}
                        </Typography>
                      )}
                      {isGroupLike(m) && (
                        <Chip
                          size="small"
                          label={`Bảng ${poolBoardLabel(m)}`}
                        />
                      )}
                      {isGroupLike(m) && isNum(m?.rrRound) && (
                        <Chip size="small" label={`Lượt ${m.rrRound}`} />
                      )}
                    </Stack>
                  )}
                </Stack>

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<EditNoteIcon />}
                    onClick={() => openAssignDlg(c)}
                  >
                    Sửa trận vào sân
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AutorenewIcon />}
                    disabled={courtStatus(c) !== "idle"}
                    onClick={() => handleAssignNext(c._id || c.id)}
                  >
                    Gán trận kế tiếp
                  </Button>
                  {/* NEW: Xoá sân */}
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteForeverIcon />}
                    disabled={deletingThis}
                    onClick={() => handleDeleteOneCourt(c)}
                  >
                    {deletingThis ? "Đang xoá..." : "Xoá sân"}
                  </Button>
                </Stack>
              </PaperRow>
            );
          })}
        </Stack>
      )}

      <AssignSpecificDialog
        open={assignDlgOpen}
        onClose={closeAssignDlg}
        court={assignDlgCourt}
        matches={selectableMatches}
        onConfirm={confirmAssignSpecific}
      />
    </ResponsiveModal>
  );
}

/* ------------- small presentational wrappers ------------- */
function PaperLike({ children }) {
  return (
    <Box sx={{ p: 1.5, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 1 }}>
      {children}
    </Box>
  );
}
function PaperRow({ children }) {
  return (
    <Box
      sx={{
        p: 1.5,
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {children}
    </Box>
  );
}
