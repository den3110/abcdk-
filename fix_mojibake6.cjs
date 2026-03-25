const fs = require('fs');

const files = [
    'frontend/src/components/TournamentCourtClusterDialog.jsx',
    'frontend/src/components/AssignCourtStationDialog.jsx'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');

    // Force replace the teamLine function
    content = content.replace(
        /const teamLine = \(match\) =>\s+`\$\{match\?.pairA\?.name \|\| "[^"]+"\} vs \$\{match\?.pairB\?.name \|\| "[^"]+"\}`;/g,
        'const teamLine = (match) =>\n  `${match?.pairA?.name || "Đội A"} vs ${match?.pairB?.name || "Đội B"}`;'
    );

    // Force replace the assigned case
    content = content.replace(
        /case "assigned":\s+return "[^"]+";/g,
        'case "assigned":\n      return "Đã gán trận";'
    );

    // Force replace the live case
    content = content.replace(
        /case "live":\s+return "[^"]+";/g,
        'case "live":\n      return "Đang live";'
    );

    // Force replace the maintenance case
    content = content.replace(
        /case "maintenance":\s+return "[^"]+";/g,
        'case "maintenance":\n      return "Bảo trì";'
    );
    
    // Replace "Đang gán tại {currentStation?.name}"
    content = content.replace(
        /[^\x00-\x7F]+ g\Ã¡n t\Ã¡ÂºÂ¡i \{currentStation\?.name\}/g,
        'Đang gán tại {currentStation?.name}'
    );
    // Just in case it's slightly different
    content = content.replace(
        /Đang gán t\Ã¡ÂºÂ¡i \{currentStation\?.name\}/g,
        'Đang gán tại {currentStation?.name}'
    );
    content = content.replace(
        /Ä\x90ang gÃ¡n táº¡i/g,
        'Đang gán tại'
    );
    
    // Replace "Bỏ gán sân"
    content = content.replace(
        /B\Ã¡\»Â  g\Ã¡n s\Ã¢n/g,
        'Bỏ gán sân'
    );

    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed manually via strict text anchors in", file);
}
