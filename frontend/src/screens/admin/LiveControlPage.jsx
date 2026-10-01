// Điều khiển luồng live từ web pickletour.vn (admin).
// Web → backend proxy → control-server desktop (Tailscale). Port từ bản mobile.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import SEOHead from "../../components/SEOHead";
import {
  useGetLiveMachinesQuery,
  useLiveControlCallMutation,
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

export default function LiveControlPage() {
  const navigate = useNavigate();

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

  const [snap, setSnap] = useState({ perf: {}, sessions: [] });
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
      setSnap({ perf: d?.perf || {}, sessions: d?.sessions || [] });
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

  const sessions = snap.sessions || [];
  const perf = snap.perf || {};

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
          🎬 Điều khiển Live
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
          {/* Thêm sân live / hẹn giờ */}
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

          {/* Độ hiển thị overlay (chung) */}
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

          {/* Dừng tất cả */}
          {sessions.length > 0 && (
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
                    <Button
                      color="error"
                      variant="contained"
                      size="small"
                      startIcon={<StopIcon />}
                      onClick={() => stopCourt(s)}
                      sx={{ fontWeight: 700, flexShrink: 0 }}
                    >
                      Dừng
                    </Button>
                  </Stack>

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
