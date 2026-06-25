/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Box,
  CircularProgress,
  Paper,
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
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

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
    { skip: !open || !tournamentId },
  );

  // Danh sách trọng tài đã gán cho 1 trận (nếu chỉ gán 1 trận)
  const {
    data: assignedForSingle = [],
    isLoading: assignedLoading,
    isFetching: assignedFetching,
  } = useAdminGetMatchRefereesQuery(
    { tid: tournamentId, matchId: singleMatchId || "" },
    { skip: !open || !tournamentId || !singleMatchId },
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
    [referees],
  );

  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
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
      onClose?.();
    } catch (e) {
      toast.error(
        e?.data?.message || e?.error || "Cập nhật trọng tài (batch) thất bại",
      );
    }
  };

  // Quick info “Đã gán X” (nếu đang chỉnh 1 trận)
  const assignedCount = useMemo(
    () => (Array.isArray(assignedForSingle) ? assignedForSingle.length : 0),
    [assignedForSingle],
  );
  const isBusy = isLoading || isFetching || assignedLoading || assignedFetching;
  const hasReferees = (referees?.length || 0) > 0;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="md"
      icon={<RefereeIcon fontSize="small" />}
      title={
        <Box sx={{ minWidth: 0, width: "100%" }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
            spacing={1}
            sx={{ minWidth: 0 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" fontWeight={800} noWrap={!isMobile}>
                Gán trọng tài
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {titleSuffix}
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={0.75}
              useFlexGap
              flexWrap="wrap"
              sx={{ justifyContent: { xs: "flex-start", sm: "flex-end" } }}
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
              {isBusy && (
                <Chip
                  size="small"
                  label="Đang tải..."
                  icon={<CircularProgress size={12} />}
                  variant="outlined"
                />
              )}
            </Stack>
          </Stack>
        </Box>
      }
      paperSx={{
        borderRadius: { xs: "18px 18px 0 0", md: 3 },
        overflow: "hidden",
      }}
      headerProps={{
        sx: {
          px: { xs: 2, sm: 3 },
          py: { xs: 1.5, sm: 2 },
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          position: { xs: "sticky", md: "static" },
          top: 0,
          zIndex: 2,
        },
      }}
      contentProps={{
        sx: {
          p: 0,
          bgcolor:
            theme.palette.mode === "dark"
              ? "rgba(255,255,255,0.03)"
              : "grey.50",
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        },
      }}
      actionsProps={{
        sx: {
          px: { xs: 2, sm: 3 },
          py: { xs: 1.5, sm: 2 },
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          position: { xs: "sticky", md: "static" },
          bottom: 0,
          zIndex: 2,
        },
      }}
      actions={
        <Stack
          direction={{ xs: "column-reverse", sm: "row" }}
          spacing={1}
          sx={{ width: "100%", justifyContent: "flex-end" }}
        >
          <Button onClick={onClose} fullWidth={isMobile}>
            Đóng
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            startIcon={<SendIcon />}
            disabled={!canSubmit || assigning}
            fullWidth={isMobile}
          >
            {assigning ? "Đang lưu..." : "Lưu"}
          </Button>
        </Stack>
      }
      dialogProps={{}}
      drawerProps={{}}
    >
      {!open ? null : (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 1.25, sm: 1.5 },
                borderRadius: 2,
                bgcolor: "background.paper",
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1.25}
                alignItems={{ xs: "stretch", md: "center" }}
              >
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Nhập tên/nickname/email để tìm..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  sx={{ flex: 1, minWidth: { md: 360 } }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonSearchIcon />
                      </InputAdornment>
                    ),
                  }}
                />
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1}
                  justifyContent="flex-end"
                  useFlexGap
                  flexWrap="wrap"
                  sx={{ width: { xs: "100%", md: "auto" } }}
                >
                  <Tooltip title="Chọn tất cả trong trang">
                    <Box
                      component="span"
                      sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                      <Button
                        onClick={selectAllOnPage}
                        startIcon={<DoneAllIcon />}
                        disabled={!hasReferees}
                        variant="outlined"
                        fullWidth={isMobile}
                      >
                        Chọn tất cả
                      </Button>
                    </Box>
                  </Tooltip>
                  <Tooltip title="Bỏ chọn tất cả">
                    <Box
                      component="span"
                      sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                      <Button
                        onClick={clearAll}
                        startIcon={<ClearAllIcon />}
                        variant="outlined"
                        fullWidth={isMobile}
                      >
                        Bỏ chọn
                      </Button>
                    </Box>
                  </Tooltip>
                  {singleMatchId && (
                    <Tooltip title="Chỉ lấy theo danh sách đã gán của trận này">
                      <Box
                        component="span"
                        sx={{ width: { xs: "100%", sm: "auto" } }}
                      >
                        <Button
                          onClick={() =>
                            setSelected(
                              (assignedForSingle || []).map((u) =>
                                String(u._id),
                              ),
                            )
                          }
                          disabled={assignedLoading || assignedFetching}
                          fullWidth={isMobile}
                        >
                          Dùng DS đã gán
                        </Button>
                      </Box>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
            </Paper>

            <Card
              variant="outlined"
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                bgcolor: "background.paper",
              }}
            >
              <CardHeader
                sx={{
                  px: { xs: 1.5, sm: 2 },
                  py: 1.5,
                  "& .MuiCardHeader-action": {
                    alignSelf: "center",
                    mt: 0,
                  },
                }}
                title={
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    spacing={1}
                  >
                    <Typography variant="subtitle1" fontWeight={700}>
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
                  <Button
                    onClick={() => refetch()}
                    size="small"
                    startIcon={<RefreshIcon />}
                  >
                    Refresh
                  </Button>
                }
              />
              <Divider />
              <CardContent
                sx={{
                  p: { xs: 1, sm: 1.5 },
                  pt: { xs: 1, sm: 1.25 },
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.03)"
                      : "grey.50",
                  maxHeight: { xs: "44vh", md: "46vh" },
                  overflowY: "auto",
                }}
              >
                {isLoading ? (
                  <Box textAlign="center" py={4}>
                    <CircularProgress size={24} />
                  </Box>
                ) : error ? (
                  <Alert severity="error" sx={{ borderRadius: 2 }}>
                    {error?.data?.message || "Không tải được danh sách."}
                  </Alert>
                ) : !hasReferees ? (
                  <Box
                    sx={{
                      py: { xs: 4, sm: 5 },
                      px: 2,
                      textAlign: "center",
                      color: "text.secondary",
                    }}
                  >
                    <PersonSearchIcon sx={{ fontSize: 36, mb: 1 }} />
                    <Typography fontWeight={700} color="text.primary">
                      Không có kết quả phù hợp
                    </Typography>
                    <Typography variant="body2">
                      Thử đổi từ khóa hoặc refresh danh sách.
                    </Typography>
                  </Box>
                ) : (
                  <List dense disablePadding>
                    {referees.map((u) => {
                      const id = String(u._id);
                      const checked = selectedSet.has(id);
                      const contact = u?.email || u?.phone || "";
                      return (
                        <ListItem
                          key={id}
                          disableGutters
                          onClick={() => toggle(id)}
                          sx={{
                            cursor: "pointer",
                            px: { xs: 1, sm: 1.25 },
                            py: 1,
                            pr: 6,
                            mb: 0.75,
                            border: 1,
                            borderColor: checked ? "primary.main" : "divider",
                            borderRadius: 1.5,
                            bgcolor: checked
                              ? "action.selected"
                              : "background.paper",
                            transition:
                              "background-color 120ms ease, border-color 120ms ease",
                            "&:hover": {
                              bgcolor: checked
                                ? "action.selected"
                                : "action.hover",
                            },
                          }}
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
                            <Avatar
                              sx={{
                                width: 36,
                                height: 36,
                                fontSize: 14,
                                fontWeight: 800,
                                bgcolor: checked
                                  ? "primary.main"
                                  : "action.selected",
                                color: checked
                                  ? "primary.contrastText"
                                  : "text.primary",
                              }}
                            >
                              {(personNickname(u)[0] || "U").toUpperCase()}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                variant="body2"
                                fontWeight={700}
                                noWrap
                              >
                                {personNickname(u)}
                              </Typography>
                            }
                            secondary={
                              contact ? (
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                  noWrap
                                >
                                  {contact}
                                </Typography>
                              ) : null
                            }
                          />
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </CardContent>
            </Card>

            <Alert severity="info" sx={{ borderRadius: 2, alignItems: "center" }}>
              Thao tác này sẽ <b>cập nhật (thay thế)</b> danh sách trọng tài cho{" "}
              <b>{effectiveMatchIds.length}</b> trận được chọn.
            </Alert>
          </Stack>
        </Box>
      )}
    </ResponsiveModal>
  );
}

export default React.memo(AssignRefDialog);
