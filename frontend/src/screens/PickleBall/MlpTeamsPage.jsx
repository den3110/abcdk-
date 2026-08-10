// screens/PickleBall/MlpTeamsPage.jsx
// Quản lý team MLP: list + create + edit + approve.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Plus, Trash2, UserPlus, Check, X, Edit } from "lucide-react";
import { toast } from "react-toastify";

import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import {
  useListMlpTeamsQuery,
  useCreateMlpTeamMutation,
  useUpdateMlpTeamMutation,
  useDeleteMlpTeamMutation,
} from "../../slices/mlpApiSlice";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice";
import MlpConfigDialog from "../../components/mlp/MlpConfigDialog.jsx";

const STATUS_COLOR = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  withdrawn: "default",
};
const STATUS_LABEL = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  withdrawn: "Đã rút",
};

function TeamEditor({ open, onClose, team, tour, onSaved }) {
  const isEdit = !!team;
  const cfg = tour?.mlpConfig || {};
  const minRoster = cfg.minRosterSize || 4;
  const maxRoster = cfg.maxRosterSize || 8;

  const [name, setName] = useState(team?.name || "");
  const [shortName, setShortName] = useState(team?.shortName || "");
  const [color, setColor] = useState(team?.color || "#3B82F6");
  const [logo, setLogo] = useState(team?.logo || "");
  const [captain, setCaptain] = useState(team?.captain || null);
  const [players, setPlayers] = useState(team?.players || []);
  const [q, setQ] = useState("");

  // Reset form khi mở dialog (edit) — trước đó state chỉ init 1 lần,
  // nên "Sửa team" hiển thị form rỗng dù team đã có sẵn dữ liệu.
  useEffect(() => {
    if (!open) return;
    setName(team?.name || "");
    setShortName(team?.shortName || "");
    setColor(team?.color || "#3B82F6");
    setLogo(team?.logo || "");
    setCaptain(team?.captain || null);
    setPlayers(Array.isArray(team?.players) ? team.players : []);
    setQ("");
  }, [open, team?._id]);
  const [searchTrigger, { data: searchData = [], isFetching: searching }] =
    useLazySearchUserQuery();
  const [create, { isLoading: creating }] = useCreateMlpTeamMutation();
  const [update, { isLoading: updating }] = useUpdateMlpTeamMutation();

  const busy = creating || updating;

  // Debounce search: gõ 350ms mới gọi API, tránh spam.
  // API nhận STRING (không phải object), response là ARRAY.
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return;
    const timer = setTimeout(() => {
      searchTrigger(s);
    }, 350);
    return () => clearTimeout(timer);
  }, [q, searchTrigger]);

  const searchResults = useMemo(() => {
    if (!Array.isArray(searchData)) return [];
    // Ẩn user đã có trong roster
    const inRoster = new Set(players.map((p) => String(p._id || p)));
    return searchData.filter((u) => !inRoster.has(String(u._id)));
  }, [searchData, players]);

  const addPlayer = (user) => {
    if (!user?._id) return;
    if (players.some((p) => String(p._id || p) === String(user._id))) return;
    setPlayers([...players, user]);
    if (!captain) setCaptain(user);
    setQ(""); // clear để tìm VĐV tiếp theo
  };
  const removePlayer = (id) =>
    setPlayers(players.filter((p) => String(p._id || p) !== String(id)));

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Nhập tên team");
      return;
    }
    if (!captain?._id) {
      toast.error("Chọn captain");
      return;
    }
    if (players.length < minRoster) {
      toast.error(`Roster tối thiểu ${minRoster} VĐV`);
      return;
    }
    if (players.length > maxRoster) {
      toast.error(`Roster tối đa ${maxRoster} VĐV`);
      return;
    }
    const body = {
      name: name.trim(),
      shortName: shortName.trim(),
      color: color.trim(),
      logo: logo.trim(),
      captain: captain._id,
      players: players.map((p) => p._id || p),
    };
    try {
      if (isEdit) {
        await update({ id: team._id, ...body }).unwrap();
        toast.success("Đã cập nhật team");
      } else {
        await create({ tourId: tour._id, ...body }).unwrap();
        toast.success("Đã tạo team");
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err?.data?.message || "Lỗi");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? "Sửa team" : "Tạo team MLP"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Roster {minRoster}-{maxRoster} VĐV. Captain sẽ tự động vào roster.
          </Alert>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Tên team *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label="Tên tắt"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              sx={{ width: 120 }}
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Màu chủ đạo"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              sx={{ width: 190 }}
              placeholder="#0066FF"
              InputProps={{
                endAdornment: (
                  <Box
                    component="label"
                    sx={{
                      position: "relative",
                      width: 28,
                      height: 28,
                      borderRadius: 1,
                      bgcolor: color || "#E2E8F0",
                      border: "1px solid #ccc",
                      cursor: "pointer",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  >
                    <input
                      type="color"
                      value={
                        /^#[0-9a-f]{6}$/i.test(color) ? color : "#3B82F6"
                      }
                      onChange={(e) => setColor(e.target.value)}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        opacity: 0,
                        cursor: "pointer",
                        border: 0,
                        padding: 0,
                      }}
                    />
                  </Box>
                ),
              }}
            />
            <TextField
              size="small"
              label="Logo URL"
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {[
              "#3B82F6",
              "#EF4444",
              "#10B981",
              "#F59E0B",
              "#8B5CF6",
              "#EC4899",
              "#0EA5E9",
              "#22C55E",
              "#F97316",
              "#0F172A",
            ].map((c) => (
              <Box
                key={c}
                onClick={() => setColor(c)}
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: 1,
                  bgcolor: c,
                  cursor: "pointer",
                  border: color === c ? "2px solid #0F172A" : "1px solid #ccc",
                  "&:hover": { transform: "scale(1.1)" },
                }}
              />
            ))}
          </Stack>

          <Typography variant="body2" fontWeight={700}>
            Roster ({players.length}/{maxRoster})
          </Typography>

          <Box sx={{ position: "relative" }}>
            <TextField
              size="small"
              label="Tìm VĐV theo tên / biệt danh / SĐT"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Gõ tối thiểu 2 ký tự..."
              fullWidth
              InputProps={{
                endAdornment: searching ? (
                  <CircularProgress size={16} />
                ) : null,
              }}
            />
            {q.trim().length >= 2 && (
              <Box
                sx={{
                  mt: 0.5,
                  maxHeight: 240,
                  overflow: "auto",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "background.paper",
                }}
              >
                {searching && searchResults.length === 0 ? (
                  <Box sx={{ p: 1.5, textAlign: "center" }}>
                    <CircularProgress size={18} />
                  </Box>
                ) : searchResults.length === 0 ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", p: 1.5, textAlign: "center" }}
                  >
                    Không tìm thấy VĐV. Thử tên / biệt danh / SĐT khác.
                  </Typography>
                ) : (
                  searchResults.slice(0, 10).map((u) => (
                    <Stack
                      key={u._id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{
                        p: 1,
                        cursor: "pointer",
                        borderBottom: 1,
                        borderColor: "divider",
                        "&:hover": { bgcolor: "action.hover" },
                        "&:last-of-type": { borderBottom: 0 },
                      }}
                      onClick={() => addPlayer(u)}
                    >
                      <Avatar
                        src={u.avatar || ""}
                        sx={{ width: 36, height: 36 }}
                      >
                        {(u.nickname || u.name || "?")[0]?.toUpperCase()}
                      </Avatar>
                      <Box flex={1} minWidth={0}>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          noWrap
                        >
                          {u.name || u.nickname || "—"}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: "flex",
                            gap: 0.75,
                            flexWrap: "wrap",
                          }}
                        >
                          {u.nickname && <span>@{u.nickname}</span>}
                          {u.phone && <span>· {u.phone}</span>}
                          {u.gender && <span>· {u.gender}</span>}
                        </Typography>
                      </Box>
                      <UserPlus size={18} />
                    </Stack>
                  ))
                )}
              </Box>
            )}
          </Box>

          <Stack spacing={0.5}>
            {players.map((p) => {
              const id = p._id || p;
              const isCap = String(captain?._id) === String(id);
              return (
                <Stack
                  key={id}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    p: 0.75,
                    border: 1,
                    borderColor: isCap ? "warning.main" : "divider",
                    borderRadius: 1,
                  }}
                >
                  <Avatar src={p.avatar || ""} sx={{ width: 28, height: 28 }}>
                    {(p.nickname || p.name || "?")[0]?.toUpperCase()}
                  </Avatar>
                  <Box flex={1} minWidth={0}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {p.name || p.nickname}
                      {isCap && (
                        <Chip
                          size="small"
                          label="C"
                          color="warning"
                          sx={{ ml: 0.5, height: 16, fontSize: 10 }}
                        />
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {p.gender || "—"}
                    </Typography>
                  </Box>
                  {!isCap && (
                    <Tooltip title="Đặt làm captain">
                      <IconButton
                        size="small"
                        onClick={() => setCaptain(p)}
                      >
                        C
                      </IconButton>
                    </Tooltip>
                  )}
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => removePlayer(id)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </Stack>
              );
            })}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Huỷ
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={busy}>
          {busy ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo team"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MlpTeamsPage() {
  const { id } = useParams();
  const viewer = useSelector((s) => s.auth?.userInfo);
  const [statusFilter, setStatusFilter] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTeamMut] = useDeleteMlpTeamMutation();
  const [updateTeamMut] = useUpdateMlpTeamMutation();

  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);
  const { data: teamsData, isFetching: teamsLoading } = useListMlpTeamsQuery(
    { tourId: id, status: statusFilter || undefined },
    { skip: !id },
  );

  const isMlp = tour?.tournamentMode === "mlp";
  const isAdmin = !!(
    viewer?.isAdmin || viewer?.role === "admin" || viewer?.isSuperUser
  );
  const isManager = useMemo(() => {
    if (!viewer?._id || !tour) return false;
    if (String(tour.createdBy) === String(viewer._id)) return true;
    return (tour.managers || []).some(
      (m) => String(m?.user ?? m) === String(viewer._id),
    );
  }, [viewer, tour]);
  const canManage = isAdmin || isManager;
  const items = teamsData?.items || [];
  const myTeam = useMemo(() => {
    if (!viewer?._id) return null;
    return (
      items.find(
        (tm) => String(tm?.captain?._id || tm?.captain) === String(viewer._id),
      ) || null
    );
  }, [items, viewer?._id]);
  const canCreateTeam = canManage || !myTeam;
  const isOwnTeam = (team) =>
    String(team?.captain?._id || team?.captain) === String(viewer?._id || "");

  const handleDelete = async (team) => {
    if (!window.confirm(`Xoá team "${team.name}"?`)) return;
    try {
      await deleteTeamMut(team._id).unwrap();
      toast.success("Đã xoá");
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };
  const handleSetStatus = async (team, status) => {
    try {
      await updateTeamMut({ id: team._id, status }).unwrap();
      toast.success("Đã cập nhật trạng thái");
    } catch (err) {
      toast.error(err?.data?.message || "Lỗi");
    }
  };

  if (tourLoading) {
    return (
      <Container sx={{ py: 6, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }
  if (!isMlp) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          Giải này không ở chế độ MLP. Cần đổi <b>tournamentMode = "mlp"</b>{" "}
          trong cài đặt giải trước.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1.5}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={900}>
            MLP Teams · {tour?.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Quản lý team đăng ký giải MLP. Roster{" "}
            {tour?.mlpConfig?.minRosterSize || 4}–
            {tour?.mlpConfig?.maxRosterSize || 8} VĐV.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {canManage && (
            <Button
              variant="outlined"
              onClick={() => setConfigOpen(true)}
            >
              Cấu hình MLP
            </Button>
          )}
          {canCreateTeam && (
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => {
                setEditTarget(null);
                setEditorOpen(true);
              }}
            >
              Tạo team
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }} useFlexGap>
        {["", "pending", "approved", "rejected", "withdrawn"].map((s) => (
          <Chip
            key={s}
            label={s ? STATUS_LABEL[s] : `Tất cả (${items.length})`}
            color={s === statusFilter ? "primary" : "default"}
            variant={s === statusFilter ? "filled" : "outlined"}
            onClick={() => setStatusFilter(s)}
            size="small"
          />
        ))}
      </Stack>

      {teamsLoading && !items.length ? (
        <Box textAlign="center" py={4}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            Chưa có team nào. Bấm "Tạo team" để bắt đầu.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {items.map((team) => (
            <Card key={team._id} variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Avatar
                    src={team.logo}
                    sx={{
                      width: 48,
                      height: 48,
                      bgcolor: team.color || "primary.main",
                      fontWeight: 800,
                    }}
                  >
                    {team.shortName || team.name?.[0]?.toUpperCase()}
                  </Avatar>
                  <Box flex={1} minWidth={0}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="h6" fontWeight={800}>
                        {team.name}
                      </Typography>
                      <Chip
                        size="small"
                        color={STATUS_COLOR[team.status]}
                        label={STATUS_LABEL[team.status] || team.status}
                      />
                      {team.payment?.status === "paid" && (
                        <Chip size="small" color="success" label="Đã thanh toán" variant="outlined" />
                      )}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Captain: {team.captain?.name || team.captain?.nickname} ·{" "}
                      Roster: {team.players?.length || 0} VĐV
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {(team.players || []).slice(0, 8).map((p) => (
                        <Chip
                          key={p._id}
                          size="small"
                          avatar={<Avatar src={p.avatar || ""}>{(p.nickname || p.name || "?")[0]}</Avatar>}
                          label={p.nickname || p.name}
                          variant="outlined"
                        />
                      ))}
                      {team.players?.length > 8 && (
                        <Chip size="small" label={`+${team.players.length - 8}`} />
                      )}
                    </Stack>
                  </Box>
                  <Stack spacing={0.5}>
                    {canManage && team.status === "pending" && (
                      <>
                        <Tooltip title="Duyệt">
                          <IconButton
                            size="small"
                            color="success"
                            onClick={() => handleSetStatus(team, "approved")}
                          >
                            <Check size={16} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Từ chối">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleSetStatus(team, "rejected")}
                          >
                            <X size={16} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    {(canManage || isOwnTeam(team)) && (
                      <Tooltip title="Sửa">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditTarget(team);
                            setEditorOpen(true);
                          }}
                        >
                          <Edit size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {(canManage || isOwnTeam(team)) && (
                      <Tooltip title="Xoá">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(team)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <TeamEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditTarget(null);
        }}
        team={editTarget}
        tour={tour}
      />
      <MlpConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        tour={tour}
      />
    </Container>
  );
}
