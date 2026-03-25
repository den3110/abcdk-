const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

function safeDecode(str) {
    let current = str;
    let iterations = 0;
    while (iterations < 4) {
        if (/^[\x00-\x7F]*$/.test(current)) break; // ASCII only
        
        let qnCountStr = (current.match(/\?/g) || []).length;
        const buf = iconv.encode(current, 'win1252');
        
        let qnCountBuf = 0;
        for (let i=0; i<buf.length; i++) {
            if (buf[i] === 0x3f) qnCountBuf++;
        }
        
        if (qnCountBuf > qnCountStr) break; // Unmappable character -> lossy!

        const decoded = iconv.decode(buf, 'utf8');
        if (decoded === current || decoded.includes('\uFFFD')) break;
        
        current = decoded;
        iterations++;
    }
    return current !== str ? current : null;
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                processDirectory(fullPath);
            }
        } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let lines = content.split('\n');
            let fixedCount = 0;
            
            for (let i=0; i<lines.length; i++) {
                let original = lines[i];
                let decoded = safeDecode(original);
                if (decoded) {
                    lines[i] = decoded;
                    fixedCount++;
                    console.log(`[FIXED] ${fullPath}:${i+1} | ${original.trim()} => ${decoded.trim()}`);
                }
            }
            
            if (fixedCount > 0) {
                fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
                console.log(`Updated ${fixedCount} lines in ${fullPath}`);
            }
        }
    }
}

processDirectory('backend');
