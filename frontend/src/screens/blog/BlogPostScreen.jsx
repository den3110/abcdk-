import { useMemo } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";

import SEOHead from "../../components/SEOHead";
import { useThemeMode } from "../../context/ThemeContext";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useGetBlogPostBySlugQuery } from "../../slices/blogApiSlice";

function formatDateTime(value, locale = "vi-VN") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
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

export default function BlogPostScreen() {
  const { slug } = useParams();
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const { locale } = useLanguage();

  const {
    data: post,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetBlogPostBySlugQuery(slug, {
    skip: !slug,
  });

  const publishedAt = post?.publishedAt || post?.createdAt;
  const description = useMemo(() => {
    if (post?.summary) return String(post.summary).slice(0, 180);
    return extractPlainText(post?.contentHtml).slice(0, 180);
  }, [post]);

  if (isLoading) {
    return (
      <Container sx={{ py: 10, textAlign: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (isError || !post) {
    return (
      <Container sx={{ py: 8 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={refetch}>
              Thử lại
            </Button>
          }
        >
          {error?.data?.message || "Không tải được bài viết."}
        </Alert>
      </Container>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: isDark ? "#050505" : "#f8fafc",
        color: isDark ? "#f8fafc" : "#111827",
        py: { xs: 4, md: 7 },
      }}
    >
      <SEOHead path={`/blog/${post.slug}`} title={post.title} description={description} />
      <Container maxWidth="md">
        <Button
          component={RouterLink}
          to="/"
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 3 }}
        >
          Về trang chủ
        </Button>

        <Box
          sx={{
            bgcolor: isDark ? "rgba(255,255,255,0.06)" : "#fff",
            border: "1px solid",
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "divider",
            borderRadius: 2,
            p: { xs: 2.5, md: 4 },
          }}
        >
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={post.authorName || "PickleTour"} size="small" />
              {publishedAt ? (
                <Chip
                  icon={<CalendarTodayIcon />}
                  label={formatDateTime(publishedAt, locale)}
                  size="small"
                  variant="outlined"
                />
              ) : null}
            </Stack>

            <Box>
              <Typography
                component="h1"
                sx={{
                  fontSize: { xs: "2rem", md: "3rem" },
                  lineHeight: 1.12,
                  fontWeight: 800,
                  letterSpacing: 0,
                }}
              >
                {post.title}
              </Typography>
              {post.summary ? (
                <Typography
                  sx={{
                    mt: 2,
                    color: isDark ? "rgba(248,250,252,0.72)" : "text.secondary",
                    fontSize: "1.08rem",
                    lineHeight: 1.7,
                  }}
                >
                  {post.summary}
                </Typography>
              ) : null}
            </Box>

            {post.heroImageUrl ? (
              <Box
                component="img"
                src={post.heroImageUrl}
                alt={post.title}
                sx={{
                  width: "100%",
                  maxHeight: 420,
                  objectFit: "cover",
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: isDark ? "rgba(255,255,255,0.12)" : "divider",
                }}
              />
            ) : null}

            <Divider />

            <Box
              className="blog-post-content"
              sx={{
                color: isDark ? "rgba(248,250,252,0.88)" : "#1f2937",
                fontSize: "1rem",
                lineHeight: 1.85,
                "& p": { mb: 2 },
                "& h2": {
                  fontSize: { xs: "1.45rem", md: "1.75rem" },
                  mt: 4,
                  mb: 1.5,
                  color: isDark ? "#f8fafc" : "#111827",
                },
                "& h3": {
                  fontSize: { xs: "1.2rem", md: "1.35rem" },
                  mt: 3,
                  mb: 1,
                  color: isDark ? "#f8fafc" : "#111827",
                },
                "& a": {
                  color: theme.palette.primary.main,
                  fontWeight: 700,
                },
              }}
              dangerouslySetInnerHTML={{ __html: post.contentHtml || "" }}
            />
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
