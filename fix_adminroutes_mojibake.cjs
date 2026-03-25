const fs = require('fs');

const file = 'backend/routes/adminRoutes.js';
if (!fs.existsSync(file)) process.exit(0);
let content = fs.readFileSync(file, 'utf8');

const replacements = {
    'gÃ¡n sÃ¢n': 'gán sân',
    'bá»  gÃ¡n sÃ¢n': 'bỏ gán sân',
    'Tuá»³ chá» n': 'Tuỳ chọn',
    'yÃªu cáº§u': 'yêu cầu',
    'quyÃ» n': 'quyền',
    'á»Ÿ': 'ở',
    'báº¡n': 'bạn',
    'Giáº£i phÃ³ng': 'Giải phóng',
    'sÃ¢n': 'sân',
    'Giáº£i': 'Giải',
    'phÃ³ng': 'phóng'
};

let previousContent = content;
for (const [bad, good] of Object.entries(replacements).sort((a,b) => b[0].length - a[0].length)) {
    content = content.split(bad).join(good);
}

if (content !== previousContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed adminRoutes.js");
}
