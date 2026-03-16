import {
  Box,
  Container,
  Typography,
  Skeleton, // 👈 thêm Skeleton
} from "@mui/material";
import { useParams } from "react-router-dom";
import { useGetTournamentQuery } from "../../slices/tournamentsApiSlice";
import { TournamentWeatherSection } from "../TournamentWeatherSection";
import SEOHead from "../../components/SEOHead";
import { useLanguage } from "../../context/LanguageContext";

function TournamentDetailPage() {
  const { id } = useParams();
  const { t } = useLanguage();

  const {
    data: tournament,
    isLoading,
    isError,
    error,
  } = useGetTournamentQuery(id, {
    skip: !id,
  });

  if (!id) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3 }}>
          <Typography>{t("tournaments.detail.missingId")}</Typography>
        </Box>
      </Container>
    );
  }

  if (isLoading) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Skeleton cho title / tên giải */}
          <Skeleton variant="text" width={260} height={40} />

          {/* Skeleton cho weather card */}
          <Box
            sx={{
              mt: 1,
              p: 2,
              borderRadius: 2,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Skeleton variant="text" width={180} height={28} />
            <Skeleton variant="text" width={140} height={24} />
            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <Skeleton variant="rounded" width={80} height={80} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" />
                <Skeleton variant="text" width="70%" />
              </Box>
            </Box>
          </Box>
        </Box>
      </Container>
    );
  }

  if (isError) {
    return (
      <Container maxWidth="lg">
        <Box sx={{ mt: 3 }}>
          <Typography color="error">
            {t("tournaments.detail.loadError")}
          </Typography>
          {process.env.NODE_ENV === "development" && (
            <Typography variant="body2">{JSON.stringify(error)}</Typography>
          )}
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <SEOHead
        title={tournament?.name}
        description={t("tournaments.detail.seoDescription", {
          name: tournament?.name || t("tournaments.schedule.seoFallbackName"),
          location:
            tournament?.location || t("tournaments.dashboard.locationFallback"),
        })}
        image={tournament?.cover}
        path={`/tournament/${id}`}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "Event",
            name: tournament?.name,
            startDate: tournament?.startDate,
            endDate: tournament?.endDate,
            eventStatus: "https://schema.org/EventScheduled",
            eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
            location: {
              "@type": "Place",
              name:
                tournament?.location || t("tournaments.detail.placeFallback"),
              address: {
                "@type": "PostalAddress",
                addressLocality: tournament?.location,
                addressCountry: "VN",
              },
            },
            image: [tournament?.cover || "https://pickletour.vn/banner.jpg"],
            description: tournament?.description,
            organizer: {
              "@type": "Organization",
              name:
                tournament?.organizer?.name ||
                t("tournaments.detail.organizerFallback"),
              url: "https://pickletour.vn",
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {
                "@type": "ListItem",
                "position": 1,
                "name": t("tournaments.detail.breadcrumbs.home"),
                "item": "https://pickletour.vn"
              },
              {
                "@type": "ListItem",
                "position": 2,
                "name": t("tournaments.detail.breadcrumbs.tournaments"),
                "item": "https://pickletour.vn/tournaments"
              },
              {
                "@type": "ListItem",
                "position": 3,
                "name":
                  tournament?.name ||
                  t("tournaments.detail.breadcrumbs.detailFallback"),
                "item": `https://pickletour.vn/tournament/${id}`
              }
            ]
          }
        ]}
      />
      <Box sx={{ mt: 3 }}>
        <TournamentWeatherSection
          tournamentId={id}
          locationLabel={tournament?.location || tournament?.name}
        />
      </Box>
    </Container>
  );
}

export default TournamentDetailPage;
