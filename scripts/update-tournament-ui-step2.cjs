const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

function replaceOnce(pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) {
    throw new Error(`Pattern not found for ${label}`);
  }
  text = next;
}

replaceOnce(
  /\n\s*\{\/\* HEADER STATS \*\/\}\n\s*<Stack/,
  "\n        <HeroPanel sx={{ mb: 4 }}>\n          {/* HEADER STATS */}\n          <Stack",
  "HeroPanel open"
);

replaceOnce(
  /\n\s*<\/Stack>\n\s*\{\/\* CONTROLS \*\/\}/,
  "\n          </Stack>\n        </HeroPanel>\n\n        {/* CONTROLS */}",
  "HeroPanel close"
);

replaceOnce(
  /\n\s*\{\/\* CONTROLS \*\/\}\n\s*<Stack/,
  "\n        <FilterPanel sx={{ mb: 4 }}>\n          {/* CONTROLS */}\n          <Stack",
  "FilterPanel open"
);

replaceOnce(
  /\n\s*<\/Stack>\n\s*\{\/\* LIST CONTENT \*\/\}/,
  "\n          </Stack>\n        </FilterPanel>\n\n        {/* LIST CONTENT */}",
  "FilterPanel close"
);

replaceOnce(
  /<Typography variant="h4" fontWeight=\{600\} sx=\{\{ mb: 1 \}\}>\s*Giải Đấu\s*<\/Typography>/,
  [
    '<Typography variant="h3" fontWeight={800} sx={{ mb: 1, letterSpacing: "-0.02em" }}>',
    '              Giải Đấu Pickleball',
    '            </Typography>',
  ].join("\n"),
  "Header title"
);

replaceOnce(
  /<Typography variant="body1" color="text.secondary">\s*Quản lý và tham gia các giải đấu thể thao chuyên nghiệp\.\s*<\/Typography>/,
  [
    '<Typography variant="body1" color="text.secondary">',
    '              Tập hợp giải đấu nổi bật, lịch thi đấu, kết quả và đăng ký tham gia nhanh chóng.',
    '            </Typography>',
  ].join("\n"),
  "Header description"
);

const tabsOpen = [
  '<Tabs',
  '            value={tab}',
  '            onChange={handleChangeTab}',
  '            variant="scrollable"',
  '            sx={{',
  '              minHeight: 52,',
  '              "& .MuiTab-root": {',
  '                borderRadius: 999,',
  '                mr: 1,',
  '                px: 2.5,',
  '                fontWeight: 700,',
  '                textTransform: "none",',
  '                minHeight: 44,',
  '                border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,',
  '                bgcolor: alpha(theme.palette.background.paper, 0.6),',
  '                transition: "all 0.2s",',
  '                "&.Mui-selected": {',
  '                  bgcolor: "primary.main",',
  '                  color: "primary.contrastText",',
  '                  boxShadow: "0 10px 24px rgba(0,0,0,0.2)",',
  '                  borderColor: "transparent",',
  '                },',
  '              },',
  '              "& .MuiTabs-indicator": { display: "none" },',
  '            }}',
  '          >',
].join("\n");

replaceOnce(
  /<Tabs\n\s*value=\{tab\}[\s\S]*?>/,
  tabsOpen,
  "Tabs open"
);

const textFieldOpen = [
  '<TextField',
  '              placeholder="Tìm tên giải đấu..."',
  '              size="small"',
  '              value={keyword}',
  '              onChange={(e) => setKeyword(e.target.value)}',
  '              sx={{',
  '                width: { xs: "100%", sm: 260 },',
  '                "& .MuiOutlinedInput-root": {',
  '                  borderRadius: 3,',
  '                  bgcolor: "background.paper",',
  '                  boxShadow: "0 8px 20px rgba(0,0,0,0.08)",',
  '                  "&.Mui-focused": {',
  '                    boxShadow: `0 10px 24px ${alpha(theme.palette.primary.main, 0.25)}`,',
  '                  },',
  '                },',
  '              }}',
  '              InputProps=',
].join("\n");

replaceOnce(
  /<TextField\n\s*placeholder="Tìm tên giải đấu\.\.\."[\s\S]*?InputProps=/,
  textFieldOpen,
  "TextField"
);

replaceOnce(
  /placeholder:\s*"Lọc theo ngày",\n\s*InputProps:\s*\{\n\s*sx:\s*\{\s*borderRadius:\s*3,\s*bgcolor:\s*"background.paper"\s*\},\n\s*\},/,
  [
    'placeholder: "Lọc theo ngày",',
    '                    InputProps: {',
    '                      sx: {',
    '                        borderRadius: 3,',
    '                        bgcolor: "background.paper",',
    '                        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",',
    '                      },',
    '                    },',
  ].join("\n"),
  "DateRangePicker"
);

fs.writeFileSync(path, text, "utf8");
console.log("Updated header and controls");
