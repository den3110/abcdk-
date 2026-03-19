import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { skipToken } from "@reduxjs/toolkit/query";
import { alpha } from "@mui/material/styles";
import {
  ArrowForwardRounded,
  CheckCircleRounded,
  ErrorOutlineRounded,
  LockOpenRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SEOHead from "../components/SEOHead.jsx";
import {
  useApproveOAuthAuthorizeMutation,
  useGetOAuthAuthorizeContextQuery,
} from "../slices/oauthApiSlice.js";

const REQUIRED_QUERY_FIELDS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "state",
  "code_challenge",
  "code_challenge_method",
];

function buildSearchString(searchParams) {
  const next = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (value != null && String(value).trim() !== "") {
      next.set(key, value);
    }
  }
  return next.toString();
}

function buildCancelRedirect(redirectUri, state) {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    return url.toString();
  } catch {
    return redirectUri || "/";
  }
}

function validateAuthorizeRequest(searchParams) {
  const missing = REQUIRED_QUERY_FIELDS.filter(
    (key) => !String(searchParams.get(key) || "").trim()
  );
  if (missing.length > 0) {
    return `Yêu cầu ủy quyền không hợp lệ. Thiếu ${missing.join(", ")}.`;
  }

  if (String(searchParams.get("response_type") || "").trim() !== "code") {
    return "Yêu cầu ủy quyền không hợp lệ. response_type phải là code.";
  }

  return "";
}

function buildLoginUrl() {
  const current = `${window.location.pathname}${window.location.search}`;
  return `/login?returnTo=${encodeURIComponent(current)}`;
}

function SurfaceCard({ children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        width: "100%",
        maxWidth: 720,
        borderRadius: { xs: 4, sm: 5 },
        px: { xs: 2.75, sm: 4.5 },
        py: { xs: 3, sm: 4.5 },
        bgcolor: "#ffffff",
        border: "1px solid rgba(21, 72, 146, 0.08)",
        boxShadow: "0 24px 80px rgba(23, 72, 145, 0.12)",
      }}
    >
      {children}
    </Paper>
  );
}

function StatusCard({ icon, eyebrow, title, description, tone = "info" }) {
  const tones = {
    info: {
      bg: "#f4f9ff",
      border: "rgba(44, 123, 229, 0.18)",
      color: "#1457b5",
    },
    success: {
      bg: "#f2fbf7",
      border: "rgba(46, 171, 112, 0.2)",
      color: "#1d8f5d",
    },
    warning: {
      bg: "#fff8ef",
      border: "rgba(221, 137, 43, 0.22)",
      color: "#b86a14",
    },
    danger: {
      bg: "#fff4f4",
      border: "rgba(227, 90, 90, 0.2)",
      color: "#c43b3b",
    },
  };

  const palette = tones[tone] || tones.info;
  const IconComponent = icon;

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 3,
        bgcolor: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          sx={{
            width: 42,
            height: 42,
            borderRadius: 2.5,
            display: "grid",
            placeItems: "center",
            bgcolor: alpha(palette.color, 0.12),
            color: palette.color,
            flexShrink: 0,
          }}
        >
          <IconComponent fontSize="small" />
        </Box>
        <Box>
          {eyebrow ? (
            <Typography
              sx={{
                color: palette.color,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                mb: 0.5,
              }}
            >
              {eyebrow}
            </Typography>
          ) : null}
          <Typography
            sx={{ color: "#10233f", fontWeight: 800, fontSize: { xs: 18, sm: 20 } }}
          >
            {title}
          </Typography>
          <Typography sx={{ color: "rgba(16,35,63,0.72)", mt: 0.75, lineHeight: 1.65 }}>
            {description}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

function MetaTile({ label, value, accent = "#1759cf" }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        p: 1.75,
        borderRadius: 3,
        bgcolor: "#f8fbff",
        border: "1px solid rgba(24, 88, 207, 0.08)",
      }}
    >
      <Typography
        sx={{
          color: alpha(accent, 0.78),
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          color: "#12223b",
          fontSize: 16,
          fontWeight: 700,
          mt: 0.65,
          wordBreak: "break-word",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export default function OAuthAuthorizeScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const search = useMemo(() => buildSearchString(searchParams), [searchParams]);
  const validationError = useMemo(
    () => validateAuthorizeRequest(searchParams),
    [searchParams]
  );

  const requestBody = useMemo(
    () => ({
      client_id: searchParams.get("client_id") || "",
      redirect_uri: searchParams.get("redirect_uri") || "",
      response_type: searchParams.get("response_type") || "",
      scope: searchParams.get("scope") || "openid profile",
      state: searchParams.get("state") || "",
      code_challenge: searchParams.get("code_challenge") || "",
      code_challenge_method: searchParams.get("code_challenge_method") || "",
      os_auth_token: searchParams.get("os_auth_token") || "",
    }),
    [searchParams]
  );

  const queryArg = validationError ? skipToken : search;
  const { data, isLoading, isFetching, error } = useGetOAuthAuthorizeContextQuery(
    queryArg,
    {
      refetchOnMountOrArgChange: true,
    }
  );
  const [approve, { isLoading: isApproving }] = useApproveOAuthAuthorizeMutation();

  const shouldRedirectToLogin =
    !validationError &&
    data?.authenticated === false &&
    Boolean(data?.loginUrl);

  useEffect(() => {
    if (shouldRedirectToLogin) {
      navigate(data.loginUrl, { replace: true });
    }
  }, [data?.loginUrl, navigate, shouldRedirectToLogin]);

  const apiMessage =
    data?.message ||
    error?.data?.message ||
    "Không thể kiểm tra quyền dùng PickleTour Live.";
  const invalidMessage =
    validationError ||
    (error?.data?.reason === "invalid_request" ? apiMessage : "");
  const manageableTournaments = data?.manageableTournaments || [];
  const isBusy = !validationError && (isLoading || isFetching || shouldRedirectToLogin);
  const isReady = !isBusy && !invalidMessage && data?.authenticated && data?.canAuthorize;
  const isDenied =
    !isBusy &&
    !invalidMessage &&
    data?.authenticated &&
    data?.canAuthorize === false;
  const hasGenericError = !isBusy && !invalidMessage && !isReady && !isDenied && Boolean(error);

  const handleApprove = async () => {
    try {
      const res = await approve(requestBody).unwrap();
      if (res?.redirectTo) {
        window.location.replace(res.redirectTo);
      }
    } catch (approveError) {
      console.log("[oauth-authorize] approve failed", approveError);
    }
  };

  const handleCancel = () => {
    const redirectTo = buildCancelRedirect(
      requestBody.redirect_uri,
      requestBody.state
    );
    window.location.replace(redirectTo);
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #f7fbff 0%, #eef7ff 46%, #fffdf7 100%)",
        display: "grid",
        placeItems: "center",
        px: { xs: 2, sm: 3 },
        py: { xs: 3, sm: 6 },
      }}
    >
      <SEOHead title="Ủy quyền PickleTour Live" />

      <SurfaceCard>
        <Stack spacing={3}>
          <Box>
            <Typography
              sx={{
                color: "#1b67dd",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              PickleTour
            </Typography>
            <Typography
              variant="h3"
              sx={{
                mt: 1,
                color: "#101f37",
                fontWeight: 900,
                fontSize: { xs: 34, sm: 42 },
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
              }}
            >
              Ủy quyền PickleTour Live
            </Typography>
            <Typography
              sx={{
                mt: 1.25,
                color: "rgba(16,31,55,0.72)",
                fontSize: { xs: 16, sm: 17 },
                lineHeight: 1.7,
                maxWidth: 560,
              }}
            >
              Xác nhận cho phép PickleTour Live dùng phiên đăng nhập PickleTour
              của bạn để vào app live và quản lý các giải bạn được cấp quyền.
            </Typography>
          </Box>

          {isBusy ? (
            <StatusCard
              icon={LockOpenRounded}
              eyebrow={shouldRedirectToLogin ? "Đang chuyển trang" : "Đang xác thực"}
              title={
                shouldRedirectToLogin
                  ? "Đang chuyển bạn tới màn đăng nhập"
                  : "Đang kiểm tra phiên PickleTour"
              }
              description={
                shouldRedirectToLogin
                  ? "Nếu bạn chưa đăng nhập, PickleTour sẽ mở màn đăng nhập rồi quay lại bước cấp quyền."
                  : "Hệ thống đang xác nhận tài khoản và quyền dùng PickleTour Live của bạn."
              }
              tone="info"
            />
          ) : null}

          {invalidMessage ? (
            <>
              <StatusCard
                icon={ErrorOutlineRounded}
                eyebrow="Yêu cầu không hợp lệ"
                title="Không thể mở màn cấp quyền"
                description={invalidMessage}
                tone="warning"
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  variant="contained"
                  onClick={() => navigate("/", { replace: true })}
                  sx={{
                    py: 1.2,
                    px: 2.2,
                    borderRadius: 99,
                    bgcolor: "#1b67dd",
                    fontWeight: 700,
                  }}
                >
                  Về trang chủ
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate(buildLoginUrl(), { replace: true })}
                  sx={{
                    py: 1.2,
                    px: 2.2,
                    borderRadius: 99,
                    borderColor: "rgba(27,103,221,0.2)",
                    color: "#164ea5",
                    fontWeight: 700,
                  }}
                >
                  Đăng nhập lại
                </Button>
              </Stack>
            </>
          ) : null}

          {hasGenericError ? (
            <>
              <StatusCard
                icon={ErrorOutlineRounded}
                eyebrow="Lỗi hệ thống"
                title="Chưa thể kiểm tra quyền cấp quyền"
                description={apiMessage}
                tone="danger"
              />
              <Button
                variant="contained"
                onClick={() => window.location.reload()}
                sx={{
                  alignSelf: "flex-start",
                  py: 1.2,
                  px: 2.2,
                  borderRadius: 99,
                  bgcolor: "#1b67dd",
                  fontWeight: 700,
                }}
              >
                Thử lại
              </Button>
            </>
          ) : null}

          {isDenied ? (
            <>
              <StatusCard
                icon={ErrorOutlineRounded}
                eyebrow="Chưa có quyền live"
                title="Tài khoản này chưa thể dùng PickleTour Live"
                description={
                  data?.message ||
                  "Bạn cần quyền admin hoặc quyền quản lý ít nhất một giải đấu để dùng app live."
                }
                tone="warning"
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  variant="contained"
                  onClick={() => navigate("/", { replace: true })}
                  sx={{
                    py: 1.2,
                    px: 2.2,
                    borderRadius: 99,
                    bgcolor: "#1b67dd",
                    fontWeight: 700,
                  }}
                >
                  Về trang chủ
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => navigate(buildLoginUrl(), { replace: true })}
                  sx={{
                    py: 1.2,
                    px: 2.2,
                    borderRadius: 99,
                    borderColor: "rgba(27,103,221,0.2)",
                    color: "#164ea5",
                    fontWeight: 700,
                  }}
                >
                  Đăng nhập tài khoản khác
                </Button>
              </Stack>
            </>
          ) : null}

          {isReady ? (
            <>
              <Stack spacing={1.75}>
                <StatusCard
                  icon={CheckCircleRounded}
                  eyebrow="Sẵn sàng cấp quyền"
                  title="PickleTour Live đang xin quyền truy cập"
                  description="Bạn chỉ cấp quyền cho app live dùng phiên đăng nhập hiện tại để vào ứng dụng và quản lý các giải được phép."
                  tone="success"
                />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <MetaTile
                    label="Tài khoản"
                    value={
                      data?.user?.name ||
                      data?.user?.nickname ||
                      data?.user?.email ||
                      "PickleTour User"
                    }
                  />
                  <MetaTile
                    label="Quyền"
                    value={data?.roleSummary || "PickleTour Live"}
                  />
                </Stack>
              </Stack>

              <Divider />

              <Stack spacing={1.4}>
                <Typography
                  sx={{
                    color: "#10223b",
                    fontSize: 18,
                    fontWeight: 800,
                  }}
                >
                  Giải được phép live
                </Typography>

                {manageableTournaments.length > 0 ? (
                  <Stack spacing={1}>
                    {manageableTournaments.slice(0, 6).map((tournament) => (
                      <Box
                        key={tournament._id}
                        sx={{
                          px: 1.75,
                          py: 1.5,
                          borderRadius: 3,
                          bgcolor: "#f6fbff",
                          border: "1px solid rgba(24,88,207,0.08)",
                        }}
                      >
                        <Typography sx={{ color: "#10223b", fontWeight: 700 }}>
                          {tournament.name}
                        </Typography>
                        <Typography
                          sx={{
                            color: "rgba(16,34,59,0.62)",
                            fontSize: 13,
                            mt: 0.25,
                          }}
                        >
                          {tournament.status || "active"}
                        </Typography>
                      </Box>
                    ))}
                    {manageableTournaments.length > 6 ? (
                      <Typography sx={{ color: "rgba(16,34,59,0.66)", fontSize: 14 }}>
                        Và thêm {manageableTournaments.length - 6} giải khác.
                      </Typography>
                    ) : null}
                  </Stack>
                ) : (
                  <Typography sx={{ color: "rgba(16,34,59,0.68)", lineHeight: 1.7 }}>
                    Tài khoản admin sẽ dùng danh sách giải hiện có của hệ thống.
                  </Typography>
                )}
              </Stack>

              <Divider />

              <Stack
                direction={{ xs: "column-reverse", sm: "row" }}
                spacing={1.5}
                justifyContent="space-between"
              >
                <Button
                  variant="outlined"
                  onClick={handleCancel}
                  disabled={isApproving}
                  sx={{
                    py: 1.2,
                    px: 2.2,
                    borderRadius: 99,
                    borderColor: "rgba(27,103,221,0.2)",
                    color: "#164ea5",
                    fontWeight: 700,
                  }}
                >
                  Hủy
                </Button>
                <Button
                  variant="contained"
                  endIcon={
                    isApproving ? (
                      <CircularProgress size={18} sx={{ color: "#ffffff" }} />
                    ) : (
                      <ArrowForwardRounded />
                    )
                  }
                  onClick={handleApprove}
                  disabled={isApproving}
                  sx={{
                    py: 1.2,
                    px: 2.4,
                    borderRadius: 99,
                    bgcolor: "#1b67dd",
                    color: "#ffffff",
                    fontWeight: 800,
                    "&:hover": {
                      bgcolor: "#1557bc",
                    },
                  }}
                >
                  {isApproving ? "Đang cấp quyền..." : "Cho phép"}
                </Button>
              </Stack>
            </>
          ) : null}
        </Stack>
      </SurfaceCard>
    </Box>
  );
}
