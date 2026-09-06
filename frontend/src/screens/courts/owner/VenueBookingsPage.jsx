/* eslint-disable react/prop-types */
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
  Dialog,
  DialogContent,
  DialogActions,
  Badge,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PaidIcon from "@mui/icons-material/Paid";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import BarChartIcon from "@mui/icons-material/BarChart";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HowToRegIcon from "@mui/icons-material/HowToReg";

import { useGetVenueQuery } from "../../../slices/venuesApiSlice";
import {
  useListVenueBookingsQuery,
  useUpdateBookingStatusMutation,
  useSetBookingPaymentMutation,
  useApproveBookingMutation,
  useRejectBookingMutation,
  useCheckInBookingMutation,
} from "../../../slices/bookingsApiSlice";
import { fmtVND, imgSrc, toDateInput, fmtDateLabel, BOOKING_STATUS, PAYMENT_STATUS } from "../courtShared";

const tz = { timeZone: "Asia/Bangkok" };
const tLabel = (iso) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", ...tz });
const dtLabel = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", ...tz }) : "");

const STATUS_OPTIONS = [
  ["pending", "Chờ thanh toán"],
  ["awaiting_approval", "Chờ duyệt bill"],
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
  const [billOf, setBillOf] = useState(null); // dialog duyệt bill

  const { data, isLoading, isFetching } = useListVenueBookingsQuery({ venueId: id, date, status: statusFilter });
  const [updateStatus] = useUpdateBookingStatusMutation();
  const [setPayment] = useSetBookingPaymentMutation();
  const [approve, { isLoading: approving }] = useApproveBookingMutation();
  const [reject, { isLoading: rejecting }] = useRejectBookingMutation();
  const [checkIn, { isLoading: checking }] = useCheckInBookingMutation();

  const items = useMemo(() => data || [], [data]);
  const loading = isLoading || isFetching;

  const stats = useMemo(() => {
    const active = items.filter((b) => b.status !== "cancelled");
    const revenue = items.filter((b) => b.payment?.status === "Paid").reduce((s, b) => s + (Number(b.totalPrice) || 0), 0);
    const awaiting = items.filter((b) => b.status === "awaiting_approval").length;
    return { count: active.length, revenue, awaiting };
  }, [items]);

  const run = async (fn, okMsg) => {
    try {
      await fn();
      toast.success(okMsg);
    } catch (e) {
      toast.error(e?.data?.message || "Thao tác thất bại");
    }
  };
  const changeStatus = (b, status) => run(() => updateStatus({ id: b._id, status, venueId: id }).unwrap(), "Đã cập nhật trạng thái");
  const togglePaid = (b) => {
    const next = b.payment?.status === "Paid" ? "Unpaid" : "Paid";
    return run(() => setPayment({ id: b._id, status: next, venueId: id }).unwrap(), next === "Paid" ? "Đã xác nhận thanh toán" : "Đã bỏ xác nhận");
  };
  const doApprove = (b) => run(async () => { await approve({ id: b._id, venueId: id }).unwrap(); setBillOf(null); }, "Đã duyệt — khách nhận vé QR");
  const doReject = (b) => {
    const reason = window.prompt("Lý do từ chối bill (khách sẽ thấy):", "Chưa nhận được tiền / sai số tiền");
    if (reason === null) return;
    return run(async () => { await reject({ id: b._id, reason, venueId: id }).unwrap(); setBillOf(null); }, "Đã từ chối — khách được yêu cầu gửi lại");
  };
  const doCheckIn = (b) => run(() => checkIn({ token: b.ticket?.token, venueId: id }).unwrap(), "Đã check-in khách");

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/owner/venues/${id}`)}>Quản lý cụm sân</Button>
        <Button variant="outlined" startIcon={<BarChartIcon />} onClick={() => navigate(`/owner/venues/${id}/revenue`)}>Doanh thu</Button>
      </Stack>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>Lượt đặt — {venue?.name || ""}</Typography>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" type="date" label="Ngày" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} />
          </Grid>
          <Grid item xs={7} sm={4}>
            <TextField select fullWidth size="small" label="Trạng thái" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <MenuItem value="">Tất cả</MenuItem>
              {STATUS_OPTIONS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={5} sm={4}>
            <Stack alignItems="flex-end">
              <Typography variant="caption" color="text.secondary">Doanh thu đã thu</Typography>
              <Typography variant="h6" fontWeight={900} color="success.main">{fmtVND(stats.revenue)}</Typography>
            </Stack>
          </Grid>
        </Grid>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">{fmtDateLabel(date)} • {stats.count} lượt đặt</Typography>
          {stats.awaiting > 0 && <Chip size="small" color="info" label={`${stats.awaiting} bill chờ duyệt`} onClick={() => setStatusFilter("awaiting_approval")} />}
        </Stack>
      </Paper>

      {loading ? (
        <Stack spacing={1.5}>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 3 }} />)}</Stack>
      ) : items.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>Không có lượt đặt nào trong ngày này.</Box>
      ) : (
        <Stack spacing={1.5}>
          {items.map((b) => {
            const st = BOOKING_STATUS[b.status] || BOOKING_STATUS.pending;
            const pay = PAYMENT_STATUS[b.payment?.status] || PAYMENT_STATUS.Unpaid;
            const paid = b.payment?.status === "Paid";
            const hasBill = !!b.payment?.proofUrl;
            const awaiting = b.status === "awaiting_approval";
            const checkedIn = !!b.ticket?.checkedInAt;
            return (
              <Paper key={b._id} variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: awaiting ? "info.main" : undefined }}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={800}>{tLabel(b.startAt)}–{tLabel(b.endAt)}</Typography>
                      <Chip size="small" label={b.court?.name || "Sân"} />
                      <Chip size="small" variant="outlined" label={`#${b.code}`} />
                      <Chip size="small" color={st.color} label={st.label} />
                      <Chip size="small" color={pay.color} variant="outlined" label={pay.label} />
                      {checkedIn && <Chip size="small" color="success" icon={<CheckCircleIcon />} label={`Check-in ${dtLabel(b.ticket.checkedInAt)}`} />}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>
                      {b.customerName || b.user?.name || "Khách"}
                      {b.customerPhone || b.user?.phone ? ` • ${b.customerPhone || b.user?.phone}` : ""}
                      {" • "}<b>{fmtVND(b.totalPrice)}</b>
                    </Typography>
                    {b.note ? <Typography variant="caption" color="text.secondary">Ghi chú: {b.note}</Typography> : null}
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    {hasBill && (
                      <Badge color="info" variant="dot" invisible={!awaiting}>
                        <Button size="small" variant={awaiting ? "contained" : "outlined"} color="info" startIcon={<ReceiptLongIcon />} onClick={() => setBillOf(b)}>
                          {awaiting ? "Duyệt bill" : "Xem bill"}
                        </Button>
                      </Badge>
                    )}
                    {b.status === "confirmed" && !checkedIn && (
                      <Button size="small" variant="contained" color="success" startIcon={<HowToRegIcon />} disabled={checking} onClick={() => doCheckIn(b)}>Check-in</Button>
                    )}
                    <TextField select size="small" value={b.status} onChange={(e) => changeStatus(b, e.target.value)} sx={{ minWidth: 150 }}>
                      {STATUS_OPTIONS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                    </TextField>
                    <Button size="small" variant={paid ? "outlined" : "contained"} color={paid ? "inherit" : "success"} startIcon={paid ? <MoneyOffIcon /> : <PaidIcon />} onClick={() => togglePaid(b)}>
                      {paid ? "Bỏ xác nhận" : "Đã thu"}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* Dialog duyệt bill */}
      <Dialog open={!!billOf} onClose={() => setBillOf(null)} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogContent>
          {billOf && (
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={800}>Bill chuyển khoản · #{billOf.code}</Typography>
              <Typography variant="body2">
                {billOf.customerName || billOf.user?.name} · {tLabel(billOf.startAt)}–{tLabel(billOf.endAt)} · {billOf.court?.name} · <b>{fmtVND(billOf.totalPrice)}</b>
              </Typography>
              <Typography variant="caption" color="text.secondary">Gửi lúc {dtLabel(billOf.payment?.proofAt)}{billOf.payment?.proofNote ? ` · Ghi chú: ${billOf.payment.proofNote}` : ""}</Typography>
              <Box component="a" href={imgSrc(billOf.payment?.proofUrl)} target="_blank" rel="noreferrer">
                <Box component="img" src={imgSrc(billOf.payment?.proofUrl)} alt="bill" sx={{ width: "100%", maxHeight: 480, objectFit: "contain", borderRadius: 2, border: "1px solid", borderColor: "divider" }} />
              </Box>
              {billOf.payment?.rejectReason && <Typography variant="body2" color="error">Đã từ chối trước đó: {billOf.payment.rejectReason}</Typography>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setBillOf(null)} color="inherit">Đóng</Button>
          {billOf?.status === "awaiting_approval" && (
            <>
              <Button color="error" variant="outlined" disabled={rejecting} onClick={() => doReject(billOf)}>Từ chối</Button>
              <Button color="success" variant="contained" disabled={approving} onClick={() => doApprove(billOf)} sx={{ fontWeight: 700 }}>Duyệt — đã nhận tiền</Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Container>
  );
}
