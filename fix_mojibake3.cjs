const fs = require('fs');
const path = require('path');

function safeDecode(str) {
    let current = str;
    let iterations = 0;
    while (iterations < 4) {
        // Must contain only characters <= 0xFF (Latin-1)
        let isOnlyLatin1 = true;
        for (let i = 0; i < current.length; i++) {
            if (current.charCodeAt(i) > 0xFF) {
                isOnlyLatin1 = false;
                break;
            }
        }
        
        // If it's already pure ASCII or contains non-Latin-1 chars (like valid VN), stop decoding
        if (!isOnlyLatin1 || /^[\x00-\x7F]*$/.test(current)) {
            break;
        }
        
        const buf = Buffer.from(current, 'latin1');
        const decoded = buf.toString('utf8');
        
        // If decoding didn't change it, or resulted in invalid UTF-8 bytes (\uFFFD), stop!
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
            
            for (let i=0; i<lines.length; i++) {
                let original = lines[i];
                // Try decoding the entire line.
                // But wait! If a line has both valid VN (>0xFF) AND mojibake (<=0xFF), the whole line check fails!
                // Let's decode chunk by chunk (words or delimited strings)
                
                // We'll replace all substrings that are purely contiguous \x80-\xFF and valid ASCII characters
                // Actually, replacing anything inside Quotes / JSX is complex.
                // If a line is partially corrupt, we can extract contiguous blocks.
                // Let's use a regex to find blocks of text that contain at least one \x80-\xFF char, surrounded by ASCII.
                // A mojibake block is a mix of ASCII and \x80-\xFF.
                // Regex: /[\x00-\xFF]*[\x80-\xFF][\x00-\xFF]*/g
                // Wait, that matches the whole line if the line is <=0xFF.
                
                let decodedLine = safeDecode(original);
                
                // If the entire line couldn't be decoded, try extracting quoted strings or JSX text
                if (!decodedLine) {
                    let newStr = original;
                    // Regex finding things that look like strings with high bytes
                    const matches = original.match(/([\x00-\xFF]+)/g);
                    if (matches) {
                        for (let m of matches) {
                            if (m.length > 2 && /[^\x00-\x7F]/.test(m)) {
                                let fixed = safeDecode(m);
                                if (fixed) {
                                    newStr = newStr.replace(m, fixed);
                                }
                            }
                        }
                    }
                    if (newStr !== original) decodedLine = newStr;
                }

                if (decodedLine && decodedLine !== original) {
                    lines[i] = decodedLine;
                    fixedCount++;
                    console.log(`[FIXED] ${fullPath}:${i+1} | ${original.trim()} => ${decodedLine.trim()}`);
                }
            }
            
            if (fixedCount > 0) {
                fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
                console.log(`Updated ${fixedCount} lines in ${fullPath}`);
            }
        }
    }
}

processDirectory('frontend/src');
