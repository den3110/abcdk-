const fs = require('fs');
const path = require('path');

// This map represents what Windows-1252 decoding did to bytes 0x80-0x9F
// Standard win1252 maps some to characters, and leaves undefined as control chars.
function reverseWin1252CharToByte(char) {
    const code = char.charCodeAt(0);
    if (code <= 0xFF) {
        // For Latin-1 compatibility, anything <= 0xFF that wasn't transformed by win1252
        // translates directly back to its byte value.
        // Wait, what about chars that Win1252 transformed?
        // Let's check the exceptions.
    }
    
    // Windows 1252 exceptions from 0x80 to 0x9F:
    if (char === '€') return 0x80;
    if (char === '‚') return 0x82;
    if (char === 'ƒ') return 0x83;
    if (char === '„') return 0x84;
    if (char === '…') return 0x85;
    if (char === '†') return 0x86;
    if (char === '‡') return 0x87;
    if (char === 'ˆ') return 0x88;
    if (char === '‰') return 0x89;
    if (char === 'Š') return 0x8A;
    if (char === '‹') return 0x8B;
    if (char === 'Œ') return 0x8C;
    if (char === 'Ž') return 0x8E;
    if (char === '‘') return 0x91;
    if (char === '’') return 0x92;
    if (char === '“') return 0x93;
    if (char === '”') return 0x94;
    if (char === '•') return 0x95;
    if (char === '–') return 0x96;
    if (char === '—') return 0x97;
    if (char === '˜') return 0x98;
    if (char === '™') return 0x99;
    if (char === 'š') return 0x9A;
    if (char === '›') return 0x9B;
    if (char === 'œ') return 0x9C;
    if (char === 'ž') return 0x9E;
    if (char === 'Ÿ') return 0x9F;

    if (code <= 0xFF) return code;
    
    return null; // Not a win1252 character (e.g. valid VN like 'Đ' U+0110)
}

function safeDecode(str) {
    let current = str;
    let iterations = 0;
    while (iterations < 4) {
        if (/^[\x00-\x7F]*$/.test(current)) {
            break; // ASCII only
        }
        
        // Build the raw bytes
        const bytes = [];
        let canMap = true;
        for (let i = 0; i < current.length; i++) {
            const b = reverseWin1252CharToByte(current[i]);
            if (b === null) {
                canMap = false;
                break;
            }
            bytes.push(b);
        }
        
        if (!canMap) break; // Contained a character strictly outside win1252/latin1
        
        const buf = Buffer.from(bytes);
        const decoded = buf.toString('utf8');
        
        if (decoded === current || decoded.includes('\uFFFD')) {
            break;
        }
        
        current = decoded;
        iterations++;
    }
    return current !== str ? current : null;
}

function processFile(fullPath) {
    let content = fs.readFileSync(fullPath, 'utf8');
    let lines = content.split('\n');
    let fixedCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        let original = lines[i];
        let newStr = original;
        
        // Try to match chunks that look like mojibake
        const matches = original.match(/([^\x00-\x7F]+(?:[\w\s.,!?'"(){}\[\]\\/:-]*[^\x00-\x7F]+)*)/g);
        if (matches) {
            for (let m of matches) {
                let fixed = safeDecode(m);
                if (fixed) {
                    newStr = newStr.replace(m, fixed);
                }
            }
        }
        
        if (newStr === original) {
            let fullFixed = safeDecode(original);
            if (fullFixed) {
                newStr = fullFixed;
            }
        }

        if (newStr && newStr !== original) {
            lines[i] = newStr;
            fixedCount++;
            console.log(`[FIXED] ${fullPath}:${i+1} | ${original.trim()} => ${newStr.trim()}`);
        }
    }
    
    if (fixedCount > 0) {
        fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
        console.log(`Updated ${fixedCount} lines in ${fullPath}`);
    }
}

processFile('frontend/src/components/TournamentCourtClusterDialog.jsx');
processFile('frontend/src/components/AssignCourtStationDialog.jsx');
