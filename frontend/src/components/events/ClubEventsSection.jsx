/* eslint-disable react/prop-types */
import React, { useMemo, useState } from "react";
import {
  Box,
  Stack,
  Button,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Chip,
  Skeleton, // ⬅️ NEW
} from "@mui/material";
import EventCard from "./EventCard";
import EventCreateDialog from "./EventCreateDialog";
import { useListEventsQuery } from "../../slices/clubsApiSlice";

function SkeletonEventCard() {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      {/* Ảnh/cover giả lập */}
      <Skeleton variant="rectangular" height={120} />

      <CardHeader
        avatar={<Skeleton variant="circular" width={40} height={40} />}
        title={<Skeleton width="60%" />}
        subheader={<Skeleton width="40%" />}
        sx={{ pb: 0.5 }}
      />
      <CardContent sx={{ pt: 1.5 }}>
        <Stack spacing={1.25}>
          <Skeleton width="85%" />
          <Skeleton width="70%" />
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            <Skeleton variant="rounded" width={64} height={24} />
            <Skeleton variant="rounded" width={92} height={24} />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function ClubEventsSection({ club, canManage }) {
  const clubId = club?._id;
  const { data, isLoading, isFetching, refetch } = useListEventsQuery(
    { id: clubId },
    { skip: !clubId }
  );

  const loading = isLoading || isFetching;
  const items = useMemo(() => data?.items || [], [data]);
  const [openCreate, setOpenCreate] = useState(false);

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" color="text.secondary">
          Sự kiện sắp tới
        </Typography>

        {canManage &&
          (loading ? (
            <Skeleton variant="rounded" width={140} height={36} />
          ) : (
            <Button variant="contained" onClick={() => setOpenCreate(true)}>
              Tạo sự kiện
            </Button>
          ))}
      </Stack>

      <Grid container spacing={2}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Grid key={i} item xs={12} sm={6}>
                <SkeletonEventCard />
              </Grid>
            ))
          : items.map((ev) => (
              <Grid key={ev._id} item xs={12} sm={6}>
                <EventCard
                  clubId={clubId}
                  event={ev}
                  canManage={canManage}
                  onChanged={refetch}
                />
              </Grid>
            ))}
      </Grid>

      {!loading && items.length === 0 && (
        <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          <Typography>Chưa có sự kiện nào.</Typography>
        </Box>
      )}

      <EventCreateDialog
        open={openCreate}
        onClose={(ok) => {
          setOpenCreate(false);
          if (ok) refetch();
        }}
        clubId={clubId}
      />
    </Stack>
  );
}
