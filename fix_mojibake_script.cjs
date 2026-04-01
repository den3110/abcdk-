const fs = require('fs');
const path = require('path');

const fixes = [
  {
    file: 'frontend/src/slices/adminApiSlice.js',
    replaces: [
      [/âœ¨/g, '✨'],
      [/DUYá»†T/g, 'DUYỆT'],
      [/Cáº­p nháº­t pháº¡m vi cháº¥m/g, 'Cập nhật phạm vi chấm'],
      [/nhiá» u tá»‰nh/g, 'nhiều tỉnh']
    ]
  },
  {
    file: 'frontend/src/screens/PickleBall/RankingList.jsx',
    replaces: [
      [/TÃ¬m/g, 'Tìm'],
      [/Ä ang táº£i dá»¯ liá»‡u xáº¿p háº¡ng/g, 'Đang tải dữ liệu xếp hạng'],
      [/Hiá»ƒn thá»‹/g, 'Hiển thị'],
      [/Cháº¿ Ä‘á»™/g, 'Chế độ']
    ]
  },
  {
    file: 'pickletour-app-mobile/components/match/RefereeScorePanel.native.tsx',
    replaces: [
      [/Ä á»•i bÃªn/g, 'Đổi bên']
    ]
  },
  {
    file: 'pickletour-app-mobile/components/live_list/LiveMatchCard.tsx',
    replaces: [
      [/Ä Ã£ lÃªn lá»‹ch/g, 'Đã lên lịch'],
      [/Chá»  thi Ä‘áº¥u/g, 'Chờ thi đấu'],
      [/Ä Ã£ gÃ¡n sÃ¢n/g, 'Đã gán sân'],
      [/Ä ang phÃ¡t/g, 'Đang phát'],
      [/Ä Ã£ káº¿t thÃºc/g, 'Đã kết thúc'],
      [/Táº¡m dá»«ng/g, 'Tạm dừng'],
      [/Ä Ã£ há»§y/g, 'Đã hủy'],
      [/ðŸ”´/g, '🔴'],
      [/trá»±c tiáº¿p/g, 'trực tiếp'],
      [/khÃ´ng kháº£ dá»¥ng/g, 'không khả dụng']
    ]
  },
  {
    file: 'pickletour-app-mobile/app/_layout.tsx',
    replaces: [
      [/KhÃ´ng thá»ƒ reload á»©ng dá»¥ng/g, 'Không thể reload ứng dụng'],
      [/KhÃ´ng thá»ƒ táº£i/g, 'Không thể tải']
    ]
  },
  {
    file: 'pickletour-app-mobile/components/match/MatchContent.tsx',
    replaces: [
      [/Dang tai video tu PickleTour/g, 'Đang tải video từ PickleTour'],
      [/dang chuan bi du lieu tre/g, 'đang chuẩn bị dữ liệu trễ']
    ]
  }
];

let totalReplaced = 0;

for (const {file, replaces} of fixes) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) {
    console.log('File not found:', p);
    continue;
  }
  let content = fs.readFileSync(p, 'utf8');
  let changed = false;
  
  for (const [regex, replacement] of replaces) {
    if (regex.test(content)) {
      content = content.replace(regex, replacement);
      changed = true;
      totalReplaced++;
      console.log(`Replaced in ${file}: ${regex} -> ${replacement}`);
    }
  }
  
  if (changed) {
    fs.writeFileSync(p, content, 'utf8');
  }
}

console.log('Total replacements:', totalReplaced);
