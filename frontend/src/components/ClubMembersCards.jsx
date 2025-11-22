/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Grid,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Skeleton,
  Link,
  IconButton,
  Menu,
  MenuItem,
  useTheme,
  alpha,
  Divider,
  Card, // Đã thêm import Card bị thiếu
  CardContent,
  InputAdornment,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import PersonAddAlt from "@mui/icons-material/PersonAddAlt1";
import RefreshIcon from "@mui/icons-material/Refresh";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search"; // Thêm icon search cho đẹp
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useListMembersQuery,
  useKickMemberMutation,
  useSetRoleMutation,
  useAddMemberMutation,
} from "../slices/clubsApiSlice";
import { ZoomableWrapper } from "./Zoom";

const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string" ? err.data : "Có lỗi xảy ra.");

// Helper map Role (Tinh chỉnh lại màu sắc cho hiện đại hơn)
const getRoleProps = (role, theme) => {
  switch (role) {
    case "owner":
      return {
        label: "Chủ CLB",
        // Dùng màu warning hoặc primary đậm cho nổi bật
        bgcolor: alpha(theme.palette.warning.main, 0.1),
        color: theme.palette.warning.dark,
        icon: <Star sx={{ fontSize: 16, color: "inherit" }} />,
      };
    case "admin":
      return {
        label: "Quản trị viên",
        bgcolor: alpha(theme.palette.info.main, 0.1),
        color: theme.palette.info.dark,
        icon: <StarBorder sx={{ fontSize: 16, color: "inherit" }} />,
      };
    default:
      return {
        label: "Thành viên",
        bgcolor: alpha(theme.palette.grey[500], 0.08),
        color: theme.palette.text.secondary,
      };
  }
};

export default function ClubMembersCards({ club }) {
  const theme = useTheme();
  const clubId = club?._id;
  const myRole = club?._my?.membershipRole || null;
  const isOwner = myRole === "owner";
  const canManage = !!club?._my?.canManage;

  const authUserId =
    useSelector((s) => s.auth?.userInfo?._id) ||
    useSelector((s) => s.user?.userInfo?._id) ||
    null;

  const { data, isLoading, isFetching, refetch } = useListMembersQuery(
    { id: clubId },
    { skip: !clubId }
  );
  const [kickMember, { isLoading: kicking }] = useKickMemberMutation();
  const [setRole, { isLoading: settingRole }] = useSetRoleMutation();
  const [addMember, { isLoading: adding }] = useAddMemberMutation();

  const [addKey, setAddKey] = useState("");
  const [anchorEl, setAnchorEl] = useState(null);
  const [activeMember, setActiveMember] = useState(null);

  const members = useMemo(() => data?.items || [], [data]);

  // -- Logic permissions (Giữ nguyên) --
  const canToggleRole = (targetRole) => {
    if (!canManage) return false;
    if (targetRole === "owner") return false;
    if (isOwner) return true;
    return targetRole === "member";
  };

  const canKick = (targetRole, targetUserId) => {
    if (!canManage) return false;
    if (String(targetUserId) === String(authUserId)) return false;
    if (targetRole === "owner") return false;
    if (isOwner) return true;
    return targetRole === "member";
  };
  // -- End Logic permissions --

  const handleOpenMenu = (event, member) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setActiveMember(member);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
    setActiveMember(null);
  };

  const handleToggleAdmin = async () => {
    const m = activeMember;
    handleCloseMenu();
    if (!m) return;
    const newRole = m.role === "admin" ? "member" : "admin";
    try {
      await setRole({
        id: clubId,
        userId: m.user?._id,
        role: newRole,
      }).unwrap();
      toast.success(newRole === "admin" ? "Đã phong admin" : "Đã bỏ admin");
      refetch();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const handleKick = async () => {
    const m = activeMember;
    handleCloseMenu();
    if (!m) return;
    if (!window.confirm(`Xác nhận xoá thành viên khỏi CLB?`)) return;
    try {
      await kickMember({ id: clubId, userId: m.user?._id }).unwrap();
      toast.success("Đã xoá thành viên");
      refetch();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  const handleAdd = async () => {
    const key = addKey.trim();
    if (!key) {
      toast.info("Nhập nickname hoặc email để thêm.");
      return;
    }
    try {
      await addMember({ id: clubId, nickname: key, role: "member" }).unwrap();
      toast.success("Đã thêm thành viên");
      setAddKey("");
      refetch();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <Stack spacing={3}>
      {/* --- KHU VỰC QUẢN LÝ (HEADER) --- */}
      {canManage && (
        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            boxShadow: "none",
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            border: `1px dashed ${theme.palette.primary.main}`,
          }}
        >
          <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={true}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Thêm thành viên (nickname/email)..."
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonAddAlt color="action" fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ bgcolor: "background.paper", borderRadius: 1 }}
                />
              </Grid>
              <Grid item xs="auto" display="flex" gap={1}>
                <Button
                  variant="contained"
                  onClick={handleAdd}
                  disabled={adding || !addKey.trim()}
                  disableElevation
                >
                  Thêm
                </Button>
                <Tooltip title="Tải lại danh sách">
                  <IconButton
                    onClick={() => refetch()}
                    disabled={isFetching}
                    sx={{
                      bgcolor: "background.paper",
                      border: "1px solid #eee",
                    }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Grid>
            </Grid>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block", fontStyle: "italic" }}
            >
              * Nhập nickname hoặc email chính xác để thêm trực tiếp thành viên
              vào CLB.
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* --- DANH SÁCH THÀNH VIÊN --- */}
      <Grid container spacing={2} alignItems="stretch">
        {" "}
        {/* alignItems="stretch" là mấu chốt để card bằng nhau */}
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Grid key={i} item xs={12} sm={6} lg={4}>
                <Skeleton
                  variant="rounded"
                  height={110}
                  sx={{ borderRadius: 3 }}
                />
              </Grid>
            ))
          : members.map((m) => {
              const targetUserId = String(m.user?._id || "");
              const targetRole = m.role;
              const roleProps = getRoleProps(targetRole, theme);

              const canToggle = canToggleRole(targetRole);
              const canRemove = canKick(targetRole, targetUserId);
              const isSelf = String(authUserId) === targetUserId;

              const hasFullName = !!m.user?.fullName;
              const hasNickname = !!m.user?.nickname;
              const primaryTitle = hasNickname
                ? m.user.nickname
                : m.user?.fullName || m.user?.email || "Người dùng";
              const secondarySubtitle =
                hasNickname && hasFullName ? m.user.fullName : m.user?.email;

              return (
                <Grid
                  key={m._id}
                  item
                  xs={12}
                  sm={6}
                  lg={4}
                  sx={{ display: "flex" }}
                >
                  <Card
                    variant="outlined"
                    sx={{
                      width: "100%", // Chiếm hết chiều ngang grid item
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      borderRadius: 3,
                      transition: "all 0.2s ease-in-out",
                      borderColor: theme.palette.divider,
                      "&:hover": {
                        borderColor: theme.palette.primary.main,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        transform: "translateY(-2px)",
                      },
                    }}
                  >
                    <Box
                      sx={{
                        p: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                      }}
                    >
                      {/* AVATAR */}
                      <ZoomableWrapper src={m.user?.avatar}>
                        <Avatar
                          src={m.user?.avatar}
                          alt={primaryTitle}
                          sx={{
                            width: 56,
                            height: 56,
                            border: `1px solid ${theme.palette.divider}`,
                          }}
                        />
                      </ZoomableWrapper>

                      {/* INFO WRAPPER - QUAN TRỌNG: minWidth 0 để text truncate */}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            mb: 0.5,
                          }}
                        >
                          <Link
                            component={RouterLink}
                            to={`/user/${m.user?._id}`}
                            underline="none"
                            sx={{
                              fontWeight: 600,
                              color: "text.primary",
                              fontSize: "0.95rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              "&:hover": { color: theme.palette.primary.main },
                            }}
                          >
                            {primaryTitle}
                          </Link>
                        </Box>

                        {/* ROLE BADGE & DATE */}
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            flexWrap: "wrap",
                          }}
                        >
                          <Chip
                            label={roleProps.label}
                            size="small"
                            icon={roleProps.icon}
                            sx={{
                              height: 20,
                              fontSize: "0.7rem",
                              bgcolor: roleProps.bgcolor,
                              color: roleProps.color,
                              fontWeight: 600,
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                        </Box>

                        {/* SECONDARY TEXT (Fullname or Date) */}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          display="block"
                          sx={{ mt: 0.5 }}
                        >
                          {secondarySubtitle ||
                            `Tham gia: ${new Date(
                              m.joinedAt
                            ).toLocaleDateString()}`}
                        </Typography>
                      </Box>

                      {/* ACTION MENU BUTTON */}
                      {canManage && !isSelf ? (
                        <Box>
                          <IconButton
                            size="small"
                            onClick={(e) => handleOpenMenu(e, m)}
                            sx={{
                              color: theme.palette.text.disabled,
                              "&:hover": {
                                color: theme.palette.text.primary,
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                              },
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <Box sx={{ width: 28 }} /> // Placeholder để căn lề nếu ko có nút menu
                      )}
                    </Box>
                  </Card>
                </Grid>
              );
            })}
      </Grid>

      {/* --- MENU POPUP --- */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        slotProps={{
          paper: {
            sx: { borderRadius: 2, minWidth: 180, boxShadow: theme.shadows[3] },
          },
        }}
      >
        {activeMember && (
          <Box>
            <MenuItem
              onClick={handleToggleAdmin}
              disabled={!canToggle || settingRole}
            >
              {activeMember.role === "admin" ? (
                <>
                  <StarBorder fontSize="small" sx={{ mr: 1.5 }} /> Gỡ quyền
                  Admin
                </>
              ) : (
                <>
                  <Star fontSize="small" sx={{ mr: 1.5 }} /> Cấp quyền Admin
                </>
              )}
            </MenuItem>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem
              onClick={handleKick}
              disabled={!canRemove || kicking}
              sx={{ color: "error.main" }}
            >
              <DeleteOutline fontSize="small" sx={{ mr: 1.5 }} /> Xoá khỏi CLB
            </MenuItem>
          </Box>
        )}
      </Menu>

      {!isLoading && members.length === 0 && (
        <Box
          sx={{
            p: 4,
            textAlign: "center",
            bgcolor: "background.neutral",
            borderRadius: 3,
          }}
        >
          <Typography color="text.secondary">
            Chưa có thành viên nào.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
