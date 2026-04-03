import Combine
import SwiftUI
import UIKit

struct LiveAppRootView: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        ZStack(alignment: .top) {
            LiveBackdrop()
                .ignoresSafeArea()

            VStack(spacing: 0) {
                noticeStack
                currentScreen
            }

            if store.isWorking {
                WorkingPill()
                    .padding(.top, 18)
                    .padding(.trailing, 20)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: store.isWorking)
        .animation(.easeInOut(duration: 0.2), value: store.route)
    }

    @ViewBuilder
    private var currentScreen: some View {
        switch store.route {
        case .login:
            LoginScreen()
        case .adminHome:
            AdminHomeScreen()
        case .courtSetup:
            CourtSetupScreen()
        case .liveStream:
            LiveStreamScreen()
        }
    }

    @ViewBuilder
    private var noticeStack: some View {
        VStack(spacing: 10) {
            if let errorMessage = store.errorMessage?.trimmedNilIfBlank {
                NoticeStrip(
                    icon: "exclamationmark.triangle.fill",
                    title: "Lỗi",
                    message: errorMessage,
                    tint: LivePalette.danger
                ) {
                    store.errorMessage = nil
                }
            }

            if let bannerMessage = store.bannerMessage?.trimmedNilIfBlank {
                NoticeStrip(
                    icon: "waveform.badge.checkmark",
                    title: "Thông báo",
                    message: bannerMessage,
                    tint: LivePalette.warning
                ) {
                    store.bannerMessage = nil
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }
}

private struct LoginScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @State private var diagnosticsTapCount = 0
    @State private var diagnosticsVisible = false

    private var targetSummary: String? {
        if let courtId = store.launchTarget.courtId?.trimmedNilIfBlank, let matchId = store.launchTarget.matchId?.trimmedNilIfBlank {
            return "Chuẩn bị mở court \(courtId) với match \(matchId)."
        }
        if let courtId = store.launchTarget.courtId?.trimmedNilIfBlank {
            return "Chuẩn bị mở live theo court \(courtId)."
        }
        if let matchId = store.launchTarget.matchId?.trimmedNilIfBlank {
            return "Chuẩn bị mở match \(matchId)."
        }
        return nil
    }

    private var buildVersionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "App build \(version) (\(build))"
    }

    private var streamURLString: String? {
        guard store.launchTarget.courtId?.trimmedNilIfBlank != nil || store.launchTarget.matchId?.trimmedNilIfBlank != nil else {
            return nil
        }

        var components = URLComponents()
        components.scheme = "pickletour-live"
        components.host = "stream"
        components.queryItems = [
            URLQueryItem(name: "courtId", value: store.launchTarget.courtId?.trimmedNilIfBlank),
            URLQueryItem(name: "matchId", value: store.launchTarget.matchId?.trimmedNilIfBlank),
            URLQueryItem(name: "pageId", value: store.launchTarget.pageId?.trimmedNilIfBlank)
        ]
        .compactMap { item in
            guard let value = item.value else { return nil }
            return URLQueryItem(name: item.name, value: value)
        }

        return components.url?.absoluteString
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 22) {
                Spacer(minLength: 24)

                VStack(spacing: 18) {
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [LivePalette.accent, LivePalette.accentSoft],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 92, height: 92)

                        Image(systemName: "dot.radiowaves.left.and.right")
                            .font(.system(size: 34, weight: .black))
                            .foregroundStyle(.white)
                    }

                    VStack(spacing: 8) {
                        Text("PickleTour Live")
                            .font(.system(size: 34, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                            .onTapGesture {
                                guard !diagnosticsVisible else { return }
                                diagnosticsTapCount += 1
                                if diagnosticsTapCount >= 7 {
                                    diagnosticsTapCount = 0
                                    diagnosticsVisible = true
                                }
                            }

                        Text("App live iOS riêng cho operator. Nhận phiên từ PickleTour hoặc đăng nhập OAuth để vào đúng luồng live theo court hoặc match.")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(LivePalette.textSecondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 540)
                    }
                }
                .padding(.top, 34)

                LiveCard {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Đăng nhập", systemImage: "person.crop.circle.badge.checkmark")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)

                        Text("Ưu tiên handoff từ app PickleTour để lấy phiên operator hiện tại. Nếu không có handoff, app sẽ fallback sang luồng web login.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(LivePalette.textSecondary)

                        if let targetSummary {
                            InlineInfoCard(
                                title: "Launch target",
                                message: targetSummary,
                                tint: LivePalette.accent
                            )
                        }

                        if let session = store.session {
                            InlineInfoCard(
                                title: "Phiên hiện tại",
                                message: "Đã có access token. Có thể tải lại quyền live app ngay mà không cần đăng nhập lại.",
                                tint: LivePalette.success
                            )

                            DetailLine(label: "User ID", value: session.userId?.trimmedNilIfBlank ?? "Chưa có")
                        }

                        VStack(spacing: 12) {
                            PrimaryActionButton(
                                title: "Nhận phiên từ PickleTour",
                                subtitle: "Mở app chính và nhận osAuthToken qua handoff",
                                tint: LivePalette.accent
                            ) {
                                store.requestPickleTourHandoff()
                            }
                            .disabled(store.isWorking)

                            PrimaryActionButton(
                                title: "Đăng nhập bằng web",
                                subtitle: "Fallback AppAuth nếu không dùng handoff",
                                tint: LivePalette.warning
                            ) {
                                Task {
                                    await store.signInWithWeb()
                                }
                            }
                            .disabled(store.isWorking)

                            if store.session != nil {
                                SecondaryActionButton(
                                    title: "Tải lại quyền truy cập",
                                    systemImage: "arrow.clockwise"
                                ) {
                                    Task {
                                        await store.refreshBootstrap()
                                    }
                                }
                                .disabled(store.isWorking)
                            }
                        }
                    }
                }

                if diagnosticsVisible {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(
                                title: "Diagnostics nội bộ",
                                subtitle: "Khối ẩn kiểu Android để test handoff, deeplink và session"
                            )

                            DetailLine(label: "Bundle ID", value: Bundle.main.bundleIdentifier ?? "Chưa có")
                            DetailLine(label: "Redirect URI", value: "pickletour-live://auth-init")
                            DetailLine(label: "Launch target", value: targetSummary ?? "Chưa có")
                            DetailLine(label: "User ID", value: store.session?.userId?.trimmedNilIfBlank ?? "Chưa có phiên")

                            if let streamURLString {
                                DetailLine(label: "Deep link", value: streamURLString)
                            }

                            HStack(spacing: 10) {
                                if let streamURLString {
                                    SecondaryActionButton(
                                        title: "Copy stream URL",
                                        systemImage: "doc.on.doc"
                                    ) {
                                        UIPasteboard.general.string = streamURLString
                                        store.bannerMessage = "Đã copy deep link stream."
                                    }
                                }

                                SecondaryActionButton(
                                    title: "Xoá notice",
                                    systemImage: "trash"
                                ) {
                                    store.bannerMessage = nil
                                    store.errorMessage = nil
                                }
                            }
                        }
                    }
                } else if diagnosticsTapCount > 0 {
                    Text("Nhấn thêm \(7 - diagnosticsTapCount) lần vào tiêu đề để mở diagnostics.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeader(
                            title: "Operator status",
                            subtitle: store.bootstrap?.roleSummary?.trimmedNilIfBlank ?? "Tài khoản đã có quyền dùng PickleTour Live"
                        )

                        WrapBadgeFlow {
                            TinyBadge(
                                title: store.networkConnected ? "Mạng online" : "Mạng offline",
                                tint: store.networkConnected ? LivePalette.success : LivePalette.danger
                            )
                            TinyBadge(
                                title: store.appIsActive ? "App foreground" : "App background",
                                tint: store.appIsActive ? LivePalette.success : LivePalette.warning
                            )
                            TinyBadge(
                                title: store.cameraPermissionGranted ? "Camera OK" : "Thiếu camera",
                                tint: store.cameraPermissionGranted ? LivePalette.success : LivePalette.danger
                            )
                            TinyBadge(
                                title: store.microphonePermissionGranted ? "Mic OK" : "Thiếu mic",
                                tint: store.microphonePermissionGranted ? LivePalette.success : LivePalette.danger
                            )
                        }

                        if let selectedCluster = store.selectedCluster {
                            DetailLine(label: "Cluster đang chọn", value: selectedCluster.displayName)
                            DetailLine(label: "Giải được gán", value: "\(selectedCluster.assignedTournamentCount ?? selectedCluster.assignedTournaments.count)")
                        }
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Điểm cần nhớ")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)

                        BulletText(text: "Deep link công khai: `pickletour-live://stream`, `pickletour-live://auth`, `pickletour-live://auth-init`.")
                        BulletText(text: "Khi nhận target chỉ có `courtId`, app vẫn vào preview, giữ presence và chờ match xuất hiện.")
                        BulletText(text: "Bản này là app riêng, bundle id live tách biệt với app PickleTour chính.")
                    }
                }

                Text(buildVersionText)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(LivePalette.textSecondary)
                    .padding(.top, 4)

                Spacer(minLength: 24)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
    }
}

private struct AdminHomeScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @State private var showSignOutDialog = false

    private let gridColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    private var occupiedCourtCount: Int {
        store.courts.filter { $0.activePresence?.occupied == true }.count
    }

    private var liveCourtCount: Int {
        store.courts.filter { court in
            let state = court.activePresence?.screenState?.trimmedNilIfBlank?.lowercased()
            return state == "live" || state == "connecting" || state == "reconnecting"
        }.count
    }

    private var idleCourtCount: Int {
        max(store.courts.count - occupiedCourtCount, 0)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HeaderBlock(
                    eyebrow: "Operator Home",
                    title: "Chọn cụm sân và vào live",
                    subtitle: store.user?.displayName ?? "PickleTour Live"
                ) {
                    HStack(spacing: 10) {
                        SecondaryIconButton(systemImage: "arrow.clockwise") {
                            Task {
                                await store.refreshBootstrap()
                            }
                        }

                        SecondaryIconButton(systemImage: "rectangle.portrait.and.arrow.right") {
                            showSignOutDialog = true
                        }
                    }
                }

                LiveCard {
                    LazyVGrid(columns: gridColumns, spacing: 12) {
                        MetricTile(
                            title: "Cụm sân",
                            value: "\(store.clusters.count)",
                            subtitle: store.bootstrap?.roleSummary?.trimmedNilIfBlank ?? "Có quyền live app"
                        )
                        MetricTile(
                            title: "Sân đang tải",
                            value: "\(store.courts.count)",
                            subtitle: store.selectedCluster?.displayName ?? "Chưa chọn cụm"
                        )
                        MetricTile(
                            title: "Socket runtime",
                            value: store.runtimeSocketConnected ? "Online" : "Offline",
                            subtitle: "Court runtime / station update",
                            accent: store.runtimeSocketConnected ? LivePalette.success : LivePalette.warning
                        )
                        MetricTile(
                            title: "Presence",
                            value: store.presenceSocketConnected ? "Online" : "Offline",
                            subtitle: "Court live occupancy",
                            accent: store.presenceSocketConnected ? LivePalette.success : LivePalette.warning
                        )
                        MetricTile(
                            title: "Sân bận",
                            value: "\(occupiedCourtCount)",
                            subtitle: "\(liveCourtCount) sân đang live / reconnect",
                            accent: occupiedCourtCount > 0 ? LivePalette.warning : LivePalette.success
                        )
                        MetricTile(
                            title: "Sân rảnh",
                            value: "\(idleCourtCount)",
                            subtitle: "Court có thể giữ preview hoặc vào setup",
                            accent: LivePalette.cardMuted
                        )
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeader(
                            title: "Cụm sân khả dụng",
                            subtitle: "Chọn cluster để tải danh sách sân theo quyền operator"
                        )

                        if store.clusters.isEmpty {
                            EmptyStateCard(
                                title: "Chưa có cụm sân",
                                message: "Bootstrap chưa trả về cluster nào. Tải lại quyền hoặc kiểm tra account được cấp quyền live app."
                            )
                        } else {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 12) {
                                    ForEach(store.clusters) { cluster in
                                        ClusterChipCard(
                                            cluster: cluster,
                                            selected: store.selectedCluster?.id == cluster.id
                                        ) {
                                            Task {
                                                await store.selectCluster(cluster)
                                            }
                                        }
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Danh sách sân")
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundStyle(.white)
                                Text(store.selectedCluster?.displayName ?? "Chọn một cụm sân để nạp court runtime")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(LivePalette.textSecondary)
                            }
                            Spacer()
                            SecondaryActionButton(
                                title: "Thiết lập thủ công",
                                systemImage: "slider.horizontal.3"
                            ) {
                                store.showManualSetup()
                            }
                        }

                        if store.courts.isEmpty {
                            EmptyStateCard(
                                title: "Chưa có sân",
                                message: "Sau khi chọn cluster, app sẽ hiện toàn bộ court mà operator được phép mở live."
                            )
                        } else {
                            VStack(spacing: 12) {
                                ForEach(store.courts) { court in
                                    CourtRowCard(
                                        court: court,
                                        selected: store.selectedCourt?.id == court.id
                                    ) {
                                        Task {
                                            await store.openCourt(court)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
        .confirmationDialog(
            "Đăng xuất khỏi PickleTour Live?",
            isPresented: $showSignOutDialog,
            titleVisibility: .visible
        ) {
            Button("Đăng xuất", role: .destructive) {
                store.signOut()
            }
            Button("Huỷ", role: .cancel) {}
        }
    }
}

private struct CourtSetupScreen: View {
    @EnvironmentObject private var store: LiveAppStore

    @State private var courtId = ""
    @State private var matchId = ""
    @State private var pageId = ""

    private var setupPreviewMatch: MatchData? {
        let targetMatchId =
            matchId.trimmedNilIfBlank
            ?? store.launchTarget.matchId?.trimmedNilIfBlank
            ?? store.courtRuntime?.currentMatchId?.trimmedNilIfBlank
            ?? store.courtRuntime?.nextMatchId?.trimmedNilIfBlank
        guard let targetMatchId, store.activeMatch?.id == targetMatchId else {
            return nil
        }
        return store.activeMatch
    }

    private var launchSummary: String {
        if matchId.trimmedNilIfBlank != nil {
            return "Ưu tiên vào theo match. App sẽ nạp runtime, overlay và socket ngay trước khi mở màn live."
        }
        if courtId.trimmedNilIfBlank != nil {
            return "Đang ở chế độ theo sân. App sẽ giữ preview, giữ lease và chờ match xuất hiện hoặc chuyển sang LIVE."
        }
        return "Nhập courtId hoặc matchId để khoá target trước khi operator vào live."
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HeaderBlock(
                    eyebrow: "Court Setup",
                    title: "Chốt target trước khi vào màn live",
                    subtitle: store.selectedCourt?.displayName ?? "Có thể dùng courtId hoặc matchId"
                ) {
                    SecondaryIconButton(systemImage: "chevron.left") {
                        store.goBackToAdminHome()
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeader(
                            title: "Target summary",
                            subtitle: launchSummary
                        )

                        WrapBadgeFlow {
                            TinyBadge(
                                title: courtId.trimmedNilIfBlank == nil ? "Chưa có courtId" : "Court đã khoá",
                                tint: courtId.trimmedNilIfBlank == nil ? LivePalette.warning : LivePalette.success
                            )
                            TinyBadge(
                                title: matchId.trimmedNilIfBlank == nil ? "Chờ theo sân" : "Có matchId",
                                tint: matchId.trimmedNilIfBlank == nil ? LivePalette.cardMuted : LivePalette.accent
                            )
                            TinyBadge(
                                title: store.networkConnected ? "Mạng online" : "Mạng offline",
                                tint: store.networkConnected ? LivePalette.success : LivePalette.danger
                            )
                        }
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        SectionHeader(
                            title: "Input target",
                            subtitle: "Để trống `matchId` nếu muốn vào theo sân và cho app tự chờ match"
                        )

                        LiveTextField(
                            title: "courtId / courtStationId",
                            placeholder: "Nhập courtId",
                            text: $courtId
                        )

                        LiveTextField(
                            title: "matchId",
                            placeholder: "Nhập matchId hoặc để trống",
                            text: $matchId
                        )

                        LiveTextField(
                            title: "pageId",
                            placeholder: "Page ID Facebook tuỳ chọn",
                            text: $pageId
                        )

                        HStack(spacing: 10) {
                            SecondaryActionButton(
                                title: "Điền sân đang chọn",
                                systemImage: "sportscourt"
                            ) {
                                courtId = store.selectedCourt?.id ?? courtId
                                pushTargetToStore()
                            }

                            SecondaryActionButton(
                                title: "Dùng match runtime",
                                systemImage: "flag.checkered.2.crossed"
                            ) {
                                matchId = store.courtRuntime?.currentMatchId?.trimmedNilIfBlank
                                    ?? store.courtRuntime?.nextMatchId?.trimmedNilIfBlank
                                    ?? matchId
                                pushTargetToStore()
                            }
                        }

                        HStack(spacing: 10) {
                            SecondaryActionButton(
                                title: "Chờ theo sân",
                                systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90"
                            ) {
                                matchId = ""
                                pushTargetToStore()
                            }

                            SecondaryActionButton(
                                title: "Tiếp tục",
                                systemImage: "play.fill"
                            ) {
                                pushTargetToStore()
                                Task {
                                    await store.continueFromSetup()
                                }
                            }
                            .disabled(!canContinue)
                            .opacity(canContinue ? 1 : 0.55)
                        }

                        SecondaryActionButton(
                            title: "Làm mới runtime",
                            systemImage: "arrow.clockwise.circle"
                        ) {
                            pushTargetToStore()
                            Task {
                                await store.refreshCurrentContext()
                            }
                        }
                    }
                }

                if let selectedCourt = store.selectedCourt {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(
                                title: "Sân đang chọn",
                                subtitle: selectedCourt.displayName
                            )

                            DetailLine(label: "Court ID", value: selectedCourt.id)
                            DetailLine(label: "Cluster", value: selectedCourt.clusterName?.trimmedNilIfBlank ?? "Chưa có")
                            DetailLine(label: "Current match", value: selectedCourt.currentMatchId?.trimmedNilIfBlank ?? "Chưa có")
                            DetailLine(label: "Queue", value: "\(selectedCourt.queueCount ?? 0)")
                            DetailLine(label: "Presence", value: presenceDescription(selectedCourt.activePresence))
                        }
                    }
                }

                if let runtime = store.courtRuntime {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(
                                title: "Court runtime",
                                subtitle: runtime.name?.trimmedNilIfBlank ?? runtime.courtId
                            )

                            DetailLine(label: "Current match", value: runtime.currentMatchId?.trimmedNilIfBlank ?? "Chưa có")
                            DetailLine(label: "Next match", value: runtime.nextMatchId?.trimmedNilIfBlank ?? "Chưa có")
                            DetailLine(label: "Assignment", value: runtime.assignmentMode?.trimmedNilIfBlank ?? "Chưa rõ")
                            DetailLine(label: "Queue count", value: "\(runtime.queueCount ?? 0)")
                            DetailLine(label: "Presence", value: presenceDescription(runtime.presence))
                        }
                    }
                }

                if let setupPreviewMatch {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(
                                title: "Match preview",
                                subtitle: setupPreviewMatch.displayCode?.trimmedNilIfBlank ?? setupPreviewMatch.id
                            )

                            HStack(spacing: 12) {
                                TeamScorePanel(
                                    teamName: setupPreviewMatch.teamADisplayName,
                                    score: setupPreviewMatch.scoreA ?? 0,
                                    accent: LivePalette.teamA
                                )
                                TeamScorePanel(
                                    teamName: setupPreviewMatch.teamBDisplayName,
                                    score: setupPreviewMatch.scoreB ?? 0,
                                    accent: LivePalette.teamB
                                )
                            }

                            DetailLine(label: "Status", value: setupPreviewMatch.status?.trimmedNilIfBlank ?? "Chưa có")
                            DetailLine(label: "Tournament", value: setupPreviewMatch.tournamentDisplayName)
                            DetailLine(label: "Court", value: setupPreviewMatch.courtDisplayName)
                        }
                    }
                }

                LiveCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Luồng vào live")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)

                        BulletText(text: "Có `matchId`: app nạp match runtime, overlay, socket và preview ngay.")
                        BulletText(text: "Chỉ có `courtId`: app giữ preview, start court presence và chờ match được gán hoặc chuyển LIVE.")
                        BulletText(text: "Sau khi vào màn live, operator có thể đổi mode, quality, orientation, camera, mic, torch và recovery trực tiếp.")
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
        .onAppear(perform: syncFromStore)
        .onChange(of: store.launchTarget.courtId ?? "") { _ in
            syncFromStore()
        }
        .onChange(of: store.launchTarget.matchId ?? "") { _ in
            syncFromStore()
        }
        .onChange(of: store.launchTarget.pageId ?? "") { _ in
            syncFromStore()
        }
    }

    private func syncFromStore() {
        courtId = store.launchTarget.courtId?.trimmedNilIfBlank ?? store.selectedCourt?.id ?? courtId
        matchId = store.launchTarget.matchId?.trimmedNilIfBlank ?? matchId
        pageId = store.launchTarget.pageId?.trimmedNilIfBlank ?? pageId
    }

    private var canContinue: Bool {
        courtId.trimmedNilIfBlank != nil || matchId.trimmedNilIfBlank != nil
    }

    private func pushTargetToStore() {
        store.updateLaunchTarget(
            courtId: courtId.trimmedNilIfBlank,
            matchId: matchId.trimmedNilIfBlank,
            pageId: pageId.trimmedNilIfBlank
        )
    }
}

private struct LiveStreamScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @Environment(\.openURL) private var openURL

    @State private var diagnosticsExpanded = false
    @State private var sessionExpanded = true
    @State private var recordingExpanded = true
    @State private var showWarningsSheet = false
    @State private var showSignalsSheet = false
    @State private var showSignOutDialog = false
    @State private var storedBrightness: CGFloat?
    @State private var brightnessReduced = false
    @State private var now = Date()

    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private let controlColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HeaderBlock(
                    eyebrow: "Live Console",
                    title: store.activeMatch?.tournamentDisplayName ?? "PickleTour Live",
                    subtitle: store.activeMatch?.courtDisplayName
                        ?? store.selectedCourt?.displayName
                        ?? store.courtRuntime?.name
                        ?? "Đang giữ preview"
                ) {
                    HStack(spacing: 10) {
                        SecondaryIconButton(systemImage: "rectangle.portrait.and.arrow.right") {
                            showSignOutDialog = true
                        }

                        SecondaryIconButton(systemImage: "chevron.left") {
                            Task {
                                await store.leaveLiveScreen()
                            }
                        }
                    }
                }

                previewSection
                operationsSection

                activationCard

                if let recovery = store.recoverySummary {
                    RecoveryCard(summary: recovery) {
                        store.retryPreviewPipeline()
                    } onRetrySession: {
                        store.retryActiveSession()
                    }
                }

                if store.waitingForNextMatch {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Đang chờ trận kế tiếp", systemImage: "hourglass")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(.white)

                            Text("App đã dọn session cũ và giữ pipeline chờ match mới trên cùng court. Khi runtime đổi sang trận mới, overlay và socket sẽ tự nối lại.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(LivePalette.textSecondary)
                        }
                    }
                }

                if let pendingNextMatchId = store.pendingNextMatchId {
                    LiveCard {
                        InlineInfoCard(
                            title: "Match kế tiếp đã được queue",
                            message: "Runtime sân đang trỏ sang match \(pendingNextMatchId). App sẽ nạp context mới sau khi phiên hiện tại dừng xong.",
                            tint: LivePalette.warning
                        )
                    }
                }

                streamModeSection
                liveControlsSection
                matchInfoSection
                brandingSection
                healthSection
                recordingSection
                sessionSection
                diagnosticsSection
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
        .sheet(
            isPresented: Binding(
                get: { !store.preflightIssues.isEmpty },
                set: { isPresented in
                    if !isPresented {
                        store.dismissPreflight()
                    }
                }
            )
        ) {
            PreflightSheet(
                issues: store.preflightIssues,
                onDismiss: {
                    store.dismissPreflight()
                },
                onProceed: {
                    store.proceedPreflight()
                }
            )
        }
        .sheet(isPresented: $showWarningsSheet) {
            warningCenterSheet
        }
        .sheet(isPresented: $showSignalsSheet) {
            signalCenterSheet
        }
        .confirmationDialog(
            "Đăng xuất khỏi PickleTour Live?",
            isPresented: $showSignOutDialog,
            titleVisibility: .visible
        ) {
            Button("Đăng xuất", role: .destructive) {
                store.signOut()
            }
            Button("Huỷ", role: .cancel) {}
        }
        .onAppear {
            captureBrightnessIfNeeded()
            updateBrightnessIfNeeded()
        }
        .onChange(of: store.batterySaverEnabled) { _ in
            updateBrightnessIfNeeded()
        }
        .onDisappear {
            restoreBrightnessIfNeeded()
        }
        .onReceive(ticker) { date in
            now = date
        }
    }

    private var previewSection: some View {
        LiveCard(padding: 12) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(
                    title: "Preview + overlay",
                    subtitle: "RTMP preview, trạng thái session và burn-in scoreboard"
                )

                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color.black)
                        .overlay(
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .stroke(LivePalette.cardStroke, lineWidth: 1)
                        )

                    LivePreviewSurface(service: store.streamingService)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

                    LinearGradient(
                        colors: [Color.black.opacity(0.64), Color.clear, Color.black.opacity(0.54)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

                    if store.batterySaverEnabled {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color.black.opacity(0.18))
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 8) {
                                StatusCapsule(
                                    title: previewPrimaryStatus.title,
                                    systemImage: previewPrimaryStatus.icon,
                                    tint: previewPrimaryStatus.tint
                                )

                                HStack(spacing: 8) {
                                    StatusCapsule(
                                        title: store.liveMode.title,
                                        systemImage: "dial.high.fill",
                                        tint: LivePalette.cardMuted
                                    )

                                    StatusCapsule(
                                        title: store.selectedQuality.title,
                                        systemImage: "slider.horizontal.3",
                                        tint: LivePalette.cardMuted
                                    )

                                    if store.liveMode.includesRecording || store.recordingSnapshot != nil {
                                        StatusCapsule(
                                            title: store.recordingStateText,
                                            systemImage: "record.circle",
                                            tint: recordingTint
                                        )
                                    }
                                }
                            }

                            Spacer()

                            VStack(alignment: .trailing, spacing: 8) {
                                if let liveStartedAt = store.liveStartedAt {
                                    TimerStatusCapsule(startedAt: liveStartedAt)
                                }

                                if let waitingLabel = waitingStateLabel {
                                    StatusCapsule(
                                        title: waitingLabel,
                                        systemImage: "hourglass.bottomhalf.filled",
                                        tint: LivePalette.warning
                                    )
                                }
                            }
                        }

                        Spacer(minLength: 0)

                        if let snapshot = store.overlaySnapshot {
                            OverlayScoreCard(snapshot: snapshot)
                        } else {
                            InlineInfoCard(
                                title: "Overlay chưa sẵn sàng",
                                message: "App vẫn có thể giữ preview hoặc bắt đầu phiên, nhưng burn-in scoreboard chưa có dữ liệu mới nhất.",
                                tint: LivePalette.warning
                            )
                        }
                    }
                    .padding(14)

                    if let seconds = store.goLiveCountdownSeconds {
                        CountdownOverlay(
                            title: store.liveMode == .recordOnly ? "Chuẩn bị ghi hình" : "Chuẩn bị vào live",
                            subtitle: "Huỷ nếu chưa khóa xong camera hoặc target",
                            value: seconds,
                            tint: LivePalette.accent
                        )
                    }

                    if let seconds = store.stopLiveCountdownSeconds {
                        CountdownOverlay(
                            title: "Đang đếm ngược dừng phiên",
                            subtitle: "App sẽ stop live hoặc recording sau khi hết đếm",
                            value: seconds,
                            tint: LivePalette.danger
                        )
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
            }
        }
    }

    private var streamModeSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Mode và quality",
                    subtitle: "Chọn cách app xử lý RTMP và recording trong phiên hiện tại"
                )

                VStack(spacing: 12) {
                    ForEach(LiveStreamMode.allCases) { mode in
                        SelectableModeCard(
                            title: mode.title,
                            summary: mode.summary,
                            selected: store.liveMode == mode,
                            disabled: store.hasPrimarySessionIntent
                        ) {
                            guard !store.hasPrimarySessionIntent else { return }
                            store.liveMode = mode
                        }
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(LiveQualityPreset.allCases) { quality in
                            QualityChip(
                                title: quality.title,
                                detail: qualityDetail(quality),
                                selected: store.selectedQuality == quality
                            ) {
                                store.applyQuality(quality)
                            }
                        }
                    }
                }

                VStack(spacing: 10) {
                    if let primaryStartAction {
                        PrimaryActionButton(
                            title: primaryStartAction.title,
                            subtitle: primaryStartAction.subtitle,
                            tint: primaryStartAction.tint
                        ) {
                            primaryStartAction.action()
                        }
                        .disabled(store.isWorking)
                    }

                    if let stopAction {
                        SecondaryActionButton(
                            title: stopAction.title,
                            systemImage: stopAction.icon
                        ) {
                            stopAction.action()
                        }
                        .disabled(store.isWorking)
                    }

                    HStack(spacing: 10) {
                        SecondaryActionButton(
                            title: "Gia hạn preview",
                            systemImage: "clock.badge.checkmark"
                        ) {
                            Task {
                                await store.extendPreviewLease()
                            }
                        }

                        SecondaryActionButton(
                            title: "Refresh overlay",
                            systemImage: "rectangle.3.group.bubble.left"
                        ) {
                            Task {
                                await store.refreshOverlay()
                            }
                        }
                    }
                }

                HStack(spacing: 10) {
                    SecondaryActionButton(
                        title: "Warning center",
                        systemImage: "exclamationmark.bubble"
                    ) {
                        showWarningsSheet = true
                    }

                    SecondaryActionButton(
                        title: "Signal center",
                        systemImage: "antenna.radiowaves.left.and.right"
                    ) {
                        showSignalsSheet = true
                    }
                }
            }
        }
    }

    private var operationsSection: some View {
        let _ = now

        return LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Operator status",
                    subtitle: "Tín hiệu nhanh cho mạng, quyền thiết bị, payload socket và lease preview"
                )

                if warningItems.isEmpty {
                    InlineInfoCard(
                        title: "Ổn định",
                        message: "Không có cảnh báo vận hành nào nổi bật ở thời điểm hiện tại.",
                        tint: LivePalette.success
                    )
                } else {
                    InlineInfoCard(
                        title: "Có \(warningItems.count) cảnh báo",
                        message: warningItems.joined(separator: " | "),
                        tint: warningTint
                    )
                }

                WrapBadgeFlow {
                    TinyBadge(
                        title: store.networkConnected
                            ? (store.networkIsWiFi ? "Mạng: Wi-Fi" : "Mạng: 4G/5G")
                            : "Mạng: OFFLINE",
                        tint: store.networkConnected ? LivePalette.success : LivePalette.danger
                    )
                    TinyBadge(
                        title: store.appIsActive ? "App: foreground" : "App: background",
                        tint: store.appIsActive ? LivePalette.success : LivePalette.warning
                    )
                    TinyBadge(
                        title: store.cameraPermissionGranted ? "Camera OK" : "Thiếu camera",
                        tint: store.cameraPermissionGranted ? LivePalette.success : LivePalette.danger
                    )
                    TinyBadge(
                        title: store.microphonePermissionGranted ? "Mic OK" : "Thiếu mic",
                        tint: store.microphonePermissionGranted ? LivePalette.success : LivePalette.danger
                    )
                    if let leaseText = previewLeaseText {
                        TinyBadge(
                            title: leaseText,
                            tint: store.previewLeaseWarning ? LivePalette.warning : LivePalette.cardMuted
                        )
                    }
                    if store.socketConnected {
                        TinyBadge(
                            title: store.socketPayloadStale
                                ? "Payload stale \(store.socketPayloadAgeSeconds ?? 0)s"
                                : "Payload mới \(store.socketPayloadAgeSeconds ?? 0)s",
                            tint: store.socketPayloadStale ? LivePalette.warning : LivePalette.success
                        )
                    }
                }
            }
        }
    }

    private var liveControlsSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Thiết bị và recovery",
                    subtitle: "Các điều khiển nhanh cho camera, audio, orientation và preview pipeline"
                )

                LazyVGrid(columns: controlColumns, spacing: 12) {
                    ControlTile(
                        title: "Camera",
                        subtitle: "Đảo trước hoặc sau",
                        systemImage: "camera.rotate"
                    ) {
                        Task {
                            await store.toggleCamera()
                        }
                    }

                    ControlTile(
                        title: "Torch",
                        subtitle: store.streamingService.stats.torchEnabled ? "Đang bật" : "Đang tắt",
                        systemImage: store.streamingService.stats.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill",
                        accent: store.streamingService.stats.torchEnabled ? LivePalette.warning : LivePalette.cardMuted
                    ) {
                        store.toggleTorch()
                    }

                    ControlTile(
                        title: "Micro",
                        subtitle: store.streamingService.stats.micEnabled ? "Đang bật" : "Đang tắt",
                        systemImage: store.streamingService.stats.micEnabled ? "mic.fill" : "mic.slash.fill",
                        accent: store.streamingService.stats.micEnabled ? LivePalette.success : LivePalette.cardMuted
                    ) {
                        store.toggleMicrophone()
                    }

                    ControlTile(
                        title: "Orientation",
                        subtitle: store.orientationMode.title,
                        systemImage: store.orientationMode.systemImage
                    ) {
                        store.cycleOrientationMode()
                    }

                    ControlTile(
                        title: "Battery saver",
                        subtitle: store.batterySaverEnabled ? "Giảm sáng" : "Tắt",
                        systemImage: store.batterySaverEnabled ? "battery.25" : "battery.100",
                        accent: store.batterySaverEnabled ? LivePalette.warning : LivePalette.cardMuted
                    ) {
                        store.toggleBatterySaver()
                    }

                    ControlTile(
                        title: "Dựng lại preview",
                        subtitle: "Reset camera hoặc pipeline",
                        systemImage: "arrow.triangle.2.circlepath.camera"
                    ) {
                        store.retryPreviewPipeline()
                    }

                    ControlTile(
                        title: "Phục hồi phiên",
                        subtitle: "Stop, rebuild và auto start",
                        systemImage: "bolt.horizontal.circle"
                    ) {
                        store.retryActiveSession()
                    }

                    ControlTile(
                        title: "Refresh bootstrap",
                        subtitle: "Tải lại quyền và cluster",
                        systemImage: "arrow.clockwise.circle"
                    ) {
                        Task {
                            await store.refreshBootstrap()
                        }
                    }

                    ControlTile(
                        title: "Leave live",
                        subtitle: "Thoát màn live",
                        systemImage: "rectangle.portrait.and.arrow.right"
                    ) {
                        Task {
                            await store.leaveLiveScreen()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Zoom")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                        Spacer()
                        Text(String(format: "%.1fx", Double(store.streamingService.stats.zoomFactor)))
                            .font(.system(size: 14, weight: .semibold, design: .monospaced))
                            .foregroundStyle(LivePalette.textSecondary)
                    }

                    Slider(
                        value: Binding(
                            get: { Double(store.streamingService.stats.zoomFactor) },
                            set: { store.setZoom(CGFloat($0)) }
                        ),
                        in: 1 ... 6
                    )
                    .tint(LivePalette.accent)
                }
            }
        }
    }

    private var matchInfoSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Match info",
                    subtitle: store.activeMatch?.id ?? store.launchTarget.matchId ?? "Chưa có match hiện tại"
                )

                if let snapshot = store.overlaySnapshot {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .center, spacing: 12) {
                            TournamentLogoView(urlString: snapshot.tournamentLogoURL)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(snapshot.tournamentName?.trimmedNilIfBlank ?? "PickleTour")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundStyle(.white)
                                Text(snapshot.courtName?.trimmedNilIfBlank ?? store.activeMatch?.courtDisplayName ?? "Court")
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(LivePalette.textSecondary)
                            }
                            Spacer()
                            if let status = store.activeMatch?.status?.trimmedNilIfBlank {
                                TinyBadge(title: status.uppercased(), tint: LivePalette.accentSoft)
                            }
                        }

                        HStack(spacing: 12) {
                            TeamScorePanel(
                                teamName: snapshot.teamAName?.trimmedNilIfBlank ?? "Đội A",
                                score: snapshot.scoreA ?? 0,
                                accent: LivePalette.teamA
                            )
                            TeamScorePanel(
                                teamName: snapshot.teamBName?.trimmedNilIfBlank ?? "Đội B",
                                score: snapshot.scoreB ?? 0,
                                accent: LivePalette.teamB
                            )
                        }

                        WrapBadgeFlow {
                            if let stage = snapshot.stageName?.trimmedNilIfBlank {
                                TinyBadge(title: stage, tint: LivePalette.cardMuted)
                            }
                            if let phase = snapshot.phaseText?.trimmedNilIfBlank {
                                TinyBadge(title: phase, tint: LivePalette.cardMuted)
                            }
                            if let round = snapshot.roundLabel?.trimmedNilIfBlank {
                                TinyBadge(title: round, tint: LivePalette.cardMuted)
                            }
                            if let serve = snapshot.serveSide?.trimmedNilIfBlank {
                                TinyBadge(title: "Giao bóng: \(serve)", tint: LivePalette.warning)
                            }
                        }

                        if let breakNote = snapshot.breakNote?.trimmedNilIfBlank {
                            InlineInfoCard(
                                title: "Break note",
                                message: breakNote,
                                tint: LivePalette.warning
                            )
                        }
                    }
                } else {
                    EmptyStateCard(
                        title: "Chưa có overlay snapshot",
                        message: "Nếu app đang vào theo court và chưa có match, đây là trạng thái bình thường. Khi match xuất hiện, scoreboard và socket sẽ tự nạp lại."
                    )
                }
            }
        }
    }

    private var healthSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Health và presence",
                    subtitle: "Theo dõi socket, RTMP, bitrate, lease và trạng thái phòng match"
                )

                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    MetricTile(
                        title: "Stream state",
                        value: humanReadableState(store.streamState),
                        subtitle: "Bitrate \(formattedBitrate(store.streamingService.stats.currentBitrate))",
                        accent: previewPrimaryStatus.tint
                    )
                    MetricTile(
                        title: "Overlay socket",
                        value: store.socketConnected ? "Online" : "Offline",
                        subtitle: store.activeSocketMatchId?.trimmedNilIfBlank ?? "Chưa join room",
                        accent: store.socketConnected ? LivePalette.success : LivePalette.warning
                    )
                    MetricTile(
                        title: "Runtime socket",
                        value: store.runtimeSocketConnected ? "Online" : "Offline",
                        subtitle: store.selectedCourt?.displayName ?? "Chưa watch court",
                        accent: store.runtimeSocketConnected ? LivePalette.success : LivePalette.warning
                    )
                    MetricTile(
                        title: "Presence socket",
                        value: store.presenceSocketConnected ? "Online" : "Offline",
                        subtitle: store.courtPresence?.screenState?.trimmedNilIfBlank ?? "Chưa có lease",
                        accent: store.presenceSocketConnected ? LivePalette.success : LivePalette.warning
                    )
                    MetricTile(
                        title: "Mạng",
                        value: store.networkConnected ? (store.networkIsWiFi ? "Wi-Fi" : "4G/5G") : "Offline",
                        subtitle: store.appIsActive ? "App đang foreground" : "App đang background",
                        accent: store.networkConnected ? LivePalette.success : LivePalette.danger
                    )
                }

                VStack(alignment: .leading, spacing: 10) {
                    DetailLine(label: "Presence screen state", value: store.courtPresence?.screenState?.trimmedNilIfBlank ?? "Chưa có")
                    DetailLine(label: "Occupied", value: booleanText(store.courtPresence?.occupied))
                    DetailLine(label: "Match đang giữ", value: store.courtPresence?.matchId?.trimmedNilIfBlank ?? store.activeMatch?.id ?? "Chưa có")
                    DetailLine(label: "Hết lease preview", value: formattedTimestamp(store.courtPresence?.previewReleaseAt) ?? "Không có")
                    DetailLine(label: "Hết lease tổng", value: formattedTimestamp(store.courtPresence?.expiresAt) ?? "Không có")
                    DetailLine(label: "Payload socket gần nhất", value: relativeTimestamp(store.lastSocketPayloadAt))
                    DetailLine(label: "Payload stale", value: store.socketPayloadStale ? "Có" : "Không")
                    DetailLine(label: "Preview ready", value: store.previewReady ? "Sẵn sàng" : "Chưa sẵn sàng")
                    DetailLine(label: "Camera / mic", value: "\(store.cameraPermissionGranted ? "OK" : "Thiếu") / \(store.microphonePermissionGranted ? "OK" : "Thiếu")")
                    DetailLine(label: "Overlay / branding", value: "\(store.overlayDataReady ? "OK" : "Thiếu") / \(store.brandingReady ? "OK" : "Thiếu")")
                }
            }
        }
    }

    private var brandingSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Branding và overlay assets",
                    subtitle: "Theo dõi sponsor, logo giải và web logo đang gắn cho overlay"
                )

                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    MetricTile(
                        title: "Sponsors",
                        value: "\(store.overlayConfig?.sponsors.count ?? 0)",
                        subtitle: "Số sponsor app đã nạp từ overlay config",
                        accent: (store.overlayConfig?.sponsors.isEmpty == false) ? LivePalette.success : LivePalette.warning
                    )
                    MetricTile(
                        title: "Tournament logo",
                        value: store.overlaySnapshot?.tournamentLogoURL?.trimmedNilIfBlank == nil ? "Thiếu" : "Có",
                        subtitle: store.overlaySnapshot?.tournamentLogoURL?.trimmedNilIfBlank ?? "Snapshot chưa có tournamentLogoUrl",
                        accent: store.overlaySnapshot?.tournamentLogoURL?.trimmedNilIfBlank == nil ? LivePalette.warning : LivePalette.success
                    )
                    MetricTile(
                        title: "Tournament image",
                        value: store.overlayConfig?.tournamentImageURL?.trimmedNilIfBlank == nil ? "Thiếu" : "Có",
                        subtitle: store.overlayConfig?.tournamentImageURL?.trimmedNilIfBlank ?? "Overlay config chưa có tournamentImageUrl",
                        accent: store.overlayConfig?.tournamentImageURL?.trimmedNilIfBlank == nil ? LivePalette.warning : LivePalette.success
                    )
                    MetricTile(
                        title: "Web logo",
                        value: store.overlayConfig?.webLogoURL?.trimmedNilIfBlank == nil ? "Thiếu" : "Có",
                        subtitle: store.overlayConfig?.webLogoURL?.trimmedNilIfBlank ?? "Overlay config chưa có webLogoUrl",
                        accent: store.overlayConfig?.webLogoURL?.trimmedNilIfBlank == nil ? LivePalette.warning : LivePalette.success
                    )
                }

                if let sponsors = store.overlayConfig?.sponsors, !sponsors.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Array(sponsors.prefix(10)), id: \.id) { sponsor in
                                SponsorChip(sponsor: sponsor)
                            }
                        }
                    }
                } else {
                    EmptyStateCard(
                        title: "Chưa có sponsor",
                        message: "Overlay config hiện chưa trả sponsor nào. App vẫn live được, nhưng branding sẽ mỏng hơn so với cấu hình chuẩn."
                    )
                }

                HStack(spacing: 10) {
                    if let tournamentImageURL = store.overlayConfig?.tournamentImageURL?.trimmedNilIfBlank, let url = URL(string: tournamentImageURL) {
                        SecondaryActionButton(
                            title: "Mở tournament image",
                            systemImage: "photo"
                        ) {
                            openURL(url)
                        }
                    }

                    if let webLogoURL = store.overlayConfig?.webLogoURL?.trimmedNilIfBlank, let url = URL(string: webLogoURL) {
                        SecondaryActionButton(
                            title: "Mở web logo",
                            systemImage: "globe"
                        ) {
                            openURL(url)
                        }
                    }
                }
            }
        }
    }

    private var recordingSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Recording",
                    subtitle: store.recordingStateText
                )

                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    MetricTile(
                        title: "Mode",
                        value: store.liveMode.title,
                        subtitle: store.liveMode.summary,
                        accent: LivePalette.cardMuted
                    )
                    MetricTile(
                        title: "Pending uploads",
                        value: "\(store.recordingPendingUploads)",
                        subtitle: "Segment đang đẩy nền",
                        accent: store.recordingPendingUploads > 0 ? LivePalette.warning : LivePalette.success
                    )
                    MetricTile(
                        title: "Segments",
                        value: "\(store.recordingSegmentCount)",
                        subtitle: store.recordingSnapshot?.status?.trimmedNilIfBlank ?? "Chưa mở phiên",
                        accent: recordingTint
                    )
                    MetricTile(
                        title: "Playback",
                        value: store.recordingPlaybackURLString?.trimmedNilIfBlank == nil ? "Chưa có" : "Sẵn sàng",
                        subtitle: store.recordingPlaybackURLString?.trimmedNilIfBlank ?? "Finalize xong sẽ có playback URL",
                        accent: store.recordingPlaybackURLString?.trimmedNilIfBlank == nil ? LivePalette.cardMuted : LivePalette.success
                    )
                    MetricTile(
                        title: "Storage trống",
                        value: formatStorageBytes(store.availableStorageBytes),
                        subtitle: "Ngưỡng tối thiểu \(formatStorageBytes(store.minimumRecordingStorageBytes))",
                        accent: store.recordingStorageHardBlock ? LivePalette.danger : (store.recordingStorageWarning ? LivePalette.warning : LivePalette.success)
                    )
                }

                if store.recordingStorageHardBlock || store.recordingStorageWarning {
                    InlineInfoCard(
                        title: store.recordingStorageHardBlock ? "Bộ nhớ đang chặn recording" : "Bộ nhớ đang thấp cho recording",
                        message: store.recordingStorageHardBlock
                            ? "Nên giải phóng thêm dung lượng trước khi vào mode có recording."
                            : "App vẫn có thể ghi, nhưng nên dọn bớt máy để tránh lỗi ở phiên dài.",
                        tint: store.recordingStorageHardBlock ? LivePalette.danger : LivePalette.warning
                    )
                }

                DisclosureGroup(isExpanded: $recordingExpanded) {
                    VStack(alignment: .leading, spacing: 10) {
                        DetailLine(label: "Recording ID", value: store.recordingSnapshot?.id?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "Upload mode", value: store.recordingSnapshot?.uploadMode?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "Status", value: store.recordingSnapshot?.status?.trimmedNilIfBlank ?? store.recordingStateText)
                        DetailLine(label: "Match ID", value: store.recordingSnapshot?.matchId?.trimmedNilIfBlank ?? store.activeMatch?.id ?? "Chưa có")
                        DetailLine(label: "Storage total", value: formatStorageBytes(store.totalStorageBytes))
                        DetailLine(label: "Storage free", value: formatStorageBytes(store.availableStorageBytes))
                        DetailLine(label: "Min / rec", value: "\(formatStorageBytes(store.minimumRecordingStorageBytes)) / \(formatStorageBytes(store.recommendedRecordingStorageBytes))")

                        if let playback = store.recordingPlaybackURLString?.trimmedNilIfBlank {
                            HStack(spacing: 10) {
                                SecondaryActionButton(
                                    title: "Mở playback",
                                    systemImage: "play.circle"
                                ) {
                                    if let url = URL(string: playback) {
                                        openURL(url)
                                    }
                                }

                                SecondaryActionButton(
                                    title: "Copy URL",
                                    systemImage: "doc.on.doc"
                                ) {
                                    UIPasteboard.general.string = playback
                                    store.bannerMessage = "Đã copy playback URL."
                                }
                            }
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    Text("Chi tiết recording")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
    }

    private var sessionSection: some View {
        let facebook = store.liveSession?.facebook

        return LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Live session / RTMP",
                    subtitle: facebook?.pageName?.trimmedNilIfBlank
                        ?? facebook?.pageId?.trimmedNilIfBlank
                        ?? store.launchTarget.pageId?.trimmedNilIfBlank
                        ?? "Chưa tạo live session"
                )

                DisclosureGroup(isExpanded: $sessionExpanded) {
                    VStack(alignment: .leading, spacing: 10) {
                        DetailLine(label: "Page ID", value: facebook?.pageId?.trimmedNilIfBlank ?? store.launchTarget.pageId?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "Page name", value: facebook?.pageName?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "Watch URL", value: facebook?.watchURL?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "Permalink", value: facebook?.permalinkURL?.trimmedNilIfBlank ?? "Chưa có")
                        DetailLine(label: "RTMP URL", value: facebook?.resolvedRTMPURL?.trimmedNilIfBlank ?? "Chưa tạo")

                        HStack(spacing: 10) {
                            if let watchURL = facebook?.watchURL?.trimmedNilIfBlank, let url = URL(string: watchURL) {
                                SecondaryActionButton(
                                    title: "Mở live URL",
                                    systemImage: "link"
                                ) {
                                    openURL(url)
                                }
                            }

                            if let resolvedRTMPURL = facebook?.resolvedRTMPURL?.trimmedNilIfBlank {
                                SecondaryActionButton(
                                    title: "Copy RTMP URL",
                                    systemImage: "doc.on.doc"
                                ) {
                                    UIPasteboard.general.string = resolvedRTMPURL
                                    store.bannerMessage = "Đã copy RTMP URL."
                                }
                            }
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    Text("Thông tin session")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
    }

    private var diagnosticsSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Diagnostics",
                    subtitle: "Log gần nhất từ streaming service để soi reconnect, preview và recorder"
                )

                HStack(spacing: 10) {
                    SecondaryActionButton(
                        title: "Refresh context",
                        systemImage: "arrow.clockwise.circle"
                    ) {
                        Task {
                            await store.refreshCurrentContext()
                        }
                    }

                    SecondaryActionButton(
                        title: "Clear diagnostics",
                        systemImage: "trash"
                    ) {
                        store.clearDiagnostics()
                    }
                }

                DisclosureGroup(isExpanded: $diagnosticsExpanded) {
                    VStack(alignment: .leading, spacing: 8) {
                        if store.streamingService.diagnostics.isEmpty {
                            EmptyStateCard(
                                title: "Chưa có diagnostics",
                                message: "Sau khi preview hoặc live chạy, app sẽ append log nội bộ tại đây."
                            )
                        } else {
                            ForEach(store.streamingService.diagnostics.prefix(20), id: \.self) { line in
                                Text(line)
                                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                                    .foregroundStyle(LivePalette.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .fill(LivePalette.cardMuted.opacity(0.55))
                                    )
                            }
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    Text("Mở diagnostics")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
    }

    @ViewBuilder
    private var activationCard: some View {
        if let waitingLabel = waitingStateLabel {
            LiveCard {
                VStack(alignment: .leading, spacing: 14) {
                    InlineInfoCard(
                        title: waitingLabel,
                        message: waitingStateMessage,
                        tint: LivePalette.warning
                    )

                    HStack(spacing: 10) {
                        SecondaryActionButton(
                            title: "Làm mới runtime",
                            systemImage: "arrow.clockwise.circle"
                        ) {
                            Task {
                                await store.refreshCurrentContext()
                            }
                        }

                        if store.previewLeaseWarning {
                            SecondaryActionButton(
                                title: "Giữ sân thêm",
                                systemImage: "clock.badge.checkmark"
                            ) {
                                Task {
                                    await store.extendPreviewLease()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var previewPrimaryStatus: (title: String, icon: String, tint: Color) {
        if store.waitingForNextMatch {
            return ("Chờ trận tiếp", "hourglass", LivePalette.warning)
        }
        if store.waitingForCourt {
            return ("Giữ preview", "camera.viewfinder", LivePalette.warning)
        }
        if store.waitingForMatchLive {
            return ("Chờ trận LIVE", "dot.radiowaves.left.and.right", LivePalette.warning)
        }

        switch store.streamState {
        case .live:
            return ("LIVE", "dot.radiowaves.left.and.right", LivePalette.danger)
        case .connecting:
            return ("Connecting", "bolt.horizontal.circle.fill", LivePalette.warning)
        case .reconnecting:
            return ("Phục hồi", "arrow.triangle.2.circlepath.circle.fill", LivePalette.warning)
        case .previewReady:
            if store.recordOnlyArmed {
                return ("REC AUTO", "record.circle.fill", LivePalette.danger)
            }
            if store.goLiveArmed {
                return ("LIVE AUTO", "play.circle.fill", LivePalette.accent)
            }
            return ("Preview", "camera", LivePalette.cardMuted)
        case .preparingPreview:
            return ("Chuẩn bị preview", "camera.aperture", LivePalette.warning)
        case .failed:
            return ("Lỗi pipeline", "exclamationmark.triangle.fill", LivePalette.danger)
        case .idle, .stopped:
            if store.recordOnlyArmed {
                return ("REC AUTO", "record.circle.fill", LivePalette.danger)
            }
            if store.goLiveArmed {
                return ("LIVE AUTO", "play.circle.fill", LivePalette.accent)
            }
            return ("Idle", "pause.circle", LivePalette.cardMuted)
        }
    }

    private var waitingStateLabel: String? {
        if store.waitingForCourt {
            return "Đang chờ match xuất hiện trên sân"
        }
        if store.waitingForMatchLive {
            return store.liveMode == .recordOnly ? "Sẽ tự ghi khi match chuyển LIVE" : "Sẽ tự vào live khi match chuyển LIVE"
        }
        if store.waitingForNextMatch {
            return "Đang chờ match kế tiếp"
        }
        return nil
    }

    private var waitingStateMessage: String {
        if store.waitingForCourt {
            return "Court presence vẫn đang được giữ. App chưa tạo RTMP live session và đang chờ runtime sân đẩy match mới."
        }
        if store.waitingForMatchLive {
            return "App đã armed phiên theo mode hiện tại. Khi status match chuyển sang LIVE, app sẽ tự tạo session, RTMP và recording."
        }
        if store.waitingForNextMatch {
            return "Phiên trước đã dọn xong. App đang chờ runtime sân chỉ ra match kế tiếp để tự nạp overlay và socket."
        }
        return "App đang ở trạng thái chờ."
    }

    private var recordingTint: Color {
        if store.recordingPendingUploads > 0 {
            return LivePalette.warning
        }
        if store.streamingService.isRecordingLocally {
            return LivePalette.danger
        }
        return LivePalette.cardMuted
    }

    private var primaryStartAction: (title: String, subtitle: String, tint: Color, action: () -> Void)? {
        if store.goLiveCountdownSeconds != nil {
            return (
                title: "Huỷ đếm bắt đầu",
                subtitle: "Dừng countdown 3 giây trước khi app vào phiên",
                tint: LivePalette.warning,
                action: {
                    store.cancelGoLiveCountdown()
                }
            )
        }

        if store.hasPrimarySessionIntent || store.stopLiveCountdownSeconds != nil {
            return nil
        }

        let title: String
        let subtitle: String

        switch store.liveMode {
        case .streamOnly:
            title = "Bắt đầu livestream"
            subtitle = "Tạo live session, lấy RTMP URL và phát ngay nếu target đã sẵn"
        case .streamAndRecord:
            title = "Bắt đầu live + recording"
            subtitle = "Mở recording cục bộ rồi phát RTMP"
        case .recordOnly:
            title = "Bắt đầu recording"
            subtitle = "Giữ preview và ghi segment mà không phát RTMP"
        }

        return (
            title: title,
            subtitle: subtitle,
            tint: LivePalette.accent,
            action: {
                store.handlePrimaryAction()
            }
        )
    }

    private var stopAction: (title: String, icon: String, action: () -> Void)? {
        if store.stopLiveCountdownSeconds != nil {
            return (
                title: "Huỷ đếm dừng",
                icon: "xmark.circle",
                action: {
                    store.cancelStopLiveCountdown()
                }
            )
        }

        if store.hasPrimarySessionIntent {
            return (
                title: store.liveMode == .recordOnly ? "Dừng phiên ghi hình" : "Dừng phiên hiện tại",
                icon: "stop.circle",
                action: {
                    store.requestStopPrimarySession()
                }
            )
        }

        return nil
    }

    private var previewLeaseText: String? {
        let _ = now
        guard let remaining = store.previewLeaseRemainingSeconds else { return nil }
        let minutes = remaining / 60
        let seconds = remaining % 60
        return String(format: "Preview lease %02d:%02d", minutes, seconds)
    }

    private var warningItems: [String] {
        let _ = now
        var items: [String] = []
        if !store.networkConnected {
            items.append("Thiết bị đang offline")
        }
        if !store.appIsActive {
            items.append("App đang background")
        }
        if !store.cameraPermissionGranted || !store.microphonePermissionGranted {
            items.append("Thiếu quyền camera hoặc micro")
        }
        if store.socketPayloadStale {
            items.append("Payload overlay đang stale")
        }
        if store.previewLeaseWarning, let leaseText = previewLeaseText {
            items.append("\(leaseText) sắp hết")
        }
        if store.recordingStorageHardBlock {
            items.append("Bộ nhớ quá thấp cho recording")
        } else if store.recordingStorageWarning {
            items.append("Bộ nhớ còn thấp cho recording")
        }
        if !store.overlayDataReady && store.activeMatch != nil {
            items.append("Overlay chưa có snapshot mới")
        }
        if !store.brandingReady && store.activeMatch != nil {
            items.append("Branding chưa đầy đủ")
        }
        return items
    }

    private var warningTint: Color {
        if warningItems.contains(where: { $0.contains("offline") || $0.contains("Thiếu quyền") || $0.contains("quá thấp") }) {
            return LivePalette.danger
        }
        return LivePalette.warning
    }

    private var signalIssueCount: Int {
        var issues = 0
        if !store.networkConnected { issues += 1 }
        if !store.socketConnected || store.socketPayloadStale { issues += 1 }
        if !store.overlayDataReady && store.activeMatch != nil { issues += 1 }
        if !store.brandingReady && store.activeMatch != nil { issues += 1 }
        if !store.previewReady { issues += 1 }
        return issues
    }

    private var overlaySignalStatusLabel: String {
        if store.waitingForCourt || store.waitingForMatchLive || store.waitingForNextMatch {
            return "Đang chờ"
        }
        if !store.overlayDataReady {
            return "Chưa đủ dữ liệu"
        }
        if !store.socketConnected || store.socketPayloadStale {
            return "Đang dự phòng"
        }
        if !store.brandingReady {
            return "Thiếu branding"
        }
        return "Ổn định"
    }

    private var overlaySignalTint: Color {
        if !store.networkConnected {
            return LivePalette.danger
        }
        if !store.socketConnected || store.socketPayloadStale || !store.overlayDataReady {
            return LivePalette.warning
        }
        return LivePalette.success
    }

    private var overlaySignalSummary: String {
        if store.waitingForCourt {
            return "App đang giữ preview theo sân và chờ runtime đẩy match mới trước khi nạp overlay."
        }
        if store.waitingForMatchLive {
            return "Overlay đã có thể seed từ match hiện tại, nhưng app vẫn chờ status chuyển LIVE để tự khởi động phiên."
        }
        if store.waitingForNextMatch {
            return "Overlay cũ đã được dọn. App đang chờ match kế tiếp trên cùng sân để nối lại room socket."
        }
        if !store.overlayDataReady {
            return "Scoreboard chưa có snapshot mới. App vẫn giữ preview và sẽ tiếp tục poll hoặc watch socket."
        }
        if !store.socketConnected {
            return "Socket overlay đang offline. Dữ liệu đang dựa nhiều hơn vào refresh thủ công hoặc poll nền."
        }
        if store.socketPayloadStale {
            return "Socket vẫn nối nhưng payload đang stale. App cần thêm payload mới để coi overlay là hoàn toàn ổn định."
        }
        if !store.brandingReady {
            return "Overlay có dữ liệu trận nhưng logo hoặc sponsor chưa đầy đủ nên burn-in sẽ mỏng hơn bản Android."
        }
        return "Overlay đang ổn định và có đủ dữ liệu trận để burn-in lên preview hoặc RTMP."
    }

    private var overlaySignalReasons: [String] {
        var reasons: [String] = []
        if !store.overlayDataReady {
            reasons.append("Chưa có overlay snapshot mới cho match hiện tại.")
        }
        if !store.socketConnected {
            reasons.append("Socket overlay chưa kết nối hoặc chưa join room match.")
        }
        if store.socketPayloadStale {
            reasons.append("Payload socket đã stale \(store.socketPayloadAgeSeconds ?? 0) giây.")
        }
        if !store.brandingReady {
            reasons.append("Overlay config chưa có đủ logo giải, web logo hoặc sponsor.")
        }
        if let pendingNextMatchId = store.pendingNextMatchId {
            reasons.append("Match kế tiếp đang chờ chuyển context: \(pendingNextMatchId).")
        }
        if reasons.isEmpty {
            reasons.append("Không có tín hiệu lỗi nổi bật ở thời điểm hiện tại.")
        }
        return reasons
    }

    private var warningCenterSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Warning center")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Tổng hợp cảnh báo operator, recovery và các nút cứu nhanh khi đang giữ preview hoặc đang live.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)

                    if warningItems.isEmpty {
                        InlineInfoCard(
                            title: "Ổn định",
                            message: "Không có cảnh báo vận hành nào nổi bật. App đang ở trạng thái tương đối an toàn.",
                            tint: LivePalette.success
                        )
                    } else {
                        ForEach(warningItems, id: \.self) { item in
                            LiveCard {
                                InlineInfoCard(
                                    title: "Cảnh báo",
                                    message: item,
                                    tint: warningTint
                                )
                            }
                        }
                    }

                    LiveCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(
                                title: "Recovery",
                                subtitle: store.recoverySummary?.title ?? "Không có recovery chủ động"
                            )

                            Text(store.recoverySummary?.detail ?? "Nếu stream vừa tự phục hồi hoặc preview vừa được dựng lại, chi tiết sẽ hiện ở diagnostics.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(LivePalette.textSecondary)

                            HStack(spacing: 10) {
                                SecondaryActionButton(
                                    title: "Retry preview",
                                    systemImage: "arrow.triangle.2.circlepath.camera"
                                ) {
                                    store.retryPreviewPipeline()
                                }

                                SecondaryActionButton(
                                    title: "Retry session",
                                    systemImage: "bolt.horizontal.circle"
                                ) {
                                    store.retryActiveSession()
                                }
                            }
                        }
                    }

                    HStack(spacing: 10) {
                        SecondaryActionButton(
                            title: "Refresh context",
                            systemImage: "arrow.clockwise.circle"
                        ) {
                            Task {
                                await store.refreshCurrentContext()
                            }
                        }

                        if store.previewLeaseWarning {
                            SecondaryActionButton(
                                title: "Giữ sân thêm",
                                systemImage: "clock.badge.checkmark"
                            ) {
                                Task {
                                    await store.extendPreviewLease()
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var signalCenterSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Signal center")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Soi overlay, room socket, mạng và context sân để quyết định có cần dừng phiên hay chỉ refresh nhẹ.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)

                    LiveCard {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                TinyBadge(title: overlaySignalStatusLabel, tint: overlaySignalTint)
                                Spacer()
                                TinyBadge(title: "\(signalIssueCount) issue", tint: signalIssueCount == 0 ? LivePalette.success : LivePalette.warning)
                            }

                            Text(overlaySignalSummary)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(LivePalette.textSecondary)

                            ForEach(overlaySignalReasons, id: \.self) { reason in
                                BulletText(text: reason)
                            }
                        }
                    }

                    LiveCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(
                                title: "Realtime",
                                subtitle: "Tín hiệu runtime, socket và preview hiện tại"
                            )

                            DetailLine(label: "Mạng", value: store.networkConnected ? (store.networkIsWiFi ? "Wi-Fi" : "4G/5G") : "Offline")
                            DetailLine(label: "App state", value: store.appIsActive ? "Foreground" : "Background")
                            DetailLine(label: "Socket", value: store.socketConnected ? "Connected" : "Offline")
                            DetailLine(label: "Payload age", value: store.socketPayloadAgeSeconds.map { "\($0) giây" } ?? "Chưa có")
                            DetailLine(label: "Preview ready", value: store.previewReady ? "Sẵn sàng" : "Chưa sẵn sàng")
                            DetailLine(label: "Court", value: store.currentCourtIdentifier ?? store.selectedCourt?.displayName ?? "Chưa có")
                            DetailLine(label: "Match", value: store.activeMatch?.id ?? store.launchTarget.matchId ?? "Chưa có")
                            DetailLine(label: "Room socket", value: store.activeSocketMatchId?.trimmedNilIfBlank ?? "Chưa join")
                        }
                    }

                    if let watchURL = store.liveSession?.facebook?.watchURL?.trimmedNilIfBlank {
                        LiveCard {
                            VStack(alignment: .leading, spacing: 12) {
                                SectionHeader(
                                    title: "Live URL",
                                    subtitle: "Có thể mở nhanh để kiểm tra livestream public"
                                )

                                DetailLine(label: "Watch URL", value: watchURL)

                                SecondaryActionButton(
                                    title: "Mở live URL",
                                    systemImage: "link"
                                ) {
                                    if let url = URL(string: watchURL) {
                                        openURL(url)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private func captureBrightnessIfNeeded() {
        guard storedBrightness == nil else { return }
        guard UIApplication.shared.applicationState == .active else { return }
        storedBrightness = UIScreen.main.brightness
    }

    private func updateBrightnessIfNeeded() {
        captureBrightnessIfNeeded()
        guard UIApplication.shared.applicationState == .active else { return }
        if store.batterySaverEnabled {
            guard !brightnessReduced else { return }
            UIScreen.main.brightness = min(UIScreen.main.brightness, 0.26)
            brightnessReduced = true
        } else {
            restoreBrightnessIfNeeded()
        }
    }

    private func restoreBrightnessIfNeeded() {
        guard brightnessReduced, let storedBrightness else { return }
        guard UIApplication.shared.applicationState == .active else { return }
        UIScreen.main.brightness = storedBrightness
        brightnessReduced = false
    }
}

private struct PreflightSheet: View {
    let issues: [LivePreflightIssue]
    let onDismiss: () -> Void
    let onProceed: () -> Void

    private var hasBlocker: Bool {
        issues.contains { $0.severity == .blocker }
    }

    var body: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Kiểm tra trước khi vào phiên")
                        .font(.system(size: 28, weight: .black, design: .rounded))
                        .foregroundStyle(.white)

                    Text(hasBlocker ? "Có blocker cần xử lý trước khi cho phép bắt đầu." : "App phát hiện warning trước khi vào live. Bạn có thể xem và tiếp tục nếu chấp nhận rủi ro.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)

                    VStack(spacing: 12) {
                        ForEach(issues) { issue in
                            LiveCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack {
                                        TinyBadge(title: issue.severity.title.uppercased(), tint: severityTint(issue.severity))
                                        Spacer()
                                    }

                                    Text(issue.title)
                                        .font(.system(size: 18, weight: .bold))
                                        .foregroundStyle(.white)

                                    Text(issue.detail)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(LivePalette.textSecondary)
                                }
                            }
                        }
                    }

                    VStack(spacing: 10) {
                        SecondaryActionButton(title: "Đóng", systemImage: "xmark") {
                            onDismiss()
                        }

                        if !hasBlocker {
                            PrimaryActionButton(
                                title: "Vẫn tiếp tục",
                                subtitle: "Bắt đầu phiên với các warning hiện tại",
                                tint: LivePalette.accent
                            ) {
                                onProceed()
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
    }

    private func severityTint(_ severity: LivePreflightSeverity) -> Color {
        switch severity {
        case .blocker:
            return LivePalette.danger
        case .warning:
            return LivePalette.warning
        case .info:
            return LivePalette.accent
        }
    }
}

private struct RecoveryCard: View {
    let summary: LiveRecoverySummary
    let onRetryPreview: () -> Void
    let onRetrySession: () -> Void

    var body: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label(summary.title, systemImage: "wrench.and.screwdriver.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                    Spacer()
                    TinyBadge(title: "RECOVERY", tint: LivePalette.warning)
                }

                Text(summary.detail)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)

                HStack(spacing: 10) {
                    if summary.canRetryPreview {
                        SecondaryActionButton(
                            title: "Dựng lại preview",
                            systemImage: "camera.badge.ellipsis"
                        ) {
                            onRetryPreview()
                        }
                    }

                    if summary.canRetrySession {
                        SecondaryActionButton(
                            title: "Phục hồi phiên",
                            systemImage: "arrow.clockwise.icloud"
                        ) {
                            onRetrySession()
                        }
                    }
                }
            }
        }
    }
}

private struct LiveBackdrop: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.09, blue: 0.13),
                    Color(red: 0.03, green: 0.05, blue: 0.07),
                    Color(red: 0.02, green: 0.03, blue: 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(LivePalette.accent.opacity(0.14))
                .blur(radius: 40)
                .frame(width: 260, height: 260)
                .offset(x: -140, y: -280)

            Circle()
                .fill(LivePalette.warning.opacity(0.11))
                .blur(radius: 42)
                .frame(width: 280, height: 280)
                .offset(x: 160, y: -120)

            Circle()
                .fill(LivePalette.success.opacity(0.1))
                .blur(radius: 54)
                .frame(width: 320, height: 320)
                .offset(x: -160, y: 280)
        }
    }
}

private struct WorkingPill: View {
    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .tint(.white)
            Text("Đang xử lý")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            Capsule(style: .continuous)
                .fill(Color.black.opacity(0.62))
        )
    }
}

private struct NoticeStrip: View {
    let icon: String
    let title: String
    let message: String
    let tint: Color
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)

                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(8)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(tint.opacity(0.95))
        )
    }
}

private struct LiveCard<Content: View>: View {
    var padding: CGFloat = 18
    private let content: Content

    init(padding: CGFloat = 18, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(LivePalette.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(LivePalette.cardStroke, lineWidth: 1)
                    )
            )
    }
}

private struct HeaderBlock<Trailing: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    private let trailing: Trailing

    init(
        eyebrow: String,
        title: String,
        subtitle: String,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(eyebrow.uppercased())
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .kerning(1.2)
                    .foregroundStyle(LivePalette.textMuted)

                Text(title)
                    .font(.system(size: 29, weight: .black, design: .rounded))
                    .foregroundStyle(.white)

                Text(subtitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
            }

            Spacer(minLength: 0)

            trailing
        }
    }
}

private struct SectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(LivePalette.textSecondary)
        }
    }
}

private struct InlineInfoCard: View {
    let title: String
    let message: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(tint)
                .frame(width: 10, height: 10)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(tint.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(tint.opacity(0.35), lineWidth: 1)
                )
        )
    }
}

private struct MetricTile: View {
    let title: String
    let value: String
    let subtitle: String
    var accent: Color = LivePalette.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .black, design: .rounded))
                .foregroundStyle(LivePalette.textMuted)
                .kerning(0.8)

            Text(value)
                .font(.system(size: 24, weight: .black, design: .rounded))
                .foregroundStyle(.white)

            Text(subtitle)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(LivePalette.textSecondary)
                .lineLimit(3)

            RoundedRectangle(cornerRadius: 999, style: .continuous)
                .fill(accent)
                .frame(width: 34, height: 4)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(LivePalette.cardMuted.opacity(0.55))
        )
    }
}

private struct PrimaryActionButton: View {
    let title: String
    let subtitle: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.86))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(tint)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct SecondaryActionButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .bold))
                Text(title)
                    .font(.system(size: 14, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LivePalette.cardMuted)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct SecondaryIconButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(LivePalette.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(LivePalette.cardStroke, lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }
}

private struct ClusterChipCard: View {
    let cluster: CourtClusterData
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Text(cluster.displayName)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)

                Text(cluster.venueName?.trimmedNilIfBlank ?? "Không có venue name")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    TinyBadge(title: "\(cluster.stationsCount ?? 0) sân", tint: LivePalette.cardMuted)
                    TinyBadge(title: "\(cluster.liveCount ?? 0) live", tint: (cluster.liveCount ?? 0) > 0 ? LivePalette.danger : LivePalette.cardMuted)
                }
            }
            .padding(16)
            .frame(width: 220, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(selected ? LivePalette.accent.opacity(0.85) : LivePalette.cardMuted.opacity(0.66))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(selected ? Color.white.opacity(0.55) : LivePalette.cardStroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct CourtRowCard: View {
    let court: AdminCourtData
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(court.displayName)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                        Text(court.clusterName?.trimmedNilIfBlank ?? "Không có cluster")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(LivePalette.textSecondary)
                    }
                    Spacer()
                    TinyBadge(
                        title: presenceStateLabel(court.activePresence),
                        tint: presenceTint(court.activePresence)
                    )
                }

                HStack(spacing: 10) {
                    TinyBadge(
                        title: court.currentMatchId?.trimmedNilIfBlank ?? "Chưa có match",
                        tint: LivePalette.cardMuted
                    )
                    TinyBadge(
                        title: "Queue \(court.queueCount ?? 0)",
                        tint: LivePalette.cardMuted
                    )
                }

                Text(presenceDescription(court.activePresence))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack {
                    Text("Mở sân")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.8))
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(selected ? LivePalette.accentSoft.opacity(0.75) : LivePalette.cardMuted.opacity(0.55))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(selected ? Color.white.opacity(0.45) : LivePalette.cardStroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct LiveTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)

            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(LivePalette.cardMuted.opacity(0.72))
                )
                .foregroundStyle(.white)
        }
    }
}

private struct StatusCapsule: View {
    let title: String?
    let systemImage: String
    var tint: Color = LivePalette.cardMuted

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)

            if let title {
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            Capsule(style: .continuous)
                .fill(tint.opacity(0.88))
        )
    }
}

private struct TimerStatusCapsule: View {
    let startedAt: Date

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "timer")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
            Text(startedAt, style: .timer)
                .font(.system(size: 14, weight: .bold, design: .monospaced))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            Capsule(style: .continuous)
                .fill(LivePalette.cardMuted.opacity(0.88))
        )
    }
}

private struct TinyBadge: View {
    let title: String
    let tint: Color

    var body: some View {
        Text(title)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.9))
            )
    }
}

private struct OverlayScoreCard: View {
    let snapshot: LiveOverlaySnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(snapshot.tournamentName?.trimmedNilIfBlank ?? "PickleTour")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                    Text(snapshot.courtName?.trimmedNilIfBlank ?? "Court")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.7))
                }
                Spacer()
                if let phase = snapshot.phaseText?.trimmedNilIfBlank {
                    TinyBadge(title: phase, tint: LivePalette.cardMuted)
                }
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(snapshot.teamAName?.trimmedNilIfBlank ?? "Đội A")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                    Text("\(snapshot.scoreA ?? 0)")
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .foregroundStyle(LivePalette.teamA)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    Text(snapshot.teamBName?.trimmedNilIfBlank ?? "Đội B")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                    Text("\(snapshot.scoreB ?? 0)")
                        .font(.system(size: 34, weight: .black, design: .rounded))
                        .foregroundStyle(LivePalette.teamB)
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.52))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        )
    }
}

private struct CountdownOverlay: View {
    let title: String
    let subtitle: String
    let value: Int
    let tint: Color

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Color.black.opacity(0.7))
                .frame(width: 220, height: 220)

            VStack(spacing: 10) {
                Text(title)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)

                Text("\(value)")
                    .font(.system(size: 88, weight: .black, design: .rounded))
                    .foregroundStyle(tint)

                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.82))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 170)
            }
        }
    }
}

private struct SelectableModeCard: View {
    let title: String
    let summary: String
    let selected: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(selected ? LivePalette.accent : LivePalette.cardMuted)
                    .frame(width: 14, height: 14)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(selected ? 0 : 0.25), lineWidth: 1)
                    )
                    .padding(.top, 3)

                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                    Text(summary)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(selected ? LivePalette.accentSoft.opacity(0.7) : LivePalette.cardMuted.opacity(0.5))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(selected ? Color.white.opacity(0.35) : LivePalette.cardStroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .opacity(disabled && !selected ? 0.55 : 1)
    }
}

private struct QualityChip: View {
    let title: String
    let detail: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                Text(detail)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.72))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(selected ? LivePalette.accent : LivePalette.cardMuted)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct ControlTile: View {
    let title: String
    let subtitle: String
    let systemImage: String
    var accent: Color = LivePalette.cardMuted
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(accent)
                    )

                Text(title)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)

                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 126, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LivePalette.cardMuted.opacity(0.56))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct TournamentLogoView: View {
    let urlString: String?

    var body: some View {
        Group {
            if let url = URL(string: urlString?.trimmedNilIfBlank ?? "") {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image
                            .resizable()
                            .scaledToFit()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 52, height: 52)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LivePalette.cardMuted)
        )
    }

    private var placeholder: some View {
        Image(systemName: "flag.filled.and.flag.crossed")
            .font(.system(size: 22, weight: .bold))
            .foregroundStyle(.white.opacity(0.82))
    }
}

private struct TeamScorePanel: View {
    let teamName: String
    let score: Int
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(teamName)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(2)

            Text("\(score)")
                .font(.system(size: 42, weight: .black, design: .rounded))
                .foregroundStyle(accent)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(LivePalette.cardMuted.opacity(0.56))
        )
    }
}

private struct SponsorChip: View {
    let sponsor: SponsorItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles.rectangle.stack.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(LivePalette.accentSoft)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(sponsor.name)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text(sponsor.tier?.trimmedNilIfBlank ?? "sponsor")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)
                }
            }

            if let logoURL = sponsor.logoURL?.trimmedNilIfBlank {
                Text(logoURL)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(LivePalette.textMuted)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .frame(width: 190, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LivePalette.cardMuted.opacity(0.54))
        )
    }
}

private struct DetailLine: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(label)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(LivePalette.textMuted)
                .frame(width: 124, alignment: .leading)

            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

private struct EmptyStateCard: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(LivePalette.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(LivePalette.cardMuted.opacity(0.48))
        )
    }
}

private struct BulletText: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(LivePalette.accent)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(LivePalette.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct WrapBadgeFlow<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                content
            }
        }
    }
}

private enum LivePalette {
    static let accent = Color(red: 0.16, green: 0.69, blue: 0.58)
    static let accentSoft = Color(red: 0.13, green: 0.33, blue: 0.31)
    static let success = Color(red: 0.28, green: 0.72, blue: 0.48)
    static let warning = Color(red: 0.93, green: 0.58, blue: 0.22)
    static let danger = Color(red: 0.88, green: 0.26, blue: 0.29)
    static let teamA = Color(red: 0.78, green: 0.93, blue: 0.47)
    static let teamB = Color(red: 0.43, green: 0.82, blue: 0.98)
    static let card = Color(red: 0.07, green: 0.10, blue: 0.14).opacity(0.94)
    static let cardMuted = Color(red: 0.17, green: 0.21, blue: 0.27)
    static let cardStroke = Color.white.opacity(0.08)
    static let textSecondary = Color.white.opacity(0.75)
    static let textMuted = Color.white.opacity(0.46)
}

private func qualityDetail(_ quality: LiveQualityPreset) -> String {
    let resolution = quality.resolution
    let bitrateMbps = Double(quality.videoBitrate) / 1_000_000
    return "\(resolution.width)x\(resolution.height) | \(quality.frameRate)fps | \(String(format: "%.1f", bitrateMbps)) Mbps"
}

private func formattedBitrate(_ bitrate: Int) -> String {
    guard bitrate > 0 else { return "0 kbps" }
    let mbps = Double(bitrate) / 1_000_000
    if mbps >= 1 {
        return String(format: "%.2f Mbps", mbps)
    }
    return "\(bitrate / 1_000) kbps"
}

private func formatStorageBytes(_ bytes: Int64) -> String {
    guard bytes > 0 else { return "0 B" }
    let formatter = ByteCountFormatter()
    formatter.allowedUnits = [.useKB, .useMB, .useGB, .useTB]
    formatter.countStyle = .file
    formatter.includesUnit = true
    formatter.isAdaptive = true
    return formatter.string(fromByteCount: bytes)
}

private func humanReadableState(_ state: StreamConnectionState) -> String {
    switch state {
    case .idle:
        return "Idle"
    case .preparingPreview:
        return "Preparing preview"
    case .previewReady:
        return "Preview ready"
    case .connecting:
        return "Connecting"
    case .live:
        return "Live"
    case let .reconnecting(message):
        return "Reconnecting: \(message)"
    case .stopped:
        return "Stopped"
    case let .failed(message):
        return "Failed: \(message)"
    }
}

private func formattedTimestamp(_ raw: String?) -> String? {
    guard let date = parseISODate(raw) else { return nil }
    return DateFormatter.liveReadable.string(from: date)
}

private func relativeTimestamp(_ date: Date?) -> String {
    guard let date else { return "Chưa có" }
    let seconds = Int(Date().timeIntervalSince(date))
    if seconds <= 2 { return "Vừa xong" }
    if seconds < 60 { return "\(seconds) giây trước" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes) phút trước" }
    return DateFormatter.liveReadable.string(from: date)
}

private func parseISODate(_ raw: String?) -> Date? {
    guard let raw = raw?.trimmedNilIfBlank else { return nil }
    return ISO8601DateFormatter.liveApp.date(from: raw)
}

private func booleanText(_ value: Bool?) -> String {
    guard let value else { return "Chưa rõ" }
    return value ? "Có" : "Không"
}

private func presenceStateLabel(_ presence: CourtLiveScreenPresence?) -> String {
    guard let presence else { return "Trống" }
    if let state = presence.screenState?.trimmedNilIfBlank {
        return state.replacingOccurrences(of: "_", with: " ").capitalized
    }
    if presence.occupied == true {
        return "Occupied"
    }
    return "Preview"
}

private func presenceTint(_ presence: CourtLiveScreenPresence?) -> Color {
    guard let state = presence?.screenState?.trimmedNilIfBlank?.lowercased() else {
        return LivePalette.cardMuted
    }
    if state.contains("live") {
        return LivePalette.danger
    }
    if state.contains("preview") || state.contains("waiting") {
        return LivePalette.warning
    }
    return LivePalette.cardMuted
}

private func presenceDescription(_ presence: CourtLiveScreenPresence?) -> String {
    guard let presence else {
        return "Sân chưa có live screen presence."
    }

    let parts = [
        presence.screenState?.trimmedNilIfBlank.map { "screenState: \($0)" },
        presence.matchId?.trimmedNilIfBlank.map { "match: \($0)" },
        presence.previewReleaseAt.flatMap(formattedTimestamp).map { "release preview: \($0)" },
        presence.expiresAt.flatMap(formattedTimestamp).map { "expires: \($0)" }
    ]
    .compactMap { $0 }

    return parts.isEmpty ? "Presence có mặt nhưng chưa đủ metadata." : parts.joined(separator: " | ")
}

private extension DateFormatter {
    static let liveReadable: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()
}
