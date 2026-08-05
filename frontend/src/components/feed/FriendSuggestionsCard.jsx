// Sidebar card gợi ý kết bạn theo tỉnh + điểm trình
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { UserPlus, MapPin } from "lucide-react";
import { toast } from "react-toastify";

import {
  useFriendSuggestionsQuery,
  useSendFriendRequestMutation,
} from "../../slices/friendsApiSlice.js";
import ScoreBadges from "./ScoreBadges.jsx";

export default function FriendSuggestionsCard() {
  const { data, isLoading, refetch } = useFriendSuggestionsQuery({ limit: 8 });
  const [sendRequest, { isLoading: sending }] = useSendFriendRequestMutation();
  const [pendingIds, setPendingIds] = useState(new Set());
  const items = data?.items || [];

  const handleAdd = async (userId) => {
    try {
      await sendRequest(userId).unwrap();
      setPendingIds((prev) => new Set(prev).add(String(userId)));
      toast.success("Đã gửi lời mời kết bạn");
    } catch (err) {
      toast.error(err?.data?.message || "Gửi lời mời thất bại");
    }
  };

  return (
    <Card sx={{ borderRadius: 3, position: "sticky", top: 84 }}>
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ mb: 1.5 }}
        >
          <Typography variant="subtitle1" fontWeight={800}>
            Gợi ý kết bạn
          </Typography>
          <Button size="small" onClick={refetch} sx={{ textTransform: "none" }}>
            Làm mới
          </Button>
        </Stack>
        <Divider sx={{ mb: 1.5 }} />

        {isLoading && (
          <Stack spacing={1.5}>
            {[...Array(4)].map((_, i) => (
              <Stack key={i} direction="row" spacing={1.5} alignItems="center">
                <Skeleton variant="circular" width={44} height={44} />
                <Box flex={1}>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="40%" />
                </Box>
              </Stack>
            ))}
          </Stack>
        )}

        {!isLoading && items.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Chưa có gợi ý — hãy cập nhật tỉnh thành + điểm trình để hệ thống
            gợi ý tốt hơn.
          </Typography>
        )}

        <Stack spacing={1.25} divider={<Divider flexItem />}>
          {items.map((u) => {
            const isPending = pendingIds.has(String(u._id));
            return (
              <Stack
                key={u._id}
                direction="row"
                spacing={1.25}
                alignItems="center"
              >
                <Avatar
                  src={u.avatar || ""}
                  component={RouterLink}
                  to={`/profile/${u._id}`}
                  sx={{ width: 44, height: 44 }}
                >
                  {(u.nickname || u.name || "?")[0]?.toUpperCase()}
                </Avatar>
                <Box flex={1} minWidth={0}>
                  <Typography
                    component={RouterLink}
                    to={`/profile/${u._id}`}
                    variant="body2"
                    fontWeight={700}
                    noWrap
                    sx={{
                      color: "text.primary",
                      textDecoration: "none",
                      "&:hover": { textDecoration: "underline" },
                      display: "block",
                    }}
                  >
                    {u.nickname || u.name}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{ mt: 0.25 }}
                  >
                    <ScoreBadges
                      single={u?.score?.single}
                      double={u?.score?.double}
                    />
                  </Stack>
                  {u.province && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      sx={{ mt: 0.5 }}
                    >
                      <MapPin size={12} color="#94A3B8" />
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {u.province}
                      </Typography>
                    </Stack>
                  )}
                </Box>
                <Button
                  size="small"
                  variant={isPending ? "outlined" : "contained"}
                  startIcon={!isPending ? <UserPlus size={14} /> : null}
                  onClick={() => !isPending && handleAdd(u._id)}
                  disabled={isPending || sending}
                  sx={{ textTransform: "none", minWidth: 90 }}
                >
                  {isPending ? "Đã gửi" : "Kết bạn"}
                </Button>
              </Stack>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
