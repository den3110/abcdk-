/* eslint-disable react/prop-types */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Chip,
  Button,
  Skeleton,
  Dialog,
  DialogContent,
  DialogActions,
  Stack,
  IconButton,
  useTheme,
  alpha,
} from "@mui/material";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import EventBusyOutlinedIcon from "@mui/icons-material/EventBusyOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { useListMyBookingsQuery, useUpdateBookingStatusMutation } from "../../slices/bookingsApiSlice";
import { fmtVND, bookingQrUrl, BOOKING_STATUS, PAYMENT_STATUS } from "./courtShared";

const tz = { timeZone: "Asia/Bangkok" };
const dLabel = (iso) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", ...tz });
const tLabel = (iso) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", ...tz });

export default function MyBookingsPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const { data, isLoading } = useListMyBookingsQuery({});
  const [updateStatus, { isLoading: updating }] = useUpdateBookingStatusMutation();
  const [qrBooking, setQrBooking] = useState(null);
  const items = data || [];

  const cancel = async (b) => {
    if (!window.confirm("Huỷ lượt đặt này?")) return;
    try {
      await updateStatus({ id: b._id, status: "cancelled", venueId: b.venue?._id }).unwrap();
      toast.success("Đã huỷ lượt đặt");
    } catch (e) {
      toast.error(e?.data?.message || "Huỷ thất bại");
    }
  };

  const qr = qrBooking ? bookingQrUrl(qrBooking.venue, qrBooking) : "";

  // Màu nhấn theo trạng thái (palette.<color>.main)
  const accentOf = (status) => {
    const c = BOOKING_STATUS[status]?.color;
    return c && theme.palette[c] ? theme.palette[c].main : theme.palette.grey[500];
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2.5, md: 3 } }}>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2.5, letterSpacing: "-0.02em" }}>
        Lượt đặt của tôi
      </Typography>

      {isLoading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="rounded" height={108} sx={{ borderRadius: 4 }} />)}
        </Stack>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 10, color: "text.secondary" }}>
          <Box sx={{ width: 88, height: 88, mx: "auto", mb: 2, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
            <EventBusyOutlinedIcon sx={{ fontSize: 44, color: alpha(theme.palette.primary.main, 0.6) }} />
          </Box>
          <Typography variant="h6" fontWeight={700} color="text.primary">Chưa có lượt đặt nào</Typography>
          <Typography sx={{ mt: 0.5, mb: 2 }}>Tìm một sân và đặt khung giờ bạn thích.</Typography>
          <Button variant="contained" onClick={() => navigate("/courts")} sx={{ fontWeight: 700, borderRadius: 2.5 }}>Tìm sân để đặt</Button>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {items.map((b) => {
            const st = BOOKING_STATUS[b.status] || BOOKING_STATUS.pending;
            const pay = PAYMENT_STATUS[b.payment?.status] || PAYMENT_STATUS.Unpaid;
            const canCancel = ["pending", "confirmed"].includes(b.status);
            const accent = accentOf(b.status);
            return (
              <Box key={b._id} sx={{ display: "flex", borderRadius: 4, overflow: "hidden", border: `1px solid ${theme.palette.divider}`, bgcolor: "background.paper" }}>
                {/* Khối ngày giờ, nền nhấn theo trạng thái */}
                <Box sx={{ width: { xs: 88, sm: 104 }, flexShrink: 0, p: 1.5, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", bgcolor: alpha(accent, 0.1), color: accent }}>
                  <Typography sx={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{dLabel(b.startAt)}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, mt: 0.5 }}>{tLabel(b.startAt)}</Typography>
                  <Typography sx={{ fontSize: 11, opacity: 0.8 }}>→ {tLabel(b.endAt)}</Typography>
                </Box>

                {/* Nội dung */}
                <Box sx={{ flex: 1, minWidth: 0, p: { xs: 1.5, sm: 2 }, display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1, justifyContent: "space-between" }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography sx={{ fontWeight: 800, fontSize: 15.5 }} noWrap>{b.venue?.name || "Sân"}</Typography>
                      <Chip size="small" label={`#${b.code}`} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", mt: 0.25 }}>
                      <PlaceOutlinedIcon sx={{ fontSize: 15 }} />
                      <Typography variant="body2" noWrap>{b.court?.name} · {b.venue?.address || b.venue?.province || ""}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                      <Chip size="small" color={st.color} label={st.label} sx={{ fontWeight: 600 }} />
                      <Chip size="small" color={pay.color} variant="outlined" label={pay.label} />
                      <Chip size="small" variant="outlined" label={fmtVND(b.totalPrice)} sx={{ fontWeight: 700 }} />
                    </Stack>
                  </Box>
                  <Stack direction={{ xs: "row", sm: "column" }} spacing={1} justifyContent="center" alignItems={{ sm: "flex-end" }}>
                    {b.payment?.status !== "Paid" && b.status !== "cancelled" && (
                      <Button size="small" variant="contained" startIcon={<QrCode2Icon />} onClick={() => setQrBooking(b)} sx={{ fontWeight: 700, borderRadius: 2 }}>Thanh toán</Button>
                    )}
                    {canCancel && (
                      <Button size="small" color="error" disabled={updating} onClick={() => cancel(b)} sx={{ borderRadius: 2 }}>Huỷ</Button>
                    )}
                  </Stack>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}

      {/* QR dialog */}
      <Dialog open={!!qrBooking} onClose={() => setQrBooking(null)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogContent sx={{ textAlign: "center", pt: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={800}>Thanh toán · #{qrBooking?.code}</Typography>
            <IconButton onClick={() => setQrBooking(null)} size="small"><CloseIcon /></IconButton>
          </Stack>
          <Stack spacing={1.5} alignItems="center">
            {qr ? (
              <Box sx={{ p: 1.5, borderRadius: 4, border: `1px solid ${theme.palette.divider}`, bgcolor: "#fff" }}>
                <Box component="img" src={qr} alt="QR" sx={{ width: 220, height: 220, objectFit: "contain", display: "block" }} />
              </Box>
            ) : (
              <Typography variant="body2" color="warning.main">Sân chưa cấu hình tài khoản nhận tiền.</Typography>
            )}
            <Box sx={{ px: 2, py: 1, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.07), width: "100%" }}>
              <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Số tiền cần chuyển</Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 900, color: "primary.main" }}>
                {fmtVND(qrBooking?.depositAmount > 0 ? qrBooking.depositAmount : qrBooking?.totalPrice)}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">Sau khi chuyển khoản, chủ sân sẽ xác nhận thanh toán.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="contained" onClick={() => setQrBooking(null)} fullWidth sx={{ fontWeight: 700, borderRadius: 2.5 }}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
