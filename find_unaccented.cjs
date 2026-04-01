const fs = require('fs');
const path = require('path');

const mojibakeRegex = /[ÃÆáºá»á½á¾á¿]/;
const unaccentedWords = ["dang tai", "vui long", "khong the", "cam on", "nhap", "kiem", "giup", "ho tro", "tra loi", "thong tin", "du lieu", "ket qua", "tiep tuc", "quay lai", "dang nhap", "mat khau", "tai khoan"];

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (let file of list) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git')) {
        results = results.concat(walk(file));
      }
    } else if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  }
  return results;
}

const allFiles = [...walk('frontend/src'), ...walk('pickletour-app-mobile/components'), ...walk('pickletour-app-mobile/app')];

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let loggedFile = false;
  
  // check mojibake
  if (mojibakeRegex.test(content)) {
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (mojibakeRegex.test(line)) {
        console.log(`[MOJIBAKE] ${f}:${i+1} : ${line.trim()}`);
      }
    });
  }

  // check unaccented, ignoring command palettes where we expect it
  if (!f.includes('commandPalette') && !f.includes('CommandPalette')) {
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const lower = line.toLowerCase();
      // Only report if it's in a string literal mostly (naive check: contains " or ' or `)
      if (line.includes('"') || line.includes("'") || line.includes('`')) {
        for (const word of unaccentedWords) {
          if (lower.includes(word) && !lower.includes('import ') && !lower.includes('export ') && !lower.includes('class ') && !lower.includes('id=')) {
            // Also ignore things that look like variable names e.g. "dangTai" 
            const index = lower.indexOf(word);
            // Ensure space separated and mostly in a text block
            console.log(`[UNACCENTED] ${f}:${i+1} : ${line.trim()}`);
            break; // just log line once
          }
        }
      }
    });
  }
}
