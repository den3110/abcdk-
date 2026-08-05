// Dialog chọn giải đấu — search + list, pick giải trả cho parent
import React, { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  CircularProgress,
  Dialog,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { X, Search, Trophy } from "lucide-react";
import { useLazySearchTournamentsQuery } from "../../slices/tournamentsApiSlice.js";

export default function TournamentPickerDialog({ open, onClose, onPick }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [trigger] = useLazySearchTournamentsQuery();
  const debRef = useRef();

  useEffect(() => {
    if (!open) return;
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await trigger({ q, limit: 20 }).unwrap();
        const list = Array.isArray(r) ? r : r?.items || r?.data || [];
        setItems(list);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => debRef.current && clearTimeout(debRef.current);
  }, [q, open, trigger]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", pb: 1 }}>
        <Box flex={1}>Gắn giải đấu</Box>
        <IconButton onClick={onClose} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Tìm giải theo tên…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            ),
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 400, overflowY: "auto", pb: 2 }}>
        {loading ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <CircularProgress size={24} />
          </Box>
        ) : items.length === 0 ? (
          <Typography sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
            {q ? "Không tìm thấy giải" : "Gõ tên để tìm giải đấu…"}
          </Typography>
        ) : (
          <List disablePadding>
            {items.map((t) => (
              <ListItemButton key={t._id} onClick={() => onPick(t)}>
                <ListItemAvatar>
                  {t.image ? (
                    <Avatar src={t.image} variant="rounded" />
                  ) : (
                    <Avatar variant="rounded" sx={{ bgcolor: "#FFF7ED" }}>
                      <Trophy size={20} color="#F59E0B" />
                    </Avatar>
                  )}
                </ListItemAvatar>
                <ListItemText
                  primary={t.name}
                  secondary={[t.location, t.status].filter(Boolean).join(" · ") || null}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Dialog>
  );
}
