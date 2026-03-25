const fs = require('fs');

const file = 'backend/server.js';
if (!fs.existsSync(file)) process.exit(0);

let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /target: "http:\/\/127\.0\.0\.1:8003\/api\/admin\/system", \/\/ [^\x00-\x7F]+ B[^\x00-\x7F]+ phần \/api\/admin\/system ở target/g,
    'target: "http://127.0.0.1:8003/api/admin/system", // ❌ Bỏ phần /api/admin/system ở target'
);

content = content.replace(
    /\/\/ Tên file hiển thị khi tải v[^\x00-\x7F]+/g,
    '// Tên file hiển thị khi tải về'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed server.js last 2 lines");
