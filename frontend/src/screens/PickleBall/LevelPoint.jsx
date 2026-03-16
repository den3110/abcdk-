/* eslint-disable react/prop-types */
import React, { useEffect, useRef, useState } from "react";
import {
  Container,
  Box,
  Stack,
  Card,
  CardContent,
  CardHeader,
  Typography,
  TextField,
  Button,
  Chip,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  useCreateAssessmentMutation,
  useGetLatestAssessmentQuery,
} from "../../slices/assessmentsApiSlice";
import { useLanguage } from "../../context/LanguageContext";
import SEOHead from "../../components/SEOHead";

/* ===== DUPR helpers (min = 1.6) ===== */
const DUPR_MIN = 1.6;
const DUPR_MAX = 8.0;
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
const round3 = (n) => Number((Number(n) || 0).toFixed(3));
const normalizeDupr = (n) => round3(clamp(n, DUPR_MIN, DUPR_MAX));
const duprFromRaw = (raw0to10) =>
  round3(DUPR_MIN + clamp(raw0to10, 0, 10) * ((DUPR_MAX - DUPR_MIN) / 10));

/* Rubric (bắt đầu từ 1.6, không còn 2.0) */
const nearestRubricLevel = (val, rubric) => {
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  let best = rubric[0].level,
    d = Math.abs(n - best);
  for (const r of rubric) {
    const nd = Math.abs(n - r.level);
    if (nd < d) {
      d = nd;
      best = r.level;
    }
  }
  return best;
};

// chỉ cho số + 1 dấu chấm, tự chuyển , -> .
const sanitizeDecimalInput = (s) => {
  if (typeof s !== "string") s = String(s ?? "");
  let v = s.replace(",", ".").replace(/[^\d.]/g, "");
  v = v.replace(/(\..*)\./g, "$1");
  return v;
};

/* ======= HOISTED helpers/components ======= */
const isValidDupr = (v) =>
  v != null && !Number.isNaN(v) && v >= DUPR_MIN && v <= DUPR_MAX;

// Viền trái cho rubric
const leftStripe = (colors = []) => {
  if (colors.length === 0)
    return { borderLeft: "2px solid", borderLeftColor: "divider" };
  if (colors.length === 1)
    return { borderLeft: "6px solid", borderLeftColor: colors[0] };
  const g = `linear-gradient(${colors[0]} 0 0),linear-gradient(${colors[1]} 0 0)`;
  return {
    borderLeft: "6px solid transparent",
    background: g,
    backgroundClip: "padding-box, padding-box",
    backgroundOrigin: "border-box, border-box",
    backgroundRepeat: "no-repeat",
    backgroundSize: "3px 100%, 3px 100%",
    backgroundPosition: "left top, 3px top",
  };
};

// InputCard tách riêng + memo để không bị remount → giữ focus
const InputCard = React.memo(function InputCard({
  label,
  value,
  setValue,
  color,
  didPrefillRef,
  initializing,
}) {
  const { t } = useLanguage();
  const theme = useTheme();
  const minLabel = DUPR_MIN.toFixed(3);
  const maxLabel = DUPR_MAX.toFixed(3);
  return (
    <Box
      sx={{
        flex: 1,
        border: "2px solid",
        borderRadius: 2,
        borderColor: theme.palette[color].main,
        p: 2,
        backgroundColor: alpha(theme.palette[color].main, 0.02),
      }}
    >
      <TextField
        type="text"
        inputMode="decimal"
        fullWidth
        value={value}
        onChange={(e) => {
          if (!didPrefillRef.current) didPrefillRef.current = true;
          setValue(sanitizeDecimalInput(e.target.value));
        }}
        onBlur={() => {
          if (value === "") return;
          const n = parseFloat(value);
          if (Number.isNaN(n)) return;
          setValue(String(normalizeDupr(n)));
        }}
        autoComplete="off"
        label={label}
        placeholder={initializing ? "" : t("levelPoint.placeholderExample")}
        error={value !== "" && !isValidDupr(parseFloat(value))}
        helperText={
          value !== "" && !isValidDupr(parseFloat(value))
            ? t("levelPoint.inputHint", { min: minLabel, max: maxLabel })
            : t("levelPoint.validRange", { min: minLabel, max: maxLabel })
        }
      />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mt: 1, display: "block" }}
      >
        {color === "primary"
          ? t("levelPoint.singleBorderHint")
          : t("levelPoint.doubleBorderHint")}
      </Typography>
    </Box>
  );
});

/* ======= Component chính ======= */
export default function LevelPointPage({ userId: userIdProp }) {
  const { t } = useLanguage();
  const theme = useTheme();
  const authedId = useSelector((s) => s?.auth?.userInfo?._id);
  const userId = userIdProp || authedId;

  // Giữ string để nhập mượt, không tự blur
  const [singleInput, setSingleInput] = useState("");
  const [doubleInput, setDoubleInput] = useState("");

  // Chặn auto-fill ghi đè khi user đã gõ
  const didPrefillRef = useRef(false);

  const [createAssessment, { isLoading: saving }] =
    useCreateAssessmentMutation();
  const {
    data: latest,
    isLoading: loadingLatest,
    isFetching: fetchingLatest,
    error: latestError,
  } = useGetLatestAssessmentQuery(userId, { skip: !userId });

  const initializing = loadingLatest || fetchingLatest;
  const rubric = t("levelPoint.rubric", undefined, []);

  // ✅ Prefill CHỈ 1 LẦN, CHỈ KHI CHƯA GÕ (input rỗng)
  useEffect(() => {
    if (!latest || didPrefillRef.current) return;
    const bothEmpty = singleInput === "" && doubleInput === "";
    if (!bothEmpty) return; // user đã gõ -> KHÔNG ghi đè

    if (
      typeof latest?.singleLevel === "number" &&
      typeof latest?.doubleLevel === "number"
    ) {
      setSingleInput(String(normalizeDupr(latest.singleLevel)));
      setDoubleInput(String(normalizeDupr(latest.doubleLevel)));
      didPrefillRef.current = true;
      return;
    }
    if (
      typeof latest?.singleScore === "number" &&
      typeof latest?.doubleScore === "number"
    ) {
      setSingleInput(String(duprFromRaw(latest.singleScore)));
      setDoubleInput(String(duprFromRaw(latest.doubleScore)));
      didPrefillRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]); // cố ý chỉ phụ thuộc latest

  // Parse khi cần
  const parseOrNull = (s) => (s === "" ? null : normalizeDupr(parseFloat(s)));
  const singleVal = parseOrNull(singleInput);
  const doubleVal = parseOrNull(doubleInput);

  const singleValid = isValidDupr(singleVal);
  const doubleValid = isValidDupr(doubleVal);

  const nearestSingle = singleValid ? nearestRubricLevel(singleVal, rubric) : null;
  const nearestDouble = doubleValid ? nearestRubricLevel(doubleVal, rubric) : null;

  const latestChip = (() => {
    if (!userId) return null;
    if (initializing)
      return <Chip size="small" label={t("levelPoint.loadingLatest")} />;
    if (latestError)
      return (
        <Chip
          size="small"
          color="error"
          variant="outlined"
          label={t("levelPoint.loadLatestError")}
        />
      );
    if (latest?._id) {
      const when = latest?.scoredAt
        ? " • " + new Date(latest.scoredAt).toLocaleDateString()
        : "";
      return (
        <Chip
          size="small"
          color="info"
          variant="outlined"
          label={t("levelPoint.latestPrefill", { when })}
        />
      );
    }
    return null;
  })();

  const handleSubmit = async () => {
    if (!userId) {
      toast.error(t("levelPoint.missingUserId"));
      return;
    }
    if (!singleValid || !doubleValid) {
      toast.error(
        t("levelPoint.invalidRange", {
          min: DUPR_MIN.toFixed(3),
          max: DUPR_MAX.toFixed(3),
        })
      );
      return;
    }
    try {
      await createAssessment({
        userId,
        singleLevel: singleVal,
        doubleLevel: doubleVal,
        note: t("levelPoint.saveNote"),
      }).unwrap();
      toast.success(t("levelPoint.saveSuccess"));
    } catch (err) {
      const msg =
        err?.data?.message ||
        err?.error ||
        t("levelPoint.saveUnknownError");
      toast.error(msg);
    }
  };

  return (
    <Box className="min-h-screen bg-gray-50">
      <SEOHead title={t("levelPoint.seoTitle")} noIndex={true} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={1}
          mb={2}
        >
          <Typography variant="h4">
            {t("levelPoint.pageTitle")}
          </Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            {latestChip}
          </Stack>
        </Stack>

        {/* Inputs */}
        <Card elevation={3} sx={{ borderRadius: 3, mb: 3 }}>
          <CardContent>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <InputCard
                label={t("levelPoint.singleLabel")}
                value={singleInput}
                setValue={setSingleInput}
                color="primary"
                didPrefillRef={didPrefillRef}
                initializing={initializing}
              />
              <InputCard
                label={t("levelPoint.doubleLabel")}
                value={doubleInput}
                setValue={setDoubleInput}
                color="success"
                didPrefillRef={didPrefillRef}
                initializing={initializing}
              />
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ xs: "stretch", sm: "center" }}
              justifyContent="space-between"
              mt={3}
            >
              <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={1}>
                {singleValid && (
                  <Chip
                    label={t("levelPoint.singleChip", { value: singleVal })}
                    color="primary"
                    sx={{ fontSize: "1rem", px: 2, py: 1 }}
                  />
                )}
                {doubleValid && (
                  <Chip
                    label={t("levelPoint.doubleChip", { value: doubleVal })}
                    color="success"
                    sx={{ fontSize: "1rem", px: 2, py: 1 }}
                  />
                )}
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  size="large"
                  onClick={handleSubmit}
                  disabled={saving || !userId}
                >
                  {saving ? t("levelPoint.saving") : t("levelPoint.save")}
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setSingleInput("");
                    setDoubleInput("");
                  }}
                >
                  {t("levelPoint.reset")}
                </Button>
              </Stack>
            </Stack>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 2 }}
            >
              {t("levelPoint.colorHint", {
                min: DUPR_MIN.toFixed(3),
                max: DUPR_MAX.toFixed(3),
              })}
            </Typography>
          </CardContent>
        </Card>

        {/* Rubric – viền trái theo giá trị đã nhập */}
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardHeader title={`📝 ${t("levelPoint.rubricTitle")}`} />
          <CardContent>
            <Stack spacing={2}>
              {rubric.map((r) => {
                const colors = [];
                if (nearestSingle === r.level)
                  colors.push(theme.palette.primary.main);
                if (nearestDouble === r.level)
                  colors.push(theme.palette.success.main);

                return (
                  <Box
                    key={r.level}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      backgroundColor: colors.length
                        ? alpha(colors[0], 0.06)
                        : "transparent",
                      ...leftStripe(colors),
                    }}
                  >
                    <Typography variant="h6" sx={{ mb: 0.5 }}>
                      {t("levelPoint.levelLabel", {
                        level: r.level,
                        label: r.label,
                      })}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                      • {r.bullets.join("\n• ")}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
