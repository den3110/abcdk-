/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Box,
  CircularProgress,
  Grid,
  Card,
  CardHeader,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  Checkbox,
  TextField,
  InputAdornment,
  Alert,
  Stack,
  Chip,
  Tooltip,
  Typography,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import {
  HowToReg as RefereeIcon,
  PersonSearch as PersonSearchIcon,
  DoneAll as DoneAllIcon,
  ClearAll as ClearAllIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

// ⬇️ điều chỉnh path này cho đúng dự án của bạn
// import ResponsiveModal from "@/components/ResponsiveModal";
// import ResponsiveModal from "../../../components/ResponsiveModal";

// Hooks: đổi path nếu khác dự án của bạn
import {
  useListTournamentRefereesQuery,
  useBatchAssignRefereeMutation,
} from "../slices/refereeScopeApiSlice";
import { useAdminGetMatchRefereesQuery } from "../slices/tournamentsApiSlice";
import ResponsiveModal from "./ResponsiveModal";

// Utils
const personNickname = (p) =>
  p?.nickname || p?.nickName || p?.displayName || p?.fullName || p?.name || "—";

const matchCode = (m) => {
  if (!m) return "—";
  if (m.code) return m.code;
  const r = Number.isFinite(m?.globalRound)
    ? m.globalRound
    : Number.isFinite(m?.round)
    ? m.round
    : "?";
  const t = Number.isFinite(m?.order) ? m.order + 1 : undefined;
  return `V${r}${t ? `-T${t}` : ""}`;
};

function AssignRefDialog({
  open,
  tournamentId,
  match,
  matchIds,
  onClose,
  onChanged,
  limit = 100,
}) {
  const theme= useTheme()
  const isMobile= useMediaQuery(theme.breakpoints.down("md"))
  // Các trận được áp dụng
  const effectiveMatchIds = useMemo(() => {
    if (Array.isArray(matchIds) && matchIds.length) return matchIds.map(String);
    return match?._id ? [String(match._id)] : [];
  }, [matchIds, match]);

  // Nếu chỉ 1 trận → dùng để prefill
  const singleMatchId =
    effectiveMatchIds.length === 1 ? effectiveMatchIds[0] : null;

  // Tìm kiếm (debounce)
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Danh sách trọng tài thuộc giải
  const {
    data: referees = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useListTournamentRefereesQuery(
    { tid: tournamentId, q: debouncedQ, limit },
    { skip: !open || !tournamentId }
  );

  // Danh sách trọng tài đã gán cho 1 trận (nếu chỉ gán 1 trận)
  const {
    data: assignedForSingle = [],
    isLoading: assignedLoading,
    isFetching: assignedFetching,
  } = useAdminGetMatchRefereesQuery(
    { tid: tournamentId, matchId: singleMatchId || "" },
    { skip: !open || !tournamentId || !singleMatchId }
  );

  // State chọn
  const [selected, setSelected] = useState([]);

  // Prefill CHỈ MỘT LẦN mỗi khi mở dialog cho 1 trận
  const didInitRef = useRef(false);

  // Reset khi đóng
  useEffect(() => {
    if (!open) {
      setSelected([]);
      didInitRef.current = false;
    }
  }, [open]);

  // Reset init khi đổi sang trận khác
  useEffect(() => {
    didInitRef.current = false;
    setSelected([]);
  }, [singleMatchId]);

  // Thực hiện prefill một lần (sau khi assigned đã load xong)
  useEffect(() => {
    if (!open) return;
    if (!singleMatchId) return;
    if (assignedLoading || assignedFetching) return;
    if (didInitRef.current) return;

    const ids = (assignedForSingle || []).map((u) => String(u._id));
    setSelected(ids);
    didInitRef.current = true;
  }, [
    open,
    singleMatchId,
    assignedLoading,
    assignedFetching,
    assignedForSingle,
  ]);

  const allIdsOnPage = useMemo(
    () => (referees || []).map((u) => String(u._id)),
    [referees]
  );

  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );

  const selectAllOnPage = () =>
    setSelected((s) => Array.from(new Set([...s, ...allIdsOnPage])));

  const clearAll = () => setSelected([]);

  // Cho phép lưu kể cả khi selected = [] (để xóa hết)
  const canSubmit = open && tournamentId && effectiveMatchIds.length > 0;

  const titleSuffix = useMemo(() => {
    if (Array.isArray(matchIds) && matchIds.length > 1) {
      return `${matchIds.length} trận`;
    }
    if (match?._id) return matchCode(match);
    return "—";
  }, [matchIds, match]);

  const [batchAssign, { isLoading: assigning }] =
    useBatchAssignRefereeMutation();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await batchAssign({
        ids: effectiveMatchIds,
        referees: selected, // Backend nên $set luôn danh sách này
      }).unwrap();

      const msg =
        selected.length > 0
          ? `Đã cập nhật ${selected.length} trọng tài cho ${effectiveMatchIds.length} trận`
          : `Đã gỡ hết trọng tài cho ${effectiveMatchIds.length} trận`;
      toast.success(msg);

      onChanged?.();
      // Không auto-close để bạn có thể chỉnh tiếp
      // onClose?.();
    } catch (e) {
      toast.error(
        e?.data?.message || e?.error || "Cập nhật trọng tài (batch) thất bại"
      );
    }
  };

  // Quick info “Đã gán X” (nếu đang chỉnh 1 trận)
  const assignedCount = useMemo(
    () => (Array.isArray(assignedForSingle) ? assignedForSingle.length : 0),
    [assignedForSingle]
  );

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      // Drawer (mobile) sẽ mặc định anchor="bottom"
      icon={<RefereeIcon fontSize="small" />}
      title={
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ minWidth: 0 }}
        >
          <span>Gán trọng tài — {titleSuffix}</span>
          <Stack
            direction="row"
            spacing={1}
            ml="auto"
            alignItems="center"
            flexWrap="wrap"
          >
            {singleMatchId && (
              <Chip
                size="small"
                variant="outlined"
                label={`Đã gán: ${assignedCount}`}
              />
            )}
            <Chip
              size="small"
              label={`Đang chọn: ${selected.length}`}
              variant="outlined"
            />
            {(isLoading ||
              isFetching ||
              assignedLoading ||
              assignedFetching) && (
              <Chip
                size="small"
                label="Đang tải…"
                icon={<CircularProgress size={12} />}
                variant="outlined"
              />
            )}
          </Stack>
        </Stack>
      }
      actions={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            startIcon={<SendIcon />}
            disabled={!canSubmit || assigning}
          >
            {assigning ? "Đang lưu…" : "Lưu"}
          </Button>
        </>
      }
      // Giữ DOM để tốc độ hiển thị tốt hơn khi mở lại
      // (nếu muốn unmount khi đóng thì set keepMounted={false} trong ResponsiveModal)
      dialogProps={{}}
      drawerProps={{}}
    >
      {!open ? null : (
        <Grid container spacing={2}>
          {/* Tìm kiếm + hành động nhanh */}
          <Grid item xs={12}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
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
              <Stack
                direction="row"
                spacing={1}
                justifyContent="flex-end"
                flexWrap="wrap"
              >
                <Tooltip title="Chọn tất cả trong trang">
                  <span>
                    <Button
                      onClick={selectAllOnPage}
                      startIcon={<DoneAllIcon />}
                      disabled={!referees?.length}
                    >
                      Chọn tất cả
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Bỏ chọn tất cả">
                  <span>
                    <Button onClick={clearAll} startIcon={<ClearAllIcon />}>
                      Bỏ chọn
                    </Button>
                  </span>
                </Tooltip>
                {singleMatchId && (
                  <Tooltip title="Chỉ lấy theo danh sách đã gán của trận này">
                    <span>
                      <Button
                        onClick={() =>
                          setSelected(
                            (assignedForSingle || []).map((u) => String(u._id))
                          )
                        }
                        disabled={assignedLoading || assignedFetching}
                      >
                        Dùng DS đã gán
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </Stack>
            </Stack>
          </Grid>

          {/* Danh sách trọng tài */}
          <Grid item xs={12} sx={{width: isMobile ? "100%" : "auto"}}>
            <Card variant="outlined">
              <CardHeader
                title={
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      Trọng tài trong giải
                    </Typography>
                    <Chip
                      size="small"
                      label={`${referees?.length || 0} kết quả`}
                      variant="outlined"
                    />
                  </Stack>
                }
                action={
                  <Button onClick={() => refetch()} size="small">
                    Refresh
                  </Button>
                }
              />
              <Divider />
              <CardContent sx={{ pt: 1 }}>
                {isLoading ? (
                  <Box textAlign="center" py={2}>
                    <CircularProgress size={22} />
                  </Box>
                ) : error ? (
                  <Alert severity="error">
                    {error?.data?.message || "Không tải được danh sách."}
                  </Alert>
                ) : (referees?.length || 0) === 0 ? (
                  <Alert severity="info">Không có kết quả phù hợp.</Alert>
                ) : (
                  <List dense>
                    {referees.map((u) => {
                      const id = String(u._id);
                      const checked = selected.includes(id);
                      return (
                        <ListItem
                          key={id}
                          onClick={() => toggle(id)}
                          sx={{ cursor: "pointer" }}
                          secondaryAction={
                            <Checkbox
                              edge="end"
                              checked={checked}
                              onChange={() => toggle(id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          }
                        >
                          <ListItemAvatar>
                            <Avatar>
                              {(personNickname(u)[0] || "U").toUpperCase()}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={personNickname(u)}
                            secondary={u?.email || u?.phone || ""}
                          />
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Alert severity="info">
              Thao tác này sẽ <b>cập nhật (thay thế)</b> danh sách trọng tài cho{" "}
              <b>{effectiveMatchIds.length}</b> trận được chọn.
            </Alert>
          </Grid>
        </Grid>
      )}
    </ResponsiveModal>
  );
}

export default React.memo(AssignRefDialog);
