import { useState, useEffect, useMemo } from "react";
import {
  Autocomplete,
  Avatar,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useLazySearchUserQuery } from "../slices/usersApiSlice";

function maskPhone(p) {
  if (!p) return "";
  const s = String(p).replace(/\D/g, "");
  if (s.length <= 6) return s;
  return `${s.slice(0, 3)}****${s.slice(-3)}`;
}

export default function PlayerSelector({ label, eventType, onChange }) {
  const [input, setInput] = useState("");
  const [value, setValue] = useState(null);
  const [trigger, { data = [], isFetching }] = useLazySearchUserQuery();

  // debounce input
  useEffect(() => {
    if (!input || !input.trim()) return;
    const id = setTimeout(() => {
      // ⚠️ Nếu API của bạn nhận query object (q, eventType)
      // đổi thành: trigger({ q: input.trim(), eventType })
      trigger(input.trim());
    }, 350);
    return () => clearTimeout(id);
  }, [input, trigger, eventType]);

  // báo lên parent
  useEffect(() => {
    onChange?.(value || null);
  }, [value, onChange]);

  const options = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const getLabel = (o) =>
    (o?.name && String(o.name)) ||
    (o?.fullName && String(o.fullName)) ||
    (o?.nickname && String(o.nickname)) ||
    (o?.phone && String(o.phone)) ||
    "";

  const scoreKey = eventType === "double" ? "double" : "single";
  const scoreOf = (u) => u?.score?.[scoreKey] ?? 0;

  return (
    <>
      <Autocomplete
        options={options}
        // ❗ Không lọc lại client, để giữ nguyên kết quả từ API (nickname/phone đều hiện)
        filterOptions={(x) => x}
        getOptionLabel={getLabel}
        isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
        loading={isFetching}
        onInputChange={(_, v) => setInput(v)}
        value={value}
        onChange={(_, v) => setValue(v)}
        renderOption={(props, option) => (
          <li {...props} key={option._id}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar src={option.avatar} sx={{ width: 28, height: 28 }} />
              <div>
                <Typography variant="body2">
                  {option.name || option.fullName || option.nickname || "—"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {option.nickname ? `@${option.nickname}` : ""}
                  {option.phone ? ` • ${maskPhone(option.phone)}` : ""}
                </Typography>
              </div>
            </Stack>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label={`${label} (Tên / Nick / SĐT)`}
            fullWidth
            placeholder="gõ để tìm…"
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {isFetching ? <CircularProgress size={18} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      {value && (
        <Stack direction="row" spacing={1} mt={1} alignItems="center">
          <Avatar src={value.avatar} />
          <span>{value.name || value.fullName || value.nickname}</span>
          <Chip
            size="small"
            label={`Điểm ${eventType === "double" ? "đôi" : "đơn"}: ${scoreOf(
              value
            )}`}
          />
        </Stack>
      )}
    </>
  );
}
