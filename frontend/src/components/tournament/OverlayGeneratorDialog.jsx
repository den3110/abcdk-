// components/tournament/OverlayGeneratorDialog.jsx
// Dialog cho admin/manager tạo scoreboard overlay từ poster + tên giải.
// Mặc định lấy tour.image + tour.name, cho phép user upload/sửa trước khi generate.
import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link as MuiLink,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadIcon from "@mui/icons-material/CloudUpload";
import RestartIcon from "@mui/icons-material/Restore";
import RocketIcon from "@mui/icons-material/Rocket";
import AutoFixIcon from "@mui/icons-material/AutoFixHigh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { toast } from "react-toastify";

import {
  useGetTournamentOverlayStatusQuery,
  useGenerateTournamentOverlayMutation,
  useDeployTournamentOverlayMutation,
} from "../../slices/overlayApiSlice";

const MAX_MB = 8;

function slugify(name) {
  return (
    (name || "overlay")
      .normalize("NFD")
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "overlay"
  );
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + 0x8000)
    );
  }
  return btoa(bin);
}

export default function OverlayGeneratorDialog({
  open,
  onClose,
  tourId,
  defaultName,
  defaultPosterUrl,
}) {
  const { data: status, isFetching: statusLoading } =
    useGetTournamentOverlayStatusQuery(tourId, { skip: !open || !tourId });
  const [genOverlay, { isLoading: generating }] =
    useGenerateTournamentOverlayMutation();
  const [deployOverlay, { isLoading: deploying }] =
    useDeployTournamentOverlayMutation();

  const [tournamentName, setTournamentName] = useState(defaultName || "");
  const [category, setCategory] = useState("");
  const [posterOverride, setPosterOverride] = useState(null); // { base64, mediaType, previewDataUrl, filename }
  const [genResult, setGenResult] = useState(null); // { theme, html, filename, slug }
  const [filename, setFilename] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTournamentName(
        status?.defaults?.tournamentName || defaultName || ""
      );
      setCategory("");
      setPosterOverride(null);
      setGenResult(null);
      setFilename("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status?.defaults?.tournamentName, defaultName]);

  const posterPreviewUrl = useMemo(() => {
    if (posterOverride?.previewDataUrl) return posterOverride.previewDataUrl;
    return status?.defaults?.posterUrl || defaultPosterUrl || "";
  }, [posterOverride, status?.defaults?.posterUrl, defaultPosterUrl]);

  const handleFilePick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      toast.error("File phải là ảnh (PNG/JPG/WEBP)");
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error(`Ảnh vượt quá ${MAX_MB}MB`);
      return;
    }
    const base64 = await fileToBase64(f);
    const previewDataUrl = `data:${f.type};base64,${base64}`;
    setPosterOverride({
      base64,
      mediaType: f.type,
      previewDataUrl,
      filename: f.name,
    });
    setGenResult(null);
  };

  const handleGenerate = async () => {
    if (!tournamentName.trim()) {
      toast.error("Nhập tên giải");
      return;
    }
    try {
      const body = {
        tournamentName: tournamentName.trim(),
        category: category.trim(),
      };
      if (posterOverride) {
        body.posterBase64 = posterOverride.base64;
        body.posterMediaType = posterOverride.mediaType;
      }
      const res = await genOverlay({ tourId, ...body }).unwrap();
      setGenResult(res);
      setFilename(res.filename || `${slugify(tournamentName)}-scoreboard.html`);
      toast.success(`Đã tạo overlay: ${res.theme?.themeName || "OK"}`);
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.error ||
          "Không tạo được overlay — kiểm tra generator/api key"
      );
    }
  };

  const handleDeploy = async () => {
    if (!genResult?.html) return;
    const safeName = String(filename || "").trim();
    if (!/^[a-z0-9._-]+\.html$/i.test(safeName)) {
      toast.error("Tên file không hợp lệ (chỉ chữ/số/-_/., đuôi .html)");
      return;
    }
    try {
      const res = await deployOverlay({
        tourId,
        filename: safeName,
        html: genResult.html,
      }).unwrap();
      toast.success("Đã deploy + lưu URL vào giải");
      // Update local status so UI reflects new URL right away.
      if (res.url) {
        // status query auto-invalidates via tag, no manual work needed
      }
    } catch (err) {
      toast.error(err?.data?.message || err?.error || "Deploy thất bại");
    }
  };

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Đã copy URL");
    } catch {
      toast.info(url);
    }
  };

  const keyReady = !!status?.keySet;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pr: 5 }}>
        Tạo overlay scoreboard từ poster
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {statusLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={22} />
          </Box>
        )}

        {!statusLoading && !keyReady && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Overlay generator chưa được cấu hình API key. Liên hệ admin để đặt{" "}
            <code>ANTHROPIC_API_KEY</code> trên server (
            <code>/root/overlay-generator/.env</code>).
          </Alert>
        )}

        {status?.currentUrl && (
          <Alert severity="info" sx={{ mb: 2 }} icon={false}>
            <Stack spacing={1.2}>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
              >
                <Typography variant="body2" fontWeight={700}>
                  Overlay hiện tại của giải:
                </Typography>
                <MuiLink
                  href={status.currentUrl}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ wordBreak: "break-all" }}
                >
                  {status.currentUrl}
                </MuiLink>
                <Tooltip title="Mở">
                  <IconButton
                    size="small"
                    href={status.currentUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Copy">
                  <IconButton
                    size="small"
                    onClick={() => copyUrl(status.currentUrl)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>

              {Array.isArray(status.courts) && status.courts.length > 0 ? (
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mb: 0.5 }}
                  >
                    Link overlay theo từng sân ({status.courts.length}):
                  </Typography>
                  <Stack spacing={0.5}>
                    {status.courts.map((c) => {
                      const url = `${status.currentUrl}${
                        status.currentUrl.includes("?") ? "&" : "?"
                      }courtId=${c._id}`;
                      return (
                        <Stack
                          key={c._id}
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          sx={{
                            bgcolor: "background.paper",
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 1,
                            px: 1,
                            py: 0.5,
                          }}
                        >
                          <Typography
                            variant="body2"
                            fontWeight={700}
                            sx={{
                              minWidth: 90,
                              flexShrink: 0,
                            }}
                          >
                            {c.name}
                          </Typography>
                          {c.cluster && c.cluster !== "Main" && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ flexShrink: 0 }}
                            >
                              {c.cluster}
                            </Typography>
                          )}
                          <MuiLink
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            sx={{
                              fontSize: 12,
                              wordBreak: "break-all",
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            {url}
                          </MuiLink>
                          <Tooltip title="Mở overlay sân này">
                            <IconButton
                              size="small"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copy link">
                            <IconButton
                              size="small"
                              onClick={() => copyUrl(url)}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      );
                    })}
                  </Stack>
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Giải chưa có sân nào — thêm sân trong "Quản lý sân" để có link
                  overlay theo từng sân.
                </Typography>
              )}
            </Stack>
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems="stretch"
        >
          {/* LEFT: form */}
          <Box sx={{ flex: "0 0 340px", minWidth: 280 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              Poster giải
            </Typography>
            <Box
              sx={{
                mt: 0.5,
                mb: 1.5,
                border: "1.5px dashed",
                borderColor: "divider",
                borderRadius: 2,
                p: 1,
                minHeight: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "background.default",
              }}
            >
              {posterPreviewUrl ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={posterPreviewUrl}
                  alt="Poster giải"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 240,
                    borderRadius: 6,
                    objectFit: "contain",
                  }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Giải chưa có poster — hãy upload
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <input
                type="file"
                hidden
                ref={fileRef}
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFilePick}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => fileRef.current?.click()}
                sx={{ flex: 1 }}
              >
                {posterOverride ? "Đổi poster khác" : "Upload poster khác"}
              </Button>
              {posterOverride && (
                <Tooltip title="Quay về poster mặc định của giải">
                  <IconButton
                    size="small"
                    onClick={() => setPosterOverride(null)}
                  >
                    <RestartIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            {posterOverride && (
              <Typography variant="caption" color="text.secondary">
                Dùng ảnh mới: {posterOverride.filename}
              </Typography>
            )}

            <TextField
              label="Tên giải (hiển thị trên overlay)"
              fullWidth
              size="small"
              sx={{ mt: 2 }}
              value={tournamentName}
              onChange={(e) => setTournamentName(e.target.value)}
              helperText="Mặc định lấy từ tên giải, có thể sửa lại"
            />

            <TextField
              label="Nội dung mặc định (tuỳ chọn)"
              fullWidth
              size="small"
              sx={{ mt: 2 }}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="VD: GIẢI PICKLEBALL 2026"
            />

            <Button
              fullWidth
              variant="contained"
              color="warning"
              startIcon={
                generating ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AutoFixIcon />
                )
              }
              onClick={handleGenerate}
              disabled={generating || !keyReady || (!posterPreviewUrl)}
              sx={{ mt: 2 }}
            >
              {generating ? "Đang tạo overlay… (20-40s)" : "Tạo overlay"}
            </Button>

            {genResult && (
              <>
                <TextField
                  label="Tên file khi deploy"
                  fullWidth
                  size="small"
                  sx={{ mt: 2 }}
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  helperText="Chỉ dùng chữ/số/-_/. — đuôi .html"
                />
                <Button
                  fullWidth
                  variant="contained"
                  color="primary"
                  startIcon={
                    deploying ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <RocketIcon />
                    )
                  }
                  onClick={handleDeploy}
                  disabled={deploying}
                  sx={{ mt: 1.5 }}
                >
                  {deploying ? "Đang deploy…" : "Deploy & lưu URL vào giải"}
                </Button>
              </>
            )}
          </Box>

          {/* RIGHT: preview */}
          <Box
            sx={{
              flex: 1,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              overflow: "hidden",
              minHeight: 480,
              bgcolor: "#0a0f1a",
              position: "relative",
            }}
          >
            {genResult?.html ? (
              <iframe
                title="Overlay preview"
                srcDoc={genResult.html}
                style={{
                  width: 1920,
                  height: 1080,
                  border: 0,
                  transform: "scale(0.5)",
                  transformOrigin: "top left",
                }}
              />
            ) : (
              <Box
                sx={{
                  height: "100%",
                  minHeight: 480,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "text.disabled",
                }}
              >
                <Stack alignItems="center" spacing={1}>
                  <AutoFixIcon sx={{ fontSize: 40 }} />
                  <Typography variant="body2">
                    Bấm "Tạo overlay" để xem trước
                  </Typography>
                </Stack>
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}

OverlayGeneratorDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  tourId: PropTypes.string.isRequired,
  defaultName: PropTypes.string,
  defaultPosterUrl: PropTypes.string,
};

OverlayGeneratorDialog.defaultProps = {
  defaultName: "",
  defaultPosterUrl: "",
};
