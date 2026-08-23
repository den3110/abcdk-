// src/screens/PlayDetailPage.jsx — chi tiết kèo "Tìm bạn đánh"
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import PhoneRoundedIcon from "@mui/icons-material/PhoneRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import { PLAY_STATUS, formatPlayTime, skillLabel } from "../constants/play";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MenuItem from "@mui/material/MenuItem";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import {
  useGetInviteQuery,
  useRequestJoinMutation,
  useRespondJoinMutation,
  useLeaveInviteMutation,
  useDeleteInviteMutation,
  useUpdateInviteMutation,
} from "../slices/playApiSlice";
import { useCreateFeedPostMutation } from "../slices/feedApiSlice";

// Date -> "YYYY-MM-DDTHH:mm" (local) cho input datetime-local
function toLocalInput(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PlayDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: it, isLoading, refetch } = useGetInviteQuery(id);
  const [requestJoin, { isLoading: joining }] = useRequestJoinMutation();
  const [respondJoin] = useRespondJoinMutation();
  const [leaveInvite] = useLeaveInviteMutation();
  const [deleteInvite] = useDeleteInviteMutation();
  const [updateInvite, { isLoading: updating }] = useUpdateInviteMutation();
  const [createFeedPost, { isLoading: sharing }] = useCreateFeedPostMutation();
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({});
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  if (isLoading)
    return <Box sx={{ display: "grid", placeItems: "center", minHeight: "60vh" }}><CircularProgress /></Box>;
  if (!it)
    return (
      <Box sx={{ textAlign: "center", py: 10 }}>
        <Typography>Không tìm thấy kèo.</Typography>
        <Button onClick={() => navigate("/play")} sx={{ mt: 2 }}>Về Tìm bạn đánh</Button>
      </Box>
    );

  const st = PLAY_STATUS[it.status] || PLAY_STATUS.open;
  const pending = (it.participants || []).filter((p) => p.status === "pending");
  const accepted = (it.participants || []).filter((p) => p.status === "accepted");

  const onJoin = async () => {
    if (!userInfo) return navigate("/login");
    try {
      await requestJoin({ id: it._id, note }).unwrap();
      toast.success("Đã gửi yêu cầu — chờ chủ kèo duyệt");
      setNote("");
      refetch();
    } catch (e) {
      toast.error(e?.data?.message || "Không gửi được");
    }
  };
  const onLeave = async () => {
    try { await leaveInvite(it._id).unwrap(); refetch(); } catch {}
  };
  const respond = async (userId, action) => {
    try { await respondJoin({ id: it._id, userId, action }).unwrap(); refetch(); }
    catch (e) { toast.error(e?.data?.message || "Thất bại"); }
  };
  const onDelete = async () => {
    if (!window.confirm("Xoá kèo này?")) return;
    try { await deleteInvite(it._id).unwrap(); navigate("/play"); } catch {}
  };
  const openEdit = () => {
    setForm({
      title: it.title || "",
      courtName: it.courtName || "",
      province: it.province || "",
      district: it.district || "",
      playAt: toLocalInput(it.playAt),
      durationMin: it.durationMin || 90,
      skillMin: it.skillMin ?? "",
      skillMax: it.skillMax ?? "",
      slots: it.slots || 1,
      contactPhone: it.contactPhone || "",
      note: it.note || "",
      status: it.status,
    });
    setEditOpen(true);
  };
  const submitEdit = async () => {
    try {
      await updateInvite({ id: it._id, ...form }).unwrap();
      toast.success("Đã cập nhật kèo");
      setEditOpen(false);
      refetch();
    } catch (e) {
      toast.error(e?.data?.message || "Cập nhật thất bại");
    }
  };
  const handleShareToFeed = async () => {
    if (!userInfo) return navigate("/login");
    try {
      await createFeedPost({
        content: `🏓 Kèo giao lưu: ${it.title || it.courtName || "pickleball"}`,
        sharedPlay: {
          playId: it._id,
          title: it.title || it.courtName || "",
          courtName: it.courtName || "",
          province: it.province || "",
          playAt: it.playAt,
          skillMin: it.skillMin,
          skillMax: it.skillMax,
          slots: it.slots,
          acceptedCount: it.acceptedCount,
          hostName: it.host?.nickname || it.host?.name || "",
          status: it.status,
        },
      }).unwrap();
      toast.success("Đã chia sẻ kèo lên bảng tin");
    } catch (e) {
      toast.error(e?.data?.message || "Chia sẻ thất bại");
    }
  };

  const Person = ({ p, actions }) => (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75 }}>
      <Avatar src={p.user?.avatar} sx={{ width: 34, height: 34 }}>{(p.user?.name || "?").charAt(0)}</Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14 }} noWrap>{p.user?.nickname || p.user?.name}</Typography>
        {p.note && <Typography sx={{ fontSize: 12.5, color: "text.secondary" }} noWrap>“{p.note}”</Typography>}
      </Box>
      {actions}
    </Box>
  );

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate("/play")} sx={{ mb: 2 }}>
        Tìm bạn đánh
      </Button>

      <Box sx={{ p: 2.5, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
          <Avatar src={it.host?.avatar} sx={{ width: 48, height: 48 }}>{(it.host?.name || "?").charAt(0)}</Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>{it.host?.nickname || it.host?.name}</Typography>
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Chủ kèo</Typography>
          </Box>
          <Chip label={st.label} sx={{ fontWeight: 700, color: "#fff", bgcolor: st.color }} />
        </Box>

        <Typography sx={{ fontWeight: 900, fontSize: 22 }}>
          {it.title || it.courtName || "Kèo giao lưu pickleball"}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <AccessTimeRoundedIcon sx={{ color: "text.secondary" }} />
            <Typography sx={{ fontWeight: 700 }}>{formatPlayTime(it.playAt)} · {it.durationMin} phút</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PlaceOutlinedIcon sx={{ color: "text.secondary" }} />
            <Typography>{[it.courtName, it.district, it.province].filter(Boolean).join(", ") || "—"}</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Chip size="small" variant="outlined" label={skillLabel(it.skillMin, it.skillMax)} />
            <Chip size="small" icon={<GroupsRoundedIcon />} label={`${it.acceptedCount}/${it.slots} người · thiếu ${it.slotsLeft}`} />
          </Box>
          {it.contactPhone && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <PhoneRoundedIcon sx={{ color: "text.secondary" }} />
              <Typography component="a" href={`tel:${it.contactPhone}`} sx={{ color: "primary.main", fontWeight: 600 }}>
                {it.contactPhone}
              </Typography>
            </Box>
          )}
        </Box>

        {it.note && (
          <Typography sx={{ mt: 1.5, whiteSpace: "pre-wrap", color: "text.secondary" }}>{it.note}</Typography>
        )}

        {/* Actions */}
        <Box sx={{ mt: 2 }}>
          {it.isHost ? (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button variant="contained" startIcon={<EditRoundedIcon />} onClick={openEdit}>Sửa kèo</Button>
              <Button variant="outlined" color="error" onClick={onDelete}>Xoá kèo</Button>
            </Box>
          ) : it.myStatus === "accepted" ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip label="✅ Bạn đã tham gia" color="success" />
              <Button size="small" color="inherit" onClick={onLeave}>Rời kèo</Button>
            </Box>
          ) : it.myStatus === "pending" ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip label="Đang chờ chủ kèo duyệt" sx={{ bgcolor: "#fef3c7", color: "#92400e", fontWeight: 700 }} />
              <Button size="small" color="inherit" onClick={onLeave}>Huỷ yêu cầu</Button>
            </Box>
          ) : it.status === "open" ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
              <TextField size="small" placeholder="Lời nhắn cho chủ kèo (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ flex: 1, minWidth: 220 }} />
              <Button variant="contained" disabled={joining} onClick={onJoin}>Xin tham gia</Button>
            </Box>
          ) : (
            <Chip label="Kèo đã đóng / đủ người" />
          )}
        </Box>

        <Button
          fullWidth
          variant="outlined"
          startIcon={<CampaignRoundedIcon />}
          onClick={handleShareToFeed}
          disabled={sharing}
          sx={{ mt: 2 }}
        >
          {sharing ? "Đang chia sẻ…" : "Chia sẻ kèo lên bảng tin"}
        </Button>
      </Box>

      {/* Host: pending requests */}
      {it.isHost && pending.length > 0 && (
        <Box sx={{ mt: 2, p: 2, borderRadius: 3, border: "1px solid", borderColor: "warning.light", bgcolor: "background.paper" }}>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Yêu cầu chờ duyệt ({pending.length})</Typography>
          {pending.map((p) => (
            <Person
              key={String(p.user?._id || p.user)}
              p={p}
              actions={
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  <Button size="small" variant="contained" onClick={() => respond(p.user._id, "accept")}>Nhận</Button>
                  <Button size="small" color="inherit" onClick={() => respond(p.user._id, "decline")}>Từ chối</Button>
                </Box>
              }
            />
          ))}
        </Box>
      )}

      {/* Accepted players */}
      <Box sx={{ mt: 2, p: 2, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
        <Typography sx={{ fontWeight: 800, mb: 1 }}>Người tham gia ({accepted.length}/{it.slots})</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75 }}>
          <Avatar src={it.host?.avatar} sx={{ width: 34, height: 34 }}>{(it.host?.name || "?").charAt(0)}</Avatar>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{it.host?.nickname || it.host?.name}</Typography>
          <Chip size="small" label="Chủ kèo" color="primary" variant="outlined" sx={{ ml: "auto" }} />
        </Box>
        {accepted.map((p) => (
          <Person
            key={String(p.user?._id || p.user)}
            p={p}
            actions={it.isHost ? <Button size="small" color="inherit" onClick={() => respond(p.user._id, "decline")}>Bỏ</Button> : null}
          />
        ))}
        {accepted.length === 0 && <Typography sx={{ color: "text.secondary", fontSize: 14 }}>Chưa có ai được nhận.</Typography>}
      </Box>

      {/* Edit dialog (host) */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Sửa kèo</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <TextField label="Tiêu đề" value={form.title || ""} onChange={(e) => setF("title", e.target.value)} fullWidth />
            <TextField label="Thời gian chơi" type="datetime-local" value={form.playAt || ""} onChange={(e) => setF("playAt", e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="Tên sân" value={form.courtName || ""} onChange={(e) => setF("courtName", e.target.value)} fullWidth />
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField label="Tỉnh/TP" value={form.province || ""} onChange={(e) => setF("province", e.target.value)} fullWidth />
              <TextField label="Quận/Huyện" value={form.district || ""} onChange={(e) => setF("district", e.target.value)} fullWidth />
            </Box>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField label="Trình từ" type="number" value={form.skillMin ?? ""} onChange={(e) => setF("skillMin", e.target.value)} sx={{ flex: 1 }} />
              <TextField label="Trình đến" type="number" value={form.skillMax ?? ""} onChange={(e) => setF("skillMax", e.target.value)} sx={{ flex: 1 }} />
              <TextField label="Cần thêm" type="number" value={form.slots ?? 1} onChange={(e) => setF("slots", e.target.value)} sx={{ flex: 1 }} />
            </Box>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField select label="Trạng thái" value={form.status || "open"} onChange={(e) => setF("status", e.target.value)} sx={{ flex: 1 }}>
                {[["open", "Đang mở"], ["full", "Đủ người"], ["closed", "Đóng"], ["done", "Đã diễn ra"], ["cancelled", "Huỷ"]].map(([v, l]) => (
                  <MenuItem key={v} value={v}>{l}</MenuItem>
                ))}
              </TextField>
              <TextField label="SĐT liên hệ" value={form.contactPhone || ""} onChange={(e) => setF("contactPhone", e.target.value)} sx={{ flex: 1 }} />
            </Box>
            <TextField label="Ghi chú" value={form.note || ""} onChange={(e) => setF("note", e.target.value)} multiline minRows={2} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)}>Huỷ</Button>
          <Button variant="contained" onClick={submitEdit} disabled={updating}>Lưu</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
