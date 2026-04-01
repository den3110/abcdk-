const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

text = text.replace(
  /\n\s*<\/Container>\n\s*<\/>/,
  "\n      </Container>\n    </PageShell>\n    </>"
);

text = text.replace(
  /<Typography variant="h6" color="text.disabled">\s*Không tìm thấy giải đấu nào phù hợp\.\s*<\/Typography>/,
  [
    '<Typography variant="h6" color="text.disabled">',
    '                    Không tìm thấy giải đấu nào phù hợp.',
    '                  </Typography>',
    '                  <Button',
    '                    variant="outlined"',
    '                    color="primary"',
    '                    sx={{ borderRadius: 999, px: 3 }}',
    '                    onClick={() => {',
    '                      setKeyword("");',
    '                      setDateRange([null, null]);',
    '                    }}',
    '                  >',
    '                    Xóa bộ lọc',
    '                  </Button>',
  ].join("\n")
);

fs.writeFileSync(path, text, "utf8");
console.log("Inserted PageShell close and empty state button");
