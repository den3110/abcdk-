/* eslint-disable react/prop-types */
import {
  Box,
  Stack,
  Typography,
  Avatar,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";

/* ===== Helpers: Việt hoá các giá trị ===== */
const VI = {
  visibility: {
    public: "Loại nhóm: Công khai",
    private: "Loại nhóm: Riêng tư",
    hidden: "Loại nhóm: Ẩn",
  },
  joinPolicy: {
    open: "Mở tự do",
    approval: "Duyệt trước",
    invite_only: "Chỉ qua lời mời",
  },
  sport: {
    pickleball: "Pickleball",
    tennis: "Quần vợt",
    badminton: "Cầu lông",
    table_tennis: "Bóng bàn",
    padel: "Padel",
  },
};

const fallbackLabel = (val) =>
  typeof val === "string" && val.trim()
    ? val.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Không rõ";

export default function ClubHeader({ club, onEdit }) {
  const cover = club?.coverUrl || "/placeholder-cover.jpg";
  const logo = club?.logoUrl || "/placeholder-logo.png";

  const viVisibility =
    VI.visibility[club?.visibility] || fallbackLabel(club?.visibility);
  const viJoinPolicy =
    VI.joinPolicy[club?.joinPolicy] || fallbackLabel(club?.joinPolicy);

  return (
    <Box
      sx={{
        borderRadius: 3,
        overflow: "hidden",
        mb: 2,
        bgcolor: "background.default",
      }}
    >
      <Box sx={{ position: "relative", height: 220 }}>
        <img
          src={cover}
          alt={`Ảnh bìa CLB ${club?.name || ""}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <Avatar
          src={logo}
          alt={`Logo CLB ${club?.name || ""}`}
          sx={{
            position: "absolute",
            left: 24,
            bottom: -36,
            width: 80,
            height: 80,
            border: "4px solid",
            borderColor: "background.paper",
          }}
        />
        {onEdit && (
          <Tooltip title="Chỉnh sửa CLB">
            <IconButton
              onClick={onEdit}
              size="small"
              sx={{
                position: "absolute",
                top: 12,
                right: 12,
                bgcolor: "background.paper",
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Stack spacing={1} sx={{ p: 2, pt: 4 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ flexWrap: "wrap" }}
        >
          <Typography variant="h5">{club?.name}</Typography>

          {club?.isVerified && (
            <Chip size="small" color="success" label="Đã xác minh" />
          )}

          {club?.shortCode && (
            <Chip size="small" label={`Mã: ${club.shortCode}`} />
          )}

          <Chip size="small" label={viVisibility} />
          <Chip size="small" label={`Tham gia: ${viJoinPolicy}`} />
        </Stack>

        {club?.description && (
          <Typography variant="body1" color="text.secondary">
            {club.description}
          </Typography>
        )}

        {club?.sportTypes?.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {club.sportTypes.map((s) => (
              <Chip
                key={s}
                size="small"
                label={VI.sport[s] || fallbackLabel(s)}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}
