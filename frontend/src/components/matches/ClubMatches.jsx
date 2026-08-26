/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Avatar,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import dayjs from "dayjs";
import {
  useListMembersQuery,
  useListMatchesQuery,
  useCreateMatchMutation,
  useDeleteMatchMutation,
  useClubLeaderboardQuery,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");
const teamNames = (t) => (t || []).map((u) => u?.nickname || u?.fullName || "?").join(" & ") || "?";

function RecordForm({ id, onDone }) {
  const { data: mem } = useListMembersQuery({ id });
  const members = mem?.items || [];
  const [createMatch, { isLoading }] = useCreateMatchMutation();
  const [a1, setA1] = useState("");
  const [a2, setA2] = useState("");
  const [b1, setB1] = useState("");
  const [b2, setB2] = useState("");
  const [sa, setSa] = useState("");
  const [sb, setSb] = useState("");
  const [note, setNote] = useState("");
  const chosen = [a1, a2, b1, b2].filter(Boolean).map(String);

  const sel = (label, val, setVal) => (
    <TextField select size="small" fullWidth label={label} value={val} onChange={(e) => setVal(e.target.value)}>
      <MenuItem value="">— chọn —</MenuItem>
      {members
        .filter((m) => m.user && (!chosen.includes(String(m.user._id)) || String(m.user._id) === val))
        .map((m) => (
          <MenuItem key={m.user._id} value={m.user._id}>{m.user.nickname || m.user.fullName || "Người dùng"}</MenuItem>
        ))}
    </TextField>
  );

  const submit = async () => {
    const teamA = [a1, a2].filter(Boolean);
    const teamB = [b1, b2].filter(Boolean);
    if (!teamA.length || !teamB.length) return toast.info("Chọn người cho cả 2 bên.");
    if (sa === "" || sb === "" || Number(sa) === Number(sb)) return toast.info("Nhập tỉ số hợp lệ (không hoà).");
    try {
      await createMatch({ id, teamA, teamB, scoreA: Number(sa), scoreB: Number(sb), note }).unwrap();
      toast.success("Đã ghi kết quả");
      onDone();
    } catch (e) { toast.error(getApiErrMsg(e)); }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Stack spacing={1} sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: "success.main", fontWeight: 700 }}>Bên A</Typography>
              {sel("Người 1", a1, setA1)}
              {sel("Người 2", a2, setA2)}
            </Stack>
            <Typography sx={{ fontWeight: 800, pt: 4 }}>VS</Typography>
            <Stack spacing={1} sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: "error.main", fontWeight: 700 }}>Bên B</Typography>
              {sel("Người 1", b1, setB1)}
              {sel("Người 2", b2, setB2)}
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center">
            <TextField size="small" value={sa} onChange={(e) => setSa(e.target.value.replace(/[^\d]/g, ""))} sx={{ width: 90 }} inputProps={{ style: { textAlign: "center" }, inputMode: "numeric" }} placeholder="0" />
            <Typography>-</Typography>
            <TextField size="small" value={sb} onChange={(e) => setSb(e.target.value.replace(/[^\d]/g, ""))} sx={{ width: 90 }} inputProps={{ style: { textAlign: "center" }, inputMode: "numeric" }} placeholder="0" />
          </Stack>
          <TextField size="small" label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={submit} disabled={isLoading}>Ghi kết quả</Button>
            <Button onClick={onDone}>Huỷ</Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function ClubMatches({ club, canManage }) {
  const id = club?._id;
  const isMember = !!club?._my?.isMember;
  const authIdA = useSelector((s) => s.auth?.userInfo?._id);
  const authIdB = useSelector((s) => s.user?.userInfo?._id);
  const authUserId = authIdA ?? authIdB ?? null;
  const [view, setView] = useState("board");
  const [showForm, setShowForm] = useState(false);

  const { data: lb } = useClubLeaderboardQuery({ id }, { skip: !id || view !== "board" });
  const { data: matchData, isLoading } = useListMatchesQuery({ id }, { skip: !id || view !== "matches" });
  const [deleteMatch] = useDeleteMatchMutation();

  const board = lb?.items || [];
  const matches = matchData?.items || [];

  const removeMatch = async (m) => {
    if (!window.confirm("Xoá trận này?")) return;
    try { await deleteMatch({ id, matchId: m._id }).unwrap(); } catch (e) { toast.error(getApiErrMsg(e)); }
  };

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup fullWidth size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
        <ToggleButton value="board">Bảng xếp hạng</ToggleButton>
        <ToggleButton value="matches">Trận đấu</ToggleButton>
      </ToggleButtonGroup>

      {view === "board" ? (
        <>
          <Typography variant="caption" color="text.secondary">Tổng số trận: {lb?.totalMatches || 0} · 3 điểm/trận thắng</Typography>
          {board.length === 0 ? (
            <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
              <EmojiEventsIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>Chưa có dữ liệu xếp hạng.</Typography>
            </Box>
          ) : (
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              {board.map((it, i) => (
                <Box key={it.user._id}>
                  {i > 0 && <Divider />}
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                    <Typography sx={{ width: 22, textAlign: "center", fontWeight: 800, color: i < 3 ? "warning.main" : "text.secondary" }}>{i + 1}</Typography>
                    <Avatar src={it.user.avatar} sx={{ width: 32, height: 32 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{it.user.nickname || it.user.fullName || "Người dùng"}</Typography>
                      <Typography variant="caption" color="text.secondary">{it.won}T-{it.lost}B · {it.winRate}%</Typography>
                    </Box>
                    <Typography sx={{ fontWeight: 800, color: "primary.main" }}>{it.points} đ</Typography>
                  </Stack>
                </Box>
              ))}
            </Card>
          )}
        </>
      ) : (
        <>
          {isMember && (showForm ? (
            <RecordForm id={id} onDone={() => setShowForm(false)} />
          ) : (
            <Box>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowForm(true)}>Ghi kết quả trận</Button>
            </Box>
          ))}
          {isLoading ? (
            <Typography color="text.secondary">Đang tải…</Typography>
          ) : matches.length === 0 ? (
            <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
              <EmojiEventsIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>Chưa có trận nào.</Typography>
            </Box>
          ) : (
            matches.map((m) => {
              const aWin = (m.scoreA || 0) > (m.scoreB || 0);
              const canDel = String(m.createdBy) === String(authUserId) || canManage;
              return (
                <Card key={m._id} variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography sx={{ flex: 1, textAlign: "right", fontWeight: aWin ? 800 : 500 }} variant="body2">{teamNames(m.teamA)}</Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography sx={{ fontWeight: 800, color: aWin ? "success.main" : "text.secondary" }}>{m.scoreA}</Typography>
                        <Typography color="text.secondary">-</Typography>
                        <Typography sx={{ fontWeight: 800, color: !aWin ? "error.main" : "text.secondary" }}>{m.scoreB}</Typography>
                      </Stack>
                      <Typography sx={{ flex: 1, fontWeight: !aWin ? 800 : 500 }} variant="body2">{teamNames(m.teamB)}</Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">{dayjs(m.playedAt).format("DD/MM/YYYY")}{m.note ? ` · ${m.note}` : ""}</Typography>
                      {canDel && <IconButton size="small" color="error" onClick={() => removeMatch(m)}><DeleteOutline fontSize="small" /></IconButton>}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })
          )}
        </>
      )}
    </Stack>
  );
}
