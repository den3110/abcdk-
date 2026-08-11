// components/mlp/DualAssignmentPanel.jsx — Panel gán sân + giờ + ghi chú
// cho 1 MlpDualMatch. Trọng tài KHÔNG gán ở đây — tự lấy theo
// courtStation.defaultReferees (logic "trọng tài đứng theo sân").
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Save, Clock, MapPin } from "lucide-react";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";

import {
  usePatchMlpDualMutation,
  useListMlpTournamentCourtsQuery,
  useCheckInMlpDualMutation,
} from "../../slices/mlpApiSlice";
import MenuItem from "@mui/material/MenuItem";

const isAdmin = (u) => u?.role === "admin" || u?.isAdmin || u?.isSuperUser;
const isManagerOfTour = (u, tour) => {
  if (!u?._id || !tour) return false;
  if (String(tour.createdBy) === String(u._id)) return true;
  if (Array.isArray(tour.managers)) {
    return tour.managers.some(
      (m) => String(m?.user?._id ?? m?.user ?? m) === String(u._id),
    );
  }
  return false;
};

function toDatetimeLocalValue(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  );
}

export default function DualAssignmentPanel({ dual, tour, onSaved }) {
  const me = useSelector((s) => s.auth?.userInfo);
  const canManage = isAdmin(me) || isManagerOfTour(me, tour);

  const [patch, { isLoading: saving }] = usePatchMlpDualMutation();
  const [checkIn] = useCheckInMlpDualMutation();
  const { data: courtsRes } = useListMlpTournamentCourtsQuery(
    dual?.tournament,
    { skip: !dual?.tournament }
  );
  const courtOptions = courtsRes?.items || [];

  const [scheduledAt, setScheduledAt] = useState(
    toDatetimeLocalValue(dual?.scheduledAt),
  );
  const [note, setNote] = useState(dual?.note || "");
  const initialCourtValue = dual?.courtStation
    ? `station:${dual.courtStation._id || dual.courtStation}`
    : dual?.court
      ? `court:${dual.court._id || dual.court}`
      : "";
  const [courtValue, setCourtValue] = useState(initialCourtValue);

  useEffect(() => {
    setScheduledAt(toDatetimeLocalValue(dual?.scheduledAt));
    setNote(dual?.note || "");
    setCourtValue(
      dual?.courtStation
        ? `station:${dual.courtStation._id || dual.courtStation}`
        : dual?.court
          ? `court:${dual.court._id || dual.court}`
          : "",
    );
  }, [dual?._id]);

  const handleSave = async () => {
    try {
      const courtPayload = {};
      if (courtValue.startsWith("court:")) {
        courtPayload.court = courtValue.slice(6);
        courtPayload.courtStation = null;
      } else if (courtValue.startsWith("station:")) {
        courtPayload.courtStation = courtValue.slice(8);
        courtPayload.court = null;
      } else {
        courtPayload.court = null;
        courtPayload.courtStation = null;
      }
      // KHÔNG gửi referees — backend auto-fill từ station.defaultReferees.
      await patch({
        dualId: dual._id,
        tourId: dual.tournament,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        note,
        ...courtPayload,
      }).unwrap();
      toast.success("Đã lưu");
      onSaved?.();
    } catch (err) {
      toast.error(err?.data?.message || "Không lưu được");
    }
  };

  const handleCheckIn = async (side) => {
    try {
      await checkIn({ dualId: dual._id, side }).unwrap();
      toast.success(`Team ${side} đã check-in`);
      onSaved?.();
    } catch (err) {
      toast.error(err?.data?.message || "Không check-in được");
    }
  };

  const disabled = !canManage || dual?.status === "finished";

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <MapPin size={18} />
        <Typography variant="subtitle1" fontWeight={700}>
          Sân · Giờ thi đấu · Ghi chú
        </Typography>
        <Box flex={1} />
        <Button
          size="small"
          variant="contained"
          startIcon={<Save size={16} />}
          onClick={handleSave}
          disabled={disabled || saving}
        >
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2 }}>
        Trọng tài <b>đứng theo sân</b> — chọn sân xong, trọng tài sẽ tự lấy từ
        cấu hình Cụm sân. Không cần gán từng dual.
      </Alert>

      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="stretch"
        >
          <TextField
            select
            label="Sân"
            value={courtValue}
            onChange={(e) => setCourtValue(e.target.value)}
            disabled={disabled}
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">— Chưa gán —</MenuItem>
            {courtOptions.map((c) => (
              <MenuItem
                key={`${c.type}:${c._id}`}
                value={`${c.type}:${c._id}`}
              >
                {c.name} {c.cluster ? `(${c.cluster})` : ""} · {c.type === "station" ? "Station" : "Court"}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Giờ thi đấu"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
            disabled={disabled}
            size="small"
            sx={{ minWidth: 220 }}
            InputProps={{
              startAdornment: (
                <Clock
                  size={16}
                  style={{ marginRight: 6, opacity: 0.6 }}
                />
              ),
            }}
          />
          <TextField
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            multiline
            maxRows={3}
            disabled={disabled}
            size="small"
            fullWidth
            placeholder="Ghi chú thêm cho dual…"
          />
        </Stack>

        {dual?.status !== "finished" && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant={dual?.checkInA?.checkedAt ? "contained" : "outlined"}
              color={dual?.checkInA?.checkedAt ? "success" : "primary"}
              onClick={() => handleCheckIn("A")}
              disabled={saving}
            >
              {dual?.checkInA?.checkedAt ? "✓ Team A check-in" : "Team A check-in"}
            </Button>
            <Button
              size="small"
              variant={dual?.checkInB?.checkedAt ? "contained" : "outlined"}
              color={dual?.checkInB?.checkedAt ? "success" : "primary"}
              onClick={() => handleCheckIn("B")}
              disabled={saving}
            >
              {dual?.checkInB?.checkedAt ? "✓ Team B check-in" : "Team B check-in"}
            </Button>
          </Stack>
        )}

        {dual?.status === "finished" && (
          <Typography variant="caption" color="text.secondary">
            Dual đã kết thúc — không thể chỉnh sửa metadata.
          </Typography>
        )}
        {!canManage && (
          <Typography variant="caption" color="text.secondary">
            Bạn không phải admin / manager giải này — chỉ có thể xem.
          </Typography>
        )}

        {canManage && courtValue.startsWith("station:") && (
          <Box
            sx={{
              mt: 1,
              p: 1.5,
              borderRadius: 2,
              bgcolor: "action.hover",
              border: "1px dashed",
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: "block" }}>
              🎥 Overlay livestream cho sân này
            </Typography>
            {(() => {
              const stationId = courtValue.slice(8);
              const url = `${window.location.origin}/overlay/mlp/court/${stationId}`;
              const openInNew = () => window.open(url, "_blank");
              const copy = async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Đã copy URL overlay");
                } catch {
                  toast.info(url);
                }
              };
              return (
                <>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: "block",
                      wordBreak: "break-all",
                      fontFamily: "monospace",
                      mb: 1,
                    }}
                  >
                    {url}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="outlined" onClick={copy}>
                      Copy URL
                    </Button>
                    <Button size="small" variant="contained" onClick={openInNew}>
                      Mở overlay
                    </Button>
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: "block", mt: 0.75 }}
                  >
                    Dùng URL này làm Browser Source trong OBS. Overlay tự
                    hiện sub-match → DreamBreaker khi dual vào tie-break.
                  </Typography>
                </>
              );
            })()}
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
