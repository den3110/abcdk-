// scripts/seedKnowledge.js
// ✅ MEGA SEED: Toàn bộ FAQ + Guides + Features + Policies
// Chạy: node scripts/seedKnowledge.js

import mongoose from "mongoose";
import dotenv from "dotenv";
import Knowledge from "../models/knowledgeModel.js";

dotenv.config();

const KNOWLEDGE_DATA = [
  // ═══════════════════════════════════════════
  //  📋 FAQ - Đăng ký giải đấu
  // ═══════════════════════════════════════════
  {
    title: "Cách đăng ký giải đấu",
    category: "faq",
    keywords: [
      "đăng ký",
      "tham gia",
      "register",
      "giải đấu",
      "ghi danh",
      "đăng kí",
    ],
    content: `Để đăng ký giải đấu trên PickleTour:
1. Mở app → vào trang Giải đấu
2. Chọn giải muốn tham gia
3. Nhấn nút "Đăng ký"
4. Nếu đánh đôi, mời đồng đội qua số điện thoại
5. Thanh toán lệ phí (nếu có)
6. Chờ BTC duyệt đơn
7. Nếu có vấn đề gì có thể khiếu nại qua nút khiếu nại
Lưu ý: Một số giải yêu cầu xác thực KYC trước khi đăng ký.`,
  },
  {
    title: "Lệ phí đăng ký giải",
    category: "faq",
    keywords: [
      "lệ phí",
      "phí đăng ký",
      "giá",
      "chi phí",
      "bao nhiêu tiền",
      "tiền đăng ký",
    ],
    content: `Lệ phí đăng ký tùy thuộc vào từng giải đấu, thường từ 100k-1tr/người. Bạn có thể xem chi tiết lệ phí trong trang thông tin giải. Một số giải miễn phí hoàn toàn! Phương thức thanh toán: chuyển khoản ngân hàng hoặc thanh toán trực tiếp theo hướng dẫn của BTC.`,
  },
  {
    title: "Hạn đăng ký giải đấu",
    category: "faq",
    keywords: [
      "hạn đăng ký",
      "deadline",
      "đăng ký đến khi nào",
      "còn đăng ký được không",
      "hết hạn",
    ],
    content: `Mỗi giải có deadline đăng ký khác nhau, thường là 1-3 ngày trước khi giải bắt đầu. Bạn xem trong trang chi tiết giải sẽ có thông tin cụ thể. Nên đăng ký sớm vì nhiều giải hay hết slot nhanh lắm!`,
  },
  {
    title: "Hủy đăng ký giải đấu",
    category: "faq",
    keywords: [
      "hủy đăng ký",
      "rút đơn",
      "không tham gia được",
      "cancel",
      "bỏ giải",
    ],
    content: `Để hủy đăng ký, vào mục 'Đơn đăng ký của tôi', chọn đơn cần hủy và nhấn 'Hủy đăng ký'. Lưu ý: việc hủy có thể ảnh hưởng đến điểm uy tín của bạn, và lệ phí có thể không được hoàn lại tùy chính sách từng giải. Hủy trước 48h thường không bị phạt uy tín.`,
  },
  {
    title: "Mời đồng đội đánh đôi",
    category: "faq",
    keywords: [
      "mời đồng đội",
      "đăng ký đôi",
      "partner",
      "bạn đôi",
      "cặp đôi",
      "đánh đôi",
    ],
    content: `Khi đăng ký nội dung đánh đôi:
1. Chọn giải và nội dung đánh đôi
2. Nhập số điện thoại đồng đội
3. Đồng đội sẽ nhận thông báo mời
4. Đồng đội xác nhận từ app
5. Hoàn tất thanh toán
Lưu ý: Đồng đội cũng phải có tài khoản PickleTour và đã xác thực KYC nếu giải yêu cầu.`,
  },

  // ═══════════════════════════════════════════
  //  ⭐ FAQ - Rating & Điểm số
  // ═══════════════════════════════════════════
  {
    title: "Rating là gì",
    category: "faq",
    keywords: ["rating", "điểm", "xếp hạng", "hệ số", "điểm số", "trình độ"],
    content: `Rating là điểm đánh giá trình độ VĐV, từ 2.0 (mới chơi) đến 5.0+ (chuyên nghiệp). Hệ thống:
- Mỗi VĐV có 2 rating: đánh đơn (singles) và đánh đôi (doubles)
- Rating thay đổi sau mỗi trận đấu chính thức
- Thắng đối thủ mạnh hơn → tăng nhiều rating
- Thua đối thủ yếu hơn → giảm nhiều rating
- Rating dùng để xếp hạng, phân nhóm thi đấu, và xếp hạng toàn quốc
- Hệ thống rating tương tự Elo trong cờ vua`,
  },
  {
    title: "Cách xem điểm rating",
    category: "faq",
    keywords: [
      "xem điểm",
      "điểm của tôi",
      "rating của mình",
      "tra cứu điểm",
      "check rating",
    ],
    content: `Có 3 cách xem điểm rating:
1. Vào trang cá nhân (Profile) - hiển thị rating đơn và đôi
2. Hỏi bot "Điểm của tôi là bao nhiêu?" hoặc "Thông tin của tôi"
3. Vào Bảng xếp hạng để so sánh với VĐV khác
Bạn cũng có thể xem lịch sử thay đổi rating để biết rating tăng/giảm qua từng giải.`,
  },
  {
    title: "Cách tăng rating",
    category: "faq",
    keywords: [
      "tăng điểm",
      "lên rating",
      "cải thiện điểm",
      "nâng điểm",
      "nâng rating",
    ],
    content: `Để tăng rating:
- Tham gia nhiều giải đấu
- Thắng đối thủ có rating cao hơn hoặc tương đương
- Thắng đối thủ rating cao hơn = tăng NHIỀU điểm
- Thua đối thủ rating thấp = giảm NHIỀU điểm
- Giữ tỉ lệ thắng ổn định qua nhiều trận
Mẹo: Tham gia giải có đối thủ mạnh hơn mình 0.5-1.0 rating để tăng nhanh nhất.`,
  },
  {
    title: "Rating bị giảm",
    category: "faq",
    keywords: [
      "giảm rating",
      "mất điểm",
      "bị trừ điểm",
      "rating giảm",
      "sao bị giảm",
    ],
    content: `Rating giảm khi thua trận, đặc biệt thua đối thủ có rating thấp hơn mình. Mức giảm tùy thuộc:
- Chênh lệch rating: thua người yếu hơn → giảm nhiều
- Số trận đã đấu: VĐV mới tăng/giảm nhanh hơn
- Hệ số reliability: đấu càng nhiều thì rating càng ổn định
Đừng lo, cứ tiếp tục thi đấu và thắng thì rating sẽ tăng lại!`,
  },

  // ═══════════════════════════════════════════
  //  🔐 FAQ - KYC & Xác thực
  // ═══════════════════════════════════════════
  {
    title: "KYC / Xác thực danh tính là gì",
    category: "faq",
    keywords: ["kyc", "xác thực", "cccd", "căn cước", "danh tính", "cmnd"],
    content: `KYC (Know Your Customer) là quy trình xác thực danh tính trên PickleTour:
- Mục đích: Đảm bảo danh tính thật của VĐV, chống gian lận rating
- Một số giải yêu cầu xác thực KYC mới được đăng ký
Cách xác thực:
1. Vào Profile > Xác thực danh tính (hoặc nói "Mở KYC")
2. Chụp/upload ảnh mặt trước CCCD
3. Chụp/upload ảnh mặt sau CCCD
4. Chờ hệ thống duyệt (thường trong 24h)
Thông tin CCCD được bảo mật tuyệt đối, chỉ dùng cho xác thực.`,
  },
  {
    title: "KYC bị từ chối",
    category: "faq",
    keywords: [
      "kyc từ chối",
      "xác thực thất bại",
      "cccd không duyệt",
      "bị từ chối kyc",
    ],
    content: `KYC có thể bị từ chối nếu:
- Ảnh CCCD bị mờ, thiếu sáng
- CCCD hết hạn
- Thông tin không khớp với tài khoản (tên, ngày sinh)
- Ảnh bị che mất phần thông tin
Giải pháp: Chụp lại ảnh rõ ràng, đủ sáng, không bị che và gửi lại. Nếu vẫn bị từ chối, liên hệ support@pickletour.com`,
  },

  // ═══════════════════════════════════════════
  //  🏆 FAQ - Giải đấu
  // ═══════════════════════════════════════════
  {
    title: "Cách tìm giải đấu",
    category: "faq",
    keywords: [
      "tìm giải",
      "giải nào",
      "giải sắp tới",
      "giải gần đây",
      "danh sách giải",
    ],
    content: `Để tìm giải đấu:
1. Mở app → vào trang "Danh sách giải" (hoặc nói "Mở trang giải")
2. Lọc theo khu vực, thời gian, trình độ
3. Xem chi tiết giải: thông tin, lệ phí, hạn đăng ký
Bạn cũng có thể hỏi bot "Có giải nào sắp tới không?" hoặc "Tìm giải ở Hà Nội"`,
  },
  {
    title: "Cách xem bảng đấu / bracket",
    category: "faq",
    keywords: ["bảng đấu", "bracket", "sơ đồ", "nhánh đấu", "vòng đấu"],
    content: `Để xem bảng đấu:
1. Vào trang giải > chọn nội dung thi đấu
2. Nhấn "Xem sơ đồ" hoặc tab "Bracket"
3. Sơ đồ hiện sau khi BTC bốc thăm xếp cặp
Bạn có thể nói "Mở sơ đồ đấu" để bot dẫn bạn đến. Sơ đồ hỗ trợ cả vòng bảng và vòng loại trực tiếp.`,
  },
  {
    title: "Cách xem lịch thi đấu",
    category: "faq",
    keywords: [
      "lịch",
      "lịch đấu",
      "lịch thi đấu",
      "schedule",
      "khi nào đấu",
      "giờ đấu",
    ],
    content: `Để xem lịch thi đấu:
1. Vào giải đấu cụ thể > tab "Lịch thi đấu"
2. Lịch hiển thị theo ngày, theo sân, hoặc theo bảng
3. Khi có trận, app gửi thông báo trước 15-30 phút
4. Nhớ bật thông báo để không bỏ lỡ!
Bạn cũng có thể xem lịch đấu theo sân để biết sân nào đang trống.`,
  },
  {
    title: "Cách xem kết quả trận đấu",
    category: "faq",
    keywords: [
      "kết quả",
      "xem kết quả",
      "tỉ số",
      "ai thắng",
      "score",
      "thắng thua",
    ],
    content: `Xem kết quả trận đấu:
1. Vào giải đấu > tab "Kết quả" hoặc sơ đồ đấu
2. Kết quả cập nhật realtime ngay khi trận kết thúc
3. Hỏi bot "Kết quả trận này" (nếu đang xem trận)
Bạn cũng có thể xem Live Score trong lúc trận đang diễn ra.`,
  },

  // ═══════════════════════════════════════════
  //  👤 FAQ - Tài khoản
  // ═══════════════════════════════════════════
  {
    title: "Cách sửa thông tin tài khoản",
    category: "faq",
    keywords: [
      "sửa thông tin",
      "đổi tên",
      "cập nhật profile",
      "chỉnh sửa tài khoản",
      "edit profile",
    ],
    content: `Sửa thông tin tài khoản:
1. Vào Profile > nhấn nút Chỉnh sửa
2. Cập nhật: tên, ảnh đại diện, nickname, tỉnh/thành
3. Nhấn Lưu
Lưu ý: Một số thông tin sau khi xác thực KYC sẽ không đổi được (tên, ngày sinh).`,
  },
  {
    title: "Quên mật khẩu / Đổi mật khẩu",
    category: "faq",
    keywords: [
      "đổi mật khẩu",
      "quên mật khẩu",
      "reset password",
      "mật khẩu",
      "forgot password",
    ],
    content: `Đổi mật khẩu: Vào Cài đặt > Đổi mật khẩu
Quên mật khẩu:
1. Ở màn hình đăng nhập, nhấn "Quên mật khẩu"
2. Nhập email hoặc SĐT đã đăng ký
3. Nhận mã OTP qua email/SMS
4. Nhập mã OTP và đặt mật khẩu mới
Nếu không nhận được mã, kiểm tra thư mục spam hoặc liên hệ support.`,
  },
  {
    title: "Đăng ký tài khoản mới",
    category: "faq",
    keywords: [
      "đăng ký tài khoản",
      "tạo tài khoản",
      "sign up",
      "register account",
      "mở tài khoản",
    ],
    content: `Đăng ký tài khoản PickleTour:
1. Tải app PickleTour từ App Store hoặc Google Play
2. Mở app > nhấn "Đăng ký"
3. Nhập SĐT hoặc email
4. Xác thực OTP
5. Điền thông tin cá nhân (tên, ngày sinh, tỉnh)
6. Hoàn tất!
Bạn cũng có thể đăng nhập bằng Google hoặc Apple ID.`,
  },
  {
    title: "Đăng nhập bằng Google / Apple",
    category: "faq",
    keywords: [
      "đăng nhập google",
      "login google",
      "apple id",
      "oauth",
      "đăng nhập mạng xã hội",
    ],
    content: `PickleTour hỗ trợ đăng nhập bằng:
- Google Account
- Apple ID
Cách đăng nhập: Ở màn hình đăng nhập, nhấn nút Google hoặc Apple, xác nhận tài khoản. Lần đầu đăng nhập sẽ tạo tài khoản mới tự động.`,
  },

  // ═══════════════════════════════════════════
  //  📱 FAQ - Sử dụng app chung
  // ═══════════════════════════════════════════
  {
    title: "PickleTour là gì",
    category: "faq",
    keywords: ["pickletour", "app", "ứng dụng", "là gì", "giới thiệu"],
    content: `PickleTour là ứng dụng quản lý giải đấu Pickleball hàng đầu Việt Nam 🏓
Tính năng chính:
- Đăng ký giải đấu trực tuyến
- Theo dõi trực tiếp trận đấu (Live Score)
- Xem bảng xếp hạng VĐV toàn quốc
- Quản lý rating cá nhân
- Nhận thông báo về giải đấu
- Tìm kiếm VĐV và CLB
- Livestream trận đấu lên Facebook
- Quản lý sân đấu
- Hệ thống check-in bằng QR code`,
  },
  {
    title: "Pickleball là gì",
    category: "faq",
    keywords: ["pickleball", "môn", "thể thao", "luật chơi", "cách chơi"],
    content: `Pickleball là môn thể thao kết hợp giữa tennis, cầu lông và bóng bàn 🏓
- Chơi trên sân nhỏ hơn tennis
- Dùng vợt gỗ/composite và bóng nhựa có lỗ
- Luật đơn giản, dễ học
- Phù hợp mọi lứa tuổi
- Đang rất hot tại Việt Nam
- Có thể đánh đơn hoặc đánh đôi
Muốn thử? Tìm CLB pickleball gần nhà trên PickleTour!`,
  },
  {
    title: "Tải app PickleTour ở đâu",
    category: "faq",
    keywords: [
      "tải app",
      "download",
      "cài đặt",
      "app store",
      "google play",
      "link tải",
    ],
    content: `Tải app PickleTour:
- iOS: Tìm "PickleTour" trên App Store
- Android: Tìm "PickleTour" trên Google Play
- Hoặc quét QR code trên website pickletour.com
App miễn phí, cập nhật thường xuyên!`,
  },
  {
    title: "App bị lỗi / không hoạt động",
    category: "faq",
    keywords: [
      "lỗi app",
      "bug",
      "không mở được",
      "crash",
      "bị lỗi",
      "giật lag",
    ],
    content: `Nếu app bị lỗi:
1. Thử tắt và mở lại app
2. Kiểm tra kết nối internet
3. Cập nhật app lên phiên bản mới nhất
4. Xóa cache app trong Cài đặt điện thoại
5. Nếu vẫn lỗi, liên hệ support@pickletour.com kèm ảnh chụp màn hình
Mẹo: Bật "Cập nhật tự động" để luôn dùng bản mới nhất.`,
  },

  // ═══════════════════════════════════════════
  //  📖 GUIDES - Hướng dẫn chi tiết
  // ═══════════════════════════════════════════
  {
    title: "Hướng dẫn thanh toán lệ phí",
    category: "guide",
    keywords: ["thanh toán", "chuyển khoản", "payment", "trả tiền", "nộp tiền"],
    content: `Sau khi đăng ký giải, thanh toán theo hướng dẫn:
1. Chọn phương thức: Chuyển khoản hoặc thanh toán trực tiếp
2. Nếu chuyển khoản: chuyển đúng số tiền + nội dung theo hướng dẫn
3. Hệ thống tự động xác nhận (hoặc BTC xác nhận thủ công)
4. Sau khi thanh toán thành công, trạng thái đơn chuyển sang "Đã thanh toán"
Lưu ý: Chuyển khoản đúng nội dung để hệ thống nhận diện tự động!`,
  },
  {
    title: "Hướng dẫn check-in giải đấu",
    category: "guide",
    keywords: ["checkin", "check-in", "điểm danh", "quét mã", "qr code", "qr"],
    content: `Check-in tại giải đấu:
1. Đến địa điểm thi đấu
2. Mở app PickleTour
3. Vào giải đấu đã đăng ký
4. Nhấn nút "Check-in" hoặc quét mã QR tại quầy BTC
5. BTC xác nhận check-in
Lưu ý: Hãy check-in trước giờ thi đấu ít nhất 30 phút để tránh bị loại. Nếu không check-in đúng giờ, có thể bị xử thua mặc định.`,
  },
  {
    title: "Hướng dẫn tìm kiếm VĐV",
    category: "guide",
    keywords: ["tìm", "tìm kiếm", "search", "vđv", "người chơi", "tìm người"],
    content: `Tìm kiếm VĐV trên PickleTour:
1. Vào Bảng xếp hạng hoặc trang Tìm kiếm
2. Nhập tên hoặc nickname
3. Kết quả hiển thị: tên, nickname, rating, tỉnh/thành
Hoặc hỏi bot: "Tìm VĐV tên Nguyễn Văn A"
Lưu ý: Thông tin cá nhân (SĐT, email) không được hiển thị vì lý do bảo mật.`,
  },
  {
    title: "Hướng dẫn livestream trận đấu",
    category: "guide",
    keywords: [
      "livestream",
      "live",
      "phát trực tiếp",
      "facebook live",
      "stream",
      "phát sóng",
    ],
    content: `Livestream trận đấu lên Facebook:
1. Trọng tài vào trận đấu đang làm trọng tài
2. Nhấn nút "Phát trực tiếp"
3. Chọn trang Facebook để phát
4. Xác nhận và bắt đầu phát
Tính năng:
- Phát live tỉ số realtime
- Overlay hiển thị tên VĐV, tỉ số
- Tự động kết thúc khi trận xong
Người xem có thể xem live trên cả app PickleTour và Facebook.`,
  },
  {
    title: "Hướng dẫn xem Live Score",
    category: "guide",
    keywords: [
      "live score",
      "tỉ số trực tiếp",
      "xem trực tiếp",
      "realtime",
      "tỉ số live",
    ],
    content: `Xem Live Score trận đấu:
1. Vào giải đấu > chọn trận đang diễn ra
2. Tỉ số cập nhật realtime
3. Xem chi tiết: điểm từng set, ai đang phát bóng
4. Nhận thông báo khi trận kết thúc
Trọng tài cập nhật tỉ số qua app, tỉ số đồng bộ ngay lập tức đến tất cả người xem.`,
  },
  {
    title: "Hướng dẫn sử dụng sân đấu",
    category: "guide",
    keywords: ["sân", "court", "sân đấu", "đặt sân", "quản lý sân"],
    content: `Hệ thống sân đấu trên PickleTour (dành cho BTC):
- Tạo và quản lý danh sách sân
- Gán trận đấu vào sân
- Theo dõi trạng thái sân: đang đấu, trống, nghỉ
- Xem lịch sân theo ngày
VĐV có thể xem sân mình sẽ đấu trong lịch thi đấu.`,
  },
  {
    title: "Hướng dẫn xem head-to-head",
    category: "guide",
    keywords: ["head to head", "h2h", "đối đầu", "lịch sử đối đầu", "so kèo"],
    content: `Xem lịch sử đối đầu giữa 2 VĐV:
1. Vào profile VĐV
2. Chọn "Lịch sử đối đầu" hoặc "Head-to-Head"
3. Xem kết quả các trận gặp nhau trước đó
Hoặc hỏi bot: "Lịch sử đối đầu giữa A và B"
Thông tin bao gồm: số trận, thắng/thua, giải đấu, thời gian.`,
  },

  // ═══════════════════════════════════════════
  //  🌟 FEATURES - Tính năng app
  // ═══════════════════════════════════════════
  {
    title: "Tính năng Live Score",
    category: "feature",
    keywords: [
      "live",
      "live score",
      "trực tiếp",
      "tỉ số trực tiếp",
      "điểm trực tiếp",
    ],
    content: `Tính năng Live Score cho phép theo dõi tỉ số trận đấu theo thời gian thực:
- Xem tỉ số hiện tại của từng set
- Biết ai đang phát bóng
- Xem lịch sử điểm từng game
- Nhận thông báo khi trận kết thúc
- Xem trên cả app và Facebook livestream
Trọng tài cập nhật tỉ số qua app, đồng bộ ngay lập tức.`,
  },
  {
    title: "Tính năng Câu lạc bộ (CLB)",
    category: "feature",
    keywords: ["clb", "câu lạc bộ", "club", "nhóm", "đội", "team"],
    content: `PickleTour cho phép tạo và quản lý CLB Pickleball:
- Tạo CLB mới, đặt tên, mô tả, logo
- Mời thành viên tham gia
- Quản lý danh sách thành viên
- Xem thống kê hoạt động CLB
- Đăng ký giải đấu theo CLB
Nói "Mở CLB" để xem danh sách câu lạc bộ.`,
  },
  {
    title: "Tính năng Bảng xếp hạng",
    category: "feature",
    keywords: [
      "bảng xếp hạng",
      "leaderboard",
      "ranking",
      "top vđv",
      "xếp hạng",
    ],
    content: `Bảng xếp hạng PickleTour:
- Xếp hạng VĐV toàn quốc theo rating
- Chia theo: đánh đơn và đánh đôi
- Lọc theo tỉnh/thành
- Cập nhật sau mỗi giải đấu
- Xem lịch sử rating thay đổi
Nói "Mở bảng xếp hạng" hoặc hỏi "Top 10 VĐV" để xem.`,
  },
  {
    title: "Tính năng Thông báo",
    category: "feature",
    keywords: ["thông báo", "notification", "push", "nhắc nhở", "alerts"],
    content: `Hệ thống thông báo PickleTour:
- Thông báo trận đấu sắp bắt đầu (15-30 phút trước)
- Thông báo kết quả trận đấu
- Thông báo giải đấu mới mở đăng ký
- Thông báo thanh toán, KYC
- Thông báo từ BTC giải
Bật thông báo trong Cài đặt để không bỏ lỡ thông tin quan trọng!`,
  },
  {
    title: "Tính năng Overlay trận đấu",
    category: "feature",
    keywords: ["overlay", "màn hình trận đấu", "scoreboard", "display"],
    content: `Tính năng Overlay cho phép hiển thị tỉ số trên màn hình lớn:
- Dùng cho sự kiện có màn hình LED/projector
- Hiển thị tên VĐV, tỉ số, set
- Cập nhật realtime
- Tùy chỉnh giao diện
- Hỗ trợ sponsor logo
BTC truy cập link overlay riêng để hiển thị trên màn hình sự kiện.`,
  },
  {
    title: "Tính năng Trọng tài (Referee)",
    category: "feature",
    keywords: ["trọng tài", "referee", "ghi điểm", "judge", "scoring"],
    content: `Tính năng Trọng tài trên PickleTour:
- Ghi điểm trận đấu realtime
- Quản lý break time
- Phát live Facebook
- Xử lý walkover/forfeit
- Lưu log điểm chi tiết
BTC gán trọng tài cho từng sân hoặc từng trận. Trọng tài dùng app để ghi điểm trực tiếp.`,
  },
  {
    title: "Tính năng Assessment (Đánh giá trình độ)",
    category: "feature",
    keywords: ["assessment", "đánh giá", "chấm điểm", "trình độ", "evaluate"],
    content: `Hệ thống Assessment cho phép đánh giá trình độ VĐV:
- Người đánh giá (assessor) chấm điểm kỹ năng VĐV
- Điểm đánh giá ảnh hưởng đến rating ban đầu
- Chia theo: đánh đơn và đánh đôi
- Có thể xem lịch sử đánh giá
Hỏi bot: "Xem lịch sử đánh giá của tôi" để tra cứu.`,
  },
  {
    title: "Tính năng Điểm uy tín (Reputation)",
    category: "feature",
    keywords: ["uy tín", "reputation", "điểm uy tín", "tín nhiệm"],
    content: `Hệ thống điểm uy tín PickleTour:
- Mỗi VĐV có điểm uy tín
- Tăng khi: check-in đúng giờ, hoàn thành giải, feedback tốt
- Giảm khi: hủy đăng ký sát giờ, vắng mặt không báo, bị report
- Uy tín cao → ưu tiên đăng ký giải
- Uy tín thấp → có thể bị hạn chế đăng ký`,
  },

  // ═══════════════════════════════════════════
  //  🏟️ FEATURES - Dành cho BTC
  // ═══════════════════════════════════════════
  {
    title: "Tổ chức giải đấu (dành cho BTC)",
    category: "feature",
    keywords: ["tổ chức giải", "tạo giải", "btc", "ban tổ chức", "organizer"],
    content: `BTC có thể tổ chức giải trên PickleTour:
1. Tạo giải đấu: đặt tên, thời gian, địa điểm, lệ phí
2. Tạo các nội dung thi đấu (đơn nam, đôi nữ, hỗn hợp...)
3. Mở đăng ký và quản lý đơn
4. Bốc thăm / xếp cặp
5. Quản lý sân đấu
6. Gán trọng tài
7. Theo dõi kết quả realtime
8. Thu phí và quản lý thanh toán
9. Gửi thông báo cho VĐV`,
  },
  {
    title: "Bốc thăm / Draw giải đấu",
    category: "feature",
    keywords: ["bốc thăm", "draw", "xếp cặp", "seeding", "bốc thăm xếp cặp"],
    content: `Hệ thống bốc thăm trên PickleTour (dành cho BTC):
- Bốc thăm tự động dựa trên rating
- Hỗ trợ seeding cho VĐV hạt giống
- Xem trước sơ đồ trước khi xác nhận
- Hỗ trợ vòng bảng và loại trực tiếp
- BTC có thể điều chỉnh tay nếu cần
- Tự động tạo trận đấu sau khi bốc thăm`,
  },

  // ═══════════════════════════════════════════
  //  📜 POLICIES - Chính sách
  // ═══════════════════════════════════════════
  {
    title: "Chính sách bảo mật thông tin cá nhân",
    category: "policy",
    keywords: ["bảo mật", "privacy", "thông tin cá nhân", "riêng tư", "data"],
    content: `Chính sách bảo mật PickleTour:
- SĐT và email chỉ hiển thị cho chính chủ tài khoản
- CCCD chỉ dùng cho xác thực KYC, không chia sẻ cho bên thứ 3
- Thông tin công khai: tên, nickname, rating, tỉnh, giới tính
- Dữ liệu được mã hóa trong quá trình truyền tải
- Người dùng có quyền yêu cầu xóa dữ liệu
- Bot AI không bao giờ tiết lộ thông tin cá nhân của người khác`,
  },
  {
    title: "Quy định khiếu nại giải đấu",
    category: "policy",
    keywords: ["khiếu nại", "complaint", "kiện", "tranh chấp", "report"],
    content: `Quy trình khiếu nại:
1. Vào giải đấu > nhấn nút "Khiếu nại"
2. Mô tả vấn đề chi tiết, kèm ảnh/video nếu có
3. BTC sẽ xem xét và phản hồi trong 24-48h
4. Nếu không hài lòng, liên hệ admin PickleTour
Lưu ý: Khiếu nại phải được gửi trong vòng 24h sau trận đấu. Các vấn đề phổ biến: tỉ số sai, vi phạm luật, hành vi xấu.`,
  },
  {
    title: "Quy định walkover / bỏ cuộc",
    category: "policy",
    keywords: ["walkover", "bỏ cuộc", "forfeit", "xử thua", "vắng mặt"],
    content: `Quy định walkover (xử thua):
- VĐV không có mặt sau 15 phút kể từ giờ thi đấu → xử thua
- Bỏ cuộc giữa trận → đối thủ thắng tự động
- Walkover ảnh hưởng đến: rating (trừ ít hơn thua bình thường) và uy tín (trừ điểm uy tín)
- BTC có quyền quyết định walkover
- VĐV bị walkover vẫn bị ảnh hưởng rating`,
  },

  // ═══════════════════════════════════════════
  //  📞 FAQ - Hỗ trợ
  // ═══════════════════════════════════════════
  {
    title: "Cách liên hệ hỗ trợ",
    category: "faq",
    keywords: [
      "liên hệ",
      "hỗ trợ",
      "hotline",
      "support",
      "báo lỗi",
      "email support",
    ],
    content: `Liên hệ hỗ trợ PickleTour:
• Fanpage: facebook.com/pickletour
• Email: support@pickletour.com
• Trong app: Chat với bot hoặc gửi phản hồi từ Cài đặt
Thời gian phản hồi: thường trong 24h ngày làm việc.`,
  },
  {
    title: "Bot có thể làm gì",
    category: "faq",
    keywords: [
      "bot làm gì",
      "chức năng bot",
      "giúp được gì",
      "capabilities",
      "help",
    ],
    content: `Bot PickleTour có thể giúp bạn:
🏆 Tìm và xem thông tin giải đấu
📝 Hướng dẫn đăng ký tham gia giải
📅 Xem lịch thi đấu, sơ đồ bảng đấu
⭐ Tra cứu điểm rating
🔍 Tìm kiếm VĐV, so sánh thông số
📊 Xem kết quả trận đấu, bảng xếp hạng
🧭 Điều hướng đến các màn hình trong app
❓ Trả lời FAQ về app
💬 Chat thông thường
Hỏi mình bất cứ gì về PickleTour nhé!`,
  },

  // ═══════════════════════════════════════════
  //  🏸 FAQ - Luật và thuật ngữ
  // ═══════════════════════════════════════════
  {
    title: "Các thuật ngữ trong pickleball",
    category: "faq",
    keywords: ["thuật ngữ", "từ vựng", "glossary", "kitchen", "dink", "volley"],
    content: `Thuật ngữ phổ biến trong Pickleball:
- Kitchen (Non-Volley Zone): Vùng cấm smash gần lưới
- Dink: Đánh bóng nhẹ qua lưới vào kitchen đối phương
- Volley: Đánh bóng trước khi chạm đất
- Rally: Chuỗi đánh qua lại
- Side-out: Quyền phát bóng chuyển sang đối phương
- Fault: Lỗi (mất điểm)
- Drop shot: Đánh bóng rơi sát lưới
- Serve: Phát bóng (phải đánh underhand)`,
  },
  {
    title: "Luật thi đấu pickleball cơ bản",
    category: "faq",
    keywords: ["luật", "rule", "quy tắc", "cách tính điểm", "scoring rules"],
    content: `Luật cơ bản Pickleball trên PickleTour:
- Đánh đến 11 điểm (hoặc 15/21 tùy giải), hơn 2 điểm
- Chỉ bên phát bóng mới ghi điểm
- Quy tắc 2 lần nảy (Two-bounce rule): sau phát bóng, mỗi bên phải để bóng nảy 1 lần trước khi đánh volley
- Không được smash trong Kitchen (vùng 7 feet gần lưới)
- Phát bóng phải underhand, dưới thắt lưng
- Đánh đôi: 2 cầu thủ mỗi bên, phát bóng luân phiên`,
  },
  {
    title: "Format thi đấu trên PickleTour",
    category: "faq",
    keywords: [
      "format",
      "thể thức",
      "round robin",
      "single elimination",
      "vòng bảng",
      "loại trực tiếp",
    ],
    content: `Các format thi đấu trên PickleTour:
- Single Elimination: Loại trực tiếp (thua 1 trận là bị loại)
- Double Elimination: Loại trực tiếp nhánh thắng/thua
- Round Robin: Vòng tròn (gặp tất cả đối thủ trong bảng)
- Group Stage + Knockout: Vòng bảng rồi loại trực tiếp
BTC chọn format phù hợp khi tạo giải.`,
  },
];

async function seed() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error("❌ MONGO_URI not set in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");

    // Clear old data
    const deleted = await Knowledge.deleteMany({});
    console.log(`🗑️  Deleted ${deleted.deletedCount} old knowledge items`);

    // Insert new
    const result = await Knowledge.insertMany(KNOWLEDGE_DATA);
    console.log(`✅ Seeded ${result.length} knowledge items`);

    // Summary by category
    const summary = {};
    for (const item of KNOWLEDGE_DATA) {
      summary[item.category] = (summary[item.category] || 0) + 1;
    }
    console.log("📊 Breakdown:", summary);

    // Verify text index
    const indexes = await Knowledge.collection.indexes();
    const hasTextIndex = indexes.some((i) =>
      Object.values(i.key || {}).includes("text"),
    );
    console.log(
      `📑 Text index: ${hasTextIndex ? "✅ OK" : "⚠️ Will be created on first query"}`,
    );

    await mongoose.disconnect();
    console.log("✅ Done!");
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
}

seed();
