// src/pages/LevelPointPage.jsx
import React, { useState, useMemo, useEffect } from "react";
import {
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
  Typography,
  useTheme,
  useMediaQuery,
  MenuItem,
} from "@mui/material";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useCreateAssessmentMutation,
  useGetLatestAssessmentQuery,
} from "../../slices/assessmentsApiSlice";

/**
 * Bảng cấu hình kỹ năng & trọng số – tổng weight = 1.0
 * (đồng bộ công thức backend)
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
    name: "3rd Shot (Cú thứ 3)",
    explain:
      "• Độ chính xác, xoáy, độ sâu\n• Tạo thế tấn công\n• Đẩy đối thủ khỏi vị trí thuận",
    weight: 0.15,
  },
  {
    id: 6,
    name: "Volley (Vô-lê)",
    explain:
      "• Vô-lê chính xác ổn định\n• Điều khiển hướng ép đối thủ\n• Phản xạ nhanh khu vực NVZ",
    weight: 0.15,
  },
  {
    id: 7,
    name: "Strategy (Chiến thuật)",
    explain:
      "• Di chuyển & phối hợp với đồng đội\n• Khai thác điểm yếu đối thủ\n• Ra quyết định hợp lý",
    weight: 0.1,
  },
  // weight = 0 không ảnh hưởng Level, vẫn lưu để tham khảo/meta
  {
    id: 8,
    name: "Tần suất chơi",
    explain:
      "Hàng ngày 5 | Hàng tuần 4 | Hàng tháng 3 | Hàng năm 2 | Vài năm 1",
    weight: 0.0,
  },
  {
    id: 9,
    name: "Đấu giải",
    explain: "Đã từng tham gia giải đấu chưa? (Có 1 | Chưa 0)",
    weight: 0.0,
  },
  {
    id: 10,
    name: "Điểm hệ thống khác",
    explain: "UTR-P / DUPR / VNPickleball … (quy đổi thang 10)",
    weight: 0.0,
  },
];

const SCORE_OPTIONS = Array.from({ length: 11 }).map((_, i) => i); // 0..10
const FREQ_OPTIONS = [0, 1, 2, 3, 4, 5]; // theo mô tả
const YES_NO_OPTIONS = [0, 1];

// Hệ số quy đổi hiển thị Level ~ (Σ value*weight)/MAP_FACTOR
const MAP_FACTOR = 1.9;

export default function LevelPointPage({ userId: userIdProp }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const authedId = useSelector((s) => s?.auth?.userInfo?._id);
  const userId = userIdProp || authedId;

  const [createAssessment, { isLoading: saving }] =
    useCreateAssessmentMutation();

  // map skillId -> index để fill nhanh
  const skillIndexMap = useMemo(() => {
    const m = new Map();
    SKILLS.forEach((s, idx) => m.set(s.id, idx));
    return m;
  }, []);

  // điểm [{ single, double }] theo thứ tự SKILLS
  const [values, setValues] = useState(
    SKILLS.map(() => ({ single: 0, double: 0 }))
  );

  // lấy lần chấm gần nhất (nếu có)
  const {
    data: latest,
    isLoading: loadingLatest,
    isFetching: fetchingLatest,
    error: latestError,
  } = useGetLatestAssessmentQuery(userId, { skip: !userId });

  // tự map điểm khi có latest
  useEffect(() => {
    if (!latest?.items?.length) return;
    setValues((prev) => {
      const next = [...prev];
      for (const it of latest.items) {
        const idx = skillIndexMap.get(it.skillId);
        if (idx !== undefined) {
          next[idx] = {
            single: Number(it.single ?? 0),
            double: Number(it.double ?? 0),
          };
        }
      }
      return next;
    });
  }, [latest, skillIndexMap]);

  const weightsSum = useMemo(
    () => SKILLS.reduce((acc, s) => acc + (s.weight || 0), 0),
    []
  );

  const { sumSingle, sumDouble, singleLevel, doubleLevel } = useMemo(() => {
    const single = values.reduce(
      (acc, v, idx) => acc + v.single * (SKILLS[idx].weight || 0),
      0
    );
    const dbl = values.reduce(
      (acc, v, idx) => acc + v.double * (SKILLS[idx].weight || 0),
      0
    );
    return {
      sumSingle: single,
      sumDouble: dbl,
      singleLevel: (single / MAP_FACTOR).toFixed(1),
      doubleLevel: (dbl / MAP_FACTOR).toFixed(1),
    };
  }, [values]);

  const handleSelect = (rowIdx, field) => (e) => {
    setValues((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [field]: Number(e.target.value) };
      return next;
    });
  };

  const validateBeforeSubmit = () => {
    if (!userId) {
      toast.error("Thiếu userId. Vui lòng đăng nhập hoặc cung cấp userId.");
      return false;
    }
    if (Math.abs(weightsSum - 1) > 1e-6) {
      toast.error(
        `Tổng trọng số = ${weightsSum.toFixed(
          2
        )} ≠ 1.0. Hãy điều chỉnh cấu hình SKILLS.`
      );
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateBeforeSubmit()) return;

    const items = values.map((v, i) => ({
      skillId: SKILLS[i].id,
      single: v.single,
      double: v.double,
      // weight có thể gửi kèm để backend kiểm
      weight: SKILLS[i].weight,
    }));

    try {
      await createAssessment({ userId, items, note: "" }).unwrap();
      toast.success("Đã lưu đánh giá & cập nhật ranking!");
    } catch (err) {
      const msg =
        err?.data?.message ||
        err?.error ||
        "Lỗi không xác định khi lưu đánh giá.";
      toast.error(msg);
    }
  };

  const renderSelectMenu = (skillId, value, onChange) => {
    const source =
      skillId === 8
        ? FREQ_OPTIONS
        : skillId === 9
        ? YES_NO_OPTIONS
        : SCORE_OPTIONS;
    return (
      <Select value={value} onChange={onChange} size="small">
        {source.map((n) => (
          <MenuItem key={n} value={n}>
            {n}
          </MenuItem>
        ))}
      </Select>
    );
  };

  const handleReset = () => {
    setValues(SKILLS.map(() => ({ single: 0, double: 0 })));
  };

  const handleRefillFromLatest = () => {
    if (!latest?.items?.length) return;
    const next = SKILLS.map(() => ({ single: 0, double: 0 }));
    for (const it of latest.items) {
      const idx = skillIndexMap.get(it.skillId);
      if (idx !== undefined) {
        next[idx] = {
          single: Number(it.single ?? 0),
          double: Number(it.double ?? 0),
        };
      }
    }
    setValues(next);
  };

  return (
    <Box className="min-h-screen bg-gray-50">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
          mb={2}
        >
          <Typography variant="h4">
            Bảng chấm điểm trình môn Pickleball
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            useFlexGap
            gap={{ xs: 1, sm: 1.5 }}
            alignItems={{ xs: "stretch", sm: "center" }}
            sx={{ flexWrap: "wrap" }}
          >
            <Chip
              label={`Tổng trọng số: ${weightsSum.toFixed(2)}`}
              color={Math.abs(weightsSum - 1) < 1e-6 ? "success" : "warning"}
              variant="outlined"
              sx={{ width: { xs: "100%", sm: "auto" } }}
            />

            {!!userId &&
              (loadingLatest || fetchingLatest ? (
                <Chip
                  size="small"
                  label="Đang tải lần chấm gần nhất…"
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                />
              ) : latestError ? (
                <Chip
                  size="small"
                  color="error"
                  variant="outlined"
                  label="Không tải được lần chấm gần nhất"
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                />
              ) : latest?.items?.length ? (
                <Chip
                  size="small"
                  color="info"
                  variant="outlined"
                  label={`Đã tự điền từ lần gần nhất${
                    latest?.scoredAt
                      ? " • " + new Date(latest.scoredAt).toLocaleDateString()
                      : ""
                  }`}
                  sx={{ width: { xs: "100%", sm: "auto" } }}
                />
              ) : null)}
          </Stack>
        </Stack>

        {/* BODY – Bảng (desktop) hoặc Card list (mobile) */}
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
                    <FormControl fullWidth>
                      {renderSelectMenu(
                        s.id,
                        values[idx].single,
                        handleSelect(idx, "single")
                      )}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        mt={0.5}
                      >
                        Điểm đơn
                      </Typography>
                    </FormControl>

                    <FormControl fullWidth>
                      {renderSelectMenu(
                        s.id,
                        values[idx].double,
                        handleSelect(idx, "double")
                      )}
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
            <Table size="small" sx={{ minWidth: 820 }}>
              <TableHead>
                <TableRow>
                  <TableCell style={{ fontWeight: 700 }}>Kỹ năng</TableCell>
                  <TableCell style={{ fontWeight: 700 }}>
                    Tiêu chí đánh giá
                  </TableCell>
                  <TableCell align="center" style={{ fontWeight: 700 }}>
                    Điểm đơn
                  </TableCell>
                  <TableCell align="center" style={{ fontWeight: 700 }}>
                    Điểm đôi
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {SKILLS.map((s, idx) => (
                  <TableRow key={s.id} hover>
                    <TableCell>{s.name}</TableCell>
                    <TableCell sx={{ whiteSpace: "pre-line" }}>
                      {s.explain}
                    </TableCell>
                    <TableCell align="center" sx={{ width: 160 }}>
                      <FormControl fullWidth>
                        {renderSelectMenu(
                          s.id,
                          values[idx].single,
                          handleSelect(idx, "single")
                        )}
                      </FormControl>
                    </TableCell>
                    <TableCell align="center" sx={{ width: 160 }}>
                      <FormControl fullWidth>
                        {renderSelectMenu(
                          s.id,
                          values[idx].double,
                          handleSelect(idx, "double")
                        )}
                      </FormControl>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* FOOTER – điểm & hành động */}
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
                <Stack spacing={1} sx={{ minWidth: 240 }}>
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    onClick={handleSubmit}
                    disabled={saving || !userId}
                    sx={{ minWidth: { sm: 160 } }}
                  >
                    {saving ? "Đang cập nhật…" : "Cập nhật"}
                  </Button>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="text" onClick={handleReset}>
                      Xoá tất cả
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      onClick={handleRefillFromLatest}
                      disabled={!latest?.items?.length}
                    >
                      Lấy lại từ lần gần nhất
                    </Button>
                  </Stack>
                  {!userId && (
                    <Typography variant="caption" color="error.main">
                      * Chưa xác định người dùng – không thể lưu
                    </Typography>
                  )}
                </Stack>

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
          * Công thức quy đổi trình hiển thị ở client: Level ≈ (Σ điểm×weight) /{" "}
          <code>MAP_FACTOR</code>. Hệ thống backend sẽ tính lại & ghi nhận chính
          thức khi lưu. Các yếu tố “Tần suất chơi / Đấu giải / Điểm hệ thống
          khác” có weight = 0 (không làm thay đổi Level) nhưng vẫn được lưu để
          tổng hợp meta.
        </Typography>
      </Container>
    </Box>
  );
}
