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
} from "@mui/material";
import { toast } from "react-toastify";
import { useGetClubQuery } from "../slices/clubsApiSlice";
import ClubHeader from "./ClubHeader";
import ClubActions from "./ClubActions";
import ClubCreateDialog from "./ClubCreateDialog";
import JoinRequestsDialog from "./JoinRequestsDialog";
import ClubMembersCards from "./ClubMembersCards"; // ⬅️ dùng component mới

export default function ClubDetailPage() {
  const { id } = useParams();
  const { data: club, isLoading, refetch } = useGetClubQuery(id);

  const my = club?._my || null;
  const isOwnerOrAdmin = !!(
    my &&
    (my.membershipRole === "owner" || my.membershipRole === "admin")
  );

  const [openEdit, setOpenEdit] = useState(false);
  const [openJR, setOpenJR] = useState(false);

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
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={() => setOpenEdit(true)}>
                  Chỉnh sửa CLB
                </Button>
                <Button variant="outlined" onClick={() => setOpenJR(true)}>
                  Duyệt yêu cầu gia nhập
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    ),
    [club, my, isOwnerOrAdmin]
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
            {isOwnerOrAdmin ? (
              <ClubMembersCards club={club} />
            ) : (
              <Typography color="text.secondary">
                Danh sách thành viên chỉ hiển thị với quản trị viên CLB.
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
        onClose={() => setOpenJR(false)}
        clubId={club._id}
      />
    </Container>
  );
}
