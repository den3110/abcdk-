import { useMemo, useState } from "react";
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
import SEOHead from "./SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

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
function memberGuardMessage(club, t) {
  const vis = club?.memberVisibility || "admins";
  if (vis === "admins")
    return t("clubs.detail.memberGuardAdmins");
  if (vis === "members")
    return t("clubs.detail.memberGuardMembers");
  return t("clubs.detail.memberGuardUnavailable");
}

const ALLOWED_TABS = ["news", "events", "polls"];

export default function ClubDetailPage() {
  const { t } = useLanguage();
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
          <Typography variant="subtitle1">
            {t("clubs.detail.actionsTitle")}
          </Typography>
          <ClubActions club={club} my={my} />
          {isOwnerOrAdmin && (
            <>
              <Divider />
              <Typography variant="subtitle1">
                {t("clubs.detail.manageTitle")}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button variant="outlined" onClick={() => setOpenEdit(true)}>
                  {t("clubs.detail.editClub")}
                </Button>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button variant="outlined" onClick={() => setOpenJR(true)}>
                  {t("clubs.detail.reviewJoinRequests")}
                </Button>
              </Stack>
            </>
          )}  
        </Stack>
      </Paper>
    ),
    [club, my, isOwnerOrAdmin, t]
  );

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Skeleton variant="rounded" height={260} sx={{ borderRadius: 3 }} />
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item size={{ xs: 12, md: 8 }}>
            <Skeleton variant="rounded" height={400} sx={{ borderRadius: 3 }} />
          </Grid>
          <Grid item size={{ xs: 12, md: 4 }}>
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
          {t("clubs.detail.notFound")}
        </Typography>
      </Container>
    );
  }

  const canSeeMembers = calcCanSeeMembers(club, my);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <SEOHead
        title={club?.name}
        description={
          club?.description ||
          t("clubs.detail.descriptionFallback", { name: club?.name })
        }
        ogImage={club?.avatar}
        path={`/clubs/${club?._id}`}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "SportsTeam",
            name: club?.name,
            sport: "Pickleball",
            description:
              club?.description ||
              t("clubs.detail.descriptionFallback", { name: club?.name }),
            logo: club?.avatar || "https://pickletour.vn/icon-192.png",
            url: `https://pickletour.vn/clubs/${club?._id}`,
            member: (club?.members || []).map((m) => ({
              "@type": "Person",
              name:
                m?.user?.name ||
                m?.user?.fullName ||
                t("clubs.detail.memberFallback"),
            })).slice(0, 10),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {
                "@type": "ListItem",
                "position": 1,
                "name": t("clubs.detail.breadcrumbHome"),
                "item": "https://pickletour.vn"
              },
              {
                "@type": "ListItem",
                "position": 2,
                "name": t("clubs.detail.breadcrumbClubs"),
                "item": "https://pickletour.vn/clubs"
              },
              {
                "@type": "ListItem",
                "position": 3,
                "name": club?.name || t("clubs.detail.breadcrumbDetail"),
                "item": `https://pickletour.vn/clubs/${club?._id}`
              }
            ]
          }
        ]}
      />
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
          <Tab label={t("clubs.detail.tabs.news")} value="news" />
          <Tab label={t("clubs.detail.tabs.events")} value="events" />
          <Tab label={t("clubs.detail.tabs.polls")} value="polls" />
        </Tabs>
      </Paper>

      <Grid container spacing={2}>
        <Grid item size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            {tab === "news" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {t("clubs.detail.sections.news")}
                </Typography>
                <ClubAnnouncements club={club} canManage={canManage} />
                <Divider sx={{ my: 2 }} />
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {t("clubs.detail.sections.members")}
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
                    {memberGuardMessage(club, t)}
                  </Typography>
                )}
              </>
            )}

            {tab === "events" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {t("clubs.detail.sections.events")}
                </Typography>
                <ClubEventsSection club={club} canManage={canManage} />
              </>
            )}

            {tab === "polls" && (
              <>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {t("clubs.detail.sections.polls")}
                </Typography>
                <ClubPolls club={club} canManage={canManage} />
              </>
            )}
          </Paper>
        </Grid>

        <Grid item size={{ xs: 12, md: 4 }}>
          {rightSide}
        </Grid>
      </Grid>

      <ClubCreateDialog
        open={openEdit}
        onClose={(ok) => {
          setOpenEdit(false);
          if (ok) {
            toast.success(t("clubs.detail.saveSuccess"));
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
