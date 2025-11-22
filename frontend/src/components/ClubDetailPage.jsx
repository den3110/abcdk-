import React, { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Container,
  Grid,
  Stack,
  Typography,
  Paper,
  Button,
  Divider,
  Skeleton,
  Tabs,
  Tab,
  Badge,
  Box,
} from "@mui/material";
import { toast } from "react-toastify";
import { useGetClubQuery } from "../slices/clubsApiSlice";
import ClubHeader from "./ClubHeader";
import ClubActions from "./ClubActions";
import ClubCreateDialog from "./ClubCreateDialog";
import JoinRequestsDialog from "./JoinRequestsDialog";
import ClubMembersCards from "./ClubMembersCards";
import ClubEventsSection from "./events/ClubEventsSection";
import ClubAnnouncements from "./news/ClubAnnouncements";
import ClubPolls from "./polls/ClubPolls";

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

const ALLOWED_TABS = ["news", "events", "polls"];

export default function ClubDetailPage() {
  const { id } = useParams();
  const { data: club, isLoading, refetch } = useGetClubQuery(id);
  const [searchParams, setSearchParams] = useSearchParams();

  const my = club?._my || null;
  const canManage = !!my?.canManage;
  const isOwnerOrAdmin =
    my && (my.membershipRole === "owner" || my.membershipRole === "admin");

  const [openEdit, setOpenEdit] = useState(false);
  const [openJR, setOpenJR] = useState(false);

  // Lấy tab từ URL (?tab=...), mặc định 'news' nếu thiếu/không hợp lệ
  const tabFromUrl = (searchParams.get("tab") || "").toLowerCase();
  const tab = ALLOWED_TABS.includes(tabFromUrl) ? tabFromUrl : "news";

  const showRoleBadges = canManage || !!club?.showRolesToMembers;

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
              <Stack direction="row" spacing={1} flexWrap="wrap">
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

  const canSeeMembers = calcCanSeeMembers(club, my);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <ClubHeader
        club={club}
        onEdit={isOwnerOrAdmin ? () => setOpenEdit(true) : undefined}
      />

      {/* Tabs nội dung */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", v);
            setSearchParams(next); // push state để back/forward được
          }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab label="Bảng tin" value="news" />
          <Tab label="Sự kiện" value="events" />
          <Tab label="Khảo sát" value="polls" />
        </Tabs>
      </Paper>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            {tab === "news" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Bảng tin
                </Typography>
                <ClubAnnouncements club={club} canManage={canManage} />
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Thành viên CLB
                </Typography>
                {canSeeMembers ? (
                  <Box sx={{ mt: 2 }}>
                    <ClubMembersCards
                      club={club}
                      showRoleBadges={showRoleBadges}
                    />
                  </Box>
                ) : (
                  <Typography color="text.secondary">
                    {memberGuardMessage(club)}
                  </Typography>
                )}
              </>
            )}

            {tab === "events" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Sự kiện
                </Typography>
                <ClubEventsSection club={club} canManage={canManage} />
              </>
            )}

            {tab === "polls" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Khảo sát
                </Typography>
                <ClubPolls club={club} canManage={canManage} />
              </>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={4}>
          {rightSide}
        </Grid>
      </Grid>

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

      <JoinRequestsDialog
        open={openJR}
        onClose={() => setOpenJR(false)}
        clubId={club._id}
      />
    </Container>
  );
}
