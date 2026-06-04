/* eslint-disable react/prop-types */
import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Chip,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Skeleton,
  IconButton,
  useTheme,
  alpha,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import PhoneOutlinedIcon from "@mui/icons-material/PhoneOutlined";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CloseIcon from "@mui/icons-material/Close";

import { useGetVenueQuery, useGetVenueAvailabilityQuery } from "../../slices/venuesApiSlice";
import { useCreateBookingMutation } from "../../slices/bookingsApiSlice";
import AvailabilityGrid from "./AvailabilityGrid";
import { imgSrc, fmtVND, toDateInput, fmtDateLabel, WEEKDAYS_SHORT, bookingQrUrl } from "./courtShared";

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function VenueDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const userInfo = useSelector((s) => s.auth?.userInfo);

  const today = toDateInput();
  const [date, setDate] = useState(today);

  const { data: venue, isLoading: venueLoading } = useGetVenueQuery(id);
  const { data: avail, isFetching: availLoading } = useGetVenueAvailabilityQuery({ id, date }, { skip: !id || !date });
  const [createBooking, { isLoading: booking }] = useCreateBookingMutation();

  const [confirm, setConfirm] = useState(null);
  const [name, setName] = useState(userInfo?.name || "");
  const [phone, setPhone] = useState(userInfo?.phone || "");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const cover = imgSrc(venue?.images?.[0]);
  const todayHours = venue?.openHours?.[new Date(`${date}T12:00:00Z`).getUTCDay()];

  const handleConfirm = (selection) => {
    if (!userInfo) {
      toast.info("Vui lòng đăng nhập để đặt sân");
      navigate("/login");
      return;
    }
    setName(userInfo?.name || "");
    setPhone(userInfo?.phone || "");
    setNote("");
    setConfirm(selection);
  };

  const handleBook = async () => {
    if (!confirm) return;
    try {
      const b = await createBooking({
        venueId: id, courtId: confirm.courtId, date, start: confirm.start, end: confirm.end,
        customerName: name, customerPhone: phone, note,
      }).unwrap();
      setConfirm(null);
      setCreated(b);
      toast.success("Đặt sân thành công! Thanh toán để được xác nhận.");
    } catch (e) {
      toast.error(e?.data?.message || e?.message || "Đặt sân thất bại");
    }
  };

  const qr = created && venue ? bookingQrUrl(venue, created) : "";
  const metaPill = (icon, text) => (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 1.25, py: 0.5, borderRadius: 2, bgcolor: alpha("#fff", 0.16), backdropFilter: "blur(4px)" }}>
      {icon}
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{text}</Typography>
    </Stack>
  );

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/courts")} sx={{ mb: 1.5, color: "text.secondary", fontWeight: 600 }}>
        Tất cả sân
      </Button>

      {/* Hero */}
      {venueLoading ? (
        <Skeleton variant="rounded" height={240} sx={{ borderRadius: 5, mb: 3 }} />
      ) : (
        <Box sx={{ position: "relative", borderRadius: 5, overflow: "hidden", mb: 3, minHeight: { xs: 200, md: 260 }, display: "flex", alignItems: "flex-end", p: { xs: 2.5, md: 3.5 }, color: "#fff", background: cover ? undefined : `linear-gradient(135deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})` }}>
          {cover && (
            <>
              <Box component="img" src={cover} alt={venue?.name} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.1) 30%, rgba(0,0,0,.72))" }} />
            </>
          )}
          <Box sx={{ position: "relative", width: "100%" }}>
            <Typography sx={{ fontSize: { xs: 26, md: 36 }, fontWeight: 900, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>
              {venue?.name}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
              {venue?.address && metaPill(<PlaceOutlinedIcon sx={{ fontSize: 16 }} />, venue.address)}
              {venue?.phone && metaPill(<PhoneOutlinedIcon sx={{ fontSize: 16 }} />, venue.phone)}
              {todayHours && metaPill(<AccessTimeIcon sx={{ fontSize: 16 }} />, todayHours.closed ? "Đóng cửa hôm nay" : `${todayHours.open}–${todayHours.close}`)}
            </Stack>
          </Box>
        </Box>
      )}

      {/* Mô tả / tiện ích / cọc */}
      {!venueLoading && (venue?.description || venue?.amenities?.length || venue?.depositPercent > 0) && (
        <Box sx={{ mb: 3 }}>
          {venue?.description && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", color: "text.secondary", maxWidth: "72ch" }}>{venue.description}</Typography>}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }} useFlexGap>
            {(venue?.amenities || []).map((a) => <Chip key={a} size="small" variant="outlined" label={a} />)}
            {venue?.depositPercent > 0 && <Chip size="small" color="info" variant="outlined" label={`Đặt cọc ${venue.depositPercent}%`} />}
          </Stack>
        </Box>
      )}

      {/* Chọn ngày */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
        {days.map((d) => {
          const active = d === date;
          const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
          return (
            <Box
              key={d}
              onClick={() => setDate(d)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setDate(d)}
              sx={{
                minWidth: 60, py: 0.9, px: 1, textAlign: "center", borderRadius: 3, cursor: "pointer", userSelect: "none",
                border: `1px solid ${active ? theme.palette.primary.main : theme.palette.divider}`,
                bgcolor: active ? "primary.main" : "background.paper",
                color: active ? theme.palette.primary.contrastText : "text.primary",
                transition: "all .15s ease",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                "&:hover": { borderColor: theme.palette.primary.main },
              }}
            >
              <Typography sx={{ fontSize: 11, fontWeight: 600, opacity: active ? 0.9 : 0.6 }}>{d === today ? "Hôm nay" : WEEKDAYS_SHORT[wd]}</Typography>
              <Typography sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{d.slice(8, 10)}</Typography>
            </Box>
          );
        })}
        <TextField type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} inputProps={{ min: today }} sx={{ ml: { sm: "auto" }, "& .MuiOutlinedInput-root": { borderRadius: 2.5 } }} />
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <CalendarMonthIcon sx={{ color: "primary.main" }} />
        <Typography variant="h6" fontWeight={800}>Lịch trống · {fmtDateLabel(date)}</Typography>
      </Stack>

      {availLoading && !avail ? (
        <Skeleton variant="rounded" height={280} sx={{ borderRadius: 3 }} />
      ) : (
        <AvailabilityGrid data={avail} disabled={booking} onConfirm={handleConfirm} />
      )}

      {/* Dialog xác nhận */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ fontWeight: 800, pr: 6 }}>
          Xác nhận đặt sân
          <IconButton onClick={() => setConfirm(null)} sx={{ position: "absolute", right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {confirm && (
            <Stack spacing={1.25}>
              <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.06), border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}` }}>
                <Row label="Sân" value={confirm.courtName} />
                <Row label="Ngày" value={fmtDateLabel(date)} />
                <Row label="Khung giờ" value={`${confirm.start} – ${confirm.end}`} />
                <Divider sx={{ my: 0.75 }} />
                <Row label="Tạm tính" value={fmtVND(confirm.total)} strong />
              </Box>
              <TextField size="small" label="Tên người đặt" value={name} onChange={(e) => setName(e.target.value)} />
              <TextField size="small" label="Số điện thoại" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <TextField size="small" label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirm(null)} disabled={booking} color="inherit">Huỷ</Button>
          <Button variant="contained" onClick={handleBook} disabled={booking} sx={{ fontWeight: 700, borderRadius: 2.5, px: 3 }}>
            {booking ? "Đang đặt…" : "Xác nhận đặt"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog QR */}
      <Dialog open={!!created} onClose={() => setCreated(null)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogContent sx={{ textAlign: "center", pt: 4 }}>
          {created && (
            <Stack spacing={1.5} alignItems="center">
              <Box sx={{ width: 56, height: 56, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.success.main, 0.14) }}>
                <CheckCircleIcon color="success" sx={{ fontSize: 34 }} />
              </Box>
              <Typography variant="h6" fontWeight={800}>Đã đặt sân!</Typography>
              <Typography variant="body2" color="text.secondary">
                Mã đặt sân <b>{created.code}</b> đang chờ thanh toán.
              </Typography>
              {qr ? (
                <Box sx={{ p: 1.5, borderRadius: 4, border: `1px solid ${theme.palette.divider}`, bgcolor: "#fff" }}>
                  <Box component="img" src={qr} alt="QR thanh toán" sx={{ width: 220, height: 220, objectFit: "contain", display: "block" }} />
                </Box>
              ) : (
                <Typography variant="body2" color="warning.main">Sân chưa cấu hình tài khoản nhận tiền — liên hệ chủ sân.</Typography>
              )}
              <Box sx={{ px: 2, py: 1, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.07) }}>
                <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Số tiền cần chuyển</Typography>
                <Typography sx={{ fontSize: 22, fontWeight: 900, color: "primary.main" }}>
                  {fmtVND(created.depositAmount > 0 ? created.depositAmount : created.totalPrice)}
                </Typography>
                {created.depositAmount > 0 && (
                  <Typography variant="caption" color="text.secondary">Đặt cọc {venue?.depositPercent}% · tổng {fmtVND(created.totalPrice)}</Typography>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => navigate("/my-bookings")} color="inherit">Lượt đặt của tôi</Button>
          <Button variant="contained" onClick={() => setCreated(null)} sx={{ fontWeight: 700, borderRadius: 2.5 }}>Xong</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function Row({ label, value, strong }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ py: 0.4 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: strong ? 800 : 600, fontSize: strong ? 17 : 14, color: strong ? "primary.main" : "text.primary" }}>{value}</Typography>
    </Stack>
  );
}
