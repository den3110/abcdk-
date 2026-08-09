# PickleTour — HANDOFF Session (2026-08-08 → 2026-08-10)

> Tài liệu bàn giao giữa các session Claude / dev. Đọc kèm `HANDOVER.md` (bàn
> giao gốc từ đội cũ) để nắm kiến trúc tổng thể; đọc file này để biết trạng
> thái mới nhất + landmines + việc còn dở.
>
> Session dài (3 ngày, ~50 commits) chia làm 4 nhóm:
> 1. **Apple 1.2 compliance** — EULA + block/report + ẩn field required
> 2. **Nickname approval workflow** — cooldown + duyệt qua Telegram + admin panel
> 3. **Overlay generator integration** — tạo overlay từ Quản lý giải, admin API key setup, court URLs, Game/Match/Championship Point, ball count cho serve
> 4. **Mobile polish & release** — icon/splash 1.1.13, AAB Android, fix tab stuck, chat cải tiến (fullscreen viewer, upload UX, realtime reconnect, tap avatar, nút Gọi Zalo)

---

## 1. Trạng thái deployment hiện tại

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `07baed33` (2026-08-10 00:01) | ⚠️ **CHƯA deploy** — user cần `ssh + git pull + pm2 restart server`. Prod đang chạy commit `acadfc03` (2 ngày cũ). |
| **Frontend web** (`pickletour.vn`) | commit `07baed33` | ⚠️ **CHƯA build/rsync** sau nhiều commit (overlay dialog, court URLs...) |
| **Admin panel** (`admin.pickletour.vn`) | commit `89c478d` | ⚠️ **CHƯA build/rsync** — mất trang "Duyệt đổi biệt danh" mới + section "Overlay Generator API Key" + input cooldown nickname |
| **Mobile iOS TestFlight** | native `1.1.11 (41)` cũ — CHƯA archive `1.1.13 (43)` | 🟡 Bug native hot-updater 0.25.14 vẫn còn (silent rollback bundle). User đã có Xcode setup xong 1.1.13 (43) — chờ **Archive + Upload** để thoát bug. |
| **Mobile Android Play** | native `1.1.11` (Play cũ) — AAB `1.1.13 (43)` sẵn sàng | 🟡 AAB đã build tại `~/Desktop/Pickletour-1.1.13-43.aab` (160 MB). Chờ user upload Play Console (còn AD_ID declaration cần "No" trong App Content). |
| **OTA hot-updater** (Cloudflare R2+D1) | Latest bundle `Chat: nút Gọi Zalo + Gọi điện` | ✅ Deployed cho cả 4 target `iOS/Android × 1.1.9/1.1.13` production. |
| **Overlay Generator VPS** (`/root/overlay-generator/`) | template + server chưa sync bản mới nhất | ⚠️ Cần `scp overlay-template.html + generator-server.js` lên VPS rồi `systemctl restart overlay-gen`. Bản trên máy có 3 update chưa deploy. |
| **Scoreboard site** (`scoreboard.pickletour.vn`) | live các file HTML overlay đã generate trước | ✅ Live nhưng overlay cũ dùng template cũ (số 1/2 trên tay giao + không có badge Point). Cần regenerate qua UI. |

**Git remotes đồng bộ hết:**

| Repo | Latest commit | Push |
|---|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `07baed33` | ✅ |
| `github.com/den3110/pickletour-app` (mobile) | `2af610f` | ✅ |
| `github.com/den3110/abcde` (admin-pickletour) | `89c478d` | ✅ |

---

## 2. Feature ship trong session

### 2.1 Apple Guideline 1.2 (Aug 8) — User-Generated Content compliance

**Backend** ([24584c8d](https://github.com/den3110/abcdk-/commit/24584c8d)):
- Block user endpoints: `POST/DELETE /api/friends/block/:userId`, `GET /api/friends/blocked`
- Helper `getBlockedIdSet(viewerId)` 2 chiều (block hoặc bị block)
- Filter `listFeed`/`getPost`/`listComments`/`attachRecentComments`/`createComment` loại content của blocked users
- Filter chat: `listConversations`, chặn `openDmConversation` + `sendMessage` với DM blocked
- Notify admin qua Telegram khi user block hoặc report content
- `getStatus` trả kèm `blockedBy` để FE biết ai là người chặn

**Mobile** ([750a19a](https://github.com/den3110/pickletour-app/commit/750a19a)):
- Register EULA: strengthen section 3 "Zero tolerance" + đề cập cơ chế Báo cáo/Chặn
- `UserActionsMenu` (nút 3 chấm) trong public profile + chat DM header
- `app/settings/blocked-users.tsx` — trang list user đã chặn + unblock
- Reason picker 8 lý do cho Feed post/comment (thay Alert.prompt cũ)
- Helper `utils/contentModeration.ts` — `pickReportReason` + `confirmBlock`

**Guideline 5.1.1(v)** (bỏ required field): backend user tự xử lý (per user "đã xử lý phía backend").

### 2.2 Nickname change workflow (Aug 8-9)

**Model:**
- `User.nicknameChangedAt: Date` (rate-limit source)
- `NicknameChangeRequest` model — status pending/approved/rejected/cancelled, unique partial index `{user, status:pending}`
- `SystemSettings.profile.nicknameChangeCooldownDays` (default 60, 0=tắt)

**Flow** ([a049a41c](https://github.com/den3110/abcdk-/commit/a049a41c)):
- User submit → check cooldown → KHÔNG apply luôn, tạo request pending → cooldown chưa consume
- Admin **Duyệt** (Telegram inline button OR admin panel) → apply nickname + set `nicknameChangedAt`
- Admin **Từ chối** → status rejected + reason, user KHÔNG mất lần đổi
- Race guard: unique partial index chặn tạo request thứ 2 pending; approve có recheck dupe

**Telegram bot** ([16fc7efc](https://github.com/den3110/abcdk-/commit/16fc7efc)):
- Gửi cùng `TELEGRAM_CHAT_ID` với KYC, inline button ✅ Duyệt / ❌ Từ chối
- Bot handler `bot.action(/^nick:(approve|reject):OID$/)` gọi service dùng chung

**Admin panel** (`abcde` @ [89c478d](https://github.com/den3110/abcde/commit/89c478d)):
- Trang `/admin/nickname-requests` — list + duyệt/từ chối kèm lý do, filter status
- Sidebar entry "Duyệt đổi biệt danh" ngay dưới "Quản lý người dùng"
- Nút reset cooldown (RestartAltIcon vàng) trong UserListPage — mỗi user
- Section "Overlay Generator API Key" trong /admin/settings (validate + lưu vào VPS .env)
- Section "Hồ sơ người dùng" trong /admin/settings — input cooldown days

**⚠️ Landmine cooldown**:
- **KHÔNG bypass admin nữa** — mọi user (admin/user) đều bị áp cooldown khi tự sửa nickname qua endpoint `/api/users/profile`
- Admin muốn sửa hộ user khác → dùng `PUT /api/admin/users/:id` (updateUserInfo) — endpoint riêng, không áp cooldown

**Script findUnrelatedNicknames** ([44f92c19](https://github.com/den3110/abcdk-/commit/44f92c19)): tìm user có nickname không match tên (4 heuristic: substring/word/initials/Levenshtein).

### 2.3 Overlay Generator integration (Aug 8-10)

**Backend** ([0e5dce61](https://github.com/den3110/abcdk-/commit/0e5dce61)):
- Field `Tournament.overlayUrl` lưu URL scoreboard đã deploy
- `backend/controllers/tournamentOverlayController.js` — 4 endpoint:
  - `GET /api/admin/tournaments/:id/overlay/status` — trả `keySet, currentUrl, defaults (poster+name), courts[]`
  - `POST /overlay/generate` — nếu client không gửi override → fetch `tour.image` base64 → forward `http://127.0.0.1:3131/api/generate`
  - `POST /overlay/deploy` — forward + lưu URL vào `tour.overlayUrl`
  - `DELETE /overlay` — clear
- Admin key setup: `GET /overlay-generator/keystatus`, `POST /overlay-generator/setkey`
- Env `OVERLAY_GENERATOR_URL` default `http://127.0.0.1:3131`
- Timeout 90s cho generate (Claude vision 20-60s)
- Kiểm quyền admin/manager trong controller (`canManage`)

**Court URLs per court** ([46c1d849](https://github.com/den3110/abcdk-/commit/46c1d849), [5f188ca8](https://github.com/den3110/abcdk-/commit/5f188ca8)):
- Query cả `CourtStation` (mô hình mới via `tour.allowedCourtClusterIds`) + `Court` (cũ) → dedup theo `_id`
- Dialog render mỗi sân 1 row: tên sân + `?courtId=<id>` full URL + nút Mở + Copy

**Frontend Dialog** (`OverlayGeneratorDialog.jsx`): 2-column, preview poster (default `tour.image`, upload override), name/category input, nút Tạo → iframe preview scale 0.5, Deploy & lưu, hiển thị URL hiện tại + list link theo từng sân.

**Nút "Tạo overlay"** (AutoFixHighIcon warning) trong action row của TournamentManagePage.jsx (+ MLP landing).

### 2.4 Overlay template polish (Aug 9-10) — TRÊN LOCAL, CHƯA DEPLOY

Location: `/Users/admin/Desktop/Giai Thien truong/generator/`

3 update trong template + prompt:

1. **Ball count cho tay giao** thay số 1/2: `.serve-ball-icon` = flex container 2 SVG, `data-serve="1|2"` bật/tắt ball 2 qua CSS; ball 2 xoay lệch pha -3s cho đẹp.

2. **Point badge** (Game/Match/Championship Point): badge pill nhấp nháy trên đỉnh scoreboard, logic:
   - Game Point: `leader >= maxPoints-1 AND (winByTwo: leader+1 - trailer >= 2, else: leader+1 >= maxPoints)`
   - Match Point: Game Point + `leader.gamesWon + 1 >= ceil(bestOf/2)`
   - Championship: Match Point + `state.isChampionship` (auto-detect từ stageName chứa CHUNG KẾT/FINAL, loại BÁN CHUNG/SEMI/1/2/1/4)
   - **Default `bestOf: 1`** (đa số VN pickleball 1 set → mọi game point = match point)
   - URL param override: `?championship=1`

3. **Prompt Claude bám màu poster đúng** ([generator-server.js buildPrompt](/Users/admin/Desktop/Giai Thien truong/generator/generator-server.js#L57)):
   - Bắt Claude liệt kê 4-5 màu dominant thật (không mặc định neon)
   - `bgDark = darken(dominant #1, 85-90%)` — poster đỏ → bg đỏ đen, tím → tím đen
   - `accent = màu VIVID nhất` (không ép neon, đỏ tươi cũng OK)
   - `gold = màu ẤM nhất` (vàng/cam/hồng đào)
   - Cấm phản xạ "sport = navy blue" khi poster không có xanh dominant

**⚠️ Cần deploy** (chưa làm):
```bash
scp "/Users/admin/Desktop/Giai Thien truong/generator/overlay-template.html" \
  root@103.90.225.130:/root/overlay-generator/overlay-template.html
scp "/Users/admin/Desktop/Giai Thien truong/generator/generator-server.js" \
  root@103.90.225.130:/root/overlay-generator/generator-server.js
ssh root@103.90.225.130 "systemctl restart overlay-gen"
```

Overlay đã deploy cũ vẫn dùng template cũ → cần vào **Quản lý giải → Tạo overlay** cho từng giải regenerate.

### 2.5 Mobile polish & release (Aug 9-10)

**Icon + splash + native config** ([fe8fd05](https://github.com/den3110/pickletour-app/commit/fe8fd05), [dabd5c5](https://github.com/den3110/pickletour-app/commit/dabd5c5)):
- Icon PickleTour (P monogram nền navy 1024×1024) replace ở: iOS `AppIcon.appiconset` (5 folder Xcode), Android `mipmap-*/ic_launcher.webp` (5 density), Expo `assets/images/`
- Splash screen: SplashScreenLogo + splashscreen_logo (5 density) + bg color → `#0a1834` (navy match icon), không còn viền trắng
- Logo wordmark deployed: `/public/logo.png` (web + admin), `assets/images/logo.png` (mobile)

**Bump 1.1.13 (43)** ([955f36b](https://github.com/den3110/pickletour-app/commit/955f36b)):
- app.json version 1.1.11→1.1.13, buildNumber 41→43, versionCode 42→43
- Info.plist (5 folder iOS): CFBundleShortVersion 1.1.13, CFBundleVersion 43
- Xcode pbxproj (5 folder): MARKETING_VERSION 1.1.13, CURRENT_PROJECT_VERSION 43
- Android gradle: versionName 1.1.13, versionCode 43

**AAB build**: `~/Desktop/Pickletour-1.1.13-43.aab` (160 MB, signed CN=Pickletour). Fix JDK 11→17 (Firebase Crashlytics yêu cầu 17) + tạo `android/local.properties` (Android SDK path). Đã build local — chưa upload Play.

**Fix iOS Swift build errors** ([2a5cbcc](https://github.com/den3110/pickletour-app/commit/2a5cbcc), [b9d2151](https://github.com/den3110/pickletour-app/commit/b9d2151)):
- AppDelegate.swift: `import React` → `internal import React` (đồng bộ với RtmpPreviewViewManager + FacebookLiveModule)
- Fix 2 chỗ mất `||` operator (line 25 `#if os(iOS) || os(tvOS)`, line 45 `super.application(...) || RCTLinkingManager.application(...)`)

**Tab stuck khi switch nhanh** ([db14f69](https://github.com/den3110/pickletour-app/commit/db14f69), [16854a7](https://github.com/den3110/pickletour-app/commit/16854a7)):
- Bỏ `detachInactiveScreens` (rapid switch → view stale)
- `lazy: false` — mount hết 6 tab từ đầu → không race giữa mount + switch
- Trade-off: +15MB memory, đổi lại UX mượt

**Feed cải tiến:**
- Auto-expand phản hồi comment ở Chi tiết bài viết ([0103527](https://github.com/den3110/pickletour-app/commit/0103527))
- Upload placeholder Facebook-style: spinner "Đang tải…" ngay khi chọn ảnh/video ([e6c2a37](https://github.com/den3110/pickletour-app/commit/e6c2a37))
- @mention trong bình luận ([eb17b90](https://github.com/den3110/pickletour-app/commit/eb17b90)) + notification "Bạn được nhắc tới" (backend [05cd67c1](https://github.com/den3110/abcdk-/commit/05cd67c1) tách nhóm mention khỏi comment notify)

**Chat cải tiến:**
- Fullscreen viewer ảnh (react-native-image-viewing) + video (Modal + VideoView) ([fd9c8d8](https://github.com/den3110/pickletour-app/commit/fd9c8d8))
- Upload UX giống feed: client check size (ảnh 10MB, video 100MB/4 phút), placeholder spinner, guard submit ([031dba3](https://github.com/den3110/pickletour-app/commit/031dba3))
- Tap avatar bubble / header title → mở `/profile/{uid}` ([031dba3](https://github.com/den3110/pickletour-app/commit/031dba3))
- **Realtime reconnect fix** — root cause: socket mất mạng chớp → reconnect với id mới → BE không còn socket cũ trong room `chat:${cid}` → miss messages. Fix: subscribe lại room mỗi lần `socket.on("connect")`.
- Nút **Gọi Zalo / Gọi điện** ở header DM ([2af610f](https://github.com/den3110/pickletour-app/commit/2af610f)):
  - Menu 2 lựa chọn: `zalo://qr/p/{phone}` (fallback `https://zalo.me/{phone}`) hoặc `tel:{phone}`
  - Backend chatController USER_FIELDS thêm `phone` để populate DM peer
  - Info.plist (5 folder) thêm `LSApplicationQueriesSchemes: [zalo, tel]`

### 2.6 MLP hoàn thiện fix (Aug 6/8)

- **`mlpConfig.cap.points` bug** ([a479b62d](https://github.com/den3110/abcdk-/commit/a479b62d)): `Number(null)===0 && Number.isFinite(0)===true` → ghi points=0 vi phạm `min:1` schema. Fix: khi mode='none' luôn set null.

---

## 3. Bug fix + Landmine phát hiện

### 3.1 OTA hot-updater CLI phải khớp native version

- HANDOFF cũ nói: dùng CLI `0.25.4` (match native cũ).
- **Session này**: yarn.lock đã silent upgrade native `@hot-updater/react-native@0.25.14` từ 09/07 → build TestFlight/Play mới nhất chạy native 0.25.14.
- **CLI 0.25.4 build bundle không tương thích native 0.25.14** → bundle download OK, reload → native detect fingerprint mismatch → auto rollback → user thấy popup nhưng không đổi gì.
- **Fix**: dùng `./node_modules/.bin/hot-updater` (0.25.14 local) thay vì `npx hot-updater@0.25.4`.

### 3.2 app.json version phải match native binary

- Bump `app.json` lên `1.1.13` cho AAB Android build, nhưng native iOS TestFlight vẫn `1.1.11` → bundle OTA có `Constants.expoConfig.version=1.1.13` xung đột với native `CFBundleShortVersion=1.1.11` → HotUpdater rollback silent.
- **Fix**: nếu bump app.json cho platform này thì phải archive lại platform kia cùng lúc. Hoặc revert app.json khớp native đang chạy trên đa số user.

### 3.3 Court model song song

Backend tồn tại 2 loại "sân":
- `Court` (cũ) — link trực tiếp qua `tournament: ObjectId`
- `CourtStation` (mới) — thuộc `CourtCluster`, tournament link qua `allowedCourtClusterIds`

Overlay controller query CẢ 2, dedup theo `_id`. Đừng chỉ query một model — bỏ sót giải mới/cũ.

### 3.4 Metro `blockList` giữ folder `ios copy*`

`metro.config.cjs` block `ios copy*` khỏi bundling. **Đừng xoá blocklist** — Metro sẽ nghẹn.

### 3.5 Splash cache dai trên iOS

iOS cache splash rất dai. Sau khi bump splash image, `Cmd+Shift+K` (Clean Build Folder) chưa đủ — phải **uninstall app** khỏi simulator/thiết bị + rebuild.

### 3.6 Overlay tay giao badge cũ hiển thị số 1/2

Fixed trong template mới nhưng overlay đã deploy trên VPS vẫn dùng bản cũ. User bắt buộc regenerate qua "Tạo overlay" dialog.

### 3.7 UUIDv7 timestamp decode

Bundle id của hot-updater dạng `019fe...` là UUIDv7 (48-bit ms timestamp ở đầu). Có thể decode để verify bundle mới ra chưa:
```python
int(uuid.replace('-','')[:12], 16) / 1000 = unix ms
```

### 3.8 iOS icon/splash bị cache

Không chỉ đổi `assets/images/icon.png` — cần cả `ios/Pickletourvn/Images.xcassets/AppIcon.appiconset/*.png` (native). Đó là source of truth Xcode dùng, KHÔNG phải Expo asset.

### 3.9 Facebook tab bar: `visibleRoutes` filter khớp `state.index`

Custom `FacebookTabBar` computes `originalIndex = state.routes.findIndex(...)` để check `isFocused` — đúng cả khi có hidden routes (`profile`, `chat`, `my_tournament`, `admin` với `href: null`).

### 3.10 Bundle chứa string dạng UTF-16, không phải ASCII

Hermes bytecode lưu string UTF-16. Grep marker phải dùng `.encode('utf-16-le')` không dùng ASCII. Trước có báo giả "code không có trong bundle" vì grep sai encoding.

---

## 4. Việc còn dở

### 4.1 Priority cao — deploy

- 🔴 **Backend prod**: `ssh root@103.90.225.130 "cd /abcdk- && git pull && pm2 restart server"` — cần restart để load: overlay endpoints, nickname approval, chat phone populate, feedNotifier mention split
- 🔴 **Frontend web build+rsync**: `cd frontend && yarn build:deploy` — user cần thấy overlay dialog + court URLs
- 🔴 **Admin panel build+rsync**: `cd /abcde && yarn build && rsync -a --delete build/ /var/www/admin.pickletour.vn/` — cần thấy trang Duyệt đổi biệt danh + Overlay Generator Key
- 🔴 **Overlay generator template**: scp 2 file + `systemctl restart overlay-gen` (ball count + Point badge + prompt bám màu)
- 🔴 **iOS Archive 1.1.13 (43)** trên Xcode + upload TestFlight — thoát bug native module rollback + user thấy toàn bộ feature session này
- 🔴 **Android upload AAB 1.1.13 (43)** vào Play Console — file sẵn ở Desktop; nhớ **App Content → Advertising ID → "No, my app does not use advertising ID"** trước khi rollout

### 4.2 Priority thấp — polish

- 🟡 **Regenerate overlay cho các giải cũ**: overlay đã deploy vẫn dùng template cũ. User vào Quản lý giải → Tạo overlay → Deploy lại từng giải để có badge Point + ball count + màu poster đúng
- 🟡 **iOS: bổ sung `LSApplicationQueriesSchemes` với `zalo, tel`** đã làm trong Info.plist local — cần archive build mới để iOS đọc được. Nếu không, `Linking.canOpenURL("zalo://")` fail → CallButton fallback về browser zalo.me
- 🟡 **Nickname approval mobile UI**: hiện chỉ có backend + admin panel + Telegram. Chưa show user "Yêu cầu đã gửi chờ duyệt" toast rõ ràng ở mobile app khi họ đổi nickname (backend đã trả `nicknamePendingRequest` trong response, mobile chưa hook)
- 🟢 **Nickname change reject qua Telegram**: hiện dùng lý do mặc định "Từ chối qua Telegram bởi @xxx". Nếu cần reason cụ thể → dùng admin panel
- 🟢 **Feed post detail: mention selectedMentions state** — hiện chỉ có `mentionQuery/results/insertMention`, không tracked selectedMentions như feed composer. Backend tự extract từ content nên OK, chỉ là less explicit

### 4.3 Nice-to-have

- **Chat call**: hiện Zalo/tel deep-link. Nếu muốn full VoIP in-app → 3 phương án đã bàn (LiveKit/WebRTC self-host/Zalo deep-link — user chọn phương án 3 Zalo).
- **Live studio**: chưa touch trong session này. Vẫn hoạt động như HANDOVER gốc mô tả.
- **MLP mobile UI**: web + admin có, mobile chưa

---

## 5. Environment cần biết

### 5.1 VPS credentials

```
Host: 103.90.225.130
User: root
Password: Hoang@0726
```

**Warning**: từ máy local hiện tại (Mac dev) chỉ authenticate được bằng key SSH — password auth từ chối. Nếu cần SSH password → chạy từ máy khác hoặc setup public key trước.

### 5.2 Node versions

- **Backend + Frontend + Admin dev**: Node 20 (v20.20.2)
- **Hot-updater CLI + Wrangler**: Node 22 (v22.23.2 qua nvm)
- **Android Gradle build**: JDK 17 (Microsoft OpenJDK 17 hoặc `/opt/homebrew/opt/openjdk@17`)
- **iOS Xcode**: mở workspace `ios/Pickletourvn.xcworkspace`

### 5.3 Android SDK path

`/opt/homebrew/share/android-commandlinetools` (commandlinetools qua brew). `android/local.properties` đã có sẵn nhưng gitignored.

### 5.4 Android signing

`~/.gradle/gradle.properties` chứa 4 biến `PICKLETOUR_UPLOAD_STORE_FILE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD`. Keystore ở `android/app/pickletour-upload.jks`.

**Cert:** `CN=Pickletour, OU=Mobile, O=Pickletour, L=Ho Chi Minh City` — hết hạn 2053.

### 5.5 Overlay generator

- Service systemd `overlay-gen` chạy port `3131` trên VPS
- Source: `/root/overlay-generator/` (SEPARATE PROJECT, không phải abcdk repo)
- ANTHROPIC_API_KEY trong `/root/overlay-generator/.env`
- Template source of truth: `/Users/admin/Desktop/Giai Thien truong/generator/overlay-template.html` (local dev copy)
- Deploy dir output HTML: `/var/www/scoreboard/public/`
- Live URL: `https://scoreboard.pickletour.vn/<file>.html?courtId=xxx`

### 5.6 OTA hot-updater

- Bundle store: Cloudflare R2, DB metadata: Cloudflare D1
- Worker check-update: `https://hot-updater.datistpham.workers.dev/api/check-update`
- Kill switch: `https://pickletour.vn/api/auth/system/ota/allowed` (SystemSettings)
- `.env.hotupdater` (gitignored) chứa 4 biến `HOT_UPDATER_CLOUDFLARE_*`
- **CLI dùng**: `./node_modules/.bin/hot-updater` (0.25.14 khớp native) — KHÔNG dùng npx 0.25.4

---

## 6. Todo priority cho session mới

### Tuần tự deploy:

1. 🔴 **SSH VPS** + git pull backend + `pm2 restart server`
2. 🔴 **Build web** + rsync → `/var/www/pickletour.vn/`
3. 🔴 **Build admin** + rsync → `/var/www/admin.pickletour.vn/`
4. 🔴 **Scp overlay-template.html + generator-server.js** → `/root/overlay-generator/` + `systemctl restart overlay-gen`
5. 🔴 **iOS Archive 1.1.13 (43)** trên Xcode → Distribute → App Store Connect
6. 🔴 **Play Console** upload AAB (fix AD_ID declaration trước)
7. 🟡 **Regenerate overlay** cho các giải đang chạy (via UI "Tạo overlay")
8. 🟡 **Verify tab bar** không stuck nữa, chat realtime OK, nút Gọi hoạt động

### Không cần chạm:

- **Live studio + recording** — không đụng trong session này
- **Radar/Booking/Coach flow** — không đụng
- **News AI pipeline** — không đụng
- **Pikora chatbot** — không đụng

---

## 7. Snapshot commit history session

**Backend `abcdk-`** (session commits): `24584c8d → 07baed33` (~15 commits)

Key commits:
- `24584c8d` block/report Apple 1.2
- `4c9bf1bc` nickname cooldown
- `0e5dce61` overlay integration
- `5061517c` overlay admin key
- `db4bae10` web icon + logo
- `46c1d849` court URLs per court
- `44f92c19` findUnrelatedNicknames script
- `5f188ca8` bypass admin cooldown removed + Court query dual
- `a049a41c` nickname approval workflow
- `16fc7efc` Telegram approve nickname
- `05cd67c1` mention notify tách title
- `07baed33` chat phone populate

**Mobile `pickletour-app`**: `750a19a → 2af610f` (~25 commits)

Key commits:
- `750a19a` block/report + EULA
- `c1bbf2b → dabd5c5` icon + splash + native
- `fe8fd05` native AppIcon + mipmap
- `5d7a6ba` bump 1.1.13 (43)
- `2a5cbcc → b9d2151` Swift import fix
- `db14f69 → 16854a7` tab bar lazy=false
- `e6c2a37` feed uploading
- `0103527` auto-expand replies
- `fd9c8d8` chat fullscreen viewer
- `eb17b90` @mention in comments
- `031dba3` chat upload UX + tap avatar + realtime
- `2af610f` chat call button Zalo/tel

**Admin `abcde`**: `62ad4a8 → 89c478d` (~7 commits)

Key commits:
- `1bc9f94` cooldown input
- `3ba05cd` overlay API key setup
- `365b68b` favicon + logo
- `0bc5582` trang Duyệt đổi biệt danh
- `89c478d` reorder sidebar

---

## 8. Lệnh chuẩn deploy

**Backend + Frontend + Admin cùng lúc** (một lệnh):

```bash
ssh root@103.90.225.130 "\
  cd /abcdk- && git pull origin master && pm2 restart server && \
  cd frontend && yarn build:deploy && \
  cd /abcde && git pull origin master && yarn build && \
  rsync -a --delete build/ /var/www/admin.pickletour.vn/"
```

**Overlay generator** (2 file + restart):

```bash
scp "/Users/admin/Desktop/Giai Thien truong/generator/overlay-template.html" \
    "/Users/admin/Desktop/Giai Thien truong/generator/generator-server.js" \
  root@103.90.225.130:/root/overlay-generator/
ssh root@103.90.225.130 "systemctl restart overlay-gen"
```

**OTA push 4 target** (từ `pickletour-app-mobile/`):

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a
for t in 1.1.9 1.1.13; do
  for p in ios android; do
    rm -rf .hot-updater/output
    ./node_modules/.bin/hot-updater deploy -p $p -t $t -c production -m "message"
  done
done
```

**Android AAB build** (nếu cần build lại):

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd pickletour-app-mobile/android
./gradlew bundleRelease --no-daemon
# Output: app/build/outputs/bundle/release/app-release.aab
```
