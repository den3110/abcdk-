// Trang bình luận viên (công khai, token-gated): mic điện thoại → WebRTC → VPS →
// trộn vào luồng live. Mở từ nút 🎙️ ở màn Điều khiển Live (app/web).
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import { BASE_URL } from "../slices/apiSlice";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

function waitIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Phòng hờ: tối đa 3s rồi gửi luôn SDP đang có.
    setTimeout(resolve, 3000);
  });
}

export default function CommentaryPage() {
  const params = useParams();
  const codeParam = params.code;
  const [token, setToken] = useState(params.token || "");
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [status, setStatus] = useState("idle"); // idle|connecting|connected|error
  const [err, setErr] = useState("");
  const [talking, setTalking] = useState(false);
  const [level, setLevel] = useState(0);

  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (codeParam) {
          // Mã ngắn /c/<code> → đổi lấy token + thông tin.
          const r = await fetch(`${BASE_URL}/api/commentary/by-code/${codeParam}`);
          const d = await r.json();
          if (!r.ok) throw new Error(d?.message || "Mã không hợp lệ");
          if (alive) {
            setToken(d.token);
            setInfo(d);
          }
        } else {
          const r = await fetch(`${BASE_URL}/api/commentary/info/${params.token}`);
          const d = await r.json();
          if (!r.ok) throw new Error(d?.message || "Liên kết không hợp lệ");
          if (alive) setInfo(d);
        }
      } catch (e) {
        if (alive) setErr(e?.message || "Liên kết hết hạn hoặc không hợp lệ");
      } finally {
        if (alive) setLoadingInfo(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [codeParam, params.token]);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch (e) {
      /* bỏ qua */
    }
    audioCtxRef.current = null;
  }, []);

  const startMeter = useCallback((stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = Math.abs(data[i] - 128);
          if (v > peak) peak = v;
        }
        setLevel(Math.min(100, Math.round((peak / 128) * 160)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      /* bỏ qua */
    }
  }, []);

  const connect = useCallback(async () => {
    setErr("");
    setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      streamRef.current = stream;
      const pc = new RTCPeerConnection({ iceServers: ICE });
      pcRef.current = pc;
      const track = stream.getAudioTracks()[0];
      trackRef.current = track;
      track.enabled = false; // bắt đầu TẮT mic, bấm "Bắt đầu nói" mới phát
      pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      // Nhận video 360p của luồng live để BLV xem.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addEventListener("track", (e) => {
        if (e.track.kind === "video") {
          // Lưu stream vào state; gắn vào <video> bằng ref-callback khi phần tử mount
          // (ontrack có thể chạy TRƯỚC khi UI "đã kết nối" render → ref chưa có).
          setRemoteStream(e.streams[0] || new MediaStream([e.track]));
          setHasVideo(true);
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        const st = pc.connectionState;
        if (st === "connected") setStatus("connected");
        else if (st === "failed" || st === "closed" || st === "disconnected") {
          setStatus("error");
          setErr("Mất kết nối. Hãy bấm Kết nối lại.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);

      const r = await fetch(`${BASE_URL}/api/commentary/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      });
      const ans = await r.json();
      if (!r.ok) throw new Error(ans?.message || "Không kết nối được máy chủ bình luận");
      await pc.setRemoteDescription(ans);
      startMeter(stream);
    } catch (e) {
      setStatus("error");
      setErr(
        e?.name === "NotAllowedError"
          ? "Bạn chưa cho phép dùng micro. Hãy cấp quyền rồi thử lại."
          : e?.message || "Lỗi kết nối",
      );
    }
  }, [token, startMeter]);

  const disconnect = useCallback(() => {
    stopMeter();
    try {
      trackRef.current && (trackRef.current.enabled = false);
    } catch (e) {
      /* bỏ qua */
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch (e) {
      /* bỏ qua */
    }
    try {
      pcRef.current?.close();
    } catch (e) {
      /* bỏ qua */
    }
    pcRef.current = null;
    streamRef.current = null;
    trackRef.current = null;
    setRemoteStream(null);
    setHasVideo(false);
    setTalking(false);
    setStatus("idle");
    setLevel(0);
  }, [stopMeter]);

  useEffect(() => () => disconnect(), [disconnect]);

  const toggleTalk = () => {
    const t = trackRef.current;
    if (!t) return;
    const on = !talking;
    t.enabled = on;
    setTalking(on);
  };

  const connected = status === "connected";

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        bgcolor: "background.default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>
          🎙️ Bình luận trực tiếp
        </Typography>
        {loadingInfo ? (
          <CircularProgress size={24} sx={{ mt: 3 }} />
        ) : err && !info ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {err}
          </Alert>
        ) : (
          <>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {info?.courtName ? `${info.courtName} · ` : ""}
              {info?.machineLabel || ""}
            </Typography>

            {status === "idle" && (
              <Button
                fullWidth
                size="large"
                variant="contained"
                startIcon={<MicIcon />}
                onClick={connect}
                sx={{ py: 1.5, fontWeight: 800 }}
              >
                Kết nối micro
              </Button>
            )}

            {status === "connecting" && (
              <Stack alignItems="center" spacing={1} sx={{ mt: 2 }}>
                <CircularProgress size={28} />
                <Typography color="text.secondary">Đang kết nối…</Typography>
              </Stack>
            )}

            {(connected || status === "error") && (
              <>
                {connected && (
                  <Chip
                    label="Đã kết nối"
                    color="success"
                    size="small"
                    sx={{ mb: 2 }}
                  />
                )}
                {connected && (
                  <>
                    {/* Xem luồng live (360p, độ trễ thấp) */}
                    <Box
                      sx={{
                        mb: 2,
                        borderRadius: 2,
                        overflow: "hidden",
                        bgcolor: "#000",
                        aspectRatio: "16 / 9",
                        display: hasVideo ? "block" : "none",
                      }}
                    >
                      <Box
                        component="video"
                        ref={(el) => {
                          if (el && remoteStream && el.srcObject !== remoteStream) {
                            el.srcObject = remoteStream;
                            const p = el.play();
                            if (p && p.catch) p.catch(() => {});
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        sx={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </Box>
                    <Button
                      fullWidth
                      size="large"
                      variant={talking ? "contained" : "outlined"}
                      color={talking ? "error" : "primary"}
                      startIcon={talking ? <MicIcon /> : <MicOffIcon />}
                      onClick={toggleTalk}
                      sx={{ py: 2, fontWeight: 800, fontSize: "1.05rem" }}
                    >
                      {talking ? "Đang nói — bấm để TẮT" : "Bắt đầu nói"}
                    </Button>
                    {/* Thanh mức âm */}
                    <Box
                      sx={{
                        mt: 2,
                        height: 10,
                        borderRadius: 5,
                        bgcolor: "action.hover",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          height: "100%",
                          width: `${talking ? level : 0}%`,
                          bgcolor: level > 80 ? "error.main" : "success.main",
                          transition: "width 80ms linear",
                        }}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                      Tiếng của bạn sẽ được trộn vào luồng live (có hạ tiếng sân khi bạn nói).
                    </Typography>
                  </>
                )}
                {err && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {err}
                  </Alert>
                )}
                <Button
                  fullWidth
                  variant="text"
                  color="inherit"
                  onClick={status === "error" ? connect : disconnect}
                  sx={{ mt: 2 }}
                >
                  {status === "error" ? "Kết nối lại" : "Ngắt kết nối"}
                </Button>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
