/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  TextField,
  Alert,
  useTheme,
  alpha,
} from "@mui/material";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import EventBusyOutlinedIcon from "@mui/icons-material/EventBusyOutlined";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  useListMyBookingsQuery,
  useUpdateBookingStatusMutation,
  useSubmitPaymentProofMutation,
} from "../../slices/bookingsApiSlice";
import { useUploadImageToFolderMutation } from "../../slices/uploadApiSlice";
import { fmtVND, imgSrc, BOOKING_STATUS, PAYMENT_STATUS } from "./courtShared";
import TicketQr from "../../components/TicketQr.jsx";

const tz = { timeZone: "Asia/Bangkok" };
const dLabel = (iso) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", ...tz });
const tLabel = (iso) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", ...tz });
const dtLabel = (iso) => (iso ? `${dLabel(iso)} ${tLabel(iso)}` : "");

export default function MyBookingsPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useListMyBookingsQuery({});
  const [updateStatus, { isLoading: updating }] = useUpdateBookingStatusMutation();
  const [payBooking, setPayBooking] = useState(null); // dialog thanh toán + gửi bill
  const [ticketBooking, setTicketBooking] = useState(null); // dialog vé QR
  const items = useMemo(() => data || [], [data]);

  // Mở sẵn dialog thanh toán khi tới từ trang đặt (?booking=<id>)
  useEffect(() => {
    const id = params.get("booking");
    if (!id || !items.length) return;
    const b = items.find((x) => String(x._id) === id);
    if (b && ["pending", "awaiting_approval"].includes(b.status)) setPayBooking(b);
    else if (b && b.status === "confirmed") setTicketBooking(b);
    params.delete("booking");
    setParams(params, { replace: true });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đồng bộ dialog với dữ liệu mới (sau khi gửi bill)
  useEffect(() => {
    if (payBooking) {
      const fresh = items.find((x) => String(x._id) === String(payBooking._id));
      if (fresh && fresh !== payBooking) setPayBooking(fresh);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async (b) => {
    if (!window.confirm("Huỷ lượt đặt này?")) return;
    try {
      await updateStatus({ id: b._id, status: "cancelled", venueId: b.venue?._id }).unwrap();
      toast.success("Đã huỷ lượt đặt");
    } catch (e) {
      toast.error(e?.data?.message || "Huỷ thất bại");
    }
  };

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
            const canCancel = ["pending", "awaiting_approval", "confirmed"].includes(b.status);
            const needPay = ["pending", "awaiting_approval"].includes(b.status);
            const rejected = b.status === "pending" && !!b.payment?.rejectReason;
            const accent = accentOf(b.status);
            return (
              <Box key={b._id} sx={{ display: "flex", borderRadius: 4, overflow: "hidden", border: `1px solid ${theme.palette.divider}`, bgcolor: "background.paper" }}>
                <Box sx={{ width: { xs: 88, sm: 104 }, flexShrink: 0, p: 1.5, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", bgcolor: alpha(accent, 0.1), color: accent }}>
                  <Typography sx={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{dLabel(b.startAt)}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, mt: 0.5 }}>{tLabel(b.startAt)}</Typography>
                  <Typography sx={{ fontSize: 11, opacity: 0.8 }}>→ {tLabel(b.endAt)}</Typography>
                </Box>

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
                      {b.ticket?.checkedInAt && <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Đã check-in" />}
                    </Stack>
                    {rejected && (
                      <Alert severity="error" sx={{ mt: 1, py: 0 }}>Bill bị từ chối: {b.payment.rejectReason}. Vui lòng gửi lại.</Alert>
                    )}
                    {b.status === "pending" && b.holdExpiresAt && (
                      <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                        Giữ chỗ đến {tLabel(b.holdExpiresAt)} — chưa gửi bill sẽ tự huỷ.
                      </Alert>
                    )}
                  </Box>
                  <Stack direction={{ xs: "row", sm: "column" }} spacing={1} justifyContent="center" alignItems={{ sm: "flex-end" }}>
                    {needPay && (
                      <Button size="small" variant="contained" color={rejected ? "error" : "primary"} startIcon={<ReceiptLongIcon />} onClick={() => setPayBooking(b)} sx={{ fontWeight: 700, borderRadius: 2 }}>
                        {b.status === "awaiting_approval" ? "Xem bill đã gửi" : rejected ? "Gửi lại bill" : "Thanh toán & gửi bill"}
                      </Button>
                    )}
                    {b.status === "confirmed" && (
                      <Button size="small" variant="contained" color="success" startIcon={<ConfirmationNumberIcon />} onClick={() => setTicketBooking(b)} sx={{ fontWeight: 700, borderRadius: 2 }}>Vé QR</Button>
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

      <PayDialog booking={payBooking} onClose={() => setPayBooking(null)} />
      <TicketDialog booking={ticketBooking} onClose={() => setTicketBooking(null)} />
    </Container>
  );
}

/* ---------- Dialog: QR chuyển khoản + gửi bill ---------- */
function PayDialog({ booking: b, onClose }) {
  const theme = useTheme();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [note, setNote] = useState("");
  const [upload, { isLoading: uploading }] = useUploadImageToFolderMutation();
  const [submitProof, { isLoading: submitting }] = useSubmitPaymentProofMutation();

  useEffect(() => {
    setFile(null);
    setPreview("");
    setNote("");
  }, [b?._id]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) return toast.info("Chọn ảnh bill chuyển khoản trước");
    try {
      const up = await upload({ folder: "booking-bills", file, options: { format: "webp", width: 1280, height: 1280, quality: 82 } }).unwrap();
      const url = up?.url || up?.data?.url;
      if (!url) throw new Error("Tải ảnh thất bại");
      await submitProof({ id: b._id, imageUrl: url, note }).unwrap();
      toast.success("Đã gửi bill — chờ chủ sân duyệt");
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || e?.message || "Gửi bill thất bại");
    }
  };

  const bank = b?.bank || {};
  const awaiting = b?.status === "awaiting_approval";
  const busy = uploading || submitting;

  return (
    <Dialog open={!!b} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
      <DialogContent sx={{ pt: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight={800}>Thanh toán · #{b?.code}</Typography>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>

        {awaiting ? (
          <Alert severity="info" sx={{ mb: 1.5 }}>Bill đã gửi lúc {dtLabel(b?.payment?.proofAt)} — đang chờ chủ sân duyệt. Bạn có thể gửi lại ảnh khác nếu cần.</Alert>
        ) : (
          <Alert severity="warning" sx={{ mb: 1.5 }}>Chuyển khoản đúng số tiền &amp; nội dung, sau đó chụp bill gửi lên trong 15 phút — quá hạn đơn tự huỷ.</Alert>
        )}

        <Stack spacing={1.5} alignItems="center">
          {bank.qrUrl ? (
            <Box sx={{ p: 1.5, borderRadius: 4, border: `1px solid ${theme.palette.divider}`, bgcolor: "#fff" }}>
              <Box component="img" src={bank.qrUrl} alt="QR" sx={{ width: 200, height: 200, objectFit: "contain", display: "block" }} />
            </Box>
          ) : (
            <Typography variant="body2" color="warning.main">Sân chưa cấu hình tài khoản nhận tiền — liên hệ chủ sân.</Typography>
          )}
          <Box sx={{ px: 2, py: 1, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.07), width: "100%" }}>
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Số tiền</Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 900, color: "primary.main" }}>{fmtVND(bank.amount || b?.totalPrice)}</Typography>
            {bank.bankAccountNumber && (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {bank.bankShortName} · <b>{bank.bankAccountNumber}</b>{bank.bankAccountName ? ` · ${bank.bankAccountName}` : ""}
              </Typography>
            )}
            {bank.memo && <Typography variant="body2">Nội dung: <b>{bank.memo}</b></Typography>}
          </Box>

          {/* Bill hiện có */}
          {b?.payment?.proofUrl && !preview && (
            <Box component="img" src={imgSrc(b.payment.proofUrl)} alt="bill" sx={{ width: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 2, border: `1px solid ${theme.palette.divider}` }} />
          )}
          {preview && (
            <Box component="img" src={preview} alt="bill" sx={{ width: "100%", maxHeight: 240, objectFit: "contain", borderRadius: 2, border: `1px solid ${theme.palette.divider}` }} />
          )}
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} fullWidth sx={{ borderRadius: 2.5 }}>
            {file ? "Chọn ảnh khác" : "Chọn ảnh bill chuyển khoản"}
            <input hidden type="file" accept="image/*" onChange={pick} />
          </Button>
          <TextField size="small" fullWidth label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">Đóng</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !file} sx={{ fontWeight: 700, borderRadius: 2.5 }}>
          {busy ? "Đang gửi…" : awaiting ? "Gửi lại bill" : "Gửi bill"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------- Dialog: vé QR check-in ---------- */
function TicketDialog({ booking: b, onClose }) {
  const theme = useTheme();
  return (
    <Dialog open={!!b} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 4 } }}>
      <DialogContent sx={{ textAlign: "center", pt: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight={800}>Vé vào sân · #{b?.code}</Typography>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Stack>
        {b && (
          <Stack spacing={1.5} alignItems="center">
            <Box sx={{ p: 1.5, borderRadius: 4, border: `1px solid ${theme.palette.divider}`, bgcolor: "#fff" }}>
              <TicketQr token={b.ticket?.token} size={220} />
            </Box>
            <Typography fontWeight={800}>{b.venue?.name} · {b.court?.name}</Typography>
            <Typography color="text.secondary">{dLabel(b.startAt)} · {tLabel(b.startAt)} → {tLabel(b.endAt)}</Typography>
            {b.ticket?.checkedInAt ? (
              <Chip color="success" icon={<CheckCircleIcon />} label={`Đã check-in ${dtLabel(b.ticket.checkedInAt)}`} />
            ) : (
              <Typography variant="caption" color="text.secondary">Đưa mã QR này cho chủ sân quét khi đến sân.</Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button variant="contained" onClick={onClose} fullWidth startIcon={<QrCode2Icon />} sx={{ fontWeight: 700, borderRadius: 2.5 }}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
