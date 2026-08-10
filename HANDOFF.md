# PickleTour — HANDOFF Session (2026-08-10 → 2026-08-11)

> Session dài **1 ngày**, ~35+ commits, chia 5 nhóm việc lớn.
> Đọc kèm `HANDOVER.md` (bàn giao gốc từ đội cũ) để nắm kiến trúc.
>
> **Nhóm việc trong session này:**
> 1. **Feed hoàn thiện** — video thumbnail, aspect ratio, comment media,
>    reactions viewer, realtime, mention populate, keyboard fix, guest view
> 2. **Notification prefs** — chat/feed mute all + per-DM mute
> 3. **MLP tournament ĐẦY ĐỦ** — hoàn thiện 6 phase: standings + auto
>    recompute, referee/court, realtime socket, knockout bracket, rating
>    hook, push noti, admin moderation, check-in, tiebreaker, reporting
>    CSV, overlay template, MOBILE MLP UI (4 screens), court cluster
>    integration
> 4. **Poker Texas Hold'em multiplayer** — engine đầy đủ, 6 ghế, timer 30s
>    auto-action, chat trong bàn, emoji reactions, khoe bài, mời bạn qua
>    bảng xếp hạng, raise slider, speech bubble, avatar, dealer minh hoạ,
>    chip flight animation, âm thanh mỗi action, reconnect khi mất mạng,
>    auto-huỷ bàn idle 5 phút
> 5. **Bug fixes** — icon `?` sau OTA, MLP lineup dialog trống, keyboard che
>    modal, luật poker preflop BB option, layout fit màn hình

---

## 1. Trạng thái deployment hiện tại

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `981ff432` | 🔴 **CHƯA deploy** — cần `git pull + pm2 restart`. Nhiều feature mới không hoạt động cho tới khi restart. |
| **Frontend web** (`pickletour.vn`) | commit `9ff8015e` | 🔴 **CHƯA build/rsync** — mất phần lớn feature web (feed reactions, MLP standings, dialog Chọn lineup fix populate…). |
| **Admin panel** (`admin.pickletour.vn`) | không đổi | ✅ Không có commit mới cho admin trong session này. |
| **Mobile iOS TestFlight** | `1.1.13 (43)` cũ | 🟡 Native binary cũ; toàn bộ feature ship qua OTA. Vẫn chưa submit App Review. |
| **Mobile Android Play** | `1.1.13 (43)` LIVE | ✅ Rollout xong từ trước. |
| **OTA hot-updater** | Latest bundle `Poker: chip fly + stack + audio` | ✅ Deployed cho cả 4 target `iOS/Android × 1.1.9/1.1.13` production. User mở app sẽ tự pull bundle mới. |
| **Overlay Generator VPS** | template MLP mới sẵn ở local, chưa scp | 🟡 File `overlay-template-mlp.html` nằm ở `/Users/admin/Desktop/Giai Thien truong/generator/` — cần scp + restart. |

**Git remotes:**

| Repo | Latest commit |
|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `981ff432` |
| `github.com/den3110/pickletour-app` (mobile) | `745482e` |
| `github.com/den3110/abcde` (admin) | không đổi từ session trước |

---

## 2. Feature ship trong session

### 2.1 Feed (bảng tin) — hoàn thiện

**Backend**
- Comment thêm field `media[]` (type/url/mime/sizeBytes/width/height, max 4), `content` không còn required.
- Endpoint mới: `GET /api/feed/:id/reactions`, `GET /api/feed/comments/:cid/reactions` (trả reactor + countByType, populate user với AUTHOR_FIELDS).
- Fix: `listComments` + `createComment` giờ `populate("mentions", AUTHOR_FIELDS)` → mention nổi màu + click được profile trên cả mobile lẫn web.
- Socket handlers `feed:post:subscribe/unsubscribe` + `feed:list:subscribe/unsubscribe` (backend đã emit sẵn nhưng client không join room → event chết).
- Rate limit: `rlPost` đổi từ 1h→**24h/10 bài**, thêm `rlCommentMedia` 24h/100 comment kèm media (skip khi body.media rỗng).

**Mobile**
- Chat DM: video message hiện frame đầu làm thumbnail (VideoView paused, muted).
- Post detail:
  - `useFocusEffect` refetch mỗi lần focus — fix bug "tap noti không thấy reply".
  - Realtime socket subscribe `feed:post:${id}`, listen `feed:comment:*`, `feed:post:*`, `feed:reaction:*` → invalidate cache.
  - Auto-expand reply khi vừa submit (`justRepliedTo` state, reset 4s).
- Feed tab: realtime `feed:post:new/deleted/updated` + reaction update, focus refetch.
- **AspectImage component**: `Image.getSize()` runtime + cache — fix ảnh panorama bị crop trung tâm (backend không lưu width/height).
- Comment composer: nút đính kèm ảnh/video max 4, spinner khi upload, preview thumbnail có X. Render bubble comment: ảnh dùng `react-native-image-viewing` fullscreen, video `VideoView` inline nativeControls.
- Post detail comment: nút Thích (long-press picker 6 emoji), reaction count tap mở ReactorsModal.
- **Video thumbnail chi tiết bài viết**: `PostVideoThumb` (VideoView paused muted contentFit cover + overlay Play), single + multi-slide.
- Post detail input không bị bàn phím che: `ScrollView flex:1`.

**Web** ([frontend/src/screens/FeedPage.jsx](abcdk/frontend/src/screens/FeedPage.jsx))
- Comment composer: nút đính kèm (file input), preview + xoá.
- Comment mention: `TextField` đổi sang `MentionAutocomplete` — gõ `@` hiện dropdown.
- Comment reactions với hover picker 6 emoji + count tap dialog.
- **FeedMediaLightbox** (Facebook-style): fullscreen media pane trái + sidebar phải (header, content, stats, reaction bar, CommentThread expanded). Keyboard ←→ chuyển ảnh.
- ReactorsDialog: tab lọc theo type (tất cả + 6 emoji).
- Auto-expand phản hồi khi `replyCount > 0` (giống mobile).
- **Guest xem được**: bỏ full-page block `if (!me)`, Composer replaced by `GuestBanner`, `useRequireLogin(me)` hook gate mọi action (`window.confirm` + navigate).

### 2.2 Notification preferences

**Backend**
- `User.notificationPrefs` embedded: `chatMuteAll`, `feedMuteAll` (defaults false).
- `GET/PATCH /api/users/notification-prefs`.
- `chatNotifier` filter `chatMuteAll` (song song `conversation.mutedBy`).
- `feedNotifier` filter `feedMuteAll` cho cả 3 luồng (mention comment, comment/reply chủ post, mention post body).

**Mobile**
- Profile → Cài đặt → 2 Switch: "Tắt thông báo tin nhắn" / "Tắt thông báo bảng tin".
- Header chat DM: icon 🔔/🔕 toggle per-conversation mute (`patchConversation`).

### 2.3 MLP tournament — ĐẦY ĐỦ

**Phase 1 — Đợt đầu** (~1200 dòng)
- Backend: `Tournament.mlpConfig`, `MlpTeam`, `MlpDualMatch`, controller ~741 dòng, 15 endpoints (config, team CRUD, dual generate roundrobin/single-elim, lineup, syncScore, DreamBreaker start/point/undo).
- Web: `MlpTeamsPage`, `MlpDualsPage`, `MlpDualDetailPage`, `MlpConfigDialog`.

**Phase 2 backend deep** ([bd1b819b](https://github.com/den3110/abcdk-/commit/bd1b819b))
- **Rating hook** — `applyRatingForMlpSubMatch` trong ratingEngine, zero-sum per-person, RatingChange log với `match = subMatchId`, wire vào `syncSubMatchResult`, idempotent qua `sub.result.ratingApplied`.
- **Court integration** — `GET /courts` (query Court + CourtStation dedup) + `POST /auto-assign-courts` (round-robin). Sau đó bỏ auto-assign UI, thêm nút "Quản lý cụm sân" mở `TournamentCourtClusterDialog` dùng chung.
- **Knockout bracket** — `POST /duals/generate-knockout` (seed 1 vs N từ BXH, pad BYE, round=2+).
- **Push notification** — `mlpNotifier.js`: team approve/reject + dual finished.

**Phase 5+6 backend**
- Standings + auto-recompute + head-to-head tiebreak.
- Realtime socket `mlp:dual:${id}` emit `mlp:sub:score`, `mlp:db:score`, `mlp:dual:updated`, `mlp:dual:finished`.
- Admin moderation: `force-finish`, `delete dual`.
- Check-in per side (captain hoặc BTC).
- Reporting: `GET /export/standings.csv` (BOM UTF-8), `results.csv` (dual + sub-match), `summary.json` (champion, runner-up).
- Referee + court/courtStation + scheduledAt + note trong `MlpDualMatch`, `PATCH /duals/:id`, populate đầy đủ trong `getMlpDual` (nested populate cho team.players — fix dialog Chọn lineup không hiện VĐV).

**Web MLP**
- `MlpStandingsPage` (route `/tournament/:id/mlp/standings`), nút BXH ở MlpDualsPage.
- `DualAssignmentPanel` (Autocomplete tìm trọng tài, dropdown Court/Station, datetime-local, note, check-in Team A/B).
- Nút BXH + Sinh knockout + Quản lý cụm sân trong MlpDualsPage.
- MlpDualDetailPage realtime subscribe.
- Route knockout, standings, download CSV.

**Mobile MLP** ([7214149](https://github.com/den3110/pickletour-app/commit/7214149)) — 1347 dòng
- `slices/mlpApiSlice.ts` (TypeScript, 12 endpoints).
- 4 screens: `app/tournament/[id]/mlp/teams`, `duals`, `standings`, `dual/[dualId]`.
- Dual detail: team header + check-in, sub-match score editor, DreamBreaker panel (+1 A/B + undo), realtime socket subscribe.
- Home tab shortcut "MLP" (icon shield-star vàng) khi `tournamentMode === "mlp"`.

**Overlay MLP** — `/Users/admin/Desktop/Giai Thien truong/generator/overlay-template-mlp.html` (chưa scp lên VPS).

### 2.4 Poker Texas Hold'em multiplayer — TÍNH NĂNG MỚI

Full-stack multiplayer poker chip vui chơi (không tiền thật, tránh vấn đề pháp lý cờ bạc).

**Backend** ([backend/models/pokerRoomModel.js](abcdk/backend/models/pokerRoomModel.js), [pokerEngine.js](abcdk/backend/services/pokerEngine.js), [pokerController.js](abcdk/backend/controllers/pokerController.js), [pokerRoutes.js](abcdk/backend/routes/pokerRoutes.js))
- **Model PokerRoom**: seats[6] embed (user/chips/cards/betThisStreet/betTotal/hasFolded/isAllIn/lastAction), board, deck, pot, actions[], winners[], `turnDeadlineAt`, `messages[]`, `reveals[]`, `actedThisStreet[]`, status.
- **Engine**: shuffle Fisher-Yates, `evaluate5`/`evaluate7` (rank 1-10 straight flush → high card + tiebreak lex), `startHand` (rotate dealer, blinds SB/BB, deal 2 lá mỗi seat), `applyAction` (fold/check/call/raise/allin) với minRaise + `actedThisStreet` chuẩn (fix BB option preflop — heads-up dealer call → BB check → chia flop luôn), advance street preflop→flop→turn→river→showdown, showdown chia pot (main pot only cho MVP — chưa side pot).
- **13 endpoints**: list/create/get room, sit/leave, startHand, action, chat, emoji, reveal, invite. `sit` cho user buy-in cố định, `leave` fold + reset seat.
- **Timer 30s**: `scheduleTimeout(roomId)` map roomId→setTimeout. Hết giờ → `autoAct` fold (nếu có toCall) hoặc check. Broadcast + reschedule cho actor kế. In-memory: server restart mất timer.
- **Auto-huỷ bàn**: `closeStaleRooms` đóng bàn open có `lastActivityAt` quá 5 phút — chạy lazy khi list lobby + `setInterval(60_000)`. Guard sit/start trên bàn `closed`.
- **Chat + emoji + reveal**:
  - `POST /chat {text}` — max 300 char, cap 100 tin, emit `poker:room:chat`.
  - `POST /emoji {emoji}` — whitelist 9 emoji (👍❤️😂😮😢😡🔥👏🎉), ephemeral, emit `poker:room:emoji`.
  - `POST /reveal` — khoe bài sau ván (stage=waiting), cards vẫn còn trên sub state. Emit `poker:room:reveal`.
- **Mời bạn** ([981ff432](https://github.com/den3110/abcdk-/commit/981ff432)):
  - `POST /invite {userIds}` — expo push + in-app noti kind `POKER_INVITE` với `data.url = /poker/:id`. Rate limit **30/giờ/user** (in-memory).
- **Socket subscribe** `poker:room:${id}`.

**Mobile** ([app/poker/](abcdk/pickletour-app-mobile/app/poker/)) — ~2500 dòng
- **`slices/pokerApiSlice.ts`** — 10 endpoints (list/create/get, sit/leave, startHand, action, chat, emoji, reveal, invite).
- **`app/poker/index.tsx`** — Lobby: FlatList bàn (SB/BB/Buy-in/seats), refresh pull, modal Tạo bàn (name/SB/BB/buyIn) với `KeyboardAvoidingView`.
- **`app/poker/[id].tsx`** — Table:
  - Bàn oval casino thật (rail gỗ nâu, felt xanh inner ring, seat theo ellipse).
  - Hero luôn ngồi đáy bàn (rotate mapping theo `seatIndex - heroIndex`).
  - Card component: lật scaleX 0→1 + rơi nhẹ + bounce, back xanh 2 lớp viền.
  - **Chia bài từng lá**: `shownBoardCount` lật thêm 1 lá/650ms → all-in runout flop→turn→river lần lượt, không dumping cả cụm. Winner + haptic win/lose chỉ hiện sau board hết.
  - Timer bar avatar (xanh > cam > đỏ) + badge center countdown.
  - Dealer 🤵 minh hoạ giữa bàn.
  - Winner: 👑 crown + seat glow xanh + revealedCards lật lần lượt.
  - **Chip flight** (ChipFly): bắn 1–5 chip visual từ seat sang pot theo parabola khi có call/raise/allin/blind (`log2(amount/BB+1)`).
  - **Chip stack dưới ghế**: cột chip màu (vàng/xanh/tím/đỏ) offset -12px + text màu vàng.
  - **Speech bubble chat**: mỗi tin mới hiện bong bóng trắng trên avatar sender 4s (spring in → 3.4s → fade), không cần mở modal.
  - **Emoji floating**: FAB 😄 vàng → picker 9 emoji → floating animated bay lên 60px + scale 1.4x + fade 1.8s.
  - **Raise slider**: PanResponder track cam + thumb vàng + số chip lớn + 4 preset (MIN/1/2 Pot/POT/ALL IN). Auto reset khi hết lượt.
  - **Invite FAB** tím → modal search user (`useLazySearchUserQuery`) multi-select + gửi mời.
  - **Reveal** ("Khoe bài"): nút cam khi mySeat còn cards + stage=waiting.
  - **Chat FAB** xanh dương → modal bottom sheet lịch sử.
  - **Reconnect**: nghe `AppState.active` + `NetInfo.isConnected` + `socket.disconnect` → force reconnect (connect socket + resubscribe + refetch, retry mềm 2s). Polling fallback 5s khi offline. Badge trạng thái cam/đỏ đầu màn.
  - **Sound + haptic**: `pokerSounds.ts` — pool 4 `expo-audio` player với `assets/sfx/click4.mp3`, mỗi action khác volume + rate (chip 1.4x, raise 0.9x, allin 0.75x, win 1.3x, warning 1.6x…). Song song với haptic đã có.
- **Home tab** feature "Poker" (icon game-controller đỏ, NEW).

### 2.5 Bug fixes trong session

- **Icon `?` sau OTA** — vector-icons fonts không load được từ native binary do asset registry mismatch. Fix: ép include Ionicons/Feather/MaterialIcons/MaterialCommunityIcons/AntDesign qua `require()` vào `useFonts` ở `app/_layout.tsx`.
- **MLP dialog Chọn lineup trống** — `getMlpDual` populate `teamA/teamB` với select `players` nhưng không nested populate → trả `[ObjectId]` thô. Fix: `populate({path: "teamA", populate: {path: "players", select: ...}})`.
- **Keyboard che modal Tạo bàn poker** — bọc sheet trong `KeyboardAvoidingView` iOS padding.
- **Luật poker preflop BB option** — cũ dựa vào `lastAction === "post_bb"` bị ghi đè khi BB check. Fix: refactor `actedThisStreet[]` chuẩn, blinds không tính là acted, raise reset về `[raiser]`, street end khi `allMatched && everyoneActed`.
- **Layout poker không fit màn hình + winner đè seat** — bỏ ScrollView chuyển sang flex (bàn `flex:1 minHeight:340`), winner banner đổi thành overlay `position:absolute top:58%` với nền tối + shadow.

---

## 3. Bug fix + Landmine đã ghi nhận

### 3.1 OTA vẫn dùng `./node_modules/.bin/hot-updater` (0.25.14)
Vẫn giữ nguyên như HANDOFF trước — CLI 0.25.4 (npx) build bundle không tương thích native 0.25.14.

### 3.2 SSH VPS chỉ auth key (KHÔNG password)
- HANDOVER §5.1 confirm: `PasswordAuthentication=no` trên VPS. `sshpass -p Hoang@07082026` cũng không dùng được.
- Deploy backend + web + overlay generator phải chạy từ máy có SSH key.

### 3.3 Poker timer + rate limit in-memory
- Timer setTimeout + inviteCounters Map trong controller — server restart mất timer đang chờ + reset counter. MVP OK, production nên chuyển sang Bull queue / Redis nếu cần production-grade.

### 3.4 Poker main pot only
- Chưa xử lý side pot khi có 3+ người all-in với chip khác nhau. MVP chấp nhận winner all-in nhận toàn bộ pot dù stack nhỏ hơn.

### 3.5 Overlay MLP chưa deploy
- Local template ở `/Users/admin/Desktop/Giai Thien truong/generator/overlay-template-mlp.html`.
- SSH không được từ máy này → cần user chạy scp.

### 3.6 Feed populate mentions dấu ` ` (space) trong nickname
- MentionText hoạt động OK cho nickname có space (regex đã support đến 3 từ). Test khi nickname 4+ từ có thể lỗi.

---

## 4. Việc còn dở

### 4.1 Priority cao — deploy

- 🔴 **Backend prod**: `ssh root@103.90.225.130 "cd /abcdk- && git pull origin master && pm2 restart server"` — bắt buộc để các feature mới (poker + MLP endpoints + feed populate mentions + notification prefs) hoạt động.
- 🔴 **Frontend web build+rsync**: `cd frontend && yarn build:deploy` — user cần thấy Feed lightbox, MLP standings, ReactorsDialog, dialog Chọn lineup fix.
- 🟡 **Overlay generator template MLP**: scp `overlay-template-mlp.html` lên `/root/overlay-generator/` + `systemctl restart overlay-gen`.
- 🟡 **iOS App Review 1.1.13 (43)**: build đã trên TestFlight, cần Submit for Review từ App Store Connect.

### 4.2 Priority thấp — polish poker

- 🟡 **Side pot** khi có multi-all-in với chip khác nhau.
- 🟡 **Audio files riêng cho từng action** (chip, deal, card shuffle, win jingle) — hiện dùng chung `click4.mp3` với volume/rate variation. Đặt file mới vào `assets/sfx/` và map trong `pokerSounds.ts`.
- 🟡 **Tournament mode** poker (blind level tăng dần theo thời gian).
- 🟡 **Chip refill daily** — mỗi ngày user được cấp free X chip.
- 🟡 **Hand history / replay** — hiện tại chỉ giữ `actions[]` gần nhất, không có history riêng.
- 🟡 **Rate limit invite Redis** — hiện in-memory, chỉ chống spam tương đối.

### 4.3 Priority thấp — MLP

- 🟡 **Regenerate overlay cho MLP dual** — cần render HTML template mới cho từng dual (chưa có UI tạo overlay MLP như single match).
- 🟡 **PDF certificate cho champion** — hiện chỉ CSV + summary.json. Client render PDF từ summary?
- 🟡 **Admin panel dedicated MLP moderation page** — hiện chỉ endpoint backend, chưa có UI riêng ở admin (dùng web `/tournament/:id/mlp/duals` cũng đủ).

### 4.4 Nice-to-have

- **Poker private room** — password protect + share link.
- **Poker replay hand** — xem lại ván bất kỳ với action log.
- **MLP mobile référee mode** — hiện referee assign xong nhưng chưa có màn hình chấm chuyên biệt trên mobile.
- **Feed video processing** — thumbnail server-side (hiện dùng VideoView paused frame đầu).

---

## 5. Environment cần biết

### 5.1 VPS credentials

```
Host: 103.90.225.130
User: root
Password: Hoang@07082026 (KHÔNG DÙNG ĐƯỢC — PasswordAuthentication=no)
Chỉ auth qua SSH key. HANDOVER.md có nói password cũ Hoang@0726 cũng không work.
```

### 5.2 OTA hot-updater

- Bundle store: Cloudflare R2, DB: Cloudflare D1
- CLI: `./node_modules/.bin/hot-updater` (0.25.14 khớp native)
- Kill switch: `https://pickletour.vn/api/auth/system/ota/allowed`
- Deploy pattern:
```bash
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a
for combo in "ios 1.1.13" "android 1.1.13" "ios 1.1.9" "android 1.1.9"; do
  p=$(echo $combo | awk '{print $1}')
  t=$(echo $combo | awk '{print $2}')
  rm -rf .hot-updater/output 2>/dev/null
  ./node_modules/.bin/hot-updater deploy -p $p -t $t -c production -m "message"
done
```

### 5.3 Node versions

- Backend + Frontend dev: Node 20 (v20.20.2)
- Hot-updater CLI + Wrangler: Node 22 (nvm v22.23.2)

### 5.4 Repo paths trong máy dev

- Root: `/Users/admin/Desktop/Projects/Pickletour/abcdk`
  - Backend: root/backend
  - Frontend web: root/frontend
- Mobile: `/Users/admin/Desktop/Projects/Pickletour/abcdk/pickletour-app-mobile`
- Admin: `/Users/admin/Desktop/Projects/Pickletour/abcdk/admin-pickletour`
- Overlay generator local: `/Users/admin/Desktop/Giai Thien truong/generator/`

---

## 6. Deploy checklist cho session mới

```bash
# 1. Backend prod (BẮT BUỘC — nhiều feature không hoạt động cho tới khi restart)
ssh root@103.90.225.130 "cd /abcdk- && git pull origin master && pm2 restart server"

# 2. Frontend web build + rsync
ssh root@103.90.225.130 "cd /abcdk-/frontend && yarn build:deploy"

# 3. Overlay MLP template
scp "/Users/admin/Desktop/Giai Thien truong/generator/overlay-template-mlp.html" \
  root@103.90.225.130:/root/overlay-generator/
ssh root@103.90.225.130 "systemctl restart overlay-gen"

# 4. iOS Submit for Review (từ App Store Connect UI, không qua SSH)
```

---

## 7. Snapshot commit history session

**Backend + web** `abcdk-`: `07baed33 → 981ff432` (~40 commits)

Landmark commits:
- Feed: `24584c8d` (từ session trước) → **video thumbnail chat + realtime + AspectImage + reactions + FeedMediaLightbox + guest view + mention populate fix**
- Notification: `edc5fe4a`
- MLP Phase 1: `23524b5e` (standings + assignment + realtime)
- MLP Phase 2/5/6: `bd1b819b` (rating hook + court + knockout + push + admin + check-in + tiebreaker), `ee4271d5` (reporting CSV)
- MLP misc: `3957ede3` (fix lineup dialog populate), `9ff8015e` (quản lý cụm sân)
- Poker: `9096244f` (core), `a2445deb` (timer + chat), `0fdc18de` (emoji + reveal), `c536b12d` (BB option fix + auto-huỷ), `981ff432` (invite)

**Mobile** `pickletour-app`: `2af610f → 745482e` (~35 commits)

Landmark commits:
- Feed mobile: video thumb chat, realtime, AspectImage, comment media, reactions, lightbox, keyboard fix, mention populate, guest view
- MLP mobile: `7214149` (slice + 4 screens)
- Poker mobile: `40003c0` (core UI), `eae7e18` (haptic + emoji + dealer + khoe bài), `1b08e42` (đại tu UI oval + chia bài từng lá), `501a97a` (reconnect), `f75b5cf` (invite + raise slider + speech bubble), `745482e` (chip fly + stack + audio)
- Fix icon `?`: đã bao gồm trong OTA batch cùng poker

---

## 8. Câu hỏi còn mở

1. Poker chip có nên link với điểm rank không, hay giữ chip riêng (hiện buy-in cố định 1000/ván khi ngồi vào bàn).
2. Có cần side pot cho poker MVP hiện tại hay đợi feedback user?
3. MLP overlay dual template — có cần regenerate cho các giải MLP đã tồn tại, hay chỉ áp dụng cho giải mới?
