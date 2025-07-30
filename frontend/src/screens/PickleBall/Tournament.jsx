// src/pages/TournamentDashboard.jsx – Material UI version
import { useState, Fragment } from "react";
import { useSearchParams, Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Paper,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Avatar,
  Dialog,
  DialogContent,
  IconButton,
  Button,
  CircularProgress,
  Alert,
  Chip,
} from "@mui/material";
import PreviewIcon from "@mui/icons-material/Preview";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CloseIcon from "@mui/icons-material/Close";
import { useGetTournamentsQuery } from "../../slices/tournamentsApiSlice";
import { Stack } from "@mui/material";
const THUMB_SIZE = 78;

const statusColor = {
  "Sắp diễn ra": "info",
  "Đang diễn ra": "success",
  "Đã diễn ra": "default",
};

const columns = [
  { label: "Ảnh", minWidth: THUMB_SIZE },
  { label: "Tên giải" },
  { label: "Hạn đăng ký" },
  { label: "Đăng ký / Dự kiến", align: "center" },
  { label: "Số trận", align: "center" },
  { label: "Thời gian" },
  { label: "Địa điểm" },
  { label: "Trạng thái", align: "center" },
  { label: "Hành động", align: "center" },
];

export default function TournamentDashboard() {
  const [params] = useSearchParams();
  const sportType = params.get("sportType") || 2;
  const groupId = params.get("groupId") || 0;

  const [tab, setTab] = useState("Sắp diễn ra");
  const [previewSrc, setPreviewSrc] = useState(null);

  const {
    data: tournaments,
    isLoading,
    error,
  } = useGetTournamentsQuery({ sportType, groupId });

  const handleChangeTab = (_, v) => setTab(v);

  // === helpers
  const formatDate = (d) =>
    new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const rows = (tList) =>
    tList.map((t) => (
      <TableRow hover key={t._id}>
        {/* Thumb */}
        <TableCell sx={{ py: 1.5 }}>
          <Box
            component="img"
            src={t.image}
            alt={t.name}
            sx={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              objectFit: "cover",
              borderRadius: 1,
              cursor: "zoom-in",
              transition: "transform 0.2s",
              "&:hover": { transform: "scale(1.1)" },
            }}
            onClick={() => setPreviewSrc(t.image)}
          />
        </TableCell>

        <TableCell>{t.name}</TableCell>
        <TableCell>{formatDate(t.registrationDeadline)}</TableCell>
        <TableCell align="center">
          {t.registered}/{t.expected}
        </TableCell>
        <TableCell align="center">{t.matchesCount}</TableCell>
        <TableCell>
          {formatDate(t.startDate)} – {formatDate(t.endDate)}
        </TableCell>
        <TableCell>{t.location}</TableCell>
        <TableCell align="center">
          <Chip label={t.status} color={statusColor[t.status]} size="small" />
        </TableCell>
        {/* ACTIONS */}
        <TableCell align="center">
          <Box display="flex" flexWrap="wrap" justifyContent="center" gap={1.5}>
            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/register`}
              size="small"
              variant="contained"
              color="primary"
              startIcon={<HowToRegIcon />}
            >
              Đăng ký
            </Button>

            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/checkin`}
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
            >
              Check‑in
            </Button>

            <Button
              component={RouterLink}
              to={`/tournament/${t._id}/bracket`}
              size="small"
              variant="outlined"
              color="info"
              startIcon={<AccountTreeIcon />}
            >
              Sơ đồ
            </Button>
          </Box>
        </TableCell>
      </TableRow>
    ));

  return (
    <Container sx={{ py: 4 }}>
      <Typography variant="h5" mb={3} fontWeight={600}>
        Dashboard Giải đấu
      </Typography>

      {/* Loading / Error */}
      {isLoading && (
        <Box textAlign="center" my={5}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error?.data?.message || error.error}
        </Alert>
      )}

      {/* Tabs + Table */}
      {tournaments && (
        <Fragment>
          <Tabs
            value={tab}
            onChange={handleChangeTab}
            sx={{ mb: 2 }}
            variant="scrollable"
          >
            {["Sắp diễn ra", "Đang diễn ra", "Đã diễn ra"].map((label) => (
              <Tab
                key={label}
                value={label}
                label={label}
                icon={<PreviewIcon fontSize="small" sx={{ ml: -0.5 }} />}
                iconPosition="start"
              />
            ))}
          </Tabs>

          <Paper elevation={2}>
            <TableContainer sx={{ maxHeight: { xs: 480, md: 640 } }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {columns.map((col) => (
                      <TableCell
                        key={col.label}
                        align={col.align || "left"}
                        sx={{
                          minWidth: col.minWidth,
                          fontWeight: 600,
                          backgroundColor: "background.default",
                        }}
                      >
                        {col.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>

                <TableBody>
                  {rows(tournaments.filter((t) => t.status === tab))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Fragment>
      )}

      {/* Image preview */}
      <Dialog
        open={Boolean(previewSrc)}
        onClose={() => setPreviewSrc(null)}
        maxWidth="md"
      >
        <IconButton
          aria-label="close"
          onClick={() => setPreviewSrc(null)}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ p: 0 }}>
          <Box
            component="img"
            src={previewSrc}
            alt="Preview"
            sx={{ width: "100%", height: "auto" }}
          />
        </DialogContent>
      </Dialog>
    </Container>
  );
}
