import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  CameraAltRounded,
  CloudUploadRounded,
  HomeRounded,
  LockRounded,
  ReplayRounded,
  StopCircleRounded,
  VerifiedUserRounded,
  VideocamRounded,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead.jsx";
import { setCredentials } from "../slices/authSlice.js";
import apiSlice from "../slices/apiSlice.js";
import {
  useGetActiveCheckpointRequirementQuery,
  useGetCheckpointQuery,
  useResendCheckpointMutation,
  useStartActiveCheckpointMutation,
  useStartCheckpointOtpMutation,
  useUploadCheckpointEvidenceMutation,
  useVerifyCheckpointOtpMutation,
} from "../slices/checkpointApiSlice.js";

const CHECKPOINT_STORAGE_KEY = "pickletour_checkpoint";
const FORCED_CHECKPOINT_STORAGE_KEY = "pickletour_forced_checkpoint";

const FACTOR_LABELS = {
  phone_otp: "Xác minh số điện thoại",
  email_otp: "Xác minh email",
  cccd_upload: "Gửi ảnh CCCD",
  face_video: "Gửi video khuôn mặt",
};

const FACTOR_DESCRIPTIONS = {
  phone_otp: "Nhập mã xác minh đã được gửi tới số điện thoại của bạn.",
  email_otp: "Nhập mã xác minh đã được gửi tới email của bạn.",
  cccd_upload: "Tải lên ảnh mặt trước và mặt sau CCCD để chúng tôi kiểm tra.",
  face_video: "Tải lên video khuôn mặt rõ nét để hoàn tất hồ sơ xác minh.",
};

const STATUS_LABELS = {
  required: "Chưa thực hiện",
  sent: "Đang thực hiện",
  passed: "Hoàn tất",
  submitted: "Đã gửi, chờ duyệt",
  failed: "Không đạt",
};

const FACE_VIDEO_MIN_SECONDS = 6;
const FACE_VIDEO_MAX_SECONDS = 14;
const FACE_LIVENESS_ACTIONS = [
  "Đưa mặt vào đúng khung",
  "Nhìn thẳng vào camera",
  "Quay mặt nhẹ sang trái",
  "Quay mặt nhẹ sang phải",
  "Chớp mắt và giữ khuôn mặt rõ nét",
];

function sanitizeReturnTo(value) {
  const clean = String(value || "").trim();
  return clean.startsWith("/") && !clean.startsWith("/checkpoint") ? clean : "/";
}

function readStoredReturnTo() {
  if (typeof window === "undefined") return "/";
  try {
    const raw = window.sessionStorage.getItem(CHECKPOINT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return sanitizeReturnTo(parsed?.returnTo || "/");
  } catch {
    return "/";
  }
}

function checkpointPath(token, returnTo = "/") {
  return `/checkpoint?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(
    sanitizeReturnTo(returnTo),
  )}`;
}

function isUserLoggedIn(userInfo) {
  return Boolean(userInfo?._id || userInfo?.id || userInfo?.token || userInfo?.email);
}

function getCurrentFactor(checkpoint) {
  return (checkpoint?.factors || []).find((factor) =>
    ["required", "sent"].includes(factor.status),
  );
}

function getActiveStep(factors = []) {
  if (!factors.length) return 0;
  const index = factors.findIndex((factor) => factor.status !== "passed");
  return index === -1 ? factors.length - 1 : index;
}

function getContactLabel(checkpoint) {
  const method = checkpoint?.delivery?.method || checkpoint?.deliveryMethod;
  if (method === "email_otp") return "email";
  return "số điện thoại";
}

function getRecorderMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return "";
  }

  return (
    [
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((type) => window.MediaRecorder.isTypeSupported(type)) || ""
  );
}

function createFaceVideoFile(blob, mimeType) {
  const type = mimeType || blob.type || "video/webm";
  const extension = type.includes("mp4") ? "mp4" : "webm";
  return new File([blob], `face-liveness-${Date.now()}.${extension}`, { type });
}

// eslint-disable-next-line react/prop-types
function FaceVideoCaptureStep({ onSubmit, uploading }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedFile, setRecordedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [cameraError, setCameraError] = useState("");

  const cameraSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const setPreviewFromFile = useCallback((file) => {
    if (!file) return;
    setRecordedFile(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  }, []);

  const clearRecordedFile = useCallback(() => {
    setRecordedFile(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setElapsed(0);
  }, []);

  const openCamera = useCallback(async () => {
    setCameraError("");
    if (!cameraSupported) {
      setCameraError("Trình duyệt không hỗ trợ quay video trực tiếp. Vui lòng tải video xác thực lên.");
      return null;
    }

    if (streamRef.current) {
      if (videoRef.current && videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      return streamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 720 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      return stream;
    } catch (error) {
      setCameraError(
        error?.name === "NotAllowedError"
          ? "Bạn cần cấp quyền camera để quay video xác thực."
          : "Không mở được camera. Vui lòng kiểm tra thiết bị hoặc tải video lên.",
      );
      return null;
    }
  }, [cameraSupported]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    stopTimer();
    setRecording(false);
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    const stream = await openCamera();
    if (!stream) return;

    clearRecordedFile();
    chunksRef.current = [];
    const mimeType = getRecorderMimeType();

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopTimer();
        setRecording(false);
        if (!chunksRef.current.length) {
          setCameraError("Không ghi được dữ liệu video. Vui lòng quay lại hoặc tải video lên.");
          stopCamera();
          return;
        }
        const blob = new Blob(chunksRef.current, {
          type: mimeType || chunksRef.current[0]?.type || "video/webm",
        });
        const file = createFaceVideoFile(blob, mimeType);
        setRecordedFile(file);
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(blob);
        });
        stopCamera();
      };

      setElapsed(0);
      setRecording(true);
      recorder.start(1000);
      stopTimer();
      timerRef.current = setInterval(() => {
        setElapsed((value) => {
          const next = value + 1;
          if (next >= FACE_VIDEO_MAX_SECONDS) {
            const activeRecorder = recorderRef.current;
            if (activeRecorder && activeRecorder.state !== "inactive") {
              activeRecorder.stop();
            }
            stopTimer();
            return FACE_VIDEO_MAX_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch {
      setRecording(false);
      stopTimer();
      setCameraError("Không thể bắt đầu quay video trên trình duyệt này. Vui lòng tải video lên.");
    }
  }, [clearRecordedFile, openCamera, stopCamera, stopTimer]);

  const handleSubmit = async () => {
    if (!recordedFile) {
      toast.error("Vui lòng quay hoặc tải video khuôn mặt trước.");
      return;
    }
    if (elapsed > 0 && elapsed < FACE_VIDEO_MIN_SECONDS) {
      toast.error(`Video cần tối thiểu ${FACE_VIDEO_MIN_SECONDS} giây để đủ dữ liệu xác thực.`);
      return;
    }
    await onSubmit(recordedFile);
  };

  const handleFallbackFile = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setCameraError("");
    stopTimer();
    stopCamera();
    setRecording(false);
    setElapsed(0);
    setPreviewFromFile(file);
  };

  useEffect(() => {
    return () => {
      stopTimer();
      stopCamera();
    };
  }, [stopCamera, stopTimer]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <Stack spacing={2}>
      <Typography fontWeight={800}>{FACTOR_LABELS.face_video}</Typography>
      <Typography color="text.secondary" fontSize={14}>
        Quay video trực tiếp từ camera trong {FACE_VIDEO_MIN_SECONDS}-{FACE_VIDEO_MAX_SECONDS} giây. Không dùng ảnh
        chụp màn hình, video phát lại, kính tối hoặc che khuôn mặt.
      </Typography>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {FACE_LIVENESS_ACTIONS.map((item, index) => (
          <Chip key={item} size="small" variant="outlined" label={`${index + 1}. ${item}`} />
        ))}
      </Stack>

      <Box
        sx={{
          position: "relative",
          width: "100%",
          aspectRatio: "3 / 4",
          maxHeight: 520,
          bgcolor: "#0f172a",
          borderRadius: 2,
          overflow: "hidden",
          border: "1px solid rgba(15, 23, 42, 0.16)",
        }}
      >
        {previewUrl ? (
          <Box
            component="video"
            src={previewUrl}
            controls
            playsInline
            sx={{ width: "100%", height: "100%", objectFit: "cover", bgcolor: "#000" }}
          />
        ) : (
          <>
            <Box
              component="video"
              ref={videoRef}
              autoPlay
              muted
              playsInline
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                display: cameraReady ? "block" : "none",
              }}
            />
            {!cameraReady ? (
              <Stack
                spacing={1}
                alignItems="center"
                justifyContent="center"
                sx={{ position: "absolute", inset: 0, color: "#ffffff", px: 3, textAlign: "center" }}
              >
                <CameraAltRounded sx={{ fontSize: 42 }} />
                <Typography fontWeight={800}>Sẵn sàng quay video xác thực</Typography>
                <Typography fontSize={13} sx={{ opacity: 0.78 }}>
                  Camera chỉ bật sau khi bạn bấm mở camera.
                </Typography>
              </Stack>
            ) : null}
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                left: "50%",
                top: "47%",
                width: "58%",
                height: "54%",
                transform: "translate(-50%, -50%)",
                border: "2px solid rgba(255, 255, 255, 0.9)",
                borderRadius: "50%",
                boxShadow: "0 0 0 999px rgba(15, 23, 42, 0.22)",
              }}
            />
            {recording ? (
              <Box
                sx={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 99,
                  bgcolor: "rgba(220, 38, 38, 0.92)",
                  color: "#fff",
                }}
              >
                <Typography fontSize={13} fontWeight={800}>
                  Đang quay {elapsed}s
                </Typography>
              </Box>
            ) : null}
          </>
        )}
      </Box>

      {cameraError ? <Alert severity="warning">{cameraError}</Alert> : null}

      {recordedFile ? (
        <Alert severity="success">
          Đã có video xác thực: {recordedFile.name}. Kiểm tra lại preview trước khi gửi.
        </Alert>
      ) : null}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {!recordedFile ? (
          <>
            <Button
              variant="outlined"
              startIcon={<CameraAltRounded />}
              onClick={openCamera}
              disabled={recording || !cameraSupported}
            >
              Mở camera
            </Button>
            <Button
              variant="contained"
              startIcon={<VideocamRounded />}
              onClick={startRecording}
              disabled={recording || !cameraSupported}
            >
              Bắt đầu quay
            </Button>
            {recording ? (
              <Button color="warning" variant="outlined" startIcon={<StopCircleRounded />} onClick={stopRecording}>
                Dừng quay
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="outlined" startIcon={<ReplayRounded />} onClick={clearRecordedFile} disabled={uploading}>
              Quay lại
            </Button>
            <Button variant="contained" onClick={handleSubmit} disabled={uploading}>
              {uploading ? "Đang gửi..." : "Gửi video xác thực"}
            </Button>
          </>
        )}
        <Button component="label" variant="text" startIcon={<CloudUploadRounded />} disabled={recording || uploading}>
          Tải video có sẵn
          <input hidden type="file" accept="video/*" capture="user" onChange={handleFallbackFile} />
        </Button>
      </Stack>
    </Stack>
  );
}

export default function CheckpointScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const userInfo = useSelector((state) => state.auth?.userInfo || null);
  const currentCheckpointStartedRef = useRef(false);

  const token = String(params.get("token") || "").trim();
  const returnTo = useMemo(() => {
    return sanitizeReturnTo(params.get("returnTo") || readStoredReturnTo());
  }, [params]);
  const loggedIn = isUserLoggedIn(userInfo);

  const [code, setCode] = useState("");
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  const {
    data: activeRequirement,
    isError: activeError,
    isLoading: activeLoading,
  } = useGetActiveCheckpointRequirementQuery(undefined, {
    skip: Boolean(token) || !loggedIn,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });
  const [startActiveCheckpoint, { isLoading: startingCurrentCheckpoint }] =
    useStartActiveCheckpointMutation();

  const {
    data: checkpoint,
    isLoading,
    isError,
    refetch,
  } = useGetCheckpointQuery(token, {
    skip: !token,
    pollingInterval: token ? 10000 : 0,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const [startCheckpointOtp, { isLoading: startingOtp }] =
    useStartCheckpointOtpMutation();
  const [verifyOtp, { isLoading: verifying }] = useVerifyCheckpointOtpMutation();
  const [resend, { isLoading: resending }] = useResendCheckpointMutation();
  const [uploadEvidence, { isLoading: uploading }] =
    useUploadCheckpointEvidenceMutation();

  const factors = checkpoint?.factors || [];
  const activeStep = getActiveStep(factors);
  const currentFactor = getCurrentFactor(checkpoint);
  const waitingForReview = checkpoint?.status === "review_required";
  const failed =
    checkpoint?.status === "failed" ||
    checkpoint?.status === "expired" ||
    checkpoint?.status === "cancelled";
  const showIntro = checkpoint?.status === "pending" && !checkpoint?.started;
  const showSteps = checkpoint?.status === "pending" && checkpoint?.started;

  useEffect(() => {
    if (token) return;
    if (!loggedIn) {
      navigate("/", { replace: true });
      return;
    }
    if (activeError) {
      navigate("/", { replace: true });
      return;
    }
    if (activeLoading || startingCurrentCheckpoint) return;

    if (activeRequirement?.required && activeRequirement?.checkpoint?.token) {
      navigate(checkpointPath(activeRequirement.checkpoint.token, returnTo), {
        replace: true,
      });
      return;
    }

    if (
      activeRequirement?.required &&
      !activeRequirement?.checkpoint?.token &&
      !currentCheckpointStartedRef.current
    ) {
      currentCheckpointStartedRef.current = true;
      startActiveCheckpoint()
        .unwrap()
        .then((result) => {
          if (result?.required && result?.checkpoint?.token) {
            navigate(checkpointPath(result.checkpoint.token, returnTo), {
              replace: true,
            });
            return;
          }
          navigate("/", { replace: true });
        })
        .catch(() => {
          navigate("/", { replace: true });
        })
        .finally(() => {
          currentCheckpointStartedRef.current = false;
        });
      return;
    }

    if (activeRequirement && activeRequirement.required === false) {
      navigate("/", { replace: true });
    }
  }, [
    activeLoading,
    activeError,
    activeRequirement,
    loggedIn,
    navigate,
    returnTo,
    startActiveCheckpoint,
    startingCurrentCheckpoint,
    token,
  ]);

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
        sessionStorage.removeItem(CHECKPOINT_STORAGE_KEY);
        sessionStorage.removeItem(FORCED_CHECKPOINT_STORAGE_KEY);
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

  useEffect(() => {
    if (checkpoint?.status === "passed" && !checkpoint?.authenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [checkpoint?.authenticated, checkpoint?.status, navigate, returnTo]);

  const handleStartVerification = async () => {
    try {
      const result = await startCheckpointOtp(token).unwrap();
      setCooldown(Number(result?.cooldown || 0));
      toast.success("Mã xác minh đã được gửi.");
      await refetch();
    } catch (error) {
      const remaining = Number(error?.data?.remainingTime || 0);
      if (remaining > 0) setCooldown(remaining);
      toast.error(
        error?.data?.message || error?.error || "Không gửi được mã xác minh.",
      );
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      const result = await resend(token).unwrap();
      setCooldown(Number(result?.cooldown || 60));
      toast.success("Đã gửi lại mã xác minh.");
      await refetch();
    } catch (error) {
      const remaining = Number(error?.data?.remainingTime || 0);
      if (remaining > 0) setCooldown(remaining);
      toast.error(
        error?.data?.message || error?.error || "Không gửi lại được mã.",
      );
    }
  };

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
      setFront(null);
      setBack(null);
      if (result?.reviewRequired) {
        toast.info("Chúng tôi đã nhận được thông tin xác minh của bạn.");
      }
      await refetch();
    } catch (error) {
      toast.error(error?.data?.message || error?.error || "Upload CCCD thất bại.");
    }
  };

  const handleUploadFaceVideo = async (videoFile) => {
    if (!videoFile) {
      toast.error("Vui lòng tải video khuôn mặt.");
      return;
    }

    try {
      const result = await uploadEvidence({
        token,
        factor: "face_video",
        files: { video: videoFile },
      }).unwrap();
      if (result?.reviewRequired) {
        toast.info("Chúng tôi đã nhận được thông tin xác minh của bạn.");
      }
      await refetch();
    } catch (error) {
      toast.error(
        error?.data?.message || error?.error || "Upload video thất bại.",
      );
    }
  };

  const renderStepControls = () => {
    if (!currentFactor) return null;

    if (currentFactor.key === "phone_otp" || currentFactor.key === "email_otp") {
      return (
        <Box component="form" onSubmit={handleVerifyCode}>
          <Stack spacing={2}>
            <Typography fontWeight={800}>
              {FACTOR_LABELS[currentFactor.key] || "Xác minh OTP"}
            </Typography>
            <Typography color="text.secondary" fontSize={14}>
              Mã đã được gửi tới {getContactLabel(checkpoint)}{" "}
              {checkpoint?.targetMasked || checkpoint?.delivery?.targetMasked || "của bạn"}.
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
            {checkpoint?.attemptsRemaining != null ? (
              <Typography color="text.secondary" fontSize={13}>
                Còn {checkpoint.attemptsRemaining} lần thử.
              </Typography>
            ) : null}
          </Stack>
        </Box>
      );
    }

    if (currentFactor.key === "cccd_upload") {
      return (
        <Box component="form" onSubmit={handleUploadCccd}>
          <Stack spacing={2}>
            <Typography fontWeight={800}>{FACTOR_LABELS.cccd_upload}</Typography>
            <Typography color="text.secondary" fontSize={14}>
              {FACTOR_DESCRIPTIONS.cccd_upload}
            </Typography>
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
      );
    }

    if (currentFactor.key === "face_video") {
      return <FaceVideoCaptureStep onSubmit={handleUploadFaceVideo} uploading={uploading} />;
    }

    return null;
  };

  const renderBody = () => {
    if (!token) {
      return (
        <Stack alignItems="center" py={4}>
          <CircularProgress />
        </Stack>
      );
    }

    if (isLoading) {
      return (
        <Stack alignItems="center" py={4}>
          <CircularProgress />
        </Stack>
      );
    }

    if (isError) {
      return (
        <Stack spacing={2}>
          <Alert severity="error">Checkpoint không tồn tại hoặc đã hết hạn.</Alert>
          <Button
            variant="outlined"
            startIcon={<HomeRounded />}
            onClick={() => navigate("/", { replace: true })}
          >
            Về trang chủ
          </Button>
        </Stack>
      );
    }

    if (waitingForReview) {
      return (
        <Stack spacing={2.5}>
          <Stepper activeStep={activeStep} orientation="vertical">
            {factors.map((factor) => (
              <Step key={factor.key} completed={factor.status === "passed"}>
                <StepLabel
                  optional={
                    <Typography variant="caption" color="text.secondary">
                      {STATUS_LABELS[factor.status] || factor.status}
                    </Typography>
                  }
                >
                  {FACTOR_LABELS[factor.key] || factor.key}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
          <Alert severity="info">
            Chúng tôi đã nhận được thông tin xác minh của bạn. Đội ngũ kiểm duyệt
            sẽ phản hồi lại trong thời gian sớm nhất.
          </Alert>
        </Stack>
      );
    }

    if (failed) {
      return (
        <Stack spacing={2}>
          <Alert severity="error">
            Checkpoint này không còn hiệu lực hoặc hồ sơ xác minh chưa được chấp
            nhận. Vui lòng thử lại sau hoặc liên hệ hỗ trợ nếu cần.
          </Alert>
          <Button
            variant="outlined"
            startIcon={<HomeRounded />}
            onClick={() => navigate("/", { replace: true })}
          >
            Về trang chủ
          </Button>
        </Stack>
      );
    }

    if (showIntro) {
      return (
        <Stack spacing={2.5}>
          <Alert severity="warning">
            Chúng tôi phát hiện hoạt động bất thường từ tài khoản của bạn. Để
            bảo vệ tài khoản và cộng đồng, vui lòng làm theo các bước xác minh
            bên dưới để gỡ hạn chế.
          </Alert>
          <Stepper activeStep={0} orientation="vertical">
            {factors.map((factor) => (
              <Step key={factor.key}>
                <StepLabel
                  optional={
                    <Typography variant="caption" color="text.secondary">
                      {FACTOR_DESCRIPTIONS[factor.key] || "Hoàn tất bước xác minh này."}
                    </Typography>
                  }
                >
                  {FACTOR_LABELS[factor.key] || factor.key}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
          <Button
            variant="contained"
            size="large"
            disabled={startingOtp}
            onClick={handleStartVerification}
            startIcon={<VerifiedUserRounded />}
          >
            {startingOtp ? "Đang bắt đầu..." : "Bắt đầu xác minh"}
          </Button>
        </Stack>
      );
    }

    if (showSteps) {
      return (
        <Stack spacing={2.5}>
          <Box>
            <Typography fontWeight={800}>
              Bước {Math.min(activeStep + 1, factors.length)}/{factors.length}
            </Typography>
            <Typography color="text.secondary" fontSize={14}>
              Hoàn tất từng bước theo đúng thứ tự để gỡ hạn chế tài khoản.
            </Typography>
          </Box>
          <Stepper activeStep={activeStep} orientation="vertical">
            {factors.map((factor) => (
              <Step key={factor.key} completed={factor.status === "passed"}>
                <StepLabel
                  optional={
                    <Typography variant="caption" color="text.secondary">
                      {STATUS_LABELS[factor.status] || factor.status}
                    </Typography>
                  }
                >
                  {FACTOR_LABELS[factor.key] || factor.key}
                </StepLabel>
              </Step>
            ))}
          </Stepper>
          {renderStepControls()}
        </Stack>
      );
    }

    return (
      <Stack alignItems="center" py={4}>
        <CircularProgress />
      </Stack>
    );
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
          maxWidth: 560,
          p: { xs: 3, sm: 4 },
          border: "1px solid rgba(15, 23, 42, 0.1)",
          borderRadius: 3,
        }}
      >
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                bgcolor: "#1877f2",
                color: "#ffffff",
                boxShadow: `0 0 0 8px ${alpha("#1877f2", 0.12)}`,
              }}
            >
              <LockRounded />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" variant="h5" fontWeight={800}>
                Kiểm tra bảo mật
              </Typography>
              <Typography color="text.secondary" fontSize={14}>
                Làm theo các bước xác minh để tiếp tục sử dụng tài khoản.
              </Typography>
            </Box>
          </Stack>

          {renderBody()}
        </Stack>
      </Paper>
    </Box>
  );
}
