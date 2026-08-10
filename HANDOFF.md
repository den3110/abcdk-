# PickleTour — HANDOFF Session (2026-08-10 → 2026-08-11)

> Session dài **2 ngày**, ~30+ commits, tập trung 100% vào **MLP
> tournament**: hoàn thiện từ format bug (mode bị ép về standard) → tạo
> Match doc cho referee flow → per-sub assignment → DreamBreaker →
> overlay livestream → registration UI riêng cho MLP → visibility
> permission (captain chỉ thấy team + dual mình).
>
> Đọc kèm `HANDOVER.md` (bản gốc từ đội trước) để nắm kiến trúc chung.
>
> **Nhóm việc chính trong session:**
> 1. **Fix root bug: `normalizeTournamentMode`** ép mọi mode ≠ "team"
>    về "standard" → MLP giải chọn xong không lưu được.
> 2. **MLP referee flow đầy đủ**: tạo Match doc cho mỗi sub-match →
>    trọng tài chấm bằng RefereeScorePanel native. Backend sync ngược
>    Match → sub-match cache.
> 3. **Per-sub-match assignment**: mỗi sub 1 trọng tài + 1 sân + 1 giờ
>    riêng (2 sân song song).
> 4. **DreamBreaker trên mobile**: Start lineup + 1v1 rotation + trọng
>    tài chấm.
> 5. **MLP overlay livestream**: `/overlay/mlp/court/:stationId` —
>    unified sub-match (2v2) → DreamBreaker (1v1) tự chuyển.
> 6. **Bracket view + Registration riêng cho MLP** (web + mobile).
> 7. **Visibility gate cho captain** (không tạo nhiều team, chỉ thấy
>    team/dual mình, chỉ chọn lineup team mình).
> 8. **Bug fix mobile**: chip chat, avatar flicker khi Đổi tay, sai tay
>    giao, mất avatar khi swap, layout FAB đè avatar, bet chip position.

---

## 1. Trạng thái deployment

| Kênh | Version | Trạng thái |
|---|---|---|
| **Backend prod** (`pickletour.vn/api`) | commit `3245a37b` | ✅ Đã deploy (SSH deploy trong session, `pm2 restart server`). |
| **Frontend web** (`pickletour.vn`) | commit `3245a37b` | ✅ Đã build + rsync (`yarn build:deploy`). CI/CD auto-pull sau các commit cuối. |
| **Admin panel** (`admin.pickletour.vn`) | không đổi | ✅ Không có commit cho admin trong session. |
| **Mobile iOS TestFlight** | `1.1.13 (43)` cũ | 🟡 Native binary cũ, feature ship qua OTA. Chưa submit App Review. |
| **Mobile Android Play** | `1.1.13 (43)` LIVE | ✅ Rollout từ trước. **Session này KHÔNG push OTA Android** — theo yêu cầu user chỉ push OTA iOS 1.1.13 từ giữa session trở đi. |
| **Mobile iOS OTA production** | Latest bundle `MLP mobile: team form với roster search + edit + color picker` | ✅ Deployed cho `ios 1.1.13`. User mở app tự pull. |
| **Overlay Generator VPS** | overlay-template-mlp.html chưa scp | 🟡 File local `/Users/admin/Desktop/Giai Thien truong/generator/overlay-template-mlp.html` (từ session trước). |

**Git remotes:**

| Repo | Latest commit |
|---|---|
| `github.com/den3110/abcdk-` (root + backend + web) | `3245a37b` |
| `github.com/den3110/pickletour-app` (mobile) | `c3d0841` |
| `github.com/den3110/abcde` (admin) | không đổi |

---

## 2. Feature ship trong session

### 2.1 Fix root bug MLP mode

**Bug**: [`normalizeTournamentMode`](backend/services/teamTournament.service.js#L27) chỉ nhận `"team"` — mọi giá trị khác (kể cả `"mlp"`) đều ép về `"standard"`. Admin chọn MLP → BE lưu `standard` → giải chạy y thường, không có MLP UI nào bật.

**Fix** ([`e5be0327`](https://github.com/den3110/abcdk-/commit/e5be0327)): whitelist `{ team, mlp, standard }`, khớp với Joi validator sẵn có ở admin.

### 2.2 MLP referee flow — Match doc cho mỗi sub-match

Trước: MLP sub-match KHÔNG tạo Match doc → trọng tài không chấm được qua app (chỉ BTC nhập tay).

**New file [`backend/services/mlpMatchSync.js`](backend/services/mlpMatchSync.js)**:
- `ensureMlpSubMatchDoc(dual, sub, tour)`: tạo/update Match doc với `referee`, `court`, `courtStation`, `scheduledAt`, `rules` từ dual + `mlpConfig`. `meta.mlp` chứa **synth pairA/pairB** (với player1/player2 là User đầy đủ) để RefereeScorePanel render được.
- `ensureMlpDualMatchDocs(dual, tour)`: batch sync tất cả sub khi dual đổi referee/court/scheduledAt.
- `syncMatchToMlpSubMatch(matchDoc)`: sync điểm từ Match về `sub.result`, recompute `dual.slotWinsA/B`, apply rating (idempotent).

**Wire vào [`mlpController.js`](backend/controllers/mlpController.js)**:
- `assignSubMatchLineup`: gán lineup xong → tạo Match doc.
- `patchMlpDual`: đổi referee/court/giờ → sync xuống tất cả Match con.

**Wire vào [`matchModel.js`](backend/models/matchModel.js)**:
- Post `save` + `findOneAndUpdate` hook: nếu `doc.meta?.mlp?.subId` tồn tại → gọi `syncMatchToMlpSubMatch` → điểm chảy ngược về sub-match cache real-time.

**Key insight**: `resolveMatchSideDisplayPair` giờ ưu tiên `meta.mlp.pairA/pairB` → mobile code path chạy y hệt giải thường (avatar, CCCD, slot swap, serverUidShow đều dùng chung). Xem [`7fa1cebb`](https://github.com/den3110/abcdk-/commit/7fa1cebb).

### 2.3 Per-sub-match assignment

Trước: 1 dual chỉ có 1 bộ referee/court/scheduledAt → 2 sân sẵn có chỉ chạy được 1.

- `SubMatchSchema` thêm `referees[]`, `court`, `courtStation`, `scheduledAt` (override dual-level).
- `ensureMlpSubMatchDoc` ưu tiên sub-level, fallback về dual-level.
- Endpoint `PATCH /api/mlp/duals/:id/subs/:subId` — set per-sub.
- Web `MlpDualDetailPage` mỗi sub card có `SubMatchAssignmentPanel` riêng.
- Commit: [`c395c0f6`](https://github.com/den3110/abcdk-/commit/c395c0f6).

### 2.4 DreamBreaker referee flow (mobile)

- Backend: helper `canScoreDual(user, tour, dual)` = manager || referee của dual/sub → cho phép trọng tài Start / +1 / undo DreamBreaker (không chỉ BTC). Commit [`f6b7a4c4`](https://github.com/den3110/abcdk-/commit/f6b7a4c4).
- Mobile [`app/tournament/[id]/mlp/dual/[dualId].tsx`](pickletour-app-mobile/app/tournament/[id]/mlp/dual/[dualId].tsx):
  - Nút **"Chọn lineup + Start"** khi dual vào tie_break.
  - `StartDreamBreakerModal`: chọn thứ tự luân phiên 4 VĐV mỗi team, chip có số 1/2/3/4.
  - `CurrentPlayerCard`: hiện VĐV đang cầm vợt, người thứ #N/M, còn Kđ nữa xoay.
  - +1 Team A / Undo / +1 Team B (dùng tên team thay vì "A/B" cứng).
- Referee tab (`referee.tsx`) hiện card DreamBreaker cần chấm cho MLP dual → tap → mở dual detail.

### 2.5 MLP overlay livestream theo sân

- Endpoint mới: `GET /api/live/courts/:courtStationId/mlp-overlay` — 2 bước:
  1. Live MLP sub-match trên court → return sub-match payload (team + lineup).
  2. MlpDualMatch với status `tie_break` trên court → return DreamBreaker payload với current player rotate theo score.
- Frontend page: `/overlay/mlp/court/:courtStationId?theme=dark|light&compact=1&hidePlaceholder=1`. Poll 2.5s. Transparent bg cho OBS chroma-key.
- Auto-switch layout: **sub-match** = (TEAM) player1 – player2 vs (TEAM) player1 – player2. **DreamBreaker** = 1v1 avatar + rotation info + Target 21.
- `DualAssignmentPanel` khi BTC gán court hiện box "Overlay livestream" với URL + Copy + Mở overlay.
- Placeholder card "Sân X · Chờ trận đấu MLP…" khi 404 (fetch song song `/api/live/courts/:id`).
- Commit: [`89194e32`](https://github.com/den3110/abcdk-/commit/89194e32), [`eb070473`](https://github.com/den3110/abcdk-/commit/eb070473).

### 2.6 Bracket view + Registration riêng cho MLP

**Bracket view** ([`b719cb95`](https://github.com/den3110/abcdk-/commit/b719cb95)):
- Web `MlpBracketView.jsx`: guard `isMlpTour` trong `TournamentBracket.jsx` → render sidebar BXH top 8 + duals theo round với DreamBreaker alert.
- Mobile `MlpBracketView.tsx` tương đương, BXH top 5 + duals theo round với DualCard.

**Registration** ([`b719cb95`](https://github.com/den3110/abcdk-/commit/b719cb95)):
- Web `MlpTournamentRegistrationView.jsx`: guard `mode==='mlp'` trong `TournamentRegistration.jsx` → captain tạo team + roster (autocomplete search, chip color theo gender). Admin duyệt inline.
- Mobile `register.tsx`: guard `mode==='mlp'` → hiện card **"Đăng ký giải MLP"** với CTA dẫn đến `mlp/teams`.
- Mobile `mlp/teams.tsx`: form tạo team đầy đủ với **color picker 10 preset + search VĐV + roster inline** (add/remove với số thứ tự + gender chip + avatar), sửa team preload data ([`c3d0841`](https://github.com/den3110/pickletour-app/commit/c3d0841)).

### 2.7 Visibility gate cho captain

- **Web `MlpTeamsPage`**: ẩn nút "Tạo team" nếu captain đã có team; icon Sửa/Xoá chỉ cho own team hoặc admin/manager.
- **Web `MlpDualsPage`**: captain chỉ thấy dual có team mình. Ẩn "Quản lý cụm sân", "Sinh knockout", "Generate duals" — chỉ manager thấy.
- **Web `MlpDualDetailPage`**: captain khác team → block truy cập, redirect về MLP Duals. Ẩn `DualAssignmentPanel`, `SubMatchAssignmentPanel`, `ScoreEditor` — chỉ manager. `LineupDialog` giờ **chỉ show cột team của user** (không hiện team đối thủ).
- **Backend `assignSubMatchLineup`**: cho captain quyền chọn lineup team mình. Manager set cả 2 bên; captain A chỉ set playersA (playersB giữ nguyên), captain B ngược lại.
- **Mobile MLP dual detail**: nút Lineup per side với gate; ScoreEditor ẩn khỏi captain (hiện read-only score); `SubMatchLineupModal` chỉ show 1 team của user.

Commits: [`a9211891`](https://github.com/den3110/abcdk-/commit/a9211891), [`8087eff3`](https://github.com/den3110/abcdk-/commit/8087eff3).

### 2.8 Mobile bug fix khác (không phải MLP)

- **Chat badge unread only**: [`bft22ospx`](poker) — chat modal auto close sau send.
- **Poker table**: FAB top-right, bet chip position toward pot, all-in vs call runout board thẳng, disable swipe-back trên table screen ([`4c002e02`](https://github.com/den3110/abcdk-/commit/4c002e02) + OTA).
- **MLP flicker khi Đổi tay/Đổi bên**: bump timeout 2.5s → 8s cho `localServeOverride`, `localBaseOverride`, `forcedServerRef.until`. Root cause thật: [`2977e59b`](https://github.com/den3110/abcdk-/commit/2977e59b) — `getTeamPlayerIds` không nhận player IDs cho MLP → `validateServeForMatch` reject → mobile revert.
- **Avatar không hiện MLP**: [`bs50ycqlr`](poker) — `hasPairPlayerData` giờ check identity thật (`_id`/`name`/`nickname`), skip pairA rỗng do aggregation.
- **Đội A/B chưa rõ**: fix root ở [`09da725f`](https://github.com/den3110/abcdk-/commit/09da725f) — `resolveMatchSideDisplayName` ưu tiên `meta.mlp`.
- **Populate captain**: [`1612b96d`](https://github.com/den3110/abcdk-/commit/1612b96d) — `listMlpDuals` + `getMlpDual` populate teamA/B include field `captain` (trước chỉ include `_id name shortName logo color`) → captain filter frontend hoạt động đúng.

---

## 3. Bug fix + Landmine đã ghi nhận

### 3.1 OTA giờ chỉ push cho `ios 1.1.13`

Theo yêu cầu user giữa session ("các bản update tiếp theo hãy chỉ push ota ios 1.1.13 thôi"), toàn bộ OTA sau đó (~15 lần) chỉ push cho `ios 1.1.13`. **Android + iOS 1.1.9 KHÔNG được cập nhật bundle** trong session này → user cũ trên các phiên bản đó vẫn dùng code cũ.

### 3.2 SSH VPS bị fail2ban rate limit

VPS `103.90.225.130` tạm khoá SSH sau nhiều lần retry password sai. Có thể unlock bằng cách wait 60-180s. Session này đã bật lại `PasswordAuthentication yes` + `PermitRootLogin yes` trong `/etc/ssh/sshd_config` để cho Claude SSH được — **có thể user muốn tắt lại sau session để bảo mật**.

Password `Hoang@07082026` giờ dùng được cho SSH. Vẫn khuyến nghị dùng SSH key sau này.

### 3.3 MLP overlay chưa có styling variant

Overlay hiện chỉ 1 theme scoreboard. Nếu BTC muốn custom (logo overlay, sponsor…) → cần chỉnh trực tiếp `MlpOverlay.jsx`. Chưa có studio config.

### 3.4 Match doc cũ chưa có `meta.mlp`

Với dual đã tạo TRƯỚC session này (nếu có), sub-match không có Match doc. Cần trigger tạo lại bằng cách:
- Vào dual detail → LƯU panel top (kích `patchMlpDual` → `ensureMlpDualMatchDocs`).
- Hoặc LINEUP → chọn lại → Submit (kích `assignSubMatchLineup` → `ensureMlpSubMatchDoc`).

### 3.5 Registration MLP: BTC không thể tạo team hộ VĐV

Hiện captain tự tạo team. Nếu BTC muốn tạo hộ (VĐV không có tài khoản) → chưa có UI. Backend endpoint `POST /api/mlp/tournaments/:tid/teams` chấp nhận `captain` field nhưng UI không expose. **User có thể request feature này.**

### 3.6 Poker timer + rate limit in-memory (từ session trước)

Vẫn giữ nguyên. Chuyển Redis là việc dài hơi.

### 3.7 Overlay MLP template HTML cũ chưa scp lên VPS

Từ session trước — vẫn còn ở local. Cần scp thủ công nếu muốn overlay generator dùng template MLP.

---

## 4. Việc còn dở

### 4.1 Priority cao

- 🟡 **Cần deploy backend `pm2 restart server`** sau khi CI/CD pull commit `3245a37b` (mobile submodule bump — chỉ ảnh hưởng submodule pointer, không đổi backend code, nhưng nếu CI/CD auto restart thì OK).
- 🟡 **iOS App Review 1.1.13 (43)**: chưa submit từ App Store Connect UI.
- 🟡 **Android + iOS 1.1.9 outdated**: nhiều feature MLP không có trên các phiên bản này. Cần user request nếu cần push OTA cho các target đó.

### 4.2 Priority thấp — polish MLP

- **Xoá vòng (round)**: backend endpoint `DELETE /api/mlp/tournaments/:tid/duals/round/:round` đã có nhưng CHƯA có UI trong MlpDualsPage (bị interrupt giữa chừng do user đổi request sang visibility fix). Cần grouping duals by round + nút "Xoá vòng" per round.
- **BTC tạo team hộ VĐV** (§3.5).
- **PDF certificate** cho champion — vẫn từ session trước.
- **Admin panel dedicated MLP moderation page** — vẫn dùng web `/tournament/:id/mlp/*`.
- **Overlay MLP studio**: cấu hình theme, logo, sponsor cho overlay.

### 4.3 Priority thấp — MLP tính năng mới

- **Round-robin double round** (mỗi cặp gặp 2 lần) — hiện chỉ hỗ trợ round-robin 1 lần hoặc single-elim.
- **Playoff bracket**: sau round-robin, top N vào bracket knockout. Đã có button "Sinh knockout" nhưng cần test kỹ.
- **Notification captain khi được chọn lineup**: hiện chỉ notify khi team approve/reject và dual finish.
- **Live commentary** cho DreamBreaker.

---

## 5. Environment cần biết

### 5.1 VPS credentials

```
Host: 103.90.225.130
User: root
Password: Hoang@07082026 (giờ DÙNG ĐƯỢC — session này đã bật lại
  PasswordAuthentication yes + PermitRootLogin yes trong sshd_config)
```

Nếu muốn dùng SSH key: copy `~/.ssh/id_ed25519.pub` từ máy dev Mac vào
`/root/.ssh/authorized_keys` trên VPS. Đã có key trên máy admin.

### 5.2 OTA hot-updater

- Bundle store: Cloudflare R2, DB: Cloudflare D1
- CLI: `./node_modules/.bin/hot-updater` (0.25.14 khớp native)
- Kill switch: `https://pickletour.vn/api/auth/system/ota/allowed`
- **Deploy pattern (chỉ iOS 1.1.13)**:
```bash
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a
rm -rf .hot-updater/output 2>/dev/null
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "message"
```

### 5.3 CI/CD

- Root repo có CI/CD tự pull + deploy web (`yarn build:deploy`) sau mỗi push tới master. Không cần SSH manual sau khi commit.
- Backend restart: **chưa rõ có auto restart pm2 không** — nếu cần chắc, SSH `pm2 restart server`.

### 5.4 Repo paths trong máy dev

- Root: `/Users/admin/Desktop/Projects/Pickletour/abcdk`
  - Backend: root/backend
  - Frontend web: root/frontend
- Mobile: `/Users/admin/Desktop/Projects/Pickletour/abcdk/pickletour-app-mobile`
- Admin: `/Users/admin/Desktop/Projects/Pickletour/abcdk/admin-pickletour`
- Overlay generator local: `/Users/admin/Desktop/Giai Thien truong/generator/`

### 5.5 Test DB — Test MLP 1

- Tournament `Test MLP 1` (id `6a749574f3fd296bacebcc62`) — có sẵn 3 teams (Vô Rank, Thiên Trường 1, Lã Vọng 1) đã approved, dual matches sinh sẵn, sub-matches với lineup và điểm.
- Court station `2` (id `6a15c7efc4b669ccd0b87a16`) — test overlay URL: `https://pickletour.vn/overlay/mlp/court/6a15c7efc4b669ccd0b87a16`.
- Trọng tài test: Lê thanh (email `thanhmcxk45@gmail.com`, role `referee`).

---

## 6. Deploy checklist (chỉ cho session mới nếu cần)

```bash
# 1. Backend deploy (chỉ khi có commit backend mới sau CI/CD)
ssh root@103.90.225.130 "cd /abcdk- && git pull origin master && pm2 restart server"

# 2. Frontend web — CI/CD tự pull, nếu cần force:
ssh root@103.90.225.130 "cd /abcdk-/frontend && yarn build:deploy"

# 3. Overlay MLP template (chưa scp):
scp "/Users/admin/Desktop/Giai Thien truong/generator/overlay-template-mlp.html" \
  root@103.90.225.130:/root/overlay-generator/
ssh root@103.90.225.130 "systemctl restart overlay-gen"

# 4. iOS Submit for Review (từ App Store Connect UI)

# 5. OTA (chỉ iOS 1.1.13):
cd pickletour-app-mobile
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
set -a && source .env.hotupdater && set +a
rm -rf .hot-updater/output
./node_modules/.bin/hot-updater deploy -p ios -t 1.1.13 -c production -m "message"
```

---

## 7. Snapshot commit history session

**Backend + web** `abcdk-`: `3e46c9de → 3245a37b` (~22 commits)

Landmark commits (theo thứ tự thời gian):

- **Fix root**: [`e5be0327`](https://github.com/den3110/abcdk-/commit/e5be0327) normalizeTournamentMode.
- **Match doc**: [`cf5bb583`](https://github.com/den3110/abcdk-/commit/cf5bb583) mlpMatchSync service + ensureMlpSubMatchDoc + syncMatchToMlpSubMatch.
- **Per-sub assignment**: [`c395c0f6`](https://github.com/den3110/abcdk-/commit/c395c0f6).
- **Fix populate + meta projection**: [`a383bf40`](https://github.com/den3110/abcdk-/commit/a383bf40).
- **Fix "Đội A/B chưa rõ"**: [`09da725f`](https://github.com/den3110/abcdk-/commit/09da725f).
- **Fix CCCD fields**: [`15a51f44`](https://github.com/den3110/abcdk-/commit/15a51f44).
- **Fix Lịch thi đấu MLP**: [`bba8b858`](https://github.com/den3110/abcdk-/commit/bba8b858).
- **Fix serve/slots validation**: [`2977e59b`](https://github.com/den3110/abcdk-/commit/2977e59b).
- **Hydrate pairA/pairB từ meta.mlp**: [`7fa1cebb`](https://github.com/den3110/abcdk-/commit/7fa1cebb).
- **DreamBreaker referee permission**: [`f6b7a4c4`](https://github.com/den3110/abcdk-/commit/f6b7a4c4).
- **Bracket + Registration view riêng MLP**: [`b719cb95`](https://github.com/den3110/abcdk-/commit/b719cb95).
- **Color picker + preset**: [`0d407697`](https://github.com/den3110/abcdk-/commit/0d407697).
- **Gate BTC + Sửa team preload**: [`3f6cace1`](https://github.com/den3110/abcdk-/commit/3f6cace1).
- **MLP overlay theo sân**: [`89194e32`](https://github.com/den3110/abcdk-/commit/89194e32).
- **Fix overlay placeholder + fallback court query**: [`eb070473`](https://github.com/den3110/abcdk-/commit/eb070473).
- **Fix visibility captain**: [`a9211891`](https://github.com/den3110/abcdk-/commit/a9211891).
- **Fix LineupDialog chỉ show team user + backend captain lineup**: [`8087eff3`](https://github.com/den3110/abcdk-/commit/8087eff3).
- **Fix populate captain trong list/get dual**: [`1612b96d`](https://github.com/den3110/abcdk-/commit/1612b96d).

**Mobile** `pickletour-app`: `745482e → c3d0841` (~6 commits)

Landmark commits:

- [`48fbeb1`](https://github.com/den3110/pickletour-app/commit/48fbeb1) bump serve/base override timeouts 2.5→8s + hard-prefer meta.mlp.
- [`c22c752`](https://github.com/den3110/pickletour-app/commit/c22c752) DreamBreaker referee UI (Start lineup modal + rotation display).
- [`7d2da00`](https://github.com/den3110/pickletour-app/commit/7d2da00) ẩn Vòng bảng cho MLP + DreamBreaker card trong referee tab.
- [`634e80a`](https://github.com/den3110/pickletour-app/commit/634e80a) MlpBracketView mobile.
- [`0c86a21`](https://github.com/den3110/pickletour-app/commit/0c86a21) registration redirect + captain lineup UI per side.
- [`c3d0841`](https://github.com/den3110/pickletour-app/commit/c3d0841) mobile MLP team form với roster search + edit + color picker.

---

## 8. Câu hỏi còn mở

1. **Tính năng "xoá vòng" (delete round)** — backend đã sẵn sàng, cần wire UI. User đã request nhưng bị interrupt.
2. **BTC tạo team hộ VĐV** (không có account) — có nên add? Backend đã accept `captain` field.
3. **Playoff bracket sau round-robin** — cần test kỹ flow "Sinh knockout" trên dataset có nhiều team.
4. **Overlay MLP studio** cho phép cấu hình theme/logo — có cần không? Hay để hardcode style?
5. **Android + iOS 1.1.9 OTA** — có cần push cho các target này không? Hiện chỉ iOS 1.1.13 nhận bundle mới.
