// src/screens/PlayPage.jsx — "Tìm bạn đánh" (danh sách kèo giao lưu)
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SportsTennisRoundedIcon from "@mui/icons-material/SportsTennisRounded";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import { PLAY_STATUS, formatPlayTime, skillLabel } from "../constants/play";
import {
  useListInvitesQuery,
  useCreateInviteMutation,
  useRequestJoinMutation,
} from "../slices/playApiSlice";

function InviteCard({ it, onJoin, joining, navigate }) {
  const st = PLAY_STATUS[it.status] || PLAY_STATUS.open;
  const canJoin = !it.isHost && it.myStatus === "none" && it.status === "open";
  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        transition: "border-color .2s, transform .2s",
        "&:hover": { borderColor: "primary.main", transform: "translateY(-2px)" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Avatar src={it.host?.avatar} sx={{ width: 40, height: 40 }}>
          {(it.host?.name || "?").charAt(0)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>
            {it.host?.nickname || it.host?.name}
          </Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>đăng kèo</Typography>
        </Box>
        <Chip size="small" label={st.label} sx={{ fontWeight: 700, color: "#fff", bgcolor: st.color }} />
      </Box>

      <Typography
        onClick={() => navigate(`/play/${it._id}`)}
        sx={{ fontWeight: 800, fontSize: 17, cursor: "pointer", "&:hover": { color: "primary.main" } }}
      >
        {it.title || it.courtName || "Kèo giao lưu pickleball"}
      </Typography>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, color: "text.secondary" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <AccessTimeRoundedIcon sx={{ fontSize: 17 }} />
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: "text.primary" }}>
            {formatPlayTime(it.playAt)}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <PlaceOutlinedIcon sx={{ fontSize: 17 }} />
          <Typography sx={{ fontSize: 13.5 }}>
            {[it.courtName, it.district, it.province].filter(Boolean).join(", ") || "—"}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Chip size="small" variant="outlined" label={skillLabel(it.skillMin, it.skillMax)} />
        <Chip
          size="small"
          icon={<GroupsRoundedIcon />}
          label={`${it.acceptedCount}/${it.slots} người · thiếu ${it.slotsLeft}`}
          sx={{ fontWeight: 600 }}
        />
      </Box>

      <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
        <Button variant="outlined" size="small" onClick={() => navigate(`/play/${it._id}`)}>
          Chi tiết
        </Button>
        {it.isHost ? (
          <Chip size="small" label={`Kèo của bạn${it.pendingCount ? ` · ${it.pendingCount} chờ duyệt` : ""}`} color="primary" variant="outlined" />
        ) : it.myStatus === "pending" ? (
          <Chip size="small" label="Đã xin — chờ duyệt" sx={{ bgcolor: "#fef3c7", color: "#92400e", fontWeight: 700 }} />
        ) : it.myStatus === "accepted" ? (
          <Chip size="small" label="✅ Đã tham gia" color="success" />
        ) : canJoin ? (
          <Button variant="contained" size="small" disabled={joining} onClick={() => onJoin(it)}>
            Xin tham gia
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

const EMPTY = {
  title: "",
  courtName: "",
  province: "",
  district: "",
  playAt: "",
  durationMin: 90,
  skillMin: "",
  skillMax: "",
  slots: 1,
  note: "",
  contactPhone: "",
};

export default function PlayPage() {
  const navigate = useNavigate();
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const [province, setProvince] = useState("");
  const [skill, setSkill] = useState("");
  const [page, setPage] = useState(1);
  const [mine, setMine] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const params = useMemo(() => {
    const p = { page, limit: 20 };
    if (mine) {
      p.mine = 1;
    } else {
      if (province) p.province = province;
      if (skill) p.skill = skill;
    }
    return p;
  }, [province, skill, page, mine]);

  const { data, isLoading, isFetching } = useListInvitesQuery(params);
  const [createInvite, { isLoading: creating }] = useCreateInviteMutation();
  const [requestJoin, { isLoading: joining }] = useRequestJoinMutation();
  const items = data?.items || [];

  const onJoin = async (it) => {
    if (!userInfo) return navigate("/login");
    try {
      await requestJoin({ id: it._id, note: "" }).unwrap();
      toast.success("Đã gửi yêu cầu tham gia — chờ chủ kèo duyệt");
    } catch (e) {
      toast.error(e?.data?.message || "Không gửi được yêu cầu");
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submitCreate = async () => {
    if (!form.playAt) return toast.info("Chọn thời gian chơi");
    try {
      const created = await createInvite(form).unwrap();
      toast.success("Đã đăng kèo!");
      setOpenCreate(false);
      setForm(EMPTY);
      navigate(`/play/${created._id}`);
    } catch (e) {
      toast.error(e?.data?.message || "Đăng kèo thất bại");
    }
  };

  return (
    <Box sx={{ bgcolor: "background.default", minHeight: "100vh", pb: 6 }}>
      <Box sx={{ background: "linear-gradient(120deg,#16a34a 0%,#15803d 60%,#0ea5e9 100%)", color: "#fff", pt: { xs: 3, md: 5 }, pb: { xs: 7, md: 8 }, px: 2 }}>
        <Container maxWidth="lg" sx={{ px: { xs: 0, sm: 2 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
            <Box>
              <Typography sx={{ fontWeight: 900, fontSize: { xs: 26, md: 34 }, display: "flex", alignItems: "center", gap: 1 }}>
                <SportsTennisRoundedIcon sx={{ fontSize: { xs: 28, md: 38 } }} /> Tìm bạn đánh
              </Typography>
              <Typography sx={{ opacity: 0.92, mt: 0.5, fontSize: { xs: 13, md: 15 } }}>
                Đăng kèo giao lưu · tìm người chơi cùng trình, gần bạn, đúng giờ
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => (userInfo ? setOpenCreate(true) : navigate("/login"))}
              sx={{ bgcolor: "#fff", color: "#16a34a", fontWeight: 800, "&:hover": { bgcolor: "#f1f5f9" } }}
            >
              Đăng kèo
            </Button>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ mt: { xs: -4, md: -5 } }}>
        {/* Tabs */}
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <Chip
            label="Khám phá"
            onClick={() => { setMine(false); setPage(1); }}
            color={!mine ? "primary" : "default"}
            sx={{ fontWeight: 700, bgcolor: !mine ? undefined : "background.paper" }}
          />
          <Chip
            label="Kèo của tôi"
            onClick={() => (userInfo ? (setMine(true), setPage(1)) : navigate("/login"))}
            color={mine ? "primary" : "default"}
            sx={{ fontWeight: 700, bgcolor: mine ? undefined : "background.paper" }}
          />
        </Box>

        {!mine && (
          <Box sx={{ display: "flex", gap: 1.5, mb: 2, flexWrap: "wrap", bgcolor: "background.paper", p: 1.5, borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
            <TextField
              size="small"
              label="Khu vực (Tỉnh/TP)"
              value={province}
              onChange={(e) => { setProvince(e.target.value); setPage(1); }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              size="small"
              label="Trình của bạn"
              type="number"
              value={skill}
              onChange={(e) => { setSkill(e.target.value); setPage(1); }}
              placeholder="VD: 3.0"
              sx={{ width: 140 }}
            />
          </Box>
        )}

        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", py: 8 }}><CircularProgress /></Box>
        ) : items.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
            <SportsTennisRoundedIcon sx={{ fontSize: 56, opacity: 0.4 }} />
            <Typography sx={{ mt: 1, fontWeight: 600 }}>Chưa có kèo nào phù hợp</Typography>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => (userInfo ? setOpenCreate(true) : navigate("/login"))} sx={{ mt: 2 }}>
              Đăng kèo đầu tiên
            </Button>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" } }}>
              {items.map((it) => (
                <InviteCard key={it._id} it={it} onJoin={onJoin} joining={joining} navigate={navigate} />
              ))}
            </Box>
            {data?.hasMore && (
              <Box sx={{ display: "grid", placeItems: "center", mt: 3 }}>
                <Button variant="outlined" disabled={isFetching} onClick={() => setPage((p) => p + 1)}>
                  {isFetching ? "Đang tải…" : "Xem thêm"}
                </Button>
              </Box>
            )}
          </>
        )}
      </Container>

      {/* Create dialog */}
      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Đăng kèo giao lưu</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <TextField label="Tiêu đề" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="VD: Giao lưu tối T5, cần 2 người" fullWidth />
            <TextField
              label="Thời gian chơi *"
              type="datetime-local"
              value={form.playAt}
              onChange={(e) => set("playAt", e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField label="Tên sân" value={form.courtName} onChange={(e) => set("courtName", e.target.value)} fullWidth />
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField label="Tỉnh/TP" value={form.province} onChange={(e) => set("province", e.target.value)} fullWidth />
              <TextField label="Quận/Huyện" value={form.district} onChange={(e) => set("district", e.target.value)} fullWidth />
            </Box>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField label="Trình từ" type="number" value={form.skillMin} onChange={(e) => set("skillMin", e.target.value)} sx={{ flex: 1 }} placeholder="2.5" />
              <TextField label="Trình đến" type="number" value={form.skillMax} onChange={(e) => set("skillMax", e.target.value)} sx={{ flex: 1 }} placeholder="3.5" />
              <TextField label="Cần thêm" type="number" value={form.slots} onChange={(e) => set("slots", e.target.value)} sx={{ flex: 1 }} />
            </Box>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField select label="Thời lượng" value={form.durationMin} onChange={(e) => set("durationMin", e.target.value)} sx={{ flex: 1 }}>
                {[60, 90, 120, 150, 180].map((m) => (
                  <MenuItem key={m} value={m}>{m} phút</MenuItem>
                ))}
              </TextField>
              <TextField label="SĐT liên hệ" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} sx={{ flex: 1 }} />
            </Box>
            <TextField label="Ghi chú" value={form.note} onChange={(e) => set("note", e.target.value)} multiline minRows={2} fullWidth placeholder="Mô tả thêm: sân số mấy, mang bóng, chi phí…" />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpenCreate(false)}>Huỷ</Button>
          <Button variant="contained" onClick={submitCreate} disabled={creating}>Đăng kèo</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
