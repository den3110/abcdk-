const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

function safeDecode(str) {
    let current = str;
    let iterations = 0;
    while (iterations < 4) {
        if (/^[\x00-\x7F]*$/.test(current)) {
            break;
        }
        
        let qnCountStr = (current.match(/\?/g) || []).length;
        const buf = iconv.encode(current, 'win1252');
        
        let qnCountBuf = 0;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] === 0x3f) qnCountBuf++;
        }
        
        // If iconv-lite replaces a character with '?' because it's not in win1252
        // (e.g. valid Vietnamese like 'Đ'), we MUST break to avoid corrupting it.
        if (qnCountBuf > qnCountStr) break; 

        const decoded = iconv.decode(buf, 'utf8');
        
        if (decoded === current || decoded.includes('\uFFFD')) {
            break;
        }
        
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
            
            for (let i = 0; i < lines.length; i++) {
                let original = lines[i];
                let newStr = original;
                
                // Try chunk by chunk matching things that look like string literals or text
                // Since win1252 characters can be scattered, we'll try matching contiguous blocks
                // that contain non-ASCII chars.
                const matches = original.match(/([^\x00-\x7F]+(?:[\w\s.,!?'"(){}\[\]\\/:-]*[^\x00-\x7F]+)*)/g);
                if (matches) {
                    for (let m of matches) {
                        let fixed = safeDecode(m);
                        if (fixed) {
                            newStr = newStr.replace(m, fixed);
                        }
                    }
                }
                
                // Try whole line just in case chunking missed it
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
    }
}

// We only process the dialog components for safety so we don't accidentally touch everything again
processDirectory('frontend/src/components');
