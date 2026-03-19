import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import SEOHead from "../components/SEOHead.jsx";
import {
  useApproveOAuthAuthorizeMutation,
  useGetOAuthAuthorizeContextQuery,
} from "../slices/oauthApiSlice.js";

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

export default function OAuthAuthorizeScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const search = useMemo(() => buildSearchString(searchParams), [searchParams]);
  const requestBody = useMemo(
    () => ({
      client_id: searchParams.get("client_id") || "",
      redirect_uri: searchParams.get("redirect_uri") || "",
      response_type: searchParams.get("response_type") || "code",
      scope: searchParams.get("scope") || "openid profile",
      state: searchParams.get("state") || "",
      code_challenge: searchParams.get("code_challenge") || "",
      code_challenge_method: searchParams.get("code_challenge_method") || "S256",
      os_auth_token: searchParams.get("os_auth_token") || "",
    }),
    [searchParams]
  );

  const { data, isLoading, error } = useGetOAuthAuthorizeContextQuery(search, {
    refetchOnMountOrArgChange: true,
  });
  const [approve, { isLoading: isApproving }] = useApproveOAuthAuthorizeMutation();

  useEffect(() => {
    if (data?.authenticated === false && data?.loginUrl) {
      navigate(data.loginUrl, { replace: true });
    }
  }, [data, navigate]);

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

  const manageableTournaments = data?.manageableTournaments || [];
  const canAuthorize = data?.canAuthorize !== false;
  const denyMessage =
    data?.message ||
    error?.data?.message ||
    "Không thể cấp quyền cho PickleTour Live.";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#081017",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 4,
      }}
    >
      <SEOHead title="Ủy quyền PickleTour Live" />
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 640,
          borderRadius: 4,
          p: { xs: 3, md: 4 },
          bgcolor: "#101820",
          color: "#f7fbff",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Stack spacing={2.5}>
          <Box>
            <Typography
              variant="overline"
              sx={{ color: "#7cc0ff", letterSpacing: "0.08em" }}
            >
              PICKLETOUR
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              Ủy quyền PickleTour Live
            </Typography>
            <Typography sx={{ color: "rgba(255,255,255,0.72)", mt: 1 }}>
              Xác nhận cho phép PickleTour Live dùng phiên đăng nhập PickleTour của
              bạn để vào app live và quản lý các giải bạn có quyền.
            </Typography>
          </Box>

          {isLoading ? (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <CircularProgress size={22} />
              <Typography>Đang kiểm tra phiên PickleTour...</Typography>
            </Stack>
          ) : null}

          {!isLoading && !canAuthorize ? (
            <Alert severity="error" variant="filled">
              {denyMessage}
            </Alert>
          ) : null}

          {!isLoading && data?.authenticated && canAuthorize ? (
            <>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 3,
                  bgcolor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <Typography sx={{ fontWeight: 700 }}>
                  {data?.user?.name ||
                    data?.user?.nickname ||
                    data?.user?.email ||
                    "PickleTour User"}
                </Typography>
                <Typography
                  sx={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}
                >
                  {data?.user?.email || data?.user?.phone || data?.roleSummary || ""}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>
                  Giải được phép live
                </Typography>
                {manageableTournaments.length > 0 ? (
                  <Stack spacing={1}>
                    {manageableTournaments.slice(0, 6).map((tournament) => (
                      <Box
                        key={tournament._id}
                        sx={{
                          px: 1.5,
                          py: 1,
                          borderRadius: 2,
                          bgcolor: "rgba(127, 200, 255, 0.08)",
                        }}
                      >
                        <Typography sx={{ fontWeight: 600 }}>
                          {tournament.name}
                        </Typography>
                        <Typography
                          sx={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}
                        >
                          {tournament.status || "active"}
                        </Typography>
                      </Box>
                    ))}
                    {manageableTournaments.length > 6 ? (
                      <Typography
                        sx={{ color: "rgba(255,255,255,0.66)", fontSize: 13 }}
                      >
                        Và thêm {manageableTournaments.length - 6} giải khác.
                      </Typography>
                    ) : null}
                  </Stack>
                ) : (
                  <Typography sx={{ color: "rgba(255,255,255,0.66)" }}>
                    Tài khoản admin sẽ dùng danh sách giải hiện có của hệ thống.
                  </Typography>
                )}
              </Box>

              <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1.5}>
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={handleCancel}
                  disabled={isApproving}
                  sx={{ borderColor: "rgba(255,255,255,0.2)" }}
                >
                  Hủy
                </Button>
                <Button
                  variant="contained"
                  onClick={handleApprove}
                  disabled={isApproving}
                  sx={{ bgcolor: "#25c2a0", color: "#04110b", fontWeight: 700 }}
                >
                  {isApproving ? "Đang cấp quyền..." : "Cho phép"}
                </Button>
              </Stack>
            </>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}
