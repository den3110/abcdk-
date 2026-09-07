/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Box, Container, Typography, Button, Stack, Chip, Avatar, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, ToggleButtonGroup, ToggleButton, FormControlLabel, Checkbox, Divider, Skeleton, alpha, useTheme,
} from "@mui/material";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import TuneIcon from "@mui/icons-material/Tune";
import {
  useListStaffQuery, useAddStaffMutation, useUpdateStaffMutation, useRemoveStaffMutation, useLazySearchUsersQuery,
} from "../../../slices/venuesApiSlice";

const ROLE_COLOR = { manager: "secondary", cashier: "warning", staff: "info", owner: "success" };

export default function VenueStaffPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data, isLoading } = useListStaffQuery(id, { skip: !id });
  const [removeStaff] = useRemoveStaffMutation();
  const [updateStaff] = useUpdateStaffMutation();
  const [editor, setEditor] = useState(null); // {add:true} | staff

  const perms = data?.permissions || [];
  const roles = data?.roles || [];
  const staff = data?.staff || [];

  const remove = async (s) => {
    if (!window.confirm(`Gỡ ${s.user?.name || "nhân viên"} khỏi cụm sân?`)) return;
    try { await removeStaff({ venueId: id, staffId: s._id }).unwrap(); toast.success("Đã gỡ nhân viên"); }
    catch (e) { toast.error(e?.data?.message || "Thất bại"); }
  };
  const toggleActive = async (s) => {
    try { await updateStaff({ venueId: id, staffId: s._id, active: !s.active }).unwrap(); }
    catch (e) { toast.error(e?.data?.message || "Thất bại"); }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2.5, md: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <IconButton onClick={() => navigate(`/owner/venues/${id}`)}><ArrowBackIosNewIcon fontSize="small" /></IconButton>
        <Typography variant="h5" fontWeight={900} sx={{ flex: 1 }}>Nhân viên & phân quyền</Typography>
        <Button variant="contained" startIcon={<PersonAddAlt1Icon />} onClick={() => setEditor({ add: true })} sx={{ borderRadius: 2.5, fontWeight: 700 }}>Thêm</Button>
      </Stack>

      {data?.owner && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.75, mb: 2, borderRadius: 3, border: `1px solid ${theme.palette.divider}` }}>
          <Avatar src={data.owner.user?.avatar}>{(data.owner.user?.name || "?")[0]}</Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={800} noWrap>{data.owner.user?.name || "Chủ sân"}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>{data.owner.user?.phone || data.owner.user?.email || ""}</Typography>
          </Box>
          <Chip size="small" color="success" label="Chủ sân" sx={{ fontWeight: 700 }} />
        </Box>
      )}

      <Typography variant="subtitle2" color="text.secondary" fontWeight={800} sx={{ mb: 1 }}>NHÂN VIÊN · {staff.length}</Typography>

      {isLoading ? (
        <Stack spacing={1.5}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={92} sx={{ borderRadius: 3 }} />)}</Stack>
      ) : staff.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 6, border: `1px dashed ${theme.palette.divider}`, borderRadius: 3 }}>
          <Typography fontWeight={700}>Chưa có nhân viên</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>Thêm quản lý, thu ngân hoặc nhân viên và phân quyền cho từng người.</Typography>
          <Button variant="contained" startIcon={<PersonAddAlt1Icon />} onClick={() => setEditor({ add: true })} sx={{ borderRadius: 2.5, fontWeight: 700 }}>Thêm nhân viên</Button>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {staff.map((s) => (
            <Box key={s._id} sx={{ p: 1.75, borderRadius: 3, border: `1px solid ${theme.palette.divider}`, opacity: s.active ? 1 : 0.55 }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Avatar src={s.user?.avatar}>{(s.user?.name || "?")[0]}</Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={800} noWrap>{s.user?.name || s.user?.nickname || "Nhân viên"}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>{s.user?.phone || s.user?.email || ""}</Typography>
                </Box>
                <Chip size="small" color={ROLE_COLOR[s.role] || "default"} label={s.roleLabel || s.role} sx={{ fontWeight: 700 }} />
              </Stack>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1.25 }}>
                {s.role === "manager" ? (
                  <Typography variant="body2" color="text.secondary">Toàn quyền như chủ sân</Typography>
                ) : (s.permissions || []).length === 0 ? (
                  <Typography variant="body2" color="error">Chưa có quyền nào</Typography>
                ) : (
                  (s.permissions || []).map((k) => (
                    <Chip key={k} size="small" variant="outlined" label={perms.find((p) => p.key === k)?.label || k} sx={{ height: 22, fontSize: 11 }} />
                  ))
                )}
              </Box>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Button size="small" startIcon={<TuneIcon />} onClick={() => setEditor(s)} sx={{ borderRadius: 2 }}>Phân quyền</Button>
                <Button size="small" color="inherit" onClick={() => toggleActive(s)} sx={{ borderRadius: 2 }}>{s.active ? "Tạm dừng" : "Kích hoạt"}</Button>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" color="error" onClick={() => remove(s)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {editor && (
        <StaffDialog venueId={id} editor={editor} roles={roles} perms={perms} onClose={() => setEditor(null)} />
      )}
    </Container>
  );
}

function StaffDialog({ venueId, editor, roles, perms, onClose }) {
  const isAdd = !!editor?.add;
  const [addStaff, { isLoading: adding }] = useAddStaffMutation();
  const [updateStaff, { isLoading: updating }] = useUpdateStaffMutation();
  const [runSearch, { data: results, isFetching }] = useLazySearchUsersQuery();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(isAdd ? null : editor.user);
  const [role, setRole] = useState(isAdd ? "staff" : editor.role);
  const [selPerms, setSelPerms] = useState(isAdd ? (roles.find((r) => r.key === "staff")?.preset || []) : (editor.permissions || []));

  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) runSearch(q.trim()); }, 350);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  const groups = useMemo(() => {
    const g = {};
    for (const p of perms) (g[p.group] = g[p.group] || []).push(p);
    return g;
  }, [perms]);

  const applyRole = (r) => { if (!r) return; setRole(r); const preset = roles.find((x) => x.key === r)?.preset || []; setSelPerms(r === "manager" ? [] : [...preset]); };
  const toggle = (k) => setSelPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const save = async () => {
    try {
      if (isAdd) {
        if (!picked?._id) return toast.info("Chọn 1 tài khoản PickleTour");
        await addStaff({ venueId, userId: picked._id, role, permissions: selPerms }).unwrap();
      } else {
        await updateStaff({ venueId, staffId: editor._id, role, permissions: selPerms }).unwrap();
      }
      toast.success("Đã lưu");
      onClose();
    } catch (e) { toast.error(e?.data?.message || "Lưu thất bại"); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>{isAdd ? "Thêm nhân viên" : "Phân quyền"}</DialogTitle>
      <DialogContent dividers>
        {isAdd && !picked && (
          <>
            <TextField autoFocus fullWidth size="small" label="Tìm tên hoặc SĐT" value={q} onChange={(e) => setQ(e.target.value)} helperText="Nhập ≥ 2 ký tự để tìm tài khoản PickleTour" />
            <Stack sx={{ mt: 1 }}>
              {(results || []).map((u) => (
                <Box key={u._id} onClick={() => setPicked(u)} sx={{ display: "flex", alignItems: "center", gap: 1.25, p: 1, borderRadius: 2, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
                  <Avatar src={u.avatar} sx={{ width: 34, height: 34 }}>{(u.name || "?")[0]}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>{u.name || u.nickname}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>{u.phone || u.email || ""}</Typography>
                  </Box>
                </Box>
              ))}
              {isFetching && <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>Đang tìm…</Typography>}
            </Stack>
          </>
        )}

        {picked && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, p: 1.25, mb: 2, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }}>
              <Avatar src={picked.avatar}>{(picked.name || "?")[0]}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography fontWeight={800} noWrap>{picked.name || picked.nickname}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>{picked.phone || picked.email || ""}</Typography>
              </Box>
              {isAdd && <Button size="small" onClick={() => setPicked(null)}>Đổi</Button>}
            </Box>

            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>Vai trò</Typography>
            <ToggleButtonGroup exclusive value={role} onChange={(_e, v) => applyRole(v)} size="small" sx={{ mb: 1 }}>
              {roles.map((r) => <ToggleButton key={r.key} value={r.key} sx={{ fontWeight: 700, textTransform: "none", px: 2 }}>{r.label}</ToggleButton>)}
            </ToggleButtonGroup>

            {role === "manager" ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Quản lý có toàn quyền như chủ sân (trừ chuyển nhượng quyền sở hữu).</Typography>
            ) : (
              Object.keys(groups).map((g) => (
                <Box key={g} sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={800}>{g.toUpperCase()}</Typography>
                  <Divider sx={{ mb: 0.5 }} />
                  {groups[g].map((p) => (
                    <FormControlLabel key={p.key} sx={{ display: "flex" }}
                      control={<Checkbox checked={selPerms.includes(p.key)} onChange={() => toggle(p.key)} size="small" />}
                      label={<Typography variant="body2">{p.label}</Typography>} />
                  ))}
                </Box>
              ))
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button color="inherit" onClick={onClose}>Huỷ</Button>
        <Button variant="contained" disabled={adding || updating || (isAdd && !picked)} onClick={save} sx={{ fontWeight: 700, borderRadius: 2.5, px: 3 }}>
          {isAdd ? "Thêm" : "Lưu"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
