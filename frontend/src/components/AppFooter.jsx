import Grid from "@mui/material/Grid";
import {
  Box,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link as RouterLink, useLocation } from "react-router-dom";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";

import { useLanguage } from "../context/LanguageContext.jsx";

const CURRENT_YEAR = new Date().getFullYear();

export default function AppFooter() {
  const theme = useTheme();
  const location = useLocation();
  const { t } = useLanguage();

  const quickLinks = [
    { label: t("footer.links.news"), to: "/news" },
    { label: t("footer.links.clubs"), to: "/clubs" },
    { label: t("footer.links.contact"), to: "/contact" },
    { label: t("footer.links.status"), to: "/status" },
  ];

  const legalLinks = [
    { label: t("footer.links.cookies"), to: "/cookies" },
    { label: t("footer.links.privacy"), to: "/privacy" },
    { label: t("footer.links.terms"), to: "/terms" },
  ];

  const scrollToTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const isActiveRoute = (path) => {
    if (path === "/") return location.pathname === "/";
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  const linkSx = (path) => ({
    color: isActiveRoute(path) ? "primary.main" : "text.secondary",
    fontWeight: isActiveRoute(path) ? 700 : 600,
    textDecoration: "none",
    transition: "color 0.2s ease",
    "&:hover": {
      color: "primary.main",
    },
  });

  return (
    <Box
      component="footer"
      id="site-footer"
      sx={{
        mt: "auto",
        pt: { xs: 3.5, md: 4.5 },
        pb: { xs: 2.5, md: 3 },
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          p: { xs: 2, md: 3 },
          borderRadius: 4,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          boxShadow:
            theme.palette.mode === "dark"
              ? "0 18px 40px rgba(0,0,0,0.22)"
              : "0 18px 40px rgba(15, 23, 42, 0.06)",
        }}
      >
        <Grid container spacing={{ xs: 2.5, md: 3 }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6" fontWeight={800}>
                PickleTour
              </Typography>

              <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
                {t("footer.description")}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                {t("footer.supportLabel")}{" "}
                <MuiLink href="mailto:support@pickletour.vn">
                  support@pickletour.vn
                </MuiLink>
              </Typography>
            </Stack>
          </Grid>

          <Grid size={{ xs: 6, md: 3 }}>
            <Stack spacing={1.25}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ letterSpacing: 1.1 }}
              >
                {t("footer.quickLinks")}
              </Typography>
              {quickLinks.map((item) => (
                <MuiLink
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  onClick={scrollToTop}
                  underline="none"
                  sx={linkSx(item.to)}
                >
                  {item.label}
                </MuiLink>
              ))}
            </Stack>
          </Grid>

          <Grid size={{ xs: 6, md: 4 }}>
            <Stack spacing={1.25}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ letterSpacing: 1.1 }}
              >
                {t("footer.policies")}
              </Typography>
              {legalLinks.map((item) => (
                <MuiLink
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  onClick={scrollToTop}
                  underline="none"
                  sx={{
                    ...linkSx(item.to),
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.75,
                  }}
                >
                  {item.label}
                  <LaunchRoundedIcon sx={{ fontSize: 15 }} />
                </MuiLink>
              ))}
            </Stack>
          </Grid>
        </Grid>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("footer.rights", { year: CURRENT_YEAR })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("footer.compliance")}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}
