/* eslint-disable react/prop-types */
import {
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Stack,
  Typography,
  Chip,
  Avatar,
  Box,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import PlaceIcon from "@mui/icons-material/Place";
import { Link as RouterLink } from "react-router-dom";

export default function ClubCard({ club }) {
  const cover = club?.coverUrl || club?.logoUrl || "/placeholder-cover.jpg";
  const logo = club?.logoUrl || "/placeholder-logo.png";
  return (
    <Card elevation={1} sx={{ borderRadius: 3, overflow: "hidden" }}>
      <CardActionArea component={RouterLink} to={`/clubs/${club._id}`}>
        <Box
          sx={{
            position: "relative",
            height: 140,
            bgcolor: "background.default",
          }}
        >
          <CardMedia
            component="img"
            src={cover}
            alt={club.name}
            sx={{ height: 140, objectFit: "cover" }}
          />
          <Avatar
            src={logo}
            alt={club.name}
            sx={{
              position: "absolute",
              left: 16,
              bottom: -28,
              width: 56,
              height: 56,
              border: "3px solid",
              borderColor: "background.paper",
            }}
          />
        </Box>
        <CardContent sx={{ pt: 4 }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography variant="h6" noWrap>
                {club.name}
              </Typography>
              {club.isVerified && (
                <Chip size="small" color="primary" label="Verified" />
              )}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {(club.sportTypes || []).map((s) => (
                <Chip key={s} size="small" label={s} />
              ))}
            </Stack>

            <Stack direction="row" spacing={2} sx={{ color: "text.secondary" }}>
              {(club.province || club.city) && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <PlaceIcon fontSize="small" />
                  <Typography variant="body2" noWrap>
                    {club.city ? `${club.city}, ` : ""}
                    {club.province || ""}
                  </Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <GroupsIcon fontSize="small" />
                <Typography variant="body2">
                  {club?.stats?.memberCount ?? 0} thành viên
                </Typography>
              </Stack>
            </Stack>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
