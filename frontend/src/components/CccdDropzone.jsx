import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Box, Typography, Stack } from "@mui/material";

/**
 * Reusable drag‑&‑drop zone cho ảnh CCCD.
 * ‑ Responsive: flex:1 nên chia đôi hàng, XS sẽ wrap xuống cột.
 * ‑ Tự co ảnh, không vỡ layout khi preview.
 * ‑ Chỉ nhận file ảnh ≤ 10 MB.
 */
export default function CccdDropzone({ label, file, onFile }) {
  const onDrop = useCallback(
    (accepted) => accepted[0] && onFile(accepted[0]),
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: { "image/*": [] },
      multiple: false,
      maxSize: 10 * 1024 * 1024, // 10 MB
    });

  const error =
    fileRejections.length > 0 ? "File vượt quá 10 MB hoặc sai định dạng" : null;

  return (
    <Box
      {...getRootProps()}
      sx={{
        flex: 1,
        minWidth: 0,
        border: "2px dashed #ccc",
        borderRadius: 2,
        p: 2,
        textAlign: "center",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <input {...getInputProps()} />
      <Stack spacing={1} sx={{ width: "100%" }} alignItems="center">
        {file ? (
          <img
            src={URL.createObjectURL(file)}
            alt="preview"
            style={{
              width: "100%",
              height: "auto",
              maxHeight: 160,
              objectFit: "contain",
            }}
          />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ wordBreak: "break-word" }}
          >
            {isDragActive
              ? "Thả ảnh vào đây…"
              : `Kéo & thả ${label.toLowerCase()} hoặc bấm để chọn`}
          </Typography>
        )}
        <Typography variant="caption">{label}</Typography>
        {error && (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
