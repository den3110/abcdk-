import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Chip,
  Button,
  Paper,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Divider,
} from "@mui/material";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import PlaceIcon from "@mui/icons-material/Place";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import {
  useListMyBookingsQuery,
  useUpdateBookingStatusMutation,
} from "../../slices/bookingsApiSlice";
import {
  fmtVND,
  bookingQrUrl,
  BOOKING_STATUS,
  PAYMENT_STATUS,
} from "./courtShared";

const tz = { timeZone: "Asia/Bangkok" };
const dLabel = (iso) => new Date(iso).toLocaleDateString("vi-VN", tz);
const tLabel = (iso) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", ...tz });

export default function MyBookingsPage() {
  const navigate = useNavigate();
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

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
        Lượt đặt của tôi
      </Typography>

      {isLoading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={120} sx={{ borderRadius: 3 }} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <EventBusyIcon sx={{ fontSize: 64, opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>Bạn chưa có lượt đặt nào.</Typography>
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate("/courts")}>
            Tìm sân để đặt
          </Button>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {items.map((b) => {
            const st = BOOKING_STATUS[b.status] || BOOKING_STATUS.pending;
            const pay = PAYMENT_STATUS[b.payment?.status] || PAYMENT_STATUS.Unpaid;
            const canCancel = ["pending", "confirmed"].includes(b.status);
            return (
              <Paper
                key={b._id}
                variant="outlined"
                sx={{ p: 2, borderRadius: 3 }}
              >
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  justifyContent="space-between"
                  spacing={1.5}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1" fontWeight={800} noWrap>
                        {b.venue?.name || "Sân"}
                      </Typography>
                      <Chip size="small" label={`#${b.code}`} variant="outlined" />
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", mt: 0.25 }}>
                      <PlaceIcon sx={{ fontSize: 16 }} />
                      <Typography variant="body2" noWrap>
                        {b.venue?.address || b.venue?.province || ""}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>
                      <b>{b.court?.name}</b> • {dLabel(b.startAt)} • {tLabel(b.startAt)}–{tLabel(b.endAt)}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                      <Chip size="small" color={st.color} label={st.label} />
                      <Chip size="small" color={pay.color} variant="outlined" label={pay.label} />
                      <Chip size="small" label={fmtVND(b.totalPrice)} />
                    </Stack>
                  </Box>
                  <Stack
                    direction={{ xs: "row", sm: "column" }}
                    spacing={1}
                    justifyContent="center"
                    alignItems={{ xs: "center", sm: "flex-end" }}
                  >
                    {b.payment?.status !== "Paid" && b.status !== "cancelled" ? (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<QrCode2Icon />}
                        onClick={() => setQrBooking(b)}
                      >
                        Thanh toán
                      </Button>
                    ) : null}
                    {canCancel ? (
                      <Button size="small" color="error" disabled={updating} onClick={() => cancel(b)}>
                        Huỷ
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Dialog open={!!qrBooking} onClose={() => setQrBooking(null)} fullWidth maxWidth="xs">
        <DialogTitle>Thanh toán — #{qrBooking?.code}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} alignItems="center">
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
            <Divider flexItem />
            <Stack direction="row" justifyContent="space-between" sx={{ width: "100%" }}>
              <Typography variant="body2" color="text.secondary">
                Số tiền
              </Typography>
              <Typography variant="subtitle1" fontWeight={800}>
                {fmtVND(
                  qrBooking?.depositAmount > 0
                    ? qrBooking.depositAmount
                    : qrBooking?.totalPrice,
                )}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Sau khi chuyển khoản, chủ sân sẽ xác nhận trạng thái thanh toán.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setQrBooking(null)}>
            Đóng
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
