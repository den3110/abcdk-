const fs = require('fs');

const file = 'backend/server.js';
if (!fs.existsSync(file)) process.exit(0);

let content = fs.readFileSync(file, 'utf8');

const replacements = {
    'Ã°Å¸â€ Â¹': '🔹',
    'Ã¢Â Å’': '❌',
    'Ã¢Å“â€¦': '✅',
    'Ã¢Å¡Â Ã¯Â¸Â': '⚠️',
    'KHÃƒâ€ NG': 'KHÔNG',
    'dÃƒÂ¹ng': 'dùng',
    'BÃ¡Â»Â ': 'Bỏ ',
    'phÃ¡ÂºÂ§n': 'phần',
    'tÃ¡ÂºÂ£i': 'tải',
    'vÃ¡Â»Â ': 'về ',
    'ChuyÃ¡Â»Æ’n': 'Chuyển',
    'nÃ¡Â»â„¢i': 'nội',
    'bÃ¡Â»â„¢': 'bộ',
    'Ã„â€˜Ã¡Â»Â c': 'đọc',
    'tÃ¡Â»Â«': 'từ',
    'Ã„â€˜Ã„Â©a': 'đĩa',
    'tuÃ¡Â»Â³': 'tuỳ',
    'chÃ¡Â»Â n': 'chọn',
    'vÃƒÂ o': 'vào',
    '1 hÃƒÂ m': '1 hàm',
    'trÃ†Â°Ã¡Â»â€ºc': 'trước',
    'khÃƒÂ´ng': 'không',
    'tÃ¡Â»â€œn': 'tồn',
    'tÃ¡ÂºÂ¡i': 'tại',
    'hiÃ¡Â»Æ’n': 'hiển',
    'thÃ¡Â»â€¹': 'thị',
    'LÃ¡Â»â€”i': 'Lỗi',
    'khÃ¡Â»Å¸i': 'khởi',
    'tÃ¡ÂºÂ¡o': 'tạo',
    'tÃƒÂ¡ch': 'tách',
    'riÃƒÂªng': 'riêng',
    'dÃƒÂ i': 'dài',
    'rÃ¡Â»â„¢ng': 'rộng',
    'hÃ†Â¡n': 'hơn',
    'GiÃ¡Â»Â¯': 'Giữ',
    'nguyÃƒÂªn': 'nguyên',
    'hoÃ¡ÂºÂ·c': 'hoặc',
    'Ã¡Â»Å¸': 'ở',
    'PhÃ¡ÂºÂ£i': 'Phải',
    'bÃ¡ÂºÂ­t': 'bật',
    'chÃ¡ÂºÂ·n': 'chặn',
    'TÃƒÂªn': 'Tên',
    'Ã„â€˜ÃƒÂ£': 'đã',
    'lÃ†Â°u': 'lưu',
    'TÃƒÂ¬m': 'Tìm'
};

let previousContent = content;

// To avoid partial substring corruption, replace longer chunks first
for (const [bad, good] of Object.entries(replacements).sort((a,b) => b[0].length - a[0].length)) {
    content = content.split(bad).join(good);
}

// Any other remaining whole-line string literal replacements:
content = content.split('File khÃƒÂ´ng tÃ¡Â»â€œn tÃ¡ÂºÂ¡i').join('File không tồn tại');

if (content !== previousContent) {
    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed server.js");
}
