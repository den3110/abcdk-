// components/mlp/SubMatchAssignmentPanel.jsx
// Panel cấu hình per-sub-match: trọng tài + sân + giờ. Override dual-level.
import React, { useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
  MenuItem,
} from "@mui/material";
import { Save, User as UserIcon, Clock } from "lucide-react";
import { toast } from "react-toastify";

import {
  usePatchMlpSubMatchMutation,
  useListMlpTournamentCourtsQuery,
} from "../../slices/mlpApiSlice";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice";

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
  tour,
  disabled,
  onSaved,
}) {
  const [patch, { isLoading: saving }] = usePatchMlpSubMatchMutation();
  const { data: courtsRes } = useListMlpTournamentCourtsQuery(dual?.tournament, {
    skip: !dual?.tournament,
  });
  const courtOptions = courtsRes?.items || [];

  const [refs, setRefs] = useState(sub?.referees || []);
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
    setRefs(sub?.referees || []);
    setScheduledAt(toDatetimeLocalValue(sub?.scheduledAt));
    setCourtValue(
      sub?.courtStation
        ? `station:${sub.courtStation._id || sub.courtStation}`
        : sub?.court
          ? `court:${sub.court._id || sub.court}`
          : "",
    );
  }, [sub?._id]);

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
        subId: sub._id,
        referees: (refs || []).map((r) => r._id || r).filter(Boolean),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        ...courtPayload,
      }).unwrap();
      toast.success(`Đã lưu cấu hình sub ${sub.slotKey}`);
      onSaved?.();
    } catch (err) {
      toast.error(err?.data?.message || "Không lưu được");
    }
  };

  // Effective values (fall back to dual)
  const effRefereeCount = (refs?.length || 0) || (dual?.referees?.length || 0);
  const effCourt = courtValue || (dual?.court || dual?.courtStation ? "(dùng cấu hình dual)" : "");

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
          Cấu hình riêng cho sub-match này (nếu để trống → dùng của dual)
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
      <Stack spacing={1.25}>
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
                sx={{ width: 24, height: 24, mr: 1, fontSize: 12 }}
              >
                {(u.nickname || u.name || "?")[0]?.toUpperCase()}
              </Avatar>
              <Typography variant="body2">{u.nickname || u.name}</Typography>
            </Box>
          )}
          renderTags={(value, getTagProps) =>
            value.map((u, index) => (
              <Chip
                {...getTagProps({ index })}
                key={u._id}
                size="small"
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
              label={`Trọng tài (dual: ${dual?.referees?.length || 0})`}
              placeholder="Ghi đè trọng tài dual…"
              size="small"
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <>
                    <UserIcon
                      size={14}
                      style={{ marginLeft: 4, marginRight: 4, opacity: 0.6 }}
                    />
                    {params.InputProps.startAdornment}
                  </>
                ),
              }}
            />
          )}
        />
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
                <Clock
                  size={14}
                  style={{ marginRight: 6, opacity: 0.6 }}
                />
              ),
            }}
          />
        </Stack>
      </Stack>
    </Box>
  );
}
