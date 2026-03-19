import { useEffect, useMemo } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  Container,
  alpha,
  useTheme,
  Divider,
  Paper,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import SEOHead from "../../components/SEOHead";
import { useGetSeoNewsBySlugQuery, useGetSeoNewsListQuery } from "../../slices/seoNewsApiSlice";
import { useThemeMode } from "../../context/ThemeContext";
import { useLanguage } from "../../context/LanguageContext.jsx";
import {
  getSuggestedSeoNews,
  startSeoNewsReadingSession,
  trackSeoNewsClick,
  trackSeoNewsListImpression,
} from "../../utils/seoNewsSuggest";

const SITE_URL = "https://pickletour.vn";

function formatDateTime(value, locale = "vi-VN") {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractPlainText(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function SeoNewsDetailScreen() {
  const { slug } = useParams();
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const { t, language, locale } = useLanguage();

  const {
    data: article,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetSeoNewsBySlugQuery(slug, {
    skip: !slug,
  });
  const { data: suggestData } = useGetSeoNewsListQuery({
    page: 1,
    limit: 80,
  });

  const publishedAt = article?.originalPublishedAt || article?.createdAt;

  const suggestionPool = useMemo(() => {
    if (Array.isArray(suggestData)) return suggestData;
    if (Array.isArray(suggestData?.items)) return suggestData.items;
    return [];
  }, [suggestData]);

  const suggestedItems = useMemo(() => {
    if (!article) return [];

    return getSuggestedSeoNews([...suggestionPool, article], {
      limit: 6,
      currentSlug: article.slug,
      contextArticle: article,
      language,
    });
  }, [article, language, suggestionPool]);

  useEffect(() => {
    if (!article) return undefined;
    const stop = startSeoNewsReadingSession(article, { surface: "news-detail" });
    return () => stop();
  }, [article]);

  useEffect(() => {
    if (!suggestedItems.length) return;
    trackSeoNewsListImpression(suggestedItems, { surface: "news-detail-suggest" });
  }, [suggestedItems]);

  useEffect(() => {
    if (!article?.imagePending) return undefined;

    const timer = window.setInterval(() => {
      refetch();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [article?.imagePending, refetch]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  const description = useMemo(() => {
    if (article?.summary) return String(article.summary).slice(0, 180);
    return extractPlainText(article?.contentHtml).slice(0, 180);
  }, [article]);

  const structuredData = useMemo(() => {
    if (!article) return null;

    return {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.title,
      description,
      inLanguage: article.language || "vi",
      datePublished: publishedAt
        ? new Date(publishedAt).toISOString()
        : undefined,
      dateModified: article.updatedAt
        ? new Date(article.updatedAt).toISOString()
        : undefined,
      image: article.heroImageUrl || article.thumbImageUrl || undefined,
      mainEntityOfPage: `${SITE_URL}/news/${article.slug}`,
      author: {
        "@type": "Organization",
        name:
          article.origin === "generated"
            ? t("news.detail.aiSource")
            : article.sourceName || t("news.detail.externalSource"),
      },
      publisher: {
        "@type": "Organization",
        name: "PickleTour.vn",
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon-512.png`,
        },
      },
    };
  }, [article, description, publishedAt, t]);

  const sourceName =
    article?.origin === "generated"
      ? t("news.detail.aiSource")
      : article?.sourceName || t("news.detail.externalSource");

  return (
    <Box sx={{ py: { xs: 2, md: 4 } }}>
      {article ? (
        <SEOHead
          title={`${article.title} - ${t("news.detail.seoSuffix")}`}
          description={description}
          ogImage={article.heroImageUrl || article.thumbImageUrl}
          ogType="article"
          path={`/news/${article.slug}`}
          structuredData={structuredData}
        />
      ) : null}

      <Container maxWidth="md">
        <Button
          component={RouterLink} 
          to="/news" 
          variant="text" 
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 4, fontWeight: 700, color: "text.secondary", "&:hover": { color: "primary.main" } }}
        >
          {t("news.detail.backToNews")}
        </Button>

        {isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress size={48} />
          </Box>
        ) : null}

        {isError ? (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {error?.data?.message || error?.error || t("news.detail.loadError")}
          </Alert>
        ) : null}

        {!isLoading && !isError && article ? (
          <Stack spacing={4}>
            {/* --- HEADER --- */}
            <Box textAlign="center">
              <Stack direction="row" spacing={1} justifyContent="center" sx={{ flexWrap: "wrap", rowGap: 1, mb: 3 }}>
                <Chip
                  size="small"
                  label={
                    article.origin === "generated"
                      ? t("news.badges.aiEdited")
                      : t("news.badges.community")
                  }
                  color={article.origin === "generated" ? "primary" : "default"}
                  sx={{ fontWeight: 700 }}
                />
                {(article.tags || []).slice(0, 4).map((tag) => (
                  <Chip key={tag} size="small" label={tag} variant="outlined" sx={{ fontWeight: 600, color: "text.secondary" }} />
                ))}
              </Stack>
              
              <Typography 
                variant="h1" 
                sx={{ 
                  fontWeight: 900, 
                  lineHeight: { xs: 1.3, md: 1.2 }, 
                  fontSize: { xs: "2rem", md: "3rem" },
                  mb: 3
                }}
              >
                {article.title}
              </Typography>

              <Stack 
                direction="row" 
                spacing={3} 
                justifyContent="center" 
                alignItems="center"
                sx={{ color: "text.secondary" }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <AccountCircleIcon fontSize="small" />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {sourceName}
                  </Typography>
                </Box>
                {publishedAt ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <CalendarTodayIcon fontSize="small" />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatDateTime(publishedAt, locale)}
                    </Typography>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            {/* --- HERO IMAGE --- */}
            {(article.heroImageUrl || article.thumbImageUrl) ? (
              <Box
                component="img"
                src={article.heroImageUrl || article.thumbImageUrl}
                alt={article.title}
                sx={{
                  width: "100%",
                  height: { xs: 250, md: 450 },
                  objectFit: "cover",
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                  boxShadow: isDark 
                    ? "0 10px 30px rgba(0,0,0,0.3)" 
                    : "0 10px 40px rgba(0,0,0,0.05)",
                }}
                loading="lazy"
              />
            ) : article?.imagePending ? (
              <Paper
                elevation={0}
                sx={{
                  width: "100%",
                  height: { xs: 250, md: 450 },
                  borderRadius: 2,
                  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.75)} 0%, ${alpha(theme.palette.info.main, 0.75)} 100%)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Chip
                  label={t("news.detail.pendingImage")}
                  sx={{
                    bgcolor: "rgba(255,255,255,0.16)",
                    color: "#fff",
                    fontWeight: 800,
                  }}
                />
              </Paper>
            ) : null}

            {/* --- SUMMARY / LEAD --- */}
            {article.summary ? (
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: 2,
                  bgcolor: isDark ? alpha(theme.palette.primary.dark, 0.1) : alpha(theme.palette.primary.light, 0.05),
                  borderLeft: `4px solid ${theme.palette.primary.main}`,
                  boxShadow: "none"
                }}
              >
                <Typography 
                  variant="h6" 
                  sx={{ 
                    fontWeight: 600, 
                    lineHeight: 1.7,
                    color: isDark ? "text.primary" : "text.secondary"
                  }}
                >
                  {article.summary}
                </Typography>
              </Paper>
            ) : null}

            {/* --- MAIN CONTENT --- */}
            <Box
              sx={{
                fontSize: "1.15rem",
                color: "text.primary",
                "& p": { 
                  mb: 3, 
                  lineHeight: 1.85 
                },
                "& img": {
                  maxWidth: "100%",
                  height: "auto",
                  borderRadius: 2,
                  my: 3,
                  display: "block",
                  mx: "auto",
                },
                "& h2": { 
                  mt: 5, 
                  mb: 2, 
                  fontSize: { xs: "1.5rem", md: "1.8rem" }, 
                  fontWeight: 800 
                },
                "& h3": { 
                  mt: 4, 
                  mb: 2, 
                  fontSize: { xs: "1.3rem", md: "1.5rem" }, 
                  fontWeight: 700 
                },
                "& ul, & ol": { 
                  pl: 4, 
                  mb: 3,
                  "& li": { mb: 1, lineHeight: 1.7 }
                },
                "& blockquote": {
                  borderLeft: "4px solid",
                  borderColor: "primary.main",
                  pl: 3,
                  py: 1,
                  my: 4,
                  mr: 0,
                  bgcolor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                  color: "text.secondary",
                  fontStyle: "italic",
                  fontSize: "1.2rem",
                  borderRadius: "0 8px 8px 0"
                },
                "& a": {
                  color: "primary.main",
                  textDecoration: "none",
                  fontWeight: 600,
                  "&:hover": { textDecoration: "underline" }
                },
                "& pre": {
                  bgcolor: isDark ? "#1e1e1e" : "#f5f5f5",
                  p: 2,
                  borderRadius: 2,
                  overflowX: "auto",
                  mb: 3
                },
                "& code": {
                  fontFamily: "monospace",
                  bgcolor: isDark ? "#333" : "#eee",
                  px: 0.5,
                  py: 0.2,
                  borderRadius: 1,
                  fontSize: "0.9em"
                }
              }}
              dangerouslySetInnerHTML={{ __html: article.contentHtml || "" }}
            />

            <Divider sx={{ my: 4 }} />

            {suggestedItems.length > 0 ? (
              <Box sx={{ mb: 4 }}>
                <Typography variant="h5" sx={{ fontWeight: 800, mb: 2.5 }}>
                  {t("news.detail.suggestedTitle")}
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
                    gap: 2,
                  }}
                >
                  {suggestedItems.map((item) => (
                    <Card
                      key={`detail-suggest-${item.slug}`}
                      sx={{
                        borderRadius: 2,
                        border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                        boxShadow: isDark
                          ? "0 4px 12px rgba(0,0,0,0.2)"
                          : "0 4px 20px rgba(0,0,0,0.03)",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                        "&:hover": {
                          transform: "translateY(-3px)",
                          boxShadow: isDark
                            ? "0 10px 24px rgba(0,0,0,0.4)"
                            : "0 10px 24px rgba(0,0,0,0.08)",
                          borderColor: alpha(theme.palette.primary.main, 0.2)
                        },
                      }}
                    >
                      <CardActionArea
                        component={RouterLink}
                        to={`/news/${item.slug}`}
                        onClick={() => {
                          trackSeoNewsClick(item, { surface: "news-detail-suggest-click" });
                          window.scrollTo(0, 0);
                        }}
                        sx={{ p: 2, height: "100%" }}
                      >
                        <Chip
                          size="small"
                          color="primary"
                          label={item.__suggestReason || t("news.detail.suggestedFallback")}
                          sx={{ mb: 1.25, fontWeight: 700 }}
                        />
                        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
                          <Typography
                            variant="subtitle1"
                            sx={{
                              fontWeight: 700,
                              lineHeight: 1.4,
                              mb: 0.75,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {item.title}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              mb: 1,
                            }}
                          >
                            {item.summary || t("news.detail.suggestedOpenFallback")}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600 }}>
                            {formatDateTime(item.originalPublishedAt || item.createdAt, locale)}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  ))}
                </Box>
              </Box>
            ) : null}

            {/* --- FOOTER --- */}
            {article.sourceUrl ? (
              <Box textAlign="center" pb={4}>
                <Button
                  component="a"
                  href={article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                  size="large"
                  endIcon={<OpenInNewIcon />}
                  sx={{ borderRadius: 8, px: 4, fontWeight: 700 }}
                >
                  {t("news.detail.viewSource")}
                </Button>
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Container>
    </Box>
  );
}

