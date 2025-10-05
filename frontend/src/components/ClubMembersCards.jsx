/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Grid,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Skeleton,
} from "@mui/material";
import Star from "@mui/icons-material/Star";
import StarBorder from "@mui/icons-material/StarBorder";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import PersonAddAlt from "@mui/icons-material/PersonAddAlt1";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useListMembersQuery,
  useKickMemberMutation,
  useSetRoleMutation,
  useAddMemberMutation,
} from "../slices/clubsApiSlice";

// chuẩn hoá message lỗi từ RTK Query
const getApiErrMsg = (err) =>
  err?.data?.message ||
  err?.error ||
  (typeof err?.data === "string" ? err.data : "Có lỗi xảy ra.");

export default function ClubMembersCards({ club }) {
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

  // 👉 nhập nickname/email (thay cho userId)
  const [addKey, setAddKey] = useState("");

  const members = useMemo(() => data?.items || [], [data]);

  const canToggleRole = (targetRole) => {
    if (!canManage) return false;
    if (targetRole === "owner") return false; // không đụng owner
    if (isOwner) return true; // owner: toggle admin/member với tất cả (trừ owner)
    // admin: chỉ toggle member
    return targetRole === "member";
  };

  const canKick = (targetRole, targetUserId) => {
    if (!canManage) return false;
    if (String(targetUserId) === String(authUserId)) return false; // không tự kick
    if (targetRole === "owner") return false;
    if (isOwner) return true; // owner: kick admin/member
    return targetRole === "member"; // admin: chỉ kick member
  };

  const handleToggleAdmin = async (m) => {
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

  const handleKick = async (m) => {
    if (
      !window.confirm(
        `Xoá thành viên "${
          m.user?.fullName || m.user?.nickname || m.user?.email
        }" ?`
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
      // ⬇️ backend đã hỗ trợ nickname/email
      await addMember({ id: clubId, nickname: key, role: "member" }).unwrap();
      toast.success("Đã thêm thành viên");
      setAddKey("");
      refetch();
    } catch (err) {
      toast.error(getApiErrMsg(err));
    }
  };

  return (
    <Stack spacing={2}>
      {canManage && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
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
              >
                Thêm
              </Button>
              <Button
                startIcon={<RefreshIcon />}
                onClick={() => refetch()}
                disabled={isFetching}
              >
                Tải lại
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              * Admin chỉ thêm/kick & đổi vai trò cho member. Chỉ Owner mới thao
              tác với admin khác.
            </Typography>
          </CardContent>
        </Card>
      )}

      <Grid container spacing={2}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <Grid key={i} item xs={12} sm={6} md={4}>
                <Skeleton
                  variant="rounded"
                  height={120}
                  sx={{ borderRadius: 3 }}
                />
              </Grid>
            ))
          : members.map((m) => {
              const targetUserId = String(m.user?._id || "");
              const targetRole = m.role;
              const canToggle = canToggleRole(targetRole);
              const canRemove = canKick(targetRole, targetUserId);

              return (
                <Grid key={m._id} item xs={12} sm={6} md={4}>
                  <Card variant="outlined" sx={{ borderRadius: 3 }}>
                    <CardHeader
                      avatar={
                        <Avatar src={m.user?.avatar} alt={m.user?.fullName} />
                      }
                      title={
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle1" noWrap>
                            {m.user?.fullName ||
                              m.user?.nickname ||
                              m.user?.email ||
                              "Người dùng"}
                          </Typography>
                          {String(targetUserId) === ownerId && (
                            <Chip size="small" color="primary" label="Owner" />
                          )}
                          {targetRole === "admin" && (
                            <Chip size="small" label="Admin" />
                          )}
                        </Stack>
                      }
                      subheader={
                        <Typography variant="body2" color="text.secondary">
                          Joined: {new Date(m.joinedAt).toLocaleString()}
                        </Typography>
                      }
                    />
                    <CardContent>
                      {canManage ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <ButtonGroup variant="outlined" size="small">
                            <Tooltip
                              title={
                                m.role === "admin"
                                  ? "Bỏ admin"
                                  : "Cấp quyền admin"
                              }
                            >
                              <span>
                                <Button
                                  onClick={() => handleToggleAdmin(m)}
                                  disabled={!canToggle || settingRole}
                                  startIcon={
                                    m.role === "admin" ? (
                                      <StarBorder />
                                    ) : (
                                      <Star />
                                    )
                                  }
                                >
                                  {m.role === "admin"
                                    ? "Bỏ admin"
                                    : "Cấp quyền admin"}
                                </Button>
                              </span>
                            </Tooltip>
                            <Tooltip title="Xoá khỏi CLB">
                              <span>
                                <Button
                                  color="error"
                                  onClick={() => handleKick(m)}
                                  disabled={!canRemove || kicking}
                                  startIcon={<DeleteOutline />}
                                >
                                  Kick
                                </Button>
                              </span>
                            </Tooltip>
                          </ButtonGroup>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Bạn không có quyền quản trị thành viên.
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
      </Grid>

      {!isLoading && members.length === 0 && (
        <Box sx={{ p: 2 }}>
          <Typography color="text.secondary">
            Chưa có thành viên nào.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
