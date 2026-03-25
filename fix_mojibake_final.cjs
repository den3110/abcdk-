const fs = require('fs');

function fixMojibake(file) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');

    // Replace based on partial substrings avoiding exact invisible spaces
    const mappings = [
        [/Chá\» n c\Ã¡c cá\»\¥m s\Ã¢n m\Ã.*giá\º£i n\Ã y.*/, "Chọn các cụm sân mà giải này được phép dùng để gán sân và"],
        [/Giá\º£i n\Ã y ch\Æ°a c\Ã³ cá\»\¥m s\Ã¢n n\Ã o.*/, "Giải này chưa có cụm sân nào được bật. Chọn ít nhất một cụm ở phần"],
        [/.*<Alert severity="info">Ä ang tá\º£i runtime cá\»\¥m s\Ã¢nâ…<\/Alert>.*/, "                  <Alert severity=\"info\">Đang tải runtime cụm sân…</Alert>"],
        [/Chá\» n cá\»\¥m s\Ã¢n v\Ã.*s\Ã¢n vá\º­t l\Ã½.*/, "Chọn cụm sân và sân vật lý để gán cho trận này."],
        [/Giá\º£i n\Ã y ch\Æ°a chá\» n cá\»\¥m s\Ã¢n Ä‘ươ.*/, "Giải này chưa chọn cụm sân được phép dùng trong phần cấu hình giải."],
        [/.*Ä‘ang sá\»­ dá\»\¥ng s\Ã¢n n\Ã y\..*/, "đang sử dụng sân này."],
        [/Gán vào sân này"/, "Gán vào sân này\""],
        [/"Ä ang g\Ã¡n"/, "\"Đang gán\""],
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
        console.log("Fixed", file);
    }
}

fixMojibake('frontend/src/components/TournamentCourtClusterDialog.jsx');
fixMojibake('frontend/src/components/AssignCourtStationDialog.jsx');
