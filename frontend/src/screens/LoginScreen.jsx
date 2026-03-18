import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  AlternateEmailRounded,
  ArrowOutwardRounded,
  CalendarMonthRounded,
  LeaderboardRounded,
  LockRounded,
  PlayCircleRounded,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";
import { setCredentials } from "../slices/authSlice";
import apiSlice from "../slices/apiSlice";
import { useLoginMutation } from "../slices/usersApiSlice";

const WEB_LOGO_PATH = "/icon-192.png";

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isDark = theme.palette.mode === "dark";
  const { t } = useLanguage();

  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate("/");
  }, [userInfo, navigate]);

  const highlights = useMemo(
    () => [
      {
        icon: CalendarMonthRounded,
        title: t("auth.login.highlights.tournaments.title"),
        body: t("auth.login.highlights.tournaments.body"),
      },
      {
        icon: LeaderboardRounded,
        title: t("auth.login.highlights.ranking.title"),
        body: t("auth.login.highlights.ranking.body"),
      },
      {
        icon: PlayCircleRounded,
        title: t("auth.login.highlights.live.title"),
        body: t("auth.login.highlights.live.body"),
      },
    ],
    [t]
  );

  const quickChips = useMemo(
    () => [
      t("auth.login.chips.schedule"),
      t("auth.login.chips.live"),
      t("auth.login.chips.community"),
    ],
    [t]
  );

  const submitHandler = async (e) => {
    e.preventDefault();

    const cleanIdentifier = String(identifier || "").trim();
    const cleanPassword = String(password || "");

    try {
      const res = await login({
        identifier: cleanIdentifier,
        password: cleanPassword,
      }).unwrap();

      dispatch(setCredentials({ ...res }));
      dispatch(apiSlice.util.resetApiState());
      navigate("/");
    } catch (err) {
      toast.error(err?.data?.message || err?.error || t("auth.login.errors.failed"));
    }
  };

  const surface = isDark ? alpha("#071722", 0.88) : alpha("#ffffff", 0.84);
  const softSurface = isDark ? alpha("#0d2231", 0.6) : alpha("#ffffff", 0.58);
  const textPrimary = isDark ? "#eaf7ff" : "#062235";
  const textSecondary = isDark ? alpha("#d7ecf7", 0.76) : alpha("#21455b", 0.76);
  const accentMain = isDark ? "#67ddff" : "#0d8bb8";
  const accentAlt = isDark ? "#92f3a3" : "#15a05e";

  return (
    <Box
      sx={{
        position: "relative",
        minHeight: "100dvh",
        overflow: "hidden",
        background: isDark
          ? "linear-gradient(180deg, #05111a 0%, #081c28 42%, #0b2130 100%)"
          : "linear-gradient(180deg, #eef8fd 0%, #d9eef8 42%, #cbe6f3 100%)",
      }}
    >
      <SEOHead title={t("auth.login.seoTitle")} />

      <Box
        aria-hidden="true"
        sx={{
          position: "absolute",
          inset: 0,
          background: isDark
            ? `
              radial-gradient(circle at 12% 14%, ${alpha("#39d4ff", 0.18)} 0, transparent 28%),
              radial-gradient(circle at 88% 18%, ${alpha("#9ef095", 0.14)} 0, transparent 24%),
              radial-gradient(circle at 72% 78%, ${alpha("#00c2ff", 0.16)} 0, transparent 30%)
            `
            : `
              radial-gradient(circle at 12% 14%, ${alpha("#3ab6dd", 0.18)} 0, transparent 28%),
              radial-gradient(circle at 88% 18%, ${alpha("#42c979", 0.12)} 0, transparent 24%),
              radial-gradient(circle at 72% 78%, ${alpha("#00a5d8", 0.16)} 0, transparent 30%)
            `,
        }}
      />

      <Box
        aria-hidden="true"
        sx={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 0.45 : 0.38,
          backgroundImage: `
            linear-gradient(${alpha("#ffffff", 0.18)} 1px, transparent 1px),
            linear-gradient(90deg, ${alpha("#ffffff", 0.12)} 1px, transparent 1px),
            radial-gradient(circle at 50% 50%, ${alpha("#ffffff", 0.28)} 0 1.5px, transparent 1.5px)
          `,
          backgroundSize: "120px 120px, 120px 120px, 220px 220px",
          backgroundPosition: "0 0, 0 0, center center",
          maskImage:
            "linear-gradient(180deg, rgba(0,0,0,0.95), rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.18))",
        }}
      />

      <Container
        component="main"
        maxWidth="lg"
        sx={{
          position: "relative",
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          py: { xs: 2.5, sm: 4, md: 5 },
        }}
      >
        <Box
          sx={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0,1.08fr) minmax(360px,0.92fr)" },
            gap: { xs: 2, sm: 2.5, md: 4 },
            alignItems: "stretch",
          }}
        >
          <Paper
            elevation={0}
            sx={{
              order: { xs: 2, md: 1 },
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: { xs: "auto", md: 620 },
              borderRadius: { xs: 5, md: 8 },
              overflow: "hidden",
              p: { xs: 2.25, sm: 3, md: 4 },
              color: textPrimary,
              background: isDark
                ? `linear-gradient(160deg, ${alpha("#08131b", 0.84)} 0%, ${alpha(
                    "#0e2938",
                    0.92
                  )} 100%)`
                : `linear-gradient(160deg, ${alpha("#09344a", 0.88)} 0%, ${alpha(
                    "#0b5975",
                    0.84
                  )} 100%)`,
              border: `1px solid ${alpha("#ffffff", isDark ? 0.08 : 0.18)}`,
              boxShadow: isDark
                ? "0 30px 80px rgba(0, 0, 0, 0.28)"
                : "0 30px 80px rgba(9, 43, 66, 0.18)",
              position: "relative",
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                inset: 0,
                background: `
                  radial-gradient(circle at 18% 20%, ${alpha("#90f5a3", 0.12)} 0, transparent 26%),
                  radial-gradient(circle at 86% 16%, ${alpha("#67ddff", 0.18)} 0, transparent 22%)
                `,
                pointerEvents: "none",
              }}
            />

            <Stack spacing={{ xs: 2, md: 3 }} sx={{ position: "relative", zIndex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1.25}>
                <Box
                  sx={{
                    width: { xs: 52, md: 58 },
                    height: { xs: 52, md: 58 },
                    borderRadius: 3.5,
                    display: "grid",
                    placeItems: "center",
                    bgcolor: alpha("#ffffff", 0.12),
                    border: `1px solid ${alpha("#ffffff", 0.16)}`,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <Box
                    component="img"
                    src={WEB_LOGO_PATH}
                    alt="PickleTour"
                    sx={{
                      width: { xs: 34, md: 40 },
                      height: { xs: 34, md: 40 },
                      objectFit: "contain",
                    }}
                  />
                </Box>
                <Stack spacing={0.35}>
                  <Chip
                    label={t("auth.login.brandBadge")}
                    size="small"
                    sx={{
                      width: "fit-content",
                      height: 28,
                      borderRadius: 99,
                      color: "#f6fbff",
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      bgcolor: alpha("#ffffff", 0.1),
                      border: `1px solid ${alpha("#ffffff", 0.18)}`,
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{ color: alpha("#ffffff", 0.72), letterSpacing: 0.2 }}
                  >
                    PickleTour
                  </Typography>
                </Stack>
              </Stack>

              <Box>
                <Typography
                  variant={isMobile ? "h4" : "h3"}
                  sx={{
                    fontWeight: 800,
                    lineHeight: 1.08,
                    letterSpacing: "-0.03em",
                    maxWidth: 620,
                  }}
                >
                  {t("auth.login.brandTitle")}
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    mt: 1.5,
                    maxWidth: 540,
                    color: textSecondary,
                    lineHeight: 1.7,
                  }}
                >
                  {t("auth.login.brandBody")}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {quickChips.map((label) => (
                  <Chip
                    key={label}
                    label={label}
                    sx={{
                      borderRadius: 99,
                      height: 32,
                      bgcolor: alpha("#ffffff", 0.12),
                      color: "#f4fbff",
                      border: `1px solid ${alpha("#ffffff", 0.14)}`,
                      fontWeight: 600,
                    }}
                  />
                ))}
              </Stack>
            </Stack>

            <Stack
              spacing={1.25}
              sx={{
                mt: { xs: 2.25, md: 5 },
                display: { xs: "none", md: "grid" },
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                position: "relative",
                zIndex: 1,
              }}
            >
              {highlights.map(({ icon: Icon, title, body }) => (
                <Box
                  key={title}
                  sx={{
                    p: 2.1,
                    borderRadius: 4,
                    background: alpha("#ffffff", 0.08),
                    border: `1px solid ${alpha("#ffffff", 0.12)}`,
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 3,
                      display: "grid",
                      placeItems: "center",
                      mb: 1.4,
                      color: "#062235",
                      bgcolor: title === highlights[1].title ? accentAlt : accentMain,
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Typography sx={{ fontWeight: 700, mb: 0.75 }}>{title}</Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: alpha("#ffffff", 0.74), lineHeight: 1.6 }}
                  >
                    {body}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>

          <Paper
            elevation={0}
            sx={{
              order: { xs: 1, md: 2 },
              p: { xs: 2.25, sm: 3, md: 4 },
              borderRadius: { xs: 5, md: 8 },
              border: `1px solid ${alpha(isDark ? "#8fdfff" : "#0f6282", isDark ? 0.14 : 0.12)}`,
              background: surface,
              backdropFilter: "blur(18px)",
              boxShadow: isDark
                ? "0 28px 70px rgba(0, 0, 0, 0.28)"
                : "0 28px 70px rgba(8, 49, 75, 0.14)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <Stack spacing={{ xs: 2.25, md: 2.8 }}>
              <Stack spacing={1.25}>
                <Typography
                  variant="overline"
                  sx={{
                    color: accentMain,
                    fontWeight: 800,
                    letterSpacing: "0.16em",
                    lineHeight: 1,
                  }}
                >
                  {t("auth.login.formLabel")}
                </Typography>

                <Box>
                  <Typography
                    component="h1"
                    variant={isMobile ? "h4" : "h3"}
                    sx={{
                      color: textPrimary,
                      fontWeight: 800,
                      letterSpacing: "-0.03em",
                      lineHeight: 1.08,
                    }}
                  >
                    {t("auth.login.welcome")}
                  </Typography>
                  <Typography
                    variant={isMobile ? "body2" : "body1"}
                    sx={{
                      mt: 1.1,
                      color: textSecondary,
                      lineHeight: 1.7,
                      maxWidth: 420,
                    }}
                  >
                    {t("auth.login.subtitle")}
                  </Typography>
                </Box>
              </Stack>

              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 3.5,
                  bgcolor: softSurface,
                  border: `1px solid ${alpha(isDark ? "#8fdfff" : "#0f6282", isDark ? 0.1 : 0.08)}`,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ color: textSecondary, lineHeight: 1.65 }}
                >
                  {t("auth.login.helper")}
                </Typography>
              </Box>

              <Box component="form" onSubmit={submitHandler}>
                <Stack spacing={2}>
                  <TextField
                    required
                    fullWidth
                    id="identifier"
                    label={t("auth.login.identifierLabel")}
                    name="identifier"
                    autoComplete="username"
                    autoFocus
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 4,
                        backgroundColor: alpha(isDark ? "#0b2230" : "#ffffff", 0.72),
                        minHeight: 58,
                        "& fieldset": {
                          borderColor: alpha(
                            isDark ? "#8fdfff" : "#0f6282",
                            isDark ? 0.14 : 0.12
                          ),
                        },
                        "&:hover fieldset": {
                          borderColor: alpha(accentMain, 0.42),
                        },
                        "&.Mui-focused fieldset": {
                          borderColor: accentMain,
                          boxShadow: `0 0 0 4px ${alpha(accentMain, 0.12)}`,
                        },
                      },
                      "& .MuiInputLabel-root.Mui-focused": {
                        color: accentMain,
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <AlternateEmailRounded sx={{ color: accentMain }} />
                        </InputAdornment>
                      ),
                    }}
                  />

                  <TextField
                    required
                    fullWidth
                    name="password"
                    label={t("auth.login.passwordLabel")}
                    type={showPassword ? "text" : "password"}
                    id="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 4,
                        backgroundColor: alpha(isDark ? "#0b2230" : "#ffffff", 0.72),
                        minHeight: 58,
                        "& fieldset": {
                          borderColor: alpha(
                            isDark ? "#8fdfff" : "#0f6282",
                            isDark ? 0.14 : 0.12
                          ),
                        },
                        "&:hover fieldset": {
                          borderColor: alpha(accentMain, 0.42),
                        },
                        "&.Mui-focused fieldset": {
                          borderColor: accentMain,
                          boxShadow: `0 0 0 4px ${alpha(accentMain, 0.12)}`,
                        },
                      },
                      "& .MuiInputLabel-root.Mui-focused": {
                        color: accentMain,
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockRounded sx={{ color: accentMain }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword((prev) => !prev)}
                            edge="end"
                            aria-label="toggle password visibility"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    size="large"
                    endIcon={!isLoading ? <ArrowOutwardRounded /> : null}
                    sx={{
                      mt: "4px !important",
                      minHeight: 58,
                      borderRadius: 4,
                      fontSize: "1rem",
                      fontWeight: 800,
                      textTransform: "none",
                      color: "#04131d",
                      background: `linear-gradient(135deg, ${accentMain} 0%, ${accentAlt} 100%)`,
                      boxShadow: `0 20px 32px ${alpha(accentMain, 0.24)}`,
                      "&:hover": {
                        background: `linear-gradient(135deg, ${accentMain} 0%, ${accentAlt} 100%)`,
                        transform: "translateY(-1px)",
                        boxShadow: `0 24px 40px ${alpha(accentMain, 0.32)}`,
                      },
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <CircularProgress size={24} sx={{ color: "#062235" }} />
                    ) : (
                      t("auth.login.submit")
                    )}
                  </Button>

                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={{ xs: 1, sm: 1.25 }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    sx={{ pt: 0.5 }}
                  >
                    <Link
                      component={RouterLink}
                      to="/forgot-password"
                      underline="none"
                      sx={{
                        color: accentMain,
                        fontWeight: 700,
                        "&:hover": { opacity: 0.8 },
                      }}
                    >
                      {t("auth.login.forgot")}
                    </Link>
                    <Link
                      component={RouterLink}
                      to="/register"
                      underline="none"
                      sx={{
                        color: isDark ? "#f0fbff" : "#0a3147",
                        fontWeight: 700,
                        "&:hover": { opacity: 0.8 },
                      }}
                    >
                      {t("auth.login.register")}
                    </Link>
                  </Stack>
                </Stack>
              </Box>

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ display: { xs: "flex", md: "none" } }}
              >
                {highlights.map(({ icon: Icon, title }) => (
                  <Chip
                    key={title}
                    icon={<Icon sx={{ color: `${accentMain} !important` }} />}
                    label={title}
                    sx={{
                      bgcolor: softSurface,
                      borderRadius: 99,
                      color: textPrimary,
                      border: `1px solid ${alpha(
                        isDark ? "#8fdfff" : "#0f6282",
                        isDark ? 0.12 : 0.08
                      )}`,
                    }}
                  />
                ))}
              </Stack>
            </Stack>
          </Paper>
        </Box>
      </Container>
    </Box>
  );
}
