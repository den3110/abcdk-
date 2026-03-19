import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  CircularProgress,
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
  ArrowOutwardRounded,
  CalendarMonthRounded,
  LeaderboardRounded,
  LockRounded,
  PhoneIphoneRounded,
  PlayCircleRounded,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import LogoAnimationMorph from "../components/LogoAnimationMorph.jsx";
import SEOHead from "../components/SEOHead";
import { useLanguage } from "../context/LanguageContext.jsx";
import { setCredentials } from "../slices/authSlice";
import apiSlice from "../slices/apiSlice";
import { useLoginMutation } from "../slices/usersApiSlice";

const WEB_LOGO_PATH = "/icon-192.png";

function ShowcaseVisual({ kind, accent, compact = false }) {
  if (kind === "live") {
    return (
      <Stack spacing={compact ? 0.8 : 1.1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box
            sx={{
              px: compact ? 0.7 : 1,
              py: compact ? 0.28 : 0.4,
              borderRadius: 99,
              bgcolor: alpha(accent, 0.18),
              color: accent,
              fontSize: compact ? 9 : 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            LIVE
          </Box>
          <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>
            Court A
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="baseline" justifyContent="space-between">
          <Box>
            <Typography
              sx={{
                color: "#ffffff",
                fontSize: compact ? 20 : 28,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              11
            </Typography>
            <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>
              Team A
            </Typography>
          </Box>
          <Typography
            sx={{
              color: alpha("#ffffff", 0.28),
              fontSize: compact ? 16 : 20,
              fontWeight: 700,
            }}
          >
            :
          </Typography>
          <Box sx={{ textAlign: "right" }}>
            <Typography
              sx={{
                color: "#ffffff",
                fontSize: compact ? 20 : 28,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              08
            </Typography>
            <Typography sx={{ color: alpha("#ffffff", 0.58), fontSize: compact ? 10 : 12 }}>
              Team B
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            height: compact ? 5 : 6,
            borderRadius: 99,
            bgcolor: alpha("#ffffff", 0.08),
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              width: "68%",
              height: "100%",
              borderRadius: 99,
              background: `linear-gradient(90deg, ${accent} 0%, ${alpha(accent, 0.5)} 100%)`,
            }}
          />
        </Box>
      </Stack>
    );
  }

  if (kind === "ranking") {
    return (
      <Stack spacing={compact ? 0.75 : 1}>
        {[1, 2, 3].map((rank, index) => (
          <Stack key={rank} direction="row" spacing={compact ? 0.8 : 1.1} alignItems="center">
            <Box
              sx={{
                width: compact ? 18 : 24,
                height: compact ? 18 : 24,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                bgcolor: index === 0 ? accent : alpha("#ffffff", 0.08),
                color: index === 0 ? "#04110b" : "#ffffff",
                fontSize: compact ? 9 : 11,
                fontWeight: 800,
              }}
            >
              {rank}
            </Box>
            <Box
              sx={{
                flex: 1,
                height: compact ? 6 : 8,
                borderRadius: 99,
                bgcolor: alpha("#ffffff", 0.08),
                overflow: "hidden",
              }}
            >
              <Box
                sx={{
                  width: `${86 - index * 18}%`,
                  height: "100%",
                  borderRadius: 99,
                  background:
                    index === 0
                      ? `linear-gradient(90deg, ${accent} 0%, ${alpha(accent, 0.56)} 100%)`
                      : alpha("#ffffff", 0.26),
                }}
              />
            </Box>
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={compact ? 0.75 : 1}>
      {[0, 1, 2].map((row) => (
        <Stack key={row} direction="row" spacing={compact ? 0.75 : 1} alignItems="center">
          <Box
            sx={{
              width: (compact ? 30 : 44) - row * (compact ? 4 : 6),
              height: compact ? 6 : 8,
              borderRadius: 99,
              bgcolor: row === 0 ? accent : alpha("#ffffff", 0.14),
            }}
          />
          <Box sx={{ flex: 1, height: 1, bgcolor: alpha("#ffffff", 0.12) }} />
          <Box
            sx={{
              width: (compact ? 20 : 30) + row * (compact ? 9 : 12),
              height: compact ? 6 : 8,
              borderRadius: 99,
              bgcolor: alpha("#ffffff", 0.1),
            }}
          />
        </Stack>
      ))}

      <Stack direction="row" spacing={1}>
        <Box
          sx={{ flex: 1, height: compact ? 6 : 8, borderRadius: 99, bgcolor: alpha("#ffffff", 0.08) }}
        />
        <Box
          sx={{
            width: compact ? 44 : 64,
            height: compact ? 6 : 8,
            borderRadius: 99,
            bgcolor: alpha(accent, 0.82),
          }}
        />
      </Stack>
    </Stack>
  );
}

ShowcaseVisual.propTypes = {
  kind: PropTypes.string.isRequired,
  accent: PropTypes.string.isRequired,
  compact: PropTypes.bool,
};

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activeShowcase, setActiveShowcase] = useState(0);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isCompactMobile = useMediaQuery("(max-width:480px)");
  const isDark = theme.palette.mode === "dark";
  const { t } = useLanguage();

  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useSelector((state) => state.auth);
  const returnTo = useMemo(() => {
    const qs = new URLSearchParams(location.search || "");
    const next = String(qs.get("returnTo") || "/").trim();
    return next.startsWith("/") ? next : "/";
  }, [location.search]);

  useEffect(() => {
    if (userInfo) navigate(returnTo, { replace: true });
  }, [userInfo, navigate, returnTo]);

  const showcaseItems = useMemo(
    () => [
      {
        icon: CalendarMonthRounded,
        label: t("auth.login.chips.schedule"),
        title: t("auth.login.highlights.tournaments.title"),
        body: t("auth.login.highlights.tournaments.body"),
        accent: "#dbff55",
        kind: "schedule",
      },
      {
        icon: PlayCircleRounded,
        label: t("auth.login.chips.live"),
        title: t("auth.login.highlights.live.title"),
        body: t("auth.login.highlights.live.body"),
        accent: "#7f68ff",
        kind: "live",
      },
      {
        icon: LeaderboardRounded,
        label: t("auth.login.chips.community"),
        title: t("auth.login.highlights.ranking.title"),
        body: t("auth.login.highlights.ranking.body"),
        accent: "#abd6ff",
        kind: "ranking",
      },
    ],
    [t]
  );

  useEffect(() => {
    if (showcaseItems.length < 2) return undefined;
    const timer = setInterval(() => {
      setActiveShowcase((prev) => (prev + 1) % showcaseItems.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [showcaseItems.length]);

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
      navigate(returnTo, { replace: true });
    } catch (err) {
      toast.error(err?.data?.message || err?.error || t("auth.login.errors.failed"));
    }
  };

  const activeCard = showcaseItems[activeShowcase];
  const topCard = showcaseItems[(activeShowcase + 1) % showcaseItems.length];
  const bottomCard = showcaseItems[(activeShowcase + 2) % showcaseItems.length];
  const ActiveIcon = activeCard.icon;

  const shellBackground = isDark ? alpha("#0b1419", 0.94) : "#fbfbfa";
  const formTextPrimary = isDark ? "#f2f8fb" : "#0c1116";
  const formTextSecondary = isDark ? alpha("#d5e4ec", 0.72) : alpha("#24323d", 0.68);
  const fieldBackground = isDark ? alpha("#111b22", 0.96) : "#ffffff";
  const fieldBorder = alpha(isDark ? "#b6ebff" : "#111827", isDark ? 0.14 : 0.1);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: isDark ? "#081017" : "#ffffff",
      }}
    >
      <SEOHead title={t("auth.login.seoTitle")} />

      <Box
        aria-hidden="true"
        sx={{
          display: "none",
        }}
      />

      <Box
        component="main"
        sx={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "stretch",
          py: 0,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: "100%",
            height: "100%",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            overflow: "hidden",
            borderRadius: 0,
            background: shellBackground,
            border: 0,
            boxShadow: "none",
          }}
        >
          <Box
            sx={{
              position: "relative",
              zIndex: 2,
              height: { xs: 48, md: 50 },
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "49% 51%" },
              alignItems: "center",
              borderBottom: { xs: `1px solid ${alpha(isDark ? "#d8eef7" : "#101820", 0.08)}`, md: 0 },
            }}
          >
            <Box sx={{ display: { xs: "none", md: "block" } }} />

            <Box
              sx={{
                px: { xs: 2, sm: 2.5, md: 3 },
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  minWidth: 0,
                  transform: { xs: "scale(0.86)", md: "none" },
                  transformOrigin: "left center",
                }}
              >
                <LogoAnimationMorph isMobile={false} showBackButton={false} />
              </Box>

              <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center">
                <Typography
                  variant="body2"
                  sx={{
                    display: { xs: "none", md: "block" },
                    color: formTextSecondary,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("auth.login.registerPrompt")}
                </Typography>
                <Link
                  component={RouterLink}
                  to="/register"
                  underline="hover"
                  sx={{
                    color: formTextPrimary,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("auth.login.register")}
                </Link>
              </Stack>
            </Box>
          </Box>

          <Box
            sx={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "49% 51%" },
              gridTemplateRows: { xs: "minmax(230px, 36vh) minmax(0, 1fr)", md: "1fr" },
              mt: { xs: 0, md: "-50px" },
              height: { xs: "auto", md: "calc(100% + 50px)" },
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                position: "relative",
                overflow: "hidden",
                p: 0,
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr) auto",
                minHeight: 0,
                height: "100%",
                background:
                  "linear-gradient(180deg, #062e21 0%, #04271c 48%, #032117 100%)",
                color: "#f7fffb",
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: "absolute",
                  inset: 0,
                  background: `
                    radial-gradient(circle at 10% 12%, ${alpha("#d9ff58", 0.1)} 0, transparent 20%),
                    radial-gradient(circle at 86% 20%, ${alpha("#7f68ff", 0.18)} 0, transparent 18%),
                    radial-gradient(circle at 72% 78%, ${alpha("#91d2ff", 0.16)} 0, transparent 20%)
                  `,
                  pointerEvents: "none",
                }}
              />

              <Stack
                spacing={{ xs: 2, md: 2.75 }}
                sx={{
                  position: "relative",
                  zIndex: 1,
                  px: { xs: 1.4, sm: 2.75, md: 3.5 },
                  pt: { xs: 1.2, sm: 2.75, md: 3 },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  sx={{ display: { xs: "none", sm: "flex" } }}
                >
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: 2.5,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: alpha("#ffffff", 0.08),
                      border: `1px solid ${alpha("#ffffff", 0.1)}`,
                    }}
                  >
                    <Box
                      component="img"
                      src={WEB_LOGO_PATH}
                      alt="PickleTour"
                      sx={{ width: 28, height: 28, objectFit: "contain" }}
                    />
                  </Box>
                  <Typography
                    sx={{
                      fontSize: { xs: 24, md: 28 },
                      lineHeight: 1,
                      fontWeight: 900,
                      letterSpacing: "-0.04em",
                      color: "#e6ff49",
                    }}
                  >
                    PICKLETOUR
                  </Typography>
                </Stack>

                <Box sx={{ maxWidth: 380 }}>
                  <Typography
                    sx={{
                      color: alpha("#ffffff", 0.62),
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t("auth.login.brandBadge")}
                  </Typography>
                  <Typography
                    variant={isMobile ? "h6" : "h4"}
                    sx={{
                      mt: { xs: 0.3, md: 1 },
                      fontWeight: 800,
                      lineHeight: 1.08,
                      letterSpacing: "-0.04em",
                      fontSize: { xs: "0.92rem", sm: undefined, md: undefined },
                    }}
                  >
                    {t("auth.login.brandTitle")}
                  </Typography>
                  <Typography
                    sx={{
                      mt: 1,
                      display: { xs: "none", sm: "block" },
                      color: alpha("#ffffff", 0.72),
                      lineHeight: 1.7,
                      fontSize: { xs: 14, md: 15 },
                    }}
                  >
                    {t("auth.login.brandBody")}
                  </Typography>
                </Box>
              </Stack>

              <Box
                sx={{
                  position: "relative",
                  zIndex: 1,
                  minHeight: { xs: 150, sm: 220, md: 340 },
                  mt: { xs: -0.25, md: 1.5 },
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    position: "absolute",
                    top: { xs: 22, md: 18 },
                    right: { xs: 18, md: 34 },
                    width: { xs: 58, md: 104 },
                    height: { xs: 58, md: 104 },
                    borderRadius: 4,
                    bgcolor: "#7d64ff",
                    transform: "rotate(10deg)",
                  }}
                />
                <Box
                  aria-hidden="true"
                  sx={{
                    position: "absolute",
                    bottom: { xs: 22, md: 26 },
                    right: { xs: 50, md: 74 },
                    width: { xs: 64, md: 118 },
                    height: { xs: 64, md: 118 },
                    borderRadius: 4,
                    bgcolor: "#b8d8ff",
                    transform: "rotate(-5deg)",
                  }}
                />

                <Paper
                  elevation={0}
                  sx={{
                    position: "absolute",
                    zIndex: 2,
                    top: { xs: 72, md: 68 },
                    left: { xs: "21%", md: "16%" },
                    width: { xs: "58%", md: "62%" },
                    maxWidth: 400,
                    p: { xs: 1.15, md: 2.4 },
                    borderRadius: 4,
                    color: "#ffffff",
                    background: "linear-gradient(180deg, #0b2017 0%, #091a13 100%)",
                    border: `1px solid ${alpha("#ffffff", 0.08)}`,
                    boxShadow: "0 24px 48px rgba(0, 0, 0, 0.32)",
                    transform: { xs: "rotate(-4deg)", md: "rotate(-5deg)" },
                    transition: "all 320ms ease",
                  }}
                >
                  <Stack spacing={1.6}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Box
                          sx={{
                            width: 34,
                            height: 34,
                            borderRadius: 2.5,
                            display: "grid",
                            placeItems: "center",
                            bgcolor: activeCard.accent,
                            color: "#061108",
                            transform: { xs: "scale(0.88)", md: "none" },
                          }}
                        >
                          <ActiveIcon fontSize="small" />
                        </Box>
                        <Typography
                          sx={{
                            fontSize: { xs: 9, md: 11 },
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: activeCard.accent,
                          }}
                        >
                          {activeCard.label}
                        </Typography>
                      </Stack>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: 99,
                          bgcolor: activeCard.accent,
                          boxShadow: `0 0 0 6px ${alpha(activeCard.accent, 0.12)}`,
                        }}
                      />
                    </Stack>

                    <Box>
                      <Typography sx={{ fontSize: { xs: 12, md: 22 }, fontWeight: 800 }}>
                        {activeCard.title}
                      </Typography>
                      <Typography
                        sx={{
                          mt: 0.7,
                          color: alpha("#ffffff", 0.68),
                          fontSize: 13,
                          lineHeight: 1.6,
                          display: { xs: "none", sm: "-webkit-box" },
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {activeCard.body}
                      </Typography>
                    </Box>

                    <ShowcaseVisual
                      kind={activeCard.kind}
                      accent={activeCard.accent}
                      compact={isMobile}
                    />
                  </Stack>
                </Paper>

                {[topCard, bottomCard].map((card, index) => {
                  const CardIcon = card.icon;

                  return (
                    <Paper
                      key={card.title}
                      elevation={0}
                      sx={{
                        position: "absolute",
                        zIndex: index === 0 ? 3 : 1,
                        top: index === 0 ? { xs: 54, md: 34 } : { xs: 118, md: 210 },
                        right: index === 0 ? { xs: 10, md: 16 } : "auto",
                        left: index === 0 ? "auto" : { xs: 6, md: 22 },
                        width: index === 0 ? { xs: "22%", md: 232 } : { xs: "24%", md: 244 },
                        p: { xs: 0.85, md: 1.8 },
                        borderRadius: 4,
                        color: "#ffffff",
                        background: "linear-gradient(180deg, #10261c 0%, #0a1d15 100%)",
                        border: `1px solid ${alpha("#ffffff", 0.08)}`,
                        boxShadow: "0 18px 40px rgba(0, 0, 0, 0.26)",
                        transform: index === 0 ? { xs: "rotate(4deg)", md: "rotate(5deg)" } : { xs: "rotate(-3deg)", md: "rotate(-4deg)" },
                      }}
                    >
                      <Stack spacing={1.25}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box
                            sx={{
                              width: 28,
                              height: 28,
                              borderRadius: 2,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: alpha(card.accent, 0.18),
                              color: card.accent,
                              transform: { xs: "scale(0.82)", md: "none" },
                            }}
                          >
                            <CardIcon sx={{ fontSize: 18 }} />
                          </Box>
                          <Typography
                            sx={{
                              color: alpha("#ffffff", 0.9),
                              fontSize: { xs: 8.5, md: 13 },
                              fontWeight: 700,
                              lineHeight: 1.25,
                            }}
                          >
                            {card.title}
                          </Typography>
                        </Stack>
                        <ShowcaseVisual
                          kind={card.kind}
                          accent={card.accent}
                          compact={isCompactMobile}
                        />
                      </Stack>
                    </Paper>
                  );
                })}
              </Box>

              <Stack
                spacing={1.5}
                sx={{
                  position: "relative",
                  zIndex: 1,
                  px: { xs: 2.25, sm: 2.75, md: 3.5 },
                  pb: { xs: 1.5, md: 2.25 },
                  pt: { xs: 0.75, md: 1.5 },
                }}
              >
                <Paper
                  elevation={0}
                  sx={{
                    display: { xs: "none", sm: "block" },
                    p: { xs: 2, md: 2.2 },
                    borderRadius: 4,
                    background: alpha("#ffffff", 0.07),
                    border: `1px solid ${alpha("#ffffff", 0.1)}`,
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha("#ffffff", 0.92),
                      fontSize: { xs: 14, md: 15 },
                      lineHeight: 1.8,
                    }}
                  >
                    {t("auth.login.testimonial.quote")}
                  </Typography>

                  <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mt: 2 }}>
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: 99,
                        background:
                          "linear-gradient(135deg, rgba(219,255,85,0.95) 0%, rgba(127,104,255,0.95) 100%)",
                      }}
                    />
                    <Box>
                      <Typography sx={{ color: "#ffffff", fontWeight: 700, fontSize: 14 }}>
                        {t("auth.login.testimonial.author")}
                      </Typography>
                      <Typography sx={{ color: alpha("#ffffff", 0.6), fontSize: 12 }}>
                        {t("auth.login.testimonial.role")}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>

                <Stack direction="row" spacing={0.8} justifyContent="center">
                  {showcaseItems.map((item, index) => (
                    <Box
                      key={item.title}
                      sx={{
                        width: index === activeShowcase ? 22 : 6,
                        height: 6,
                        borderRadius: 99,
                        bgcolor:
                          index === activeShowcase ? alpha("#ffffff", 0.92) : alpha("#ffffff", 0.28),
                        transition: "all 220ms ease",
                      }}
                    />
                  ))}
                </Stack>
              </Stack>
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxSizing: "border-box",
                px: { xs: 2, sm: 3, md: 4 },
                pb: { xs: 2, sm: 3, md: 4 },
                pt: { xs: 2, sm: 3, md: "50px" },
                background: isDark ? alpha("#0c1419", 0.92) : "#fbfbfa",
              }}
            >
              <Box sx={{ width: "100%", maxWidth: 430 }}>
                <Stack spacing={{ xs: 2, md: 2.75 }}>
                  <Box>
                    <Typography
                      component="h1"
                      variant={isMobile ? "h4" : "h3"}
                      sx={{
                        color: formTextPrimary,
                        fontWeight: 800,
                        lineHeight: 1.08,
                        letterSpacing: "-0.04em",
                      }}
                    >
                      {t("auth.login.welcome")}
                    </Typography>
                    <Typography
                      sx={{
                        mt: 1,
                        color: formTextSecondary,
                        lineHeight: 1.75,
                        fontSize: { xs: 14, md: 15 },
                        maxWidth: 360,
                      }}
                    >
                      {t("auth.login.subtitle")}
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
                        type="tel"
                        autoComplete="tel"
                        autoFocus
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        inputProps={{ inputMode: "tel" }}
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: 3.5,
                            backgroundColor: fieldBackground,
                            minHeight: { xs: 54, md: 58 },
                            "& fieldset": {
                              borderColor: fieldBorder,
                            },
                            "&:hover fieldset": {
                              borderColor: alpha("#091118", 0.28),
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#0b1115",
                              boxShadow: `0 0 0 4px ${alpha("#0b1115", 0.08)}`,
                            },
                          },
                          "& .MuiInputLabel-root.Mui-focused": {
                            color: formTextPrimary,
                          },
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <PhoneIphoneRounded sx={{ color: alpha(formTextPrimary, 0.56) }} />
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
                            borderRadius: 3.5,
                            backgroundColor: fieldBackground,
                            minHeight: { xs: 54, md: 58 },
                            "& fieldset": {
                              borderColor: fieldBorder,
                            },
                            "&:hover fieldset": {
                              borderColor: alpha("#091118", 0.28),
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: "#0b1115",
                              boxShadow: `0 0 0 4px ${alpha("#0b1115", 0.08)}`,
                            },
                          },
                          "& .MuiInputLabel-root.Mui-focused": {
                            color: formTextPrimary,
                          },
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <LockRounded sx={{ color: alpha(formTextPrimary, 0.56) }} />
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
                          mt: "6px !important",
                          minHeight: { xs: 54, md: 58 },
                          borderRadius: 99,
                          fontSize: "1rem",
                          fontWeight: 800,
                          textTransform: "none",
                          color: "#ffffff",
                          background: "#070b10",
                          boxShadow: "0 20px 34px rgba(7, 11, 16, 0.16)",
                          "&:hover": {
                            background: "#000000",
                            boxShadow: "0 24px 40px rgba(7, 11, 16, 0.2)",
                          },
                        }}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <CircularProgress size={24} sx={{ color: "#ffffff" }} />
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
                            color: alpha(formTextPrimary, 0.88),
                            fontWeight: 700,
                            "&:hover": { opacity: 0.72 },
                          }}
                        >
                          {t("auth.login.forgot")}
                        </Link>

                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          sx={{ display: { xs: "flex", md: "none" } }}
                        >
                          <Typography sx={{ color: formTextSecondary, fontSize: 14 }}>
                            {t("auth.login.registerPrompt")}
                          </Typography>
                          <Link
                            component={RouterLink}
                            to="/register"
                            underline="hover"
                            sx={{ color: formTextPrimary, fontWeight: 700 }}
                          >
                            {t("auth.login.register")}
                          </Link>
                        </Stack>
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
