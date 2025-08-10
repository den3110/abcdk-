// src/pages/LiveReferee.jsx
import { Button, Stack, Card, Typography, Box, Chip } from "@mui/material";
import { useParams } from "react-router-dom";
import { useLiveMatch } from "../hooks/useLiveMatch";

export default function LiveReferee() {
  const { matchId } = useParams(); // /referee/live/:matchId
  // lấy token từ store auth (nếu cần), truyền vào hook để server kiểm role
  const token = localStorage.getItem("token");
  const { loading, data: m, api } = useLiveMatch(matchId, token);

  if (loading || !m)
    return (
      <Box p={2}>
        <Typography>Đang tải…</Typography>
      </Box>
    );

  return (
    <Box p={2} display="grid" gap={2}>
      <Card sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Điều khiển trận
        </Typography>

        <Chip
          size="small"
          label={
            m.status === "live"
              ? "Đang diễn ra"
              : m.status === "finished"
              ? "Kết thúc"
              : "Chưa bắt đầu"
          }
          color={
            m.status === "live"
              ? "warning"
              : m.status === "finished"
              ? "success"
              : "default"
          }
          sx={{ mb: 2 }}
        />

        {m.status !== "live" ? (
          <Button variant="contained" onClick={() => api.start()}>
            Bắt đầu trận
          </Button>
        ) : (
          <>
            <Stack direction="row" spacing={2} justifyContent="center" mt={1}>
              <Button onClick={api.pointA} variant="contained" size="large">
                +1 Đội A
              </Button>
              <Button onClick={api.pointB} variant="contained" size="large">
                +1 Đội B
              </Button>
            </Stack>

            <Stack direction="row" spacing={2} justifyContent="center" mt={1}>
              <Button onClick={api.undo} variant="outlined">
                Hoàn tác
              </Button>
              <Button
                onClick={() => api.finish("A")}
                color="success"
                variant="contained"
              >
                Chốt A thắng
              </Button>
              <Button
                onClick={() => api.finish("B")}
                color="success"
                variant="contained"
              >
                Chốt B thắng
              </Button>
            </Stack>

            <Stack direction="row" spacing={2} justifyContent="center" mt={1}>
              <Button onClick={() => api.forfeit("A")} color="error">
                W/O A
              </Button>
              <Button onClick={() => api.forfeit("B")} color="error">
                W/O B
              </Button>
            </Stack>
          </>
        )}
      </Card>

      <Card sx={{ p: 2 }}>
        <Typography variant="h6">Bảng điểm</Typography>
        <Box
          textAlign="center"
          sx={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, my: 1 }}
        >
          {m.gameScores?.[m.currentGame]?.a ?? 0} :{" "}
          {m.gameScores?.[m.currentGame]?.b ?? 0}
        </Box>
      </Card>
    </Box>
  );
}
