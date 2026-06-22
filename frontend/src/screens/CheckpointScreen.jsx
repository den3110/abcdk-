import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CloudUploadRounded,
  ShieldRounded,
  VerifiedUserRounded,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead.jsx";
import { setCredentials } from "../slices/authSlice.js";
import apiSlice from "../slices/apiSlice.js";
import {
  useGetCheckpointQuery,
  useResendCheckpointMutation,
  useUploadCheckpointEvidenceMutation,
  useVerifyCheckpointOtpMutation,
} from "../slices/checkpointApiSlice.js";

const factorLabels = {
  phone_otp: "Xác minh số điện thoại",
  email_otp: "Xác minh email",
  cccd_upload: "Chụp CCCD",
  face_video: "Quay khuôn mặt",
};

function getNextFactor(checkpoint) {
  return (checkpoint?.factors || []).find((factor) => factor.status !== "passed");
}

export default function CheckpointScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const token = String(params.get("token") || "").trim();
  const returnTo = useMemo(() => {
    const next = String(params.get("returnTo") || "/").trim();
    return next.startsWith("/") ? next : "/";
  }, [params]);

  const [code, setCode] = useState("");
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [video, setVideo] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  const {
    data: checkpoint,
    isLoading,
    isError,
    refetch,
  } = useGetCheckpointQuery(token, {
    skip: !token,
    pollingInterval: token ? 10000 : 0,
  });
  const [verifyOtp, { isLoading: verifying }] = useVerifyCheckpointOtpMutation();
  const [resend, { isLoading: resending }] = useResendCheckpointMutation();
  const [uploadEvidence, { isLoading: uploading }] =
    useUploadCheckpointEvidenceMutation();

  const nextFactor = getNextFactor(checkpoint);
  const isReviewRequired = checkpoint?.status === "review_required";
  const progress = checkpoint?.factors?.length
    ? Math.round(
        (checkpoint.factors.filter((factor) => factor.status === "passed").length /
          checkpoint.factors.length) *
          100,
      )
    : 0;

  useEffect(() => {
    setCooldown(Number(checkpoint?.cooldown || 0));
  }, [checkpoint?.cooldown]);

  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const completeLogin = useCallback(
    (user) => {
      dispatch(setCredentials({ ...user }));
      dispatch(apiSlice.util.resetApiState());
      try {
        sessionStorage.removeItem("pickletour_checkpoint");
      } catch {
        // ignore
      }
      navigate(returnTo, { replace: true });
    },
    [dispatch, navigate, returnTo],
  );

  useEffect(() => {
    if (checkpoint?.authenticated && checkpoint?.user) {
      completeLogin(checkpoint.user);
    }
  }, [checkpoint?.authenticated, checkpoint?.user, completeLogin]);

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    const clean = String(code || "").replace(/\D/g, "").slice(0, 6);
    if (clean.length < 4) {
      toast.error("Mã checkpoint không hợp lệ.");
      return;
    }

    try {
      const result = await verifyOtp({ token, code: clean }).unwrap();
      if (result?.authenticated && result?.user) {
        completeLogin(result.user);
        return;
      }
      setCode("");
      await refetch();
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Xác minh thất bại.");
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      const result = await resend(token).unwrap();
      setCooldown(Number(result?.cooldown || 60));
      toast.success("Đã gửi lại mã checkpoint.");
      await refetch();
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Không gửi lại được mã.");
    }
  };

  const handleUploadCccd = async (event) => {
    event.preventDefault();
    if (!front || !back) {
      toast.error("Vui lòng tải đủ mặt trước và mặt sau CCCD.");
      return;
    }

    try {
      const result = await uploadEvidence({
        token,
        factor: "cccd_upload",
        files: { front, back },
      }).unwrap();
      if (result?.authenticated && result?.user) {
        completeLogin(result.user);
        return;
      }
      await refetch();
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Upload CCCD thất bại.");
    }
  };

  const handleUploadFaceVideo = async (event) => {
    event.preventDefault();
    if (!video) {
      toast.error("Vui lòng tải video khuôn mặt.");
      return;
    }

    try {
      const result = await uploadEvidence({
        token,
        factor: "face_video",
        files: { video },
      }).unwrap();
      if (result?.authenticated && result?.user) {
        completeLogin(result.user);
        return;
      }
      await refetch();
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Upload video thất bại.");
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        py: 4,
        bgcolor: "#f6f8fb",
      }}
    >
      <SEOHead title="Checkpoint bảo mật" noIndex={true} />

      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 520,
          p: { xs: 3, sm: 4 },
          border: "1px solid rgba(15, 23, 42, 0.1)",
          borderRadius: 3,
        }}
      >
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                display: "grid",
                placeItems: "center",
                bgcolor: "#0f172a",
                color: "#ffffff",
              }}
            >
              <ShieldRounded />
            </Box>
            <Box>
              <Typography component="h1" variant="h5" fontWeight={800}>
                Checkpoint bảo mật
              </Typography>
              <Typography color="text.secondary" fontSize={14}>
                Hoàn tất xác minh để tiếp tục đăng nhập.
              </Typography>
            </Box>
          </Stack>

          {!token ? (
            <Alert severity="error">Thiếu checkpoint token. Vui lòng đăng nhập lại.</Alert>
          ) : isLoading ? (
            <Stack alignItems="center" py={4}>
              <CircularProgress />
            </Stack>
          ) : isError ? (
            <Alert severity="error">Checkpoint không tồn tại hoặc đã hết hạn.</Alert>
          ) : isReviewRequired ? (
            <Alert severity="info">
              Hồ sơ checkpoint đã được gửi và đang chờ kiểm duyệt.
            </Alert>
          ) : (
            <>
              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
                  <Typography fontWeight={700}>Mức {checkpoint?.level || 1}</Typography>
                  <Typography color="text.secondary" fontSize={14}>
                    {progress}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{ height: 8, borderRadius: 99 }}
                />
              </Box>

              <Alert severity="warning">
                Chúng tôi phát hiện một số tín hiệu bất thường. Checkpoint giúp
                bảo vệ tài khoản và người dùng khác.
              </Alert>

              {nextFactor?.key === "phone_otp" || nextFactor?.key === "email_otp" ? (
                <Box component="form" onSubmit={handleVerifyCode}>
                  <Stack spacing={2}>
                    <Typography fontWeight={800}>
                      {factorLabels[nextFactor.key]}
                    </Typography>
                    <Typography color="text.secondary" fontSize={14}>
                      Mã đã được gửi tới {checkpoint?.targetMasked || "thông tin liên hệ của bạn"}.
                    </Typography>
                    <TextField
                      label="Mã xác minh"
                      value={code}
                      onChange={(event) =>
                        setCode(
                          String(event.target.value || "")
                            .replace(/\D/g, "")
                            .slice(0, 6),
                        )
                      }
                      inputProps={{ inputMode: "numeric", autoComplete: "one-time-code" }}
                      fullWidth
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      size="large"
                      disabled={verifying}
                      startIcon={<VerifiedUserRounded />}
                    >
                      {verifying ? "Đang xác minh..." : "Xác minh"}
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={resending || cooldown > 0}
                      onClick={handleResend}
                    >
                      {cooldown > 0 ? `Gửi lại mã (${cooldown}s)` : "Gửi lại mã"}
                    </Button>
                  </Stack>
                </Box>
              ) : null}

              {nextFactor?.key === "cccd_upload" ? (
                <Box component="form" onSubmit={handleUploadCccd}>
                  <Stack spacing={2}>
                    <Typography fontWeight={800}>{factorLabels.cccd_upload}</Typography>
                    <Button component="label" variant="outlined" startIcon={<CloudUploadRounded />}>
                      Chọn ảnh mặt trước
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => setFront(event.target.files?.[0] || null)}
                      />
                    </Button>
                    {front ? <Typography fontSize={13}>{front.name}</Typography> : null}
                    <Button component="label" variant="outlined" startIcon={<CloudUploadRounded />}>
                      Chọn ảnh mặt sau
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => setBack(event.target.files?.[0] || null)}
                      />
                    </Button>
                    {back ? <Typography fontSize={13}>{back.name}</Typography> : null}
                    <Button type="submit" variant="contained" disabled={uploading}>
                      {uploading ? "Đang gửi..." : "Gửi CCCD"}
                    </Button>
                  </Stack>
                </Box>
              ) : null}

              {nextFactor?.key === "face_video" ? (
                <Box component="form" onSubmit={handleUploadFaceVideo}>
                  <Stack spacing={2}>
                    <Typography fontWeight={800}>{factorLabels.face_video}</Typography>
                    <Button component="label" variant="outlined" startIcon={<CloudUploadRounded />}>
                      Chọn video khuôn mặt
                      <input
                        hidden
                        type="file"
                        accept="video/*"
                        onChange={(event) => setVideo(event.target.files?.[0] || null)}
                      />
                    </Button>
                    {video ? <Typography fontSize={13}>{video.name}</Typography> : null}
                    <Button type="submit" variant="contained" disabled={uploading}>
                      {uploading ? "Đang gửi..." : "Gửi video"}
                    </Button>
                  </Stack>
                </Box>
              ) : null}
            </>
          )}

          <Link component={RouterLink} to="/login" underline="none" fontWeight={700}>
            Quay lại đăng nhập
          </Link>
        </Stack>
      </Paper>
    </Box>
  );
}
