// Thêm sân live / Hẹn giờ từ web (admin) — gửi qua backend proxy tới control-server desktop.
// Port từ bản mobile app/admin/live-add.tsx.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import SEOHead from "../../components/SEOHead";
import { useLiveControlCallMutation } from "../../slices/liveControlApiSlice";

// datetime-local value <-> Date
function toLocalInput(d) {
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function LiveAddPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const machineId = params.get("machineId") || "";

  const [callMut] = useLiveControlCallMutation();
  const call = useCallback(
    (path, method = "GET", body) =>
      callMut({ machineId, path, method, body }).unwrap(),
    [machineId, callMut],
  );

  const [opt, setOpt] = useState({
    tournaments: [],
    cams: [],
    rtspSources: [],
    fbPages: [],
    encoders: [],
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // Form state
  const [tourId, setTourId] = useState("");
  const [courts, setCourts] = useState([]);
  const [courtId, setCourtId] = useState("");
  const [tourQuery, setTourQuery] = useState("");
  const [srcType, setSrcType] = useState("rtsp");
  const [rtspIdx, setRtspIdx] = useState("");
  const [urlText, setUrlText] = useState("");
  const [camIdx, setCamIdx] = useState("");
  const [destType, setDestType] = useState("fb");
  const [fbPageId, setFbPageId] = useState("");
  const [crosspost, setCrosspost] = useState([]);
  const [perMatch, setPerMatch] = useState(false);
  const [split, setSplit] = useState(false);
  const [recordClips, setRecordClips] = useState(false);
  const [hideTs, setHideTs] = useState(false);
  const [title, setTitle] = useState("");
  const [encoder, setEncoder] = useState("auto");
  const [schedAt, setSchedAt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await call("/api/options");
        setOpt({
          tournaments: d.tournaments || [],
          cams: d.cams || [],
          rtspSources: d.rtspSources || [],
          fbPages: d.fbPages || [],
          encoders: d.encoders || [],
        });
      } catch (e) {
        setToast(
          e?.data?.message ||
            e?.message ||
            "Không tải được tuỳ chọn (máy offline?)",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [call]);

  const searchTours = useCallback(
    async (q) => {
      try {
        const d = await call(`/api/options?q=${encodeURIComponent(q)}`);
        setOpt((o) => ({ ...o, tournaments: d.tournaments || [] }));
      } catch (e) {
        /* bỏ qua */
      }
    },
    [call],
  );

  const pickTournament = async (id) => {
    setTourId(id);
    setCourtId("");
    setCourts([]);
    try {
      const d = await call(`/api/options?tournamentId=${encodeURIComponent(id)}`);
      setCourts(d.courts || []);
    } catch (e) {
      /* bỏ qua */
    }
  };

  const buildPayload = () => {
    const tour = opt.tournaments.find((t) => t._id === tourId);
    if (!tour) throw new Error("Chọn giải đấu");
    const court = courts.find((c) => c._id === courtId);
    if (!court) throw new Error("Chọn sân");

    let source = {};
    if (srcType === "rtsp") {
      const s = opt.rtspSources[rtspIdx];
      if (!s) throw new Error("Chọn nguồn RTSP");
      source = { sourceUrl: s.url };
    } else if (srcType === "url") {
      if (!urlText.trim()) throw new Error("Nhập link nguồn");
      source = { sourceUrl: urlText.trim() };
    } else {
      const c = opt.cams[camIdx];
      if (!c) throw new Error("Chọn camera Imou");
      source = { imouDeviceId: c.deviceId, venueId: c.venueId };
    }

    let destinations = [];
    if (destType === "fb") {
      const fbPage = opt.fbPages.find((p) => p.pageId === fbPageId);
      if (!fbPage) throw new Error("Chọn Facebook Page");
      const dest = {
        type: "fb",
        pageId: fbPage.pageId,
        pageName: fbPage.pageName,
        label: fbPage.pageName,
      };
      const cp = crosspost.filter((id) => id && id !== fbPage.pageId);
      if (cp.length) {
        dest.crosspostPageIds = cp;
        dest.crosspostNames = cp.map(
          (id) => opt.fbPages.find((x) => x.pageId === id)?.pageName || id,
        );
      }
      destinations = [dest];
    } else {
      destinations = [{ type: "youtube", label: "YouTube (tự tạo qua API)" }];
    }

    const payload = {
      tournamentId: tour._id,
      tournamentName: tour.name,
      courtStationId: court._id,
      courtName: court.name,
      source,
      destinations,
      perMatchLive: perMatch,
      recordClips,
      splitPerTournament: split,
      title: title.trim(),
      encoder,
      advanced: { resolutionH: 1080, fps: 0, videoBitrateKbps: 4500 },
    };
    if (hideTs) payload.hideTimestamp = true;
    return payload;
  };

  const doStart = async () => {
    setBusy(true);
    try {
      await call("/api/start", "POST", buildPayload());
      setToast("Đã bắt đầu live.");
      setTimeout(() => navigate(-1), 600);
    } catch (e) {
      setToast(e?.data?.message || e?.message || "Lỗi, thử lại");
    } finally {
      setBusy(false);
    }
  };

  const doSchedule = async () => {
    try {
      if (!schedAt) throw new Error("Chọn ngày giờ hẹn");
      const when = new Date(schedAt);
      if (when.getTime() < Date.now() + 30000)
        throw new Error("Thời điểm hẹn phải ở tương lai");
      setBusy(true);
      await call("/api/schedule", "POST", {
        ...buildPayload(),
        startAt: when.getTime(),
      });
      setToast("Đã hẹn giờ live lúc " + when.toLocaleString("vi-VN"));
      setTimeout(() => navigate(-1), 600);
    } catch (e) {
      setToast(e?.data?.message || e?.message || "Lỗi, thử lại");
    } finally {
      setBusy(false);
    }
  };

  const fieldSx = { mt: 0.5 };

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <SEOHead title="Thêm sân live" noIndex />

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(-1)}
          sx={{ textTransform: "none" }}
        >
          Quay lại
        </Button>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Thêm sân live
        </Typography>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Stack spacing={2.5}>
          {/* Giải đấu */}
          <Box>
            <Typography variant="body2" color="text.secondary">
              Giải đấu
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="Tìm tên giải…"
              value={tourQuery}
              onChange={(e) => {
                setTourQuery(e.target.value);
                searchTours(e.target.value);
              }}
              sx={fieldSx}
            />
            <TextField
              select
              fullWidth
              size="small"
              label="Chọn giải"
              value={tourId}
              onChange={(e) => pickTournament(e.target.value)}
              sx={{ mt: 1 }}
            >
              {opt.tournaments.length === 0 && (
                <MenuItem disabled value="">
                  (trống)
                </MenuItem>
              )}
              {opt.tournaments.map((t) => (
                <MenuItem key={t._id} value={t._id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Sân */}
          {!!tourId && (
            <TextField
              select
              fullWidth
              size="small"
              label="Sân"
              value={courtId}
              onChange={(e) => setCourtId(e.target.value)}
            >
              {courts.length === 0 && (
                <MenuItem disabled value="">
                  (trống)
                </MenuItem>
              )}
              {courts.map((c) => (
                <MenuItem key={c._id} value={c._id}>
                  {c.name}
                  {c.hasMatch ? " · (đang có trận)" : ""}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* Nguồn */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Nguồn
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={srcType}
              onChange={(_e, v) => v && setSrcType(v)}
              fullWidth
            >
              <ToggleButton value="rtsp">RTSP lưu</ToggleButton>
              <ToggleButton value="url">Link</ToggleButton>
              <ToggleButton value="imou">Imou</ToggleButton>
            </ToggleButtonGroup>
            {srcType === "rtsp" && (
              <TextField
                select
                fullWidth
                size="small"
                label="Nguồn RTSP"
                value={rtspIdx}
                onChange={(e) => setRtspIdx(e.target.value)}
                sx={{ mt: 1 }}
              >
                {opt.rtspSources.map((s, i) => (
                  <MenuItem key={i} value={i}>
                    {s.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {srcType === "url" && (
              <TextField
                fullWidth
                size="small"
                placeholder="rtsp:// hoặc m3u8…"
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                sx={{ mt: 1 }}
              />
            )}
            {srcType === "imou" && (
              <TextField
                select
                fullWidth
                size="small"
                label="Camera Imou"
                value={camIdx}
                onChange={(e) => setCamIdx(e.target.value)}
                sx={{ mt: 1 }}
              >
                {opt.cams.map((c, i) => (
                  <MenuItem key={i} value={i}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>

          {/* Điểm đến */}
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Điểm đến
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={destType}
              onChange={(_e, v) => v && setDestType(v)}
              fullWidth
            >
              <ToggleButton value="fb">Facebook</ToggleButton>
              <ToggleButton value="youtube">YouTube</ToggleButton>
            </ToggleButtonGroup>
            {destType === "fb" && (
              <>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Facebook Page"
                  value={fbPageId}
                  onChange={(e) => setFbPageId(e.target.value)}
                  sx={{ mt: 1 }}
                >
                  {opt.fbPages.map((p) => (
                    <MenuItem key={p.pageId} value={p.pageId}>
                      {p.pageName}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Crosspost (tuỳ chọn, chọn nhiều)"
                  value={crosspost}
                  onChange={(e) =>
                    setCrosspost(
                      typeof e.target.value === "string"
                        ? e.target.value.split(",")
                        : e.target.value,
                    )
                  }
                  SelectProps={{
                    multiple: true,
                    renderValue: (sel) =>
                      sel.length ? `Crosspost: ${sel.length} page` : "",
                  }}
                  sx={{ mt: 1 }}
                >
                  {opt.fbPages
                    .filter((p) => p.pageId !== fbPageId)
                    .map((p) => (
                      <MenuItem key={p.pageId} value={p.pageId}>
                        <Checkbox checked={crosspost.indexOf(p.pageId) > -1} />
                        {p.pageName}
                      </MenuItem>
                    ))}
                </TextField>
              </>
            )}
          </Box>

          {/* Tiêu đề */}
          <TextField
            fullWidth
            size="small"
            label="Tiêu đề (để trống = Tên giải - Tên sân)"
            placeholder="Tiêu đề live…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* Encoder */}
          {opt.encoders?.length ? (
            <TextField
              select
              fullWidth
              size="small"
              label="Encoder"
              value={encoder}
              onChange={(e) => setEncoder(e.target.value)}
            >
              <MenuItem value="auto">Tự động (GPU)</MenuItem>
              {opt.encoders.map((e) => (
                <MenuItem key={e.value} value={e.value}>
                  {e.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}

          {/* Toggles */}
          <Card variant="outlined" sx={{ p: 1.5 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={perMatch}
                  onChange={(e) => setPerMatch(e.target.checked)}
                />
              }
              label="Live riêng từng trận"
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={split}
                  onChange={(e) => setSplit(e.target.checked)}
                />
              }
              label="Tách live theo giải (đổi giải → live mới)"
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={recordClips}
                  onChange={(e) => setRecordClips(e.target.checked)}
                />
              }
              label="Ghi + cắt clip lên Drive"
            />
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={hideTs}
                  onChange={(e) => setHideTs(e.target.checked)}
                />
              }
              label="Ẩn ngày giờ camera (làm mờ)"
            />
          </Card>

          {/* Hẹn giờ */}
          <TextField
            fullWidth
            size="small"
            type="datetime-local"
            label="Hẹn giờ (để trống = live ngay)"
            value={schedAt}
            onChange={(e) => setSchedAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: toLocalInput(new Date()) }}
          />

          <Button
            fullWidth
            variant="contained"
            disabled={busy}
            startIcon={<FiberManualRecordIcon />}
            onClick={doStart}
            sx={{ py: 1.4, fontWeight: 800 }}
          >
            Bắt đầu live ngay
          </Button>
          {!!schedAt && (
            <Button
              fullWidth
              variant="outlined"
              disabled={busy}
              startIcon={<AccessTimeIcon />}
              onClick={doSchedule}
              sx={{ py: 1.4, fontWeight: 800 }}
            >
              Hẹn giờ live
            </Button>
          )}
          <Typography variant="caption" color="text.secondary">
            Vị trí overlay dùng mặc định — chỉnh được ngay khi đang live ở màn
            Điều khiển Live.
          </Typography>
        </Stack>
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
        autoHideDuration={3500}
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
