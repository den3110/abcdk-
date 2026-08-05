# PickleTour — HANDOFF Session (2026-08-05)

> Tài liệu bàn giao giữa các session Claude / dev. Đọc kèm `HANDOVER.md` (bàn
> giao gốc từ đội cũ) để nắm bối cảnh tổng thể.
>
> Session này (tiếp nối 2026-08-04) đã **push git, deploy prod, build AAB
> Android**, và tăng cường 4 feature xã hội (Bảng tin / Nhắn tin / Bạn bè /
> Thông báo) với: infinite scroll, @mention/tag giải, Messenger bubble web,
> notification bell + socket realtime, tournament card đầy đủ info, avatar
> clickable, timestamp tin nhắn, mobile nav FB-style, và fix hàng loạt bug UI.

---

## 1. Trạng thái deployment hiện tại

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `06867eaf` (+ latest git origin) | ✅ Live — MongoDB rs0, Redis, PM2 cluster (`server` id 8+9) trên VPS `103.90.225.130` |
| **Frontend web** (`pickletour.vn`) | commit `06867eaf` | ✅ Live — build bằng `yarn build:deploy` (auto rsync `dist → /var/www/pickletour.vn/`) |
| **Mobile TestFlight iOS** | `1.1.11 (41)` upload ok, `1.1.12` chưa build lại | 🟡 App đã live nhưng nhiều tính năng session này (avatar feed, mention, gắn giải, score badges, tournament card đầy đủ, chat time separator, ...) chỉ chạy sau khi build 1.1.12 Archive lại |
| **Mobile Play Store Android** | AAB `1.1.12 (42)` build ok, upload đã thành công nhưng chưa release được | 🟡 Play Console báo *"Bản khai báo mã nhận dạng cho quảng cáo"* — cần vào Play Console → **Cập nhật biểu mẫu khai báo** → chọn "Không dùng AD_ID" (manifest đã có `tools:node="remove"` cho `AD_ID` — thực tế app không dùng, chỉ khai báo Play Console sai). Xem §3 |

**Git remotes đều đã đồng bộ:**

| Repo | Latest | Push |
|---|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `06867eaf` | ✅ |
| `github.com/den3110/pickletour-app` (mobile) | `912706d` | ✅ |
| `github.com/den3110/abcde` (admin-pickletour) | không đụng session này | — |

**Auth git:** macOS Keychain có sẵn credential; `git push` chạy được luôn, không cần PAT.

---

## 2. Session 2026-08-05 — Những gì đã ship

### 2.1 Deploy & infra

- ✅ **Push tất cả commits local** lên `github.com/den3110/*` (Keychain OK, không cần PAT của `den3110`)
- ✅ **VPS `103.90.225.130`** login bằng mật khẩu **`Hoang@0726`** (KHÔNG phải `Hoang@072026` như HANDOVER cũ ghi)
- ✅ Backend prod trên VPS = code mới nhất (git pull + `pm2 restart server`). Path backend: `/abcdk-/backend/server.js`, cluster 2 worker (id 8+9)
- ✅ Frontend prod: build bằng `yarn build:deploy` (script mới thêm) — build vào `dist/` rồi rsync `/var/www/pickletour.vn/`. Trước đó dev quên rsync nên frontend luôn cũ dù đã pull code
- ✅ **Fix critical**: Nginx cấu hình `proxy_pass http://127.0.0.1:5001/` (có `/`) strip `/api/` prefix. Backend mount `/api/*` → 404 hết. Thêm middleware ở `backend/server.js` (khoảng dòng 237) prepend `/api` cho request không thuộc allowlist (`/uploads`, `/socket.io`, `/admin/agendash`, `/.well-known`, `/favicon`, `/dl`) → 75 routes hoạt động ngay, không cần sửa từng dòng
- ✅ **Docker CI/CD GitHub Actions đã fail 15 lần từ 2026-07-22** (Docker Hub secret expire). Deploy manual qua SSH pull thay pipeline. Muốn fix CI thì regenerate `DOCKERHUB_TOKEN` trong repo secrets

### 2.2 Feed (Bảng tin) — mobile + web

**Backend** (`backend/controllers/feedController.js`):
- ✅ Populate `linkedTournament` thêm `location, startDate, endDate, status, maxPairs`
- ✅ `attachAuthorScores()` — batch aggregate `Ranking.find({user: {$in}})` gắn `author.score = {single, double}` vào post response
- ✅ `attachTournamentRegCounts()` (`backend/utils/enrichTournament.js`) — batch aggregate `Registration.countDocuments` gắn `linkedTournament.registrationCount`
- ✅ `extractMentionsRaw` — parse `@nickname` nhiều từ (max 3 words, VD "Nguyen Van A"), Unicode `\p{L}\p{N}`
- ✅ `createPost` ưu tiên `req.body.mentions` (array of ObjectId đã pick từ UI) — verify tồn tại DB. Fallback về regex parse nếu không truyền. Fix bug tag trùng nickname
- ✅ `reactFeedPost` chưa fix cache trên backend (thay bằng client optimistic)
- ✅ Pagination: `listFeed?cursor&limit` giữ nguyên (backend đã cursor sẵn từ HANDOVER cũ)

**Mobile** (`app/(tabs)/feed.tsx`, `app/feed/post/[id].tsx`):
- ✅ `AuthorAvatar` helper (`components/social/AuthorAvatar.tsx`): render `<Image>` nếu có avatar, fallback letter
- ✅ 4 chỗ avatar dùng `AuthorAvatar` (composer + post header + post detail + comment)
- ✅ `MentionText` (`components/feed/MentionText.tsx`): render `@nickname` xanh clickable → `/profile/:id`
- ✅ Composer @mention autocomplete popup (debounce 250ms + `useLazySearchUserQuery`), pick user → track `selectedMentions` để gửi explicit IDs
- ✅ Composer "Gắn giải" 🏆 button + modal picker (`useLazySearchTournamentsQuery`) + chip vàng preview
- ✅ `ScoreBadges` Đơn (blue) + Đôi (pink) cạnh tên author + trong mention popup
- ✅ Infinite scroll: cursor 10 bài/page, `onEndReached`, `serializeQueryArgs` bỏ cursor + merge dedupe, "Đã xem hết bài viết" footer
- ✅ Reaction fix: `invalidatesTags` + `onQueryStarted` optimistic update trong `slices/feedApiSlice.js`
- ✅ Avatar/tên clickable → `/profile/:id`
- ✅ Video inline (`InlineVideo` component dùng `expo-video`) — không cần bật fullscreen
- ✅ Compress ảnh trước upload (`expo-image-manipulator` resize max 1600px, JPEG q 0.7) + `videoQuality Medium` → ảnh ~300KB thay vì ~5MB, video ~10MB thay vì ~40MB
- ✅ `TourFeedCard`: linkedTournament card hiện `tên + location + date range + regCount/maxPairs`
- ✅ FeedMediaViewer fullscreen: bottom overlay author + comment dùng `AuthorAvatar`

**Web** (`frontend/src/screens/FeedPage.jsx`):
- ✅ Shared components `frontend/src/components/feed/`: `MentionText`, `ScoreBadges`, `MentionAutocomplete`, `TournamentPickerDialog`, `FriendSuggestionsCard`, `TournamentBubbleCard`
- ✅ **Layout 3-column desktop**: grid center feed (max 680px) + right sidebar 320px (`FriendSuggestionsCard`). Responsive xs mobile 1-col
- ✅ Composer: MentionAutocomplete + Trophy button + chip giải + track `selectedMentions`
- ✅ PostCard: MentionText content, ScoreBadges cạnh tên, avatar/tên clickable, `TournamentBubbleCard` variant `feed`
- ✅ Comment: MentionText + author clickable
- ✅ Infinite scroll: IntersectionObserver sentinel + cursor pagination (identical mobile)
- ✅ `feedApiSlice.js` (web) match mobile: `serializeQueryArgs + merge`, reaction optimistic
- ✅ Responsive mobile: outer Box `overflowX: hidden` + `minWidth: 0` cho grid child + tournament card location wrap 2-line ellipsis (không tràn viewport)

### 2.3 Nhắn tin (Chat) — mobile + web

**Backend**:
- ✅ `chatMessageModel.js` thêm fields `mentions: [User]`, `linkedTournament: Tournament`
- ✅ `chatController.sendMessage` accept + populate `mentions` (USER_FIELDS) + `linkedTournament` (7 fields đầy đủ)
- ✅ `attachTournamentRegCounts` cho message list + emit socket
- ✅ Cho phép gửi tin chỉ có tournament (không cần content/attachment)

**Mobile** (`app/messages/[cid].tsx`, `app/messages/index.tsx`):
- ✅ AuthorAvatar cho conversation list + chat bubble sender
- ✅ MentionAutocomplete + Gắn giải trong chat input (identical UX với feed)
- ✅ `TournamentBubbleCard` trong bubble: tên + location + date range + regCount + maxPairs
- ✅ MentionText render content bubble với mention xanh nhạt (mine) / xanh đậm (other)
- ✅ Time separator (center) giữa cluster > 5 phút hoặc sang ngày mới ("Hôm qua HH:mm" / "dd/MM HH:mm")
- ✅ Timestamp nhỏ dưới bubble ở cuối cluster
- ✅ FlatList inverted: `prev = items[index+1]`, `next = items[index-1]`
- ✅ Fix: KeyboardAvoidingView `useHeaderHeight` — input không bị bàn phím che
- ✅ Fix bottom safe area edges

**Web** (`frontend/src/screens/MessagesPage.jsx`):
- ✅ Layout 100dvh full viewport (fit chat input không cần scroll trang)
- ✅ Mobile: khi có `?c=cid` → hide site Header + MobileBottomNav (App.jsx `isMessagesConvView` check) → chat fullscreen
- ✅ Sidebar convo list ẩn trên mobile khi đã chọn convo
- ✅ Chat header có avatar + tên + ChevronLeft back (mobile)
- ✅ Auto-scroll bottom khi có message mới
- ✅ MentionAutocomplete + Gắn giải + linkedTournament card + MentionText (giống mobile)
- ✅ Tooltip hover bubble hiện thời gian đầy đủ
- ✅ Time separator giữa cluster
- ✅ **Enter to send** + IME safety (`e.nativeEvent.isComposing`) + double-submit ref guard + fallback `setTimeout(setText(""), 30)` — tránh gửi 2 lần cùng Vietnamese Telex
- ✅ **Socket realtime**: bỏ hoàn toàn `setInterval(refetch, 4000)`, subscribe `chat:subscribe` + listen `chat:message:new` / `chat:message:deleted`, optimistic patch cache

### 2.4 Messenger-style floating chat widget (web)

- ✅ `MessengerLauncher` (`components/messenger/MessengerLauncher.jsx`): floating bubble 56px góc phải dưới với badge tổng unread. Mount toàn cục ở App.jsx (trừ trang `/messages` và fullscreen layouts). Bấm mở panel 380px liệt kê hội thoại. Socket realtime bump preview + unread
- ✅ `FloatingChatWindow` (340×500): mini popup nổi bên trái panel, multi-window (max 3 desktop), stacked ngang. Header primary color có Maximize (→ /messages?c=xxx) / Minus / Close. Full features chat: mention, gắn giải, Enter to send, time separator, tooltip
- ✅ Mobile (`< 900px`): chọn conv → `navigate('/messages?c=cid')` fullscreen thay floating

### 2.5 Notification Bell

- ✅ **Astryx SiteNav** (`screens/astryx/NotificationBell.jsx`): light-dark inline styles cho Astryx home routes
- ✅ **MUI Header** (`components/NotificationBellMui.jsx`): MUI Popover cho Header chính. Bell 🔔 giữa Theme toggle và Avatar
- ✅ Badge unread realtime (poll 60s + socket `notification:new` optimistic prepend)
- ✅ Dropdown 380px: 8 notif mới nhất, avatar actor, title + body clamp 2 dòng, time relative, chấm xanh unread. Nút "Đánh dấu đã đọc tất cả" + link "Xem tất cả"
- ✅ Bỏ link "Thông báo" khỏi NAV_LINKS ở cả 2 nav (thay bằng bell icon)
- ✅ Fix 404 khi click notification chat: backend gửi URL `/messages/:cid` (mobile-style), web dùng `/messages?c=:cid`. Helper `normalizeNotifUrl` transform trước navigate (áp cả 2 bell + `NotificationsPage`)

### 2.6 Friend Suggestions

- ✅ Backend `GET /api/friends/suggestions?limit=N` (`friendController.listSuggestions`): chấm điểm province match (+50), khoảng cách skill single/double (±0.5). Loại self + edge đã có. Trả kèm `score`
- ✅ Web `FriendSuggestionsCard`: sidebar phải Feed 3-column, sticky top desktop
- ✅ Reusable `frontend/src/components/social/`:
  - `FriendActionButton`: state-aware Kết bạn / Huỷ lời mời / Chấp nhận / Bạn bè
  - `MessageActionButton`: openDm → `/messages?c=xxx`
- ✅ Wire vào `RankingList` mobile card (Nhắn / Kết bạn nút cạnh Hồ sơ / Chấm trình / Xem KYC)
- ✅ PublicProfilePage đã có sẵn `FriendActions + OpenMessageButton` từ HANDOVER cũ

### 2.7 Navigation

- ✅ **Header web** (`components/Header.jsx`) navLinks: **Giải đấu / Điểm trình / Bảng tin** (thêm Bảng tin cho user logged in). Bỏ Nhắn tin (đã có bubble launcher), bỏ Đặt sân
- ✅ **MobileBottomNav** rewrite (`components/MenuMobile.jsx`) theo FB-style giống app mobile:
  - 6 tab: 🏠 Trang chủ / 📰 Bảng tin / 🏆 Giải đấu / 📊 Xếp hạng / 🔔 Thông báo / ⋯ Khác
  - Flat edge-to-edge, gradient accent 2px top (blue→purple→gold→emerald→red)
  - Per-tab accent colors, active pill scale animation
  - Badge unread cho Thông báo (poll 60s)
  - "Khác" mở Bottom Sheet Drawer: Hồ sơ, Giải của tôi, Nhắn tin, Bạn bè, CLB, Live, Hỗ trợ, (admin) Quản trị, Đăng xuất
- ✅ **App.jsx**: `isMessagesConvView` (pathname `/messages` + query `c=xxx`) → hide site Header trên mobile + hide MobileBottomNav + bỏ padding-bottom → chat mobile fullscreen 100dvh

### 2.8 iOS build & TestFlight (còn dở)

- ✅ Build simulator debug OK (đã fix `GoogleService-Info.plist` path trong pbxproj: `Pickletourvn/GoogleService-Info.plist` — đầu tiên tự tạo tay via `ruby xcodeproj` gem)
- ✅ File `GoogleService-Info.plist` thật đã có (từ user gửi qua Telegram, project `call-e7189`, SHA-1 match), thay 2 vị trí: root project + `ios/Pickletourvn/`
- ✅ `Info.plist` + `app.json` bump `1.1.4 → 1.1.11` và version code `36 → 41`, sau đó bump lên `42` khi Play/TestFlight bắt buộc
- ✅ Thêm purpose strings vào `Info.plist` + `app.json.ios.infoPlist`:
  - `NSSpeechRecognitionUsageDescription`
  - `NSLocationWhenInUseUsageDescription`
- ✅ Upload TestFlight thành công build `1.1.11 (41)` (chưa build lại cho 1.1.12)
- ⚠️ **Chưa Archive lại `1.1.12` với các feature session này** — user cần bump `CFBundleVersion` = 42 + `MARKETING_VERSION` = 1.1.12, rồi Archive từ Xcode → Distribute App → TestFlight

### 2.9 Android build & Play Store (còn dở)

- ✅ Build simulator + emulator OK (jebao_arm64)
- ✅ Cài Java 17 (`brew install openjdk@17`) — bắt buộc cho Gradle 8.14 + AGP mới
- ✅ Fix: `chmod +x android/gradlew` (repo push thiếu executable bit)
- ✅ Fix codegen: `pod install` regenerate `States.cpp` cho `safeareacontext / rnskia / rnsvg`. Nếu gặp *"Build input file cannot be found: States.cpp"* → chạy `pod install` trong `ios/`
- ✅ **Signing keystore** — dev cũ (`@giangvippro__pickletour-app.jks` FAIL password, đúng file là **`pickletour-upload-20260322.jks`** password `datistpham`, alias `upload20260322`, SHA-1 `9F:63:53:71:76:1D:37:B8:98:B2:D7:A8:CC:BF:77:F8:B8:D3:34:10` — MATCH Upload key certificate trên Play Console)
- ✅ File keystore copy vào `pickletour-app-mobile/android/app/pickletour-upload.jks` (đã trong `.gitignore` — `*.jks`)
- ✅ Signing config `~/.gradle/gradle.properties`:
  ```
  PICKLETOUR_UPLOAD_STORE_FILE=app/pickletour-upload.jks
  PICKLETOUR_UPLOAD_STORE_PASSWORD=datistpham
  PICKLETOUR_UPLOAD_KEY_ALIAS=upload20260322
  PICKLETOUR_UPLOAD_KEY_PASSWORD=datistpham
  ```
- ✅ **AAB build ok**: `android/app/build/outputs/bundle/release/app-release.aab` (~16 phút với Java 17)
- ✅ Upload AAB `1.1.12 (42)` lên Play Console thành công
- ⚠️ **Chưa release được**: Play Console báo lỗi khai báo AD_ID mismatch. Fix: vào Play Console → *"Tạo bản phát hành chính thức"* → dưới "Lỗi, cảnh báo" bấm **"Cập nhật biểu mẫu khai báo"** → chọn **"Không, ứng dụng của tôi không dùng advertising ID"** (khớp thực tế vì manifest có `tools:node="remove"` cho `AD_ID`). Sau đó proceed release được

---

## 3. Vấn đề đang mở (cần làm session sau)

### 3.1 Priority cao

1. **Play Store deploy** — chỉ còn 1 click: bấm "Cập nhật biểu mẫu khai báo" → "Không" cho AD_ID → tiếp tục release
2. **TestFlight iOS deploy build mới** (`1.1.12 (42)`) — Xcode Archive + Upload. User đã có Xcode workspace mở
3. **Rebuild frontend mỗi lần deploy** — dùng `yarn build:deploy` (đã thêm script) thay `yarn build` để tự động rsync dist → /var/www

### 3.2 Priority thấp (nice-to-have)

- **Web feed post detail page** (`/feed/post/:id`) — hiện `normalizeNotifUrl` fallback về `/feed` cho URL mobile-style, chưa có detail route
- **Web upload compress ảnh browser-side** (canvas resize) — hiện chỉ mobile compress
- **PikoraSurface (chatbot)** — không có `keyboardVerticalOffset`, chưa test có bị keyboard che không
- **Docker CI/CD** — đã fail 15 lần từ 2026-07-22, cần regenerate `DOCKERHUB_TOKEN` secret nếu muốn dùng lại pipeline
- **Fix CI GitHub Actions Docker build**
- **Bell dropdown** — click item chưa mark read chỉ item đó, cần refetch cả list nếu có socket new giữa chừng

---

## 4. Local Dev — Cách chạy nhanh

```bash
# Node 20 qua nvm
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

# MongoDB (thay ~/.local/bin nếu path khác)
mongod --replSet rs0 --dbpath ~/mongodb-data --bind_ip 127.0.0.1 \
  --port 27017 --logpath /tmp/mongod.log --fork

# Redis
cd ~/Desktop/Projects/Pickletour/abcdk && docker compose up -d redis

# Backend (nodemon crash EBADF sau ~10 restart → dùng node trực tiếp)
cd ~/Desktop/Projects/Pickletour/abcdk
node backend/server.js > /tmp/pickletour-dev.log 2>&1 &

# Frontend vite
cd frontend && npm run dev > /tmp/pickletour-frontend.log 2>&1 &

# Admin (port 3001)
cd ~/Desktop/Projects/Pickletour/abcdk/admin-pickletour
BROWSER=none PORT=3001 npm start > /tmp/pickletour-admin.log 2>&1 &

# Mobile Metro (Expo)
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd ~/Desktop/Projects/Pickletour/abcdk/pickletour-app-mobile
yarn start > /tmp/metro.log 2>&1 &

# iOS build (simulator UUID cụ thể — có nhiều "iPhone 17 Pro" trùng tên!)
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
xcodebuild -workspace ios/Pickletourvn.xcworkspace -scheme Pickletourvn \
  -sdk iphonesimulator \
  -destination 'id=80A8B1DB-3A21-4ED7-B852-CE924FD6D578' \
  -configuration Debug -derivedDataPath /tmp/pkt-build \
  -skipMacroValidation build

# Android build AAB release
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
cd android && ./gradlew bundleRelease --no-daemon
# → app-release.aab tại android/app/build/outputs/bundle/release/
```

---

## 5. Prod credentials & Deploy

### VPS SSH (đã verify)

```
Host: 103.90.225.130
User: root
Password: Hoang@0726       ← ĐÚNG (HANDOVER cũ ghi Hoang@072026 là SAI)
```

### Deploy backend (không dùng Docker CI — deploy tay):

```bash
ssh root@103.90.225.130
cd /abcdk-
git pull origin master
pm2 restart server    # id 8+9 cluster
```

### Deploy frontend:

```bash
ssh root@103.90.225.130
cd /abcdk-
git pull origin master
cd frontend && yarn build:deploy   # tự build + rsync sang /var/www/pickletour.vn/
```

⚠️ **KHÔNG chỉ `yarn build`** — build ra dist/ nhưng không rsync sang /var/www → prod vẫn code cũ. Session trước đã bị nhiều lần.

### Play Store keystore

- File: `pickletour-app-mobile/android/app/pickletour-upload.jks` (gitignored)
- Backup nguồn: user's Telegram (`pickletour-upload-20260322.jks`)
- Password: `datistpham`, alias: `upload20260322`
- SHA-1: `9F:63:53:71:76:1D:37:B8:98:B2:D7:A8:CC:BF:77:F8:B8:D3:34:10`
- Signing config: `~/.gradle/gradle.properties` (đã set)
- **Nếu machine mới**: copy jks từ backup + set 4 property vào gradle.properties

### iOS Firebase

- `GoogleService-Info.plist` thật đã có ở `pickletour-app-mobile/GoogleService-Info.plist` + `ios/Pickletourvn/GoogleService-Info.plist`
- Firebase project: `call-e7189`
- Registered trong pbxproj (add tay via ruby xcodeproj gem — nếu prebuild lại cần re-add)

---

## 6. Nginx & Backend routing (quan trọng!)

**Nginx config** `/etc/nginx/sites-enabled/default` — server `pickletour.vn`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:5001/;   # ← có TRAILING SLASH
    ...
}
```

Trailing slash **strip `/api/` prefix** khỏi request trước khi forward. Backend
mount routes ở `/api/*` (VD `app.use("/api/chat", ...)`). Không có prefix
→ 404.

**Fix trong source** (không đụng nginx): `backend/server.js` (khoảng dòng 237)
có middleware prepend `/api` cho request không thuộc allowlist:

```js
const NON_API_PREFIXES = ["/api", "/socket.io", "/uploads", "/upload",
  "/admin/agendash", "/.well-known", "/favicon", "/dl"];
app.use((req, res, next) => {
  if (req.url === "/") return next();
  for (const p of NON_API_PREFIXES) {
    if (req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"))
      return next();
  }
  req.url = "/api" + req.url;
  next();
});
```

Middleware này phải đứng **trước** khối `app.use("/api/xxx", ...)` mount routes.

---

## 7. Test data local vs prod

- **Prod MongoDB** (VPS): `mongodb://admin:abcd1234@4321@127.0.0.1:27017/pickletour?authSource=admin&replicaSet=rs0`
- **Local restore** đã có sẵn từ HANDOVER cũ (261k documents, 97 collections, 2143 users, 62 tournaments)
- Local `.env` root: `MONGO_URI=mongodb://127.0.0.1:27017/pickletour?replicaSet=rs0`
- Local admin dev: `admin@pickletour.local` / `admin123`. Tạo lại: `node scripts/createAdminDev.js admin@pickletour.local admin123`

---

## 8. Cấu trúc thư mục mới (session 2026-08-05 thêm)

```
backend/
├── utils/
│   └── enrichTournament.js       ← attachTournamentRegCounts helper

frontend/src/
├── components/
│   ├── NotificationBellMui.jsx    ← Bell MUI cho Header chính
│   ├── feed/
│   │   ├── MentionText.jsx
│   │   ├── ScoreBadges.jsx
│   │   ├── MentionAutocomplete.jsx
│   │   ├── TournamentPickerDialog.jsx
│   │   ├── FriendSuggestionsCard.jsx
│   │   └── TournamentBubbleCard.jsx
│   ├── messenger/
│   │   ├── MessengerLauncher.jsx  ← floating bubble launcher
│   │   ├── FloatingChatWindow.jsx ← mini chat 340x500
│   │   └── chatTime.js            ← time separator helpers
│   └── social/
│       ├── FriendActionButton.jsx
│       └── MessageActionButton.jsx
└── screens/astryx/
    └── NotificationBell.jsx        ← Bell astryx (light-dark)

pickletour-app-mobile/
├── components/
│   ├── feed/
│   │   └── MentionText.tsx
│   └── social/
│       └── AuthorAvatar.tsx
```

---

## 9. Điểm cần nhớ khi tiếp tục

1. **Backend deploy** phải `git pull` + `pm2 restart server` (2 worker cluster). Đừng quên
2. **Frontend deploy** phải `yarn build:deploy` (script mới) — `yarn build` không đủ vì không rsync sang `/var/www/pickletour.vn/`
3. **Nginx strip `/api/`** — middleware ở `backend/server.js` xử lý. Đừng xoá
4. **Play Store AD_ID mismatch** — vào Play Console update declaration "Không dùng AD_ID"
5. **iOS 3 simulator "iPhone 17 Pro" trùng tên** — dùng `-destination 'id=<UUID>'` (`80A8B1DB-3A21-4ED7-B852-CE924FD6D578` là cái đang gắn panel)
6. **Vietnamese IME + Enter** — luôn check `e.nativeEvent.isComposing` khi handle Enter to submit (đã fix chat, chưa test các form khác)
7. **Socket cookies** — client `withCredentials: true`, backend đọc JWT cookie ở handshake để join `user:<uid>` room. Đừng làm mất cookie
8. **Keystore Android** trong `~/.gradle/gradle.properties` (không phải project) — machine mới cần copy lại
9. **Docker CI/CD** đang gãy từ 2026-07-22 (Docker Hub secret) — không dựa vào, deploy manual
10. **Backend `/messages/:cid` URL** vẫn dùng cho mobile push notification. Web transform qua `normalizeNotifUrl` helper. Đừng đổi backend URL vì mobile expo-router cần format này

---

## 10. Todo priority cho session mới

1. 🔴 **Play Store release** — 1 click "Cập nhật biểu mẫu khai báo" → "Không dùng AD_ID" trong Play Console
2. 🔴 **Xcode Archive iOS 1.1.12 (42)** + Upload TestFlight — user tự bump build number + Product → Archive → Distribute App
3. 🟡 **Fix Docker CI** — regenerate Docker Hub token nếu muốn dùng lại pipeline (thay vì deploy manual)
4. 🟡 **Web feed post detail** `/feed/post/:id` — hiện notification URL chat vào post fallback về `/feed`
5. 🟢 **Web upload compress** browser canvas (giảm bandwidth server)
6. 🟢 **Verify các form khác** có Vietnamese IME + Enter to submit không bị double-fire
