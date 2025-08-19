import React, { useMemo } from "react";
import { Box, Paper, Stack, Typography, Button, Divider } from "@mui/material";
import { Link as RouterLink, useNavigate, useLocation } from "react-router-dom";

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
      sx={{ minHeight: "80vh", display: "grid", placeItems: "center", p: 2 }}
    >
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, md: 5 },
          maxWidth: 720,
          width: "100%",
          textAlign: "center",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 3,
        }}
      >
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: 72, md: 120 },
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          404
        </Typography>

        <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>
          Không tìm thấy nội dung
        </Typography>

        <Typography color="text.secondary" sx={{ mt: 1.25 }}>
          Tài nguyên bạn yêu cầu không tồn tại, đã bị xoá hoặc đường dẫn không
          hợp lệ.
          {origin ? (
            <>
              <br />
              <b>URL gốc:</b> <code>{origin}</code>
            </>
          ) : null}
        </Typography>

        <Divider sx={{ my: 3 }} />

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          sx={{ justifyContent: "center" }}
        >
          <Button
            variant="contained"
            onClick={goHome}
            sx={{ color: "white !important" }}
          >
            Về trang chủ
          </Button>
          <Button variant="outlined" onClick={goBack}>
            Quay lại
          </Button>
          <Button variant="text" onClick={tryAgain}>
            Thử tải lại
          </Button>
          <Button
            variant="text"
            component={RouterLink}
            to="/contact"
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          >
            Liên hệ hỗ trợ
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
