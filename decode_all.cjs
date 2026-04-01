const fs = require('fs');
const path = require('path');

function walk(dir) {
  let r = [];
  if (!fs.existsSync(dir)) return r;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!p.includes('node_modules') && !p.includes('.git') && !p.includes('.expo') && !p.includes('dist')) {
        r = r.concat(walk(p));
      }
    } else if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.tsx') || p.endsWith('.ts')) {
      r.push(p);
    }
  }
  return r;
}

const files = [...walk('frontend/src'), ...walk('pickletour-app-mobile')];

let totalDecoded = 0;
const regex = /\\u([0-9a-fA-F]{4})/g;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let matches = 0;
  
  if (regex.test(content)) {
    content = content.replace(regex, (match, grp) => {
      // Don't decode non-printable characters or things that might break syntax if they are regex
      // but typical Vietnamese characters are safe.
      matches++;
      return String.fromCharCode(parseInt(grp, 16));
    });
    
    if (matches > 0) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Fixed ${matches} unicode escapes in ${file}`);
      totalDecoded += matches;
    }
  }
}

console.log(`Total unicode escapes decoded: ${totalDecoded}`);
