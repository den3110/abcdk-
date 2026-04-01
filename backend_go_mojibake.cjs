const fs = require('fs');
const path = require('path');

const replacements = [
  ['Ã´', 'ô'], ['Ãº', 'ú'], ['Ã', 'ý'], ['Ã', 'í'], ['Ä', 'Đ'], ['\u008f', 'ĩ'], ['\u008d', 'í'], ['Ã¡', 'á'], ['Ã ', 'à'], ['Ã£', 'ã'], ['Ã¢', 'â'], ['Ãª', 'ê'], ['Ã©', 'é'], ['Ã¨', 'è'], ['Ã', 'í'], ['Ã²', 'ò'], ['Ã³', 'ó'], ['Ãµ', 'õ'], ['Ã¹', 'ù'], ['Ãº', 'ú'], ['Ã½', 'ý'], ['Ä‘', 'đ'], ['Ä\u0090', 'Đ'], ['áº¡', 'ạ'], ['áº£', 'ả'], ['áº¥', 'ấ'], ['áº§', 'ầ'], ['áº©', 'ẩ'], ['áº«', 'ẫ'], ['áº­', 'ậ'], ['áº¯', 'ắ'], ['áº±', 'ằ'], ['áº³', 'ẳ'], ['áºµ', 'ẵ'], ['áº·', 'ặ'], ['á»‡', 'ệ'], ['á»‰', 'ỉ'], ['á»‹', 'ị'], ['á»', 'ọ'], ['á»', 'ỏ'], ['á»', 'ố'], ['á»“', 'ồ'], ['á»•', 'ổ'], ['á»—', 'ỗ'], ['á»™', 'ộ'], ['á»›', 'ớ'], ['á»', 'ờ'], ['á»Ÿ', 'ở'], ['á»¡', 'ỡ'], ['á»£', 'ợ'], ['á»¥', 'ụ'], ['á»§', 'ủ'], ['á»©', 'ứ'], ['á»«', 'ừ'], ['á»', 'ử'], ['á»¯', 'ữ'], ['á»±', 'ự'], ['á»³', 'ỳ'], ['á»µ', 'ỵ'], ['á»·', 'ỷ'], ['á»¹', 'ỹ'], ['áº½', 'ẽ'], ['áº»', 'ẻ'], ['áº¹', 'ẹ'], ['áº¿', 'ế'], ['á»\u0081', 'ề'], ['á»\u0083', 'ể'], ['á»\u0085', 'ễ'],
  ['Ã\u0081', 'Á'], ['Ã\u0080', 'À'], ['Ã\u0083', 'Ã'], ['Ã\u0082', 'Â'], ['Ã\u008a', 'Ê'], ['Ã\u0089', 'É'], ['Ã\u0088', 'È'], ['Ã\u008d', 'Í'], ['Ã\u0092', 'Ò'], ['Ã\u0093', 'Ó'], ['Ã\u0095', 'Õ'], ['Ã\u0099', 'Ù'], ['Ã\u009a', 'Ú'], ['Ã\u009d', 'Ý'],
  ['KhÃ´ng tÃ¬m tháº¥y', 'Không tìm thấy'], ['Ä\u0090Ã£ cáº­p nháº­t', 'Đã cập nhật'],
  ['TÃ¬m kiáº¿m', 'Tìm kiếm'], ['Ä\u0090ang táº£i...', 'Đang tải...'], ['Ä\u0090ang táº£i', 'Đang tải']
];

function walk(dir) {
  let r = [];
  if (!fs.existsSync(dir)) return r;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!p.includes('node_modules') && !p.includes('.git') && !p.includes('dist')) {
        r = r.concat(walk(p));
      }
    } else if (p.endsWith('.go') || p.endsWith('.json')) {
      r.push(p);
    }
  }
  return r;
}

const files = walk('backend-go');
let totalFixed = 0;

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8');
  let changed = false;
  
  for (const [bad, good] of replacements) {
    if (content.includes(bad)) {
      content = content.replaceAll(bad, good);
      changed = true;
    }
  }
  
  if (changed) {
    fs.writeFileSync(f, content, 'utf8');
    console.log(`Fixed mojibake in ${f}`);
    totalFixed++;
  }
}

console.log(`Total backend-go files with fixed mojibake: ${totalFixed}`);
