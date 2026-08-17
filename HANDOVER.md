# PickleTour — Tài liệu bàn giao (Handover)

> **Dành cho:** đội nhận bàn giao (đọc bởi người + Claude/AI agent để tự setup).
> **Ngày lập:** 2026-08-03. Lập tự động từ khảo sát code, có ghi chú những chỗ cần xác nhận lại với người bàn giao.
>
> ⚠️ **QUAN TRỌNG:** file này là bản gốc từ 2026-08-03. Trạng thái + tính năng
> mới nhất (**4 session tới nay**) — Apple 1.2 compliance, nickname approval,
> overlay generator, icon/splash 1.1.13, Android LIVE, iOS TestFlight chờ,
> chat DM upgrade, **Feed hoàn thiện** (video thumb + realtime + AspectImage
> + comment media + reactions viewer + FeedMediaLightbox + mention populate
> + guest view + rate limit posts/day), **Notification prefs** (chat/feed
> mute all + per-DM), **MLP tournament ĐẦY ĐỦ** (Phase 1-6: standings +
> referee/court + realtime socket + knockout + rating hook + push noti +
> admin moderation + check-in + tiebreaker H2H + reporting CSV + overlay
> template + mobile UI 4 screens + court cluster integration), **POKER
> Texas Hold'em multiplayer** + 5 game mới (Phỏm/Sâm Lốc/Caro/Cờ Vua/Cờ Tướng),
> **Sơ đồ v4 modern** (KO đối xứng + Round Elim, palette accent theo vòng,
> gradient card, avatar deterministic color, live glow), **SEO overhaul**
> (canonical dynamic + JSON-LD SportsEvent + sitemap 63 tournaments + 14 clubs
> + prerender puppeteer cho crawler), **Manager tự quản trị** (tạo bracket +
> chia bảng thủ công + Blueprint AI trên trang manage) — chi tiết trong
> **`HANDOFF.md`**. Đọc HANDOFF.md **TRƯỚC** để nắm state hiện tại.
>
> ⚠️ **Thay đổi kiến trúc lớn kể từ 2026-08-03 (đọc HANDOFF chi tiết):**
>
> 🆕 **Session 2026-08-13→17 — Bracket v4 + SEO + Manager tự quản trị**
> (xem HANDOFF mới nhất — **~20 commits root + 7 commits mobile**):
> - **Sơ đồ bracket v4 modern** (web + mobile) — gate `?ui=v4` hoặc chip
>   toggle. Palette accent theo vòng: KO đếm ngược từ CK (gold `#f59e0b`) →
>   BK (rose) → TK (violet) → xanh dần. Round Elim palette xuôi. Card gradient
>   header + border-top accent + VS divider + LivePulseDot + ChampionBadge
>   float trophy. Connector bezier SVG gradient. Avatar deterministic color
>   theo hash tên. **Label human-readable** (post-process): `W-V1-T16` →
>   "Chờ thắng T16·V1", `V1-B1-T2` → "Hạng 2 Bảng 1", `BYE` → "Miễn đấu".
>   - Web: `ModernKnockoutBracket.jsx`, `ModernRoundElimBracket.jsx`
>   - Mobile: `components/bracket/ModernBracketShared.tsx` + `ModernKnockoutBracketRN.tsx` + `ModernRoundElimBracketRN.tsx`
> - **Fix Poker side-pot NGHIÊM TRỌNG** — trước all-in không bằng nhau
>   (VD 4k vs 1k) → user mất HẾT chip. Thêm `refundUncalledBet` +
>   `buildSidePots` + rewrite `showdown`/`finishHandUncontested`.
>   Chip UI mobile tách khỏi Seat, không đè cards/tên.
> - **Sâm Lốc đánh được sảnh A-low** (A-2-3, A-2-3-4-5, ...) — mapping riêng
>   A=0, 2=1, 3=2... A-low luôn nhỏ hơn sảnh thường trong compareCombos.
> - **Fix manager permission regression** — session trước populate
>   `managers.user`/`createdBy` object → FE stringify `"[object Object]"`.
>   Fix pattern `m?.user?._id ?? m?.user ?? m` ở 3 file web + 3 file mobile.
>   Bonus fix 403 duyệt waitlist: dời route lên TRƯỚC `router.use(authorize("admin"))`
>   line 452 với chain manager. Fix realtime cache tags cho `getRegistrations`.
> - **Feature: chuyển cặp chính thức → waitlist** — nút "⏳ Chờ duyệt"
>   web (amber) + mobile (hourglass). Backend `adminUpdateRegistration` thêm
>   `"waitlisted"` vào demote logic, auto-promote cặp waitlist cũ nhất.
> - **SEO overhaul** — 4 phase:
>   - HTML: bỏ `maximum-scale=1`, bỏ hardcoded canonical/OG trong index.html
>     để Helmet control dynamic. Bỏ hreflang `en` duplicate.
>   - Canonical + JSON-LD SportsEvent dynamic ở TournamentDetailPage +
>     TournamentOverviewPage (dùng `SEOHead` component có sẵn).
>   - Sitemap động: `backend/controllers/sitemapController.js` — 3 endpoint
>     `/api/sitemap/{index,tournaments,clubs}.xml`. `sitemap.xml` static
>     chuyển thành sitemap-index. **63 tournaments + 14 clubs** giờ Google
>     index được (trước chỉ 9 URL static).
>   - **Prerender puppeteer**: `backend/controllers/prerenderController.js` —
>     browser singleton, cache 1h, block image/font, block skip static ext.
>     Endpoint `GET /prerender/*` (mount tại `/prerender`, KHÔNG `/api/*`).
>     Nginx: `/etc/nginx/conf.d/prerender-bot.conf` (UA map 20 crawler
>     patterns) + patch vhost `/etc/nginx/sites-enabled/default`:
>     `location /prerender/`, `location ^~ /guides/`, exact static file
>     matches (`/robots.txt`, `/sitemap.xml`, `/favicon-64.png`...), bot
>     rewrite `if ($pkt_is_bot = 1) rewrite ^(.*)$ /prerender$1 last;`
>     trong `location /`. **VPS install**: chromium runtime deps
>     (`libnss3 + libnspr4 + libatk*` v.v.).
>   - **Guides**: `frontend/public/guides/{mlp.html, mlp.pdf}` — Vite copy
>     vào dist. Nginx `location ^~ /guides/` cache 1h. URL live tại
>     `pickletour.vn/guides/mlp.html` + `.pdf`. **Lưu ý**: `yarn build:deploy`
>     dùng `rsync --delete` → file upload SSH trực tiếp bị xóa mỗi rebuild.
> - **Toggle displayMode tên VĐV** (biệt danh vs họ và tên) trang manage.
>   Persist localStorage/AsyncStorage `pickletour:manage:nameDisplayMode`.
> - **Bump version 1.1.14 build 44 (native)** — bumped tất cả 5 iOS folder
>   + gradle + app.json. Android build local `pickletour-1.1.14.{apk,aab}`
>   tại `~/Desktop/pickletour-android/`. iOS user tự Archive qua Xcode UI
>   từ **`ios/Pickletourvn.xcworkspace`** (Pods sẵn). HANDOVER §3 mục 6 nói
>   `ios 2/` chứa Live Activity đã outdated — target Xcode ở cả 2 folder
>   chỉ 1 target `Pickletourvn`. `ios 2/` chưa có Pods và bị bug tar-extract
>   do path space.
> - **Manager tự quản trị bracket (5 phase)**:
>   - **Phase 1 BE**: mở quyền 15 endpoint bracket CRUD + plan + insert-slot
>     cho manager. Thêm route TRƯỚC `router.use(authorize("admin"))` line 491
>     với chain `[protect, attachTournamentFromBracket, requireTournamentManager]`.
>     Route cũ giữ dead code để rollback dễ.
>   - **Phase 2 + 3 FE**: `frontend/src/components/tournament-manage/BracketsPanel.jsx`
>     — section "Vòng đấu" trong drawer Cài đặt trang manage. Card list +
>     Editor dialog CRUD (5 type: group/knockout/roundElim/round_robin/
>     double_elim). ManualPoolAssignDialog: bảng cặp reg với dropdown chọn
>     bảng A/B/C, save loop `insertRegistrationIntoGroup`.
>   - **Phase 5 FE**: `BlueprintDialog.jsx` MVP 3-step Stepper (Config →
>     Plan → Impact & Apply). Nút "🪄 AI đề xuất" (OpenAI `planSuggest`)
>     hoặc "⚙ Auto" (deterministic `planAuto` không cần AI). Impact preview
>     6 type badge (unchanged/create/rebuild/update_rules/delete/
>     locked_conflict). Commit `safe_apply` hoặc `replace_all`.
>
> ---
>
> 🆕 **Session 2026-08-12→13 — Games platform 6 game + MLP polish**
> (xem HANDOFF mới nhất — 73 tasks, **~58 commits root + ~38 commits mobile**):
> - **6 game online hoàn chỉnh trên mobile**: Poker (đã có) + **Phỏm, Sâm Lốc,
>   Caro, Cờ Vua, Cờ Tướng** (mới). Home icon "Poker" → "Games" hub `/games`
>   với 6 tile. Mỗi game: model + engine + controller + routes + socket
>   `<game>:room:${id}` + `<game>:lobby` + mobile lobby + room screen +
>   RTK slice.
> - **Phỏm**: 9 lá + dealer 10, `findBestPartition` backtracking phỏm tối ưu,
>   auto-ù, phase mới `downing` sau 4 vòng với 3 lựa chọn (auto/manual/gửi bài).
>   Rule đơn giản: 10 lá thảy, 9 lá bốc. Landscape UI.
> - **Sâm Lốc**: rank order riêng (3<...<A<2 — 2 là heo), `fourPairs` combo
>   type, `canCut` cross-type (tứ quý chặt heo, 4 đôi thông chặt quad,
>   dragon chặt all). **Xin Sâm flow** stage riêng 10s. Scoring per-card ×
>   stake (móm 2x, chặt heo 2x, bị bắt sâm 6x). 1 người hết bài = kết
>   thúc ván ngay. Landscape UI.
> - **Caro (Gomoku)**: 15×15 board flat, 5 liên tiếp win (4 direction check).
>   Portrait UI, X đỏ / O xanh.
> - **Cờ Vua**: `npm install chess.js` (^1.4.0) wrapper full rule (checkmate/
>   stalemate/draw). Board 8×8 Unicode ♔♕♖♗♘♙, flip cho bên đen. Legal
>   moves highlight khi chọn quân (chess.js client-side).
> - **Cờ Tướng**: custom engine ~250 dòng với 7 loại quân (K/A/E/H/R/C/P),
>   sông + cung, pháo cần đúng 1 quân giữa để ăn, face-to-face rule. Bắt
>   K/k = thắng. Board 9×10 với chữ Hán 帥仕相傌俥炮兵.
> - **Shared game infrastructure**:
>   - `components/games/GameTableUI.tsx`: WoodBackground / FeltOval / CardPro
>     / SeatFrame / RoundIconBtn / SpeechBubble / ConnectionBanner
>   - `components/games/InviteFriendModal.tsx`: search user + push invite
>   - `components/games/RoomListItem.tsx`: shared lobby card với avatar row
>   - `hook/useGameAutoReconnect.ts`: NetInfo + AppState + socket reconnect
>   - `lib/gameSound.ts`: standalone (require relative), verbose log, remote
>     URL fallback tại `pickletour.vn/uploads/sfx/click.mp3`
> - **Host system** (chủ phòng — áp dụng 5 game mới, Poker giữ nguyên):
>   auto-sit creator, chỉ chủ phòng bắt đầu, chặn ngồi khi ván đang chơi,
>   transfer host khi rời, back button confirm, **auto-close bàn khi hết
>   người** (`seats.some(s => s.user) === false → status="closed"`).
> - **Realtime lobby list**: socket `<game>:lobby` join khi subscribe →
>   emit `<game>:lobby:updated` khi có createRoom / update / leave →
>   client refetch. List response include `seatUsers` avatars + `createdBy`.
> - **Speech bubble** cho tất cả 6 game khi có chat mới (4s trên avatar).
> - **Sound**: reuse `assets/sfx/click4.mp3` bundled (từ build 43). Nếu OTA
>   bundle require alias fail → fallback remote URL. Verbose console log.
> - **Android build local**: `pickletour-1.1.13.{apk,aab}` (115MB + 160MB)
>   tại `~/Desktop/pickletour-android/`. Keystore config trong
>   `~/.gradle/gradle.properties`. `Java 17` bắt buộc.
> - **OTA policy mới** (memory `ota_targets.md`): mỗi commit chỉ push
>   `ios 1.1.13`; khi hoàn tất tính năng → push cả 4 target (iOS 1.1.13+1.1.9,
>   Android 1.1.13+1.1.9). Override HANDOFF §3.3 cũ.
> - **Bổ sung MLP tournament**:
>   - `mlpConfig.maxTeamScore` cap tổng điểm ĐÔI roster + validate backend + UI web/mobile
>   - Fix `TournamentCourtClusterDialog` union 2 pool referees (legacy + new)
>   - BTC section trang đăng ký: card list creator + managers với avatar +
>     tap mở PublicProfileDialog + icon 💬 nhắn tin (DM) + 📞 gọi điện.
>     Backend `getTournamentById` populate `createdBy` + `managers.user`
>   - MLP `MlpTournamentRegistrationView` TeamFormDialog + team list card
>     hiện điểm trình đôi/đơn mỗi VĐV + tổng team (dùng `attachPlayerScores`)
>
> ---
>
> 🆕 **Session 2026-08-11→12 — MLP group stage + waitlist + polish**
> (xem HANDOFF mới nhất — 40 tasks, ~19 commits root + ~11 commits mobile):
> - **MLP vòng bảng + bốc thăm + knockout ĐẦY ĐỦ**: `groupStage.enabled`
>   → sinh round-robin trong bảng, cross-pool KO (A1-B2, B1-A2…), auto-
>   advance winner, KO preview với placeholder "Nhất bảng A" khi vòng
>   bảng chưa xong. Live draw stage screen với socket relay realtime.
> - **Reset giải MLP** endpoint để test lại: xoá duals/standings/pools/
>   rating changes theo scope, gõ tên giải confirm.
> - **Trọng tài đứng theo sân**: bỏ referee UI khỏi dual detail, auto
>   lấy từ `courtStation.defaultReferees`. Referee tab mobile filter
>   fallback qua station khi dual/sub referees rỗng.
> - **Waitlist đăng ký giải** (mọi mode): cặp thứ 49+ vào `status="waitlisted"`,
>   không tính 48/48. Auto-promote FIFO khi có cặp rút. Admin dialog
>   "Chờ / Duyệt luôn". Push notification 2 chiều (VĐV + BTC) khi
>   promote (manual + auto).
> - **RegInvite.desiredStatus**: admin ép trạng thái khi tạo invite,
>   `finalizeIfReady` tôn trọng.
> - **Referee panel mobile**: hiện tên đội MLP 2 side + swap khi Đổi
>   bên. Fix flicker tên đội ↔ tên VĐV (MLP match chỉ dùng meta.mlp.
>   teamAName/teamBName, không fallback resolvedSideName).
> - **Overlay MLP redesign compact top-left** (~480px), navy+gold, quả
>   bóng vàng pulsing tay giao, DreamBreaker badge inline. Fix
>   station.currentMatch trỏ non-MLP → bỏ qua, path 2 tìm MLP match.
> - **MlpDualsPage nâng cao**: pool tabs, dropdown gán sân inline,
>   xem lineup 2 đội trong card, realtime score qua tournament:invalidate.
> - **MLP + TEAM badge** trên tournament list card (web + mobile).
> - **Quản lý trọng tài** (mới): pool `TournamentReferee` + dialog web
>   Search+add. Chưa wire vào cụm sân UI.
> - **Điểm trình VĐV** hiện trong MLP team roster: search dropdown chip
>   "Đôi X.XX" + "Đơn Y.YY", roster item + tổng team. Backend helper
>   `attachPlayerScores` query Ranking bulk.
>
> ---
>
> 🆕 **Session 2026-08-10→11 — MLP overhaul** (xem HANDOFF cũ hơn):
> - **MLP mode giờ hoạt động ĐÚNG**: `normalizeTournamentMode` không còn ép
>   `mlp` về `standard`. Admin chọn MLP giờ lưu đúng vào DB.
> - **MLP sub-match tạo Match doc thật** để trọng tài chấm qua RefereeScorePanel
>   như trận thường. `mlpMatchSync.service.js` — sync 2 chiều Match ↔ sub-match.
>   Meta.mlp chứa synth pairA/pairB (User đầy đủ) → mobile dùng chung code path
>   với giải thường (avatar, CCCD, slot swap, serve indicator).
> - **Per-sub-match assignment**: mỗi sub 1 trọng tài + sân + giờ riêng
>   (SubMatchSchema thêm referees/court/courtStation/scheduledAt).
> - **MLP overlay livestream** theo court station: `/overlay/mlp/court/:id` —
>   endpoint `/api/live/courts/:id/mlp-overlay`. Auto-switch sub-match (2v2) ↔
>   DreamBreaker (1v1 rotate). URL copy trong DualAssignmentPanel cho OBS.
> - **MLP có bracket view + registration view riêng** (web + mobile):
>   `MlpBracketView` / `MlpTournamentRegistrationView` / mobile `mlp/teams.tsx`
>   với color picker + roster search.
> - **DreamBreaker referee flow** trên mobile (Start lineup + 1v1 rotation +
>   scoring). Backend `canScoreDual` cho referee quyền chấm DB.
> - **Visibility permission**: captain chỉ thấy team + dual mình, chỉ chọn
>   lineup team mình. `LineupDialog` chỉ show 1 cột. Backend
>   `assignSubMatchLineup` cho captain quyền set lineup bên mình.
>
> ---
>
> 1. **Tournament mode** giờ có 3 giá trị: `standard` / `team` / `mlp`. Xem
>    HANDOFF §2.6 (fix cap.points bug).
> 2. **Coach** không phải role exclusive — cờ `isCoach: Boolean` co-exist với
>    admin/referee/user. Đầy đủ application/achievement flow.
> 3. **Notification chat** đã refactor gộp per-conversation. `feedNotifier`
>    tách notification mention khỏi comment thường (title riêng "Bạn được nhắc
>    tới trong bình luận").
> 4. **Admin panel** build trên VPS `/abcde` (không phải Vercel). Có 2 trang
>    mới: `/admin/nickname-requests` + `/admin/settings` section "Overlay
>    Generator API Key".
> 5. **Nginx đã có cache policy** cho SPA (no-cache HTML + immutable /assets).
> 6. **Docker `redis` restart policy** đã `unless-stopped`.
> 7. **Facebook Pixel `28469951482590991`** live trên web.
> 8. **Court model song song** — `Court` cũ + `CourtStation` mới (thuộc
>    `CourtCluster` qua `tour.allowedCourtClusterIds`). Overlay controller
>    query CẢ 2 dedup theo `_id`.
> 9. **Overlay generator** — service riêng chạy port `3131` trên VPS
>    (`/root/overlay-generator/`, NOT trong repo). Backend PickleTour có
>    4 endpoint `/api/admin/tournaments/:id/overlay/*` proxy tới generator.
>    Admin `/admin/settings` có section nhập ANTHROPIC_API_KEY.
> 10. **Nickname change** — bây giờ CẦN admin duyệt (không đổi tự do). Có
>     cooldown `SystemSettings.profile.nicknameChangeCooldownDays` (default
>     60d). Admin duyệt qua Telegram inline button HOẶC admin panel.
> 11. **Block user + report content** đã đầy đủ (Apple 1.2). Filter feed +
>     chat + comment theo `blockedByUser`.
> 12. **Chat realtime**: đã fix re-subscribe room khi socket reconnect (bug
>     mất messages sau khi mất mạng chớp).
> 13. **Mobile version bump** — hết session 2026-08-13→17: `1.1.14 (44)`
>     đồng bộ iOS + Android (app.json + 5 Info.plist + 5 xcodeproj + gradle).
>     Android build local `~/Desktop/pickletour-android/pickletour-1.1.14.{apk,aab}`
>     **CHƯA upload Play Console**. iOS **CHƯA build** — user tự Archive qua
>     Xcode UI từ **`ios/Pickletourvn.xcworkspace`** (Pods sẵn), KHÔNG `ios 2/`
>     (Pods thiếu + bug tar-extract path space). Store hiện tại vẫn là 1.1.13
>     (Android Play LIVE, iOS TestFlight chờ Submit).
> 14. **Hot-updater CLI** — dùng `./node_modules/.bin/hot-updater` (0.25.14)
>     khớp native, KHÔNG `npx hot-updater@0.25.4` như HANDOFF cũ (yarn.lock
>     đã silent upgrade 09/07).
> 15. **Nút Gọi Zalo/điện thoại** ở header chat DM — dùng deep-link
>     `zalo://qr/p/{phone}` fallback `https://zalo.me/{phone}` + `tel:{phone}`.
>     `USER_FIELDS` trong chatController thêm `phone` để populate.
> 16. **Icon + splash + logo** mới — icon `P` navy monogram, splash bg navy
>     `#0a1834`. Native replace ở cả 5 folder iOS Xcode (`ios`, `ios 2`,
>     `ios3`, `ios copy`, `ios copy 2`) + Android mipmap 5 density.
> 17. **MLP tournament** đã complete-loop: Team CRUD → generate dual → chấm →
>     DreamBreaker → BXH (auto-recompute + H2H tiebreak) → knockout bracket
>     seed từ BXH → rating hook cập nhật điểm trình VĐV → notification →
>     export CSV/summary JSON. Mobile 4 screens (`app/tournament/[id]/mlp/*`),
>     socket `mlp:dual:${id}`.
> 18. **Poker Texas Hold'em multiplayer** — module hoàn toàn mới. Model
>     `PokerRoom`, engine `pokerEngine.js` (shuffle + hand evaluate 5/7 +
>     street progression + auto-timer 30s + auto-huỷ 5' idle), 13 endpoints
>     `/api/poker/*`, socket `poker:room:${id}`, mobile ~2500 dòng ở
>     `app/poker/`. Chip vui chơi (không tiền thật). Sound layer dùng
>     `expo-audio` với `assets/sfx/click4.mp3` volume/rate variation.
> 19. **Feed rate limits** — `rlPost` 24h/10 bài, `rlCommentMedia` 24h/100
>     comment kèm media (skip khi media rỗng).
> 20. **Notification preferences** — `User.notificationPrefs` embedded
>     `{chatMuteAll, feedMuteAll}`, endpoint `GET/PATCH /api/users/
>     notification-prefs`. Chat/Feed notifier tự filter user opt-out.
> 21. **Sơ đồ v4 modern** — thêm bản mới (giữ v1 gốc). Gate `?ui=v4` hoặc
>     chip toggle. Files: `frontend/src/screens/PickleBall/ModernKnockoutBracket.jsx`
>     + `ModernRoundElimBracket.jsx`; mobile `pickletour-app-mobile/components/
>     bracket/ModernBracketShared.tsx` + `ModernKnockoutBracketRN.tsx` +
>     `ModernRoundElimBracketRN.tsx`. Palette accent theo vòng (KO ngược từ
>     CK gold → BK rose → TK violet → xanh dần), gradient card + connector
>     bezier SVG, avatar deterministic color, label human-readable
>     (`W-V1-T16` → "Chờ thắng T16·V1"). Persist localStorage/AsyncStorage
>     `pickletour:tournament-bracket:uiVersion`.
> 22. **Poker side-pot logic đúng** (từ session 2026-08-13→17) — trước all-in
>     không bằng nhau (VD user 4k vs opp 1k) → user mất HẾT chip. Nay có
>     `refundUncalledBet` (trả overbet) + `buildSidePots` (tách side pots
>     theo tier contribution, eligibleSeatIdxs). Rewrite `showdown` +
>     `finishHandUncontested` trong `backend/services/pokerEngine.js`.
> 23. **Sâm A-low straight** — comboType detect A-2-3, A-2-3-4-5, ... (mapping
>     riêng A=0, 2=1, 3=2). compareCombos: A-low luôn nhỏ hơn sảnh thường.
> 24. **Manager tự quản trị bracket trên trang manage** (session 2026-08-13→17):
>     - **Section "Vòng đấu"** trong drawer Cài đặt trang manage — component
>       `frontend/src/components/tournament-manage/BracketsPanel.jsx`.
>       Bracket CRUD (5 type: group/knockout/roundElim/round_robin/double_elim)
>       + Manual pool assign (chia bảng thủ công, chọn cặp vào bảng A/B/C).
>     - **Blueprint AI** — `BlueprintDialog.jsx` 3-step Stepper. "🪄 AI" dùng
>       `planSuggest` (OpenAI), "⚙ Auto" dùng `planAuto` (deterministic fallback).
>     - **BE mở quyền 15 endpoint** trong `backend/routes/adminRoutes.js`
>       (bracket CRUD + plan + insert-slot + structure + generate-matches +
>       knockout/rebuild + matches/clear + batch-delete + round-elim/skeleton).
>       Thêm route TRƯỚC `router.use(protect, authorize("admin"))` line 491
>       với chain `[protect, attachTournamentFromBracket, requireTournamentManager]`.
>       Route cũ giữ dead code để rollback dễ.
> 25. **Feature chuyển cặp chính thức → waitlist** — nút "⏳ Chờ duyệt"
>     web + mobile. Backend `adminUpdateRegistration` thêm `"waitlisted"`
>     vào demote logic (clear approvedBy/approvedAt, giảm counter,
>     auto-promote cặp waitlist cũ nhất).
> 26. **Toggle displayMode tên VĐV** (biệt danh vs họ và tên) trang manage.
>     Persist per-user localStorage/AsyncStorage
>     `pickletour:manage:nameDisplayMode`. Web: ToggleButtonGroup trong
>     toolbar. Mobile: menu item ba chấm header với label động.
> 27. **SEO overhaul đầy đủ** (session 2026-08-13→17):
>     - **Sitemap động**: `backend/controllers/sitemapController.js` — 3 endpoint
>       `/api/sitemap/{index,tournaments,clubs}.xml`. `sitemap.xml` static
>       chuyển thành sitemap-index. 63 tournaments + 14 clubs được index.
>     - **Canonical dynamic + JSON-LD SportsEvent** — bỏ hardcoded canonical/OG
>       trong `index.html` để react-helmet-async control dynamic. Thêm
>       SportsEvent JSON-LD ở TournamentDetailPage + TournamentOverviewPage.
>     - **Prerender puppeteer** — `backend/controllers/prerenderController.js`:
>       browser singleton, cache in-memory 1h, block image/font, skip static
>       ext + auth path. Endpoint `GET /prerender/*` mount tại `/prerender`
>       (KHÔNG `/api/*` — thêm vào `NON_API_PREFIXES` server.js:265).
>       Nginx: `/etc/nginx/conf.d/prerender-bot.conf` (UA map 20 patterns) +
>       patch `/etc/nginx/sites-enabled/default`: `location /prerender/`,
>       `location ^~ /guides/`, bot rewrite `if ($pkt_is_bot=1) rewrite ^
>       /prerender$1 last;` trong `location /`. VPS deps: `libnss3 libnspr4
>       libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0
>       libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0
>       libcairo2 libasound2t64 libatspi2.0-0`.
>     - **Guides**: `frontend/public/guides/{mlp.html, mlp.pdf}` (Vite copy
>       vào dist). URL `pickletour.vn/guides/mlp.html` + `.pdf`. Nginx
>       `location ^~ /guides/` cache 1h. **Lưu ý**: `yarn build:deploy`
>       dùng `rsync --delete` — file upload SSH thẳng bị xóa mỗi rebuild.
> 28. **Route Registration đã dời TRƯỚC wildcard admin** — `POST/PATCH/DELETE
>     /api/admin/tournaments/registrations/:regId/*` + `GET/POST /admin/
>     tournaments/:id/registrations` giờ có chain
>     `[protect, attachTournamentFromRegistration, requireTournamentManager]`
>     thay `authorize("admin")` — manager duyệt được waitlist. Utility
>     `attachTournamentFromRegistration` + mở rộng `requireTournamentManager`
>     đọc thêm `req.params.id / tourId / tid` trong `utils/tournamentAuth.js`.
> 29. **RTK cache tags fix** — `getRegistrations` query giờ có `providesTags:
>     [{Registrations, tourId}, {Registrations, LIST}]`, mutation
>     `managerSetRegStatus` invalidate `[LIST, regId]`. Duyệt reg xong list
>     tự refetch — không cần F5.
> 30. **iOS canonical folder = `ios/` KHÔNG `ios 2/`** — trái với HANDOVER
>     §3 mục 6 nói `ios 2` chứa Live Activity widget. `xcodebuild -list` cả
>     2 folder chỉ 1 target `Pickletourvn`. `ios 2/` chưa có Pods + bị bug
>     `tar extract` do path có dấu space (React Native prebuilt binaries fail).
>     Build native production dùng `ios/Pickletourvn.xcworkspace` (Pods sẵn).
>
> ⚠️ **VPS SSH**: `PasswordAuthentication yes` + `PermitRootLogin yes` (bật lại
> từ session 2026-08-10 để Claude SSH được — user có thể tắt sau nếu muốn siết
> bảo mật). Password `Hoang@07082026` DÙNG ĐƯỢC qua sshpass:
> ```
> SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 "..."
> ```
>
> **Sản phẩm:** PickleTour (`https://pickletour.vn`) — nền tảng giải đấu pickleball cho thị trường Việt Nam: quản lý giải, bốc thăm, sơ đồ nhánh, chấm trận trọng tài realtime, điểm trình/BXH, CLB, đặt sân, livestream + ghi hình, tin tức AI, chatbot Pikora, app mobile.
>
> ⚠️ Tên repo là `mern-auth` và `readme.md` gốc là README của starter cũ — **bỏ qua**, không phản ánh dự án thật.

---

## 0. Hướng dẫn cho Claude bên nhận (đọc trước)

Thứ tự thực hiện khuyến nghị:

1. Đọc hết file này, đặc biệt **§3 (những thứ KHÔNG có trong git)** — thiếu chúng thì không dựng được đầy đủ.
2. Clone 3 repo (§2), nhận bộ file gửi riêng (§3), làm theo **§5 Setup local**.
3. Chạy được backend + web trước (Mongo + Redis + `npm run dev`), các service phụ (Go, worker, mobile) làm sau — chúng đều **optional** cho bản chạy cơ bản.
4. Deploy production đọc **§8** — lưu ý production là **VPS bare-metal thủ công**, KHÔNG phải chỉ chạy docker-compose là xong.
5. Quy ước bắt buộc: **mọi text tiếng Việt phải có dấu, encode UTF-8** (repo từng bị lỗi mojibake nặng — đống script `fix_mojibake*.cjs` ở root là di chứng, bỏ qua chúng). Xem thêm `AGENTS.md` (quy tắc làm UI: sửa tối thiểu, không tự ý redesign).

---

## 1. Kiến trúc tổng thể

```
                        ┌─ Cloudflare (DNS/proxy/CDN) ─┐
                        │                              │
   pickletour.vn ───────┤   nginx trên VPS (❗ config không nằm trong repo)
   admin.pickletour.vn ─┤     ├── SPA frontend (build tĩnh từ frontend/dist)
   cap.xixixo123.site ──┤     ├── /api, /socket.io, /uploads → Node API :5001
                        │     ├── /ws/rtmp → RTMP relay :5002
                        │     └── cap captcha :3100 (docker)
                        │
   VPS chính (4 core/8GB):
     - Node API (PM2 cluster ×2)  backend/server.js       :5001
     - RTMP relay (PM2)           backend/rtmpRelay.server.js :5002
     - Recording worker (PM2)     backend/worker/liveRecordingExport.worker.js
     - micro-services Go          adminsystem :8003, uploadservice :8004
     - MongoDB (host, replicaSet rs0, db `sportconnect`)  :27017
     - Redis (host / docker)                              :6379
   VPS observer riêng:
     - Go collector + Mongo riêng (docker compose)        :8787
   Cloudflare: R2 (recordings, OTA bundle), D1 (hot-updater), Worker r2-gateway (CDN), Worker check-update
   Admin SPA: deploy Vercel (repo riêng)
   Mobile: Expo app (repo riêng) + 2 app native "PickleTour Live" (Android Kotlin / iOS Swift)
```

- **Backend Node là chính** (Express, ESM, ~69 router, 98 model Mongoose, Socket.IO, Agenda + BullMQ, Apollo GraphQL chỉ còn module user đang deprecate).
- Node có 2 proxy cứng sang 2 service Go nhỏ trong `micro-services/`: `/api/admin/system` → `:8003`, upload chunk recording → `:8004`. (`backend-go/` và `ffmpeg-go-worker/` là đồ thử nghiệm **đã bỏ** — không cần quan tâm.)
- **2 thế hệ UI web** chạy song song: v1 (legacy) và v2 "Astryx", chuyển bằng cờ `SystemSettings.frontendUi.version` trong Mongo (admin đổi ở `/admin/settings`), override tạm bằng query `?ui=v1` / `?ui=v2`.

## 2. Các repo & cấu trúc thư mục

**3 repo Git riêng biệt** (2 repo con được nhúng dạng gitlink NHƯNG **không có `.gitmodules`** → `git submodule update --init` sẽ **thất bại**, phải clone tay đúng vị trí):

| Repo | Remote | Vị trí |
|---|---|---|
| Chính (backend + frontend + hạ tầng) | `https://github.com/den3110/abcdk-` (branch `master`) | root |
| Admin panel | `https://github.com/den3110/abcde` | `admin-pickletour/` |
| Mobile app | `https://github.com/den3110/pickletour-app` (branch `master`) | `pickletour-app-mobile/` |

Thư mục trong repo chính:

| Thư mục | Vai trò | Trạng thái |
|---|---|---|
| `backend/` | Node/Express API — **trái tim hệ thống**. Lưu ý: KHÔNG có `backend/package.json`; deps + `.env` + `node_modules` nằm ở **root** | active |
| `frontend/` | Web người dùng — React 19 + Vite 4 + MUI 7 + RTK Query, dev port 3000 | active |
| `admin-pickletour/` | Admin — CRA + React 18 + MUI 5 (Material Dashboard 2), ~78 route | active (repo riêng) |
| `pickletour-app-mobile/` | App Expo SDK 55 / RN 0.83, expo-router | active (repo riêng) |
| `backend-go/`, `ffmpeg-go-worker/` | thử nghiệm viết lại bằng Go — **ĐÃ BỎ, không dùng, không cần copy** (bị gitignore nên clone mới cũng không có) | bỏ qua |
| `micro-services/` | 3 service Go nhỏ: `adminsystem` (:8003, monitor VPS cho trang System), `uploadservice` (:8004, nhận chunk recording), `downloader-video` (:8001, chưa được nối) | active/partial |
| `observer-vps/` | Go collector telemetry chạy VPS riêng (:8787) | active |
| `cloudflare-workers/r2-gateway/` | Worker CDN gộp nhiều bucket R2 sau 1 hostname | active (prod) |
| `native-live-app/`, `native-live-app-ios/` | App vận hành livestream trên sân (Kotlin Compose / Swift + Live Activity), bundle `com.pkt.live` / `com.pkt.pickletour.live` | active |
| `deploy/` | systemd units, tài liệu single-server-peak, nginx snippets, observer VPS compose | active |
| `scripts/`, `backend/scripts/` | script vận hành (createAdmin, reindex ES, dọn R2, backfill...) | active |
| `videofeed/` | prototype Next.js + Supabase kiểu TikTok feed — **không liên quan** hệ thống chính | experimental |
| `uploads/` | dữ liệu user (avatar, **CCCD**, recordings staging...) — gitignore | data, cần backup |
| `docs/` | ❗ cũng bị gitignore | data |
| Rác ở root | `fix_mojibake*.cjs`, `translate_accents*.cjs`, `replace*.py`, `ui*.xml`, `*.out.log`, `*.apk/.aab`, `tmp/`, `.kilo/worktrees/` | bỏ qua, đừng dùng |

## 3. ❗ Những thứ KHÔNG nằm trong git — phải nhận riêng từ người bàn giao

Clone xong 3 repo **vẫn chưa đủ**. Cần nhận qua kênh an toàn (KHÔNG gửi qua git/chat công khai):

**File/thư mục:**
1. `.env` ở root repo chính (~195 biến; `.env.example` chỉ có ~130 và **thiếu cả** `MONGO_URI`, `JWT_SECRET`, `PORT`, `NODE_ENV`).
2. `frontend/.env` (+ `.env.local` nếu có) — các biến `VITE_*`.
3. `admin-pickletour/.env` — `REACT_APP_API_URL`, `REACT_APP_SOCKET_URL`.
4. `pickletour-app-mobile/.env` (không có file example nào) + `.env.hotupdater` (4 biến `HOT_UPDATER_CLOUDFLARE_*`).
5. `docs/` nếu cần — vì bị gitignore. (`backend-go/`, `ffmpeg-go-worker/` cũng bị gitignore nhưng **đã bỏ — không cần copy**.)
6. Mobile: `google-services.json`, `GoogleService-Info.plist`, keystore Android (`pickletour-upload-*.jks` + mật khẩu 4 biến Gradle `PICKLETOUR_UPLOAD_*`), và **source widget iOS Live Activity** (chỉ tồn tại trong project Xcode `ios 2/` — `expo prebuild` KHÔNG sinh lại được target này).
7. Trên VPS: cây `/etc/nginx/` (vhost `pickletour.vn`, `admin.pickletour.vn`, TLS/certbot), `/var/www/pickletour/.env`, config mongod (replica set `rs0`) + cron backup.
8. Observer VPS: file `.env` của nó.
9. Dữ liệu: dump MongoDB + thư mục `uploads/` (chứa ~194 ảnh CCCD — **PII nhạy cảm**, cân nhắc kỹ trước khi chuyển).

**Tài khoản/quyền truy cập:**
GitHub (3 repo) · VPS chính + VPS observer (SSH) · Cloudflare (DNS zone, R2 nhiều account, D1, 2 Workers: `r2-gateway`, `hot-updater.datistpham.workers.dev`) · Docker Hub `060802` · Vercel (admin SPA) · Expo/EAS (project id `33bf4371-b5a6-4121-a651-99f3c2f19ba2`) · Apple Developer + App Store Connect (2 app iOS, APNs key `.p8`, WeatherKit) · Google Play + Firebase · Google Cloud OAuth (YouTube/Drive) · Facebook App (`FB_APP_ID`) · Telegram bots + các group/chat id · SendGrid/SMTP · TingTing (Zalo ZNS OTP) · Sentry · Microsoft Clarity · Azure (VM worker TTS + billing) · MongoDB nếu dùng Atlas cho dev · SePay (QR chỉ là ảnh render, không cần API key) · SportConnect + proxy xoay.

## 4. Yêu cầu môi trường máy dev

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | **20 LTS trở lên** (máy hiện tại 22.17.1; Docker image dùng node:20-alpine) | không có `.nvmrc`/`engines` |
| Go | **1.25.x** | chỉ cho `observer-vps` / `micro-services` (optional) |
| MongoDB | 7.x, **bắt buộc replica set** (prod dùng `replicaSet=rs0`, db `sportconnect`) — app dùng change streams/transactions | không có trong docker-compose; tự cài hoặc Atlas |
| Redis | 7.x | có sẵn trong `docker-compose.yml` |
| Docker | bất kỳ | cho redis/cap/ES local |
| ffmpeg | system PATH hoặc `FFMPEG_PATH` | RTMP relay dùng ffmpeg hệ thống; các phần khác dùng `ffmpeg-static` |
| yarn v1 + npm | | mobile dùng yarn; frontend có cả 2 lockfile (Dockerfile ưu tiên yarn) |
| Cài native khi `npm install` | `canvas` (cần build tools — hay fail nhất trên Windows), `sharp`, `puppeteer` (tải Chromium ~150MB) | |
| Mobile | JDK 17 + Android SDK; iOS cần macOS + Xcode. **Expo Go không đủ** — phải dev build (`expo run:android`) | |

## 5. Setup local từng bước (backend + web + admin)

```bash
# 1) Clone 3 repo đúng vị trí
git clone https://github.com/den3110/abcdk- mern-auth
cd mern-auth
git clone https://github.com/den3110/abcde admin-pickletour          # đè lên gitlink
git clone https://github.com/den3110/pickletour-app pickletour-app-mobile

# 2) Đặt các file .env nhận riêng vào đúng chỗ (root, frontend/, admin-pickletour/, mobile)

# 3) Hạ tầng
docker compose up -d redis            # Redis :6379 (bắt buộc — socket monitor/BullMQ luôn kết nối)
# MongoDB: chạy mongod local dạng replica set:
#   mongod --replSet rs0 ...  rồi trong mongosh: rs.initiate()
# hoặc dùng MongoDB Atlas (connection string đặt vào MONGO_URI)
# Optional: docker compose up -d cap cap-valkey            # captcha :3100 (nếu bật CAP)
# Optional: docker compose --profile search up -d          # Elasticsearch :9200 + Kibana :5601 (ES_ENABLED=false thì khỏi)

# 4) Cài deps (backend cài Ở ROOT — không có backend/package.json)
npm install
cd frontend && npm install && cd ..
cd admin-pickletour && npm install && cd ..    # .npmrc đã có legacy-peer-deps=true

# 5) Tạo admin đầu tiên (DB trống)
npm run create-admin

# 6) Chạy dev
npm run dev        # = backend nodemon (PORT trong .env, chuẩn là 5001) + frontend Vite :3000
# Admin panel (trùng port 3000 với frontend → đổi port; 3001 đã có sẵn trong CORS whitelist):
cd admin-pickletour && set PORT=3001 && npm start          # PowerShell: $env:PORT=3001; npm start
```

**Biến tối thiểu trong `.env` root để boot được:** `NODE_ENV=development`, `PORT=5001`, `MONGO_URI`, `JWT_SECRET`, `REDIS_URL=redis://127.0.0.1:6379/0`. (`PORT` **không có fallback** trong code — thiếu là hỏng; `5001` là giá trị chuẩn vì Vite proxy + CRA proxy + nginx snippet đều trỏ `localhost:5001`.)

**Kiểm tra sống:** `GET http://localhost:5001/` trả chuỗi `API is running....`; mở `http://localhost:3000` thấy trang chủ; đăng nhập bằng tài khoản vừa tạo.

**Process optional (chạy khi cần tính năng tương ứng):**

| Lệnh | Tính năng |
|---|---|
| `npm run rtmp` | RTMP relay :5002 (livestream từ browser/app) |
| `npm run cccd:worker` | BullMQ worker OCR CCCD (cần `vie.traineddata` ở root — có sẵn) |
| `npm run recording:worker` | worker export recording → R2 (tôn trọng khung giờ đêm, xem §8) |
| `cd micro-services/adminsystem && go run .` | :8003 — thiếu thì trang System của admin lỗi 502 (tool này Linux-oriented, trên Windows gần như vô dụng) |
| `cd micro-services/uploadservice && go run .` | :8004 — thiếu thì upload chunk recording lỗi |

### Bảng port

| Port | Gì | Port | Gì |
|---|---|---|---|
| 5001 | Node API (chuẩn local + prod) | 8003 | Go adminsystem |
| 3000 | frontend Vite dev | 8004 | Go uploadservice |
| 3001 | admin CRA dev (đề xuất) | 8787 | observer |
| 5002 | RTMP relay (WS `/ws/rtmp` — **không phải RTMP 1935**) | 9200/5601 | ES/Kibana (profile `search`) |
| 3100 | cap captcha | 8081 | redis-commander (profile `ops`) |
| 6379 | Redis | 27017 | MongoDB |

## 6. Mobile app (`pickletour-app-mobile`)

- **Stack:** Expo SDK 55, RN 0.83.4, React 19.2, expo-router (typed routes), New Architecture bật, Redux Toolkit + ~40 RTK Query slice, socket.io-client. Phiên bản hiện tại 1.1.11 (build 41), id `com.pkt.pickletour`.
- **Chạy dev:** `yarn install` → `yarn start` (Metro :8081) → `yarn android` / `yarn ios` (dev build; Expo Go không đủ vì push + hot-updater + native modules). `android/`, `ios*/` là output prebuild và bị gitignore → máy mới chạy `npx expo prebuild` (⚠️ trừ widget Live Activity, xem §3 mục 6).
- **Trỏ API:** tạo `pickletour-app-mobile/.env` với các biến `EXPO_PUBLIC_*` (inline lúc build): `EXPO_PUBLIC_BASE_URL`, `EXPO_PUBLIC_API_URL` (prod: `https://pickletour.vn/api`), `EXPO_PUBLIC_SOCKET_URL`, `EXPO_PUBLIC_ENVIRONMENT` (`development`/`production`), `EXPO_PUBLIC_LAN_IP` (IP LAN máy dev — app tự thay `localhost` trong URL trả về bằng IP này), `EXPO_PUBLIC_ENABLE_HOT_UPDATER`, `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`, `EXPO_PUBLIC_CLARITY_*`, `EXPO_PUBLIC_RANK_KEY1/2`, `EXPO_PUBLIC_APP_METRIC_A/B`, `EXPO_PUBLIC_ACCESS_TOKEN_NOTIFICATION`…
- **OTA (hot-updater ^0.25):** bundle chứa trên **Cloudflare R2 + D1**, API check-update là Worker `https://hot-updater.datistpham.workers.dev/api/check-update`, channel `production`, updateStrategy `appVersion`, có kill-switch + crash rollback + telemetry về `/api/ota/report-status`. Ship OTA:
  ```bash
  cd pickletour-app-mobile     # cần .env.hotupdater
  npx hot-updater deploy -p android -t 1.1.11 -c production
  npx hot-updater deploy -p ios -t 1.1.11 -c production
  ```
  (`expo-upload.js` là đường OTA self-host cũ, đã bị hot-updater thay thế.)
- **Build store:** EAS — `npx eas build --platform ios|android --profile production` (profile trong `eas.json`, autoIncrement, appVersionSource remote; mẫu lệnh đầy đủ trong `run-eas-build.ps1`). ⚠️ Android: nếu 4 biến Gradle `PICKLETOUR_UPLOAD_*` không set, build release **âm thầm ký bằng debug keystore**.
- **Màn hình chính:** tabs (home/tournaments/live/rankings/my_tournament/chat/profile/more); giải: `app/tournament/[id]/*` (register, checkin, draw, schedule, manage, referee, console, `bracket.tsx` ~6k dòng); **chấm trận: `app/match/[id]/referee.tsx` → `components/match/RefereeScorePanel.native.tsx` — ĐÂY LÀ SOURCE OF TRUTH của UI chấm trận** (bản web phải khớp theo nó); live studio (`app/live/studio*`), KYC (`app/user/[id]/kyc.tsx`), radar Mapbox, head2head, clubs, news, support…

## 7. Biến môi trường (tên biến, theo nhóm — giá trị nằm trong bộ file gửi riêng)

- **Core:** `NODE_ENV`, `PORT`, `MONGO_URI`, `MONGO_URI_PROD` (dùng khi `NODE_ENV=production`), `MONGO_DB_NAME`, `JWT_SECRET`, `REDIS_URL`, `HOST`, `FRONTEND_URL`, `API_URL`, `COOKIE_DOMAIN`, `APP_SESSION_SECRET`, `APP_SESSION_TTL`, `WEB_ORIGINS`.
- **Email/OTP:** `SMTP_*`, `EMAIL_FROM`, `APP_NAME`, `SENDGRID_API_KEY`, `TINGTING_*` (Zalo ZNS).
- **Đăng nhập đặc biệt:** `MASTER_PASSWORD` + `ALLOW_MASTER_PASSWORD` (⚠️ backdoor đăng nhập — xem §11).
- **Captcha:** `CAP_ENABLED`, `CAP_BASE_URL`, `CAP_SITE_KEY`, `CAP_SECRET_KEY`, `CAP_ADMIN_KEY`, `CAP_CORS_ORIGIN`.
- **Storage R2:** `R2_*` (uploads chung) và `R2_RECORDINGS_TARGETS_JSON` (multi-bucket recordings) + `LIVE_RECORDING_PUBLIC_CDN_BASE_URL`.
- **Live/recording:** `RTMP_PORT`, `FFMPEG_PATH`, `LIVE_RECORDING_EXPORT_WINDOW_*` (02:00–06:00), `LIVE_RECORDING_FFMPEG_THREADS`, `LIVE_MULTI_SOURCE_ENABLED`, `LIVE_SERVER2_*`, `LIVE_SECRET_KEY_BASE64(_OLD)`, `RECORDING_EXPORT_WORK_DIR`, `GOOGLE_DRIVE_RECORDINGS_*`.
- **AI:** `OPENAI_API_KEY`, `CLIPROXY_*`, `PIKORA_*` (chatbot), `OPENAI_POSTER_*` (đọc poster đăng ký), `OPENAI_CCCD_*` + `ANTHROPIC_API_KEY` + `CLAUDE_CCCD_MODEL` (KYC), `CATGPT_GATEWAY_*` (AI import đăng ký), `SEO_NEWS_*`, `NEWS_*`, `LIVE_RECORDING_AI_*` (bình luận + TTS), `GEMINI_API_KEY`, `OLLAMA_*`.
- **Tích hợp:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_*`/`TELEGRAM_*_IDS`, `FB_APP_ID/SECRET/REDIRECT_URI`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `SLACK_*`, `SENTRY_WEBHOOK_TOKEN`, `WEATHERKIT_*`, `APNS_*` (Live Activities), `EXPO_ACCESS_TOKEN`, `HOT_UPDATER_CLOUDFLARE_*`, `AZURE_*`, `SPORTCONNECT`/`PROXYXOAY_URL`.
- **Vận hành:** `BACKGROUND_JOBS_*` (leader-only + khung đêm), `AGENDA_*`, `ES_ENABLED`/`ES_NODE`, `OBSERVER_*`, `CHECKPOINT_*`, `PEAK_RUNTIME_METRICS_*`, `MAINTENANCE_BYPASS_HOSTS`, `RANKING_SIG_A/B/META`, `CURSOR_SECRET`, `SOCKET_*`.
- **Frontend (`frontend/.env`):** `VITE_API_URL`, `VITE_API_URL_SOCKET`, `VITE_DEV_PROXY_TARGET` (để trống = proxy `localhost:5001`; đặt `https://pickletour.vn` để dev UI trên data thật), `VITE_CAP_*`, `VITE_SENTRY_*` (+ `SENTRY_AUTH_TOKEN/ORG/PROJECT` lúc build), `VITE_CLARITY_PROJECT_ID`, `VITE_QR_BANK`/`VITE_QR_ACC` (QR SePay), `VITE_APP_METRIC_A/B` (key giải mã payload ranking).
- **Admin (`admin-pickletour/.env`):** `REACT_APP_API_URL`, `REACT_APP_SOCKET_URL`.

## 8. Deploy production

**Thực trạng: có 2 "câu chuyện deploy" — chỉ câu chuyện B là production thật.**

**A. CI GitHub Actions (`.github/workflows/docker-publish.yml`):** push lên `master` → build + push 2 image Docker Hub `060802/frontend` (chỉ là "hộp đựng" `dist/` — KHÔNG có web server bên trong) và `060802/backend` (node:20-alpine, chạy `node backend/server.js`, PORT=3000 trong image). **Trong repo KHÔNG có bước deploy nào sau khi push image** (không SSH, không watchtower). ❓ *Phải hỏi người bàn giao: trên VPS cái gì pull các image này, hay deploy hoàn toàn thủ công?* Secrets CI: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

**B. VPS đơn bare-metal (topology thật, tài liệu tại `deploy/single-server-peak/README.md`):**
- App root `/var/www/pickletour`, env `/var/www/pickletour/.env`. Mongo (`mongod.service`, replicaSet rs0) + Redis chạy trên host.
- **Node:** PM2 theo `deploy/single-server-peak/ecosystem.peak.config.js` — 3 app: `pickletour-api` (cluster ×2, `backend/server.js`, max_memory 900M), `pickletour-rtmp`, `pickletour-recording-worker`. (⚠️ file `ecosystem.config.js` ở root là **bản cũ đã chết** — trỏ `dist/server.js` không tồn tại, đừng dùng.)
- `deploy/systemd/` chứa unit cho các service Go thử nghiệm (backend-go) — **đã bỏ, bỏ qua**.
- **nginx:** vhost chính KHÔNG có trong repo (xin từ server). Repo chỉ có snippet: `nginx.microcache.conf` (micro-cache 3s cho các API nóng, upstream `127.0.0.1:5001`), `nginx.graphql-audit.conf` (⚠️ trỏ `:5000` — sai lệch với 5001), `nginx.cap.conf` (vhost captcha). Cần tạo sẵn `/var/cache/nginx/pickletour`.
- **Chiến lược tải "peak":** export recording + job nền dồn vào **khung 02:00–06:00 Asia/Saigon** (`LIVE_RECORDING_EXPORT_WINDOW_*`, `BACKGROUND_JOBS_WINDOW_*`); ban ngày có thể `systemctl stop pickletour-worker-recording-export` để nhường CPU. Giám sát qua `GET /api/admin/dashboard/peak-runtime` và trang Peak Runtime trong admin.
- **Frontend:** `cd frontend && npm run build` → `dist/` được nginx/CDN phục vụ (cơ chế copy lên web root nằm ngoài repo — ❓ hỏi người bàn giao). Express **không** serve SPA (block static đã bị comment).
- **Admin SPA:** deploy **Vercel** (`admin-pickletour/vercel.json`; `genezio.yaml` là leftover). Không nằm trong CI docker.
- **Observer VPS:** build image từ root `docker build -f observer-vps/Dockerfile -t 060802/pickletour-observer:latest .` → push → trên VPS observer: `docker compose -f docker-compose.observer.yml up -d` (kèm Mongo riêng); giữ :8787 private (tailscale/firewall/SSH tunnel).
- **Cloudflare Worker CDN:** `cd cloudflare-workers/r2-gateway && npm i && npx wrangler deploy` (điền `TARGET_R2_XX_URL` thật trước).
- **iOS Live app:** workflow `ios-live-beta.yml` chạy **manual dispatch** (trigger push trỏ branch `main` không tồn tại) → fastlane build + TestFlight.
- **Sau deploy:** chạy `node backend/scripts/ensureIndexes.js` (index Mongo), và nếu bật ES thì các script reindex trong `scripts/`.

## 9. Danh mục tính năng (rút gọn — đường dẫn chính để đào sâu)

**Tài khoản & định danh** — Đăng ký/đăng nhập JWT cookie (OTP đăng ký/đăng nhập đang TẮT, hạ tầng TingTing ZNS vẫn dùng cho reset/step-up) · hồ sơ VĐV + trang public · **KYC CCCD** (QR + Tesseract + Claude vision, queue BullMQ `cccd-ocr`, admin duyệt) · **Checkpoint engine** (chặn step-up theo điểm rủi ro: OTP → CCCD → video mặt, HTTP 423 → `/checkpoint`) · Identity Security score · auth log · PickleTour làm **OAuth provider** cho app Live (`pickletour-live://auth`) · vai trò user/referee/courtOwner/admin + superAdmin + evaluator theo tỉnh. → `backend/routes/{userRoutes,checkpointRoutes,cccd.routes,identitySecurityRoutes,oauthRoutes}.js`

**Giải đấu** — CRUD giải (đơn/đôi, standard/**team**, phí + **QR SePay** chuyển khoản thủ công, geocode AI, thời tiết WeatherKit) · đăng ký + mời cặp + thay người + thanh toán (toggle tay, cả từ bot Telegram) · check-in · **bốc thăm live** (socket, sân khấu công khai `/tournament/:id/draw/live`) · bracket các loại `group/knockout/double_elim/round_robin/swiss/gsl/roundElim` + seeding (rating/random/tiered/protected, né cùng CLB) · vòng bảng (BXH tiebreaker, chèn đội muộn) · progression giữa stage · **Blueprint + AI planner** (thiết kế cả giải, preview impact) · sân/cụm sân/court station + auto-assign trận vào sân trống · phân công trọng tài · đồng quản lý giải · khiếu nại (đẩy Telegram) · cron tự kết thúc giải · tìm kiếm ES. → `backend/models/{tournament,bracket,match,registration}Model.js`, `backend/routes/{drawRoutes,progressionRoutes,bracketRoutes}.js`, admin `admin-pickletour/src/layouts/tournament/*`

**Chấm trận & vận hành trận** — console trọng tài web (`/tournament/:id/referee`, `RefereeScoreDialog`) + admin + **mobile (source of truth)** · điểm từng pha, giao bóng, timeout, break, forfeit · **khoá quyền chấm 1 thiết bị** + offline sync (bootstrap/claim/heartbeat/takeover/release) · realtime Socket.IO (room theo trận/giải/sân, Redis adapter) · **overlay OBS** `/overlay/score` + **Overlay Studio** (editor template 1920×1080, versioning) · admin sửa điểm/swap/reset chuỗi trận · trận tự tổ chức (user match, reaction/comment) · head-to-head. → `backend/controllers/refereeController.js`, `backend/socket/index.js`, `backend/controllers/refereeLiveSyncController.js`

**Điểm trình & BXH** — rating engine kiểu Elo (`ratingDelta`/`RatingChange`) · **ScoreHistory = snapshot chấm trình, là nguồn nền điểm** (Ranking chỉ là mirror để hiển thị BXH) · BXH single/double/mix + tier màu + reputation · **thu hồi điểm bracket:** `POST /api/brackets/:id/revoke-rating` (+ restore/enable/backfill, cờ `noRankDelta`) · tự chấm trình thang DUPR 1.6–8.0 · evaluator chấm theo tỉnh · import LevelPoint từ SportConnect (proxy xoay) · rating tester trong admin. → `backend/services/ratingEngine.js`, `backend/models/{scoreHistory,ranking,ratingChange}Model.js`

**CLB & đặt sân** — CLB (thành viên, join request, thông báo, poll, sự kiện + RSVP + file .ics) · venue của courtOwner + lưới giờ trống + booking + doanh thu. → `backend/routes/{clubRoutes,venueRoutes,bookingRoutes}.js`

**Livestream & ghi hình** — RTMP relay WS→ffmpeg (:5002) · điều khiển OBS qua obs-websocket · capture headless (puppeteer+ffmpeg) · **Facebook Live** (pool page hệ thống + page user, giám sát token) · YouTube Live (OAuth) · routing đa nền tảng (policy, khoá Redis) · 2 app native "PickleTour Live" cho người quay trên sân + presence sân · **Recording v2**: segment HLS → multi-bucket R2 → export đêm (worker + queue) → **Google Drive** · FB VOD → Drive · **AI bình luận** (scene detect → script LLM → TTS vi/en → mix audio) · playback đa nguồn (server 2 delay) · feed "đang live" + trang xem. → `backend/routes/liveRecordingV2Routes.js`, `backend/services/{rtmpRelay,facebookLive.service,liveRouter.service}.js`, admin monitor pages

**Nội dung & SEO** — pipeline **SEO News AI** (crawl → chấm điểm → sinh bài → sinh ảnh AI → publish, cron đêm + monitor) · news cũ + blog + banner + CMS hero/contact + sponsor marquee · sitemap + i18n vi/en + prerender puppeteer · **AI Bracket Story**. → `backend/services/seoNews*`, admin News pages

**AI khác** — **Pikora** chatbot (60+ tool đọc dữ liệu của chính user: giải/trận/điểm/lịch..., điều hướng app, mutation có kiểm soát, RAG knowledge, rollout %, ops page `/admin/pikora-ops`) · AI đọc poster đăng ký · **AI Import đăng ký** từ ảnh/file (CatGPT gateway, preview → commit) · AI Gateway (pool endpoint LLM, health, model binding) · command palette ⌘K · voice command · auto tạo user. → `backend/services/bot/*`, `backend/services/aiRegistrationImport.service.js`

**Thông báo** — Expo push (token, broadcast, match-start-soon...) · **APNs Live Activities** (Dynamic Island tỉ số) · subscriptions theo giải/VĐV · **Telegram**: bot đăng ký/KYC (nút "Đã thu/Bỏ thu" phí), kênh crash/Sentry, cầu nối support · Slack events · email SendGrid/SMTP · trung tâm hỗ trợ (ticket, admin queue). → `backend/services/notifications/*`, `backend/bot/telegramBot.js`

**Khám phá** — **Radar** tìm bạn đánh gần (Mapbox, intent, khám phá giải/CLB quanh đây) · presence online · achievements + thống kê VĐV · video hướng dẫn.

**Admin & vận hành** — 2 admin UI (panel riêng ~78 route + `/admin/*` trong frontend) · **System Settings trong Mongo điều khiển runtime**: maintenance, captcha, KYC, checkpoint, OTA/min version, recording, referee match lock, **frontendUi.version v1/v2/v3**, Pikora, Azure, AI gateway · quản lý user/role/reset password · dashboard + Peak Runtime · observer VPS + smart log + audit log + auth log · Agendash `/admin/agendash` · cache manager · Azure VM worker + billing · **OTA admin** (2 kênh: bundle store custom + Expo Updates protocol + hot-updater telemetry) · file manager + tối ưu avatar (sharp + watermark) · trang `/status` public. → `backend/models/systemSettingsModel.js`, `admin-pickletour/src/routes.js`

## 10. Gotchas quan trọng (đọc kỹ trước khi sửa code)

1. **Luôn chạy backend từ ROOT repo** — `dotenv` và `express.static("uploads")` tính theo CWD. `cd backend && node server.js` = mất `.env` + hỏng `/uploads`.
2. **`PORT` không có fallback**; chuẩn local/prod là **5001** (Vite proxy, CRA proxy, nginx microcache đều trỏ 5001).
3. **CORS whitelist hardcode** trong `backend/server.js:137` (localhost:3000, localhost:3001, pickletour.vn, admin.pickletour.vn...). Chạy frontend ở port lạ (5173...) sẽ bị chặn — thêm origin vào code hoặc dùng đúng port 3000/3001.
4. **Socket.IO mặc định websocket-only** (không polling) — client phải bật websocket; đổi qua `SOCKET_TRANSPORTS`/`SOCKET_ENABLE_POLLING` nếu cần.
5. **Mongo bắt buộc replica set** (change streams/transactions). Standalone mongod sẽ lỗi ngầm nhiều chỗ.
6. **PM2 cluster ×2:** cron/Agenda chỉ chạy trên instance 0 (`BACKGROUND_JOBS_LEADER_ONLY=true`); Socket.IO cần Redis adapter (`REDIS_URL`) khi nhiều instance.
7. **3 cách viết timezone cùng tồn tại**: `Asia/Bangkok` (script `start`), `Asia/Saigon` (.env deploy), `Asia/Ho_Chi_Minh` (fallback trong code) — cùng UTC+7, **đừng "dọn dẹp"** nếu chưa rà hết.
8. **Cấu hình runtime nằm trong Mongo (SystemSettings)**, không chỉ `.env`. DB mới tự tạo document mặc định; nhiều tính năng tắt cho đến khi bật trong admin `/admin/settings`.
9. **UI gate v1/v2:** cờ server `frontendUi.version` (qua `GET /api/app/init`) + override `?ui=v1|v2`. ⚠️ Trong `frontend/src/hook/useAstryxUi.js`, `DEFAULT_WHEN_UNKNOWN = true` — nếu `/api/app/init` chết, web mặc định rơi vào UI mới. Quy ước của dự án: **prod giữ default v1**, UI thử nghiệm gate sau `?ui=v2`.
10. **React 19 (frontend + mobile):** cẩn thận thư viện cũ dùng `defaultProps` trên function component (React 19 đã bỏ — cảnh báo #130); `react-toastify` đã lên v11. Admin panel vẫn React 18 + MUI 5 — **không share code** với frontend.
11. **Chấm trận:** panel mobile `RefereeScorePanel.native.tsx` là chuẩn; sửa bản web thì diff theo mobile, không tự chế hành vi mới.
12. **Bracket:** (a) seed có thể trỏ tới trận không tồn tại (kiểu nhãn `W-V4-T6`) — đã có guard/fallback ở ~7 chỗ cả web lẫn app, **đừng sửa công thức sinh nhãn**, chỉ vá guard; (b) `roundElim` có "trận lẻ" thật do BE dùng **ceil** (từng bug floor → FE tự vẽ thẻ synthetic không chọn được; giải cũ tự upsert khi load `view=bracket`).
13. **Nhiều bản UI/file trùng lặp còn sống:** `HomeScreenV2.jsx` (chết), `RegisterScreen-v1.jsx`, `RefereeScorePanel.native-v1.tsx`, `App.backup.jsx`, 4 bản `ios copy*` trong mobile — xác nhận bản canonical trước khi sửa.
14. **Astryx routes bị duplicate 2 nơi:** thêm trang v2 mới phải sửa cả gate component lẫn mảng `ASTRYX_ROUTES` trong `frontend/src/App.jsx`.
15. `.env.example` **thiếu** biến core (Mongo/JWT/PORT) — đừng lấy nó làm chuẩn; chuẩn là file `.env` thật gửi riêng.
16. Mọi thứ dính `backend-go` (scripts `backend-go:*` trong `package.json`, block `BACKEND_GO_*` trong `.env`, unit `deploy/systemd/pickletour-*`, probe go-api trên trang status admin) là tàn dư thử nghiệm **đã bỏ — bỏ qua hết**. Chỉ còn 2 proxy cứng :8003/:8004 tới `micro-services/` là đang dùng.
17. Metro (`metro.config.cjs`) blocklist các thư mục `ios copy*`, `ota-build`... — đừng xoá blocklist, Metro sẽ nghẹn.
18. OTP đăng ký/đăng nhập đang **tắt có chủ đích** (route bị comment "OTP tạm tắt") — đừng bật lại khi chưa hỏi.

## 11. Bảo mật — việc PHẢI làm khi bàn giao

1. 🔴 **Rotate Telegram bot token** — `.env.example` dòng 1 đang commit một token thật lên GitHub.
2. 🔴 **Rotate `OBSERVER_API_KEY` + `OBSERVER_READ_API_KEY`** — `deploy/observer-vps/.env.example` commit giá trị thật (prefix `pt_obs_`).
3. 🔴 **`.env` root từng bị track trong lịch sử git** (commit "Stop tracking .env") — mọi secret cũ coi như lộ với ai có quyền repo → đổi cả bộ (JWT_SECRET, Mongo password, API keys...) khi chuyển giao quyền truy cập repo, hoặc chấp nhận rủi ro nội bộ một cách có chủ đích.
4. ⚠️ `MASTER_PASSWORD` + `ALLOW_MASTER_PASSWORD` = đăng nhập vạn năng — tắt ở prod hoặc kiểm soát chặt.
5. ⚠️ `/admin/agendash` mount **trước** middleware auth — phải chặn bằng nginx (xác nhận vhost thật có chặn không).
6. ⚠️ `uploads/cccd/` (~194 ảnh CCCD) đang serve tĩnh với `Access-Control-Allow-Origin: *` — cân nhắc chuyển sang luồng download bảo vệ (`/dl/file/:id` + X-Accel-Redirect đã có sẵn).
7. ⚠️ `/api/openai/test-*` là endpoint chẩn đoán đang mount public; observer compose mở `8787:8787` ra mọi interface (README dặn giữ private).
8. Mobile: `.env` (chứa token) **không** bị gitignore trong repo mobile — kiểm tra trước khi public repo; keystore `.jks` + `.pem` đang nằm trong working tree.

## 12. Câu hỏi còn mở — hỏi người bàn giao

1. Cơ chế deploy thật trên VPS sau khi CI push image `060802/*` là gì (watchtower? pull tay? hay không dùng image mà chạy source trực tiếp)? Và bước copy `frontend/dist` lên web root?
2. Xin cây `/etc/nginx/` (vhost + TLS) của cả 2 domain + xác nhận có chặn `/admin/agendash`, `/graphql` chưa (snippet audit đang trỏ `:5000` sai lệch với `:5001`).
3. Backup MongoDB hiện chạy thế nào (cron? `observer:backup-snapshot`?), lịch và nơi lưu?
4. Nguồn Xcode chứa widget Live Activity (`ios 2/`) — bản nào là bản đã ship build 41?
5. Tài khoản Cloudflare nào giữ Worker `hot-updater.datistpham.workers.dev` (khác account R2 chính không)?
