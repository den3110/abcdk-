# PickleTour — HANDOFF Session (2026-08-11 → 2026-08-12)

> Session dài ~1.5 ngày, ~40 commits root + ~11 commits mobile. Chủ đề:
>
> 1. **MLP Vòng bảng + Bốc thăm + Knockout đầy đủ** — group stage +
>    live draw stage + auto-advance winner + KO preview với placeholder
>    "Nhất bảng A".
> 2. **Reset giải MLP** để test lại.
> 3. **Trọng tài đứng theo sân** (bỏ referee UI trong dual detail, auto
>    lấy từ `courtStation.defaultReferees`).
> 4. **MlpDualsPage nâng cao**: pool tabs, dropdown gán sân inline, xem
>    lineup 2 đội trong card, realtime score.
> 5. **Overlay MLP** — redesign compact top-left OBS, quả bóng vàng
>    pulsing indicator tay giao, badge DreamBreaker inline.
> 6. **Referee panel mobile**: hiện tên đội 2 side + swap khi Đổi bên
>    + fix nhấp nháy tên đội ↔ tên VĐV.
> 7. **Waitlist đăng ký giải** — cặp thứ 49+ tự vào chờ duyệt, auto
>    promote FIFO khi có cặp rút, admin có option "Chờ / Duyệt luôn",
>    push notification 2 chiều.
> 8. **MLP badge** trên tournament list card (web + mobile).
> 9. **Quản lý trọng tài** — pool trọng tài của giải (backend + web
>    dialog); wire vào cụm sân sẽ ở phase sau.
> 10. **Điểm trình VĐV** hiện trong MLP team roster (search dropdown +
>     roster item + tổng đôi/đơn của team).

Đọc kèm `HANDOVER.md` để nắm kiến trúc chung.

---

## 1. Trạng thái deployment

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `6991b266` | ✅ Đã `pm2 restart server` (2 instance). |
| **Frontend web** (`pickletour.vn`) | commit `6991b266` | ✅ CI/CD tự pull `yarn build:deploy`. |
| **Mobile iOS TestFlight** | `1.1.13 (43)` cũ | 🟡 Native binary cũ, feature ship qua OTA. |
| **Mobile Android Play** | `1.1.13 (43)` | ✅ Rollout xong (session trước). Session này KHÔNG push OTA Android. |
| **Mobile iOS OTA production** | Bundle `2828e36` | ✅ Deploy CHO CẢ `ios 1.1.13` VÀ `ios 1.1.9` (user yêu cầu push cả 2 target). |
| **Overlay Generator VPS** | overlay-template-mlp.html chưa scp | 🟡 File local (di sản session trước, MLP overlay đã có route riêng, không cần dùng template này). |

**Git remotes:**

| Repo | Latest commit |
|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `6991b266` |
| `github.com/den3110/pickletour-app` (mobile) | `2828e36` |
| `github.com/den3110/abcde` (admin) | không đổi |

---

## 2. Feature ship trong session

### 2.1 MLP Vòng bảng + Bốc thăm + Knockout — [`cb2267b4`](https://github.com/den3110/abcdk-/commit/cb2267b4)

**Schema mới:**
- `Tournament.mlpConfig.groupStage`: `{ enabled, poolCount, poolSize, topPerPool, doubleRound, seedMethod, tiebreakers, drawStatus, drawnAt }`.
- `MlpTeam`: thêm `poolKey`, `poolIndex`, `seed`.
- `MlpDualMatch`: thêm `phase (group|knockout|null)`, `poolKey`, `knockoutRound`, `bracketSlot`, `nextMatch`, `nextSlot`. `teamA/B` nullable (shell dual round 2+).

**Backend endpoints** (`backend/services/mlpPoolService.js`, `mlpController.js`):
- `GET /api/mlp/tournaments/:tid/pools` — list pools + đội chưa gán.
- `POST /api/mlp/tournaments/:tid/pools/draw` — bốc thăm (random/snake/manual + dryRun).
- `POST /api/mlp/tournaments/:tid/pools/reset` — clear.
- `POST /api/mlp/tournaments/:tid/pools/live-draw/broadcast` — relay socket cho sân khấu bốc thăm (room `mlp:tour:${tid}`).
- `POST /api/mlp/tournaments/:tid/duals/knockout/resolve` — manual trigger auto-fill KO placeholders.

**Logic refactor:**
- `generateMlpDuals`: `groupStage.enabled=true` → sinh round-robin trong mỗi bảng (`phase="group"` + `poolKey`), hỗ trợ `doubleRound`. Ngược lại: hành vi flat cũ.
- `generateMlpKnockout`: group mode → BXH per-pool → top-N mỗi bảng → cross-pool pairing (A1-B2, B1-A2, C1-D2, D1-C2). **Tạo full bracket** (round 1..N) với shell dual round 2+ linked qua `nextMatch/nextSlot`.
- **KO Preview** ([`1f01b59c`](https://github.com/den3110/abcdk-/commit/1f01b59c)): bỏ guard "cần đủ đội qualified" → sinh KO CẢ KHI vòng bảng CHƯA XONG. Bảng chưa hoàn tất → `teamA/B=null`, `sourceA/B={kind:"poolRank", poolKey, poolRank}` → frontend render placeholder "Nhất bảng A" / "Nhì bảng B".
- **Auto-resolve**: `resolveMlpKnockoutSlots(tournamentId)` — hook vào `syncSubMatchResult` + `mlpMatchSync`. Khi group dual finished + bảng hoàn tất → tự fill `teamA/B` từ standings vào KO slot.
- **Auto-advance winner**: `advanceMlpKnockoutWinner(dual)` — hook 3 nơi (`syncSubMatchResult`, `forceFinishMlpDual`, `scoreDreamBreakerPoint`) + `mlpMatchSync` lazy import. Dual KO finished → điền winner vào slot `nextMatch`.
- `getMlpStandings`: trả về thêm `pools: [{key, index, items[]}]` với BXH per-bảng scoped chỉ `phase="group"`.

**Web UI:**
- `MlpConfigDialog`: section "Vòng bảng + Knockout".
- `MlpPoolDrawDialog` (mới): 3 tab (Random / Snake / Manual dropdown) + preview + commit.
- `MlpDualsPage`: pool tabs (Tất cả / A/B/C/D / Knockout), button "Bốc thăm chia bảng", warning bar khi chưa bốc thăm.
- `MlpBracketView`: group mode = pools grid (BXH + duals) + horizontal knockout bracket (Tứ kết/Bán kết/Chung kết auto-label).
- `MlpStandingsPage`: tabs Tổng + per-bảng, top-N highlight xanh + chip "KO".
- `MlpDrawLivePage` (mới): route `/tournament/:id/mlp/draw/live`. Sân khấu bốc thăm nền tối, operator bấm reveal từng đội với animation Slide/Grow/wiggle, socket relay realtime cho viewer (`?mode=viewer`). Fix commit gate: **chỉ Commit khi bốc hết đội** ([`e0e21f96`](https://github.com/den3110/abcdk-/commit/e0e21f96)).

**Placeholder UI** ([`010f208`](https://github.com/den3110/pickletour-app/commit/010f208) mobile, web tương tự): `TeamRow` render chip dashed vàng "Nhất bảng A" khi `teamA=null` + `sourceA.kind="poolRank"`. Helper `placeholderLabel(source)` dùng chung.

**Mobile mirror**: `duals.tsx` pool tabs, `standings.tsx` per-bảng, `MlpBracketView.tsx` render pool boxes + KO section.

**Fix 404 bracket click** ([`5e2e5c2a`](https://github.com/den3110/abcdk-/commit/5e2e5c2a)): web bracket navigate `/mlp/dual/` (số ít) trong khi route đăng ký `/mlp/duals/:id` (số nhiều). Fix web, giữ mobile số ít (expo-router file layout). Guard shell KO chưa có team → skip navigate.

### 2.2 Reset giải MLP — [`a2a4d2a1`](https://github.com/den3110/abcdk-/commit/a2a4d2a1)

- Endpoint `POST /api/mlp/tournaments/:tid/reset` — body `{ scope: {duals,standings,pools,ratingChanges}, confirmName }`.
- 4 scope: xoá duals (+ Match docs), reset team.standing, clear pool assignments, xoá RatingChange log (không revert user rating).
- Confirm bằng cách gõ đúng tên giải (case-sensitive).
- Web dialog `MlpResetDialog` với checkboxes + text field xác nhận. Nút "🔥 Reset giải" đỏ trong MlpDualsPage action bar.

### 2.3 Trọng tài theo sân — [`1f01b59c`](https://github.com/den3110/abcdk-/commit/1f01b59c)

- Bỏ hoàn toàn UI trọng tài trong `DualAssignmentPanel` + `SubMatchAssignmentPanel`. Alert nhắc "Trọng tài đứng theo sân".
- Backend `patchMlpDual` / `patchMlpSubMatch`: khi đổi `courtStation` (+ client không truyền `referees` explicit) → auto set `referees = station.defaultReferees`.
- `mlpMatchSync.ensureMlpSubMatchDoc` fallback chain: `sub.referees > dual.referees > station.defaultReferees` khi build Match doc.
- Mobile referee tab: filter `mlpDbDuals` cũng dùng thêm `dual.courtStation.defaultReferees` + `subMatches.courtStation.defaultReferees` làm fallback ([`f8ac382`](https://github.com/den3110/pickletour-app/commit/f8ac382)). Backend `listMlpDuals` + `getMlpDual` populate `defaultReferees` trong courtStation ([`5adafb77`](https://github.com/den3110/abcdk-/commit/5adafb77)).

### 2.4 MlpDualsPage nâng cao — [`1f01b59c`](https://github.com/den3110/abcdk-/commit/1f01b59c)

- **Xem lineup 2 đội trong card**: box từng sub-match với chip avatar+tên VĐV `playersA` vs `playersB` — BTC thấy lineup mà không cần vào chi tiết.
- **Dropdown gán sân inline**: admin/manager Select "🏟️ Chọn sân" ngay trong card → patch trực tiếp qua `patchMlpDual`.
- **Chip "Trọng tài theo sân (N)"** hiện số referee sau gán sân.
- **Realtime score** ([`84c439bb`](https://github.com/den3110/abcdk-/commit/84c439bb)): `syncSubMatchResult` + `mlpMatchSync` emit `tournament:invalidate` mỗi khi score/status đổi (debounced). MlpDualsPage subscribe `tournament:${id}` → refetch throttled 800ms. Bật `refetchOnFocus/Reconnect`.

### 2.5 Overlay MLP — [`6964a80f`](https://github.com/den3110/abcdk-/commit/6964a80f) + [`d009f251`](https://github.com/den3110/abcdk-/commit/d009f251) + [`1e7b9e35`](https://github.com/den3110/abcdk-/commit/1e7b9e35)

**Redesign compact top-left** (~480px, thay vì 900px center):
- Card navy gradient + viền gold.
- Header 1 dòng: slot badge (MD/WD/XD…) + label + chip LIVE/KẾT THÚC.
- Body 2 hàng team gọn: logo mini + tên team (accent) + list VĐV cùng dòng phân cách "/".
- Score box bên phải: 2 ô vuông dọc (A trên, B dưới) + chip slot wins ở dưới.
- DreamBreaker: badge "🏆 DREAM BREAKER" **inline vào header** (không floating che chữ) + "1v1 · T21 · R4".

**Query params**: `?position=top-left|top-right|bottom-left|bottom-right|center`, `?compact=1`, `?theme=light|dark` (chỉ 1 theme navy hiện tại), `?hidePlaceholder=1`.

**Serve indicator**: quả bóng vàng nhỏ pulse cạnh tên đội đang giao. Nếu `serve.serverId` khớp 1 player → underline tên VĐV đó vàng. DreamBreaker cũng có ball indicator. Animation `mlpServePulse` scale 1→1.25 loop 1.2s (inject vào `document.head` 1 lần).

**Fix quan trọng** ([`84c439bb`](https://github.com/den3110/abcdk-/commit/84c439bb)): overlay path 1 dùng `station.currentMatch`. Nếu trỏ tới match NOT-MLP → `isMlpSub=false` → skip. Fix: chỉ dùng candidate nếu có `meta.mlp.dualId`, ngược lại rơi xuống path 2 (query MLP match theo station).

Trước đó ([`ff9626b4`](https://github.com/den3110/abcdk-/commit/ff9626b4)) đã widen query: nhận cả `status="scheduled"` (không chỉ live/assigned) vì `ensureMlpSubMatchDoc` tạo Match với default `scheduled`. Sort ưu tiên `live > assigned > scheduled`.

### 2.6 Referee panel mobile

**Tên đội 2 side** ([`d27367a`](https://github.com/den3110/pickletour-app/commit/d27367a)):
- `TeamSimple` component thêm prop `teamName`, render header text đậm ở đỉnh mỗi team box (đổi màu highlight khi đang giao).
- `resolveTeamName(key)` priority: `meta.mlp.teamAName/teamBName` → `resolvedSideNameX` → `__sideX` → `teamXName` → `pairXName` → `sideXName`.
- Truyền `teamName` theo `leftSide/rightSide` → **swap tự động khi bấm "Đổi bên"** (vì `leftRight` state swap).

**Fix flicker tên đội ↔ tên VĐV** ([`642177c`](https://github.com/den3110/pickletour-app/commit/642177c)):
- MLP match (có `meta.mlp.dualId`): CHỈ dùng `meta.mlp.teamAName/teamBName`, KHÔNG fallback. Các field `resolvedSideName/pairName/sideName` thường bị upstream normalize gán = "Tung / Có cháu đây" (tên VĐV concat) → nhấp nháy.
- Match thường: giữ fallback cũ.
- `useMemo` deps tách theo field cụ thể thay vì `[match]` để tránh recompute không cần.

**Web schedule** ([`6f05ac6a`](https://github.com/den3110/abcdk-/commit/6f05ac6a)): tương tự — `teamNameFrom` + `resolveSide` ưu tiên `m.meta.mlp.teamAName/teamBName` cho MLP match. Fix bug trang Lịch thi đấu hiện "Chưa có đội".

### 2.7 Waitlist đăng ký

**Schema**:
- `Registration.status`: enum `["approved","waitlisted","rejected","withdrawn"]` + `approvedBy/At`. Default `"approved"` (BC data cũ).
- `MlpTeam.status` thêm `"waitlisted"`.

**Backend create** ([`1e406aa7`](https://github.com/den3110/abcdk-/commit/1e406aa7)):
- `createRegistration`, `adminCreateRegistration`, `createMlpTeam`: đếm approved chỉ status=approved (hoặc absent). Đầy → set `status="waitlisted"`, KHÔNG bump `Tournament.registered`.
- **Bug ẩn** ([`41390a7c`](https://github.com/den3110/abcdk-/commit/41390a7c)): web/mobile đi qua `createRegistrationInvite` (invite flow) có `preflightChecks` RIÊNG vẫn hard-reject "Giải đã đủ". Fix: `preflightChecks` không throw nữa, trả `overCap: true`. Caller (`finalizeIfReady`, admin direct path, user direct path) quyết status.
- `RegInvite.desiredStatus`: admin ép khi tạo invite, `finalizeIfReady` tôn trọng.

**Public counts** ([`1e406aa7`]): `getTournaments` aggregation + `getTournamentById.stats.registrationsCount` chỉ đếm approved → **48/48 công khai giữ nguyên** dù có 10 cặp waitlist.

**Admin promote + Auto-promote FIFO**:
- `waitlistService.js`: `autoPromoteRegistrationFromWaitlist` + `autoPromoteMlpTeamFromWaitlist`. Sort FIFO theo `createdAt`.
- Hook 4 site: `cancelRegistration`, `adminDeleteRegistration`, `adminUpdateRegistration` (rejected/withdrawn từ approved), `updateMlpTeam` + `deleteMlpTeam`. Cũng auto-fire khi manual promote via `adminUpdateRegistration.status=approved`.

**Admin dialog "Chờ / Duyệt luôn"** ([`41390a7c`]): khi `isAdmin && registrationsCount >= maxPairs` → dialog 3 nút (Huỷ / ⏳ Chờ duyệt / ✓ Duyệt luôn). Pass `status` vào body `createRegInvite`. Web + Mobile ([`3185376`](https://github.com/den3110/pickletour-app/commit/3185376)).

**Notification** ([`caf80447`](https://github.com/den3110/abcdk-/commit/caf80447)):
- Events mới: `REGISTRATION_WAITLIST_PROMOTED`, `MLP_TEAM_WAITLIST_PROMOTED`.
- 2 audience mỗi promote: VĐV/team (title "🎉 Đăng ký của bạn đã được duyệt") + BTC (createdBy + managers, title "Đã duyệt / Auto-duyệt cặp waitlist").
- Body phân biệt auto vs manual promote. Deep link `data.url` → `/tournament/:tid/register` hoặc `/tournament/:tid/mlp/teams`.

**UI web + mobile** ([`1e406aa7`], [`05f9a98`](https://github.com/den3110/pickletour-app/commit/05f9a98), [`ff22a645`](https://github.com/den3110/abcdk-/commit/ff22a645), [`b221953`](https://github.com/den3110/pickletour-app/commit/b221953)):
- Section "⏳ Chờ duyệt · N" dưới danh sách chính. Card dùng chung `PlayerInfo` component (web) hoặc RegItem style (mobile) — có avatar, phone (mask cho user, full cho admin/manager qua `phoneForRole`), score chip, tap mở PublicProfileDialog.
- Nút "✓ Duyệt" cho admin/manager gọi `useManagerSetRegStatusMutation → PATCH /admin/tournaments/registrations/:regId` với body.status.
- MlpTeamsPage extend enum filter + nút Duyệt cho waitlisted status.

### 2.8 MLP badge + Referee pool + Điểm trình VĐV — [`6991b266`](https://github.com/den3110/abcdk-/commit/6991b266)

**MLP badge tournament card**: Web `Tournament.jsx` + mobile `(tabs)/index.tsx` → góc trên trái card hiện 🏆 MLP (cam gradient) hoặc 👥 TEAM (tím) khi `tournamentMode` khác standard.

**Referee pool** (backend + web):
- Model mới `TournamentReferee (tournament, user, note)` + CRUD endpoints `/api/tournaments/:tid/referees`.
- Web `TournamentRefereeDialog.jsx` — dialog "Quản lý trọng tài": search user (`useLazySearchUser`) → add với note. List avatar/phone/note/remove.
- Button "👨‍⚖️ Quản lý trọng tài" cạnh "Quản lý cụm sân" trong MlpDualsPage.
- **Chưa wire vào** `TournamentCourtClusterDialog` (station.defaultReferees dropdown) — phase sau.

**Điểm trình VĐV**: 
- Backend helper `attachPlayerScores()` query `Ranking` bulk → gắn `score={single, double}` vào từng player. Apply `listMlpTeams` + `getMlpTeam`.
- Web `MlpTeamsPage TeamEditor`: search dropdown chip "Đôi X.XX" + "Đơn Y.YY". Roster label hiện tổng đôi + tổng đơn. Roster item chip điểm cạnh giới tính.
- Mobile `teams.tsx`: same UI RN-style.

---

## 3. Bug fix + Landmine đã ghi nhận

### 3.1 Overlay MLP prod bị "Chờ trận đấu MLP" — [`84c439bb`](https://github.com/den3110/abcdk-/commit/84c439bb)

Root cause: `station.currentMatch` trên prod đang trỏ tới Match doc từ giải KHÁC (không phải MLP). Overlay path 1 catch match đó → `isMlpSub=false` → skip. Path 2 (query MLP theo station) chỉ chạy khi `liveMatch==null` → 404.

Fix: chỉ set `liveMatch` từ `station.currentMatch` NẾU candidate có `meta.mlp.dualId`. Non-MLP `currentMatch` bị bỏ qua → path 2 tìm MLP match khác trên cùng station.

### 3.2 User bị chặn "Giải đã đủ" — [`41390a7c`](https://github.com/den3110/abcdk-/commit/41390a7c)

Fix waitlist đầu tiên ([`1e406aa7`]) chỉ đụng `createRegistration` (direct) + `adminCreateRegistration`. Web/mobile lại đi qua `createRegistrationInvite` (invite flow) → `preflightChecks` riêng vẫn hard-reject.

Fix: `preflightChecks` không throw, return `overCap: true`. `finalizeIfReady`/admin direct/user direct đều tự quyết status.

### 3.3 OTA giờ push cho CẢ `ios 1.1.13` VÀ `ios 1.1.9`

Session này user yêu cầu push cả 2 target. Tất cả OTA deploy trong session (5 lần) đều fire cả 2:
```bash
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "..."
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.9  -c production -m "..."
```
Android + iOS versions khác **KHÔNG** được cập nhật.

### 3.4 SSH VPS — password vẫn `Hoang@07082026`

`PasswordAuthentication yes` + `PermitRootLogin yes` được bật từ session trước và giữ nguyên. Dùng `sshpass` inline:
```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 "..."
```

### 3.5 Data migration cần

- Registration cũ (trước session này) không có `status` field. Query đều dùng `$or: [{status: "approved"}, {status: {$exists: false}}, {status: null}]` để BC.
- MlpTeam cũ không đụng — enum đã thêm "waitlisted" nhưng docs cũ vẫn `approved/pending/…`.
- Match doc MLP cũ có thể có `courtStation=null` nếu tạo trước khi BTC gán court → overlay sẽ không tìm thấy. BTC LƯU dual để trigger `ensureMlpDualMatchDocs` update Match doc courtStation.

### 3.6 Referee pool chưa wire vào cụm sân UI

Backend model + endpoints + dialog "Quản lý trọng tài" đã ready. Nhưng `TournamentCourtClusterDialog.jsx` khi edit `station.defaultReferees` VẪN đang search toàn bộ User (chưa filter theo pool). Wire dropdown = phase sau.

---

## 4. Việc còn dở

### 4.1 Priority cao

- 🟡 **Backend deploy**: đã `pm2 restart server` (2 instance) sau commit cuối `6991b266`. Nếu CI/CD tự pull sau bạn không cần làm gì.
- 🟡 **Field "Giới hạn tổng điểm trình" (maxTotalScore) cho MLP team** — user request cuối cùng, CHƯA làm:
  - Extend `tournamentModel.mlpConfig.groupStage.maxTotalScore` (hoặc top-level `maxTotalScore`).
  - Admin panel tournament edit UI expose field.
  - Backend `createMlpTeam` + `updateMlpTeam` validate `sum(players.score.double) <= maxTotalScore`.
  - Frontend MlpTeamsPage TeamEditor: hiện tổng team + warning red khi vượt cap (đã có tổng chip, cần thêm validate + cap display).

### 4.2 Priority thấp

- **Wire referee pool vào TournamentCourtClusterDialog** — thay Autocomplete search all users bằng dropdown pool referees.
- **PDF certificate** cho champion — từ session trước.
- **Overlay MLP studio** — cấu hình theme/logo/sponsor cho overlay (hiện hardcode navy+gold).
- **Round-robin double round** cho MLP đã có config `doubleRound` nhưng chưa test kỹ.
- **Playoff bracket** sau round-robin — logic có sẵn nhưng cần test dataset lớn.
- **Xoá vòng (round) UI** — backend đã sẵn sàng (`DELETE /api/mlp/tournaments/:tid/duals/round/:round`), UI chưa wire.

---

## 5. Environment cần biết

### 5.1 VPS credentials

```
Host: 103.90.225.130
User: root
Password: Hoang@07082026
```
PasswordAuthentication yes + PermitRootLogin yes (từ session trước).

### 5.2 OTA hot-updater — push cả 2 target

```bash
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a

# Target 1
rm -rf .hot-updater/output
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "..."

# Target 2
rm -rf .hot-updater/output
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.9  -c production -m "..."
```

Kill switch: `https://pickletour.vn/api/auth/system/ota/allowed`.

### 5.3 Repo paths trong máy dev

- Root: `/Users/admin/Desktop/Projects/Pickletour/abcdk`
  - Backend: root/backend
  - Frontend web: root/frontend
- Mobile: root/pickletour-app-mobile
- Admin: root/admin-pickletour

### 5.4 Test DB — Test MLP 1

- Tournament `Test MLP 1` (id `6a749574f3fd296bacebcc62`) — vẫn dùng để test MLP.
- Court station `1` (id `6a15c7eec4b669ccd0b879fd`) — overlay URL: `https://pickletour.vn/overlay/mlp/court/6a15c7eec4b669ccd0b879fd`.

### 5.5 Restart backend nhanh

```bash
SSHPASS='Hoang@07082026' sshpass -e ssh -o StrictHostKeyChecking=no root@103.90.225.130 \
  "cd /abcdk- && git pull origin master 2>&1 | tail -3 && pm2 restart server 2>&1 | grep '✓'"
```

---

## 6. Snapshot commit history session

**Backend + web** `abcdk-`: `fb6473ed → 6991b266` (~19 commits)

Landmark commits theo thứ tự thời gian:

1. [`cb2267b4`](https://github.com/den3110/abcdk-/commit/cb2267b4) MLP vòng bảng + bốc thăm + knockout.
2. [`a2a4d2a1`](https://github.com/den3110/abcdk-/commit/a2a4d2a1) Reset endpoint + dialog.
3. [`e0e21f96`](https://github.com/den3110/abcdk-/commit/e0e21f96) Fix live draw commit gate.
4. [`1f01b59c`](https://github.com/den3110/abcdk-/commit/1f01b59c) KO preview + trọng tài theo sân + inline court + xem lineup.
5. [`5e2e5c2a`](https://github.com/den3110/abcdk-/commit/5e2e5c2a) Fix 404 bracket click.
6. [`5ca9eef1`](https://github.com/den3110/abcdk-/commit/5ca9eef1) Realtime `tournament:invalidate` cho referee tab.
7. [`ff9626b4`](https://github.com/den3110/abcdk-/commit/ff9626b4) Overlay accept status=scheduled.
8. [`84c439bb`](https://github.com/den3110/abcdk-/commit/84c439bb) Fix overlay + realtime MlpDualsPage.
9. [`6964a80f`](https://github.com/den3110/abcdk-/commit/6964a80f) Overlay compact redesign navy+gold.
10. [`1e406aa7`](https://github.com/den3110/abcdk-/commit/1e406aa7) Waitlist 48/48 + auto-promote FIFO.
11. [`d009f251`](https://github.com/den3110/abcdk-/commit/d009f251) Overlay serve ball indicator.
12. [`6f05ac6a`](https://github.com/den3110/abcdk-/commit/6f05ac6a) Fix web schedule MLP team name.
13. [`41390a7c`](https://github.com/den3110/abcdk-/commit/41390a7c) Fix waitlist user path + admin dialog.
14. [`ff22a645`](https://github.com/den3110/abcdk-/commit/ff22a645) Waitlist card web reuse PlayerInfo.
15. [`1e7b9e35`](https://github.com/den3110/abcdk-/commit/1e7b9e35) Overlay DreamBreaker header inline.
16. [`5adafb77`](https://github.com/den3110/abcdk-/commit/5adafb77) Populate defaultReferees courtStation.
17. [`caf80447`](https://github.com/den3110/abcdk-/commit/caf80447) Waitlist promote notification.
18. [`6991b266`](https://github.com/den3110/abcdk-/commit/6991b266) MLP badge + Quản lý trọng tài + điểm trình VĐV.

**Mobile** `pickletour-app`: `c3d0841 → 2828e36` (~11 commits)

1. [`740207c`](https://github.com/den3110/pickletour-app/commit/740207c) Group stage mobile: pool tabs + per-bảng BXH + KO bracket view.
2. [`010f208`](https://github.com/den3110/pickletour-app/commit/010f208) Placeholder "Nhất bảng A".
3. [`0576d33`](https://github.com/den3110/pickletour-app/commit/0576d33) Guard mở shell KO chưa có team.
4. [`d27367a`](https://github.com/den3110/pickletour-app/commit/d27367a) Referee mobile hiện tên đội MLP + swap khi Đổi bên.
5. [`05f9a98`](https://github.com/den3110/pickletour-app/commit/05f9a98) Waitlist mobile UI (register + MLP teams).
6. [`642177c`](https://github.com/den3110/pickletour-app/commit/642177c) Fix flicker tên đội ↔ tên VĐV.
7. [`3185376`](https://github.com/den3110/pickletour-app/commit/3185376) Dialog Chờ/Duyệt luôn cho admin.
8. [`b221953`](https://github.com/den3110/pickletour-app/commit/b221953) Waitlist card avatar + phone + score + profile.
9. [`f8ac382`](https://github.com/den3110/pickletour-app/commit/f8ac382) Referee tab DreamBreaker fallback station.defaultReferees.
10. [`4fc8fe3`](https://github.com/den3110/pickletour-app/commit/4fc8fe3) MLP + TEAM badge tournament card.
11. [`2828e36`](https://github.com/den3110/pickletour-app/commit/2828e36) Điểm trình VĐV trong team roster.

---

## 7. Câu hỏi còn mở

1. **Field `maxTotalScore` cho MLP team roster** — user request cuối, chưa làm. Cần user xác nhận: cap là tổng điểm ĐÔI của team, hay có ràng buộc riêng cho điểm ĐƠN nữa? Vị trí trong tournament schema — top-level `maxTotalScore` hay nested `mlpConfig.maxTotalScore`?
2. **Referee pool wire vào cụm sân UI** — cần rework `TournamentCourtClusterDialog` để `station.defaultReferees` dropdown filter theo pool trọng tài của giải.
3. **Waitlist cho registration invite flow** — user hiện gặp invite → invite gửi tới VĐV thứ 2 → chấp nhận → finalize thành waitlist. Logic OK, nhưng notification khi finalize waitlist chưa có message riêng (VĐV không biết mình vào chờ). Có nên gửi notification "Bạn đã vào waitlist" ngay lúc finalize?
4. **Auto scp overlay template** cho generator VPS — từ session trước vẫn chưa làm; nhưng generator template dùng cho giải THƯỜNG, MLP đã có `/overlay/mlp/court/:id` riêng nên có thể không cần.
