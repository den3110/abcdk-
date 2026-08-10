// components/mlp/DualAssignmentPanel.jsx — Panel gán trọng tài + giờ thi đấu
// + ghi chú cho 1 MlpDualMatch. Court integration để phase sau (do court
// model đang song song Court cũ + CourtStation mới — cần rework riêng).
import React, { useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Save, User as UserIcon, Clock, MapPin } from "lucide-react";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";

import {
  usePatchMlpDualMutation,
  useListMlpTournamentCourtsQuery,
  useCheckInMlpDualMutation,
} from "../../slices/mlpApiSlice";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice";
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

  const [refs, setRefs] = useState(dual?.referees || []);
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
    setRefs(dual?.referees || []);
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

  // Search users cho trọng tài
  const [searchQ, setSearchQ] = useState("");
  const [triggerSearch, { data: searchRes, isFetching }] =
    useLazySearchUserQuery();
  useEffect(() => {
    if (!searchQ || searchQ.length < 1) return;
    const t = setTimeout(() => triggerSearch(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ, triggerSearch]);
  const searchOptions = useMemo(() => {
    const list = Array.isArray(searchRes)
      ? searchRes
      : searchRes?.items || searchRes?.data || [];
    return list.slice(0, 20);
  }, [searchRes]);

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
      await patch({
        dualId: dual._id,
        tourId: dual.tournament,
        referees: (refs || []).map((r) => r._id || r).filter(Boolean),
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
          Trọng tài · Giờ thi đấu · Ghi chú
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

      <Stack spacing={2}>
        <Autocomplete
          multiple
          options={searchOptions}
          value={refs}
          onChange={(_, v) => setRefs(v)}
          onInputChange={(_, v) => setSearchQ(v)}
          getOptionLabel={(u) => u?.nickname || u?.name || ""}
          isOptionEqualToValue={(o, v) => String(o?._id) === String(v?._id)}
          loading={isFetching}
          disabled={disabled}
          renderOption={(props, u) => (
            <Box component="li" {...props} key={u._id}>
              <Avatar
                src={u.avatar}
                sx={{ width: 28, height: 28, mr: 1.5, fontSize: 13 }}
              >
                {(u.nickname || u.name || "?")[0]?.toUpperCase()}
              </Avatar>
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {u.nickname || u.name}
                </Typography>
                {u.nickname && u.name && (
                  <Typography variant="caption" color="text.secondary">
                    {u.name}
                  </Typography>
                )}
              </Box>
            </Box>
          )}
          renderTags={(value, getTagProps) =>
            value.map((u, index) => (
              <Chip
                {...getTagProps({ index })}
                key={u._id}
                avatar={
                  <Avatar src={u.avatar}>
                    {(u.nickname || u.name || "?")[0]?.toUpperCase()}
                  </Avatar>
                }
                label={u.nickname || u.name}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Trọng tài"
              placeholder="Tìm theo tên / nickname…"
              size="small"
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <UserIcon
                      size={16}
                      style={{ marginLeft: 4, marginRight: 4, opacity: 0.6 }}
                    />
                    {params.InputProps.startAdornment}
                  </>
                ),
              }}
            />
          )}
        />

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
      </Stack>
    </Paper>
  );
}
