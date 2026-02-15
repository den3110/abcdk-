import React, { useMemo } from "react";
import { Box, Paper, Stack, Typography, Button, Divider } from "@mui/material";
import { Link as RouterLink, useNavigate, useLocation } from "react-router-dom";
import SEOHead from "../components/SEOHead";

export default function NotFound() {
  const nav = useNavigate();
  const loc = useLocation();

  // Đường dẫn gốc gây lỗi 404 (được set từ baseQuery khi API trả 404)
  const origin = useMemo(() => {
    try {
      const saved = sessionStorage.getItem("nf_origin");
      if (saved) return saved;
    } catch {}
    const qOrigin = new URLSearchParams(loc.search).get("origin");
    return qOrigin || "";
  }, [loc.search]);

  const goHome = () => nav("/");
  const goBack = () => nav(-1);
  const tryAgain = () => window.location.reload();

  return (
    <Box
      sx={{
        minHeight: { xs: "100dvh", md: "80vh" },
        display: "grid",
        placeItems: "center",
        // Bỏ padding ngang ở mobile để không bị thu hẹp giấy
        px: { xs: 0, sm: 2 },
        py: { xs: 0, sm: 2 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          // Full-width thật trên mobile, bo góc lại trên desktop
          width: { xs: "100%", sm: "auto" },
          maxWidth: 720,
          mx: "auto",
          p: { xs: 2.5, sm: 3, md: 5 },
          textAlign: "center",
          border: { xs: "none", sm: "1px solid" },
          borderColor: "divider",
          borderRadius: { xs: 0, sm: 3 },
        }}
      >
        <Typography
          variant="h1"
          sx={{
            // Co giãn theo viewport: nhỏ trên mobile, lớn trên desktop
            fontSize: "clamp(56px, 18vw, 120px)",
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: { xs: -1, md: -2 },
            wordBreak: "keep-all",
          }}
        >
          404
        </Typography>

        <Typography
          variant="h5"
          fontWeight={700}
          sx={{ mt: 1, fontSize: { xs: 20, sm: 24 } }}
        >
          Không tìm thấy nội dung
        </Typography>

        <Typography
          color="text.secondary"
          sx={{
            mt: 1.25,
            mx: "auto",
            maxWidth: 680,
            // Cho phép xuống dòng đẹp trên mobile
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          Tài nguyên bạn yêu cầu không tồn tại, đã bị xoá hoặc đường dẫn không
          hợp lệ.
          {origin ? (
            <>
              <br />
              <b>URL gốc:</b>{" "}
              <Box
                component="code"
                sx={{
                  display: "inline-block",
                  mt: 0.5,
                  px: 1,
                  py: 0.5,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  // Quan trọng: không tràn ngang khi URL dài
                  wordBreak: "break-all",
                  maxWidth: "100%",
                  textAlign: "left",
                  fontSize: "0.875rem",
                }}
              >
                {origin}
              </Box>
            </>
          ) : null}
        </Typography>

        <Divider sx={{ my: { xs: 2, sm: 3 } }} />

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          sx={{
            justifyContent: "center",
            alignItems: "stretch",
          }}
        >
          <Button
            variant="contained"
            onClick={goHome}
            sx={{
              color: "white !important",
              // Nút full-width trên mobile
              width: { xs: "100%", sm: "auto" },
              py: 1.1,
            }}
          >
            Về trang chủ
          </Button>

          <Button
            variant="outlined"
            onClick={goBack}
            sx={{ width: { xs: "100%", sm: "auto" }, py: 1.1 }}
          >
            Quay lại
          </Button>

          <Button
            variant="text"
            onClick={tryAgain}
            sx={{ width: { xs: "100%", sm: "auto" }, py: 1.1 }}
          >
            Thử tải lại
          </Button>

          <Button
            variant="text"
            component={RouterLink}
            to="/contact"
            sx={{
              // Ẩn trên mobile nếu bạn muốn giữ gọn; bật dễ dàng bằng 'inline-flex'
              display: { xs: "none", sm: "inline-flex" },
            }}
          >
            Liên hệ hỗ trợ
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
