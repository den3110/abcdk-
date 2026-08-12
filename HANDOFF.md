# PickleTour — HANDOFF Session (2026-08-12 → 2026-08-13)

> Session cực dài ~2 ngày, **58 commits root + 38 commits mobile**. Chủ đề chính là
> **Games platform hoàn chỉnh 6 game** (Poker cũ + 5 game mới: Phỏm/Sâm/Caro/Cờ Vua/Cờ Tướng),
> cộng bug fix + UX cho MLP tournament + đăng ký giải.
>
> Session trước (2026-08-11 → 12) tập trung MLP vòng bảng + waitlist đăng ký + polish.
> Đọc HANDOFF cũ ở [git tag `session-2026-08-12`](https://github.com/den3110/abcdk-) nếu cần.
>
> Đọc kèm `HANDOVER.md` §0 mục "Session 2026-08-12→13" để nắm state hiện tại.

---

## 1. Trạng thái deployment

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `f9819f31` | ✅ Đã `pm2 restart server` sau commit cuối. `npm install chess.js` đã chạy trên VPS. |
| **Frontend web** (`pickletour.vn`) | ~`bcef4390` | ✅ Rebuild + rsync xong turn giữa session (BTC + MLP fixes). Session này CHỦ YẾU sửa mobile, nên frontend web KHÔNG có thay đổi mới sau đó. |
| **Mobile iOS OTA production** | Bundle `9bb3781` | ✅ Deploy **CHO CẢ `ios 1.1.13` + `ios 1.1.9`** (~15 lần push trong session). Session này push cả **Android target** `1.1.13` + `1.1.9` sau khi user override policy. |
| **Mobile Android build local** | 1.1.13 (build 43 native, JS OTA `9bb3781`) | ✅ Build `pickletour-1.1.13.apk` (115MB) + `.aab` (160MB) tại `~/Desktop/pickletour-android/`. Chưa upload Play Console. |
| **Admin panel** (Vercel) | không đổi | — |

**Git remotes:**

| Repo | Latest commit |
|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `f9819f31` |
| `github.com/den3110/pickletour-app` (mobile) | `9bb3781` |
| `github.com/den3110/abcde` (admin) | không đổi |

---

## 2. OTA target policy

User đã đổi policy giữa session (memory `ota_targets.md`):

- **Trong session build tăng dần**: chỉ push `ios 1.1.13` mỗi commit, giữ `1.1.9` chờ đợt cuối
- **Khi user báo "xong hết" / "final"** → push cả 4 target: iOS `1.1.13` + `1.1.9`, Android `1.1.13` + `1.1.9`
- Session này đợt cuối user đã đẩy cả 4 target sau khi ship Games hub v1

Từ giờ mỗi lần build tính năng liên tục dùng rule mới. HANDOFF cũ §3.3 ("push cả 2 target") **đã lỗi thời** cho iOS-only.

---

## 3. Feature ship trong session

### 3.1 Bổ sung MLP tournament (nửa đầu session)

**`mlpConfig.maxTeamScore`** — cap tổng điểm ĐÔI của roster team ([`4bd4c6d1`](https://github.com/den3110/abcdk-/commit/4bd4c6d1)):
- Schema field `MlpConfigSchema.maxTeamScore` (Number, null = không giới hạn)
- Backend `createMlpTeam` + `updateMlpTeam` validate `computeTeamDoubleScore()` từ Ranking bulk
- Web `MlpConfigDialog` TextField "Giới hạn tổng điểm trình đôi" + `MlpTeamsPage.TeamEditor` chip Tổng đôi/cap đổi đỏ + Alert + disable Save
- Mobile `teams.tsx` mirror

**Fix `TournamentCourtClusterDialog`** ([`0026030f`](https://github.com/den3110/abcdk-/commit/0026030f)):
- Trọng tài thêm qua "Quản lý trọng tài" mới không hiện trong dropdown "Đứng sân" — do 2 endpoint song song:
  - `/api/admin/tournaments/:tid/referees` (legacy, User.referee.tournaments)
  - `/api/tournaments/:tid/referees` (mới, TournamentReferee collection)
- Fix: dùng slice mới + union với legacy để backward-compat. Share tag `TournamentReferees:tid` → thêm/xoá auto-invalidate

**BTC section trên trang đăng ký** ([`bcef4390`](https://github.com/den3110/abcdk-/commit/bcef4390), [`762213fb`](https://github.com/den3110/abcdk-/commit/762213fb)):
- Backend `getTournamentById`: populate `createdBy` + `managers.user` với `name/nickname/avatar/phone`
- Web/mobile: card "Ban tổ chức" ngay dưới hero, list card avatar + nhãn "Người tạo giải · Đồng quản lý"
- **3 icon action**: tap card → mở PublicProfileDialog (dùng `getUserId({user: uid})` — bug shape đã fix), icon 💬 "Nhắn tin" mở DM qua `useOpenDmMutation` + navigate `/messages/:cid`, icon 📞 → tel: link

**MLP registration view + team list**:
- `MlpTournamentRegistrationView.jsx` TeamFormDialog: chip Đôi/Đơn ở search dropdown + roster + bar tổng đôi/cap + warning overCap ([`d0e83688`](https://github.com/den3110/abcdk-/commit/d0e83688))
- Team list card danh sách team đã đăng ký hiện điểm mỗi VĐV + tổng đôi/đơn team ([`05e64397`](https://github.com/den3110/abcdk-/commit/05e64397))
- Mobile MlpTeamsScreen card cũng hiện chip điểm

### 3.2 Games platform — 6 game hoàn chỉnh

**Restructure home icon** ([`0837b6e1`](https://github.com/den3110/pickletour-app/commit/0837b6e1)):
- Icon "Poker" → **"Games"** trên `(tabs)/index.tsx` id:18
- `/games` hub screen: grid tile Poker · Phỏm · Sâm · Caro · Cờ Vua · Cờ Tướng với subtitle + badge "Mới"

**Phỏm (Tá lả) — FULL PLAYABLE** ([`e8d4e539`](https://github.com/den3110/abcdk-/commit/e8d4e539) → [`9bafbcf5`](https://github.com/den3110/abcdk-/commit/9bafbcf5) → [`efcc1ddc`](https://github.com/den3110/abcdk-/commit/efcc1ddc)):
- **Model** `PhomRoom` (4 seat, cards[], melds[], leftover, stage: waiting/dealing/playing/**downing**/showdown, discards[], deck)
- **Engine** `phomEngine.js`:
  - `startHand`: deal 9 lá (dealer 10), rotate dealer theo ván
  - `findBestPartition()`: backtracking phân hoạch bài ra phỏm tối ưu (min lá lẻ)
  - `isU()`: kiểm tra ù (bài trong tay tạo phỏm hết)
  - `applyAction(draw_deck|draw_discard|discard)`: rule đơn giản (10 lá phải thảy, 9 lá phải bốc, không phân biệt dealer sau ván đầu). Auto-ù sau mỗi bốc
  - Sau 4 vòng đủ → `stage = "downing"` (không endHand ngay)
  - `applyDownAuto` / `applyDownManual(melds)` / `applyGuiBai(card, targetSeat, meldIdx)`: 3 lựa chọn trong phase downing
  - `endHand`: sort theo leftoverValue, winner ăn stake × (n-1), móm phạt gấp đôi
- **Auto-timeout server-side** khi quá `turnDeadlineAt` (30s)
- **Mobile** `app/phom/[id].tsx` landscape:
  - `FeltOval` xanh + `WoodBackground` gỗ nâu
  - 4 seat rotate theo hero (bottom), hero seat KHÔNG render frame (che hand) → info bar riêng
  - Discards hiện **trước mặt người vừa đánh** (dùng `fromSeat` map rotated idx → position %)
  - Deck stack giữa bàn với badge cam số nọc còn lại
  - Nút **"Bốc thẻ"** / **"Ăn+Hạ"** (≥3 lá chọn) khi có 9 lá; nút **"Đánh"** pill cam inline khi có 10 lá + 1 lá chọn
  - Phase downing: 3 nút **"Hạ phỏm"** (blue) / **"Gửi bài"** (green stub) / **"Hạ tự động"** (orange)
  - Hint "✓ Đã hạ. Chờ người khác…" sau khi confirm

**Sâm Lốc — FULL PLAYABLE** ([`efcc1ddc`](https://github.com/den3110/abcdk-/commit/efcc1ddc) → [`0d0e5e8`](https://github.com/den3110/pickletour-app/commit/0d0e5e8) → [`f9819f31`](https://github.com/den3110/abcdk-/commit/f9819f31)):
- **Rank order fix ĐẶC BIỆT**: Sâm dùng `3 < 4 < ... < K < A < 2` (2 là heo cao nhất). Engine ban đầu dùng thứ tự Phỏm (2 nhỏ nhất) → không đè J bằng 2. Thêm `samRankValue` + `samSortHand` local, replace mọi `rankValue` trong `comboType`/`compareCombos`/`canCut`/fourPairs/straight detector
- **Combo types**: single/pair/triple/quad/straight/**fourPairs** (4 đôi thông 8 lá)/dragon (sảnh rồng 10 lá 3→A)
- **canCut rules** (chặt cross-type):
  - Tứ quý chặt heo (single/pair/triple 2)
  - 4 đôi thông chặt tứ quý + heo
  - Sảnh rồng chặt tất cả
  - Cùng loại chặt cao hơn (quad/fourPairs)
- **Scoring per-card × stake** (thay vì flat):
  - Winner (finishOrder 1) ăn tổng penalty của losers
  - Loser thường: `stake × cardsLeft`
  - Móm (còn 10 lá): `stake × 10 × 2`
  - **Bị chặt heo**: track `seat.cutByHeoCount` (đánh 2 bị đè bởi quad/fourPairs/dragon) — penalty = móm
  - **Bị bắt sâm**: `stake × 10 × 2 × 3`
- **Xin Sâm flow**: stage mới `xin_sam` 10s countdown sau deal. 3 endpoint: `xin-sam` (mark claimer), `bat-sam` (mark catcher), `skip-xin-sam` (finishXinSam ngay). Auto-transition sau deadline
- **Rule end**: 1 người hết bài = **kết thúc ván ngay** (không chờ 3 người). Seat còn lại xếp thứ tự theo `cards.length`
- **Mobile** `app/sam/[id].tsx`:
  - Nút "Xin Sâm" (orange) + "Bắt Sâm" (red) overlay trong phase xin_sam
  - Combo hiện tại render **trước mặt seat vừa đánh** (không stack center)
  - passBadge + finishedBadge (#1, #2...)
  - Winners table hiện tên đúng (fix: `enrichWinners()` resolve từ populated seats sau `endHand`)

**Caro (Gomoku) — FULL PLAYABLE** ([`6c13bc96`](https://github.com/den3110/abcdk-/commit/6c13bc96)):
- Model `CaroRoom` (2 seat, board 15×15 flat array `["X"|"O"|""]`, moves[], winningLine)
- Engine `caroEngine.js`:
  - `startHand`: reset board, alternate first mover mỗi ván
  - `applyMove(row, col)`: place X/O
  - `checkWin(board, size, r, c, mark)`: 4 directions × dịch chuyển 0-4 lá, tìm 5 liên tiếp
  - Auto-draw khi board đầy
- Mobile `app/caro/[id].tsx` portrait:
  - Board vàng gỗ với 15×15 grid, tap ô trống → X đỏ / O xanh
  - PlayerBox 2 bên VS: avatar + mark + tên + chip + turn indicator vàng
  - Win overlay + highlight 5 ô thắng vàng

**Cờ Vua (Chess) — FULL PLAYABLE (dùng chess.js)** ([`dafecd73`](https://github.com/den3110/abcdk-/commit/dafecd73)):
- **`npm install chess.js`** trên root + mobile (^1.4.0)
- Model `ChessRoom` (2 seat, `fen`, moves với SAN)
- Engine `chessEngine.js` wrap `new Chess(fen)`:
  - `applyMove({ from, to, promotion="q" })` → chess.js validate + update FEN
  - `isCheckmate/isStalemate/isDraw/isThreefoldRepetition/isInsufficientMaterial` → auto end với `resultReason`
  - `applyResign(seatIndex)`: winner = opponent
  - `legalMovesFrom(fen, from)`: export cho mobile highlight
- Mobile `app/chess/[id].tsx`:
  - Board 8×8 với Unicode pieces `♔♕♖♗♘♙` (uppercase = trắng)
  - Board flip khi chơi bên đen (hero always at bottom)
  - Tap quân của mình → highlight legal moves xanh lá (chess.js lookup client-side)
  - Auto-detect promotion → default Queen
  - Nút "Xin thua" alert confirm

**Cờ Tướng (Xiangqi) — FULL PLAYABLE (custom engine)** ([`dafecd73`](https://github.com/den3110/abcdk-/commit/dafecd73)):
- Model `XiangqiRoom` (2 seat, board flat 10×9 = 90 ô, uppercase=đỏ/lowercase=đen)
- Piece encoding: `K`=Tướng, `A`=Sĩ, `E`=Tượng, `H`=Mã, `R`=Xe, `C`=Pháo, `P`=Tốt
- Engine `xiangqiEngine.js` full rule (~250 lines):
  - Initial board setup + `isLegalMove(board, from, to, red)` per piece type
  - Tướng: 1 ô ngang/dọc trong cung (rows 7-9 / 0-2, cols 3-5)
  - Sĩ: chéo 1 ô trong cung
  - Tượng: chéo 2 ô, không vượt sông (row 4/5), mắt tượng không chắn
  - Mã: L (2+1), chân mã không chắn
  - Xe: ngang/dọc không có quân chắn
  - **Pháo**: đi trống (0 quân chắn), **ăn phải có đúng 1 quân giữa**
  - Tốt: trước sông chỉ đi thẳng, sau sông đi cả ngang
  - **Face-to-face rule**: 2 tướng cùng cột không có quân chắn = nước không hợp lệ
  - **Bắt K/k = thắng ngay**
- Mobile `app/xiangqi/[id].tsx`:
  - Board gỗ vàng 9×10, dòng sông = row 4/5 highlight `#FEF3C7`
  - Quân dạng circle border 2px, chữ Hán: 帥仕相傌俥炮兵 (đỏ) / 將士象馬車砲卒 (đen)
  - Tap → highlight ô chọn vàng, tap ô đích → nước đi
  - Flip board cho bên đen

### 3.3 Shared game infrastructure

**Components** (`components/games/`):
- `GameTableUI.tsx`: `WoodBackground` (multi-layer gradient nâu) · `FeltOval` (rim gỗ + baize xanh + vignette) · `CardPro` (rounded corners + corner rank/suit + gradient back) · `SeatFrame` (avatar + gold border khi turn) · `EmptySeat` · `RoundIconBtn` (purple gradient) · **`SpeechBubble`** (chat bubble bay 4s trên avatar) · **`ConnectionBanner`** (offline/reconnecting)
- `InviteFriendModal.tsx`: search user + chọn nhiều + gửi lời mời (push + in-app notif)
- **`RoomListItem.tsx`** (mới): shared lobby card với avatar row (28x28 overlap), tên VĐV concat, empty slot icon, stage pill

**Hooks** (`hook/`):
- **`useGameAutoReconnect.ts`** (mới): NetInfo + AppState + socket disconnect listener. Khi active/online → force `socket.connect()` + `emit subscribeEvent` + `refetch()`. Polling fallback 5s. Return `connStatus`
- Apply cho 5 game (Phỏm/Sâm/Caro/Chess/Xiangqi); Poker đã có pattern sẵn

**Sound** (`lib/gameSound.ts` mới — standalone):
- Ban đầu wrap pokerSounds → user báo không nghe sound
- **Fix**: rewrite standalone dùng `require("../assets/sfx/click4.mp3")` **relative** (thay `@/` alias có thể fail OTA bundle). Verbose `console.log` errors. Fallback remote URL `https://pickletour.vn/uploads/sfx/click.mp3` khi bundled asset fail
- Preset 10 kind `chip/deal/fold/check/call/raise/allin/win/lose/warning` với volume+rate khác
- Wire vào 5 game screens: `playSound()` on move/action, `warmupSounds()` in useEffect mount

### 3.4 Host system (chủ phòng) — áp dụng 5 game mới

Session gần cuối user yêu cầu:

- **Auto-sit creator** vào ghế 0 khi tạo bàn (không cần bấm Ngồi)
- **Chỉ chủ phòng bấm Bắt đầu** (`req.user._id === room.createdBy` else 403). Non-host thấy nút xám "CHỜ CHỦ PHÒNG"
- **Chặn ngồi khi ván đang chơi** (`stage === "playing"` / `downing` / `xin_sam`) → throw "Ván đang chơi — vui lòng chờ ván kết thúc rồi vào"
- **Transfer host khi rời**: nếu leaver là `createdBy` → gán `createdBy` cho seat còn user (tìm seat.find(s => s.user))
- **Back button confirm**: mobile Alert "Thoát phòng?" → OK → `leaveRoom` + `router.back()`; nếu chưa ngồi thì back luôn
- **Auto-close bàn khi hết người**: sau `leaveRoom`, `if (!seats.some(s => s.user)) room.status = "closed"` — bàn biến khỏi lobby list

### 3.5 Realtime lobby list + avatars ([`acffb8c6`](https://github.com/den3110/abcdk-/commit/acffb8c6))

- Backend 5 controller: helper `broadcastLobby()` emit `<game>:lobby:updated` sau mỗi createRoom / update / leave
- Socket handlers cho 5 game: `<game>:lobby:subscribe` / `:unsubscribe` join/leave room `<game>:lobby`
- List endpoint response thêm `seatUsers: [{_id, nickname, name, avatar}]` + `createdBy`
- Mobile 5 lobby screens: `useEffect` subscribe socket lobby, unsubscribe on unmount. Refetch on event
- Render `<RoomListItem>` với avatar row (avatar 28x28 chồng nhau, empty slot outline icon, tên VĐV "A, B, C +2")

### 3.6 Speech bubble + avatar cho 3 game mới

- Caro/Chess/Xiangqi: PlayerBox/PlayerBar render avatar tròn + fallback initial letter khi seat ngồi
- Speech bubble: track `bubbles` state, useEffect watch `messages.length` → gán bubble cho sender 4s, cleanup tick 1s. Import shared `SpeechBubble` từ `GameTableUI`

---

## 4. Bug fix + Landmine đã ghi nhận

### 4.1 Sound OTA không hoạt động (đang test)

Turn giữa session user báo "chưa nghe âm thanh". Có 2 lần rewrite `gameSound.ts`:
- Lần 1: wrap pokerSounds với dynamic `require("@/app/poker/pokerFx")` → user chọn dynamic require có thể fail trong metro OTA bundle
- Lần 2 (**đang deploy**): standalone, `require("../assets/sfx/click4.mp3")` relative, verbose log, fallback URL `https://pickletour.vn/uploads/sfx/click.mp3`

**Chưa verify** user đã reload OTA + test lại. Nếu vẫn không nghe:
- Kiểm tra logs `console.log("[gameSound]", ...)` trong dev tools
- File remote URL `pickletour.vn/uploads/sfx/click.mp3` **chưa upload** — nếu bundled fail thì remote cũng fail → 0 sound. Upload file mp3 cùng path lên VPS `/var/www/pickletour.vn/uploads/sfx/click.mp3`

### 4.2 Sâm bug tên winners "?" (đã fix)

`endHand` viết `winners[i].userName = seat.user?.nickname` nhưng lúc endHand seat.user chỉ là ObjectId (chưa populate) → tên = "?". Fix: `enrichWinners(room)` chạy lúc serializeRoom, resolve tên từ populated `seats` sau khi populate. Apply cho cả Phỏm + Sâm.

### 4.3 Sâm rank order (đã fix)

Sâm dùng thứ tự **3<4<...<K<A<2** (2 là heo cao nhất). Engine ban đầu dùng `rankValue` từ `cardDeck.js` — thứ tự Phỏm (2 nhỏ nhất). → 2 không đè được J. Fix: local `SAM_ORDER` + `samRankValue` + `samSortHand`. Apply mọi chỗ compare trong samEngine.

### 4.4 Sâm end rule sai (đã fix)

Ban đầu chờ 3/4 người hết bài mới endHand. Rule đúng: **1 người hết bài = thắng ván ngay**. Fix trong `applyAction("play")`: sau khi `seat.hasFinished = true` + `finishOrder=1`, xếp thứ tự các seat còn lại theo `cards.length`, hasFinished all, endHand.

### 4.5 Modal iOS crash landscape (đã fix)

Khi bấm "Mời bạn" trong landscape (Phỏm/Sâm) → crash `RCTFabricModalHostViewController shouldAutorotate is returning YES` vì screen lock landscape nhưng Modal expect autorotate. Fix: thêm `supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}` cho tất cả `<Modal>` trong game rooms.

### 4.6 RTK tagTypes warning (đã fix)

Thêm `PhomRoom`, `SamRoom`, `CaroRoom`, `ChessRoom`, `XiangqiRoom` vào `apiSlice.js` tagTypes[]. Tránh warning `Tag type 'X' was used, but not specified`.

### 4.7 Ván mới báo "Ván đang chơi" (đã fix)

Sau `endHand`, `stage = "showdown"`. `startHand` check `stage !== "waiting"` → block. Fix: check `stage !== "waiting" && stage !== "showdown"` cho cả Phỏm/Sâm/Caro/Chess/Xiangqi.

### 4.8 Hero seat che hand (đã fix)

Bottom seat position `top: 82%` overlap với hand strip bottom. Fix: nếu `i === 0 && !empty && isMine` → không render seat frame. Thay bằng hero info bar (chip + turn indicator) ở góc dưới-phải.

### 4.9 UI layout landscape (đã fix)

- Top seat `top: 22%` (từ 12%) — tránh Dynamic Island
- Left/right seat 14%/86% (từ 8%/92%) — tránh back button + purple stack
- Timer bar `top: insets.top + 50` — không đè avatar top

### 4.10 Legacy pokerFx dynamic require không load (chuyển sang static)

Ban đầu code Phỏm/Sâm dùng `try { const { playFx } = require("@/app/poker/pokerFx"); playFx(...); } catch {}`. Fail silently. Fix: static import `playSound` từ `lib/gameSound.ts` mới.

### 4.11 Sound bundled asset có thể fail OTA

`@/` alias phụ thuộc Metro config. Trong OTA bundle (hot-updater) chưa chắc alias resolve. Fix: `require("../assets/sfx/click4.mp3")` relative. Nếu vẫn không nghe → verify path bundle mismatch.

---

## 5. Việc còn dở

### 5.1 Priority cao

- 🔴 **Sound verify**: user báo chưa nghe. Đã ship version 3 của gameSound (standalone + relative + remote fallback). **CẦN USER TEST + FEEDBACK**. Nếu vẫn không nghe:
  - Upload `click.mp3` lên `https://pickletour.vn/uploads/sfx/click.mp3` (tạm dùng chính `click4.mp3` từ mobile repo)
  - Đọc log `[gameSound]` để trace lỗi
- 🟡 **Backend prod đã restart**. VPS đã `npm install chess.js`. Nếu deploy tiếp cần chạy `npm install` khi có thay đổi package.json
- 🟡 **Android build local có sẵn** tại `~/Desktop/pickletour-android/pickletour-1.1.13.{apk,aab}`. User có thể upload AAB lên Play Console hoặc share APK sideload

### 5.2 Priority thấp

- **Gửi bài Phỏm**: UI nút "Gửi bài" hiện Alert placeholder "đang hoàn thiện". Backend `applyGuiBai(card, targetSeat, meldIdx)` đã có. Cần wire UI: chọn 1 lá → tap phỏm người khác → server validate ghép + apply
- **Poker chưa apply host system** (chủ phòng only start / auto-sit creator / back confirm / block sit mid-hand). Poker có ~500 lines pre-existing, session này để nguyên. Nếu apply sau: mirror pattern 5 game mới
- **Sound assets nghèo**: chỉ 1 mp3 click4.mp3. Nên thêm mp3 riêng cho chip/deal/win/... vào `assets/sfx/`. Đây là rebuild binary — không OTA được. Alternative: dùng `playRemoteSound(url)` load từ VPS
- **Xin sâm bắt sâm UI chưa test đủ**: seat.hasClaimedSam badge, banner countdown "Xin sâm · Xs" khi stage=xin_sam. Verify flow 4 người
- **Chess promotion UI**: hiện auto-promote Queen. Không có picker cho Rook/Bishop/Knight. Nice-to-have
- **Xiangqi chưa detect chiếu tướng**: user đánh nước để tướng bị chiếu vẫn valid. Chỉ end khi bắt K/k
- **Web version cho 5 game mới**: chưa có (Poker cũng chưa). Nếu muốn ship: build room screen React MUI + reuse RTK slices

---

## 6. Environment cần biết

### 6.1 VPS credentials (giữ nguyên)

```
Host: 103.90.225.130
User: root
Password: Hoang@07082026
```

`PasswordAuthentication yes` + `PermitRootLogin yes` từ session trước.

### 6.2 OTA hot-updater — Rule mới trong session

Trong session build tăng dần:
```bash
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a

# Chỉ ios 1.1.13 mỗi lần
rm -rf .hot-updater/output
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "update game"
```

Khi hoàn tất tính năng lớn (user báo "xong hết"):
```bash
for target in "ios 1.1.13" "ios 1.1.9" "android 1.1.13" "android 1.1.9"; do
  rm -rf .hot-updater/output
  ./node_modules/.bin/hot-updater deploy -p $(echo $target | cut -d' ' -f1) \
    -t $(echo $target | cut -d' ' -f2) -c production -m "update game"
done
```

### 6.3 Android keystore (đã có trong `~/.gradle/gradle.properties`)

```
PICKLETOUR_UPLOAD_STORE_FILE=app/pickletour-upload.jks
PICKLETOUR_UPLOAD_STORE_PASSWORD=datistpham
PICKLETOUR_UPLOAD_KEY_ALIAS=upload20260322
PICKLETOUR_UPLOAD_KEY_PASSWORD=datistpham
```

### 6.4 Android build local

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd pickletour-app-mobile/android
./gradlew :app:assembleRelease   # → app/build/outputs/apk/release/app-release.apk
./gradlew :app:bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
```

Build ~3-4 phút. `Java 17` bắt buộc (Java 11 không dùng được với RN 0.83).

### 6.5 Restart backend nhanh

```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 \
  "cd /abcdk- && git pull origin master 2>&1 | tail -3 && pm2 restart server 2>&1 | tail -3"
```

Nếu có thay đổi `package.json`: thêm `&& npm install --no-audit` trước `pm2 restart`.

### 6.6 Frontend web rebuild

```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 \
  "cd /abcdk-/frontend && yarn build:deploy 2>&1 | tail -5"
```

`yarn build:deploy` = `vite build` + rsync `dist/` → `/var/www/pickletour.vn/`. ~2 phút.

---

## 7. API endpoints mới (games)

Tất cả tuân theo pattern `/api/<game>/rooms/*`:

| Endpoint | Method | Chức năng |
|---|---|---|
| `GET  /rooms` | public | List rooms (với `seatUsers` avatars + `createdBy`) |
| `POST /rooms` | protect | Create + auto-sit creator vào seat 0 |
| `GET  /rooms/:id` | protect | Get room detail |
| `POST /rooms/:id/sit` | protect | Ngồi ghế (block khi playing) |
| `POST /rooms/:id/leave` | protect | Rời ghế, transfer host, auto-close nếu empty |
| `POST /rooms/:id/start` | protect | Bắt đầu ván (chỉ createdBy) |
| `POST /rooms/:id/action` | protect | Game-specific action |
| `POST /rooms/:id/chat` | protect | Chat |
| `POST /rooms/:id/emoji` | protect | Emoji ephemeral (Phỏm/Sâm/Caro) |
| `POST /rooms/:id/invite` | protect | Invite friends push notif |

**Sâm-specific**: `POST /rooms/:id/xin-sam` · `/bat-sam` · `/skip-xin-sam`
**Chess/Xiangqi-specific**: `POST /rooms/:id/resign`

Socket rooms:
- `<game>:room:${id}` — mỗi phòng có event `<game>:room:updated`, `<game>:room:chat`, `<game>:room:emoji`
- **`<game>:lobby`** — realtime lobby list, event `<game>:lobby:updated`

---

## 8. Snapshot commit history session

**Root** `abcdk-`: `78483aa6 → f9819f31` (~58 commits root — chỉ list landmark):

1. [`4bd4c6d1`](https://github.com/den3110/abcdk-/commit/4bd4c6d1) — maxTeamScore MLP
2. [`0026030f`](https://github.com/den3110/abcdk-/commit/0026030f) — Court cluster referee union
3. [`bcef4390`](https://github.com/den3110/abcdk-/commit/bcef4390) — BTC section
4. [`d0e83688`](https://github.com/den3110/abcdk-/commit/d0e83688) — MLP score UI
5. [`e8d4e539`](https://github.com/den3110/abcdk-/commit/e8d4e539) — Phỏm + Sâm foundation Phase 2
6. [`00b0b113`](https://github.com/den3110/abcdk-/commit/00b0b113) — Phỏm + Sâm engine Phase 3
7. [`efcc1ddc`](https://github.com/den3110/abcdk-/commit/efcc1ddc) — Phase 4: chặt Sâm + auto-timeout + invite + timer
8. [`92cec659`](https://github.com/den3110/abcdk-/commit/92cec659) — UI redesign shared components
9. [`31a6476c`](https://github.com/den3110/abcdk-/commit/31a6476c) — Sâm scoring rework + xin sâm flow
10. [`9bafbcf5`](https://github.com/den3110/abcdk-/commit/9bafbcf5) — Phỏm downing phase
11. [`6c13bc96`](https://github.com/den3110/abcdk-/commit/6c13bc96) — Caro backend + mobile
12. [`dafecd73`](https://github.com/den3110/abcdk-/commit/dafecd73) — Chess (chess.js) + Xiangqi custom
13. [`560dc263`](https://github.com/den3110/abcdk-/commit/560dc263) — Host system + auto-sit + block mid-play
14. [`acffb8c6`](https://github.com/den3110/abcdk-/commit/acffb8c6) — Realtime lobby + avatars + sound fix
15. [`f9819f31`](https://github.com/den3110/abcdk-/commit/f9819f31) — Auto-close bàn khi hết người

**Mobile** `pickletour-app`: `ded141a → 9bb3781` (~38 commits mobile).

---

## 9. Câu hỏi còn mở

1. **Sound có nghe chưa?** — Cần user test sau OTA gần nhất
2. **Poker có cần apply host system?** — Session này skip, pattern cũ
3. **Web version cho 5 game mới?** — Chưa có, chưa quyết
4. **Chess promotion picker UI**: default Queen. Có cần picker chọn Rook/Knight/Bishop?
5. **Xiangqi chiếu tướng detection**: hiện chỉ end khi bắt K. Có cần validate "không được để K bị chiếu sau nước đi của mình"?
6. **AAB upload Play Console**: session này build sẵn `pickletour-1.1.13.aab` (160MB) tại `~/Desktop/pickletour-android/`. Chưa upload
