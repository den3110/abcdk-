/* eslint-disable react/prop-types */
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  Stack,
  Button,
  Paper,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Alert,
  CircularProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import { useGetNoShowReportQuery } from "../../../slices/venuesApiSlice";
import { fmtVND } from "../courtShared";

function StatCard({ icon, label, value, color = "text.primary" }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: "text.secondary", mb: 0.5 }}>
          {icon}
          <Typography variant="caption">{label}</Typography>
        </Stack>
        <Typography variant="h4" fontWeight={900} sx={{ color, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function fmtLastAt(x) {
  if (!x) return "—";
  return new Date(x).toLocaleDateString("vi-VN");
}

export default function NoShowReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isFetching } = useGetNoShowReportQuery(
    { venueId: id },
    { skip: !id },
  );

  const total = data?.total || 0;
  const uniqueCustomers = data?.uniqueCustomers || 0;
  const customers = Array.isArray(data?.customers) ? data.customers : [];
  const loading = isLoading || isFetching;

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/owner/venues/${id}`)} sx={{ mb: 1 }}>
        Quản lý cụm sân
      </Button>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
        Khách bỏ hẹn
      </Typography>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6 }}>
              <StatCard
                icon={<EventBusyIcon sx={{ fontSize: 18 }} />}
                label="Tổng lượt bỏ hẹn"
                value={total}
                color="error.main"
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <StatCard
                icon={<PeopleAltIcon sx={{ fontSize: 18 }} />}
                label="Số khách"
                value={uniqueCustomers}
                color="primary.main"
              />
            </Grid>
          </Grid>

          {customers.length === 0 ? (
            <Alert severity="success">Chưa có khách nào bỏ hẹn.</Alert>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Khách</TableCell>
                      <TableCell align="center">Số lần</TableCell>
                      <TableCell align="right">Thất thu</TableCell>
                      <TableCell align="right">Lần gần nhất</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {customers.map((c, i) => (
                      <TableRow key={c.userId || i} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            {c.name || "Khách vãng lai"}
                          </Typography>
                          {c.phone ? (
                            <Typography variant="caption" color="text.secondary">
                              {c.phone}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell align="center">
                          <Chip size="small" color="error" label={c.count} sx={{ fontWeight: 700 }} />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: "warning.main" }}>
                          {fmtVND(c.lostRevenue)}
                        </TableCell>
                        <TableCell align="right">{fmtLastAt(c.lastAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Paper>
          )}
        </>
      )}
    </Container>
  );
}
