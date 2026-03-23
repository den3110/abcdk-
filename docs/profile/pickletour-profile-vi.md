# Hồ Sơ Giới Thiệu Nền Tảng PickleTour

**Mục đích sử dụng:** Tài liệu giới thiệu sản phẩm và năng lực để kẹp báo cáo lãnh đạo bên truyền thông.  
**Phiên bản tài liệu:** 23/03/2026  
**Lưu ý phát hành:** Các trường đặt trong dấu `[Điền: ...]` cần được cập nhật trước khi xuất bản bản Word/PDF chính thức.

## 1. Tóm tắt điều hành

PickleTour là nền tảng số phục vụ quản lý và vận hành giải Pickleball tại Việt Nam. Hệ sinh thái hiện có website công khai tại `pickletour.vn`, ứng dụng di động cho người dùng, cùng khu vực quản trị phục vụ điều hành nội dung, giải đấu và vận hành hệ thống.

Nền tảng được xây dựng theo hướng kết nối nhiều vai trò trong cùng một luồng dữ liệu, gồm vận động viên, câu lạc bộ, ban tổ chức, trọng tài và bộ phận vận hành. Trọng tâm của PickleTour là chuẩn hóa quy trình từ đăng ký tham gia, tổ chức thi đấu, cập nhật kết quả, theo dõi trực tiếp cho tới chăm sóc cộng đồng và hỗ trợ người dùng.

Đối với nhu cầu truyền thông, PickleTour không chỉ là một ứng dụng đăng ký giải mà còn là lớp hạ tầng số giúp đồng bộ thông tin thi đấu, hỗ trợ cập nhật diễn biến trận đấu, tổ chức nội dung trực tiếp và tạo đầu mối kết nối cộng đồng Pickleball trên môi trường số.

## 2. Điểm nhấn nhanh

- **Một nền tảng, nhiều vai trò sử dụng:** cùng lúc phục vụ người chơi, câu lạc bộ, ban tổ chức, trọng tài và bộ phận hỗ trợ vận hành.
- **Dữ liệu thi đấu được cập nhật tập trung:** từ đăng ký, lịch thi đấu, bracket, kết quả đến live score và thông báo.
- **Phù hợp cho truyền thông sự kiện thể thao:** hỗ trợ hiển thị kết quả trực tiếp, livestream, nội dung cộng đồng và các điểm chạm số trước, trong và sau giải đấu.

**Chỉ số hệ thống đã xác minh nội bộ:** `352` tài khoản người dùng, `30` giải đấu, `1.502` lượt đăng ký, `320` trận hoàn tất, `665` lượt đăng ký đã ghi nhận thanh toán.  
**Thời điểm chốt số liệu:** 12:03 ngày 23/03/2026 (ICT), truy vấn trực tiếp từ cơ sở dữ liệu hệ thống.

**Visual chính đề xuất khi dàn trang:** ảnh màn hình trang giải đấu hoặc trang tổng quan giải trên PickleTour, ưu tiên giao diện có đầy đủ tên giải, lịch, bracket hoặc khối thông tin vận hành.

## 3. Giới thiệu nền tảng

PickleTour được định vị là nền tảng số chuyên cho hệ sinh thái Pickleball. Trên lớp sản phẩm hiện tại, hệ thống đã thể hiện các cấu phần chính sau:

- Website công khai với tên miền `https://pickletour.vn`.
- Ứng dụng di động PickleTour trên iOS và Android, có cấu hình app linking/deep linking cho tên miền PickleTour.
- Khu vực quản trị phục vụ vận hành nội dung, cấu hình liên hệ, quản lý giải đấu và quản trị dữ liệu liên quan.
- Hệ thống hỗ trợ song ngữ Việt/Anh ở lớp giao diện công khai.
- Bộ trang chính sách gồm Cookies, Quyền riêng tư và Điều khoản sử dụng.
- Kênh hỗ trợ công khai qua email `support@pickletour.vn` và các cấu phần hỗ trợ vận hành nội bộ.

Việc sở hữu đồng thời web public, mobile app và admin giúp PickleTour có khả năng triển khai theo mô hình tập trung: một nguồn dữ liệu, nhiều đầu ra hiển thị và nhiều nhóm người dùng cùng khai thác.

## 4. Bài toán và giá trị mang lại

Thực tế vận hành giải Pickleball thường gặp các điểm nghẽn như đăng ký phân tán, lịch thi đấu thay đổi khó đồng bộ, thông tin trận đấu thiếu cập nhật tức thời, khó kiểm soát minh bạch dữ liệu và thiếu đầu mối số thống nhất cho truyền thông sự kiện. PickleTour được phát triển để xử lý các bài toán này trên cùng một nền tảng.

| Nhóm sử dụng | Giá trị chính |
| --- | --- |
| Vận động viên | Theo dõi thông tin giải, đăng ký tham gia, xem lịch thi đấu, kết quả, bảng xếp hạng và thông báo liên quan. |
| Câu lạc bộ | Tạo cộng đồng, quản lý thành viên, kết nối hoạt động và hiện diện số trong hệ sinh thái Pickleball. |
| Ban tổ chức | Tập trung quy trình tạo giải, quản lý đăng ký, điều hành lịch, phân sân, quản lý trọng tài và theo dõi kết quả. |
| Trọng tài | Cập nhật điểm số trận đấu theo thời gian thực và hỗ trợ các thao tác điều hành trận. |
| Truyền thông/sự kiện | Có nguồn dữ liệu tập trung để hiển thị live score, nội dung trực tiếp, bracket, overlay và các điểm chạm số của giải. |

Giá trị cốt lõi của PickleTour nằm ở việc giảm thao tác rời rạc giữa nhiều nhóm người dùng, đồng thời tăng tính minh bạch và khả năng truyền dẫn thông tin trong suốt vòng đời giải đấu.

## 5. Năng lực cốt lõi của sản phẩm

### 5.1. Quản lý giải đấu và đăng ký tham gia

- Tạo và quản lý giải đấu, nội dung thi đấu, lịch thi đấu và các màn hình chi tiết theo từng giải.
- Hỗ trợ đăng ký tham gia theo vai trò người chơi, theo dõi đơn đăng ký và các trạng thái liên quan.
- Hỗ trợ sơ đồ thi đấu/bracket, lịch thi đấu, check-in và các trang quản lý giải.

### 5.2. Điều hành trận đấu và cập nhật kết quả

- Theo dõi trận đấu theo thời gian thực, cập nhật kết quả và trạng thái thi đấu.
- Hỗ trợ vai trò trọng tài với luồng ghi điểm trực tiếp.
- Có các thành phần hiển thị score overlay phục vụ màn hình sự kiện hoặc lớp hiển thị bổ sung.

### 5.3. Live score và nội dung trực tiếp

- Hỗ trợ cập nhật live score đồng bộ trên các điểm chạm số.
- Có cấu phần liên quan đến livestream và kết nối Facebook trong các luồng phù hợp.
- Hỗ trợ phát trực tiếp và video recording trong phạm vi các tính năng đang được cấu hình cho hệ thống.

### 5.4. Cộng đồng, câu lạc bộ và bảng xếp hạng

- Có khu vực câu lạc bộ với dữ liệu công khai và thống kê thành viên.
- Có bảng xếp hạng/ranking và các lớp dữ liệu phục vụ theo dõi trình độ, kết quả thi đấu và hồ sơ người chơi.
- Có khu vực tin tức/nội dung công khai phục vụ truyền thông cộng đồng.

### 5.5. Định danh, thông báo và hỗ trợ người dùng

- Hỗ trợ KYC/xác thực danh tính bằng CCCD, gồm luồng ảnh giấy tờ và hỗ trợ quét QR để tự điền dữ liệu trong các trường hợp phù hợp.
- Có hệ thống thông báo trên mobile và các luồng event nội bộ.
- Có email hỗ trợ công khai, màn hình liên hệ và cấu phần ticket/support ở lớp vận hành.

## 6. Mức độ sẵn sàng triển khai

Từ góc nhìn triển khai và phối hợp truyền thông, PickleTour đã thể hiện mức độ sẵn sàng ở các lớp sau:

- **Hạ tầng sản phẩm:** có web public, mobile app và admin, phù hợp cho mô hình vận hành tập trung.
- **Điểm chạm công khai:** có trang chủ, trang giải đấu, nội dung tin tức, hồ sơ công khai và các màn hình live liên quan.
- **Điểm chạm pháp lý và minh bạch:** đã có các trang Cookies, Quyền riêng tư và Điều khoản sử dụng trong giao diện công khai.
- **Điểm chạm hỗ trợ:** đã có email hỗ trợ `support@pickletour.vn`, trang liên hệ và cấu phần hỗ trợ nội bộ.
- **Điểm chạm mobile:** ứng dụng có cấu hình iOS/Android, deep link/app link với tên miền PickleTour, thông báo đẩy, analytics và crash reporting.
- **Điểm chạm vận hành số liệu:** hệ thống đã có cơ chế tổng hợp số liệu công khai theo nhóm người dùng, giải đấu, trận đấu và câu lạc bộ.

Mức độ sẵn sàng này cho thấy PickleTour phù hợp để đóng vai trò nền tảng vận hành số cho giải đấu, đồng thời tạo lớp thông tin có thể phục vụ truyền thông và phối hợp nội dung trong quá trình tổ chức sự kiện.

## 7. Pháp nhân và liên hệ

### 7.1. Thông tin chủ thể

| Hạng mục | Thông tin |
| --- | --- |
| Tên thương hiệu sản phẩm | PickleTour |
| Tên pháp nhân/chủ quản | [Điền: Tên pháp nhân/chủ quản] |
| Mã số thuế | [Điền: MST] |
| Người đại diện | [Điền: Họ tên, chức danh] |
| Địa chỉ trụ sở | [Điền: Địa chỉ pháp nhân] |
| Hotline | [Điền: Hotline chính thức] |
| Email hỗ trợ | support@pickletour.vn |
| Email hợp tác/đối ngoại | [Điền: Email hợp tác chính thức] |
| Website | https://pickletour.vn |
| App Store | [Điền: Link App Store chính thức] |
| Google Play | [Điền: Link Google Play chính thức] |
| Fanpage/Kênh truyền thông chính thức | [Điền: Link fanpage hoặc kênh chính thức] |

### 7.2. Chỉ số vận hành và quy mô

| Chỉ số | Giá trị công bố |
| --- | --- |
| Số người dùng đã đăng ký | 352 tài khoản |
| Số giải đấu đã/đang vận hành | 30 giải đấu |
| Số trận đấu đã hoàn tất | 320 trận |
| Lượt đăng ký tham gia giải | 1.502 lượt đăng ký |
| Lượt đăng ký đã ghi nhận thanh toán | 665 lượt |
| Số câu lạc bộ công khai trên nền tảng | 1 CLB public tại thời điểm truy vấn |
| Số câu lạc bộ đang có dữ liệu trên hệ thống | 2 CLB |
| Lượt tải ứng dụng | [Điền: Số liệu store nếu công bố đối ngoại] |
| Mốc truyền thông nổi bật | [Điền: Bài báo, đối tác, chương trình, sự kiện] |

**Nguồn số liệu:** Truy vấn nội bộ từ hệ thống PickleTour vào 12:03 ngày 23/03/2026 (ICT).  
**Nguyên tắc sử dụng:** Chỉ các số liệu nêu trên đã được xác minh từ hệ thống; các chỉ số khác chưa đủ căn cứ công bố tiếp tục giữ placeholder.

## 8. Gợi ý visual khi dàn trang PDF

1. **Visual 1:** ảnh chụp trang chủ public của PickleTour tại `https://pickletour.vn/`.
2. **Visual 2:** ảnh chụp trang danh sách giải đấu tại `https://pickletour.vn/pickle-ball/tournaments`.
3. **Visual 3:** ảnh chụp trang bảng xếp hạng hoặc câu lạc bộ tại `https://pickletour.vn/pickle-ball/rankings` và `https://pickletour.vn/clubs`.

Các visual đã được chụp trực tiếp ngày 23/03/2026 và lưu tại thư mục `docs/profile/visuals`. Không sử dụng ảnh chụp đoạn chat làm visual chính của profile. Nếu cần đưa bối cảnh triển khai thực tế, nên dùng ở phụ lục hoặc chú thích ngắn, không đặt ở trang mở đầu.

## 9. Kết luận

PickleTour là một nền tảng số có cấu trúc tương đối đầy đủ cho bài toán vận hành giải Pickleball, quản lý cộng đồng và hỗ trợ truyền thông sự kiện. Điểm mạnh của sản phẩm nằm ở khả năng gom nhiều vai trò vận hành vào cùng một hệ thống, qua đó tăng tính thống nhất của dữ liệu và cải thiện khả năng phối hợp trước, trong và sau giải đấu.

Với hiện trạng sản phẩm đang có, PickleTour phù hợp để được xem xét như một giải pháp công nghệ hỗ trợ tổ chức, hiển thị và truyền dẫn thông tin cho hệ sinh thái Pickleball. Để phát hành bản hồ sơ chính thức ra ngoài, bước tiếp theo là hoàn thiện khối pháp nhân, link cửa hàng ứng dụng, số liệu vận hành và các minh chứng đối tác/truyền thông theo checklist đi kèm.
