/* eslint-disable react/prop-types */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  Paper,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ConfirmationNumberIcon from "@mui/icons-material/ConfirmationNumber";
import GroupsIcon from "@mui/icons-material/Groups";
import {
  useGetEventQuery,
  useRegisterEventMutation,
} from "../slices/eventsApiSlice";
import { imgSrc } from "./courts/courtShared";

const vnd = (n) => (Number(n) > 0 ? `${Number(n).toLocaleString("vi-VN")}đ` : "Miễn phí");
const dt = (x) =>
  x ? new Date(x).toLocaleString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const GENDER = { male: "Chỉ nam", female: "Chỉ nữ", balanced: "Cân bằng nam/nữ" };

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: ev, isLoading, refetch } = useGetEventQuery(id, { skip: !id });
  const [register, { isLoading: registering }] = useRegisterEventMutation();

  const [proofNote] = useState("");

  if (isLoading) {
    return (
      <Container maxWidth="md" sx={{ py: 6, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }
  if (!ev) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Alert severity="error">Không tìm thấy sự kiện.</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate("/feed")}>Về bảng tin</Button>
      </Container>
    );
  }

  const cover = imgSrc(ev.coverImage || ev.venue?.images?.[0] || "");
  const stats = ev.stats || {};
  const registered = stats.registered || 0;
  const full = registered >= ev.capacity;
  const cancelled = ev.status === "cancelled";
  const started = new Date(ev.startAt).getTime() < Date.now();
  const my = ev.myRegistration;
  const bank = my?.bank || {};
  const needPay = my && my.payment?.status !== "Paid" && ev.paymentMode === "online" && ev.price > 0;
  const skill = ev.skillMin || ev.skillMax ? `Trình ${ev.skillMin || 0}${ev.skillMax ? `–${ev.skillMax}` : "+"}` : "Mọi trình";

  const doRegister = async () => {
    if (!userInfo) {
      navigate("/login");
      return;
    }
    try {
      await register({ eventId: id }).unwrap();
      toast.success(ev.price > 0 && ev.paymentMode === "online" ? "Đã đăng ký — vui lòng chuyển khoản để giữ suất." : "Đã đăng ký. Hẹn gặp bạn tại sự kiện!");
      refetch();
    } catch (e) {
      toast.error(e?.data?.message || "Không đăng ký được.");
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 1.5, color: "text.secondary", fontWeight: 600 }}>
        Quay lại
      </Button>

      {/* Hero */}
      <Box sx={{ position: "relative", borderRadius: 4, overflow: "hidden", mb: 2.5, aspectRatio: "16 / 9", bgcolor: "action.hover" }}>
        {cover ? (
          <Box component="img" src={cover} alt={ev.title} sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ width: "100%", height: "100%", display: "grid", placeItems: "center", bgcolor: "#e11d48", color: "#fff", fontSize: 48 }}>🎟️</Box>
        )}
        <Box sx={{ position: "absolute", top: 12, left: 12 }}>
          <Chip label="🎟️ Sự kiện xé vé · Social" sx={{ bgcolor: "#e11d48", color: "#fff", fontWeight: 700 }} />
        </Box>
      </Box>

      <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: "-0.02em" }}>{ev.title}</Typography>

      <Stack spacing={1} sx={{ mt: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center"><AccessTimeIcon fontSize="small" color="action" /><Typography>{dt(ev.startAt)}{ev.endAt ? ` → ${dt(ev.endAt)}` : ""}</Typography></Stack>
        <Stack direction="row" spacing={1} alignItems="center"><PlaceOutlinedIcon fontSize="small" color="action" /><Typography>{[ev.venue?.name, ev.venue?.address].filter(Boolean).join(" · ") || "—"}</Typography></Stack>
        {Array.isArray(ev.courts) && ev.courts.length > 0 && (
          <Stack direction="row" spacing={1} alignItems="center"><GroupsIcon fontSize="small" color="action" /><Typography>Sân: {ev.courts.map((c) => c.name).join(", ")}</Typography></Stack>
        )}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap" }} useFlexGap>
        <Chip variant="outlined" label={`${registered}/${ev.capacity} suất`} />
        <Chip variant="outlined" color={ev.price > 0 ? "primary" : "success"} label={vnd(ev.price)} />
        <Chip variant="outlined" label={skill} />
        {GENDER[ev.genderPolicy] && <Chip variant="outlined" label={GENDER[ev.genderPolicy]} />}
      </Stack>

      {ev.description && (
        <Typography sx={{ mt: 2, whiteSpace: "pre-wrap", color: "text.secondary" }}>{ev.description}</Typography>
      )}

      <Divider sx={{ my: 3 }} />

      {cancelled ? (
        <Alert severity="warning">Sự kiện đã bị huỷ.</Alert>
      ) : my ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <ConfirmationNumberIcon color="success" />
            <Typography fontWeight={800}>Bạn đã đăng ký</Typography>
            <Chip size="small" color={my.payment?.status === "Paid" ? "success" : "warning"} label={my.payment?.status === "Paid" ? "Đã thanh toán" : "Chờ thanh toán"} sx={{ ml: "auto" }} />
          </Stack>
          {my.code && <Typography variant="body2" color="text.secondary">Mã vé: <b>{my.code}</b></Typography>}
          {needPay && bank.qrUrl && (
            <Box sx={{ mt: 2, textAlign: "center" }}>
              <Typography variant="body2" sx={{ mb: 1 }}>Quét mã để chuyển khoản giữ suất:</Typography>
              <Box component="img" src={bank.qrUrl} alt="QR" sx={{ width: 220, height: 220, borderRadius: 2, bgcolor: "#fff" }} />
              <Typography variant="body2" sx={{ mt: 1 }}>{bank.bankShortName} · {bank.bankAccountNumber}</Typography>
              <Typography variant="body2" color="text.secondary">{bank.bankAccountName}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>Số tiền: <b>{vnd(bank.amount)}</b> · Nội dung: <b>{bank.memo}</b></Typography>
              <Alert severity="info" sx={{ mt: 2, textAlign: "left" }}>Sau khi chuyển khoản, mở app PickleTour để gửi ảnh bill cho chủ sân duyệt.</Alert>
            </Box>
          )}
        </Paper>
      ) : started ? (
        <Alert severity="info">Sự kiện đã bắt đầu hoặc kết thúc, không thể đăng ký.</Alert>
      ) : full ? (
        <Alert severity="warning">Sự kiện đã đủ suất.</Alert>
      ) : (
        <Button variant="contained" size="large" fullWidth disabled={registering} onClick={doRegister} sx={{ fontWeight: 800, borderRadius: 3, py: 1.5, bgcolor: "#e11d48", "&:hover": { bgcolor: "#be123c" } }}>
          {registering ? "Đang đăng ký…" : userInfo ? "Đăng ký tham gia" : "Đăng nhập để đăng ký"}
        </Button>
      )}
    </Container>
  );
}
