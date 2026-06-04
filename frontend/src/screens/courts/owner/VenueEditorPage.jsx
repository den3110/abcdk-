/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Paper,
  Grid,
  TextField,
  Switch,
  IconButton,
  Chip,
  Divider,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Skeleton,
  InputAdornment,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import EventNoteIcon from "@mui/icons-material/EventNote";
import BarChartIcon from "@mui/icons-material/BarChart";

import {
  useGetVenueQuery,
  useUpdateVenueMutation,
  useAddCourtMutation,
  useUpdateCourtMutation,
  useDeleteCourtMutation,
} from "../../../slices/venuesApiSlice";
import { fmtVND, WEEKDAYS_LONG, WEEKDAYS_SHORT, imgSrc } from "../courtShared";

function defaultHours() {
  return Array.from({ length: 7 }, () => ({ closed: false, open: "06:00", close: "22:00" }));
}

const emptyCourt = {
  name: "",
  defaultPricePerHour: 0,
  status: "active",
  priceRules: [],
};

export default function VenueEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: venue, isLoading } = useGetVenueQuery(id);
  const [updateVenue, { isLoading: saving }] = useUpdateVenueMutation();
  const [addCourt] = useAddCourtMutation();
  const [updateCourt] = useUpdateCourtMutation();
  const [deleteCourt] = useDeleteCourtMutation();

  const [form, setForm] = useState(null);
  const [amenityInput, setAmenityInput] = useState("");
  const [imageInput, setImageInput] = useState("");

  // Court dialog
  const [courtDlg, setCourtDlg] = useState(null); // {mode:'add'|'edit', court}

  useEffect(() => {
    if (!venue) return;
    setForm({
      name: venue.name || "",
      phone: venue.phone || "",
      address: venue.address || "",
      province: venue.province || "",
      description: venue.description || "",
      slotMinutes: venue.slotMinutes || 60,
      defaultPricePerHour: venue.defaultPricePerHour || 0,
      depositPercent: venue.depositPercent || 0,
      bankShortName: venue.bankShortName || "",
      bankAccountNumber: venue.bankAccountNumber || "",
      bankAccountName: venue.bankAccountName || "",
      images: Array.isArray(venue.images) ? venue.images : [],
      amenities: Array.isArray(venue.amenities) ? venue.amenities : [],
      openHours:
        Array.isArray(venue.openHours) && venue.openHours.length === 7
          ? venue.openHours.map((h) => ({ ...h }))
          : defaultHours(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?._id]);

  const courts = venue?.courts || [];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setHour = (i, patch) =>
    setForm((f) => ({
      ...f,
      openHours: f.openHours.map((h, idx) => (idx === i ? { ...h, ...patch } : h)),
    }));

  const saveVenue = async () => {
    try {
      await updateVenue({ id, body: form }).unwrap();
      toast.success("Đã lưu cụm sân");
    } catch (e) {
      toast.error(e?.data?.message || "Lưu thất bại");
    }
  };

  const saveCourt = async () => {
    const c = courtDlg.court;
    if (!String(c.name || "").trim()) {
      toast.error("Cần nhập tên sân");
      return;
    }
    try {
      if (courtDlg.mode === "add") {
        await addCourt({ venueId: id, body: c }).unwrap();
        toast.success("Đã thêm sân");
      } else {
        await updateCourt({ venueId: id, courtId: c._id, body: c }).unwrap();
        toast.success("Đã lưu sân");
      }
      setCourtDlg(null);
    } catch (e) {
      toast.error(e?.data?.message || "Lưu sân thất bại");
    }
  };

  const removeCourt = async (court) => {
    if (!window.confirm(`Xoá sân "${court.name}"?`)) return;
    try {
      await deleteCourt({ venueId: id, courtId: court._id }).unwrap();
      toast.success("Đã xoá sân");
    } catch (e) {
      toast.error(e?.data?.message || "Xoá thất bại");
    }
  };

  if (isLoading || !form) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="rounded" height={300} sx={{ borderRadius: 3, mt: 2 }} />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/owner/venues")}>
          Sân của tôi
        </Button>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<BarChartIcon />}
            onClick={() => navigate(`/owner/venues/${id}/revenue`)}
          >
            Doanh thu
          </Button>
          <Button
            variant="outlined"
            startIcon={<EventNoteIcon />}
            onClick={() => navigate(`/owner/venues/${id}/bookings`)}
          >
            Lượt đặt
          </Button>
        </Stack>
      </Stack>

      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
        {form.name || "Cụm sân"}
      </Typography>

      {/* Thông tin chung */}
      <Section title="Thông tin chung">
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={6}>
            <TextField fullWidth size="small" label="Tên cụm sân" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField fullWidth size="small" label="Số điện thoại" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField fullWidth size="small" label="Địa chỉ" value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Tỉnh/TP" value={form.province} onChange={(e) => set({ province: e.target.value })} />
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth size="small" label="Mô tả" value={form.description} onChange={(e) => set({ description: e.target.value })} multiline minRows={2} />
          </Grid>
        </Grid>

        {/* Tiện ích */}
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Tiện ích</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          {form.amenities.map((a) => (
            <Chip key={a} label={a} onDelete={() => set({ amenities: form.amenities.filter((x) => x !== a) })} />
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="VD: Có mái che, Bãi đỗ xe…"
            value={amenityInput}
            onChange={(e) => setAmenityInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && amenityInput.trim()) {
                set({ amenities: [...new Set([...form.amenities, amenityInput.trim()])] });
                setAmenityInput("");
              }
            }}
          />
          <Button
            onClick={() => {
              if (amenityInput.trim()) {
                set({ amenities: [...new Set([...form.amenities, amenityInput.trim()])] });
                setAmenityInput("");
              }
            }}
          >
            Thêm
          </Button>
        </Stack>

        {/* Ảnh (dán link) */}
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Ảnh (dán link URL)</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          {form.images.map((url) => (
            <Box key={url} sx={{ position: "relative" }}>
              <Box component="img" src={imgSrc(url)} alt="" sx={{ width: 90, height: 64, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider" }} />
              <IconButton
                size="small"
                onClick={() => set({ images: form.images.filter((x) => x !== url) })}
                sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", border: "1px solid", borderColor: "divider" }}
              >
                <DeleteOutlineIcon fontSize="inherit" />
              </IconButton>
            </Box>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth placeholder="https://…" value={imageInput} onChange={(e) => setImageInput(e.target.value)} />
          <Button
            onClick={() => {
              if (/^https?:\/\//i.test(imageInput.trim())) {
                set({ images: [...form.images, imageInput.trim()] });
                setImageInput("");
              } else {
                toast.error("Link ảnh phải bắt đầu bằng http(s)://");
              }
            }}
          >
            Thêm
          </Button>
        </Stack>
      </Section>

      {/* Giờ mở cửa */}
      <Section title="Giờ mở cửa">
        <Stack spacing={1}>
          {form.openHours.map((h, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              <Typography sx={{ width: 64, fontWeight: 600 }}>{WEEKDAYS_LONG[i]}</Typography>
              <Switch checked={!h.closed} onChange={(e) => setHour(i, { closed: !e.target.checked })} />
              {h.closed ? (
                <Typography color="text.secondary" variant="body2">Đóng cửa</Typography>
              ) : (
                <>
                  <TextField type="time" size="small" value={h.open} onChange={(e) => setHour(i, { open: e.target.value })} sx={{ width: 130 }} />
                  <Typography>–</Typography>
                  <TextField type="time" size="small" value={h.close} onChange={(e) => setHour(i, { close: e.target.value })} sx={{ width: 130 }} />
                </>
              )}
            </Stack>
          ))}
        </Stack>
      </Section>

      {/* Cấu hình đặt & thanh toán */}
      <Section title="Đặt sân & thanh toán">
        <Grid container spacing={1.5}>
          <Grid item xs={6} sm={3}>
            <TextField select fullWidth size="small" label="Bước giờ" value={form.slotMinutes} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
              {[30, 60, 90, 120].map((m) => (
                <MenuItem key={m} value={m}>{m} phút</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={4}>
            <TextField fullWidth size="small" type="number" label="Giá mặc định/giờ" value={form.defaultPricePerHour} onChange={(e) => set({ defaultPricePerHour: Number(e.target.value) })} InputProps={{ endAdornment: <InputAdornment position="end">đ</InputAdornment> }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField fullWidth size="small" type="number" label="Đặt cọc" value={form.depositPercent} onChange={(e) => set({ depositPercent: Number(e.target.value) })} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Ngân hàng (mã)" placeholder="VD: VCB, MB…" value={form.bankShortName} onChange={(e) => set({ bankShortName: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Số tài khoản" value={form.bankAccountNumber} onChange={(e) => set({ bankAccountNumber: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Tên chủ tài khoản" value={form.bankAccountName} onChange={(e) => set({ bankAccountName: e.target.value })} />
          </Grid>
        </Grid>
      </Section>

      <Box sx={{ position: "sticky", bottom: 12, zIndex: 5, mb: 3, display: "flex", justifyContent: "flex-end" }}>
        <Button variant="contained" size="large" startIcon={<SaveIcon />} onClick={saveVenue} disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu cụm sân"}
        </Button>
      </Box>

      {/* Danh sách sân */}
      <Section
        title="Danh sách sân"
        action={
          <Button size="small" startIcon={<AddIcon />} variant="contained" onClick={() => setCourtDlg({ mode: "add", court: { ...emptyCourt, defaultPricePerHour: form.defaultPricePerHour } })}>
            Thêm sân
          </Button>
        }
      >
        {courts.length === 0 ? (
          <Typography color="text.secondary" variant="body2">Chưa có sân nào. Bấm “Thêm sân”.</Typography>
        ) : (
          <Stack spacing={1}>
            {courts.map((c) => (
              <Paper key={c._id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography fontWeight={700}>{c.name}</Typography>
                      {c.status === "maintenance" ? <Chip size="small" color="warning" label="Bảo trì" /> : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {fmtVND(c.defaultPricePerHour)}/giờ
                      {c.priceRules?.length ? ` • ${c.priceRules.length} khung giá riêng` : ""}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    <IconButton onClick={() => setCourtDlg({ mode: "edit", court: { ...c, priceRules: (c.priceRules || []).map((r) => ({ ...r })) } })}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton color="error" onClick={() => removeCourt(c)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Section>

      <CourtDialog
        state={courtDlg}
        onChange={(court) => setCourtDlg((s) => ({ ...s, court }))}
        onClose={() => setCourtDlg(null)}
        onSave={saveCourt}
      />
    </Container>
  );
}

function Section({ title, action, children }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3, mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
        {action}
      </Stack>
      <Divider sx={{ mb: 2 }} />
      {children}
    </Paper>
  );
}

/* ---- Dialog thêm/sửa sân + bảng giá ---- */
function CourtDialog({ state, onChange, onClose, onSave }) {
  if (!state) return null;
  const c = state.court;
  const setRule = (i, patch) =>
    onChange({ ...c, priceRules: c.priceRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const addRule = () =>
    onChange({
      ...c,
      priceRules: [...(c.priceRules || []), { label: "", daysOfWeek: [], start: "17:00", end: "22:00", pricePerHour: c.defaultPricePerHour || 0 }],
    });
  const removeRule = (i) => onChange({ ...c, priceRules: c.priceRules.filter((_, idx) => idx !== i) });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{state.mode === "add" ? "Thêm sân" : "Sửa sân"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <TextField size="small" label="Tên sân *" value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} autoFocus />
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              type="number"
              label="Giá mặc định/giờ"
              value={c.defaultPricePerHour}
              onChange={(e) => onChange({ ...c, defaultPricePerHour: Number(e.target.value) })}
              InputProps={{ endAdornment: <InputAdornment position="end">đ</InputAdornment> }}
              fullWidth
            />
            <TextField select size="small" label="Trạng thái" value={c.status} onChange={(e) => onChange({ ...c, status: e.target.value })} sx={{ width: 150 }}>
              <MenuItem value="active">Hoạt động</MenuItem>
              <MenuItem value="maintenance">Bảo trì</MenuItem>
            </TextField>
          </Stack>

          <Divider />
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2">Bảng giá theo khung giờ (tuỳ chọn)</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addRule}>Thêm khung</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Khung khớp sẽ ghi đè giá mặc định (VD: giờ vàng 17:00–22:00 giá cao hơn).
          </Typography>

          {(c.priceRules || []).map((r, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" type="time" value={r.start} onChange={(e) => setRule(i, { start: e.target.value })} sx={{ width: 120 }} />
                  <Typography>–</Typography>
                  <TextField size="small" type="time" value={r.end} onChange={(e) => setRule(i, { end: e.target.value })} sx={{ width: 120 }} />
                  <TextField
                    size="small"
                    type="number"
                    label="Giá/giờ"
                    value={r.pricePerHour}
                    onChange={(e) => setRule(i, { pricePerHour: Number(e.target.value) })}
                    InputProps={{ endAdornment: <InputAdornment position="end">đ</InputAdornment> }}
                    fullWidth
                  />
                  <IconButton color="error" onClick={() => removeRule(i)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <ToggleButtonGroup
                  size="small"
                  value={r.daysOfWeek}
                  onChange={(_, val) => setRule(i, { daysOfWeek: val })}
                  sx={{ flexWrap: "wrap" }}
                >
                  {WEEKDAYS_SHORT.map((w, idx) => (
                    <ToggleButton key={idx} value={idx} sx={{ px: 1.2 }}>{w}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                  Không chọn thứ nào = áp dụng mọi ngày.
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="contained" onClick={onSave}>Lưu</Button>
      </DialogActions>
    </Dialog>
  );
}
