import { useEffect, useMemo } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  CircularProgress,
  Chip,
  Pagination,
  Stack,
  Typography,
  useTheme,
  Container,
  alpha,
  Divider,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ArticleIcon from "@mui/icons-material/Article";
import SEOHead from "../../components/SEOHead";
import { useGetSeoNewsListQuery } from "../../slices/seoNewsApiSlice";
import { useThemeMode } from "../../context/ThemeContext";
import { useLanguage } from "../../context/LanguageContext.jsx";
import {
  getSuggestedSeoNews,
  trackSeoNewsClick,
  trackSeoNewsListImpression,
} from "../../utils/seoNewsSuggest";

const SITE_URL = "https://pickletour.vn";
const PAGE_SIZE = 12;

function formatDate(value, locale = "vi-VN") {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function summarize(value, length = 180) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > length ? `${text.slice(0, length - 1).trim()}...` : text;
}

export default function SeoNewsListScreen() {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const { t, language, locale } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchList,
  } = useGetSeoNewsListQuery({
    page,
    limit: PAGE_SIZE,
  });
  const { data: suggestData, refetch: refetchSuggest } = useGetSeoNewsListQuery({
    page: 1,
    limit: 60,
  });

  const items = useMemo(() => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [data]);

  const totalPages = Array.isArray(data)
    ? 1
    : Math.max(1, Number(data?.pages) || 1);

  const suggestionPool = useMemo(() => {
    if (Array.isArray(suggestData)) return suggestData;
    if (Array.isArray(suggestData?.items)) return suggestData.items;
    return [];
  }, [suggestData]);

  const suggestedItems = useMemo(() => {
    const excludeSlugs = items.map((item) => item?.slug).filter(Boolean);
    const mergedPool = [...suggestionPool, ...items];

    return getSuggestedSeoNews(mergedPool, {
      limit: 6,
      excludeSlugs,
      language,
    });
  }, [items, language, suggestionPool]);

  const hasPendingVisibleImages = useMemo(() => {
    const pool = [...items, ...suggestionPool];
    return pool.some((item) => item?.imagePending);
  }, [items, suggestionPool]);

  useEffect(() => {
    if (!items.length) return;
    trackSeoNewsListImpression(items, { surface: `news-list-page-${page}` });
  }, [items, page]);

  useEffect(() => {
    if (!suggestedItems.length) return;
    trackSeoNewsListImpression(suggestedItems, { surface: "news-list-suggest" });
  }, [suggestedItems]);

  useEffect(() => {
    if (!hasPendingVisibleImages) return undefined;

    const timer = window.setInterval(() => {
      refetchList();
      refetchSuggest();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [hasPendingVisibleImages, refetchList, refetchSuggest]);

  const canonicalPath = page > 1 ? `/news?page=${page}` : "/news";

  const structuredData = useMemo(() => {
    const list = items.map((item, idx) => ({
      "@type": "ListItem",
      position: (page - 1) * PAGE_SIZE + idx + 1,
      url: `${SITE_URL}/news/${item.slug}`,
      name: item.title,
    }));

    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: t("news.list.seoTitle"),
      itemListElement: list,
    };
  }, [items, page, t]);

  // Bóc tách bài đầu tiên làm Featured Article (chỉ áp dụng ở trang 1)
  const isFirstPage = page === 1;
  const featuredArticle = isFirstPage && items.length > 0 ? items[0] : null;
  const normalArticles = isFirstPage ? items.slice(1) : items;
  const heroLeadArticle = featuredArticle || items[0] || suggestedItems[0] || null;
  const publishedCount = Math.max(items.length, Number(data?.total) || 0);

  const renderBadge = (origin) => {
    const isAI = origin === "generated";
    return (
      <Chip
        size="small"
        label={isAI ? t("news.badges.aiEdited") : t("news.badges.community")}
        color={isAI ? "primary" : "default"}
        sx={{
          fontWeight: 700,
          fontSize: "0.65rem",
          height: 22,
          boxShadow: isAI ? `0 4px 12px ${alpha(theme.palette.primary.main, 0.4)}` : "0 2px 8px rgba(0,0,0,0.05)",
          backdropFilter: "blur(8px)",
          backgroundColor: isAI ? alpha(theme.palette.primary.main, 0.85) : alpha(theme.palette.background.paper, 0.85),
          color: isAI ? "#fff" : theme.palette.text.primary,
          border: `1px solid ${isAI ? "transparent" : alpha(theme.palette.text.primary, 0.08)}`
        }}
      />
    );
  };

  return (
    <Box>
      <SEOHead
        title={t("news.list.seoTitle")}
        description={t("news.list.seoDescription")}
        keywords={t("news.list.seoKeywords")}
        path={canonicalPath}
        structuredData={structuredData}
      />

      {/* --- HERO BANNER --- */}
      <Box
        sx={{
          py: { xs: 2, md: 3 },
          px: 2,
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              borderRadius: { xs: 2, md: 2 },
              px: { xs: 3, md: 4 },
              py: { xs: 3.25, md: 4 },
              position: "relative",
              overflow: "hidden",
              border: `1px solid ${alpha(theme.palette.primary.main, isDark ? 0.08 : 0.04)}`,
              boxShadow: isDark
                ? "0 20px 40px rgba(0,0,0,0.3)"
                : "0 20px 50px rgba(15, 23, 42, 0.06)",
              background: isDark
                ? `linear-gradient(145deg, ${alpha(theme.palette.background.paper, 0.95)} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`
                : `linear-gradient(145deg, #ffffff 0%, #f4f7fb 100%)`,
            }}
          >
            {/* Subtle decorative glow */}
            <Box
              sx={{
                position: "absolute",
                top: "-20%",
                right: "-10%",
                width: "50%",
                height: "80%",
                background: `radial-gradient(ellipse at center, ${alpha(theme.palette.primary.main, 0.15)} 0%, transparent 70%)`,
                filter: "blur(60px)",
                zIndex: 0,
                pointerEvents: "none"
              }}
            />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  lg: "minmax(0, 1.1fr) minmax(320px, 0.9fr)",
                },
                gap: { xs: 3, md: 3.5 },
                alignItems: "center",
              }}
            >
              <Stack spacing={2.25} justifyContent="center">
                <Typography
                  sx={{
                    fontSize: "0.9rem",
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "primary.main",
                  }}
                >
                  {t("news.list.hero.eyebrow")}
                </Typography>

                <Typography
                  component="h1"
                  sx={{
                    fontWeight: 900,
                    fontSize: { xs: "2.15rem", md: "3.25rem" },
                    lineHeight: { xs: 1.04, md: 1.02 },
                    letterSpacing: "-0.04em",
                    maxWidth: "10ch",
                  }}
                >
                  {t("news.list.hero.title")}
                </Typography>

                <Typography
                  sx={{
                    fontSize: { xs: "1rem", md: "1.08rem" },
                    lineHeight: 1.75,
                    color: "text.secondary",
                    maxWidth: 680,
                  }}
                >
                  {t("news.list.hero.description")}
                </Typography>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    label={t("news.list.hero.publishedCount", {
                      count: publishedCount,
                    })}
                    variant="outlined"
                    sx={{
                      fontWeight: 700,
                      bgcolor: alpha(theme.palette.background.paper, 0.78),
                      borderColor: alpha(theme.palette.text.primary, 0.1),
                    }}
                  />
                  <Chip
                    label={t("news.list.hero.suggestedCount", {
                      count: suggestedItems.length || 0,
                    })}
                    variant="outlined"
                    sx={{
                      fontWeight: 700,
                      bgcolor: alpha(theme.palette.background.paper, 0.78),
                      borderColor: alpha(theme.palette.text.primary, 0.1),
                    }}
                  />
                  {heroLeadArticle ? (
                    <Chip
                      label={t("news.list.hero.latestDate", {
                        date: formatDate(
                          heroLeadArticle.originalPublishedAt || heroLeadArticle.createdAt,
                          locale
                        ),
                      })}
                      variant="outlined"
                      sx={{
                        fontWeight: 700,
                        bgcolor: alpha(theme.palette.background.paper, 0.78),
                        borderColor: alpha(theme.palette.text.primary, 0.1),
                      }}
                    />
                  ) : null}
                </Stack>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  {heroLeadArticle ? (
                    <Button
                      component={RouterLink}
                      to={`/news/${heroLeadArticle.slug}`}
                      variant="contained"
                      endIcon={<ArrowForwardIcon />}
                      sx={{
                        px: 2.25,
                        py: 1.1,
                        borderRadius: 999,
                        fontWeight: 800,
                        boxShadow: "none",
                      }}
                    >
                      {t("news.list.hero.readLatest")}
                    </Button>
                  ) : null}
                  <Button
                    component="a"
                    href={suggestedItems.length > 0 ? "#news-suggestions" : "#news-feed"}
                    variant="outlined"
                    sx={{
                      px: 2.25,
                      py: 1.1,
                      borderRadius: 999,
                      fontWeight: 800,
                      borderColor: alpha(theme.palette.text.primary, 0.12),
                      color: "text.primary",
                      bgcolor: alpha(theme.palette.background.paper, 0.72),
                    }}
                  >
                    {t("news.list.hero.viewHighlights")}
                  </Button>
                </Stack>

                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    maxWidth: 680,
                  }}
                >
                  {t("news.list.hero.note")}
                </Typography>
              </Stack>

              <Box
                sx={{
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    height: "100%",
                    borderRadius: 2,
                    overflow: "hidden",
                    border: `1px solid ${alpha(theme.palette.text.primary, 0.04)}`,
                    bgcolor: theme.palette.background.paper,
                    boxShadow: isDark
                      ? "0 8px 30px rgba(0,0,0,0.2)"
                      : "0 8px 30px rgba(15, 23, 42, 0.05)",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {heroLeadArticle?.heroImageUrl || heroLeadArticle?.thumbImageUrl ? (
                    <Box
                      sx={{
                        height: { xs: 180, md: 210 },
                        backgroundImage: `linear-gradient(180deg, transparent 0%, ${alpha(
                          "#020617",
                          0.22
                        )} 100%), url(${heroLeadArticle.heroImageUrl || heroLeadArticle.thumbImageUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        height: { xs: 180, md: 210 },
                        background: `linear-gradient(135deg, ${alpha(
                          theme.palette.primary.main,
                          0.82
                        )} 0%, ${alpha(theme.palette.info.main, 0.74)} 100%)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArticleIcon sx={{ fontSize: 72, color: "rgba(255,255,255,0.38)" }} />
                    </Box>
                  )}

                  <Stack spacing={1.4} sx={{ p: { xs: 2, md: 2.5 }, flex: 1 }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {heroLeadArticle ? renderBadge(heroLeadArticle.origin) : null}
                      <Chip
                        size="small"
                        label={formatDate(
                          heroLeadArticle?.originalPublishedAt || heroLeadArticle?.createdAt,
                          locale
                        )}
                        sx={{
                          fontWeight: 700,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                          color: "text.secondary",
                        }}
                      />
                    </Stack>

                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                        lineHeight: 1.12,
                        letterSpacing: "-0.03em",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {heroLeadArticle?.title ||
                        t("news.list.hero.previewFallbackTitle")}
                    </Typography>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {summarize(
                        heroLeadArticle?.summary ||
                          t("news.list.hero.previewFallbackSummary"),
                        150
                      )}
                    </Typography>

                    {heroLeadArticle ? (
                      <Button
                        component={RouterLink}
                        to={`/news/${heroLeadArticle.slug}`}
                        endIcon={<ArrowForwardIcon />}
                        sx={{
                          mt: "auto",
                          alignSelf: "flex-start",
                          px: 0,
                          fontWeight: 800,
                        }}
                      >
                        {t("common.openArticle")}
                      </Button>
                    ) : null}
                  </Stack>
                </Box>
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>

      {/* --- CONTENT --- */}
      <Container id="news-feed" maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
        {isLoading || isFetching ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        ) : null}

        {isError ? (
          <Alert severity="error" sx={{ mb: 4, borderRadius: 2 }}>
            {error?.data?.message || error?.error || t("news.list.loadError")}
          </Alert>
        ) : null}

        {!isLoading && !isFetching && !isError && items.length === 0 ? (
          <Alert severity="info" sx={{ mb: 4, borderRadius: 2 }}>
            {t("news.list.empty")}
          </Alert>
        ) : null}

        {suggestedItems.length > 0 && !isLoading && !isFetching && !isError ? (
          <Box id="news-suggestions" sx={{ mb: { xs: 6, md: 8 } }}>
            <Typography
              variant="h5"
              sx={{ fontWeight: 800, mb: 3, display: "flex", alignItems: "center", gap: 1 }}
            >
              <ArticleIcon color="primary" /> {t("news.list.suggestedTitle")}
            </Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
                gap: 2.5,
              }}
            >
              {suggestedItems.map((item) => (
                <Card
                  key={`suggest-${item.slug}`}
                  sx={{
                    borderRadius: 2,
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    boxShadow: isDark
                      ? "0 4px 12px rgba(0,0,0,0.2)"
                      : "0 4px 20px rgba(0,0,0,0.03)",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    "&:hover": {
                      transform: "translateY(-4px)",
                      boxShadow: isDark
                        ? "0 12px 28px rgba(0,0,0,0.4)"
                        : "0 12px 28px rgba(0,0,0,0.08)",
                      borderColor: alpha(theme.palette.primary.main, 0.2)
                    },
                  }}
                >
                  <CardActionArea
                    component={RouterLink}
                    to={`/news/${item.slug}`}
                    onClick={() => {
                      trackSeoNewsClick(item, { surface: "news-list-suggest-click" });
                      window.scrollTo(0, 0);
                    }}
                    sx={{
                      p: 2,
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                    }}
                  >
                    <Chip
                      size="small"
                      color="primary"
                      label={item.__suggestReason || t("news.list.suggestedFallback")}
                      sx={{ mb: 1.5, fontWeight: 700 }}
                    />
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 700,
                        lineHeight: 1.4,
                        mb: 1,
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
                        mb: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {summarize(item.summary, 100)}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ fontWeight: 600, mt: "auto" }}
                    >
                      {formatDate(item.originalPublishedAt || item.createdAt, locale)}
                    </Typography>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </Box>
        ) : null}

        {/* --- FEATURED ARTICLE --- */}
        {featuredArticle && !isLoading && !isFetching && (
          <Box sx={{ mb: { xs: 6, md: 8 } }}>
            <Typography variant="h5" sx={{ fontWeight: 800, mb: 3, display: "flex", alignItems: "center", gap: 1 }}>
              <ArticleIcon color="primary" /> {t("news.list.featuredTitle")}
            </Typography>
            <Card
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                boxShadow: isDark 
                  ? "0 8px 24px rgba(0,0,0,0.3)" 
                  : "0 8px 30px rgba(0,0,0,0.04)",
                transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: isDark 
                    ? "0 16px 40px rgba(0,0,0,0.4)" 
                    : "0 16px 40px rgba(0,0,0,0.08)",
                  borderColor: alpha(theme.palette.primary.main, 0.15)
                }
              }}
            >
              <CardActionArea 
                component={RouterLink} 
                to={`/news/${featuredArticle.slug}`}
                onClick={() =>
                  trackSeoNewsClick(featuredArticle, { surface: "news-featured-click" })
                }
                sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, height: "100%" }}
              >
                {/* Featured Image */}
                <Box
                  sx={{
                    width: { xs: "100%", md: "55%" },
                    position: "relative",
                  }}
                >
                  {featuredArticle.heroImageUrl || featuredArticle.thumbImageUrl ? (
                    <CardMedia
                      component="img"
                      image={featuredArticle.heroImageUrl || featuredArticle.thumbImageUrl}
                      alt={featuredArticle.title}
                      sx={{ height: { xs: 250, md: 400 }, objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        height: { xs: 250, md: 400 },
                        width: "100%",
                        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.7)} 0%, ${alpha(theme.palette.info.main, 0.7)} 100%)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Stack spacing={1} alignItems="center">
                        <ArticleIcon sx={{ fontSize: 80, color: "rgba(255,255,255,0.4)" }} />
                        {featuredArticle.imagePending ? (
                          <Chip
                            size="small"
                            label={t("news.list.pendingImage")}
                            sx={{
                              bgcolor: "rgba(255,255,255,0.16)",
                              color: "#fff",
                              fontWeight: 700,
                            }}
                          />
                        ) : null}
                      </Stack>
                    </Box>
                  )}
                  <Box sx={{ position: "absolute", top: 16, left: 16 }}>
                    {renderBadge(featuredArticle.origin)}
                  </Box>
                </Box>

                {/* Featured Content */}
                <CardContent
                  sx={{
                    width: { xs: "100%", md: "45%" },
                    p: { xs: 3, md: 5 },
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }}
                >
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                    {(featuredArticle.tags || []).slice(0, 3).map((tag) => (
                      <Chip key={tag} label={tag} size="small" sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.1), color: "primary.main" }} />
                    ))}
                  </Box>
                  
                  <Typography variant="h4" sx={{ fontWeight: 800, mb: 2, lineHeight: 1.3 }}>
                    {featuredArticle.title}
                  </Typography>

                  <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.7 }}>
                    {summarize(featuredArticle.summary, 220)}
                  </Typography>

                  <Stack direction="row" justifyContent="space-between" alignItems="center" mt="auto">
                    <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600 }}>
                      {formatDate(
                        featuredArticle.originalPublishedAt || featuredArticle.createdAt,
                        locale
                      )}
                    </Typography>
                    
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        color: "primary.main",
                        fontWeight: 700,
                        fontSize: "0.9rem"
                      }}
                    >
                      {t("news.list.readMore")} <ArrowForwardIcon fontSize="small" />
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Box>
        )}

        {/* --- NORMAL ARTICLES GRID --- */}
        {normalArticles.length > 0 && (
          <Box>
            {isFirstPage && (
              <Typography variant="h5" sx={{ fontWeight: 800, mb: 3 }}>
                {t("news.list.latestTitle")}
              </Typography>
            )}
            
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
                gap: 3,
              }}
            >
              {normalArticles.map((item) => (
                <Box key={item.slug}>
                  <Card
                    sx={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      borderRadius: 2,
                      border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                      boxShadow: isDark 
                        ? "0 4px 12px rgba(0,0,0,0.2)" 
                        : "0 8px 24px rgba(0,0,0,0.03)",
                      transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                      "&:hover": {
                        transform: "translateY(-4px)",
                        boxShadow: isDark 
                          ? "0 16px 32px rgba(0,0,0,0.4)" 
                          : "0 16px 32px rgba(0,0,0,0.08)",
                        borderColor: alpha(theme.palette.primary.main, 0.2),
                        "& .img-scalable": {
                          transform: "scale(1.03)",
                        }
                      }
                    }}
                  >
                    <CardActionArea 
                      component={RouterLink} 
                      to={`/news/${item.slug}`}
                      onClick={() =>
                        trackSeoNewsClick(item, { surface: "news-grid-click" })
                      }
                      sx={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start" }}
                    >
                      <Box sx={{ width: "100%", overflow: "hidden", position: "relative", bgcolor: "divider" }}>
                        {item.thumbImageUrl || item.heroImageUrl ? (
                          <CardMedia
                            component="img"
                            image={item.thumbImageUrl || item.heroImageUrl}
                            alt={item.title}
                            className="img-scalable"
                            sx={{ 
                              height: 200, 
                              objectFit: "cover",
                              transition: "transform 0.5s ease"
                            }}
                            loading="lazy"
                          />
                        ) : (
                          <Box
                            className="img-scalable"
                            sx={{
                              height: 200,
                              width: "100%",
                              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.7)} 0%, ${alpha(theme.palette.info.main, 0.7)} 100%)`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "transform 0.5s ease"
                            }}
                          >
                            <Stack spacing={1} alignItems="center">
                              <ArticleIcon sx={{ fontSize: 48, color: "rgba(255,255,255,0.4)" }} />
                              {item.imagePending ? (
                                <Chip
                                  size="small"
                                  label={t("news.list.pendingImage")}
                                  sx={{
                                    bgcolor: "rgba(255,255,255,0.16)",
                                    color: "#fff",
                                    fontWeight: 700,
                                  }}
                                />
                              ) : null}
                            </Stack>
                          </Box>
                        )}
                        <Box sx={{ position: "absolute", top: 12, left: 12 }}>
                          {renderBadge(item.origin)}
                        </Box>
                      </Box>

                      <CardContent sx={{ flexGrow: 1, width: "100%", display: "flex", flexDirection: "column" }}>
                        <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 600, mb: 1, display: "block" }}>
                          {formatDate(item.originalPublishedAt || item.createdAt, locale)}
                        </Typography>

                        <Typography 
                          variant="h6" 
                          sx={{ 
                            fontWeight: 700, 
                            lineHeight: 1.4, 
                            mb: 1.5,
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }}
                        >
                          {item.title}
                        </Typography>

                        <Typography 
                          variant="body2" 
                          color="text.secondary" 
                          sx={{ 
                            mb: 2, 
                            flexGrow: 1,
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }}
                        >
                          {summarize(item.summary, 120)}
                        </Typography>

                        <Divider sx={{ my: 1.5, borderColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" }} />
                        
                        <Typography variant="body2" color="primary" sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 0.5 }}>
                          {t("news.list.readMore")} <ArrowForwardIcon sx={{ fontSize: 16 }} />
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* --- PAGINATION --- */}
        {!isLoading && !isFetching && !isError && totalPages > 1 ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
            <Pagination
              color="primary"
              size="large"
              shape="rounded"
              page={page}
              count={totalPages}
              onChange={(_event, nextPage) => {
                const next = new URLSearchParams(searchParams);
                if (nextPage <= 1) next.delete("page");
                else next.set("page", String(nextPage));
                setSearchParams(next, { replace: true });
                window.scrollTo(0, 0);
              }}
              sx={{
                "& .MuiPaginationItem-root": {
                  fontWeight: 600,
                  fontSize: "1rem"
                }
              }}
            />
          </Box>
        ) : null}
      </Container>
    </Box>
  );
}

