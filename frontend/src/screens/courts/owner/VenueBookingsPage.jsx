import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Paper,
  TextField,
  MenuItem,
  Chip,
  Skeleton,
  Grid,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PaidIcon from "@mui/icons-material/Paid";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import BarChartIcon from "@mui/icons-material/BarChart";

import { useGetVenueQuery } from "../../../slices/venuesApiSlice";
import {
  useListVenueBookingsQuery,
  useUpdateBookingStatusMutation,
  useSetBookingPaymentMutation,
} from "../../../slices/bookingsApiSlice";
import {
  fmtVND,
  toDateInput,
  fmtDateLabel,
  BOOKING_STATUS,
  PAYMENT_STATUS,
} from "../courtShared";

const tz = { timeZone: "Asia/Bangkok" };
const tLabel = (iso) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", ...tz });

const STATUS_OPTIONS = [
  ["pending", "Chờ duyệt"],
  ["confirmed", "Đã xác nhận"],
  ["completed", "Hoàn tất"],
  ["no_show", "Không đến"],
  ["cancelled", "Đã huỷ"],
];

export default function VenueBookingsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: venue } = useGetVenueQuery(id);
  const [date, setDate] = useState(toDateInput());
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading, isFetching } = useListVenueBookingsQuery({
    venueId: id,
    date,
    status: statusFilter,
  });
  const [updateStatus] = useUpdateBookingStatusMutation();
  const [setPayment] = useSetBookingPaymentMutation();

  const items = useMemo(() => data || [], [data]);
  const loading = isLoading || isFetching;

  const stats = useMemo(() => {
    const active = items.filter((b) => b.status !== "cancelled");
    const revenue = items
      .filter((b) => b.payment?.status === "Paid")
      .reduce((s, b) => s + (Number(b.totalPrice) || 0), 0);
    return { count: active.length, revenue };
  }, [items]);

  const changeStatus = async (b, status) => {
    try {
      await updateStatus({ id: b._id, status, venueId: id }).unwrap();
      toast.success("Đã cập nhật trạng thái");
    } catch (e) {
      toast.error(e?.data?.message || "Cập nhật thất bại");
    }
  };

  const togglePaid = async (b) => {
    const next = b.payment?.status === "Paid" ? "Unpaid" : "Paid";
    try {
      await setPayment({ id: b._id, status: next, venueId: id }).unwrap();
      toast.success(next === "Paid" ? "Đã xác nhận thanh toán" : "Đã bỏ xác nhận");
    } catch (e) {
      toast.error(e?.data?.message || "Cập nhật thất bại");
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/owner/venues/${id}`)}>
          Quản lý cụm sân
        </Button>
        <Button
          variant="outlined"
          startIcon={<BarChartIcon />}
          onClick={() => navigate(`/owner/venues/${id}/revenue`)}
        >
          Doanh thu
        </Button>
      </Stack>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
        Lượt đặt — {venue?.name || ""}
      </Typography>

      {/* Bộ lọc + thống kê */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" type="date" label="Ngày" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} />
          </Grid>
          <Grid item xs={7} sm={4}>
            <TextField select fullWidth size="small" label="Trạng thái" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="">Tất cả</MenuItem>
              {STATUS_OPTIONS.map(([v, l]) => (
                <MenuItem key={v} value={v}>{l}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={5} sm={4}>
            <Stack alignItems="flex-end">
              <Typography variant="caption" color="text.secondary">Doanh thu đã thu</Typography>
              <Typography variant="h6" fontWeight={900} color="success.main">{fmtVND(stats.revenue)}</Typography>
            </Stack>
          </Grid>
        </Grid>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {fmtDateLabel(date)} • {stats.count} lượt đặt
        </Typography>
      </Paper>

      {loading ? (
        <Stack spacing={1.5}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 3 }} />
          ))}
        </Stack>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
          Không có lượt đặt nào trong ngày này.
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {items.map((b) => {
            const st = BOOKING_STATUS[b.status] || BOOKING_STATUS.pending;
            const pay = PAYMENT_STATUS[b.payment?.status] || PAYMENT_STATUS.Unpaid;
            const paid = b.payment?.status === "Paid";
            return (
              <Paper key={b._id} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={800}>{tLabel(b.startAt)}–{tLabel(b.endAt)}</Typography>
                      <Chip size="small" label={b.court?.name || "Sân"} />
                      <Chip size="small" variant="outlined" label={`#${b.code}`} />
                      <Chip size="small" color={st.color} label={st.label} />
                      <Chip size="small" color={pay.color} variant="outlined" label={pay.label} />
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>
                      {b.customerName || b.user?.name || "Khách"}
                      {b.customerPhone || b.user?.phone ? ` • ${b.customerPhone || b.user?.phone}` : ""}
                      {" • "}
                      <b>{fmtVND(b.totalPrice)}</b>
                    </Typography>
                    {b.note ? (
                      <Typography variant="caption" color="text.secondary">Ghi chú: {b.note}</Typography>
                    ) : null}
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <TextField
                      select
                      size="small"
                      value={b.status}
                      onChange={(e) => changeStatus(b, e.target.value)}
                      sx={{ minWidth: 150 }}
                    >
                      {STATUS_OPTIONS.map(([v, l]) => (
                        <MenuItem key={v} value={v}>{l}</MenuItem>
                      ))}
                    </TextField>
                    <Button
                      size="small"
                      variant={paid ? "outlined" : "contained"}
                      color={paid ? "inherit" : "success"}
                      startIcon={paid ? <MoneyOffIcon /> : <PaidIcon />}
                      onClick={() => togglePaid(b)}
                    >
                      {paid ? "Bỏ xác nhận" : "Đã thu"}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
