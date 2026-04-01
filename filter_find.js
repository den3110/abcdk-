const fs = require('fs');
let text;
try {
  text = fs.readFileSync('find_result.txt', 'utf16le');
} catch (e) {
  text = fs.readFileSync('find_result.txt', 'utf8');
}

const lines = text.split('\n');
const results = lines.filter(l => l.toLowerCase().includes('bot') || l.toLowerCase().includes('chat'));
fs.writeFileSync('filtered_results.txt', results.join('\n'));
