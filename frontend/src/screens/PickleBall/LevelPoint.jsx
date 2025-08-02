import React, { useState, useMemo } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Avatar,
  Menu,
  MenuItem,
  IconButton,
  Container,
  Box,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Select,
  FormControl,
  Button,
  Chip,
  Stack,
  Card,
  CardContent,
  CardHeader,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";

/**
 * Bảng cấu hình kỹ năng & trọng số – đầy đủ giống bản gốc
 * Trọng số cộng lại đúng 1.0 → điểm tổng nằm trong [0, 10]
 */
const SKILLS = [
  {
    id: 1,
    name: "Forehand (Thuận tay)",
    explain:
      "• Điều khiển cú đánh (độ sâu, hướng, xoáy)\n• Khả năng đánh nhanh & chính xác\n• Dùng trong cả tấn công & phòng thủ",
    weight: 0.15,
  },
  {
    id: 2,
    name: "Backhand (Trái tay)",
    explain:
      "• Đánh trái tay ổn định\n• Điều khiển tốc độ, độ sâu, xoáy\n• Giảm lỗi không cần thiết",
    weight: 0.1,
  },
  {
    id: 3,
    name: "Serve / Return (Giao – Trả)",
    explain:
      "• Độ chính xác & đa dạng\n• Tạo lợi thế đầu pha bóng\n• Thay đổi tốc độ & xoáy",
    weight: 0.15,
  },
  {
    id: 4,
    name: "Dink (Đánh nhẹ)",
    explain:
      "• Kiểm soát bóng ở NVZ\n• Kiên nhẫn trong pha bóng chậm\n• Tạo cơ hội tấn công",
    weight: 0.2,
  },
  {
    id: 5,
    name: "3rd Shot (Cú thứ 3)",
    explain:
      "• Độ chính xác, xoáy, độ sâu\n• Tạo thế tấn công\n• Đẩy đối thủ khỏi vị trí thuận",
    weight: 0.15,
  },
  {
    id: 6,
    name: "Volley (Vô‑lê)",
    explain:
      "• Vô‑lê chính xác ổn định\n• Điều khiển hướng ép đối thủ\n• Phản xạ nhanh khu vực NVZ",
    weight: 0.15,
  },
  {
    id: 7,
    name: "Strategy (Chiến thuật)",
    explain:
      "• Di chuyển & phối hợp với đồng đội\n• Khai thác điểm yếu đối thủ\n• Ra quyết định hợp lý",
    weight: 0.1,
  },
  {
    id: 8,
    name: "Tần suất chơi",
    explain:
      "Hàng ngày 5 | Hàng tuần 4 | Hàng tháng 3 | Hàng năm 2 | Vài năm 1",
    weight: 0.0,
  },
  {
    id: 9,
    name: "Đấu giải",
    explain: "Đã từng tham gia giải đấu chưa? (Có 1 | Chưa 0)",
    weight: 0.0,
  },
  {
    id: 10,
    name: "Điểm hệ thống khác",
    explain: "UTR‑P / DUPR / VNPickleball … (quy đổi thang 10)",
    weight: 0.0,
  },
];

/** Helper tạo mảng 0‑10 */
const SCORE_OPTIONS = Array.from({ length: 11 }).map((_, i) => i);
const FREQ_OPTIONS = [0, 1, 2, 3, 4, 5];
const YES_NO_OPTIONS = [0, 1];

export default function LevelPointPage() {
  // two‑dimensional state: [{ single: n, double: n }]
  const [values, setValues] = useState(
    SKILLS.map(() => ({ single: 0, double: 0 }))
  );

  /**
   * Tính điểm weighted
   *   Level  ≈  (Σ value × weight) / 1.9  (empirical)
   * Có thể điều chỉnh MAP_FACTOR theo yêu cầu backend sau này.
   */
  const MAP_FACTOR = 1.9;

  const { singleScore, doubleScore, singleLevel, doubleLevel } = useMemo(() => {
    const sumSingle = values.reduce(
      (acc, v, idx) => acc + v.single * SKILLS[idx].weight,
      0
    );
    const sumDouble = values.reduce(
      (acc, v, idx) => acc + v.double * SKILLS[idx].weight,
      0
    );
    return {
      singleScore: sumSingle.toFixed(2),
      doubleScore: sumDouble.toFixed(2),
      singleLevel: (sumSingle / MAP_FACTOR).toFixed(1),
      doubleLevel: (sumDouble / MAP_FACTOR).toFixed(1),
    };
  }, [values]);

  /** Cập nhật 1 ô select */
  const handleSelect = (rowIdx, field) => (e) => {
    setValues((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [field]: Number(e.target.value) };
      return next;
    });
  };

  /** Giả lập gọi API */
  const handleSubmit = () => {
    const payload = values.map((v, i) => ({
      skillId: SKILLS[i].id,
      single: v.single,
      double: v.double,
    }));
    // eslint-disable-next-line no-console
    console.table(payload);
    alert("Đã gửi dữ liệu (console) – nối API thật tại handleSubmit()");
  };

  /* ---------- Responsive ---------- */
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Box className="min-h-screen bg-gray-50">
      {/* HEADER – bạn có thể tùy chỉnh thêm */}

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          Bảng chấm điểm trình môn Pickleball
        </Typography>

        {/* BODY – hiển thị bảng trên desktop & card list trên mobile */}

        {isMobile ? (
          <Stack spacing={2}>
            {SKILLS.map((s, idx) => (
              <Card key={s.id} variant="outlined">
                <CardHeader title={s.name} sx={{ pb: 0 }} />
                <CardContent>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-line" }}
                    gutterBottom
                  >
                    {s.explain}
                  </Typography>
                  <Stack direction="row" spacing={2}>
                    <FormControl fullWidth size="small">
                      <Select
                        value={values[idx].single}
                        onChange={handleSelect(idx, "single")}
                      >
                        {(s.id === 8
                          ? FREQ_OPTIONS
                          : s.id === 9
                          ? YES_NO_OPTIONS
                          : SCORE_OPTIONS
                        ).map((n) => (
                          <MenuItem key={n} value={n}>
                            {n}
                          </MenuItem>
                        ))}
                      </Select>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        mt={0.5}
                      >
                        Điểm đơn
                      </Typography>
                    </FormControl>
                    <FormControl fullWidth size="small">
                      <Select
                        value={values[idx].double}
                        onChange={handleSelect(idx, "double")}
                      >
                        {(s.id === 8
                          ? FREQ_OPTIONS
                          : s.id === 9
                          ? YES_NO_OPTIONS
                          : SCORE_OPTIONS
                        ).map((n) => (
                          <MenuItem key={n} value={n}>
                            {n}
                          </MenuItem>
                        ))}
                      </Select>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        mt={0.5}
                      >
                        Điểm đôi
                      </Typography>
                    </FormControl>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Kỹ năng</TableCell>
                  <TableCell>Tiêu chí đánh giá</TableCell>
                  <TableCell align="center">Điểm đơn</TableCell>
                  <TableCell align="center">Điểm đôi</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {SKILLS.map((s, idx) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{s.name}</TableCell>
                    <TableCell sx={{ whiteSpace: "pre-line" }}>
                      {s.explain}
                    </TableCell>
                    <TableCell align="center">
                      <FormControl fullWidth size="small">
                        <Select
                          value={values[idx].single}
                          onChange={handleSelect(idx, "single")}
                        >
                          {(s.id === 8
                            ? FREQ_OPTIONS
                            : s.id === 9
                            ? YES_NO_OPTIONS
                            : SCORE_OPTIONS
                          ).map((n) => (
                            <MenuItem key={n} value={n}>
                              {n}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell align="center">
                      <FormControl fullWidth size="small">
                        <Select
                          value={values[idx].double}
                          onChange={handleSelect(idx, "double")}
                        >
                          {(s.id === 8
                            ? FREQ_OPTIONS
                            : s.id === 9
                            ? YES_NO_OPTIONS
                            : SCORE_OPTIONS
                          ).map((n) => (
                            <MenuItem key={n} value={n}>
                              {n}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* FOOTER – hiển thị điểm & nút gửi */}
        <Box mt={4}>
          <Card
            elevation={3}
            sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 }, borderRadius: 3 }}
          >
            <CardContent>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={3}
                justifyContent={{ xs: "center", sm: "space-between" }}
                alignItems={{ xs: "stretch", sm: "center" }}
              >
                <Box textAlign={{ xs: "center", sm: "left" }}>
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth={true}
                    onClick={handleSubmit}
                    sx={{ minWidth: { sm: 160 } }}
                  >
                    Cập nhật
                  </Button>
                </Box>

                <Stack
                  direction="row"
                  spacing={1}
                  justifyContent={{ xs: "center", sm: "flex-end" }}
                  flexWrap="wrap"
                  rowGap={1} 
                >
                  <Chip
                    label={`Trình đơn: ${singleLevel}`}
                    color="primary"
                    sx={{
                      fontSize: "1rem",
                      px: 2,
                      py: 1,
                      mb: { xs: 1, sm: 0 },
                    }}
                  />
                  <Chip
                    label={`Trình đôi: ${doubleLevel}`}
                    color="success"
                    sx={{ fontSize: "1rem", px: 2, py: 1 }}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          mt={4}
        >
          * Công thức quy đổi trình có thể cần đồng bộ với backend. Tuỳ chỉnh
          lại ở hằng số <code>MAP_FACTOR</code>.
        </Typography>
      </Container>
    </Box>
  );
}
