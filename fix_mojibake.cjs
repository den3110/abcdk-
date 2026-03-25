const fs = require('fs');
const iconv = require('iconv-lite');

const files = [
    'frontend/src/slices/adminApiSlice.js',
    'frontend/src/components/TournamentCourtClusterDialog.jsx',
    'frontend/src/components/AssignCourtStationDialog.jsx'
];

for (const file of files) {
    if (!fs.existsSync(file)) {
        console.log("NOT FOUND:", file);
        continue;
    }
    let content = fs.readFileSync(file, 'utf8');
    let lines = content.split('\n');
    let fixedCount = 0;

    for (let i = 0; i < lines.length; i++) {
        let original = lines[i];
        
        // Skip lines that are 100% ASCII
        if (/^[\x00-\x7F]*$/.test(original)) continue;

        try {
            const buf = iconv.encode(original, 'win1252');
            const decoded = iconv.decode(buf, 'utf8');
            
            if (decoded !== original && !decoded.includes('\uFFFD')) {
                lines[i] = decoded;
                fixedCount++;
                console.log(`[FIXED] ${file}:${i+1} | ${original.trim()} => ${decoded.trim()}`);
            }
        } catch (e) {
            // ignore
        }
    }

    if (fixedCount > 0) {
        fs.writeFileSync(file, lines.join('\n'), 'utf8');
        console.log(`Successfully fixed ${fixedCount} lines in ${file}`);
    } else {
        console.log(`No lines safely fixable via strict decoding in ${file}`);
    }
}
