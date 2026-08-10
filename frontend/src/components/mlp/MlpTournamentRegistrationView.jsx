// components/mlp/MlpTournamentRegistrationView.jsx
// Đăng ký thi đấu cho giải MLP — captain tạo team + thêm VĐV vào roster.
// BTC/admin duyệt team. Sau approve, captain chọn lineup cho từng sub-match
// trong trang chi tiết dual.
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Autocomplete,
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
  Divider,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add,
  Groups,
  Person,
  CheckCircle,
  Cancel,
  Shield,
  EmojiEvents,
  Login,
  ArrowForward,
  Delete,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useListMlpTeamsQuery,
  useCreateMlpTeamMutation,
  useUpdateMlpTeamMutation,
  useDeleteMlpTeamMutation,
} from "../../slices/mlpApiSlice";
import { useLazySearchUserQuery } from "../../slices/usersApiSlice";
import SEOHead from "../SEOHead";

export default function MlpTournamentRegistrationView({
  tournamentId,
  tour,
  me,
  canManage,
}) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);

  const {
    data: teamsResp,
    isLoading: teamsLoading,
    refetch: refetchTeams,
  } = useListMlpTeamsQuery({ tourId: tournamentId }, { skip: !tournamentId });
  const [createTeam, { isLoading: creatingLoading }] =
    useCreateMlpTeamMutation();
  const [updateTeam] = useUpdateMlpTeamMutation();
  const [deleteTeam] = useDeleteMlpTeamMutation();

  const teams = Array.isArray(teamsResp?.items) ? teamsResp.items : [];
  const cfg = tour?.mlpConfig || {};
  const minRoster = cfg.minRosterSize || 4;
  const maxRoster = cfg.maxRosterSize || 8;
  const slotsCfg = Array.isArray(cfg.slots) ? cfg.slots : [];

  const myTeam = useMemo(() => {
    if (!me?._id) return null;
    return (
      teams.find(
        (tm) => String(tm?.captain?._id || tm?.captain) === String(me._id),
      ) || null
    );
  }, [teams, me?._id]);

  const approvedCount = teams.filter((t) => t.status === "approved").length;
  const pendingCount = teams.filter((t) => t.status === "pending").length;

  const handleCreate = async (payload) => {
    try {
      await createTeam({ tourId: tournamentId, ...payload }).unwrap();
      toast.success("Đã tạo team");
      setCreating(false);
      refetchTeams();
    } catch (err) {
      toast.error(err?.data?.message || "Không tạo được team");
    }
  };
  const handleUpdate = async (id, payload) => {
    try {
      await updateTeam({ id, ...payload }).unwrap();
      toast.success("Đã lưu team");
      setEditing(null);
      refetchTeams();
    } catch (err) {
      toast.error(err?.data?.message || "Không lưu được");
    }
  };
  const handleDelete = async (id) => {
    if (!window.confirm("Xoá team này?")) return;
    try {
      await deleteTeam(id).unwrap();
      toast.success("Đã xoá team");
      refetchTeams();
    } catch (err) {
      toast.error(err?.data?.message || "Không xoá được");
    }
  };
  const handleApprove = async (id, next) => {
    try {
      await updateTeam({ id, status: next }).unwrap();
      toast.success(next === "approved" ? "Đã duyệt" : "Đã reject");
      refetchTeams();
    } catch (err) {
      toast.error(err?.data?.message || "Không cập nhật được");
    }
  };

  if (!me) {
    return (
      <Container maxWidth="sm" sx={{ py: 6, textAlign: "center" }}>
        <SEOHead title={`Đăng ký MLP · ${tour?.name || ""}`} />
        <Login sx={{ fontSize: 64, color: "text.disabled" }} />
        <Typography variant="h6" sx={{ mt: 2 }}>
          Đăng nhập để đăng ký MLP
        </Typography>
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={() => navigate("/login")}
        >
          Đăng nhập
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <SEOHead title={`Đăng ký MLP · ${tour?.name || ""}`} />

      {/* Header banner */}
      <Card
        sx={{
          mb: 3,
          borderRadius: 3,
          background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
          border: "1px solid #FCD34D",
        }}
      >
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Avatar sx={{ bgcolor: "#B45309", width: 56, height: 56 }}>
              <Shield fontSize="large" />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" fontWeight={900} sx={{ color: "#78350F" }}>
                Đăng ký giải MLP
              </Typography>
              <Typography variant="body2" sx={{ color: "#92400E" }}>
                Đội trưởng tạo team và mời VĐV (min {minRoster} · max{" "}
                {maxRoster}). BTC duyệt sau khi hoàn tất roster.
              </Typography>
            </Box>
            <Stack alignItems="flex-end">
              <Chip
                icon={<CheckCircle />}
                label={`${approvedCount} approved`}
                color="success"
                size="small"
                sx={{ mb: 0.5 }}
              />
              <Chip
                label={`${pendingCount} pending`}
                size="small"
                sx={{ bgcolor: "#fff", color: "#92400E" }}
              />
            </Stack>
          </Stack>

          {/* Slots info */}
          {slotsCfg.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" sx={{ color: "#78350F", fontWeight: 700 }}>
                Format: {slotsCfg.length} sub-match/dual · Tie-break DreamBreaker
              </Typography>
              <Stack
                direction="row"
                spacing={0.75}
                flexWrap="wrap"
                useFlexGap
                sx={{ mt: 0.75 }}
              >
                {slotsCfg.map((s) => (
                  <Chip
                    key={s.key}
                    size="small"
                    label={`${s.key} · ${s.label || s.matchType}`}
                    sx={{ bgcolor: "#fff", fontSize: 11, fontWeight: 700 }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        {!myTeam && (
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setCreating(true)}
            size="large"
            sx={{ bgcolor: "#F59E0B", "&:hover": { bgcolor: "#D97706" } }}
          >
            Tạo team của tôi
          </Button>
        )}
        <Button
          variant="outlined"
          startIcon={<EmojiEvents />}
          onClick={() => navigate(`/tournament/${tournamentId}/mlp/duals`)}
        >
          Xem dual matches
        </Button>
        <Button
          variant="outlined"
          startIcon={<Groups />}
          onClick={() => navigate(`/tournament/${tournamentId}/mlp/standings`)}
        >
          BXH
        </Button>
      </Stack>

      {/* My team */}
      {myTeam && (
        <Card sx={{ mb: 3, borderRadius: 3, border: "2px solid #10B981" }}>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start"
              sx={{ mb: 2 }}
            >
              <Box>
                <Typography variant="caption" color="success.main" fontWeight={700}>
                  TEAM CỦA BẠN
                </Typography>
                <Typography variant="h6" fontWeight={900}>
                  {myTeam.name}
                </Typography>
              </Box>
              <TeamStatusChip status={myTeam.status} />
            </Stack>
            <RosterList
              players={myTeam.players || []}
              slotsCfg={slotsCfg}
              minRoster={minRoster}
              maxRoster={maxRoster}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => setEditing(myTeam)}
                startIcon={<Groups />}
              >
                Chỉnh sửa roster
              </Button>
              {myTeam.status === "approved" && (
                <Button
                  variant="outlined"
                  color="success"
                  onClick={() =>
                    navigate(`/tournament/${tournamentId}/mlp/duals`)
                  }
                  endIcon={<ArrowForward />}
                >
                  Vào dual matches (chọn lineup)
                </Button>
              )}
              <Button
                variant="outlined"
                color="error"
                startIcon={<Delete />}
                onClick={() => handleDelete(myTeam._id)}
              >
                Xoá team
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* All teams list */}
      <Typography variant="h6" fontWeight={900} sx={{ mb: 2 }}>
        Danh sách teams đã đăng ký ({teams.length})
      </Typography>
      {teamsLoading ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : teams.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <Typography color="text.secondary">
              Chưa có team nào đăng ký. Là đội trưởng, bấm "Tạo team của tôi" để bắt đầu.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {teams.map((tm) => (
            <Grid item xs={12} md={6} key={tm._id}>
              <TeamCard
                team={tm}
                isMine={String(tm?.captain?._id || tm?.captain) === String(me?._id)}
                canManage={canManage}
                slotsCfg={slotsCfg}
                minRoster={minRoster}
                maxRoster={maxRoster}
                onApprove={(next) => handleApprove(tm._id, next)}
                onEdit={() => setEditing(tm)}
                onDelete={() => handleDelete(tm._id)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create/Edit dialog */}
      <TeamFormDialog
        open={creating}
        team={null}
        onClose={() => setCreating(false)}
        onSubmit={handleCreate}
        loading={creatingLoading}
        minRoster={minRoster}
        maxRoster={maxRoster}
      />
      <TeamFormDialog
        open={!!editing}
        team={editing}
        onClose={() => setEditing(null)}
        onSubmit={(payload) => handleUpdate(editing._id, payload)}
        minRoster={minRoster}
        maxRoster={maxRoster}
      />
    </Container>
  );
}

function TeamStatusChip({ status }) {
  if (status === "approved")
    return <Chip icon={<CheckCircle />} label="Đã duyệt" color="success" size="small" />;
  if (status === "rejected")
    return <Chip icon={<Cancel />} label="Từ chối" color="error" size="small" />;
  if (status === "withdrawn")
    return <Chip label="Đã rút" size="small" />;
  return <Chip label="Chờ duyệt" color="warning" size="small" />;
}

function RosterList({ players, minRoster, maxRoster }) {
  const count = players?.length || 0;
  const valid = count >= minRoster && count <= maxRoster;
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: valid ? "success.main" : "warning.main", fontWeight: 700 }}
      >
        Roster: {count}/{minRoster}-{maxRoster} VĐV
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {players.map((p) => (
          <Chip
            key={p._id}
            avatar={
              <Avatar src={p.avatar}>
                {(p.nickname || p.name || "?").charAt(0).toUpperCase()}
              </Avatar>
            }
            label={p.nickname || p.name}
            size="small"
            sx={{ bgcolor: p.gender === "female" ? "#FCE7F3" : "#DBEAFE" }}
          />
        ))}
      </Stack>
    </Box>
  );
}

function TeamCard({
  team,
  isMine,
  canManage,
  minRoster,
  maxRoster,
  onApprove,
  onEdit,
  onDelete,
}) {
  const canEdit = isMine || canManage;
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={800} noWrap>
              {team.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Captain: {team?.captain?.nickname || team?.captain?.name || "—"}
              {team?.shortName ? ` · ${team.shortName}` : ""}
            </Typography>
          </Box>
          <TeamStatusChip status={team.status} />
        </Stack>
        <Divider sx={{ my: 1 }} />
        <RosterList
          players={team.players || []}
          minRoster={minRoster}
          maxRoster={maxRoster}
        />

        {canEdit && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
            {isMine && (
              <Button size="small" variant="outlined" onClick={onEdit}>
                Chỉnh sửa
              </Button>
            )}
            {canManage && team.status === "pending" && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => onApprove("approved")}
                >
                  Duyệt
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => onApprove("rejected")}
                >
                  Từ chối
                </Button>
              </>
            )}
            {canManage && team.status === "approved" && (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => onApprove("pending")}
              >
                Đưa về chờ duyệt
              </Button>
            )}
            {canManage && (
              <IconButton size="small" color="error" onClick={onDelete}>
                <Delete fontSize="small" />
              </IconButton>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function TeamFormDialog({
  open,
  team,
  onClose,
  onSubmit,
  loading,
  minRoster,
  maxRoster,
}) {
  const isEdit = !!team;
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [players, setPlayers] = useState([]);
  const [searchQ, setSearchQ] = useState("");
  const [triggerSearch, { data: searchRes, isFetching }] =
    useLazySearchUserQuery();

  useEffect(() => {
    if (open) {
      setName(team?.name || "");
      setShortName(team?.shortName || "");
      setColor(team?.color || "#3B82F6");
      setPlayers(team?.players || []);
      setSearchQ("");
    }
  }, [open, team]);

  useEffect(() => {
    if (!searchQ || searchQ.length < 1) return;
    const t = setTimeout(() => triggerSearch(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ, triggerSearch]);

  const searchOptions = useMemo(() => {
    const list = Array.isArray(searchRes)
      ? searchRes
      : searchRes?.items || searchRes?.data || [];
    return list.slice(0, 20).filter(
      (u) => !players.some((p) => String(p._id) === String(u._id)),
    );
  }, [searchRes, players]);

  const removePlayer = (id) =>
    setPlayers((prev) => prev.filter((p) => String(p._id) !== String(id)));
  const addPlayer = (u) => {
    if (players.length >= maxRoster) {
      toast.warn(`Đã đạt tối đa ${maxRoster} VĐV`);
      return;
    }
    setPlayers((prev) => [...prev, u]);
  };

  const canSubmit =
    !!name.trim() &&
    players.length >= minRoster &&
    players.length <= maxRoster;

  const handleSubmit = () =>
    onSubmit({
      name: name.trim(),
      shortName: shortName.trim(),
      color,
      players: players.map((p) => String(p._id)),
    });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit ? "Chỉnh sửa team" : "Tạo team MLP"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Tên team"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            required
          />
          <TextField
            label="Tên viết tắt (2-4 ký tự)"
            value={shortName}
            onChange={(e) => setShortName(e.target.value.slice(0, 20))}
            fullWidth
            helperText="VD: TT1, LV..."
          />
          <TextField
            label="Màu chủ đạo"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            fullWidth
            placeholder="#3B82F6"
            helperText="Bấm vào ô màu để mở color picker"
            InputProps={{
              endAdornment: (
                <Box
                  component="label"
                  sx={{
                    position: "relative",
                    width: 32,
                    height: 32,
                    borderRadius: 1,
                    bgcolor: color,
                    border: "1px solid #ccc",
                    cursor: "pointer",
                    display: "inline-block",
                    flexShrink: 0,
                    "&:hover": { opacity: 0.85 },
                  }}
                >
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#3B82F6"}
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
          {/* Quick color presets */}
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
                  width: 26,
                  height: 26,
                  borderRadius: 1,
                  bgcolor: c,
                  cursor: "pointer",
                  border: color === c ? "2px solid #0F172A" : "1px solid #ccc",
                  "&:hover": { transform: "scale(1.1)" },
                }}
              />
            ))}
          </Stack>

          <Divider />

          <Box>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
              Roster ({players.length}/{minRoster}-{maxRoster})
            </Typography>
            <Autocomplete
              options={searchOptions}
              getOptionLabel={(u) => u?.nickname || u?.name || ""}
              value={null}
              inputValue={searchQ}
              onInputChange={(_, v) => setSearchQ(v)}
              onChange={(_, v) => {
                if (v) {
                  addPlayer(v);
                  setSearchQ("");
                }
              }}
              loading={isFetching}
              renderOption={(props, u) => (
                <Box component="li" {...props} key={u._id}>
                  <Avatar
                    src={u.avatar}
                    sx={{ width: 28, height: 28, mr: 1.5 }}
                  >
                    {(u.nickname || u.name || "?")[0]?.toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {u.nickname || u.name}
                    </Typography>
                    {u.name && u.nickname && (
                      <Typography variant="caption" color="text.secondary">
                        {u.name}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Tìm VĐV theo tên / nickname"
                  size="small"
                  placeholder="Nhập ít nhất 1 ký tự…"
                />
              )}
            />

            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              {players.map((p, idx) => (
                <Chip
                  key={p._id}
                  avatar={
                    <Avatar src={p.avatar}>
                      {(p.nickname || p.name || "?").charAt(0).toUpperCase()}
                    </Avatar>
                  }
                  label={`${idx + 1}. ${p.nickname || p.name}`}
                  onDelete={() => removePlayer(p._id)}
                  sx={{
                    bgcolor: p.gender === "female" ? "#FCE7F3" : "#DBEAFE",
                    fontWeight: 700,
                  }}
                />
              ))}
              {players.length === 0 && (
                <Typography variant="caption" color="text.disabled">
                  Chưa thêm VĐV nào — tìm ở ô phía trên.
                </Typography>
              )}
            </Stack>

            {players.length > 0 && players.length < minRoster && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                Cần thêm ít nhất {minRoster - players.length} VĐV nữa
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Huỷ</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
        >
          {loading ? "Đang lưu…" : isEdit ? "Lưu" : "Tạo team"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
