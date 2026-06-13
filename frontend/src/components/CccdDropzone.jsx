import { useCallback, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { useDropzone } from "react-dropzone";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";

export default function CccdDropzone({
  label,
  file,
  onFile,
  busy = false,
  helperText = "",
}) {
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : ""),
    [file],
  );

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const onDrop = useCallback(
    (accepted) => {
      if (accepted[0]) onFile(accepted[0]);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      accept: { "image/*": [] },
      multiple: false,
      maxSize: 10 * 1024 * 1024,
    });

  const error =
    fileRejections.length > 0
      ? "File vượt quá 10 MB hoặc sai định dạng"
      : null;

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
        minHeight: 190,
        opacity: busy ? 0.82 : 1,
      }}
    >
      <input {...getInputProps()} />
      <Stack spacing={1} sx={{ width: "100%" }} alignItems="center">
        {busy ? (
          <CircularProgress size={28} />
        ) : previewUrl ? (
          <img
            src={previewUrl}
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
              ? "Thả ảnh vào đây..."
              : `Kéo & thả ${label.toLowerCase()} hoặc bấm để chọn`}
          </Typography>
        )}
        <Typography variant="caption">{label}</Typography>
        {helperText && (
          <Typography variant="caption" color="text.secondary">
            {helperText}
          </Typography>
        )}
        {error && (
          <Typography variant="caption" color="error">
            {error}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

CccdDropzone.propTypes = {
  label: PropTypes.string.isRequired,
  file: PropTypes.object,
  onFile: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  helperText: PropTypes.string,
};
