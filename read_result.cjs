const fs = require('fs');

const content = fs.readFileSync('find_result.txt', 'utf16le');
const lines = content.split('\n');

for (const line of lines) {
  if (line.includes('UNACCENTED') || line.includes('ChatBotDrawer')) {
    console.log(line.trim());
  }
}
