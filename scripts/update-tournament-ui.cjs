const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
let text = fs.readFileSync(path, "utf8");

function mustReplace(pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    throw new Error(`Pattern not found for ${label}`);
  }
  text = next;
}

const glassCard = [
  'const GlassCard = styled(Card)(({ theme }) => ({',
  '  position: "relative",',
  '  background:',
  '    theme.palette.mode === "dark"',
  '      ? alpha(theme.palette.background.default, 0.7)',
  '      : "#ffffff",',
  '  border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,',
  '  borderRadius: 20,',
  '  overflow: "hidden",',
  '  display: "flex",',
  '  flexDirection: "column",',
  '  height: "100%",',
  '  boxShadow:',
  '    theme.palette.mode === "dark"',
  '      ? "0 18px 45px rgba(0, 0, 0, 0.45)"',
  '      : "0 18px 45px rgba(15, 23, 42, 0.15)",',
  '  transition: "transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease",',
  '  "&::after": {',
  '    content: "\"\"",',
  '    position: "absolute",',
  '    inset: 0,',
  '    background:',
  '      "linear-gradient(135deg, rgba(0, 163, 255, 0.08) 0%, transparent 45%, rgba(255, 178, 0, 0.08) 100%)",',
  '    opacity: 0,',
  '    transition: "opacity 0.3s ease",',
  '    pointerEvents: "none",',
  '  },',
  '  "&:hover": {',
  '    transform: "translateY(-6px)",',
  '    boxShadow:',
  '      theme.palette.mode === "dark"',
  '        ? "0 26px 60px rgba(0, 0, 0, 0.55)"',
  '        : "0 26px 60px rgba(15, 23, 42, 0.2)",',
  '    borderColor: alpha(theme.palette.primary.main, 0.5),',
  '    "& .zoom-image": { transform: "scale(1.08)" },',
  '    "&::after": { opacity: 1 },',
  '  },',
  '}));',
].join("\n");

const statusBadge = [
  'const StatusBadge = styled(Box)(({ theme, status }) => {',
  '  const bgColors = {',
  '    upcoming: alpha(theme.palette.info.main, 0.95),',
  '    ongoing: alpha(theme.palette.success.main, 0.95),',
  '    finished: alpha(theme.palette.grey[700], 0.95),',
  '  };',
  '',
  '  const bg = bgColors[status] || theme.palette.primary.main;',
  '',
  '  return {',
  '    padding: "4px 10px",',
  '    borderRadius: 999,',
  '    backgroundColor: bg,',
  '    color: "#fff",',
  '    fontWeight: 800,',
  '    fontSize: "0.7rem",',
  '    textTransform: "uppercase",',
  '    letterSpacing: "0.05em",',
  '    display: "inline-flex",',
  '    alignItems: "center",',
  '    gap: 6,',
  '    border: `1px solid ${alpha("#fff", 0.25)}`,',
  '    boxShadow: "0 6px 14px rgba(0,0,0,0.2)",',
  '    "& .dot": {',
  '      width: 6,',
  '      height: 6,',
  '      borderRadius: "50%",',
  '      backgroundColor: "#fff",',
  '      animation: status === "ongoing" ? "pulse 1.5s infinite" : "none",',
  '    },',
  '    "@keyframes pulse": {',
  '      "0%": { opacity: 1, transform: "scale(1)" },',
  '      "50%": { opacity: 0.5, transform: "scale(1.2)" },',
  '      "100%": { opacity: 1, transform: "scale(1)" },',
  '    },',
  '  };',
  '});',
].join("\n");

const statBoxAndPanels = [
  'const StatBox = styled(Box)(({ theme }) => ({',
  '  padding: theme.spacing(2),',
  '  borderRadius: 16,',
  '  minWidth: 140,',
  '  background:',
  '    theme.palette.mode === "dark"',
  '      ? alpha(theme.palette.background.paper, 0.7)',
  '      : alpha(theme.palette.background.paper, 0.95),',
  '  border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,',
  '  display: "flex",',
  '  flexDirection: "column",',
  '  gap: 4,',
  '  boxShadow: theme.shadows[1],',
  '  transition: "transform 0.2s ease, box-shadow 0.2s ease",',
  '  "&:hover": {',
  '    transform: "translateY(-2px)",',
  '    boxShadow: theme.shadows[4],',
  '  },',
  '}));',
  '',
  'const PageShell = styled(Box)(({ theme }) => ({',
  '  position: "relative",',
  '  minHeight: "100vh",',
  '  background:',
  '    theme.palette.mode === "dark"',
  '      ? "radial-gradient(circle at 20% 20%, rgba(0, 163, 255, 0.12) 0%, transparent 45%), radial-gradient(circle at 80% 0%, rgba(255, 178, 0, 0.12) 0%, transparent 40%), linear-gradient(180deg, rgba(10,10,12,0.98) 0%, rgba(10,10,12,0.92) 40%, rgba(10,10,12,1) 100%)"',
  '      : "radial-gradient(circle at 15% 20%, rgba(0, 163, 255, 0.08) 0%, transparent 40%), radial-gradient(circle at 85% 0%, rgba(255, 178, 0, 0.08) 0%, transparent 35%), linear-gradient(180deg, #f7f7fb 0%, #f4f6fb 40%, #f7f7fb 100%)",',
  '  "&::before": {',
  '    content: "\"\"",',
  '    position: "absolute",',
  '    inset: 0,',
  '    backgroundImage:',
  '      "linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",',
  '    backgroundSize: "32px 32px",',
  '    pointerEvents: "none",',
  '    opacity: theme.palette.mode === "dark" ? 0.25 : 0.2,',
  '  },',
  '}));',
  '',
  'const HeroPanel = styled(Box)(({ theme }) => ({',
  '  position: "relative",',
  '  borderRadius: 28,',
  '  padding: theme.spacing(3),',
  '  background:',
  '    theme.palette.mode === "dark"',
  '      ? alpha(theme.palette.background.paper, 0.8)',
  '      : alpha(theme.palette.background.paper, 0.95),',
  '  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,',
  '  boxShadow: "0 18px 45px rgba(0, 0, 0, 0.18)",',
  '  backdropFilter: "blur(10px)",',
  '  overflow: "hidden",',
  '  "&::after": {',
  '    content: "\"\"",',
  '    position: "absolute",',
  '    top: -120,',
  '    right: -120,',
  '    width: 260,',
  '    height: 260,',
  '    background:',
  '      "radial-gradient(circle, rgba(255, 200, 87, 0.22) 0%, transparent 65%)",',
  '    pointerEvents: "none",',
  '  },',
  '}));',
  '',
  'const FilterPanel = styled(Box)(({ theme }) => ({',
  '  borderRadius: 20,',
  '  padding: theme.spacing(2),',
  '  background: alpha(theme.palette.background.paper, 0.9),',
  '  border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,',
  '  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",',
  '  backdropFilter: "blur(8px)",',
  '}));',
].join("\n");

mustReplace(/const GlassCard = styled\(Card\)\(\(\{ theme \}\) => \(\{[\s\S]*?\}\)\);/, glassCard, "GlassCard");
mustReplace(/const StatusBadge = styled\(Box\)\(\(\{ theme, status \}\) => \{[\s\S]*?\}\);/, statusBadge, "StatusBadge");
mustReplace(/const StatBox = styled\(Box\)\(\(\{ theme \}\) => \(\{[\s\S]*?\}\)\);\r?\n\r?\nconst STATUS_META/, `${statBoxAndPanels}\n\nconst STATUS_META`, "StatBox+Panels");

text = text.replace(
  /\n\s*<SponsorMarquee variant="glass" height=\{80\} gap=\{24\} \/>/,
  "\n      <PageShell>\n        <SponsorMarquee variant=\"glass\" height=\{80\} gap=\{24\} />"
);

text = text.replace(
  /\n\s*<Container maxWidth="xl" sx=\{\{ py: 2, minHeight: "100vh" \}\}>/,
  "\n        <Container maxWidth=\"xl\" sx=\{\{ py: 4, minHeight: \"100vh\" \}\}>"
);

text = text.replace(/\n\s*<\/Container>\n\s*<\/>/, "\n        </Container>\n      </PageShell>\n    </>");

text = text.replace(
  /\n\s*\{\/\* HEADER STATS \*\/\}\n\s*<Stack/,
  "\n        {/* HEADER STATS */}\n        <HeroPanel sx={{ mb: 4 }}>\n          <Stack"
);
text = text.replace(/\n\s*<\/Stack>\n\s*\{\/\* CONTROLS \*\/\}/, "\n          </Stack>\n        </HeroPanel>\n\n        {/* CONTROLS */}");

text = text.replace(
  /\n\s*\{\/\* CONTROLS \*\/\}\n\s*<Stack/,
  "\n        {/* CONTROLS */}\n        <FilterPanel sx={{ mb: 4 }}>\n          <Stack"
);
text = text.replace(/\n\s*<\/Stack>\n\s*\{\/\* LIST CONTENT \*\/\}/, "\n          </Stack>\n        </FilterPanel>\n\n        {/* LIST CONTENT */}");

text = text.replace(
  /sx=\{\{\n\s*minHeight: 48,[\s\S]*?\}\}\n\s*>/,
  "sx={{\n              minHeight: 52,\n              \"& .MuiTab-root\": {\n                borderRadius: 999,\n                mr: 1,\n                px: 2.5,\n                fontWeight: 700,\n                textTransform: \"none\",\n                minHeight: 44,\n                border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,\n                bgcolor: alpha(theme.palette.background.paper, 0.6),\n                transition: \"all 0.2s\",\n                \"&.Mui-selected\": {\n                  bgcolor: \"primary.main\",\n                  color: \"primary.contrastText\",\n                  boxShadow: \"0 10px 24px rgba(0,0,0,0.2)\",\n                  borderColor: \"transparent\",\n                },\n              },\n              \"& .MuiTabs-indicator\": { display: \"none\" },\n            }}\n          >"
);

text = text.replace(
  /<Tab key=\{v\} value=\{v\} label=\{STATUS_META\[v\]\.label\} \/>/,
  "<Tab\n                key={v}\n                value={v}\n                label={\n                  <Stack direction=\"row\" spacing={1} alignItems=\"center\">\n                    <span>{STATUS_META[v].label}</span>\n                    <Box\n                      component=\"span\"\n                      sx={{\n                        minWidth: 22,\n                        height: 22,\n                        px: 1,\n                        borderRadius: 999,\n                        bgcolor: alpha(theme.palette.common.white, 0.2),\n                        color: \"inherit\",\n                        fontSize: \"0.75rem\",\n                        fontWeight: 800,\n                        display: \"inline-flex\",\n                        alignItems: \"center\",\n                        justifyContent: \"center\",\n                      }}\n                    >\n                      {counts[v]}\n                    </Box>\n                  </Stack>\n                }\n              />"
);

text = text.replace(
  /sx=\{\{\n\s*width: \{ xs: "100%", sm: 240 \},\n\s*"& \.MuiOutlinedInput-root": \{\n\s*borderRadius: 3,\n\s*bgcolor: "background.paper",\n\s*\},\n\s*\}\}/,
  "sx={{\n                width: { xs: \"100%\", sm: 260 },\n                \"& .MuiOutlinedInput-root\": {\n                  borderRadius: 3,\n                  bgcolor: \"background.paper\",\n                  boxShadow: \"0 8px 20px rgba(0,0,0,0.08)\",\n                  \"&.Mui-focused\": {\n                    boxShadow: `0 10px 24px ${alpha(theme.palette.primary.main, 0.25)}`,\n                  },\n                },\n              }}"
);

text = text.replace(
  /placeholder: "Lọc theo ngày",\n\s*InputProps: \{\n\s*sx: \{ borderRadius: 3, bgcolor: "background.paper" \ },\n\s*\},/,
  "placeholder: \"Lọc theo ngày\",\n                    InputProps: {\n                      sx: {\n                        borderRadius: 3,\n                        bgcolor: \"background.paper\",\n                        boxShadow: \"0 8px 20px rgba(0,0,0,0.08)\",\n                      },\n                    },"
);

text = text.replace(
  /bgcolor: "action\.hover",/,
  "bgcolor: \"action.hover\",\n            \"&::after\": {\n              content: \"\\\"\\\"\",\n              position: \"absolute\",\n              inset: 0,\n              background:\n                \"linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 100%)\",\n              opacity: 0.5,\n              pointerEvents: \"none\",\n            },"
);

text = text.replace(
  /<Typography variant="h4" fontWeight=\{600\} sx=\{\{ mb: 1 \}\}>\n\s*Giải Đấu\n\s*<\/Typography>/,
  "<Typography variant=\"h3\" fontWeight={800} sx={{ mb: 1, letterSpacing: \"-0.02em\" }}>\n              Giải Đấu Pickleball\n            </Typography>"
);

text = text.replace(
  /<Typography variant="body1" color="text.secondary">\n\s*Quản lý và tham gia các giải đấu thể thao chuyên nghiệp\.\n\s*<\/Typography>/,
  "<Typography variant=\"body1\" color=\"text.secondary\">\n              Tập hợp giải đấu nổi bật, lịch thi đấu, kết quả và đăng ký tham gia nhanh chóng.\n            </Typography>"
);

text = text.replace(
  /<Box p=\{3\} color="error.dark" borderRadius=\{3\} textAlign="center">/,
  "<Box\n              p={3}\n              borderRadius={3}\n              textAlign=\"center\"\n              sx={{\n                color: \"error.main\",\n                bgcolor: alpha(theme.palette.error.main, 0.08),\n                border: `1px solid ${alpha(theme.palette.error.main, 0.25)}`,\n              }}\n            >"
);

text = text.replace(
  /<Typography variant="h6" color="text.disabled">\n\s*Không tìm thấy giải đấu nào phù hợp\.\n\s*<\/Typography>/,
  "<Typography variant=\"h6\" color=\"text.disabled\">\n                    Không tìm thấy giải đấu nào phù hợp.\n                  </Typography>\n                  <Button\n                    variant=\"outlined\"\n                    color=\"primary\"\n                    sx={{ borderRadius: 999, px: 3 }}\n                    onClick={() => {\n                      setKeyword(\"\");\n                      setDateRange([null, null]);\n                    }}\n                  >\n                    Xóa bộ lọc\n                  </Button>"
);

fs.writeFileSync(path, text, "utf8");
console.log("Updated", path);
