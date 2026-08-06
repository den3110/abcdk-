// components/coaches/CoachAchievementsSection.jsx
// Hiển thị danh sách thành tích của 1 HLV trên trang profile.
// Owner + admin thấy cả pending/rejected + nút "Bổ sung thành tích" (mở dialog).
// Guest chỉ thấy approved.
import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { Plus, Trash2, Award, Clock, XCircle } from "lucide-react";
import { toast } from "react-toastify";

import {
  useListCoachAchievementsQuery,
  useDeleteCoachAchievementMutation,
} from "../../slices/coachesApiSlice.js";
import CoachAchievementDialog from "./CoachAchievementDialog.jsx";

const LEVEL_LABEL = {
  national: "Quốc gia",
  regional: "Khu vực",
  local: "Địa phương",
  club: "CLB",
  other: "Khác",
};
const LEVEL_COLOR = {
  national: "error",
  regional: "warning",
  local: "info",
  club: "success",
  other: "default",
};
const STATUS_META = {
  approved: { color: "success", label: "Đã duyệt", icon: <Award size={12} /> },
  pending: {
    color: "warning",
    label: "Chờ duyệt",
    icon: <Clock size={12} />,
  },
  rejected: {
    color: "error",
    label: "Từ chối",
    icon: <XCircle size={12} />,
  },
};

export default function CoachAchievementsSection({
  userId,
  isSelf,
  isAdminViewer,
  isCoach,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useListCoachAchievementsQuery(userId, {
    skip: !userId,
  });
  const [deleteMut] = useDeleteCoachAchievementMutation();
  const items = data?.items || [];
  const canAdd = isSelf && isCoach;

  const handleDelete = async (id) => {
    if (!window.confirm("Xoá thành tích này?")) return;
    try {
      await deleteMut(id).unwrap();
      toast.success("Đã xoá");
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, mt: 2 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1.5 }}
        >
          <Typography variant="h6" fontWeight={800}>
            Thành tích HLV
          </Typography>
          {canAdd && (
            <Button
              startIcon={<Plus size={16} />}
              size="small"
              variant="outlined"
              onClick={() => setAddOpen(true)}
            >
              Bổ sung thành tích
            </Button>
          )}
        </Stack>

        {isLoading ? (
          <Box textAlign="center" py={2}>
            <CircularProgress size={22} />
          </Box>
        ) : items.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            {canAdd
              ? 'Chưa có thành tích. Bấm "Bổ sung thành tích" để gửi admin duyệt.'
              : "Chưa có thành tích được công bố."}
          </Alert>
        ) : (
          <Stack spacing={1.25}>
            {items.map((a) => {
              const statusMeta = STATUS_META[a.status] || STATUS_META.pending;
              const showControls =
                isSelf && a.status === "pending" && !isAdminViewer;
              return (
                <Box
                  key={a._id}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: 1,
                    borderColor: "divider",
                    bgcolor: a.status === "pending" ? "action.hover" : "transparent",
                    opacity: a.status === "rejected" ? 0.6 : 1,
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.25}
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.5} flex={1} minWidth={0}>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Typography variant="body1" fontWeight={700}>
                          {a.title}
                        </Typography>
                        {a.year && (
                          <Chip
                            size="small"
                            label={a.year}
                            variant="outlined"
                          />
                        )}
                        <Chip
                          size="small"
                          label={LEVEL_LABEL[a.level] || "Khác"}
                          color={LEVEL_COLOR[a.level] || "default"}
                          variant={a.level === "other" ? "outlined" : "filled"}
                        />
                        {(isSelf || isAdminViewer) && (
                          <Chip
                            size="small"
                            icon={statusMeta.icon}
                            label={statusMeta.label}
                            color={statusMeta.color}
                            variant="outlined"
                          />
                        )}
                      </Stack>
                      {a.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ whiteSpace: "pre-wrap" }}
                        >
                          {a.description}
                        </Typography>
                      )}
                      {a.adminNote && a.status === "rejected" && (
                        <Typography
                          variant="caption"
                          color="error"
                          sx={{ fontStyle: "italic" }}
                        >
                          Admin: {a.adminNote}
                        </Typography>
                      )}
                    </Stack>
                    {showControls && (
                      <Tooltip title="Xoá thành tích chờ duyệt">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(a._id)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>
      <CoachAchievementDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        coachId={userId}
      />
    </Card>
  );
}
