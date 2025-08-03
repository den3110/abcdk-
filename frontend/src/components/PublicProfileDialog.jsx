// src/components/PublicProfileDialog.jsx
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Drawer,
  IconButton,
  Tabs,
  Tab,
  Button,
  Avatar,
  Stack,
  Typography,
  CircularProgress,
  Alert,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  useTheme,
  useMediaQuery,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
} from "../slices/usersApiSlice";
import { useState } from "react";

const PLACE = "https://dummyimage.com/80x80/cccccc/ffffff&text=?";

export default function PublicProfileDialog({ open, onClose, userId }) {
  /* queries */
  const baseQ = useGetPublicProfileQuery(userId, { skip: !open });
  const rateQ = useGetRatingHistoryQuery(userId, { skip: !open });
  const matchQ = useGetMatchHistoryQuery(userId, { skip: !open });

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Bangkok" });
  const fmtDT = (iso) =>
    new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok" });

  const loading = baseQ.isLoading || rateQ.isLoading || matchQ.isLoading;
  const error = baseQ.error || rateQ.error || matchQ.error;

  /* responsive */
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [tab, setTab] = useState(0);

  /* ------------- UI section render helpers ------------- */
  const InfoSection = () => (
    <Stack spacing={2} alignItems="center">
      <Avatar src={baseQ.data.avatar || PLACE} sx={{ width: 80, height: 80 }} />
      <Typography variant="h6">{baseQ.data.nickname}</Typography>
      <Box>
        <Typography variant="body2">
          Giới tính: {baseQ.data.gender || "--"}
        </Typography>
        <Typography variant="body2">
          Tỉnh / TP: {baseQ.data.province || "--"}
        </Typography>
        <Typography variant="body2">
          Tham gia: {fmtDate(baseQ.data.joinedAt)}
        </Typography>
      </Box>
      <Box width="100%">
        <Typography variant="subtitle2">Giới thiệu:</Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {baseQ.data.bio || "Chưa có"}
        </Typography>
      </Box>
    </Stack>
  );

  const RatingTable = () => (
    <>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Lịch sử điểm trình
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Ngày</TableCell>
            <TableCell align="right">Điểm đơn</TableCell>
            <TableCell align="right">Điểm đôi</TableCell>
            <TableCell>Ghi chú</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rateQ.data.length ? (
            rateQ.data.map((h) => (
              <TableRow key={h._id}>
                <TableCell>{fmtDate(h.date)}</TableCell>
                <TableCell align="right">{h.ratingSingle}</TableCell>
                <TableCell align="right">{h.ratingDouble}</TableCell>
                <TableCell>{h.note}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={4}
                align="center"
                sx={{ fontStyle: "italic" }}
              >
                Không có dữ liệu
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );

  const MatchTable = () => (
    <>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        Lịch sử thi đấu
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Ngày &amp; giờ</TableCell>
            <TableCell>Tên giải</TableCell>
            <TableCell>Đội 1</TableCell>
            <TableCell>Tỷ số</TableCell>
            <TableCell>Đội 2</TableCell>
            <TableCell>Video</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {matchQ.data.length ? (
            matchQ.data.map((m) => (
              <TableRow key={m._id}>
                <TableCell>{m._id.slice(-5)}</TableCell>
                <TableCell>{fmtDT(m.dateTime)}</TableCell>
                <TableCell>{m.tournament}</TableCell>
                <TableCell>{m.team1}</TableCell>
                <TableCell>{m.score}</TableCell>
                <TableCell>{m.team2}</TableCell>
                <TableCell>
                  {m.video ? (
                    <a href={m.video} target="_blank" rel="noopener noreferrer">
                      Link
                    </a>
                  ) : (
                    "--"
                  )}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={7}
                align="center"
                sx={{ fontStyle: "italic" }}
              >
                Không có dữ liệu
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );

  /* ------------- Render for mobile = Drawer ------------- */
  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            height: "90vh",
            p: 2,
          },
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">Hồ sơ</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        {loading ? (
          <Box mt={3} textAlign="center">
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error?.data?.message || error.error || "Lỗi tải dữ liệu"}
          </Alert>
        ) : (
          <>
            {/* Tabs */}
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="fullWidth"
              sx={{ mb: 2 }}
            >
              <Tab label="Thông tin" />
              <Tab label="Điểm trình" />
              <Tab label="Thi đấu" />
            </Tabs>

            <Box
              sx={{
                overflowY: "auto",
                pb: 4,
                px: 1,
                height: "calc(90vh - 120px)",
              }}
            >
              {tab === 0 && <InfoSection />}
              {tab === 1 && <RatingTable />}
              {tab === 2 && <MatchTable />}
            </Box>
          </>
        )}
      </Drawer>
    );
  }

  /* ------------- Desktop Dialog ------------- */
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Hồ sơ công khai</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <CircularProgress />
        ) : error ? (
          <Alert severity="error">
            {error?.data?.message || error.error || "Lỗi tải dữ liệu"}
          </Alert>
        ) : (
          <>
            <InfoSection />
            <Divider sx={{ my: 2 }} />
            <RatingTable />
            <Divider sx={{ my: 2 }} />
            <MatchTable />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
}
