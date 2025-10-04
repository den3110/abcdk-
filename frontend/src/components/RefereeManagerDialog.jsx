import { Alert, Avatar, Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Grid, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect } from "react";
import { useState } from "react";
import { useListTournamentRefereesQuery, useUpsertTournamentRefereesMutation } from "../slices/refereeScopeApiSlice";
import { useAdminSearchRefereesQuery } from "../slices/tournamentsApiSlice";
import { toast } from "react-toastify";
import ResponsiveModal from "./ResponsiveModal";
import {
  HowToReg as RefereeIcon,
  PersonSearch as PersonSearchIcon,
  Add as AddIcon,
  RemoveCircleOutline as RemoveIcon,
} from "@mui/icons-material";


const personNickname = (p) =>
  p?.nickname ||
  p?.nickName ||
  p?.nick ||
  p?.displayName ||
  p?.fullName ||
  p?.name ||
  "—";


export default function ManageRefereesDialog({ open, tournamentId, onClose, onChanged }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const {
    data: assigned = [],
    isLoading: loadingAssigned,
    refetch: refetchAssigned,
  } = useListTournamentRefereesQuery(
    { tid: tournamentId, q: "" },
    { skip: !open || !tournamentId }
  );

  const { data: candidates = [], isLoading: loadingSearch } =
    useAdminSearchRefereesQuery(
      { tid: tournamentId, q: debouncedQ },
      { skip: !open || !tournamentId }
    );

  const [upsert, { isLoading: saving }] = useUpsertTournamentRefereesMutation();

  const handleAdd = async (userId) => {
    try {
      await upsert({ tid: tournamentId, add: [userId] }).unwrap();
      toast.success("Đã thêm trọng tài vào giải");
      refetchAssigned?.();
      onChanged?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Thêm trọng tài thất bại");
    }
  };

  const handleRemove = async (userId) => {
    try {
      await upsert({ tid: tournamentId, remove: [userId] }).unwrap();
      toast.success("Đã bỏ trọng tài khỏi giải");
      refetchAssigned?.();
      onChanged?.();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Bỏ trọng tài thất bại");
    }
  };

  const isAssigned = (id) =>
    (assigned || []).some((u) => String(u._id) === String(id));

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      icon={<RefereeIcon fontSize="small" />}
      title={
        <Stack direction="row" alignItems="center" spacing={1}>
          <span>Quản lý trọng tài của giải</span>
        </Stack>
      }
      actions={<Button onClick={onClose}>Đóng</Button>}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} md={5} sx={{ width: isMobile ? "100%" : "auto" }}>
          <Card variant="outlined">
            <CardHeader title="Đang là trọng tài" />
            <Divider />
            <CardContent sx={{ pt: 1 }}>
              {loadingAssigned ? (
                <Box textAlign="center" py={2}>
                  <CircularProgress size={22} />
                </Box>
              ) : (assigned?.length || 0) === 0 ? (
                <Alert severity="info">Chưa có trọng tài nào.</Alert>
              ) : (
                <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                  {assigned.map((u) => (
                    <Stack
                      key={u._id}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{
                        py: 0.75,
                        px: 1.25,
                        borderRadius: 1,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <Avatar sx={{ width: 28, height: 28 }}>
                          {(personNickname(u)[0] || "U").toUpperCase()}
                        </Avatar>
                        <Typography variant="body2">
                          {personNickname(u)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {u?.email || u?.phone || ""}
                        </Typography>
                      </Stack>
                      <Tooltip title="Bỏ khỏi giải" arrow>
                        <span>
                          <IconButton
                            edge="end"
                            onClick={() => handleRemove(u._id)}
                            disabled={saving}
                            size="small"
                          >
                            <RemoveIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7} sx={{ width: isMobile ? "100%" : "auto", flex: 1 }}>
          <Card variant="outlined">
            <CardHeader title="Tìm người để thêm trọng tài" />
            <Divider />
            <CardContent>
              <TextField
                fullWidth
                placeholder="Nhập tên/nickname/email để tìm…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonSearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <Box mt={1.5}>
                {loadingSearch ? (
                  <Box textAlign="center" py={2}>
                    <CircularProgress size={22} />
                  </Box>
                ) : (candidates?.length || 0) === 0 ? (
                  <Alert severity="info">Không có kết quả phù hợp.</Alert>
                ) : (
                  <Stack component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                    {candidates.map((u) => {
                      const already = isAssigned(u._id);
                      return (
                        <Stack
                          key={u._id}
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{
                            py: 0.75,
                            px: 1.25,
                            borderRadius: 1,
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={1.25}
                            alignItems="center"
                          >
                            <Avatar sx={{ width: 28, height: 28 }}>
                              {(personNickname(u)[0] || "U").toUpperCase()}
                            </Avatar>
                            <Typography variant="body2">
                              {personNickname(u)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {u?.email || u?.phone || ""}
                            </Typography>
                          </Stack>
                          <Tooltip
                            title={already ? "Đã trong giải" : "Thêm vào giải"}
                            arrow
                          >
                            <span>
                              <IconButton
                                edge="end"
                                onClick={() => handleAdd(u._id)}
                                disabled={saving || already}
                                size="small"
                              >
                                <AddIcon />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </ResponsiveModal>
  );
}
