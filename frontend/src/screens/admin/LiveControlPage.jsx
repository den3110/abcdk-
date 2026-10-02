// Điều khiển luồng live từ web pickletour.vn (admin).
// Web → backend proxy → control-server desktop (Tailscale). Port từ bản mobile.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Snackbar,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LaunchIcon from "@mui/icons-material/Launch";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import MicIcon from "@mui/icons-material/Mic";
import SEOHead from "../../components/SEOHead";
import {
  useGetLiveMachinesQuery,
  useLiveControlCallMutation,
  useCreateCommentaryTokenMutation,
} from "../../slices/liveControlApiSlice";

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const CORNER_LABEL = {
  "top-left": "Trên·Trái",
  "top-right": "Trên·Phải",
  "bottom-left": "Dưới·Trái",
  "bottom-right": "Dưới·Phải",
};
const OPACITY_PRESETS = [50, 60, 70, 80, 90, 100];
const LAYOUT_KEYS = [
  ["scoreboard", "Bảng điểm"],
  ["brand", "Logo"],
  ["sponsor", "Tài trợ"],
];

function normalizeRole(r) {
  return String(r || "").trim().toLowerCase();
}
function isAdminUser(u) {
  const roles = new Set(Array.isArray(u?.roles) ? u.roles.map(normalizeRole) : []);
  if (u?.role) roles.add(normalizeRole(u.role));
  if (u?.isAdmin === true) roles.add("admin");
  if (u?.isSuperUser || u?.isSuperAdmin) roles.add("admin");
  return roles.has("admin");
}

export default function LiveControlPage() {
  const navigate = useNavigate();
  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = isAdminUser(userInfo);
  const isCommentator = !!userInfo?.isCommentator;
  const canAccess = isAdmin || isCommentator;
  // Bình luận viên (không phải admin): chỉ xem + bình luận, ẩn mọi điều khiển.
  const commentaryOnly = !isAdmin;

  const {
    data: machinesData,
    isLoading: loadingMachines,
    refetch: refetchMachines,
  } = useGetLiveMachinesQuery(undefined, { pollingInterval: 20000 });
  const machines = useMemo(
    () => machinesData?.machines || [],
    [machinesData],
  );
  const [machineId, setMachineId] = useState("");
  const [callMut] = useLiveControlCallMutation();
  const [createCommentaryToken] = useCreateCommentaryTokenMutation();

  const [snap, setSnap] = useState({ perf: {}, sessions: [], schedules: [] });
  const [opacity, setOpacity] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const pollRef = useRef(null);

  // Chọn máy online đầu tiên khi có danh sách.
  useEffect(() => {
    if (!machineId && machines.length) {
      const online = machines.find((m) => m.online) || machines[0];
      if (online) setMachineId(online.machineId);
    }
  }, [machines, machineId]);

  const call = useCallback(
    async (path, method = "GET", body) => {
      if (!machineId) throw new Error("Chưa chọn máy");
      return callMut({ machineId, path, method, body }).unwrap();
    },
    [machineId, callMut],
  );

  const loadState = useCallback(async () => {
    if (!machineId) return;
    try {
      const d = await call("/api/state");
      setSnap({ perf: d?.perf || {}, sessions: d?.sessions || [], schedules: d?.schedules || [] });
      setErr("");
    } catch (e) {
      setErr(e?.data?.message || e?.message || "Không kết nối được máy live");
    }
  }, [machineId, call]);

  const loadOpacity = useCallback(async () => {
    if (!machineId) return;
    try {
      const d = await call("/api/get-opacity");
      if (d?.opacity != null) setOpacity(Math.round(Number(d.opacity) * 100));
    } catch (e) {
      /* bỏ qua */
    }
  }, [machineId, call]);

  // Poll state mỗi 5s theo máy đang chọn.
  useEffect(() => {
    if (!machineId) return undefined;
    loadState();
    loadOpacity();
    pollRef.current = setInterval(loadState, 5000);
    return () => clearInterval(pollRef.current);
  }, [machineId, loadState, loadOpacity]);

  const withBusy = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      await loadState();
      if (okMsg) setToast(okMsg);
    } catch (e) {
      setToast(e?.data?.message || e?.message || "Lỗi, thử lại");
    } finally {
      setBusy(false);
    }
  };

  const stopCourt = (s) => {
    if (!window.confirm(`Dừng live ${s.court || "sân"}?`)) return;
    withBusy(() => call("/api/stop", "POST", { sid: s.sid }));
  };
  const stopAll = () => {
    if (!window.confirm("Dừng TẤT CẢ sân đang live?")) return;
    withBusy(() => call("/api/stop-all", "POST", {}));
  };
  const cycleLayout = (s, key) => {
    const cur = s.layout?.[key] || "top-left";
    const next = CORNERS[(CORNERS.indexOf(cur) + 1) % CORNERS.length];
    const layout = { ...(s.layout || {}), [key]: next };
    withBusy(() => call("/api/set-layout", "POST", { sid: s.sid, layout }));
  };
  const toggleTs = (s, on) =>
    withBusy(() => call("/api/set-ts-cover", "POST", { sid: s.sid, hideTimestamp: on }));
  const setNameMode = (s, mode) =>
    withBusy(() => call("/api/set-layout", "POST", { sid: s.sid, nameMode: mode }));
  const applyOpacity = (pct) => {
    setOpacity(pct);
    withBusy(() => call("/api/set-opacity", "POST", { opacity: pct / 100 }));
  };
  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setToast("Đã copy link");
    } catch (e) {
      /* bỏ qua */
    }
  };
  // Mở trang bình luận viên (mic → luồng live) cho 1 sân. Mở tab mới NGAY để không bị
  // trình duyệt chặn popup, rồi điều hướng khi có link.
  const openCommentary = async (s) => {
    const w = window.open("", "_blank");
    try {
      const d = await createCommentaryToken({
        machineId,
        sid: s.sid,
        courtName: s.court || "",
      }).unwrap();
      if (w) w.location.href = d.url;
      else setToast("Hãy cho phép mở cửa sổ bật lên để bình luận");
    } catch (e) {
      if (w) w.close();
      setToast(e?.data?.message || e?.message || "Không tạo được liên kết bình luận");
    }
  };

  const sessions = snap.sessions || [];
  const schedules = snap.schedules || [];
  const perf = snap.perf || {};
  const fmtSched = (ms) => { try { return new Date(Number(ms)).toLocaleString("vi-VN"); } catch { return String(ms); } };
  const cancelSchedule = (sc) => withBusy(() => call("/api/schedule-cancel", "POST", { id: sc.id }));

  if (!userInfo) return <Navigate to="/login" replace />;
  if (!canAccess) return <Navigate to="/403" replace />;

  return (
    <Box sx={{ maxWidth: 1000, mx: "auto" }}>
      <SEOHead title="Điều khiển Live" noIndex />

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {commentaryOnly ? "🎙️ Bình luận Live" : "🎬 Điều khiển Live"}
        </Typography>
        <Tooltip title="Làm mới">
          <IconButton
            onClick={() => {
              refetchMachines();
              loadState();
            }}
          >
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Chọn máy */}
      {loadingMachines ? (
        <Box sx={{ display: "flex", justifyContent: "center", my: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : machines.length === 0 ? (
        <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>
            Chưa có máy PC live nào online
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Trên app desktop: đăng nhập admin + bật &quot;Điều khiển từ xa&quot;
            (control server) + máy phải trong Tailscale cùng máy chủ.
          </Typography>
        </Card>
      ) : (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 2, overflowX: "auto", pb: 1 }}
        >
          {machines.map((m) => (
            <Chip
              key={m.machineId}
              icon={
                <FiberManualRecordIcon
                  sx={{
                    fontSize: 12,
                    color: m.online ? "#22C55E !important" : "#94A3B8 !important",
                  }}
                />
              }
              label={m.label || m.machineId}
              color={m.machineId === machineId ? "primary" : "default"}
              variant={m.machineId === machineId ? "filled" : "outlined"}
              onClick={() => setMachineId(m.machineId)}
              sx={{ fontWeight: 700, flexShrink: 0 }}
            />
          ))}
        </Stack>
      )}

      {!!machineId && (
        <>
          {/* Thêm sân live / hẹn giờ (chỉ admin) */}
          {!commentaryOnly && (
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() =>
                navigate(
                  `/admin/live-add?machineId=${encodeURIComponent(machineId)}`,
                )
              }
              sx={{ mb: 2, py: 1.25, fontWeight: 800 }}
            >
              Thêm sân live / Hẹn giờ
            </Button>
          )}

          {/* Perf + lỗi */}
          <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {perf.cpuModel
                ? `${perf.cpuModel} · ${perf.cpuCount || "?"} lõi · `
                : ""}
              CPU {perf.cpuPct == null ? "…" : `${perf.cpuPct}%`} · còn ~
              {perf.moreCourts == null ? "…" : perf.moreCourts} sân
            </Typography>
            {!!err && (
              <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                {err}
              </Typography>
            )}
          </Card>

          {/* Độ hiển thị overlay (chung) — chỉ admin */}
          {!commentaryOnly && (
            <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>
                🎚️ Độ hiển thị overlay (chung mọi sân)
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {OPACITY_PRESETS.map((p) => (
                  <Button
                    key={p}
                    size="small"
                    variant={opacity === p ? "contained" : "outlined"}
                    onClick={() => applyOpacity(p)}
                    sx={{ minWidth: 56, fontWeight: 700 }}
                  >
                    {p}%
                  </Button>
                ))}
              </Stack>
            </Card>
          )}

          {/* Dừng tất cả — chỉ admin */}
          {!commentaryOnly && sessions.length > 0 && (
            <Button
              fullWidth
              color="error"
              variant="outlined"
              startIcon={<StopIcon />}
              onClick={stopAll}
              sx={{ mb: 2, py: 1.25, fontWeight: 800 }}
            >
              Dừng tất cả
            </Button>
          )}

          {/* Lịch đã hẹn giờ */}
          {!commentaryOnly && schedules.length > 0 && (
            <Card variant="outlined" sx={{ p: 2, mb: 2, mt: 1 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>
                ⏰ Lịch đã hẹn ({schedules.length})
              </Typography>
              <Stack spacing={1}>
                {schedules.map((sc) => (
                  <Stack
                    key={sc.id}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {sc.label || sc.title || [sc.meta?.tournamentName, sc.meta?.courtName].filter(Boolean).join(" - ") || "(live)"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {fmtSched(sc.startAt)}{sc.meta?.perMatch ? " · live từng trận" : ""}
                      </Typography>
                    </Box>
                    <Button size="small" color="error" variant="outlined" onClick={() => cancelSchedule(sc)}>
                      Xoá
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Card>
          )}

          {/* Danh sách sân */}
          {sessions.length === 0 ? (
            <Typography
              color="text.secondary"
              sx={{ textAlign: "center", mt: 3 }}
            >
              Không có sân nào đang live trên máy này.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {sessions.map((s) => (
                <Card key={s.sid} variant="outlined" sx={{ p: 2 }}>
                  <Stack
                    direction="row"
                    alignItems="flex-start"
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: "1rem" }}>
                        {s.court || "Sân"}{" "}
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            color:
                              s.status === "live" ? "#22C55E" : "text.secondary",
                          }}
                        >
                          {String(s.status || "").toUpperCase()}
                        </Typography>
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {s.tournament || ""}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Trận: {s.match || "—"}
                        {s.bitrateKbps
                          ? ` · ${(s.bitrateKbps / 1000).toFixed(2)}Mbps`
                          : ""}
                        {s.speed ? ` · ${Number(s.speed).toFixed(2)}×` : ""}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<MicIcon />}
                        onClick={() => openCommentary(s)}
                        sx={{ fontWeight: 700 }}
                      >
                        Bình luận
                      </Button>
                      {!commentaryOnly && (
                        <Button
                          color="error"
                          variant="contained"
                          size="small"
                          startIcon={<StopIcon />}
                          onClick={() => stopCourt(s)}
                          sx={{ fontWeight: 700 }}
                        >
                          Dừng
                        </Button>
                      )}
                    </Stack>
                  </Stack>

                  {!commentaryOnly && (
                  <>
                  {/* Link xem */}
                  {(s.watchUrls || []).map((u) => (
                    <Stack
                      key={u}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 1.5,
                        px: 1,
                        py: 0.5,
                        mt: 1,
                      }}
                    >
                      <Button
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<LaunchIcon sx={{ fontSize: 16 }} />}
                        size="small"
                        sx={{
                          flex: 1,
                          justifyContent: "flex-start",
                          textTransform: "none",
                          minWidth: 0,
                          "& .MuiButton-startIcon": { mr: 0.5 },
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                          }}
                        >
                          {u}
                        </Box>
                      </Button>
                      <IconButton size="small" onClick={() => copy(u)}>
                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Stack>
                  ))}

                  <Divider sx={{ my: 1.5 }} />

                  {/* Vị trí overlay (bấm để đổi góc) */}
                  <Typography variant="caption" color="text.secondary">
                    Vị trí overlay (bấm để đổi)
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    {LAYOUT_KEYS.map(([k, label]) => (
                      <Button
                        key={k}
                        variant="outlined"
                        color="inherit"
                        onClick={() => cycleLayout(s, k)}
                        sx={{
                          flex: 1,
                          flexDirection: "column",
                          textTransform: "none",
                          py: 0.75,
                          lineHeight: 1.2,
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {label}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {CORNER_LABEL[s.layout?.[k] || "top-left"]}
                        </Typography>
                      </Button>
                    ))}
                  </Stack>

                  {/* Tên hiển thị trên bảng điểm: biệt danh / họ tên */}
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
                    Tên hiển thị trên bảng điểm
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                    {[["nick", "Biệt danh"], ["full", "Họ tên đầy đủ"]].map(([mode, label]) => {
                      const active = (s.nameMode || "nick") === mode;
                      return (
                        <Button
                          key={mode}
                          variant={active ? "contained" : "outlined"}
                          color={active ? "primary" : "inherit"}
                          onClick={() => setNameMode(s, mode)}
                          sx={{ flex: 1, textTransform: "none", py: 0.75 }}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </Stack>

                  {/* Ẩn ngày giờ */}
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ mt: 1.5 }}
                  >
                    <Typography variant="body2">
                      Ẩn ngày giờ camera (làm mờ)
                    </Typography>
                    <Switch
                      checked={!!s.hideTimestamp}
                      onChange={(e) => toggleTs(s, e.target.checked)}
                    />
                  </Stack>
                  {s.hideTimestamp ? (
                    <Typography variant="caption" color="text.secondary">
                      Bật/tắt sẽ khởi động lại luồng ~vài giây.
                    </Typography>
                  ) : null}
                  </>
                  )}
                </Card>
              ))}
            </Stack>
          )}
        </>
      )}

      {busy && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            bgcolor: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: (th) => th.zIndex.modal + 1,
          }}
        >
          <CircularProgress sx={{ color: "#fff" }} size={48} />
        </Box>
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="info" onClose={() => setToast("")} sx={{ width: "100%" }}>
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
