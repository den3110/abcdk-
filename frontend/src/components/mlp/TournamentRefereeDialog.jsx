// components/mlp/TournamentRefereeDialog.jsx
// Quản lý pool trọng tài của giải. Admin/manager add user vào pool;
// pool này dùng làm dropdown khi cấu hình CourtStation.defaultReferees
// (thay vì search toàn bộ User → tránh nhầm, gán nhanh).
import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemSecondaryAction,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { UserPlus, Trash2, User as UserIcon } from "lucide-react";
import { toast } from "react-toastify";
import {
  useAddTournamentRefereeMutation,
  useListTournamentRefereesQuery,
  useRemoveTournamentRefereeMutation,
} from "../../slices/tournamentsApiSlice";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice";

export default function TournamentRefereeDialog({ open, onClose, tour }) {
  const tid = tour?._id;
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const { data, isFetching } = useListTournamentRefereesQuery(tid, {
    skip: !tid || !open,
  });
  const items = data?.items || [];
  const [addRef, { isLoading: adding }] = useAddTournamentRefereeMutation();
  const [removeRef] = useRemoveTournamentRefereeMutation();

  const [triggerSearch, { data: searchRes, isFetching: searching }] =
    useLazySearchUserQuery();
  useEffect(() => {
    if (!open || !searchQ || searchQ.length < 1) return;
    const t = setTimeout(() => triggerSearch(searchQ), 300);
    return () => clearTimeout(t);
  }, [open, searchQ, triggerSearch]);
  const searchOptions = useMemo(() => {
    const list = Array.isArray(searchRes)
      ? searchRes
      : searchRes?.items || searchRes?.data || [];
    // Loại các user đã có trong pool
    const existingIds = new Set(items.map((it) => String(it.user?._id)));
    return list.filter((u) => !existingIds.has(String(u._id))).slice(0, 20);
  }, [searchRes, items]);

  const handleAdd = async () => {
    if (!picked?._id) {
      toast.error("Chọn 1 user trước");
      return;
    }
    try {
      await addRef({
        tid,
        userId: picked._id,
        note: note.trim(),
      }).unwrap();
      toast.success(`Đã thêm ${picked.nickname || picked.name} vào pool trọng tài`);
      setPicked(null);
      setNote("");
      setSearchQ("");
    } catch (err) {
      toast.error(err?.data?.message || "Không thêm được");
    }
  };

  const handleRemove = async (refId, name) => {
    if (!window.confirm(`Xoá ${name} khỏi pool trọng tài?`)) return;
    try {
      await removeRef({ tid, refId }).unwrap();
      toast.success("Đã xoá");
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <UserIcon size={20} />
          <span>Quản lý trọng tài · {tour?.name}</span>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
          Pool trọng tài của giải. Khi cấu hình "Quản lý cụm sân", chọn trọng
          tài đứng sân từ danh sách này.
        </Alert>

        {/* Add referee */}
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          <Typography variant="body2" fontWeight={800}>
            Thêm trọng tài mới
          </Typography>
          <Autocomplete
            size="small"
            options={searchOptions}
            value={picked}
            onChange={(_, v) => setPicked(v)}
            onInputChange={(_, v) => setSearchQ(v)}
            getOptionLabel={(u) => u?.nickname || u?.name || ""}
            isOptionEqualToValue={(o, v) => String(o?._id) === String(v?._id)}
            loading={searching}
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
                  {u.phone ? (
                    <Typography variant="caption" color="text.secondary">
                      {u.phone}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Tìm theo tên / nickname / SĐT"
                placeholder="Nhập ít nhất 1 ký tự..."
              />
            )}
          />
          <TextField
            size="small"
            label="Ghi chú (tuỳ chọn)"
            placeholder="VD: Trọng tài chính sân 1"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
          />
          <Button
            variant="contained"
            startIcon={<UserPlus size={16} />}
            onClick={handleAdd}
            disabled={adding || !picked}
          >
            {adding ? "Đang thêm..." : "Thêm vào pool"}
          </Button>
        </Stack>

        {/* List existing */}
        <Typography variant="body2" fontWeight={800} sx={{ mb: 1 }}>
          Danh sách trọng tài ({items.length})
        </Typography>
        {isFetching && !items.length ? (
          <Typography variant="body2" color="text.secondary">
            Đang tải...
          </Typography>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Chưa có trọng tài nào. Thêm ở trên.
          </Typography>
        ) : (
          <List dense sx={{ bgcolor: "background.default", borderRadius: 2 }}>
            {items.map((it) => {
              const u = it.user || {};
              const label = u.nickname || u.name || "?";
              return (
                <ListItem key={it._id}>
                  <ListItemAvatar>
                    <Avatar src={u.avatar}>{label[0]?.toUpperCase()}</Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={700}>
                          {label}
                        </Typography>
                        {u.role === "referee" && (
                          <Chip
                            size="small"
                            label="Referee role"
                            color="info"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    }
                    secondary={
                      <>
                        {u.phone ? (
                          <Typography variant="caption" color="text.secondary">
                            {u.phone}
                          </Typography>
                        ) : null}
                        {it.note ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ ml: u.phone ? 1 : 0 }}
                          >
                            · {it.note}
                          </Typography>
                        ) : null}
                      </>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      color="error"
                      size="small"
                      onClick={() => handleRemove(it._id, label)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}

TournamentRefereeDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tour: PropTypes.object,
};
