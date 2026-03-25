const fs = require('fs');

const file = 'backend/server.js';
if (!fs.existsSync(file)) process.exit(0);

let content = fs.readFileSync(file, 'utf8');

const mappings = [
    [/\/\/\s*Ã.*?Â¹\s*GraphQL layer/g, '// 🔹 GraphQL layer'],
    [/\/\/\s*connectDB\(\);\s*\/\/\s*Ã.*?\s*Moved inside startServer/g, '// connectDB(); // ❌ Moved inside startServer for async await'],
    [/\/\/\s*✅ KHÃ.*?NG d.*?ng/g, '// ✅ KHÔNG dùng'],
    [/\/\/\s*Ã.*?\s*B.*Â\s*phần \/api\/admin\/system ở target/g, '// ❌ Bỏ phần /api/admin/system ở target'],
    [/console\.error\("Ã.*?\s*Proxy error:",/g, 'console.error("❌ Proxy error:",'],
    [/\/\/\s*Tên file hiển thị khi tải vÃ¡Â»Â /g, '// Tên file hiển thị khi tải về'],
    [/\/\/\s*Chuyển nội bộ cho Nginx Ã.*?c file từ đĩa \(KHÃ.*?NG qua Node\)/g, '// Chuyển nội bộ cho Nginx đọc file từ đĩa (KHÔNG qua Node)'],
    [/\/\/\s*\([tT]uỳ chÃ.*?n\)\s*cho resume\/caching/g, '// (tuỳ chọn) cho resume/caching'],
    [/\/\/\s*Ã.*?Â¹\s*gom phần start server \+ GraphQL vÃ.*?o 1 hàm async/g, '// 🔹 gom phần start server + GraphQL vào 1 hàm async'],
    [/\/\/\s*Ã.*?Â¹\s*Connect DB first/g, '// 🔹 Connect DB first'],
    [/\/\/\s*Ã.*?Â¹\s*mount GraphQL trước fallback routes/g, '// 🔹 mount GraphQL trước fallback routes'],
    [/console\.warn\("Ã.*?\s*KYC bot returned null"\)/g, 'console.warn("⚠️ KYC bot returned null")'],
    [/console\.error\("Ã.*?\s*KYC bot initialization failed:"\)/g, 'console.error("❌ KYC bot initialization failed:")'],
    [/console\.log\("Ã.*?\s*Failed to start KYC bot:",/g, 'console.log("❌ Failed to start KYC bot:",'],
    [/console\.error\(`Ã.*?\s*Error starting server: \$\{error\.message\}`\)/g, 'console.error(`❌ Error starting server: ${error.message}`)'],
    [/console\.error\("Ã.*?\s*Failed to start server",/g, 'console.error("❌ Failed to start server",'],
];

let changed = false;
for (const [regex, replacement] of mappings) {
    if (regex.test(content)) {
        content = content.replace(regex, replacement);
        changed = true;
    }
}

if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed server.js regex");
}
