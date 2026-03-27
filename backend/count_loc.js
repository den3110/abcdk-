const fs = require('fs');
const path = require('path');

let count = 0;
let files = [];

function walk(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const p = path.join(dir, item);
    if (fs.statSync(p).isDirectory()) {
      if (!['node_modules', '.git', 'build', 'dist', 'coverage', '.env'].includes(item)) {
        walk(p);
      }
    } else if (item.endsWith('.js')) {
      const lines = fs.readFileSync(p, 'utf8').split('\n').length;
      files.push({ f: p, l: lines });
      count += lines;
    }
  }
}

walk('.');
files.sort((a, b) => b.l - a.l);

console.log(`\n=======================`);
console.log(`Total JS files: ${files.length}`);
console.log(`Total Lines of Code: ${count}`);
console.log(`=======================\n`);
console.log(`Top 10 largest files:`);
for (let i = 0; i < 10 && i < files.length; i++) {
  console.log(`${String(files[i].l).padStart(5)} lines - ${files[i].f}`);
}
