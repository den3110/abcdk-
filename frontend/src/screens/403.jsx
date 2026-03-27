// src/pages/Forbidden403.jsx
import { Box, Button, Container, Stack, Typography } from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import { useNavigate, useLocation } from "react-router-dom";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function Forbidden403() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, locale } = useLanguage();
  const from = location.state?.from?.pathname || "/";

  return (
    <Container
      maxWidth="md"
      sx={{ minHeight: "100vh", display: "flex", alignItems: "center" }}
    >
      <SEOHead title={t("errors.forbidden.seoTitle")} noIndex={true} />
      <Box sx={{ width: "100%", textAlign: "center", py: { xs: 6, md: 10 } }}>
        <BlockIcon sx={{ fontSize: { xs: 56, md: 80 }, mb: 1 }} color="error" />
        <Typography
          variant="h1"
          sx={{
            fontWeight: 800,
            lineHeight: 1,
            fontSize: "clamp(64px, 18vw, 140px)",
            letterSpacing: -2,
          }}
        >
          403
        </Typography>
        <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
          {t("errors.forbidden.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.5 }}>
          {t("errors.forbidden.description")}
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          justifyContent="center"
          sx={{ mt: 3 }}
        >
          <Button variant="contained" onClick={() => navigate("/")}>
            {t("common.actions.backHome")}
          </Button>
          <Button variant="outlined" onClick={() => navigate(-1)}>
            {t("common.actions.back")}
          </Button>
          <Button
            variant="text"
            onClick={() => navigate("/login", { state: { redirectTo: from } })}
          >
            {t("errors.forbidden.login")}
          </Button>
        </Stack>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 3 }}
        >
          {t("common.labels.statusCode")}: 403 •{" "}
          {new Date().toLocaleString(locale)}
        </Typography>
      </Box>
    </Container>
  );
}
