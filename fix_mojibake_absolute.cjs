const fs = require('fs');

function fixByLineNum(file, overrides) {
    if (!fs.existsSync(file)) return;
    let lines = fs.readFileSync(file, 'utf8').split('\n');
    let changed = false;

    for (const [lineNum, newText] of Object.entries(overrides)) {
        const idx = parseInt(lineNum) - 1; // 0-indexed
        if (lines[idx] !== undefined) {
            lines[idx] = newText;
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        console.log("Fixed lines in " + file);
    }
}

fixByLineNum('frontend/src/components/AssignCourtStationDialog.jsx', {
    234: '              Chọn cụm sân và sân vật lý để gán cho trận này.',
    240: '              Giải này chưa chọn cụm sân được phép dùng trong phần cấu hình giải.',
    307: '                <Alert severity="info">Đang tải runtime cụm sân…</Alert>',
    398: '                                  đang sử dụng sân này.',
    414: '                              {isCurrent ? "Đang gán" : "Gán vào sân này"}'
});

fixByLineNum('frontend/src/components/TournamentCourtClusterDialog.jsx', {
    297: '                    Chọn các cụm sân mà giải này được phép dùng để gán sân và',
    298: '                    live. Bạn có thể thêm nhiều cụm cùng lúc.',
    355: '              Giải này chưa có cụm sân nào được bật. Chọn ít nhất một cụm ở phần',
    402: '                  <Alert severity="info">Đang tải runtime cụm sân…</Alert>'
});
