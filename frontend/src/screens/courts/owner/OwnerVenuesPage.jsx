/* eslint-disable react/prop-types */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Grid,
  Chip,
  Skeleton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  useTheme,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import EventNoteOutlinedIcon from "@mui/icons-material/EventNoteOutlined";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { useListMyVenuesQuery, useCreateVenueMutation } from "../../../slices/venuesApiSlice";

const STATUS = {
  active: { label: "Đang mở", color: "success" },
  pending: { label: "Chờ duyệt", color: "warning" },
  suspended: { label: "Tạm khoá", color: "error" },
};

export default function OwnerVenuesPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const canCreate = userInfo?.role === "courtOwner" || userInfo?.role === "admin" || userInfo?.isAdmin || userInfo?.isSuperUser;

  const { data, isLoading } = useListMyVenuesQuery();
  const [createVenue, { isLoading: creating }] = useCreateVenueMutation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", province: "", address: "", phone: "" });
  const venues = data || [];

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Cần nhập tên cụm sân");
    try {
      const v = await createVenue(form).unwrap();
      toast.success("Đã tạo cụm sân");
      setOpen(false);
      setForm({ name: "", province: "", address: "", phone: "" });
      navigate(`/owner/venues/${v._id}`);
    } catch (e) {
      toast.error(e?.data?.message || "Tạo cụm sân thất bại");
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: "-0.02em" }}>Sân của tôi</Typography>
          <Typography variant="body2" color="text.secondary">Quản lý cụm sân, giá, giờ mở và lượt đặt.</Typography>
        </Box>
        {canCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ fontWeight: 700, borderRadius: 2.5 }}>
            Tạo cụm sân
          </Button>
        )}
      </Stack>

      {!canCreate && (
        <Alert severity="info" sx={{ mb: 2, borderRadius: 3 }}>
          Bạn cần quyền <b>chủ sân</b> để tạo & quản lý sân. Vui lòng liên hệ admin để được cấp quyền.
        </Alert>
      )}

      {isLoading ? (
        <Grid container spacing={2.5}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Grid item xs={12} sm={6} md={4} key={i}><Skeleton variant="rounded" height={170} sx={{ borderRadius: 4 }} /></Grid>
          ))}
        </Grid>
      ) : venues.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 10, color: "text.secondary" }}>
          <Box sx={{ width: 88, height: 88, mx: "auto", mb: 2, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
            <SportsTennisIcon sx={{ fontSize: 44, color: alpha(theme.palette.primary.main, 0.6) }} />
          </Box>
          <Typography variant="h6" fontWeight={700} color="text.primary">Chưa có cụm sân nào</Typography>
          {canCreate && <Typography sx={{ mt: 0.5 }}>Bấm “Tạo cụm sân” để bắt đầu.</Typography>}
        </Box>
      ) : (
        <Grid container spacing={2.5}>
          {venues.map((v) => {
            const st = STATUS[v.status] || STATUS.active;
            return (
              <Grid item xs={12} sm={6} md={4} key={v._id}>
                <Box sx={{ height: "100%", borderRadius: 4, border: `1px solid ${theme.palette.divider}`, bgcolor: "background.paper", p: 2, display: "flex", flexDirection: "column", gap: 1, transition: "box-shadow .18s ease, border-color .18s ease", "@media (prefers-reduced-motion: reduce)": { transition: "none" }, "&:hover": { borderColor: alpha(theme.palette.primary.main, 0.4), boxShadow: `0 12px 30px -16px ${alpha(theme.palette.common.black, 0.5)}` } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Typography sx={{ fontWeight: 800, fontSize: 16.5 }} noWrap>{v.name}</Typography>
                    <Chip size="small" color={st.color} variant={v.status === "active" ? "filled" : "outlined"} label={st.label} sx={{ flexShrink: 0, fontWeight: 600 }} />
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
                    <PlaceOutlinedIcon sx={{ fontSize: 16 }} />
                    <Typography variant="body2" noWrap>{v.address || v.province || "Chưa cập nhật"}</Typography>
                  </Stack>
                  <Chip size="small" icon={<SportsTennisIcon sx={{ fontSize: 15 }} />} label={`${v.courtCount || 0} sân`} sx={{ alignSelf: "flex-start", fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.1), color: "primary.main" }} />
                  <Box sx={{ flex: 1 }} />
                  <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                    <Button fullWidth size="small" variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => navigate(`/owner/venues/${v._id}`)} sx={{ borderRadius: 2, fontWeight: 600 }}>Quản lý</Button>
                    <Button fullWidth size="small" variant="contained" startIcon={<EventNoteOutlinedIcon />} onClick={() => navigate(`/owner/venues/${v._id}/bookings`)} sx={{ borderRadius: 2, fontWeight: 700 }}>Lượt đặt</Button>
                  </Stack>
                </Box>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ fontWeight: 800, pr: 6 }}>
          Tạo cụm sân
          <IconButton onClick={() => setOpen(false)} sx={{ position: "absolute", right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="Tên cụm sân *" size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            <TextField label="Tỉnh/TP" size="small" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
            <TextField label="Địa chỉ" size="small" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <TextField label="Số điện thoại" size="small" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} disabled={creating} color="inherit">Huỷ</Button>
          <Button variant="contained" onClick={submit} disabled={creating} sx={{ fontWeight: 700, borderRadius: 2.5 }}>{creating ? "Đang tạo…" : "Tạo"}</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
