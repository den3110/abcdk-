/* eslint-disable react/prop-types */
import { Stack, Button } from "@mui/material";
import ClubJoinButton from "./ClubJoinButton";

export default function ClubActions({ club, my }) {
  const state = my?.isMember
    ? "member"
    : my?.pendingRequest
    ? "pending"
    : "not_member";

  return (
    <Stack direction="row" spacing={1}>
      <ClubJoinButton club={club} state={state} />
      {/* chỗ này có thể thêm nút Share, Open Website, Facebook... */}
      {club.website && (
        <Button
          component="a"
          href={club.website}
          target="_blank"
          rel="noopener"
        >
          Website
        </Button>
      )}
    </Stack>
  );
}
