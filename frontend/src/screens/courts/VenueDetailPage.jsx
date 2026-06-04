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
  Avatar,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlaceIcon from "@mui/icons-material/Place";
import PhoneIcon from "@mui/icons-material/Phone";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import {
  useGetVenueQuery,
  useGetVenueAvailabilityQuery,
} from "../../slices/venuesApiSlice";
import { useCreateBookingMutation } from "../../slices/bookingsApiSlice";
import AvailabilityGrid from "./AvailabilityGrid";
import {
  imgSrc,
  fmtVND,
  toDateInput,
  fmtDateLabel,
  WEEKDAYS_SHORT,
  bookingQrUrl,
} from "./courtShared";

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function VenueDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);

  const today = toDateInput();
  const [date, setDate] = useState(today);

  const { data: venue, isLoading: venueLoading } = useGetVenueQuery(id);
  const { data: avail, isFetching: availLoading } = useGetVenueAvailabilityQuery(
    { id, date },
    { skip: !id || !date },
  );
  const [createBooking, { isLoading: booking }] = useCreateBookingMutation();

  const [confirm, setConfirm] = useState(null); // selection summary
  const [name, setName] = useState(userInfo?.name || "");
  const [phone, setPhone] = useState(userInfo?.phone || "");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState(null); // booking vừa tạo → hiện QR

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today],
  );

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
        venueId: id,
        courtId: confirm.courtId,
        date,
        start: confirm.start,
        end: confirm.end,
        customerName: name,
        customerPhone: phone,
        note,
      }).unwrap();
      setConfirm(null);
      setCreated(b);
      toast.success("Đặt sân thành công! Vui lòng thanh toán để được xác nhận.");
    } catch (e) {
      toast.error(e?.data?.message || e?.message || "Đặt sân thất bại");
    }
  };

  const qr = created && venue ? bookingQrUrl(venue, created) : "";

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 3 } }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate("/courts")}
        sx={{ mb: 1 }}
      >
        Tất cả sân
      </Button>

      {/* Header */}
      {venueLoading ? (
        <Skeleton variant="rounded" height={200} sx={{ borderRadius: 3, mb: 2 }} />
      ) : (
        <Box
          sx={{
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
            mb: 3,
          }}
        >
          <Box
            sx={{
              height: { xs: 160, md: 220 },
              backgroundImage: cover
                ? `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.55)), url(${cover})`
                : "linear-gradient(135deg,#1976d2,#43a047)",
              backgroundSize: "cover",
              backgroundPosition: "center",
              display: "flex",
              alignItems: "flex-end",
              p: 2,
            }}
          >
            <Typography variant="h4" fontWeight={900} sx={{ color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.5)" }}>
              {venue?.name}
            </Typography>
          </Box>
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ color: "text.secondary" }}>
              {venue?.address ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PlaceIcon fontSize="small" />
                  <Typography variant="body2">{venue.address}</Typography>
                </Stack>
              ) : null}
              {venue?.phone ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PhoneIcon fontSize="small" />
                  <Typography variant="body2">{venue.phone}</Typography>
                </Stack>
              ) : null}
              {todayHours ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <AccessTimeIcon fontSize="small" />
                  <Typography variant="body2">
                    {todayHours.closed ? "Đóng cửa hôm nay" : `${todayHours.open}–${todayHours.close}`}
                  </Typography>
                </Stack>
              ) : null}
            </Stack>
            {venue?.description ? (
              <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: "pre-wrap" }}>
                {venue.description}
              </Typography>
            ) : null}
            {Array.isArray(venue?.amenities) && venue.amenities.length ? (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                {venue.amenities.map((a) => (
                  <Chip key={a} size="small" variant="outlined" label={a} />
                ))}
              </Stack>
            ) : null}
            {venue?.depositPercent > 0 ? (
              <Chip
                size="small"
                color="info"
                sx={{ mt: 1.5 }}
                label={`Đặt cọc ${venue.depositPercent}% khi đặt`}
              />
            ) : null}
          </Box>
        </Box>
      )}

      {/* Chọn ngày */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
        {days.map((d) => {
          const active = d === date;
          const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
          const dd = d.slice(8, 10);
          return (
            <Button
              key={d}
              size="small"
              variant={active ? "contained" : "outlined"}
              onClick={() => setDate(d)}
              sx={{ minWidth: 56, flexDirection: "column", lineHeight: 1.1, py: 0.5 }}
            >
              <span style={{ fontSize: 11 }}>{d === today ? "Hôm nay" : WEEKDAYS_SHORT[wd]}</span>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{dd}</span>
            </Button>
          );
        })}
        <TextField
          type="date"
          size="small"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          inputProps={{ min: today }}
          sx={{ ml: { sm: "auto" } }}
        />
      </Stack>

      <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
        Lịch trống — {fmtDateLabel(date)}
      </Typography>

      {availLoading && !avail ? (
        <Skeleton variant="rounded" height={260} sx={{ borderRadius: 2 }} />
      ) : (
        <AvailabilityGrid data={avail} disabled={booking} onConfirm={handleConfirm} />
      )}

      {/* Dialog xác nhận đặt */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>Xác nhận đặt sân</DialogTitle>
        <DialogContent dividers>
          {confirm ? (
            <Stack spacing={1.5}>
              <Row label="Sân" value={confirm.courtName} />
              <Row label="Ngày" value={fmtDateLabel(date)} />
              <Row label="Giờ" value={`${confirm.start} – ${confirm.end}`} />
              <Row label="Tạm tính" value={fmtVND(confirm.total)} strong />
              <Divider />
              <TextField
                size="small"
                label="Tên người đặt"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                size="small"
                label="Số điện thoại"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <TextField
                size="small"
                label="Ghi chú (tuỳ chọn)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                multiline
                minRows={2}
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={booking}>
            Huỷ
          </Button>
          <Button variant="contained" onClick={handleBook} disabled={booking}>
            {booking ? "Đang đặt…" : "Xác nhận đặt"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog QR thanh toán */}
      <Dialog open={!!created} onClose={() => setCreated(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CheckCircleIcon color="success" /> Đã đặt sân
        </DialogTitle>
        <DialogContent dividers>
          {created ? (
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Mã đặt sân <b>{created.code}</b> đang chờ thanh toán. Quét QR để
                chuyển khoản, chủ sân sẽ xác nhận.
              </Typography>
              {qr ? (
                <Avatar
                  src={qr}
                  variant="rounded"
                  sx={{ width: 240, height: 240, "& img": { objectFit: "contain" } }}
                />
              ) : (
                <Typography variant="body2" color="warning.main" textAlign="center">
                  Sân chưa cấu hình tài khoản nhận tiền — vui lòng liên hệ chủ sân.
                </Typography>
              )}
              <Row
                label="Số tiền"
                value={fmtVND(created.depositAmount > 0 ? created.depositAmount : created.totalPrice)}
                strong
              />
              {created.depositAmount > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  (Đặt cọc {venue?.depositPercent}% • tổng {fmtVND(created.totalPrice)})
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => navigate("/my-bookings")}>Lượt đặt của tôi</Button>
          <Button variant="contained" onClick={() => setCreated(null)}>
            Xong
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function Row({ label, value, strong }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant={strong ? "subtitle1" : "body2"} fontWeight={strong ? 800 : 600}>
        {value}
      </Typography>
    </Stack>
  );
}
