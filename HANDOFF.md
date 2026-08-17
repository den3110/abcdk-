# PickleTour — HANDOFF Session (2026-08-13 → 2026-08-17)

> Session ~5 ngày, **20 commits root + 7 commits mobile**. 8 chủ đề lớn:
>
> 1. **Sơ đồ bracket v4 modern** (web + mobile) — KO đối xứng + Round Elim, palette accent theo vòng, gradient card + connector bezier, avatar deterministic color, live glow, champion float trophy. Gate `?ui=v4` + chip toggle.
> 2. **Fix Poker side-pot bug + Sâm A-low straight** — bug NGHIÊM TRỌNG: all-in không bằng nhau bị mất hết chip. Fix `refundUncalledBet` + `buildSidePots` + rewrite showdown. Sâm giờ đánh được sảnh `A-2-3-4-5`.
> 3. **Fix Poker chip UI mobile** — chip stack tách khỏi Seat container, không đè hole cards/tên.
> 4. **Fix manager permission regression** — populate `managers.user`/`createdBy` object → FE stringify fail. Fix 3 file web + 3 file mobile + backend hygiene. Bonus fix 403 khi duyệt waitlist (route lift + realtime cache tags).
> 5. **Feature: chuyển cặp chính thức → waitlist** — nút "Chờ duyệt" web + mobile, backend demote logic.
> 6. **SEO overhaul** — canonical dynamic + JSON-LD SportsEvent + sitemap dynamic (63 tournaments + 14 clubs được index) + prerender puppeteer cho crawler (nginx UA map + rewrite).
> 7. **Toggle displayMode tên VĐV** — biệt danh vs họ và tên trên trang manage.
> 8. **Manager tự tạo bracket + manual pool + Blueprint AI (5 phase)** — mở quyền 15 endpoint bracket/plan/insert-slot cho manager, section "Vòng đấu" trong Cài đặt trang manage, dialog chia bảng thủ công, dialog Blueprint AI 3-step Stepper.
>
> Đọc kèm `HANDOVER.md` §0 mục "Session 2026-08-13→17" để nắm state hiện tại.

---

## 1. Trạng thái deployment

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `ffbf6532` | ✅ Đã `pm2 restart server` (cluster id 6/7) sau commit cuối. Chromium deps đã cài (`libnss3` + libs) cho prerender. |
| **Frontend web** (`pickletour.vn`) | ~`ffbf6532` | ✅ `yarn build:deploy` xong. Bundle mới có bracket v4, BracketsPanel, BlueprintDialog. Guides `/guides/mlp.html` + `.pdf` public. |
| **Mobile iOS OTA production** | Bundle 1.1.13 (nhiều push) | ✅ Đã push nhiều lần trong session (bracket v4, fix poker UI, manager permission, waitlist demote, displayMode toggle). CHƯA push bundle 1.1.14 vì version 1.1.14 chưa lên store. |
| **Mobile Android build local** | 1.1.14 build 44 native | ✅ Build `pickletour-1.1.14.{apk,aab}` (115MB + 160MB) tại `~/Desktop/pickletour-android/`. **CHƯA upload Play Console** — user tự upload. |
| **Mobile iOS build 1.1.14** | Chưa build | ⏸ User cần tự Archive qua Xcode UI từ `ios/Pickletourvn.xcworkspace` (Pods sẵn). Version đã bump. |
| **Admin panel** (Vercel) | không đổi | — |
| **Nginx** | Updated | ✅ Thêm `/etc/nginx/conf.d/prerender-bot.conf` (UA map) + patch vhost pickletour.vn: `location /prerender/`, `location ^~ /guides/`, static file locations, bot rewrite trong `location /`. Backup tại `default.bak-*`. |
| **SEO Guides live** | HTML + PDF | ✅ `pickletour.vn/guides/mlp.html` (31KB) + `mlp.pdf` (820KB). Cache 1h. |

**Git remotes:**

| Repo | Latest commit |
|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `ffbf6532` |
| `github.com/den3110/pickletour-app` (mobile) | `f97d284` |
| `github.com/den3110/abcde` (admin) | không đổi |

---

## 2. OTA target policy

Vẫn theo memory `ota_targets.md` (session trước override):

- **Build tăng dần trong session** → chỉ push `ios 1.1.13` mỗi commit tính năng
- **Khi user báo "xong hết" / "final"** → push cả 4 target: iOS 1.1.13 + 1.1.9, Android 1.1.13 + 1.1.9

**Session này** đã push ios 1.1.13 nhiều lần. Chưa push Android OTA (theo policy: chờ user báo final).

**Sau khi 1.1.14 live store** (Android Play + iOS App Store):
- Cập nhật memory `ota_targets.md` sang mục tiêu `1.1.14`
- OTA policy: song song 1-2 tuần push cả `1.1.13` (user chưa update store) + `1.1.14` (mới), sau đó chỉ giữ 1.1.14

---

## 3. Feature ship trong session

### 3.1 Sơ đồ bracket v4 modern (web + mobile)

**Commits root:** `6aa08fcc → 95e9f1ef → 2c8bcd83` (visual upgrade)
**Commits mobile:** `1d5e7f5`

**Web** (`frontend/src/screens/PickleBall/`):
- `ModernKnockoutBracket.jsx` (mới, 900+ dòng) — linear L→R layout, SVG connectors bezier gradient, `ModernSeedCard` với header gradient theo accent, VS divider, LivePulseDot animated, ChampionBadge float trophy, `ModernRoundChip` gradient filled với icon trophy/medal
- `ModernRoundElimBracket.jsx` (mới, 350 dòng) — absolute cards positioned theo `buildLayout` (mirror `buildRoundElimManualLayout`), connectors solid gradient winner + dashed cam loser, legend chú thích
- `TournamentBracket.jsx`: `normalizeBracketUiVersion` accept `v4`/`modern`, `isBracketV4` gate, chip toggle "✨ Bản mới" trong Stack chips ở top KO + RE blocks, conditional render
- **Palette accent**: KO đếm ngược từ Chung kết (`gold` #f59e0b) → BK (`rose`) → TK (`violet`) → xanh dần. RE palette xuôi blue→violet→rose→amber
- **Avatar color deterministic**: hash tên → 10 màu vibrant, ring nhẹ

**Mobile** (`pickletour-app-mobile/components/bracket/`):
- `ModernBracketShared.tsx` (mới) — palette + humanizer + ModernSeedCard + ModernRoundChip + ModernBracketToggle. Dùng LinearGradient + Animated (RN)
- `ModernKnockoutBracketRN.tsx` (mới) — react-native-svg connectors + ScrollView horizontal
- `ModernRoundElimBracketRN.tsx` (mới) — absolute cards + gradient/dashed connectors + legend
- `app/tournament/[id]/bracket.tsx`: gate `bracketUiVersion` state + AsyncStorage `pickletour:tournament-bracket:uiVersion`, chip toggle, conditional render

**Label human-readable** (post-process, KHÔNG đụng resolveSideLabel gốc):
- `W-V1-T16` → `Chờ thắng T16·V1` (+ tooltip "Đội thắng Trận 16 - Vòng 1")
- `L-V2-T3` → `Chờ thua T3·V2`
- `V1-B1-T2` → `Hạng 2 Bảng 1`
- `BYE` → `Miễn đấu` (chip italic xám)

### 3.2 Fix Poker side-pot + Sâm A-low straight

**Commit:** `04c95084` (backend), `1697a81` (mobile UI)

**Poker bug NGHIÊM TRỌNG** (`backend/services/pokerEngine.js`):
- Trước: `room.pot` gộp mọi commit; `showdown` trao **trọn pot** cho winner → user 4000 all-in vs opp 1000 all-in mà thua → user mất HẾT 4000. Ngược lại: user 1000 all-in thắng đối thủ 4000 → user nhận 5000, đối thủ mất hết.
- Fix: thêm `refundUncalledBet(room)` (refund phần overbet của người đóng góp cao nhất khi không ai match tới) + `buildSidePots(room)` (tách side pots theo tier contribution, eligibleSeatIdxs = không fold + contrib ≥ tier)
- Rewrite `showdown` + `finishHandUncontested`: refund trước, sau đó chia từng pot cho winner ELIGIBLE
- Test sanity: user 4k vs opp 1k, user thua → user còn 3000, opp có 2000 ✓

**Sâm A-low straight** (`backend/services/samEngine.js`):
- Trước: `comboType` guard `!ranks.includes("2")` → chặn mọi sảnh chứa 2, kể cả A-2-3-4-5
- Fix: thêm nhánh detect A-low khi `ranks.includes("A") && ranks.includes("2")`, dùng mapping riêng `A=0, 2=1, 3=2, ..., K=12` để check consecutive. Length 3-9. Length 10 vẫn để "dragon" thường
- `compareCombos`: sảnh A-low LUÔN nhỏ hơn sảnh thường (return -1); 2 A-low so bằng lá cao nhất không tính A/2

**Poker chip UI mobile** (`app/poker/[id].tsx`):
- Trước: chip stack render bên trong `Seat` container với `top: 44 + betOffset.dy` → hero (bottom, dy<0) chip đè hole cards; non-hero corner đè plate name/chips
- Fix: bỏ prop `betOffset` khỏi Seat, remove `<View style={styles.betDisplay}>` khỏi Seat. Component `BetChipStack` mới render ĐỘC LẬP absolute ở table level, position computed từ seat center + đẩy ra hướng tâm bàn đủ xa (max của pushX/Y) để nằm NGOÀI seat bounding box

### 3.3 Fix manager permission regression (web + mobile)

**Root cause:** Commit session trước (`28c774b7`) populate `managers.user` + `createdBy` thành object User đầy đủ ở `getTournamentById`. FE stringify raw ObjectId cũ → `String(populatedUserObject) === "[object Object]"` → so sánh luôn `false` → managers bị coi non-manager → RTK query bị `skip: true`, nút Sửa/Xoá/Đánh dấu đã thu ẩn.

**Commits:** `dc1af4c8`, `4f6d136` (mobile), `82d42aa0`, `39a15dee`, `0e4d363b`, `cfc8abd` (mobile), `39e7aeab`

**Fix pattern** ở tất cả file:
```js
const uid = m?.user?._id ?? m?.user ?? m?._id ?? m;
const createdById = tour.createdBy?._id ?? tour.createdBy;
return String(uid) === String(me._id);
```

Files sửa:
- **Web**: `TournamentManagePage.jsx:1387`, `TournamentRegistration.jsx:1595`, `TournamentOverviewPage.jsx:631`
- **Mobile**: `app/tournament/[id]/home.tsx:179`, `manage.tsx:1780`, `register.tsx:1544`
- **Backend hygiene**: `tournamentController.js:3169` — `_managerUserIds` dùng `r.user?._id ?? r.user`
- **`TournamentConsoleShell.tsx`** dùng helper `sid()` đã handle populated → KHÔNG cần fix

**Bonus fix 403 "insufficient role" khi manager duyệt waitlist:**
- Route `/api/admin/tournaments/registrations/:regId/*` bị `authorize("admin")` chặn
- Fix bằng 2 bước:
  1. Thêm helper `attachTournamentFromRegistration` + mở rộng `requireTournamentManager` đọc thêm `req.params.id / tourId / tid`
  2. **DỜI 6 route registration lên TRƯỚC `router.use(protect, authorize("admin"))` line 452** — express match first-declared
- Endpoint: PUT `/payment`, `/checkin`, GET `/history`, PATCH/DELETE `/registrations/:regId`, GET/POST `/tournaments/:id/registrations`

**Bonus fix realtime cache:**
- `getRegistrations` query thiếu `providesTags` → mutation invalidate không match → phải F5
- Fix: `providesTags: [{Registrations, tourId}, {Registrations, LIST}]` + `managerSetRegStatus` invalidate `[LIST, regId]`
- Apply cả web + mobile slice

### 3.4 Feature: chuyển cặp chính thức → waitlist

**Commits:** `8d8d9ba4` (BE + web), `8dc9fd0` (mobile), `39e7aeab` (fix prop drop)

**Backend** (`adminRegistrationController.js:344-365`):
- Thêm `"waitlisted"` vào `demote` logic (trước chỉ `rejected/withdrawn`)
- Khi `approved → waitlisted`: giảm `tour.registered`, clear `approvedBy/approvedAt`, chạy `autoPromoteRegistrationFromWaitlist`

**Web** (`TournamentRegistration.jsx`):
- Handler `handleDemoteToWaitlist` với `window.confirm` mô tả hậu quả
- `ActionButtonsInner`: nút mới icon `WaitlistIcon` (hourglass) màu amber `#b45309`, label "Chờ duyệt"
- **Bug prop drop**: `ActionButtons` memo wrapper destructure explicit — thiếu `onDemoteToWaitlist` khiến prop bị drop. Fix commit riêng `39e7aeab`

**Mobile** (`app/tournament/[id]/register.tsx`):
- Handler với `Alert.alert` confirm (destructive style)
- Nút icon `hourglass-outline` màu cam trong RegItem, chỉ hiện khi `canManage`
- `busy.demotingId` để disable trong lúc call

### 3.5 SEO overhaul

**Commits:** `425db7ab`, `4cd5bc76`, `cf0acab6`, `40011a47`, `0eac7162`, `9f156991`

**Phase A — HTML tĩnh:**
- `index.html`: bỏ `maximum-scale=1, user-scalable=no` → thêm `viewport-fit=cover`. Bỏ hreflang `en` trỏ trùng URL. Bỏ hardcoded canonical + og:title/desc/image/url + twitter:* để Helmet control dynamic (giữ og:type/site_name/locale + twitter:card static)
- `robots.txt`: fix double `/api/api/seo-news/sitemap.xml`, thêm Disallow auth pages
- `SEOHead.jsx`: bỏ hreflang `en` giả trong dynamic head

**Phase B — Canonical dynamic + JSON-LD SportsEvent:**
- `TournamentDetailPage.jsx` (Astryx v3): thêm `ogImage` từ tour.image/coverUrl, `path` `/tournament/:id`, `ogType="event"`, JSON-LD SportsEvent với sport/startDate/endDate/location/geo/organizer/eventStatus
- `TournamentOverviewPage.jsx` (v1): sửa prop `image` → `ogImage` (Helmet ignore), `@type` Event → SportsEvent, canonical `/tournament/:id` thay vì `/overview`, eventStatus map theo tour.status

**Phase C — Sitemap dynamic:**
- `backend/controllers/sitemapController.js` (mới): 3 endpoint
  - `GET /api/sitemap/index.xml` — sitemap-index
  - `GET /api/sitemap/tournaments.xml` — mọi giải `isTest=false`, sort mới nhất, 5000 URL cap
  - `GET /api/sitemap/clubs.xml` — CLB `visibility="public"`
- `frontend/public/sitemap.xml` chuyển thành sitemap-index trỏ static + tournaments + clubs + news
- `frontend/public/sitemap-static.xml` (mới) chứa home + list pages cũ (9 URL)
- **Kết quả**: 63 tournaments + 14 clubs được Google index (trước chỉ 9 URLs static)

**Phase D — Prerender puppeteer:**
- `backend/controllers/prerenderController.js` (mới, 210 dòng): browser singleton reuse (`getBrowser()` lazy launch), NodeCache TTL 1h, block image/font/media để render nhanh, UA browser (`Prerender` suffix) để nginx không loop rewrite, skip static ext (`.html`, `.js`, `.css`, `.jpg`, `.pdf`, `.woff`...) + skip auth path prefixes
- Endpoint `GET /prerender/*` mount tại `server.js:332`
- `/prerender/_health` endpoint debug (cache stats + browser alive)
- **Nginx config trên VPS** (`/etc/nginx/conf.d/prerender-bot.conf` + patch `/etc/nginx/sites-enabled/default`):
  - `map $http_user_agent $pkt_is_bot { ... 20 bot patterns ... }`
  - `location /prerender/ { proxy_pass http://127.0.0.1:5001/prerender/; ... }`
  - Trong `location / { if ($pkt_is_bot = 1) { rewrite ^(.*)$ /prerender$1 last; } ... }`
  - `location ^~ /guides/`, static file exact matches cho `/robots.txt`, `/sitemap.xml`, `/favicon-64.png` etc để bot serve tĩnh không loop rewrite
- **VPS deps**: `apt-get install libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0` (chromium runtime deps)

**Bug fixes trong phase D:**
- `NON_API_PREFIXES` middleware `server.js:265` tự prepend `/api` cho path không thuộc allowlist → cần thêm `/prerender` vào allowlist
- `router.get(/.*/, ...)` không match trong express 4 path-to-regexp → chuyển sang `router.use(catch-all handler)`
- Helmet không override hardcoded canonical/og trong index.html → bỏ hardcoded

**Guides fix:**
- `yarn build:deploy` dùng `rsync -a --delete dist/` xóa mọi thứ ngoài dist → guide files upload trực tiếp bị xóa mỗi rebuild
- Fix: đưa vào `frontend/public/guides/{mlp.html, mlp.pdf}` → Vite copy vào dist mỗi lần build → không bị xóa
- Thêm nginx `location ^~ /guides/ { try_files $uri =404; }` TRƯỚC bot rewrite → static serve trực tiếp
- Cũng thêm `.html` vào STATIC_EXTS của prerenderController để backup guard

**End-to-end verify:**
- Bot Googlebot GET `/tournament/xxx` → 200, 86KB, title đúng "SE7ENPICK OPEN IV...", canonical `https://pickletour.vn/tournament/6a72dd73...` (đúng URL riêng), og:image poster giải, JSON-LD SportsEvent + BreadcrumbList + Place + PostalAddress
- Browser normal → 200, 5.4KB SPA (không đổi behavior)

### 3.6 Toggle displayMode tên VĐV

**Commits:** `dc7dcc3e` (root), `5e8ed20` (mobile)

Trang manage: option chuyển giữa "Biệt danh" (mặc định) và "Họ và tên". Persist per-user localStorage/AsyncStorage `pickletour:manage:nameDisplayMode`.

**Web** (`TournamentManagePage.jsx:1387`):
- State `nameModeOverride` + `handleChangeNameMode` callback
- `displayMode = nameModeOverride || getTournamentNameDisplayMode(tour)`
- ToggleButtonGroup ("Biệt danh" / "Họ và tên") trong toolbar cạnh dropdown "Tên overlay"

**Mobile** (`app/tournament/[id]/manage.tsx`):
- Đổi `personNickname(p)` thành `personName(p, mode)` toplevel + `pairLabel(pair, mode)`
- State `nameMode` + AsyncStorage `NAME_MODE_STORAGE_KEY`
- Wrapper `nameOfPlayer`, `labelOfPair` callback, dùng trong `resolveName`
- Menu ba chấm header: item toggle với label động "Tên: Biệt danh → Đổi Họ và tên" (và ngược lại)

Fallback: nếu `fullName` trống với mode="fullName" → fallback nickname (không hiện "—").

### 3.7 Version bump 1.1.14 build 44

**Commits:** `f97d284` (mobile), `2c5b3356` (root submodule bump)

- `app.json`: version "1.1.14", buildNumber "44", versionCode 44
- `android/app/build.gradle`: versionName "1.1.14", versionCode 44
- 5 Info.plist (all iOS folders) qua `plutil -replace`: CFBundleShortVersionString=1.1.14, CFBundleVersion=44
- 5 xcodeproj: MARKETING_VERSION=1.1.14, CURRENT_PROJECT_VERSION=44

**Android build local**: `~/Desktop/pickletour-android/pickletour-1.1.14.{apk,aab}` (115MB + 160MB) — user upload Play Console.

**iOS build**: user tự Archive qua Xcode UI từ **`ios/Pickletourvn.xcworkspace`** (Pods sẵn có). **KHÔNG dùng `ios 2/`** như HANDOVER cũ mention — `ios 2/` chưa có Pods và bị bug `tar extract` do path có dấu space. HANDOVER §3 mục 6 outdated về Live Activity — target Xcode ở cả 2 folder chỉ 1 target `Pickletourvn`.

### 3.8 Manager tự tạo bracket + manual pool + Blueprint AI (5 phase)

**Commits:** `18b51fdd` (BE Phase 1), `df7fcdce` (FE Phase 2+3), `ffbf6532` (FE Phase 5)

**Phase 1 — Backend mở quyền** (`backend/routes/adminRoutes.js`):
Thêm 15 route TRƯỚC `router.use(protect, authorize("admin"))` line 491 với chain riêng:
- **Bracket CRUD**: `POST/PATCH/DELETE /tournaments/:id/brackets[/:bid]` + `knockout/rebuild` + `GET /brackets/:bid` + `matches/clear` + `batch-delete` + `round-elim/skeleton`
- **Group slot**: `insert-slot` / `structure` / `generate-matches` per group
- **Plan**: `/plan/auto`, `/plan/commit`, `/plan/impact`, `/plan/suggest`, `/plan/suggest-and-commit`, GET/PUT `/plan`

Chain: `[protect, attachTournamentFromBracket, requireTournamentManager]` cho route có `:bracketId`, hoặc `[protect, requireTournamentManager]` cho route có `:id/:tourId/:tournamentId`. Draw endpoints đã manager-safe từ trước.

**Route cũ dưới `router.use(authorize("admin"))` vẫn tồn tại** — Express match first-declared → route mới thắng.

**Phase 2 + 3 — Frontend BracketsPanel** (`frontend/src/components/tournament-manage/BracketsPanel.jsx`, mới ~640 dòng):
- Card list bracket: badge type, stage/order, số bảng hoặc drawSize, nút Sửa/Xoá/Rebuild(KO)/Clear matches, "Chia bảng thủ công" (group only)
- **BracketEditorDialog**: form tạo/sửa với dropdown 5 type (`group/knockout/roundElim/round_robin/double_elim`), fields động: `groupCount+groupSize` (group), `drawSize+drawRounds` (KO/RE), `stage+order`, rules `bestOf+pointsToWin+winByTwo`
- **ManualPoolAssignDialog** (Phase 3): table cặp reg với dropdown "Bảng" (A/B/C/None). Save → loop `insertRegistrationIntoGroup` cho mỗi cặp đổi, `autoGrowExpectedSize:true`. Header chip counter mỗi bảng
- Wire vào `TournamentManagePage.jsx`: thêm item `v2SettingsItems` = `{value:"brackets", label:"Vòng đấu", icon:<AccountTreeIcon/>}` sau `courts`, thêm case renderer

**Phase 5 — Blueprint AI Planner** (`frontend/src/components/tournament-manage/BlueprintDialog.jsx`, mới ~480 dòng):
- MVP UX 3-step Stepper:
  1. **Cấu hình**: input số cặp (auto-fill từ approved regs) + hint 4 chip (auto/group/po/ko)
  2. **Xem plan**: 2 nút "🪄 AI đề xuất" (`planSuggest`, OpenAI) hoặc "⚙ Auto" (`planAuto`, deterministic fallback nếu OpenAI down). Preview 3 card stage summary + JSON raw có nút Copy
  3. **Áp dụng**: impact preview (`planImpact`) với 6 type badge (unchanged/create/rebuild/update_rules/delete/locked_conflict + icon 🔒). 2 nút commit: "Áp dụng an toàn" (`safe_apply`) hoặc "⚠ Thay toàn bộ" (`replace_all`) + double confirm
- Nút Blueprint AI đứng cạnh "Tạo vòng đấu" trong BracketsPanel header

**Slice mới** (`frontend/src/slices/tournamentsApiSlice.js`):
- Bracket CRUD: `useCreateBracketMutation`, `useUpdateBracketMutation`, `useDeleteBracketMutation`, `useRebuildKnockoutBracketMutation`, `useClearBracketMatchesMutation`, `useBuildRoundElimSkeletonMutation`, `useUpdateGroupStructureMutation`
- Blueprint: `useGetTournamentPlanQuery`, `useUpdateTournamentPlanMutation`, `useSuggestTournamentPlanMutation`, `usePreviewBlueprintImpactMutation`, `useCommitTournamentPlanMutation`, `useAutoPlanTournamentMutation`

**Không đụng logic**: controllers KHÔNG đổi, chỉ auth mount + layer UI mới. Admin panel `admin.pickletour.vn/admin/tournaments/:id/brackets` + `/blueprint` vẫn work y nguyên.

### 3.9 Guides MLP (HTML + PDF hosted)

**Commit + upload standalone:**
- `frontend/public/guides/mlp.html` (31KB) — full HTML doc với DOCTYPE + head + hero + 8 section (bao gồm 4 roles, 4 sub-match + DreamBreaker, BXH tiebreak, luồng 9 bước, Q&A)
- `frontend/public/guides/mlp.pdf` (820KB) — render qua Chrome headless từ standalone HTML
- URL: `https://pickletour.vn/guides/mlp.html`, `.pdf`
- Nginx `location ^~ /guides/` cache 1h, serve tĩnh trực tiếp

---

## 4. Bug fix + Landmine đã ghi nhận

### 4.1 (fixed) Poker mất chip khi all-in không bằng
Fix `refundUncalledBet` + `buildSidePots`. Chi tiết §3.2.

### 4.2 (fixed) Sâm không đánh được A-2-3-4-5
Fix comboType thêm nhánh A-low + compareCombos ưu tiên nhỏ hơn. Chi tiết §3.2.

### 4.3 (fixed) Manager thấy màn quản lý bị disable
Fix stringify populated user object. Chi tiết §3.3.

### 4.4 (fixed) 403 "insufficient role" khi duyệt waitlist
Fix bằng dời route lên trên wildcard middleware. Chi tiết §3.3.

### 4.5 (fixed) Chip poker mobile đè hole cards
Tách chip stack khỏi Seat container. Chi tiết §3.2.

### 4.6 (fixed) SPA canonical duplicate → Google deindex
Bỏ hardcoded canonical trong index.html + Helmet dynamic set. Chi tiết §3.5.

### 4.7 (fixed) Sitemap chỉ 9 URL static → Google không thấy tournaments/clubs
Sinh động qua backend endpoint. 63 + 14 URL mới lộ diện. Chi tiết §3.5.

### 4.8 (fixed) Zalo/FB share preview meta chung
Prerender puppeteer + nginx UA rewrite. Chi tiết §3.5.

### 4.9 (fixed) Guides bị xóa mỗi lần rebuild
Đưa vào `public/guides/`. Chi tiết §3.5.

### 4.10 (fixed) Realtime không update sau duyệt reg
Thêm `providesTags` cho `getRegistrations`. Chi tiết §3.3.

### 4.11 (fixed) ActionButtons memo wrapper drop props
Cần explicit destructure + forward TẤT CẢ props tương lai. Xem `TournamentRegistration.jsx:728`. Nếu add prop mới, phải update cả `ActionButtons` (memo) + `ActionButtonsInner`.

### 4.12 (chưa fix) `swiss` bracket type chưa có generator
Enum tồn tại nhưng builder không có code. Nếu user chọn type này → tạo bracket nhưng không sinh match được. **Cần đề phòng UI**: BracketEditorDialog **KHÔNG list swiss** trong dropdown 5 type (chỉ group/knockout/roundElim/round_robin/double_elim).

### 4.13 (chưa fix) `protectSameClub` field không hoạt động
`buildSeeding` chưa implement — chỉ enum trong `bracket.config.seeding.protectSameClub`. TODO comment ở `progressionService.js:345`.

### 4.14 (chưa fix) 3 hàm tính standings song song
`groupStandings.js`, `progressionService.js:computeQualifiersFromGroups`, `drawController.js:buildStandingsForBracket` — fields + ordering khác nhau. Nếu cần source-of-truth thống nhất nên consolidate.

### 4.15 (chưa fix) `seedType matchWinner/matchLoser` bị commented out trong enum
`seedSourceSchemaModel.js:37-38` COMMENTED OUT, resolver vẫn xử lý. Mongoose validate strict sẽ reject nếu save Match với seed type này qua public API — chỉ dùng khi assign programmatic bypass validation.

### 4.16 (chưa fix) iOS Pods bị bug tar-extract khi path có dấu space
`ios 2/` folder không chạy `pod install` được (React Native prebuilt binaries fail tar extract). Workaround đã thử:
- Symlink không giúp (cocoapods resolve realpath)
- Env `RCT_USE_PREBUILT_RNCORE=0` + `Podfile.properties.json` `ios.buildReactNativeFromSource: true` → chạy được nhưng gặp lỗi khác (RNZipArchive iOS 15.5 mismatch, lottie-ios version conflict)
- Recommended: dùng folder **`ios/`** (Pods đã sẵn, tên không space)
- Nếu cần Live Activity widget từ `ios 2/`: cần rebuild Pods hoặc rename folder tạm thời

### 4.17 (chưa fix) `ko.startKey` FE đọc từ `current?.ko?.startKey`
Schema Bracket KHÔNG có field `ko`. Property này compose ở FE hoặc lấy từ DrawSession. Nếu định làm feature dựa vào startKey cần check nguồn thực tế.

### 4.18 Nginx conflicting server name warnings
`nginx -t` warn về `apispc.pickletour.vn`, `ytb.pickletour.vn` v.v. conflicting — không ảnh hưởng function, chỉ noise.

---

## 5. Việc còn dở

### 5.1 Priority cao

- 🟡 **Deploy Android 1.1.14 Play Console** — file .aab ready tại `~/Desktop/pickletour-android/pickletour-1.1.14.aab` (160MB). User tự upload
- 🟡 **Build + Deploy iOS 1.1.14 App Store** — user tự Archive qua Xcode UI từ `ios/Pickletourvn.xcworkspace` (Pods sẵn). Upload TestFlight → Submit for Review
- 🟡 **Sau khi 1.1.14 live** — cập nhật memory `ota_targets.md` sang target `1.1.14`

### 5.2 Priority thấp

- **Blueprint AI chỉ MVP** — chưa có form design chi tiết per stage (BlueprintDesignerStep của admin panel 5919 dòng chưa clone). User dùng "Auto" hoặc "AI đề xuất" rồi fine-tune qua BracketsPanel CRUD dialog
- **Manual pool assign UX cải tiến** — drag-and-drop thay vì dropdown Select (hiện dùng Select)
- **`bulkAssignSlotPlan` endpoint** cần `requireSuperAdmin` (adminRoutes.js:634) — chưa mở cho manager. Nếu cần: bỏ superadmin gate hoặc tạo endpoint mới
- **`swiss` generator missing** — nếu ship feature swiss cần implement
- **Live Activity widget iOS** — nếu chuyển sang `ios/` build thì có mất widget không? Cần verify với user
- **Cleanup route cũ** dưới `router.use(authorize("admin"))` sau khi confirm route mới ổn định vài tuần

---

## 6. Environment cần biết

### 6.1 VPS credentials (giữ nguyên)

```
Host: 103.90.225.130
User: root
Password: Hoang@07082026
```

`PasswordAuthentication yes` + `PermitRootLogin yes`. Dùng qua sshpass:
```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 "..."
```

### 6.2 OTA hot-updater — Rule cũ vẫn áp

```bash
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a

# Trong session build tăng dần — chỉ ios 1.1.13
rm -rf .hot-updater/output
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "update"

# Khi user báo final (SAU KHI 1.1.14 live store)
for target in "ios 1.1.14" "ios 1.1.13" "android 1.1.14" "android 1.1.13"; do
  rm -rf .hot-updater/output
  ./node_modules/.bin/hot-updater deploy -p $(echo $target | cut -d' ' -f1) \
    -t $(echo $target | cut -d' ' -f2) -c production -m "update"
done
```

### 6.3 Android keystore + build (không đổi)

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd pickletour-app-mobile/android
./gradlew :app:bundleRelease :app:assembleRelease
```

Output: `app/build/outputs/{apk,bundle}/release/app-release.{apk,aab}`. Copy sang `~/Desktop/pickletour-android/pickletour-1.1.14.{apk,aab}`.

### 6.4 iOS build qua Xcode UI

```
open "/Users/admin/Desktop/Projects/Pickletour/abcdk/pickletour-app-mobile/ios/Pickletourvn.xcworkspace"
```
Signing & Capabilities → check Team → Product → Archive → Organizer → Distribute App → App Store Connect → Upload.

Version 1.1.14 build 44 đã bump sẵn. Pods đã có (Firebase, Clarity, BitByteData, ...) → không cần `pod install`.

### 6.5 Backend restart nhanh

```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 \
  "cd /abcdk- && git pull origin master 2>&1 | tail -3 && pm2 restart server 2>&1 | grep server"
```

Nếu `package.json` đổi: thêm `&& npm install --no-audit` trước pm2 restart.

### 6.6 Frontend web rebuild + deploy

```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 \
  "cd /abcdk-/frontend && yarn build:deploy 2>&1 | tail -5"
```

`yarn build:deploy` = `vite build` + `rsync -a --delete dist/ /var/www/pickletour.vn/`. ~1m50s.

**Lưu ý**: `--delete` flag xóa mọi thứ ngoài dist. Files upload trực tiếp SSH sẽ bị xóa mỗi rebuild — cần đưa vào `frontend/public/` để Vite copy vào dist.

### 6.7 Prerender debug

```bash
curl -sS https://pickletour.vn/prerender/_health   # cache stats + browser alive
curl -sS -A "Googlebot" https://pickletour.vn/tournament/<id>  # test bot render
```

Nếu prerender fail 502: check `pm2 logs server --err` cho chromium missing libs.

---

## 7. API endpoints mới trong session

### 7.1 SEO

| Endpoint | Method | Mô tả |
|---|---|---|
| `/api/sitemap/index.xml` | GET | Sitemap-index root (5 children) |
| `/api/sitemap/tournaments.xml` | GET | Sitemap 5000 tournament URL |
| `/api/sitemap/clubs.xml` | GET | Sitemap CLB public |
| `/prerender/*` | GET | Puppeteer render SPA cho crawler (mounted /prerender, không /api/) |
| `/prerender/_health` | GET | Debug cache + browser status |

### 7.2 Manager-accessible (đã có trước, giờ mở quyền)

Tất cả 15 endpoints trong `adminRoutes.js` lines TRƯỚC `router.use(authorize("admin"))` line 491 — chain manager:
- `POST/PATCH/DELETE /api/admin/tournaments/:id/brackets[/:bid]`
- `POST /api/admin/tournaments/:tid/brackets/:bid/knockout/rebuild`
- `GET/POST /api/admin/brackets/:bid` (get, matches/clear, batch-delete, round-elim/skeleton)
- `POST/PATCH /api/admin/brackets/:bid/groups/:gid/*` (insert-slot, structure, generate-matches)
- `POST/GET/PUT /api/admin/tournaments/:id/plan/*` (auto, commit, impact, suggest, suggest-and-commit, /plan)

---

## 8. Snapshot commit history session

**Root** `abcdk-`: `db606cb4 → ffbf6532` (~20 commits, chỉ list landmark):

1. [`6aa08fcc`](https://github.com/den3110/abcdk-/commit/6aa08fcc) — bracket v4 modern KO web
2. [`95e9f1ef`](https://github.com/den3110/abcdk-/commit/95e9f1ef) — bracket v4 modern Round Elim
3. [`2c8bcd83`](https://github.com/den3110/abcdk-/commit/2c8bcd83) — visual upgrade v4 (accent palette + gradient)
4. [`04c95084`](https://github.com/den3110/abcdk-/commit/04c95084) — Fix Poker side-pot + Sâm A-low
5. [`dc1af4c8`](https://github.com/den3110/abcdk-/commit/dc1af4c8) — Fix manager permission (3 file web + backend hygiene)
6. [`82d42aa0`](https://github.com/den3110/abcdk-/commit/82d42aa0) — realtime cache tags web + mobile bump
7. [`0e4d363b`](https://github.com/den3110/abcdk-/commit/0e4d363b) — Fix 403 duyệt waitlist (route + middleware)
8. [`39a15dee`](https://github.com/den3110/abcdk-/commit/39a15dee) — Dời route registration lên trên wildcard admin
9. [`8d8d9ba4`](https://github.com/den3110/abcdk-/commit/8d8d9ba4) — Feature chuyển chính thức → waitlist
10. [`39e7aeab`](https://github.com/den3110/abcdk-/commit/39e7aeab) — Fix ActionButtons forward onDemoteToWaitlist
11. [`425db7ab`](https://github.com/den3110/abcdk-/commit/425db7ab) — SEO overhaul (canonical + JSON-LD + sitemap + prerender)
12. [`40011a47`](https://github.com/den3110/abcdk-/commit/40011a47) — Fix prerender regex
13. [`0eac7162`](https://github.com/den3110/abcdk-/commit/0eac7162) — Fix prerender router.use catch-all
14. [`cf0acab6`](https://github.com/den3110/abcdk-/commit/cf0acab6) — Fix NON_API_PREFIXES include /prerender
15. [`4cd5bc76`](https://github.com/den3110/abcdk-/commit/4cd5bc76) — Fix Helmet flush timing + bỏ hardcoded canonical
16. [`9f156991`](https://github.com/den3110/abcdk-/commit/9f156991) — guides/mlp vào public folder
17. [`dc7dcc3e`](https://github.com/den3110/abcdk-/commit/dc7dcc3e) — Toggle displayMode biệt danh/họ tên (web + mobile)
18. [`2c5b3356`](https://github.com/den3110/abcdk-/commit/2c5b3356) — Bump submodule 1.1.14
19. [`18b51fdd`](https://github.com/den3110/abcdk-/commit/18b51fdd) — Phase 1 mở quyền BE bracket + plan cho manager
20. [`df7fcdce`](https://github.com/den3110/abcdk-/commit/df7fcdce) — Phase 2+3 BracketsPanel + ManualPoolAssign
21. [`ffbf6532`](https://github.com/den3110/abcdk-/commit/ffbf6532) — Phase 5 BlueprintDialog

**Mobile** `pickletour-app`: `9bb3781 → f97d284` (~7 commits):

1. [`1d5e7f5`](https://github.com/den3110/pickletour-app/commit/1d5e7f5) — bracket v4 mobile
2. [`1697a81`](https://github.com/den3110/pickletour-app/commit/1697a81) — Fix Poker chip UI mobile
3. [`4f6d136`](https://github.com/den3110/pickletour-app/commit/4f6d136) — Fix manager stringify populated user
4. [`cfc8abd`](https://github.com/den3110/pickletour-app/commit/cfc8abd) — providesTags fix (realtime)
5. [`8dc9fd0`](https://github.com/den3110/pickletour-app/commit/8dc9fd0) — nút chuyển chính thức → waitlist mobile
6. [`5e8ed20`](https://github.com/den3110/pickletour-app/commit/5e8ed20) — Toggle displayMode manage.tsx
7. [`f97d284`](https://github.com/den3110/pickletour-app/commit/f97d284) — Bump 1.1.14 build 44

---

## 9. Câu hỏi còn mở

1. **iOS Live Activity widget** — có mất khi build từ `ios/` thay vì `ios 2/`? Cần user verify hoặc test sau khi 1.1.14 lên TestFlight
2. **Bốc thăm online trên trang manage** — user báo "đã có rồi" → chưa clone UI từ admin. Nếu manager chưa dùng được, cần khảo sát endpoint `/api/draw/*` FE UI đâu
3. **OpenAI credit** — Blueprint AI dùng `openai.responses.create` trong `planSuggest.js`. Rate limit? Fallback "Auto" đã có sẵn nếu OpenAI down
4. **BlueprintDesignerStep chi tiết** — admin panel có form design per-stage (5919 dòng). Manager chỉ có MVP + BracketsPanel CRUD. Có cần clone full designer không?
5. **Cleanup route cũ** — route CRUD bracket dưới `router.use(authorize("admin"))` line 491 giờ là dead code (route mới ở trên thắng). Xóa hay giữ để rollback dễ?
6. **`bulkAssignSlotPlan` mở quyền manager** — hiện `requireSuperAdmin`. Nếu manager cần preassign slot fixed thì cần bỏ gate. Chưa quyết
