// components/mlp/SubMatchAssignmentPanel.jsx
// Panel cấu hình per-sub-match: sân + giờ. Override dual-level.
// Trọng tài KHÔNG gán ở đây — tự lấy theo courtStation.defaultReferees.
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Save, Clock } from "lucide-react";
import { toast } from "react-toastify";

import {
  usePatchMlpSubMatchMutation,
  useListMlpTournamentCourtsQuery,
} from "../../slices/mlpApiSlice";

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

export default function SubMatchAssignmentPanel({
  dual,
  sub,
  disabled,
  onSaved,
}) {
  const [patch, { isLoading: saving }] = usePatchMlpSubMatchMutation();
  const { data: courtsRes } = useListMlpTournamentCourtsQuery(
    dual?.tournament,
    { skip: !dual?.tournament },
  );
  const courtOptions = courtsRes?.items || [];

  const [scheduledAt, setScheduledAt] = useState(
    toDatetimeLocalValue(sub?.scheduledAt),
  );
  const initialCourtValue = sub?.courtStation
    ? `station:${sub.courtStation._id || sub.courtStation}`
    : sub?.court
      ? `court:${sub.court._id || sub.court}`
      : "";
  const [courtValue, setCourtValue] = useState(initialCourtValue);

  useEffect(() => {
    setScheduledAt(toDatetimeLocalValue(sub?.scheduledAt));
    setCourtValue(
      sub?.courtStation
        ? `station:${sub.courtStation._id || sub.courtStation}`
        : sub?.court
          ? `court:${sub.court._id || sub.court}`
          : "",
    );
  }, [sub?._id]);

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
      // KHÔNG gửi referees — backend auto lấy từ station.defaultReferees.
      await patch({
        dualId: dual._id,
        subId: sub._id,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        ...courtPayload,
      }).unwrap();
      toast.success(`Đã lưu cấu hình sub ${sub.slotKey}`);
      onSaved?.();
    } catch (err) {
      toast.error(err?.data?.message || "Không lưu được");
    }
  };

  return (
    <Box
      sx={{
        mt: 1,
        p: 1.25,
        borderRadius: 1,
        bgcolor: "rgba(0,0,0,0.02)",
        border: "1px dashed",
        borderColor: "divider",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary">
          Sân riêng cho sub-match này (để trống → dùng sân của dual). Trọng tài
          theo sân.
        </Typography>
        <Box flex={1} />
        <Button
          size="small"
          variant="contained"
          startIcon={<Save size={14} />}
          onClick={handleSave}
          disabled={disabled || saving}
        >
          {saving ? "Đang lưu…" : "Lưu"}
        </Button>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          select
          label="Sân riêng"
          value={courtValue}
          onChange={(e) => setCourtValue(e.target.value)}
          disabled={disabled}
          size="small"
          sx={{ minWidth: 200, flex: 1 }}
        >
          <MenuItem value="">— Dùng sân của dual —</MenuItem>
          {courtOptions.map((c) => (
            <MenuItem
              key={`${c.type}:${c._id}`}
              value={`${c.type}:${c._id}`}
            >
              {c.name} {c.cluster ? `(${c.cluster})` : ""} ·{" "}
              {c.type === "station" ? "Station" : "Court"}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Giờ riêng"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          disabled={disabled}
          size="small"
          sx={{ minWidth: 220 }}
          InputProps={{
            startAdornment: (
              <Clock size={14} style={{ marginRight: 6, opacity: 0.6 }} />
            ),
          }}
        />
      </Stack>
    </Box>
  );
}
