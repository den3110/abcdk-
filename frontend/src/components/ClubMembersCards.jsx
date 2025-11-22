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
  Card,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import PersonAddAlt from "@mui/icons-material/PersonAddAlt1";
import RefreshIcon from "@mui/icons-material/Refresh";
import MoreVertIcon from "@mui/icons-material/MoreVert"; // Icon menu
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useListMembersQuery,
  useKickMemberMutation,
  useSetRoleMutation,
  useAddMemberMutation,
} from "../slices/clubsApiSlice";
import { ZoomableWrapper } from "./Zoom"; // Giả định ZoomableWrapper được export từ './Zoom'

// chuẩn hoá message lỗi từ RTK Query
const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string" ? err.data : "Có lỗi xảy ra.");

// Helper để map Role sang màu sắc
const getRoleProps = (role, theme) => {
  switch (role) {
    case "owner":
      return {
        label: "Chủ CLB",
        color: "primary",
        icon: <Star sx={{ fontSize: 16 }} />,
      };
    case "admin":
      return {
        label: "Quản trị viên",
        color: "secondary",
        icon: <Star sx={{ fontSize: 16 }} />,
      };
    default:
      return { label: "Thành viên", color: "default" };
  }
};

export default function ClubMembersCards({ club }) {
  const theme = useTheme();
  const clubId = club?._id;
  const ownerId = String(club?.owner || "");
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

  // Các hàm logic quản trị (giữ nguyên)
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

  // Hàm mở menu
  const handleOpenMenu = (event, member) => {
    setAnchorEl(event.currentTarget);
    setActiveMember(member);
  };

  // Hàm đóng menu
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
    if (
      !window.confirm(
        `Xác nhận xoá thành viên "${
          m.user?.fullName || m.user?.nickname || m.user?.email
        }" khỏi CLB?`
      )
    )
      return;
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
      toast.info("Nhập nickname hoặc email để thêm thành viên.");
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
      {" "}
      {/* Tăng spacing lên 3 cho thoáng */}
      {/* -------------------- PHẦN QUẢN LÝ CHUNG -------------------- */}
      {canManage && (
        <Card
          variant="outlined"
          sx={{
            borderRadius: 3,
            bgcolor: alpha(theme.palette.primary.main, 0.05),
          }}
        >
          <Box sx={{ p: 2 }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                size="small"
                label="Thêm thành viên (nickname hoặc email)"
                placeholder="vd: giangng hoặc giang@example.com"
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                sx={{ flex: 1 }}
              />
              <Button
                startIcon={<PersonAddAlt />}
                variant="contained"
                onClick={handleAdd}
                disabled={adding}
                sx={{ minWidth: { xs: "100%", sm: 120 } }} // fix chiều rộng trên mobile
              >
                Thêm
              </Button>
              <Tooltip title="Tải lại danh sách">
                <IconButton
                  onClick={() => refetch()}
                  disabled={isFetching}
                  color="primary"
                  size="small"
                  sx={{
                    width: 40,
                    height: 40,
                    border: `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              * Owner có quyền thao tác với tất cả. Admin chỉ thao tác được với
              thành viên thường (member).
            </Typography>
          </Box>
        </Card>
      )}
      {/* -------------------- DANH SÁCH THÀNH VIÊN -------------------- */}
      <Grid container spacing={2}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Grid key={i} item xs={12} sm={6} lg={4}>
                {" "}
                {/* Đổi md sang lg để đẹp hơn trên màn hình lớn */}
                <Skeleton
                  variant="rounded"
                  height={100} // Giảm height vì đã làm gọn Card
                  sx={{ borderRadius: 3 }}
                />
              </Grid>
            ))
          : members.map((m) => {
              const targetUserId = String(m.user?._id || "");
              const targetRole = m.role;
              const { label, color, icon } = getRoleProps(targetRole, theme);

              const canToggle = canToggleRole(targetRole);
              const canRemove = canKick(targetRole, targetUserId);

              const hasFullName = !!m.user?.fullName;
              const hasNickname = !!m.user?.nickname;

              // Title chính (nickname hoặc tên thật/email nếu không có nickname)
              const primaryTitle = hasNickname
                ? m.user.nickname
                : m.user?.fullName || m.user?.email || "Người dùng";
              // Subtitle phụ (tên thật nếu có nickname)
              const secondarySubtitle =
                hasNickname && hasFullName ? m.user.fullName : null;

              const isSelf = String(authUserId) === targetUserId;

              return (
                <Grid key={m._id} item xs={12} sm={6} lg={4}>
                  <Card
                    variant="outlined"
                    sx={{
                      borderRadius: 3,
                      transition: "box-shadow 0.3s",
                      "&:hover": { boxShadow: theme.shadows[3] },
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.5}
                      alignItems="center"
                      sx={{ p: 2 }}
                    >
                      {/* 1. AVATAR */}
                      <Box sx={{ flexShrink: 0 }}>
                        <ZoomableWrapper src={m.user?.avatar}>
                          <Avatar
                            src={m.user?.avatar}
                            alt={m.user?.fullName}
                            sx={{ width: 48, height: 48 }}
                          />
                        </ZoomableWrapper>
                      </Box>

                      {/* 2. THÔNG TIN */}
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        {/* NICKNAME (TITLE) */}
                        <Tooltip title={`Profile của ${primaryTitle}`}>
                          <Link
                            component={RouterLink}
                            to={`/user/${m.user?._id}`}
                            underline="hover"
                            sx={{
                              fontWeight: 700,
                              fontSize: "1rem",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "block",
                              color: theme.palette.text.primary,
                              "&:hover": { color: theme.palette.primary.main },
                            }}
                          >
                            {primaryTitle}
                          </Link>
                        </Tooltip>

                        {/* TÊN THẬT/THỜI GIAN THAM GIA */}
                        <Stack direction="row" spacing={1} alignItems="center">
                          {secondarySubtitle && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                            >
                              {secondarySubtitle}
                            </Typography>
                          )}
                          {!secondarySubtitle && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                            >
                              {new Date(m.joinedAt).toLocaleDateString()}
                            </Typography>
                          )}
                        </Stack>
                      </Box>

                      {/* 3. VAI TRÒ & QUẢN TRỊ */}
                      <Stack
                        spacing={1}
                        alignItems="flex-end"
                        sx={{ flexShrink: 0 }}
                      >
                        <Chip
                          size="small"
                          label={label}
                          color={color}
                          icon={icon}
                          sx={{
                            minWidth: 75,
                            justifyContent: "flex-start",
                            pl: 0.5,
                            pr: 1,
                          }}
                        />

                        {canManage && !isSelf && (
                          <Tooltip title="Thao tác quản trị">
                            <IconButton
                              aria-label="menu"
                              size="small"
                              onClick={(e) => handleOpenMenu(e, m)}
                              sx={{
                                visibility:
                                  isOwner ||
                                  targetRole === "admin" ||
                                  targetRole === "member"
                                    ? "visible"
                                    : "hidden",
                                // Tăng tính nhìn thấy, chỉ hiện khi cần thao tác
                              }}
                              disabled={kicking || settingRole}
                            >
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </Stack>
                  </Card>
                </Grid>
              );
            })}
      </Grid>
      {/* -------------------- MENU THAO TÁC -------------------- */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {activeMember && (
          <Box>
            {/* 1. Toggle Admin */}
            <Tooltip
              title={
                canToggle
                  ? activeMember.role === "admin"
                    ? "Bỏ quyền quản trị"
                    : "Cấp quyền quản trị"
                  : "Bạn không có quyền thay đổi vai trò này."
              }
              placement="left"
              arrow
            >
              <MenuItem
                onClick={handleToggleAdmin}
                disabled={!canToggle || settingRole}
                sx={{
                  color:
                    activeMember.role === "admin"
                      ? theme.palette.secondary.main
                      : theme.palette.primary.main,
                }}
              >
                {activeMember.role === "admin" ? (
                  <>
                    <StarBorder fontSize="small" sx={{ mr: 1 }} />
                    Bỏ Admin
                  </>
                ) : (
                  <>
                    <Star fontSize="small" sx={{ mr: 1 }} />
                    Phong Admin
                  </>
                )}
              </MenuItem>
            </Tooltip>

            <Divider />

            {/* 2. Kick */}
            <Tooltip
              title={
                canRemove
                  ? "Xoá thành viên này khỏi CLB."
                  : "Bạn không có quyền xoá Owner/Admin khác."
              }
              placement="left"
              arrow
            >
              <MenuItem
                onClick={handleKick}
                disabled={!canRemove || kicking}
                sx={{ color: theme.palette.error.main }}
              >
                <DeleteOutline fontSize="small" sx={{ mr: 1 }} />
                Xoá (Kick)
              </MenuItem>
            </Tooltip>
          </Box>
        )}
      </Menu>
      {/* -------------------- EMPTY STATE -------------------- */}
      {!isLoading && members.length === 0 && (
        <Box
          sx={{
            p: 3,
            textAlign: "center",
            border: `1px dashed ${theme.palette.divider}`,
            borderRadius: 3,
          }}
        >
          <Typography color="text.secondary" variant="subtitle1">
            Chưa có thành viên nào tham gia.
          </Typography>
          {canManage && (
            <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
              Hãy sử dụng ô tìm kiếm phía trên để thêm thành viên mới.
            </Typography>
          )}
        </Box>
      )}
    </Stack>
  );
}
