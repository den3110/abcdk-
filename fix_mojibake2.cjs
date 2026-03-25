const fs = require('fs');

const mappings = {
    "Sáºµn sÃ ng": "Sẵn sàng",
    "Ä Ã£ lÆ°u cá»¥m sÃ¢n cho giáº£i": "Đã lưu cụm sân cho giải",
    "Cáº­p nháº­t cá»¥m sÃ¢n": "Cập nhật cụm sân",
    "Cáº­p nháº­t cá»¥m sÃ¢n Ä‘Æ°á»£c phÃ©p dÃ¹ng tháº¥t báº¡i": "Cập nhật cụm sân được phép dùng thất bại",
    "Giáº£i phÃ³ng sÃ¢n tháº¥t báº¡i": "Giải phóng sân thất bại",
    "Quáº£n lÃ½ sÃ¢n theo cá»¥m": "Quản lý sân theo cụm",
    "Cáº¥u hÃ¬nh cá»¥m sÃ¢n mÃ ": "Cấu hình cụm sân mà",
    "rá»“i theo dÃµi runtime cá»§a tá»«ng sÃ¢n ngay trong cÃ¹ng má»™t mÃ n.": "rồi theo dõi runtime của từng sân ngay trong cùng một màn.",
    "Cá»¥m sÃ¢n Ä‘Æ°á»£c phÃ©p dÃ¹ng": "Cụm sân được phép dùng",
    "Chá» n cÃ¡c cá»¥m sÃ¢n mÃ  giáº£i nÃ y Ä‘Æ°á»£c phÃ©p dÃ¹ng Ä‘á»ƒ gÃ¡n sÃ¢n vÃ ": "Chọn các cụm sân mà giải này được phép dùng để gán sân và",
    "live. Báº¡n cÃ³ thá»ƒ thÃªm nhiá» u cá»¥m cÃ¹ng lÃºc.": "live. Bạn có thể thêm nhiều cụm cùng lúc.",
    "Ä ang lÆ°u...": "Đang lưu...",
    "LÆ°u cá»¥m sÃ¢n": "Lưu cụm sân",
    "Chá» n cá»¥m sÃ¢n": "Chọn cụm sân",
    "TÃ¬m vÃ  thÃªm cá»¥m sÃ¢n": "Tìm và thêm cụm sân",
    "Ä ang táº¯t": "Đang tắt",
    "Giáº£i nÃ y chÆ°a cÃ³ cá»¥m sÃ¢n nÃ o Ä‘Æ°á»£c báº­t. Chá» n Ã­t nháº¥t má»™t cá»¥m á»Ÿ pháº§n": "Giải này chưa có cụm sân nào được bật. Chọn ít nhất một cụm ở phần",
    "trÃªn Ä‘á»ƒ báº¯t Ä‘áº§u.": "trên để bắt đầu.",
    "Chá» n má»™t cá»¥m sÃ¢n": "Chọn một cụm sân",
    "ChÆ°a cÃ³ Ä‘á»‹a Ä‘iá»ƒm": "Chưa có địa điểm",
    "Tá»•ng sÃ¢n": "Tổng sân",
    "SÃ¢n trá»‘ng": "Sân trống",
    "Ä ang cÃ³ tráº­n": "Đang có trận",
    "Ä ang live": "Đang live",
    "Ä ang táº£i runtime cá»¥m sÃ¢nâ€¦": "Đang tải runtime cụm sân…",
    "KhÃ´ng táº£i Ä‘Æ°á»£c runtime cá»¥m sÃ¢n.": "Không tải được runtime cụm sân.",
    "KhÃƒÂ´ng tÃ¡ÂºÂ£i Ã„â€˜Ã†Â°Ã¡Â»Â£c runtime cÃ¡Â»Â¥m sÃƒÂ¢n.": "Không tải được runtime cụm sân.",
    "KhÃ´ng táº£i Ä‘Æ°á»£c": "Không tải được",
    "Cá»¥m sÃ¢n nÃ y chÆ°a cÃ³ sÃ¢n váº­t lÃ½ nÃ o.": "Cụm sân này chưa có sân vật lý nào.",
    "SÃ¢n nÃ y Ä‘ang thuá»™c giáº£i khÃ¡c. Chá»‰ admin má»›i": "Sân này đang thuộc giải khác. Chỉ admin mới",
    "Ä‘Æ°á»£c giáº£i phÃ³ng.": "được giải phóng.",
    "SÃ¢n Ä‘ang trá»‘ng, sáºµn sÃ ng Ä‘á»ƒ gÃ¡n tráº­n.": "Sân đang trống, sẵn sàng để gán trận.",
    "Ä Ã³ng": "Đóng",
    "Ä Ã£ gÃ¡n tráº­n": "Đã gán trận",
    "Báº£o trÃ¬": "Bảo trì",
    "Giáº£i phÃ³ng sÃ¢n": "Giải phóng sân",
    "Ä ang gÃ¡n táº¡i": "Đang gán tại",
    "Bá»  gÃ¡n sÃ¢n": "Bỏ gán sân",
    "Bá»  gÃ¡n sÃ¢n tháº¥t báº¡i": "Bỏ gán sân thất bại",
    "GÃ¡n sÃ¢n tháº¥t báº¡i": "Gán sân thất bại",
    "Ä ang sá»­ dá»¥ng sÃ¢n nÃ y.": "đang sử dụng sân này.",
    "Ä ang gÃ¡n": "Đang gán",
    "GÃ¡n vÃ o sÃ¢n nÃ y": "Gán vào sân này",
    "Giáº£i Ä‘áº¥u": "Giải đấu",
    "Ä á»™i A": "Đội A",
    "Ä á»™i B": "Đội B",
    "Chá» n cá»¥m sÃ¢n vÃ  sÃ¢n váº­t lÃ½ Ä‘á»ƒ gÃ¡n cho tráº­n nÃ y.": "Chọn cụm sân và sân vật lý để gán cho trận này.",
    "Giáº£i nÃ y chÆ°a chá» n cá»¥m sÃ¢n Ä‘Æ°á»£c phÃ©p dÃ¹ng trong pháº§n cáº¥u hÃ¬nh giáº£i.": "Giải này chưa chọn cụm sân được phép dùng trong phần cấu hình giải.",
    "Thiáº¿u `tournamentId`, chÆ°a thá»ƒ gÃ¡n sÃ¢n theo cá»¥m.": "Thiếu \`tournamentId\`, chưa thể gán sân theo cụm.",
    "Cá»¥m sÃ¢n": "Cụm sân"
};

const files = [
    'frontend/src/components/TournamentCourtClusterDialog.jsx',
    'frontend/src/components/AssignCourtStationDialog.jsx',
    'frontend/src/slices/adminApiSlice.js',
    'frontend/src/i18n/lang/vi.js'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    let fixed = 0;
    
    for (const [bad, good] of Object.entries(mappings)) {
        if (content.includes(bad)) {
            content = content.split(bad).join(good);
            fixed++;
        }
    }
    
    if (fixed > 0) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Fixed ${fixed} patterns in ${file}`);
    }
}
