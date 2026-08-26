/* eslint-disable react/prop-types */
import { Stack, Button } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { toast } from "react-toastify";
import ClubJoinButton from "./ClubJoinButton";

async function shareClub(club) {
  const url = `https://pickletour.vn/clubs/${club?._id}`;
  const title = club?.name || "Câu lạc bộ";
  try {
    if (navigator.share) {
      await navigator.share({
        title,
        text: `Tham gia CLB ${title} trên PickleTour`,
        url,
      });
      return;
    }
  } catch {
    return; // user huỷ share
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Đã sao chép liên kết CLB.");
  } catch {
    window.prompt("Sao chép liên kết:", url);
  }
}

export default function ClubActions({ club, my }) {
  const state = my?.isMember
    ? "member"
    : my?.pendingRequest
      ? "pending"
      : "not_member";

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <ClubJoinButton club={club} state={state} />
      <Button startIcon={<ShareIcon />} onClick={() => shareClub(club)}>
        Chia sẻ
      </Button>
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
