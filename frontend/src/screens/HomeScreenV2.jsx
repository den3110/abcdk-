import { useMemo } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
  alpha,
  Avatar,
  Box,
  Button,
  Container,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";

import SEOHead from "../components/SEOHead.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useThemeMode } from "../context/ThemeContext.jsx";
import { useGetHeroContentQuery } from "../slices/cmsApiSlice.js";
import { useGetHomeSummaryQuery } from "../slices/homeApiSlice.js";

const fallbackImg = `${import.meta.env.BASE_URL}hero.jpg`;

const FULL_BLEED_SX = {
  position: "relative",
  left: "50%",
  right: "50%",
  ml: "-50vw",
  mr: "-50vw",
  width: "100vw",
};

const DISPLAY_FONT_FAMILY =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';

function splitHeroTitle(title) {
  const words = String(title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 4) {
    return {
      main: words.join(" "),
      accent: "",
    };
  }

  const accentCount = Math.max(1, Math.ceil(words.length / 3));

  return {
    main: words.slice(0, words.length - accentCount).join(" "),
    accent: words.slice(words.length - accentCount).join(" "),
  };
}

function formatCompactNumber(value, locale) {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat(locale, {
    notation: numericValue >= 1000 ? "compact" : "standard",
    maximumFractionDigits: numericValue >= 1000 ? 1 : 0,
  }).format(numericValue);
}

export default function HomeScreenV2() {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const { t, locale } = useLanguage();
  const { userInfo } = useSelector((state) => state.auth);

  const { data: heroRes, isError: heroError, isLoading: heroLoading } =
    useGetHeroContentQuery();
  const { data: homeRes } = useGetHomeSummaryQuery({ clubsLimit: 6 });

  const fallbackHero = t("home.heroFallback");
  const featureItems = t("home.features.items", {}, []);
  const clubMembersLabel = t("home.clubs.members", { count: "{count}" });

  const heroData = useMemo(() => {
    if (heroLoading || heroError) {
      return {
        title: fallbackHero.title,
        lead: fallbackHero.lead,
        imageUrl: fallbackImg,
        imageAlt: fallbackHero.imageAlt,
      };
    }

    return {
      title: heroRes?.title || fallbackHero.title,
      lead: heroRes?.lead || fallbackHero.lead,
      imageUrl: heroRes?.imageUrl || fallbackImg,
      imageAlt: heroRes?.imageAlt || fallbackHero.imageAlt,
    };
  }, [fallbackHero, heroError, heroLoading, heroRes]);

  const heroTitle = splitHeroTitle(heroData.title);
  const statCards = useMemo(
    () => [
      {
        key: "players",
        label: t("home.stats.cards.players"),
        value: homeRes?.stats?.players || 0,
      },
      {
        key: "tournaments",
        label: t("home.stats.cards.tournaments"),
        value: homeRes?.stats?.tournaments || 0,
      },
      {
        key: "matches",
        label: t("home.stats.cards.matches"),
        value: homeRes?.stats?.matches || 0,
      },
      {
        key: "clubs",
        label: t("home.stats.cards.clubs"),
        value: homeRes?.stats?.clubs || 0,
      },
    ],
    [homeRes?.stats?.clubs, homeRes?.stats?.matches, homeRes?.stats?.players, homeRes?.stats?.tournaments, t],
  );

  const clubs = Array.isArray(homeRes?.clubs) ? homeRes.clubs.slice(0, 6) : [];
  const isLoggedIn = Boolean(userInfo?._id || userInfo?.id || userInfo?.email);

  return (
    <Box
      sx={{
        ...FULL_BLEED_SX,
        overflowX: "clip",
        backgroundColor: "background.default",
      }}
    >
      <SEOHead
        path="/"
        title="PickleTour"
        description={t("home.seoDescription")}
        keywords={t("home.seoKeywords")}
        ogImage={heroData.imageUrl}
      />

      <Box
        sx={{
          position: "relative",
          minHeight: { xs: "88svh", md: "92svh" },
          color: "#f8fafc",
          backgroundImage: [
            `linear-gradient(180deg, rgba(9, 13, 20, 0.38), rgba(9, 13, 20, 0.72))`,
            `linear-gradient(120deg, rgba(9, 13, 20, 0.94) 0%, rgba(9, 13, 20, 0.72) 38%, rgba(9, 13, 20, 0.52) 100%)`,
            `url(${heroData.imageUrl || fallbackImg})`,
          ].join(", "),
          backgroundSize: "cover",
          backgroundPosition: { xs: "center", md: "76% center" },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: isDark
              ? "radial-gradient(circle at 72% 28%, rgba(61,139,255,0.16), transparent 34%)"
              : "radial-gradient(circle at 72% 28%, rgba(13,110,253,0.18), transparent 36%)",
          }}
        />

        <Container
          maxWidth="xl"
          sx={{
            position: "relative",
            zIndex: 1,
            pt: { xs: 12, md: 16 },
            pb: { xs: 8, md: 11 },
          }}
        >
          <Stack
            spacing={{ xs: 3, md: 4 }}
            sx={{
              maxWidth: { xs: "100%", md: 760 },
              minWidth: 0,
              p: { xs: 2.5, md: 3.5 },
              borderRadius: { xs: 4, md: 5 },
              border: "1px solid rgba(255,255,255,0.1)",
              background:
                "linear-gradient(180deg, rgba(9,13,20,0.34), rgba(9,13,20,0.52))",
              backdropFilter: "blur(10px)",
            }}
          >
            <Box
              sx={{
                display: "inline-flex",
                alignSelf: "flex-start",
                px: 1.5,
                py: 0.75,
                borderRadius: 999,
                bgcolor: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(12px)",
              }}
            >
              <Typography
                variant="overline"
                sx={{
                  color: "rgba(255,255,255,0.8)",
                  letterSpacing: "0.18em",
                  fontWeight: 700,
                }}
              >
                {t("home.hero.badge")}
              </Typography>
            </Box>

            <Typography
              component="h1"
              sx={{
                maxWidth: 720,
                fontFamily: DISPLAY_FONT_FAMILY,
                fontWeight: 500,
                letterSpacing: "-0.04em",
                lineHeight: { xs: 0.95, md: 0.9 },
                fontSize: {
                  xs: "clamp(3.25rem, 13vw, 4.8rem)",
                  md: "clamp(5rem, 8vw, 7.4rem)",
                },
              }}
            >
              {heroTitle.main ? (
                <Box component="span" sx={{ display: "block" }}>
                  {heroTitle.main}
                </Box>
              ) : null}
              {heroTitle.accent ? (
                <Box
                  component="span"
                  sx={{
                    display: "block",
                    color: theme.palette.primary.light,
                  }}
                >
                  {heroTitle.accent}
                </Box>
              ) : null}
            </Typography>

            <Typography
              sx={{
                maxWidth: 620,
                color: "rgba(248,250,252,0.82)",
                fontSize: { xs: "1rem", md: "1.35rem" },
                lineHeight: 1.72,
              }}
            >
              {heroData.lead}
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                component={Link}
                to={isLoggedIn ? "/pickle-ball/tournaments" : "/register"}
                variant="contained"
                disableElevation
                sx={{
                  minHeight: 58,
                  px: 3.5,
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: "1rem",
                  backgroundColor: "primary.main",
                  boxShadow: `0 18px 40px ${alpha(theme.palette.primary.main, 0.28)}`,
                  "&:hover": {
                    backgroundColor: "primary.dark",
                    boxShadow: `0 22px 44px ${alpha(theme.palette.primary.main, 0.32)}`,
                  },
                }}
              >
                {isLoggedIn
                  ? t("home.actions.exploreTournaments")
                  : t("home.actions.getStarted")}
              </Button>

              <Button
                component={Link}
                to={isLoggedIn ? "/clubs" : "/pickle-ball/tournaments"}
                variant="outlined"
                sx={{
                  minHeight: 58,
                  px: 3.5,
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: "1rem",
                  color: "#f8fafc",
                  borderColor: "rgba(255,255,255,0.22)",
                  bgcolor: "rgba(255,255,255,0.04)",
                  backdropFilter: "blur(14px)",
                  "&:hover": {
                    borderColor: "rgba(255,255,255,0.4)",
                    bgcolor: "rgba(255,255,255,0.1)",
                  },
                }}
              >
                {isLoggedIn ? t("header.nav.clubs") : t("home.actions.exploreTournaments")}
              </Button>
            </Stack>
          </Stack>
        </Container>

        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            background:
              "linear-gradient(180deg, rgba(9,13,20,0.28), rgba(9,13,20,0.66))",
            backdropFilter: "blur(18px)",
          }}
        >
          <Container maxWidth="xl" sx={{ py: { xs: 2.5, md: 3.5 } }}>
            <Box
              sx={{
                display: "grid",
                gap: { xs: 2, md: 3 },
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  md: "repeat(4, minmax(0, 1fr))",
                },
              }}
            >
              {statCards.map((item) => (
                <Stack key={item.key} spacing={0.75} sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: "#f8fafc",
                      fontFamily: DISPLAY_FONT_FAMILY,
                      fontSize: { xs: "2.1rem", md: "3rem" },
                      lineHeight: 1,
                    }}
                  >
                    {formatCompactNumber(item.value, locale)}
                  </Typography>
                  <Typography
                    variant="overline"
                    sx={{
                      color: "rgba(248,250,252,0.62)",
                      letterSpacing: "0.18em",
                    }}
                  >
                    {item.label}
                  </Typography>
                </Stack>
              ))}
            </Box>
          </Container>
        </Box>
      </Box>

      <Box
        sx={{
          background: isDark
            ? "linear-gradient(180deg, rgba(17,24,39,0.96), rgba(17,24,39,1))"
            : "linear-gradient(180deg, #f4f6fb 0%, #ffffff 100%)",
          color: "text.primary",
        }}
      >
        <Container maxWidth="xl" sx={{ py: { xs: 6, md: 10 } }}>
          <Stack spacing={{ xs: 5, md: 7 }}>
            <Box
              sx={{
                display: "grid",
                gap: { xs: 3, lg: 5 },
                gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 0.95fr) minmax(0, 1.05fr)" },
                alignItems: "start",
              }}
            >
              <Stack spacing={2} sx={{ minWidth: 0 }}>
                <Typography
                  variant="overline"
                  sx={{
                    color: "primary.main",
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                  }}
                >
                  {t("home.features.eyebrow")}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: DISPLAY_FONT_FAMILY,
                    fontSize: { xs: "2.3rem", md: "4.2rem" },
                    lineHeight: { xs: 1.02, md: 0.96 },
                    letterSpacing: "-0.04em",
                  }}
                >
                  {t("home.features.title")}
                </Typography>
              </Stack>

              <Typography
                sx={{
                  color: "text.secondary",
                  fontSize: { xs: "1rem", md: "1.12rem" },
                  lineHeight: 1.8,
                  maxWidth: 720,
                }}
              >
                {t("home.features.description")}
              </Typography>
            </Box>

            <Box
              sx={{
                display: "grid",
                gap: { xs: 2, md: 2.5 },
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                  xl: "repeat(3, minmax(0, 1fr))",
                },
              }}
            >
              {(Array.isArray(featureItems) ? featureItems : []).map((item, index) => (
                <Box
                  key={`${item?.title || "feature"}-${index}`}
                  sx={{
                    p: { xs: 2.5, md: 3 },
                    borderRadius: { xs: 4, md: 5 },
                    bgcolor: "background.paper",
                    border: "1px solid",
                    borderColor: alpha(theme.palette.text.primary, isDark ? 0.12 : 0.07),
                    boxShadow: isDark
                      ? "0 22px 48px rgba(0,0,0,0.24)"
                      : "0 22px 48px rgba(15,23,42,0.08)",
                    minWidth: 0,
                  }}
                >
                  <Stack spacing={2.5}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: alpha(theme.palette.primary.main, 0.12),
                        color: "primary.main",
                        fontWeight: 800,
                      }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </Box>
                    <Stack spacing={1.25}>
                      <Typography variant="h6" fontWeight={800}>
                        {item?.title}
                      </Typography>
                      <Typography color="text.secondary" sx={{ lineHeight: 1.75 }}>
                        {item?.desc}
                      </Typography>
                    </Stack>
                  </Stack>
                </Box>
              ))}
            </Box>

            <Stack spacing={2.5}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "flex-end" }}
              >
                <Box>
                  <Typography
                    variant="overline"
                    sx={{
                      color: "primary.main",
                      fontWeight: 700,
                      letterSpacing: "0.18em",
                    }}
                  >
                    {t("home.clubs.eyebrow")}
                  </Typography>
                  <Typography
                    sx={{
                      mt: 1,
                      fontFamily: DISPLAY_FONT_FAMILY,
                      fontSize: { xs: "2rem", md: "3.4rem" },
                      lineHeight: 0.98,
                      letterSpacing: "-0.04em",
                    }}
                  >
                    {t("home.clubs.title")}
                  </Typography>
                </Box>

                <Typography
                  color="text.secondary"
                  sx={{ maxWidth: 620, lineHeight: 1.8 }}
                >
                  {t("home.clubs.description")}
                </Typography>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: { xs: 2, md: 2.5 },
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "repeat(2, minmax(0, 1fr))",
                    xl: "repeat(3, minmax(0, 1fr))",
                  },
                }}
              >
                {clubs.map((club, index) => {
                  const imageUrl = club?.coverUrl || club?.logoUrl || "";
                  const fallbackLetter = String(club?.name || "?").trim().charAt(0).toUpperCase() || "?";

                  return (
                    <Box
                      key={club?.id || `club-${index}`}
                      sx={{
                        p: 1,
                        borderRadius: { xs: 4, md: 5 },
                        bgcolor: "background.paper",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.text.primary, isDark ? 0.12 : 0.07),
                        boxShadow: isDark
                          ? "0 20px 42px rgba(0,0,0,0.24)"
                          : "0 20px 42px rgba(15,23,42,0.08)",
                        minWidth: 0,
                      }}
                    >
                      <Box
                        sx={{
                          minHeight: 220,
                          borderRadius: 4,
                          p: 2.5,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          color: "#f8fafc",
                          backgroundImage: imageUrl
                            ? `linear-gradient(180deg, rgba(9,13,20,0.24), rgba(9,13,20,0.82)), url(${imageUrl})`
                            : `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.94)}, ${alpha(theme.palette.primary.main, 0.72)})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Avatar
                            src={club?.logoUrl || ""}
                            alt={club?.name || ""}
                            sx={{
                              width: 52,
                              height: 52,
                              bgcolor: "rgba(255,255,255,0.14)",
                              color: "#f8fafc",
                              fontWeight: 800,
                            }}
                          >
                            {fallbackLetter}
                          </Avatar>

                          {club?.verified ? (
                            <Box
                              sx={{
                                px: 1.1,
                                py: 0.45,
                                borderRadius: 999,
                                bgcolor: "rgba(255,255,255,0.12)",
                                border: "1px solid rgba(255,255,255,0.16)",
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{ color: "#f8fafc", fontWeight: 700 }}
                              >
                                Verified
                              </Typography>
                            </Box>
                          ) : null}
                        </Stack>

                        <Stack spacing={1}>
                          <Typography variant="h5" fontWeight={800}>
                            {club?.name}
                          </Typography>
                          <Typography sx={{ color: "rgba(248,250,252,0.78)" }}>
                            {club?.location || "Việt Nam"}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: "rgba(248,250,252,0.76)" }}
                          >
                            {clubMembersLabel.replace("{count}", formatCompactNumber(club?.memberCount || 0, locale))}
                          </Typography>
                        </Stack>
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              <Box
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: { xs: 4, md: 5 },
                  color: "#f8fafc",
                  backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.96)}, ${alpha(theme.palette.primary.main, 0.8)})`,
                  boxShadow: `0 26px 52px ${alpha(theme.palette.primary.main, 0.24)}`,
                }}
              >
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={2.5}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", md: "center" }}
                >
                  <Box sx={{ maxWidth: 760 }}>
                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT_FAMILY,
                        fontSize: { xs: "2rem", md: "3.25rem" },
                        lineHeight: 0.96,
                        letterSpacing: "-0.04em",
                      }}
                    >
                      {t("home.cta.title")}
                    </Typography>
                    <Typography
                      sx={{
                        mt: 1.5,
                        color: "rgba(248,250,252,0.84)",
                        lineHeight: 1.8,
                        maxWidth: 620,
                      }}
                    >
                      {t("home.cta.description")}
                    </Typography>
                  </Box>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      component={Link}
                      to={isLoggedIn ? "/pickle-ball/tournaments" : "/register"}
                      variant="contained"
                      sx={{
                        minHeight: 56,
                        px: 3.25,
                        borderRadius: 999,
                        textTransform: "none",
                        fontWeight: 700,
                        backgroundColor: "#f8fafc",
                        color: theme.palette.primary.dark,
                        "&:hover": {
                          backgroundColor: "#ffffff",
                        },
                      }}
                    >
                      {isLoggedIn ? t("home.cta.memberButton") : t("home.cta.guestButton")}
                    </Button>
                    <Button
                      component={Link}
                      to="/clubs"
                      variant="outlined"
                      sx={{
                        minHeight: 56,
                        px: 3.25,
                        borderRadius: 999,
                        textTransform: "none",
                        fontWeight: 700,
                        color: "#f8fafc",
                        borderColor: "rgba(255,255,255,0.4)",
                        "&:hover": {
                          borderColor: "#f8fafc",
                          bgcolor: "rgba(255,255,255,0.08)",
                        },
                      }}
                    >
                      {t("header.nav.clubs")}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
