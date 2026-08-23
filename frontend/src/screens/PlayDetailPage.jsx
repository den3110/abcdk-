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
import {
  useGetInviteQuery,
  useRequestJoinMutation,
  useRespondJoinMutation,
  useLeaveInviteMutation,
  useDeleteInviteMutation,
} from "../slices/playApiSlice";

export default function PlayDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const { data: it, isLoading, refetch } = useGetInviteQuery(id);
  const [requestJoin, { isLoading: joining }] = useRequestJoinMutation();
  const [respondJoin] = useRespondJoinMutation();
  const [leaveInvite] = useLeaveInviteMutation();
  const [deleteInvite] = useDeleteInviteMutation();
  const [note, setNote] = useState("");

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
            <Box sx={{ display: "flex", gap: 1 }}>
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
    </Container>
  );
}
