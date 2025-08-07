import { useState, useEffect } from "react";
import {
  Autocomplete,
  Avatar,
  Chip,
  CircularProgress,
  Stack,
  TextField,
} from "@mui/material";
import { useLazySearchUserQuery } from "../slices/usersApiSlice";

export default function PlayerSelector({ label, eventType, onChange }) {
  const [input, setInput] = useState("");
  const [value, setValue] = useState(null);
  const [trigger, { data = [], isFetching }] = useLazySearchUserQuery();

  /* debounce search */
  useEffect(() => {
    if (!input) return;
    const id = setTimeout(() => trigger(input), 400);
    return () => clearTimeout(id);
  }, [input]);

  /* push lên parent */
  useEffect(() => onChange(value), [value]);

  return (
    <>
      <Autocomplete
        options={data}
        getOptionLabel={(o) => o.phone || o.nickname}
        loading={isFetching}
        onInputChange={(_, v) => setInput(v)}
        onChange={(_, v) => setValue(v)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={`${label} (SĐT / Nick)`}
            fullWidth
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {isFetching && <CircularProgress size={18} />}
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
          <span>{value.name}</span>
          <Chip
            size="small"
            label={`Điểm ${eventType === "double" ? "đôi" : "đơn"}: ${
              eventType === "double" ? value.score.double : value.score.single
            }`}
          />
        </Stack>
      )}
    </>
  );
}
