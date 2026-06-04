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
  Paper,
  Grid,
  Chip,
  Skeleton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SettingsIcon from "@mui/icons-material/Settings";
import EventNoteIcon from "@mui/icons-material/EventNote";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import {
  useListMyVenuesQuery,
  useCreateVenueMutation,
} from "../../../slices/venuesApiSlice";

export default function OwnerVenuesPage() {
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const canCreate =
    userInfo?.role === "courtOwner" ||
    userInfo?.role === "admin" ||
    userInfo?.isAdmin ||
    userInfo?.isSuperUser;

  const { data, isLoading } = useListMyVenuesQuery();
  const [createVenue, { isLoading: creating }] = useCreateVenueMutation();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", province: "", address: "", phone: "" });

  const venues = data || [];

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Cần nhập tên cụm sân");
      return;
    }
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
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight={900}>
          Sân của tôi
        </Typography>
        {canCreate ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            Tạo cụm sân
          </Button>
        ) : null}
      </Stack>

      {!canCreate ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Bạn cần quyền <b>chủ sân</b> để tạo & quản lý sân. Vui lòng liên hệ admin để được cấp quyền.
        </Alert>
      ) : null}

      {isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Grid item xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rounded" height={150} sx={{ borderRadius: 3 }} />
            </Grid>
          ))}
        </Grid>
      ) : venues.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <SportsTennisIcon sx={{ fontSize: 64, opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>Chưa có cụm sân nào.</Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {venues.map((v) => (
            <Grid item xs={12} sm={6} md={4} key={v._id}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: "100%" }}>
                <Stack spacing={1} sx={{ height: "100%" }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Typography variant="subtitle1" fontWeight={800}>
                      {v.name}
                    </Typography>
                    {v.isActive ? (
                      <Chip size="small" color="success" label="Đang mở" />
                    ) : (
                      <Chip size="small" label="Tạm ẩn" />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {v.address || v.province || "—"}
                  </Typography>
                  <Chip
                    size="small"
                    icon={<SportsTennisIcon />}
                    label={`${v.courtCount || 0} sân`}
                    sx={{ alignSelf: "flex-start" }}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SettingsIcon />}
                      onClick={() => navigate(`/owner/venues/${v._id}`)}
                      fullWidth
                    >
                      Quản lý
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<EventNoteIcon />}
                      onClick={() => navigate(`/owner/venues/${v._id}/bookings`)}
                      fullWidth
                    >
                      Lượt đặt
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Tạo cụm sân</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField
              label="Tên cụm sân *"
              size="small"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
            <TextField
              label="Tỉnh/TP"
              size="small"
              value={form.province}
              onChange={(e) => setForm({ ...form, province: e.target.value })}
            />
            <TextField
              label="Địa chỉ"
              size="small"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <TextField
              label="Số điện thoại"
              size="small"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={creating}>
            Huỷ
          </Button>
          <Button variant="contained" onClick={submit} disabled={creating}>
            {creating ? "Đang tạo…" : "Tạo"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
