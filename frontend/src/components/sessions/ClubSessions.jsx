/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Collapse,
  Chip,
  Avatar,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import CheckIcon from "@mui/icons-material/Check";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import {
  useListSessionsQuery,
  useCreateSessionMutation,
  useUpdateSessionMutation,
  useDeleteSessionMutation,
  useCheckinSessionMutation,
  useListSessionAttendanceQuery,
  useSessionStatsQuery,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");
const fmt = (s) => dayjs(s).format("HH:mm, DD/MM/YYYY");
const toLocalInput = (d) => dayjs(d).format("YYYY-MM-DDTHH:mm");

function Attendees({ clubId, session }) {
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useListSessionAttendanceQuery(
    { id: clubId, sessionId: session._id },
    { skip: !open },
  );
  const people = data?.items || [];
  const count = Number(session.attendeeCount || 0);
  if (!count) return null;
  return (
    <>
      <Button size="small" sx={{ mt: 1, textTransform: "none" }} onClick={() => setOpen((v) => !v)}>
        {open ? "Ẩn" : "Xem"} người tham gia ({count})
      </Button>
      <Collapse in={open}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {isFetching ? (
            <Typography variant="caption" color="text.secondary">Đang tải…</Typography>
          ) : (
            people.map((u) => (
              <Chip key={u._id} size="small" avatar={<Avatar src={u.avatar} />} label={u.nickname || u.fullName || "Người dùng"} />
            ))
          )}
        </Stack>
      </Collapse>
    </>
  );
}

const emptyForm = { title: "Buổi tập", startAt: toLocalInput(new Date()), location: "", note: "", repeatWeeks: "1" };

export default function ClubSessions({ club, canManage }) {
  const id = club?._id;
  const [view, setView] = useState("list");
  const { data, isLoading } = useListSessionsQuery({ id }, { skip: !id });
  const { data: stats } = useSessionStatsQuery({ id }, { skip: !id || view !== "stats" });
  const [createSession, { isLoading: creating }] = useCreateSessionMutation();
  const [updateSession, { isLoading: updating }] = useUpdateSessionMutation();
  const [deleteSession] = useDeleteSessionMutation();
  const [checkin] = useCheckinSessionMutation();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const items = data?.items || [];

  const resetForm = () => { setForm(emptyForm); setEditId(null); setShowForm(false); };
  const startEdit = (s) => {
    setEditId(s._id);
    setForm({ title: s.title || "Buổi tập", startAt: toLocalInput(s.startAt), location: s.location || "", note: s.note || "", repeatWeeks: "1" });
    setShowForm(true);
  };
  const submit = async () => {
    if (!form.startAt) return toast.info("Chọn thời gian.");
    const body = {
      title: form.title.trim() || "Buổi tập",
      startAt: new Date(form.startAt).toISOString(),
      location: form.location.trim(),
      note: form.note.trim(),
    };
    try {
      if (editId) {
        await updateSession({ id, sessionId: editId, ...body }).unwrap();
        toast.success("Đã cập nhật");
      } else {
        const n = Math.max(1, parseInt(form.repeatWeeks, 10) || 1);
        await createSession({ id, ...body, repeatWeeks: n }).unwrap();
        toast.success(n > 1 ? `Đã tạo ${n} buổi` : "Đã tạo buổi tập");
      }
      resetForm();
    } catch (e) { toast.error(getApiErrMsg(e)); }
  };
  const remove = async (s) => {
    if (!window.confirm("Xoá buổi tập này?")) return;
    try { await deleteSession({ id, sessionId: s._id }).unwrap(); } catch (e) { toast.error(getApiErrMsg(e)); }
  };
  const doCheckin = async (s) => {
    try { await checkin({ id, sessionId: s._id }).unwrap(); } catch (e) {
      if (e?.status === 401) toast.warn("Bạn cần đăng nhập.");
      else toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup fullWidth size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
        <ToggleButton value="list">Buổi tập</ToggleButton>
        <ToggleButton value="stats">Chuyên cần</ToggleButton>
      </ToggleButtonGroup>

      {view === "stats" ? (
        <>
          <Typography variant="caption" color="text.secondary">Tổng số buổi: {stats?.totalSessions || 0}</Typography>
          {(stats?.items || []).length === 0 ? (
            <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
              <EventAvailableIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>Chưa có dữ liệu chuyên cần.</Typography>
            </Box>
          ) : (
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              {(stats.items).map((it, i) => (
                <Box key={it.user._id}>
                  {i > 0 && <Divider />}
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                    <Typography sx={{ width: 22, textAlign: "center", fontWeight: 800, color: i < 3 ? "warning.main" : "text.secondary" }}>{i + 1}</Typography>
                    <Avatar src={it.user.avatar} sx={{ width: 32, height: 32 }} />
                    <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }} noWrap>{it.user.nickname || it.user.fullName || "Người dùng"}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{it.count} buổi</Typography>
                  </Stack>
                </Box>
              ))}
            </Card>
          )}
        </>
      ) : (
        <>
          {canManage && !showForm && (
            <Box>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>
                Tạo buổi tập
              </Button>
            </Box>
          )}
          {canManage && showForm && (
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack spacing={1.5}>
                  <TextField label="Tên buổi" value={form.title} onChange={(e) => setF("title", e.target.value)} fullWidth />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <TextField label="Thời gian" type="datetime-local" value={form.startAt} onChange={(e) => setF("startAt", e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
                    <TextField label="Địa điểm" value={form.location} onChange={(e) => setF("location", e.target.value)} fullWidth />
                  </Stack>
                  {!editId && (
                    <TextField label="Lặp lại hàng tuần (số tuần)" type="number" value={form.repeatWeeks} onChange={(e) => setF("repeatWeeks", e.target.value)} inputProps={{ min: 1, max: 52 }} />
                  )}
                  <TextField label="Ghi chú" value={form.note} onChange={(e) => setF("note", e.target.value)} fullWidth multiline minRows={2} />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={submit} disabled={creating || updating}>{editId ? "Lưu" : "Tạo"}</Button>
                    <Button onClick={resetForm}>Huỷ</Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <Typography color="text.secondary">Đang tải…</Typography>
          ) : items.length === 0 ? (
            <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
              <EventAvailableIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>Chưa có buổi tập nào.</Typography>
            </Box>
          ) : (
            items.map((s) => {
              const past = new Date(s.startAt) < new Date(Date.now() - 6 * 3600 * 1000);
              return (
                <Card key={s._id} variant="outlined" sx={{ borderRadius: 3, opacity: past ? 0.8 : 1 }}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800 }}>{s.title}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {fmt(s.startAt)}{s.location ? ` · ${s.location}` : ""}
                        </Typography>
                        {s.note && <Typography variant="body2" sx={{ mt: 0.5 }}>{s.note}</Typography>}
                      </Box>
                      {canManage && (
                        <Stack direction="row">
                          <IconButton size="small" onClick={() => startEdit(s)}><EditOutlined fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => remove(s)}><DeleteOutline fontSize="small" /></IconButton>
                        </Stack>
                      )}
                    </Stack>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                      <Button
                        size="small"
                        variant={s.myCheckedIn ? "contained" : "outlined"}
                        color="success"
                        startIcon={<CheckIcon />}
                        onClick={() => doCheckin(s)}
                      >
                        {s.myCheckedIn ? "Đã điểm danh" : "Điểm danh"}
                      </Button>
                      <Typography variant="caption" color="text.secondary">{s.attendeeCount || 0} người tham gia</Typography>
                    </Stack>
                    <Attendees clubId={id} session={s} />
                  </CardContent>
                </Card>
              );
            })
          )}
        </>
      )}
    </Stack>
  );
}
