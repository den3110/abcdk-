const fs = require('fs');

const file = 'frontend/src/components/TournamentCourtClusterDialog.jsx';
if (!fs.existsSync(file)) process.exit(0);

let content = fs.readFileSync(file, 'utf8');

const translations = {
    "Quan ly san theo cum": "Quản lý sân theo cụm",
    "Cau hinh san cho": "Cấu hình sân cho",
    "ho tro 2 che do gan tay va tu dong theo danh sach": "hỗ trợ 2 chế độ gán tay và tự động theo danh sách",
    "Cum san duoc phep dung": "Cụm sân được phép dùng",
    "Moi giai chi chon 1 cum san": "Mỗi giải chỉ chọn 1 cụm sân",
    "Dang luu...": "Đang lưu...",
    "Luu cum san": "Lưu cụm sân",
    "Cap nhat cum san that bai": "Cập nhật cụm sân thất bại",
    "Chon cum san": "Chọn cụm sân",
    "Tim cum san": "Tìm cụm sân",
    "Giai nay chua co cum san nao duoc bat.": "Giải này chưa có cụm sân nào được bật.",
    "Cum san": "Cụm sân",
    "Chua co dia diem": "Chưa có địa điểm",
    "Tong san": "Tổng sân",
    "San trong": "Sân trống",
    "Dang co tran": "Đang có trận",
    "Dang live": "Đang live",
    "Dang dong bo runtime moi nhat...": "Đang đồng bộ runtime mới nhất...",
    "Khong the lam moi runtime luc nay. Dang hien thi du lieu gan nhat.": "Không thể làm mới runtime lúc này. Đang hiển thị dữ liệu gần nhất.",
    "Dang tai runtime cum san...": "Đang tải runtime cụm sân...",
    "Khong tai duoc runtime cum san.": "Không tải được runtime cụm sân.",
    "Cum san nay chua co san vat ly nao.": "Cụm sân này chưa có sân vật lý nào.",
    "Doi A": "Đội A",
    "Doi B": "Đội B",
    "San sang": "Sẵn sàng",
    "Da gan tran": "Đã gán trận",
    "Bao tri": "Bảo trì",
    "Gan tay": "Gán tay",
    "Tu dong theo danh sach": "Tự động theo danh sách",
    "San dang trong.": "Sân đang trống.",
    "San nay dang thuoc giai khac. Chi admin moi duoc can thiep.": "Sân này đang thuộc giải khác. Chỉ admin mới được can thiệp.",
    "Che do gan san": "Chế độ gán sân",
    "Bo qua tran hien tai": "Bỏ qua trận hiện tại",
    "Giai phong san": "Giải phóng sân",
    "Luu cau hinh": "Lưu cấu hình",
    "Luu cau hinh san that bai": "Lưu cấu hình sân thất bại",
    "Giai phong san that bai": "Giải phóng sân thất bại",
    "tran cho": "trận chờ",
    "Dang phat: ": "Đang phát: ",
    "Tiep theo: ": "Tiếp theo: ",
    "Tiep theo": "Tiếp theo",
    "Them tran vao danh sach": "Thêm trận vào danh sách",
    "Chon tran": "Chọn trận",
    "Them": "Thêm",
    "San nay chua co danh sach tran tu dong.": "Sân này chưa có danh sách trận tự động.",
    "San se cho nguoi van hanh gan tran nhu hien tai": "Sân sẽ chờ người vận hành gán trận như hiện tại",
    "Dong": "Đóng",
    "Giai dau": "Giải đấu"
};

let changed = false;
// Sort keys by length descending so longer phrases match first, preventing partial word replacement
const keys = Object.keys(translations).sort((a,b) => b.length - a.length);

for (const key of keys) {
    const value = translations[key];
    // Create a strict boundary match to avoid replacing parts of words if needed
    // Actually, straight replacement is fine here because these are exact UI strings in quotes or React text
    if (content.includes(key)) {
        content = content.split('"' + key + '"').join('"' + value + '"');
        content = content.split("'" + key + "'").join("'" + value + "'");
        content = content.split(">" + key + "<").join(">" + value + "<");
        // Also check if it's inside curly braces like {key} or `key`
        content = content.split('`' + key + '`').join('`' + value + '`');
        
        // For strings that might be concatenated like `Tiep theo: ${...}`
        content = content.split('"' + key).join('"' + value);
        content = content.split('`' + key).join('`' + value);
        content = content.split('>' + key).join('>' + value);
        
        // Let's just do a blanket regex replace that respects word boundaries, 
        // but since they are phrases, split-join is safer if we just do straight split-join
        // Wait, "Them" might match part of "Them tran". Because keys are sorted by length, "Them tran vao danh sach" will be replaced FIRST.
        // Then remaining "Them" will be standalone.
    }
}

// A simpler global replace to catch any I missed due to spacing
for (const key of keys) {
    const value = translations[key];
    content = content.split(key).join(value);
}

if (content !== fs.readFileSync(file, 'utf8')) {
    fs.writeFileSync(file, content, 'utf8');
    console.log("Translated unaccented text");
}
