// src/components/ClubDetailPage.jsx
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Container,
  Grid,
  Stack,
  Typography,
  Paper,
  Button,
  Divider,
  Skeleton,
  Badge,
} from "@mui/material";
import { toast } from "react-toastify";

import {
  useGetClubQuery,
  useListJoinRequestsQuery, // ⬅️ dùng để lấy total pending
} from "../slices/clubsApiSlice";
import ClubHeader from "./ClubHeader";
import ClubActions from "./ClubActions";
import ClubCreateDialog from "./ClubCreateDialog";
import JoinRequestsDialog from "./JoinRequestsDialog";
import ClubMembersCards from "./ClubMembersCards";

// helper: quyết định quyền xem danh sách thành viên
function calcCanSeeMembers(club, my) {
  const vis = club?.memberVisibility || "admins";
  const canManage = !!my?.canManage;
  const isMember =
    !!my?.isMember ||
    my?.membershipRole === "owner" ||
    my?.membershipRole === "admin";

  if (vis === "admins") return canManage;
  if (vis === "members") return isMember || canManage;
  if (vis === "public") return true;
  return false;
}

function memberGuardMessage(club) {
  const vis = club?.memberVisibility || "admins";
  if (vis === "admins")
    return "Danh sách thành viên chỉ hiển thị với quản trị viên CLB.";
  if (vis === "members")
    return "Danh sách thành viên chỉ hiển thị với thành viên CLB.";
  return "Danh sách thành viên hiện không thể hiển thị.";
}

export default function ClubDetailPage() {
  const { id } = useParams();
  const { data: club, isLoading, refetch } = useGetClubQuery(id);

  const my = club?._my || null;
  const canManage = !!my?.canManage;
  const isOwnerOrAdmin =
    my && (my.membershipRole === "owner" || my.membershipRole === "admin");

  // hiển thị nhãn Owner/Admin:
  // - Quản trị luôn nhìn thấy
  // - Thành viên thường chỉ thấy nếu club.showRolesToMembers = true
  const showRoleBadges = canManage || !!club?.showRolesToMembers;

  const [openEdit, setOpenEdit] = useState(false);
  const [openJR, setOpenJR] = useState(false);

  // 👉 hỏi tổng số yêu cầu "pending" để gắn badge
  const {
    data: jrMeta,
    refetch: refetchJR,
    isFetching: fetchingJR,
  } = useListJoinRequestsQuery(
    { id, status: "pending", page: 1, limit: 1 },
    { skip: !isOwnerOrAdmin } // chỉ quản trị mới cần biết số pending
  );
  const pendingCount = jrMeta?.total || 0;

  const rightSide = useMemo(
    () => (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1">Tác vụ</Typography>
          <ClubActions club={club} my={my} />
          {isOwnerOrAdmin && (
            <>
              <Divider />
              <Typography variant="subtitle1">Quản trị CLB</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button variant="outlined" onClick={() => setOpenEdit(true)}>
                  Chỉnh sửa CLB
                </Button>

                {/* Nút duyệt + badge số pending (ẩn nếu 0) */}
                <Badge
                  color="error"
                  badgeContent={pendingCount}
                  invisible={!pendingCount || fetchingJR}
                >
                  <Button variant="outlined" onClick={() => setOpenJR(true)}>
                    Duyệt yêu cầu gia nhập
                  </Button>
                </Badge>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    ),
    [club, my, isOwnerOrAdmin, pendingCount, fetchingJR]
  );

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Skeleton variant="rounded" height={260} sx={{ borderRadius: 3 }} />
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={12} md={8}>
            <Skeleton variant="rounded" height={400} sx={{ borderRadius: 3 }} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Skeleton variant="rounded" height={200} sx={{ borderRadius: 3 }} />
          </Grid>
        </Grid>
      </Container>
    );
  }

  if (!club?._id) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography align="center" color="text.secondary">
          Không tìm thấy CLB
        </Typography>
      </Container>
    );
  }

  const canSeeMembers = calcCanSeeMembers(club, my);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <ClubHeader
        club={club}
        onEdit={isOwnerOrAdmin ? () => setOpenEdit(true) : undefined}
      />

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Giới thiệu
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {club.description || "Chưa có mô tả"}
            </Typography>

            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              Thành viên CLB
            </Typography>

            {canSeeMembers ? (
              <ClubMembersCards club={club} showRoleBadges={showRoleBadges} />
            ) : (
              <Typography color="text.secondary">
                {memberGuardMessage(club)}
              </Typography>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          {rightSide}
        </Grid>
      </Grid>

      {/* Chỉnh sửa CLB */}
      <ClubCreateDialog
        open={openEdit}
        onClose={(ok) => {
          setOpenEdit(false);
          if (ok) {
            toast.success("Lưu CLB thành công!");
            refetch();
          }
        }}
        initial={club}
      />

      {/* Duyệt yêu cầu gia nhập */}
      <JoinRequestsDialog
        open={openJR}
        onClose={() => {
          setOpenJR(false);
          // cập nhật lại số badge sau khi duyệt/reject
          refetchJR();
        }}
        clubId={club._id}
      />
    </Container>
  );
}
