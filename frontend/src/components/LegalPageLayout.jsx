import PropTypes from "prop-types";
import Grid from "@mui/material/Grid";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { Link as RouterLink } from "react-router-dom";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import SEOHead from "./SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";

function LegalSection({ section, isLast }) {
  return (
    <Box
      id={section.id}
      sx={{
        scrollMarginTop: { xs: 88, md: 120 },
        pb: isLast ? 0 : 3,
      }}
    >
      <Typography variant="h5" fontWeight={800} sx={{ mb: 1.25 }}>
        {section.title}
      </Typography>

      <Stack spacing={1.25}>
        {section.paragraphs?.map((paragraph) => (
          <Typography
            key={paragraph}
            color="text.secondary"
            sx={{ lineHeight: 1.8 }}
          >
            {paragraph}
          </Typography>
        ))}

        {section.items?.length ? (
          <Stack component="ul" spacing={1} sx={{ pl: 2.5, m: 0 }}>
            {section.items.map((item) => (
              <Typography
                key={item}
                component="li"
                color="text.secondary"
                sx={{ lineHeight: 1.75 }}
              >
                {item}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

LegalSection.propTypes = {
  section: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    paragraphs: PropTypes.arrayOf(PropTypes.string),
    items: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
  isLast: PropTypes.bool.isRequired,
};

export default function LegalPageLayout({
  title,
  description,
  path,
  eyebrow,
  updatedAt,
  highlights,
  sections,
}) {
  const theme = useTheme();
  const { t } = useLanguage();

  return (
    <>
      <SEOHead title={title} description={description} path={path} />

      <Box sx={{ backgroundColor: "background.default" }}>
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
          <Stack spacing={{ xs: 2.5, md: 3 }}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2.25, md: 4 },
                borderRadius: 5,
                border: "1px solid",
                borderColor: "divider",
                backgroundColor: "background.paper",
                backgroundImage:
                  theme.palette.mode === "dark"
                    ? `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.14)}, transparent)`
                    : `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.06)}, transparent)`,
              }}
            >
              <Stack spacing={2.25}>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  <Chip
                    size="small"
                    label={eyebrow}
                    sx={{
                      borderRadius: 999,
                      bgcolor: alpha(theme.palette.primary.main, 0.08),
                      color: "primary.main",
                      fontWeight: 700,
                    }}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("common.updatedAt", { date: updatedAt })}
                    sx={{ borderRadius: 999, fontWeight: 600 }}
                  />
                </Stack>

                <Box>
                  <Typography variant="h3" fontWeight={900} sx={{ mb: 1.25 }}>
                    {title}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    sx={{ maxWidth: 760, lineHeight: 1.8 }}
                  >
                    {description}
                  </Typography>
                </Box>

                <Grid container spacing={1.5}>
                  {highlights.map((item) => (
                    <Grid key={item.label} size={{ xs: 12, sm: 4 }}>
                      <Box
                        sx={{
                          p: 1.75,
                          borderRadius: 3,
                          border: "1px solid",
                          borderColor: alpha(theme.palette.primary.main, 0.14),
                          bgcolor: alpha(theme.palette.primary.main, 0.05),
                          height: "100%",
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {item.label}
                        </Typography>
                        <Typography
                          variant="body1"
                          fontWeight={800}
                          sx={{ mt: 0.5 }}
                        >
                          {item.value}
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
              </Stack>
            </Paper>

            <Grid container spacing={{ xs: 2.5, md: 3 }}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 2.25, md: 3.25 },
                    borderRadius: 5,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                  }}
                >
                  <Stack spacing={3}>
                    {sections.map((section, index) => (
                      <Box key={section.id}>
                        <LegalSection
                          section={section}
                          isLast={index === sections.length - 1}
                        />
                        {index < sections.length - 1 ? (
                          <Divider sx={{ mt: 3 }} />
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Stack
                  spacing={2.5}
                  sx={{ position: { md: "sticky" }, top: { md: 112 } }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      p: { xs: 2, md: 2.5 },
                      borderRadius: 4,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack spacing={1.25}>
                      <Typography
                        variant="overline"
                        color="text.secondary"
                        sx={{ letterSpacing: 1.1 }}
                      >
                        {t("legal.layout.mainSections")}
                      </Typography>
                      {sections.map((section, index) => (
                        <MuiLink
                          key={section.id}
                          href={`#${section.id}`}
                          underline="none"
                          sx={{
                            color: "text.primary",
                            fontWeight: 700,
                            display: "inline-flex",
                            gap: 1,
                            alignItems: "center",
                            "&:hover": { color: "primary.main" },
                          }}
                        >
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                            sx={{ minWidth: 18 }}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </Typography>
                          <Typography
                            component="span"
                            variant="body2"
                            fontWeight={700}
                          >
                            {section.title}
                          </Typography>
                        </MuiLink>
                      ))}
                    </Stack>
                  </Paper>

                  <Paper
                    elevation={0}
                    sx={{
                      p: { xs: 2, md: 2.5 },
                      borderRadius: 4,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Stack spacing={1.4}>
                      <Typography variant="h6" fontWeight={800}>
                        {t("legal.layout.needMoreHelpTitle")}
                      </Typography>
                      <Typography
                        color="text.secondary"
                        sx={{ lineHeight: 1.75 }}
                      >
                        {t("legal.layout.needMoreHelpBody")}
                      </Typography>
                      <Button
                        component={RouterLink}
                        to="/contact"
                        onClick={() =>
                          window.scrollTo({ top: 0, left: 0, behavior: "auto" })
                        }
                        variant="outlined"
                        endIcon={<ArrowForwardRoundedIcon />}
                        sx={{
                          alignSelf: "flex-start",
                          borderRadius: 999,
                          px: 2,
                        }}
                      >
                        {t("legal.layout.goToContact")}
                      </Button>
                    </Stack>
                  </Paper>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </Container>
      </Box>
    </>
  );
}

LegalPageLayout.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  path: PropTypes.string.isRequired,
  eyebrow: PropTypes.string.isRequired,
  updatedAt: PropTypes.string.isRequired,
  highlights: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    }),
  ).isRequired,
  sections: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      paragraphs: PropTypes.arrayOf(PropTypes.string),
      items: PropTypes.arrayOf(PropTypes.string),
    }),
  ).isRequired,
};
