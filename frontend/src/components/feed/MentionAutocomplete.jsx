// TextField với @ mention autocomplete popup.
// Detect @word tại caret, debounce 250ms, gọi searchUser, hiện dropdown.
import React, { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice.js";
import ScoreBadges from "./ScoreBadges.jsx";

export default function MentionAutocomplete({
  value,
  onChange,
  onPickMention,
  onKeyDown,
  placeholder,
  multiline = true,
  minRows = 2,
  maxRows = 8,
  size = "small",
  ...rest
}) {
  const [query, setQuery] = useState(null);
  const [range, setRange] = useState(null);
  const [results, setResults] = useState([]);
  const [triggerSearch] = useLazySearchUserQuery();
  const debRef = useRef();
  const inputRef = useRef();

  const handleChange = (e) => {
    const text = e.target.value;
    onChange(text);
    // Detect @<word> at caret (approx = end)
    const caret = e.target.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const m = before.match(
      /(^|\s)@([\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+){0,2})$/u
    );
    if (m) {
      const q = m[2];
      setQuery(q);
      setRange({ start: before.length - q.length - 1, end: caret });
    } else {
      setQuery(null);
      setRange(null);
      setResults([]);
    }
  };

  useEffect(() => {
    if (query == null) return;
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      if (!query) {
        setResults([]);
        return;
      }
      try {
        const r = await triggerSearch(query).unwrap();
        const list = Array.isArray(r) ? r : r?.items || r?.data || [];
        setResults(list.slice(0, 6));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [query, triggerSearch]);

  const pick = (u) => {
    if (!range || !u?._id) return;
    const nick = u?.nickname || u?.name || "";
    if (!nick) return;
    const before = value.slice(0, range.start);
    const after = value.slice(range.end);
    onChange(`${before}@${nick} ${after}`);
    onPickMention?.(u);
    setQuery(null);
    setRange(null);
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <Box sx={{ position: "relative", width: "100%" }}>
      <TextField
        inputRef={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        multiline={multiline}
        minRows={multiline ? minRows : undefined}
        maxRows={multiline ? maxRows : undefined}
        size={size}
        fullWidth
        variant="outlined"
        {...rest}
      />
      {query != null && results.length > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            mt: 0.5,
            maxHeight: 260,
            overflowY: "auto",
            borderRadius: 2,
          }}
        >
          {results.map((u) => (
            <Box
              key={u._id}
              onClick={() => pick(u)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.2,
                p: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Avatar src={u.avatar || ""} sx={{ width: 32, height: 32 }}>
                {(u.nickname || u.name || "?")[0]?.toUpperCase()}
              </Avatar>
              <Stack flex={1} minWidth={0}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                >
                  <Typography variant="body2" fontWeight={700} noWrap>
                    @{u.nickname || u.name}
                  </Typography>
                  <ScoreBadges single={u?.score?.single} double={u?.score?.double} />
                </Stack>
                {u.name && u.name !== u.nickname && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {u.name}
                  </Typography>
                )}
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
}
