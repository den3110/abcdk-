import Combine
import SwiftUI
import UIKit

struct LiveAppRootView: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        ZStack(alignment: .top) {
            LiveBackdrop()
                .ignoresSafeArea()

            currentScreen
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            VStack(spacing: 0) {
                noticeStack
                Spacer(minLength: 0)
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
        if !store.startupResolved {
            StartupScreen()
        } else {
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
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
    }
}

private struct StartupScreen: View {
    var body: some View {
        GeometryReader { proxy in
            VStack {
                Spacer(minLength: 0)
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.2)
                Spacer(minLength: 0)
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

private struct LoginScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @State private var showPasswordLogin = false
    @State private var loginId = ""
    @State private var password = ""
    @State private var showPassword = false

    private var targetSummary: String? {
        if store.launchTarget.isUserMatchLaunch, let matchId = store.launchTarget.matchId?.trimmedNilIfBlank {
            return "Chuẩn bị mở live cho trận \(matchId)."
        }
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

    private var existingSessionTitle: String {
        "Tiếp tục với \(store.session?.displayName?.trimmedNilIfBlank ?? "PickleTour")"
    }

    private var passwordToggleTitle: String {
        showPasswordLogin ? "Quay lại" : "Đăng nhập bằng mật khẩu"
    }

    private var passwordActionTitle: String {
        showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    Spacer(minLength: 0)

                    LiveCard {
                        VStack(spacing: 18) {
                            VStack(spacing: 10) {
                                Text("Đăng nhập PickleTour Live")
                                    .font(.system(size: 20, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.center)

                                Text("Đăng nhập bằng tài khoản PickleTour để tiếp tục.")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(LivePalette.textSecondary)
                                    .multilineTextAlignment(.center)

                                if let targetSummary {
                                    Text(targetSummary)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(LivePalette.textSecondary)
                                        .multilineTextAlignment(.center)
                                }
                            }

                            if store.isWorking {
                                ProgressView()
                                    .tint(.white)
                                    .padding(.vertical, 2)
                            }

                            VStack(spacing: 12) {
                                if store.session != nil {
                                    Button {
                                        Task {
                                            await store.continueSavedSessionFromLogin()
                                        }
                                    } label: {
                                        Text(existingSessionTitle)
                                            .font(.system(size: 15, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity)
                                            .padding(.vertical, 13)
                                            .background(
                                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                    .fill(LivePalette.accent)
                                            )
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(store.isWorking)
                                }

                                if showPasswordLogin {
                                    VStack(spacing: 12) {
                                        LiveTextField(
                                            title: "Email / SĐT / Nickname",
                                            placeholder: "Nhập email, số điện thoại hoặc nickname",
                                            text: $loginId,
                                            textContentType: .username
                                        )

                                        LiveTextField(
                                            title: "Mật khẩu",
                                            placeholder: "Nhập mật khẩu",
                                            text: $password,
                                            isSecure: !showPassword,
                                            textContentType: .password
                                        )

                                        HStack(spacing: 10) {
                                            Button(passwordActionTitle) {
                                                showPassword.toggle()
                                            }
                                            .buttonStyle(.plain)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(LivePalette.accent)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .disabled(store.isWorking)

                                            Button {
                                                Task {
                                                    await store.signInWithPassword(loginId: loginId, password: password)
                                                }
                                            } label: {
                                                Group {
                                                    if store.isWorking {
                                                        ProgressView()
                                                            .tint(.white)
                                                    } else {
                                                        Text("Đăng nhập")
                                                            .font(.system(size: 14, weight: .semibold))
                                                    }
                                                }
                                                .foregroundStyle(.white)
                                                .frame(minWidth: 120)
                                                .padding(.horizontal, 18)
                                                .padding(.vertical, 13)
                                                .background(
                                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                        .fill(LivePalette.accent)
                                                )
                                            }
                                            .buttonStyle(.plain)
                                            .disabled(store.isWorking)
                                        }
                                    }
                                }

                                Button {
                                    store.requestPickleTourHandoff()
                                } label: {
                                    Text("Tiếp tục với PickleTour")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 13)
                                        .background(
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .fill(LivePalette.accentSoft)
                                        )
                                }
                                .buttonStyle(.plain)
                                .disabled(store.isWorking)

                                Button(passwordToggleTitle) {
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        showPasswordLogin.toggle()
                                    }
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(LivePalette.accent)
                                .disabled(store.isWorking)
                            }
                            .frame(maxWidth: .infinity)

                            if let session = store.session {
                                Text(session.userId?.trimmedNilIfBlank ?? "Đã có access token")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(LivePalette.textSecondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .frame(maxWidth: 460)

                    Text(buildVersionText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)

                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: proxy.size.height)
                .padding(.horizontal, 20)
                .padding(.vertical, 32)
            }
        }
    }
}

private struct AdminHomeScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @State private var showSignOutDialog = false
    @State private var occupiedCourtAlert: OccupiedCourtAlert?

    private var isClusterStep: Bool {
        store.selectedCluster == nil
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                MobileScreenBar(
                    title: isClusterStep ? "Chọn cụm sân" : "Chọn sân",
                    subtitle: isClusterStep
                        ? (store.user?.displayName ?? "PickleTour Live")
                        : (store.selectedCluster?.displayName ?? "PickleTour Live"),
                    leadingIcon: isClusterStep ? nil : "chevron.left",
                    leadingAction: isClusterStep ? nil : {
                        store.clearClusterSelection()
                    },
                    trailingTitle: "Đăng xuất",
                    trailingTint: LivePalette.accent,
                    trailingAction: {
                        showSignOutDialog = true
                    }
                )

                if store.clusters.isEmpty {
                    LiveCard {
                        EmptyStateCard(
                            title: "Chưa có cụm sân",
                            message: "Bootstrap chưa trả về cluster nào. Tải lại quyền hoặc kiểm tra account được cấp quyền live app."
                        )
                    }
                } else {
                    LiveCard {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(isClusterStep ? "Danh sách cụm sân" : "Danh sách sân")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(.white)
                                    Text(
                                        isClusterStep
                                            ? "Chọn một cụm sân để nạp danh sách court cho operator."
                                            : (store.selectedCluster?.displayName ?? "Chọn một sân để vào live.")
                                    )
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(LivePalette.textSecondary)
                                }
                                Spacer()
                                Button("Làm mới") {
                                    Task {
                                        await store.refreshBootstrap()
                                    }
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(LivePalette.accent)
                            }

                            if isClusterStep {
                                VStack(spacing: 10) {
                                    ForEach(store.clusters) { cluster in
                                        MobileSelectionRow(
                                            title: cluster.displayName,
                                            subtitle: buildClusterSubtitle(cluster),
                                            detail: buildClusterAssignedTournamentDetail(cluster),
                                            chipTitle: buildClusterChipTitle(cluster),
                                            chipTint: (cluster.liveCount ?? 0) > 0 ? LivePalette.warning : LivePalette.cardMuted
                                        ) {
                                            Task {
                                                await store.selectCluster(cluster)
                                            }
                                        }
                                    }
                                }
                            } else if store.courts.isEmpty {
                                EmptyStateCard(
                                    title: "Chưa có sân",
                                    message: "Sau khi chọn cluster, app sẽ hiện toàn bộ court mà operator được phép mở live."
                                )
                            } else {
                                VStack(spacing: 10) {
                                    ForEach(store.courts) { court in
                                        CourtRowCard(
                                            court: court,
                                            selected: store.selectedCourt?.id == court.id
                                        ) {
                                            if let message = court.occupiedMessage {
                                                occupiedCourtAlert = OccupiedCourtAlert(
                                                    title: "Sân đang được giữ",
                                                    message: message
                                                )
                                                return
                                            }
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
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 32)
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
        .alert(item: $occupiedCourtAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("Đóng"))
            )
        }
    }
}

private struct CourtSetupScreen: View {
    @EnvironmentObject private var store: LiveAppStore

    private var selectedCourtName: String? {
        store.selectedCourt?.displayName.trimmedNilIfBlank
            ?? store.courtRuntime?.name?.trimmedNilIfBlank
    }

    private var selectedCourtId: String? {
        store.launchTarget.courtId?.trimmedNilIfBlank
            ?? store.selectedCourt?.id.trimmedNilIfBlank
            ?? store.courtRuntime?.courtId.trimmedNilIfBlank
    }

    private var selectedPresence: CourtLiveScreenPresence? {
        store.selectedCourt?.activePresence ?? store.courtPresence
    }

    private var selectedCourtBlocked: Bool {
        selectedPresence?.isEffectivelyOccupied() ?? false
    }

    private var selectedCourtBlockedMessage: String? {
        guard selectedCourtBlocked else { return nil }
        let courtName = selectedCourtName ?? "Sân này"
        return selectedPresence?.occupiedMessage(for: courtName)
    }

    private var currentMatchId: String? {
        store.activeMatch?.id.trimmedNilIfBlank
            ?? store.courtRuntime?.currentMatchId?.trimmedNilIfBlank
            ?? store.courtRuntime?.nextMatchId?.trimmedNilIfBlank
    }

    private var canContinueByCourt: Bool {
        selectedCourtId != nil && !selectedCourtBlocked
    }

    private var liveButtonTitle: String {
        store.isWorking ? "Đang mở…" : "LIVE"
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    Spacer(minLength: max(24, proxy.size.height * 0.12))

                    LiveCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Chọn trận")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(.white)

                            Text("App sẽ lấy trận hiện tại của sân này. Nếu sân chưa có trận, bạn vẫn có thể vào chế độ live theo sân và chờ match xuất hiện.")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(LivePalette.textSecondary)

                            if let selectedCourtBlockedMessage {
                                InlineInfoCard(
                                    title: "Sân đang được giữ bởi thiết bị khác",
                                    message: selectedCourtBlockedMessage,
                                    tint: LivePalette.warning
                                )
                            }

                            if let selectedCourtName {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Sân đã chọn")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(LivePalette.textMuted)
                                        .textCase(.uppercase)
                                    Text(selectedCourtName)
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(.white)
                                }
                            }

                            if let selectedCourtName {
                                LiveDisplayField(
                                    title: "Sân",
                                    value: selectedCourtName
                                )
                            } else if let selectedCourtId {
                                LiveDisplayField(
                                    title: "Sân",
                                    value: selectedCourtId
                                )
                            }

                            if let activeMatch = store.activeMatch {
                                MobileMatchCard(match: activeMatch)
                            } else if currentMatchId != nil {
                                InlineInfoCard(
                                    title: "Đang tải thông tin trận",
                                    message: "Runtime của sân đã có matchId. App đang tiếp tục hydrate thông tin trận trước khi vào live.",
                                    tint: LivePalette.cardMuted
                                )
                            } else {
                                InlineInfoCard(
                                    title: "Sân đang không có trận hiện tại",
                                    message: "Bạn vẫn có thể bấm LIVE để vào chế độ live theo sân và chờ match xuất hiện.",
                                    tint: LivePalette.warning
                                )
                            }

                            Button {
                                pushCourtTargetToStore()
                                Task {
                                    await store.continueFromSetup()
                                }
                            } label: {
                                Text(liveButtonTitle)
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .fill(LivePalette.accent)
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(!canContinueByCourt)
                            .opacity(canContinueByCourt ? 1 : 0.55)

                            Button("Quay lại") {
                                store.goBackToAdminHome()
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(LivePalette.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                        }
                    }

                    Spacer(minLength: max(24, proxy.size.height * 0.18))
                }
            }
            .frame(minHeight: proxy.size.height)
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
    }

    private func pushCourtTargetToStore() {
        store.updateLaunchTarget(
            courtId: selectedCourtId,
            matchId: nil,
            pageId: store.launchTarget.pageId?.trimmedNilIfBlank
        )
    }
}

private enum LivePrimaryButtonVisualState {
    case goLive
    case auto
    case stop
    case waiting
    case busy
    case cancel
}

private struct LiveStreamScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @Environment(\.openURL) private var openURL
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    @State private var diagnosticsExpanded = false
    @State private var sessionExpanded = true
    @State private var recordingExpanded = true
    @State private var showWarningsSheet = false
    @State private var showSignalsSheet = false
    @State private var showSettingsSheet = false
    @State private var showQualitySheet = false
    @State private var showRecordingSheet = false
    @State private var showSignOutDialog = false
    @State private var storedBrightness: CGFloat?
    @State private var brightnessReduced = false
    @State private var pinchZoomBase: CGFloat?
    @State private var now = Date()
    @State private var topBarHeight: CGFloat = 0

    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private let controlColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    private let leaveActionTitle = "Thoát"

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            LivePreviewSurface(service: store.streamingService)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
                .ignoresSafeArea()
                .highPriorityGesture(previewPinchGesture)

            LinearGradient(
                colors: [
                    Color.black.opacity(0.72),
                    Color.clear,
                    Color.black.opacity(0.82)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            if store.batterySaverEnabled {
                Color.black.opacity(0.14)
                    .ignoresSafeArea()
            }

            if let capturePlaceholder {
                LiveCapturePlaceholder(
                    systemImage: capturePlaceholder.systemImage,
                    title: capturePlaceholder.title,
                    message: capturePlaceholder.message
                )
                .padding(.horizontal, 28)
            }

            VStack(spacing: 0) {
                VStack(spacing: isLandscapeLayout ? 0 : 8) {
                    if isLandscapeLayout {
                        HStack(alignment: .center, spacing: 12) {
                            topStatusLeftCluster
                            Spacer(minLength: 12)
                            topStatusRightCluster
                        }
                    } else {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                topStatusLeftCluster
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                Spacer(minLength: 0)
                                topStatusRightCluster
                            }
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
                .padding(.top, 8)
                .background(
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear {
                                topBarHeight = proxy.size.height
                            }
                            .onChange(of: proxy.size.height) { newValue in
                                topBarHeight = newValue
                            }
                    }
                )

                Spacer(minLength: 0)

                if waitingNextMatchVisible {
                    WaitingNextMatchOverlayCard(previewReady: store.previewReady)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 20)
                }

                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Text(qualityShortTitle)
                        if store.liveMode != .streamOnly {
                            Text("•")
                            Text(store.liveMode.title)
                        }
                        Text("•")
                        Text(String(format: "%.1fx", Double(store.streamingService.stats.zoomFactor)))
                        if let streamBitrateLabel {
                            Text("•")
                            Text(streamBitrateLabel)
                        }
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)

                    HStack(alignment: .top, spacing: 12) {
                        RoundConsoleButton(
                            title: "Flash",
                            systemImage: store.streamingService.stats.torchEnabled ? "flashlight.on.fill" : "flashlight.off.fill",
                            active: store.streamingService.stats.torchEnabled,
                            disabled: !store.cameraOperational
                        ) {
                            store.toggleTorch()
                        }

                        RoundConsoleButton(
                            title: "Mic",
                            systemImage: store.streamingService.stats.micEnabled ? "mic.fill" : "mic.slash.fill",
                            active: store.streamingService.stats.micEnabled,
                            disabled: !store.microphoneOperational
                        ) {
                            store.toggleMicrophone()
                        }

                        PrimaryRoundLiveButton(
                            state: mainButtonVisualState,
                            tint: mainActionTint,
                            disabled: mainActionDisabled,
                            action: triggerMainAction
                        )

                        RoundConsoleButton(
                            title: "Flip",
                            systemImage: "camera.rotate.fill",
                            active: false,
                            disabled: !store.cameraOperational
                        ) {
                            Task {
                                await store.toggleCamera()
                            }
                        }

                        RoundConsoleButton(
                            title: "Quality",
                            systemImage: "sparkles.tv.fill",
                            active: false
                        ) {
                            openQualityPicker()
                        }
                    }
                    .frame(maxWidth: .infinity)

                    GeometryReader { pillProxy in
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                CompactActionPill(
                                    title: "Battery",
                                    systemImage: "battery.50",
                                    active: store.batterySaverEnabled
                                ) {
                                    store.toggleBatterySaver()
                                }

                                CompactActionPill(
                                    title: store.orientationMode.title,
                                    systemImage: store.orientationMode.systemImage,
                                    active: store.orientationMode != .auto
                                ) {
                                    store.cycleOrientationMode()
                                }

                                if store.previewLeaseWarning {
                                    CompactActionPill(
                                        title: previewLeaseText ?? "Gia hạn",
                                        systemImage: "clock.badge.checkmark",
                                        active: true
                                    ) {
                                        Task {
                                            await store.extendPreviewLease()
                                        }
                                    }
                                }

                                CompactActionPill(
                                    title: "Cài đặt",
                                    systemImage: "gearshape",
                                    active: false
                                ) {
                                    showSettingsSheet = true
                                }

                                CompactActionPill(
                                    title: "Request",
                                    systemImage: "receipt.long",
                                    active: store.recordingPendingUploads > 0 || store.streamingService.isRecordingLocally
                                ) {
                                    showRecordingSheet = true
                                }

                                CompactActionPill(
                                    title: leaveActionTitle,
                                    systemImage: "xmark",
                                    active: false
                                ) {
                                    Task {
                                        await store.leaveLiveScreen()
                                    }
                                }
                            }
                            .frame(minWidth: pillProxy.size.width, alignment: .center)
                            .padding(.horizontal, 2)
                        }
                    }
                    .frame(height: 30)
                }
                .padding(.bottom, 12)
            }
            .padding(.horizontal, 16)

            if matchSwapLoadingVisible {
                MatchSwapLoadingPill(title: matchSwapLoadingTitle)
                    .padding(.top, topBarHeight + 16)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }

            if startupOverlayVisible {
                LiveStartupOverlay(
                    title: startupOverlayTitle,
                    subtitle: startupOverlaySubtitle
                )
            }

            if let seconds = store.goLiveCountdownSeconds {
                CountdownOverlay(
                    title: store.liveMode == .recordOnly ? "Chuẩn bị ghi hình" : "Chuẩn bị vào live",
                    subtitle: "Huỷ nếu chưa khoá xong camera hoặc target",
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
        .sheet(isPresented: $showSettingsSheet) {
            settingsSheet
        }
        .sheet(isPresented: $showQualitySheet) {
            qualityPickerSheet
        }
        .sheet(isPresented: $showRecordingSheet) {
            recordingRequestSheet
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
            updateIdleTimer(disabled: true)
        }
        .onChange(of: store.batterySaverEnabled) { _ in
            updateBrightnessIfNeeded()
        }
        .onDisappear {
            updateIdleTimer(disabled: false)
            restoreBrightnessIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            updateIdleTimer(disabled: false)
            restoreBrightnessIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            captureBrightnessIfNeeded()
            updateBrightnessIfNeeded()
            updateIdleTimer(disabled: true)
        }
        .onReceive(ticker) { date in
            now = date
        }
    }

    private var compactPreviewTitle: String {
        switch store.streamState {
        case .live:
            return "LIVE"
        case .connecting:
            return "CONNECT"
        case .reconnecting:
            return "RETRY"
        case .failed:
            return "ERROR"
        default:
            return "PREVIEW"
        }
    }

    private var compactPreviewIcon: String {
        switch store.streamState {
        case .live:
            return "dot.radiowaves.left.and.right"
        case .connecting:
            return "bolt.horizontal.circle.fill"
        case .reconnecting:
            return "arrow.clockwise"
        case .failed:
            return "exclamationmark.triangle.fill"
        default:
            return "camera"
        }
    }

    private var recordingBadgeTitle: String {
        if store.recordingPendingUploads > 0 {
            return "QUEUE"
        }
        if store.streamingService.isRecordingLocally {
            return "REC"
        }
        return "MODE"
    }

    private var networkStatusTitle: String {
        guard store.networkConnected else { return "OFFLINE" }
        return store.networkIsWiFi ? "Wi-Fi" : "4G/5G"
    }

    private var networkStatusTint: Color {
        store.networkConnected ? Color.white.opacity(0.75) : LivePalette.danger
    }

    private var socketIndicatorTint: Color {
        if store.waitingForCourt {
            return Color.white.opacity(0.35)
        }
        if store.socketRoomMismatch || store.socketPayloadStale {
            return LivePalette.warning
        }
        return store.socketConnected ? LivePalette.accent : LivePalette.danger
    }

    private var streamBitrateLabel: String? {
        guard store.streamingService.stats.currentBitrate > 0 else { return nil }
        return "\(max(1, Int(store.streamingService.stats.currentBitrate / 1000))) kbps"
    }

    private var qualityShortTitle: String {
        switch store.selectedQuality {
        case .stable720:
            return "720p"
        case .balanced1080:
            return "1080p"
        case .aggressive1080:
            return "1080p+"
        }
    }

    private var capturePlaceholder: (systemImage: String, title: String, message: String)? {
        guard let message = store.livePreviewPlaceholderMessage else { return nil }
        if !store.cameraDeviceAvailable {
            let detail = store.microphoneDeviceAvailable
                ? message
                : "\(message) Micro cũng không sẵn sàng trên thiết bị này."
            return ("video.slash.fill", "Không có camera preview", detail)
        }
        return ("video.slash.fill", "Camera chưa sẵn sàng", message)
    }

    private var mainActionTint: Color {
        if store.stopLiveCountdownSeconds != nil {
            return LivePalette.warning
        }
        if stopAction != nil {
            return LivePalette.danger
        }
        if store.goLiveCountdownSeconds != nil {
            return LivePalette.warning
        }
        return LivePalette.accent
    }

    private var mainButtonVisualState: LivePrimaryButtonVisualState {
        if store.stopLiveCountdownSeconds != nil || store.goLiveCountdownSeconds != nil {
            return .cancel
        }
        if stopAction != nil {
            return .stop
        }
        if store.isWorking {
            return .busy
        }
        switch store.streamState {
        case .connecting, .reconnecting:
            return .busy
        default:
            break
        }
        if store.waitingForNextMatch || store.waitingForCourt || store.waitingForMatchLive {
            return store.liveMode == .recordOnly ? .auto : .waiting
        }
        return store.liveMode == .recordOnly ? .auto : .goLive
    }

    private var mainActionDisabled: Bool {
        store.isWorking || (primaryStartAction == nil && stopAction == nil) || (stopAction == nil && !store.cameraOperational)
    }

    private var isLandscapeLayout: Bool {
        verticalSizeClass == .compact
    }

    private var topStatusLeftCluster: some View {
        HStack(alignment: .center, spacing: 10) {
            CompactStatusPill(
                title: compactPreviewTitle,
                systemImage: compactPreviewIcon,
                tint: previewPrimaryStatus.tint
            )

            if let liveStartedAt = store.liveStartedAt {
                CompactTimerPill(startedAt: liveStartedAt)
            }

            if store.liveMode.includesRecording {
                CompactStatusPill(
                    title: recordingBadgeTitle,
                    systemImage: "record.circle.fill",
                    tint: recordingTint
                )
            }

            if store.liveStartedAt == nil, let waitingLabel = waitingStateLabel {
                CompactTextPill(
                    title: waitingLabel,
                    tint: LivePalette.warning.opacity(0.22)
                )
            }
        }
    }

    private var topStatusRightCluster: some View {
        HStack(alignment: .center, spacing: 6) {
            TopLiveIconButton(
                systemImage: warningItems.isEmpty ? "info.circle.fill" : "exclamationmark.triangle.fill",
                tint: warningItems.isEmpty ? LivePalette.textSecondary : warningTint,
                badge: warningItems.isEmpty ? nil : "\(warningItems.count)"
            ) {
                showWarningsSheet = true
            }

            TopLiveIconButton(
                systemImage: "network",
                tint: overlaySignalTint,
                badge: signalIssueCount == 0 ? nil : "\(signalIssueCount)"
            ) {
                showSignalsSheet = true
            }

            TopLiveIconButton(
                systemImage: "memorychip.fill",
                tint: Color.white.opacity(0.84)
            ) {
                showSettingsSheet = true
            }

            LiveConnectionDot(tint: socketIndicatorTint)

            Text(networkStatusTitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(networkStatusTint)

            if let streamBitrateLabel {
                Text(streamBitrateLabel)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.8))
            }
        }
    }

    private var waitingNextMatchVisible: Bool {
        store.waitingForNextMatch && store.errorMessage == nil
    }

    private var matchSwapLoadingVisible: Bool {
        guard !waitingNextMatchVisible else { return false }
        guard store.previewReady else { return false }
        guard store.errorMessage == nil else { return false }
        if store.waitingForCourt || store.waitingForMatchLive {
            return false
        }
        switch store.streamState {
        case .live, .connecting, .reconnecting:
            return false
        default:
            break
        }
        return store.isWorking
    }

    private var matchSwapLoadingTitle: String {
        if store.activeMatch == nil {
            return "Đang nạp trận mới"
        }
        if store.brandingLoading || !store.overlayDataReady {
            return "Đang đồng bộ overlay mới"
        }
        return "Đang chuyển sang trận mới"
    }

    private var startupOverlayVisible: Bool {
        guard !matchSwapLoadingVisible else { return false }
        guard !waitingNextMatchVisible else { return false }
        guard capturePlaceholder == nil else { return false }
        guard store.errorMessage == nil else { return false }
        switch store.streamState {
        case .live, .connecting, .reconnecting:
            return false
        default:
            break
        }
        return store.isWorking || !store.previewReady
    }

    private var startupOverlayTitle: String {
        if store.waitingForCourt {
            return "Đang chờ trận trên sân..."
        }
        if store.waitingForMatchLive {
            return "Đang chờ trận chuyển LIVE..."
        }
        if store.brandingLoading {
            return "Đang tải branding..."
        }
        if !store.overlayDataReady, store.activeMatch != nil {
            return "Đang nạp overlay..."
        }
        return "Đang dựng preview..."
    }

    private var startupOverlaySubtitle: String {
        if store.waitingForCourt {
            return "App đang giữ preview và chờ runtime sân đẩy match mới."
        }
        if store.waitingForMatchLive {
            return "App đã armed, sẽ tự vào phiên khi match chuyển sang LIVE."
        }
        if store.brandingLoading {
            return "Logo giải và assets overlay đang được đồng bộ."
        }
        if !store.overlayDataReady, store.activeMatch != nil {
            return "Scoreboard đang lấy snapshot mới nhất trước khi burn-in."
        }
        return "Camera và pipeline đang khởi tạo để vào màn live."
    }

    private func triggerMainAction() {
        if let stopAction {
            stopAction.action()
            return
        }
        primaryStartAction?.action()
    }

    private func openQualityPicker() {
        switch store.streamState {
        case .connecting, .reconnecting:
            store.errorMessage = "Đang kết nối, chưa đổi chất lượng được."
        default:
            showQualitySheet = true
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
                .highPriorityGesture(previewPinchGesture)
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
                    if store.launchTarget.isUserMatchLaunch {
                        SelectableModeCard(
                            title: LiveStreamMode.streamOnly.title,
                            summary: "User match chỉ bật live RTMP, không dùng recording nền.",
                            selected: true,
                            disabled: true
                        ) {}
                    } else {
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
                    TinyBadge(
                        title: "Pin: \(store.batteryStatusSummary)",
                        tint: store.batteryLowWarning ? LivePalette.warning : LivePalette.cardMuted
                    )
                    TinyBadge(
                        title: "Nhiệt: \(store.thermalStateLabel)",
                        tint: store.thermalWarning ? LivePalette.warning : LivePalette.success
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
                        in: 1 ... max(Double(store.streamingService.maxZoomFactor), 1)
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
                    MetricTile(
                        title: "Pin",
                        value: store.batteryPercent.map { "\($0)%" } ?? "Chưa rõ",
                        subtitle: store.batteryStateLabel,
                        accent: store.batteryLowWarning ? LivePalette.warning : LivePalette.success
                    )
                    MetricTile(
                        title: "Nhiệt độ máy",
                        value: store.thermalStateLabel,
                        subtitle: store.systemLowPowerModeEnabled ? "Low Power Mode đang bật" : "Low Power Mode đang tắt",
                        accent: store.thermalWarning ? LivePalette.warning : LivePalette.success
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
                    DetailLine(label: "Pin", value: store.batteryStatusSummary)
                    DetailLine(label: "Nhiệt độ máy", value: store.thermalStateLabel)
                    DetailLine(label: "Low Power Mode", value: store.systemLowPowerModeEnabled ? "Đang bật" : "Đang tắt")
                    DetailLine(label: "Queue local", value: formatStorageBytes(store.recordingPendingQueueBytes))
                    DetailLine(label: "Runway recording", value: store.recordingEstimatedRunwayMinutes.map { "\($0) phút" } ?? "Chưa rõ")
                    DetailLine(
                        label: "Overlay / branding",
                        value: "\(store.overlayDataReady ? "OK" : "Thiếu") / \(store.brandingLoading ? "Đang tải" : (store.brandingReady ? "OK" : "Thiếu"))"
                    )
                }
            }
        }
    }

    private var observerSection: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(
                    title: "Observer VPS",
                    subtitle: "Theo dõi việc app có đang gửi telemetry sang VPS hay không."
                )

                HStack(spacing: 10) {
                    TinyBadge(title: store.observerTelemetryStatusLabel, tint: observerStatusTint)
                    TinyBadge(
                        title: "\(store.observerPendingEventCount) chờ gửi",
                        tint: store.observerPendingEventCount == 0 ? LivePalette.cardMuted : LivePalette.warning
                    )
                }

                VStack(alignment: .leading, spacing: 10) {
                    DetailLine(label: "Endpoint", value: store.observerTelemetryBaseURLString ?? "Chưa cấu hình")
                    DetailLine(label: "Heartbeat thành công gần nhất", value: relativeTimestamp(store.observerLastSuccessAt))
                    DetailLine(label: "Lỗi gần nhất", value: relativeTimestamp(store.observerLastFailureAt))
                    if let error = store.observerLastErrorMessage?.trimmedNilIfBlank {
                        DetailLine(label: "Chi tiết lỗi", value: error)
                    }
                    DetailLine(
                        label: "Ghi chú",
                        value: "Observer chỉ phục vụ giám sát. Nếu VPS lỗi, luồng live chính vẫn tiếp tục chạy."
                    )
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
                    MetricTile(
                        title: "Branding runtime",
                        value: store.brandingLoading ? "Đang tải" : (store.brandingReady ? "Sẵn sàng" : "Chưa xong"),
                        subtitle: store.overlayHealth.brandingAssetCount > 0
                            ? "Đã nạp \(store.overlayHealth.brandingLoadedCount)/\(store.overlayHealth.brandingAssetCount) asset"
                            : "Không có asset branding cần tải",
                        accent: store.brandingLoading
                            ? LivePalette.warning
                            : (store.brandingReady ? LivePalette.success : LivePalette.danger)
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
                        title: "Queue local",
                        value: formatStorageBytes(store.recordingPendingQueueBytes),
                        subtitle: "Dung lượng segment chưa tải xong",
                        accent: store.recordingPendingQueueBytes > 0 ? LivePalette.warning : LivePalette.success
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
                    MetricTile(
                        title: "Runway ước tính",
                        value: store.recordingEstimatedRunwayMinutes.map { "\($0) phút" } ?? "Chưa rõ",
                        subtitle: store.recordingStorageStrategyLabel,
                        accent: store.recordingStorageRedWarning ? LivePalette.warning : LivePalette.cardMuted
                    )
                }

                if let storageMessage = store.recordingStorageStatusMessage {
                    InlineInfoCard(
                        title: store.recordingStorageHardBlock
                            ? "Bộ nhớ đang chặn recording"
                            : (store.recordingStorageRedWarning ? "Bộ nhớ đang thấp hơn mức chạy chuẩn" : "Bộ nhớ đang thấp cho recording"),
                        message: storageMessage,
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
                        DetailLine(label: "Queue local", value: formatStorageBytes(store.recordingPendingQueueBytes))
                        DetailLine(label: "Runway", value: store.recordingEstimatedRunwayMinutes.map { "\($0) phút" } ?? "Chưa rõ")
                        DetailLine(label: "Segment strategy", value: store.recordingStorageStrategyLabel)
                        DetailLine(label: "Minimum / standard / recommended", value: "\(formatStorageBytes(store.minimumRecordingStorageBytes)) / \(formatStorageBytes(store.standardRecordingStorageBytes)) / \(formatStorageBytes(store.recommendedRecordingStorageBytes))")

                        if store.recordingMinimumAdditionalBytesNeeded > 0 {
                            DetailLine(label: "Đang thiếu tối thiểu", value: formatStorageBytes(store.recordingMinimumAdditionalBytesNeeded))
                        } else if store.recordingStandardAdditionalBytesNeeded > 0 {
                            DetailLine(label: "Cần thêm để về mức chuẩn", value: formatStorageBytes(store.recordingStandardAdditionalBytesNeeded))
                        } else if store.recordingRecommendedAdditionalBytesNeeded > 0 {
                            DetailLine(label: "Cần thêm để đạt mức khuyến nghị", value: formatStorageBytes(store.recordingRecommendedAdditionalBytesNeeded))
                        } else {
                            DetailLine(label: "Bộ nhớ ghi hình", value: "Đủ để bắt đầu")
                        }

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

                VStack(alignment: .leading, spacing: 10) {
                    DetailLine(label: "Bundle ID", value: Bundle.main.bundleIdentifier ?? "Chưa có")
                    DetailLine(label: "App build", value: buildVersionText)
                    DetailLine(label: "Mode / quality", value: "\(store.liveMode.title) / \(store.selectedQuality.title)")
                    DetailLine(label: "Court / match", value: "\(store.currentCourtIdentifier ?? "-") / \(store.activeMatch?.id ?? "-")")
                    DetailLine(label: "Socket room", value: store.activeSocketMatchId?.trimmedNilIfBlank ?? "Chưa join")
                    DetailLine(label: "Runtime registry", value: store.runtimeRegistrySummary)
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
        if store.safetyDegradeActive {
            return ("Safety mode", "exclamationmark.shield", LivePalette.warning)
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
                subtitle: "Dựng countdown 3 giây trước khi app vào phiên",
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

    private var buildVersionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(version) (\(build))"
    }

    private var warningItems: [String] {
        let _ = now
        var items: [String] = []
        if store.freshEntryRequired {
            items.append("Cần xác nhận lại context foreground")
        }
        if store.recoveryState.isActive {
            items.append("Recovery: \(store.recoveryState.stage.label)")
        }
        if let lastIssue = store.overlayHealth.lastIssue?.trimmedNilIfBlank {
            items.append("Overlay issue: \(lastIssue)")
        }
        if let memoryPressure = store.latestMemoryPressureSummary {
            items.append(memoryPressure)
        }
        if let safetyDegradeReason = store.safetyDegradeReason?.trimmedNilIfBlank {
            items.append("Safety mode: \(safetyDegradeReason)")
        }
        if !store.networkConnected {
            items.append("Thiết bị đang offline")
        }
        if !store.appIsActive {
            items.append("App đang background")
        }
        if !store.cameraPermissionGranted || !store.microphonePermissionGranted {
            items.append("Thiếu quyền camera hoặc micro")
        }
        if store.batteryLowWarning {
            items.append("Pin thấp \(store.batteryPercent ?? 0)%")
        }
        if store.thermalCritical {
            items.append("Thiết bị đang quá nóng")
        } else if store.thermalWarning {
            items.append("Thiết bị đang nóng")
        }
        if store.systemLowPowerModeEnabled {
            items.append("iOS đang bật Low Power Mode")
        }
        if store.socketPayloadStale {
            items.append("Payload overlay đang stale")
        }
        if store.socketRoomPending {
            items.append("Socket đang chờ join room match")
        }
        if store.socketRoomMismatch {
            items.append("Socket đang chờ room match mới")
        }
        if store.previewLeaseWarning, let leaseText = previewLeaseText {
            items.append("\(leaseText) sắp hết")
        }
        if store.recordingStorageHardBlock {
            items.append("Bộ nhớ quá thấp cho recording")
        } else if store.recordingStorageRedWarning {
            items.append("Bộ nhớ đang thấp hơn mức chạy chuẩn")
        } else if store.recordingStorageWarning {
            items.append("Bộ nhớ còn thấp cho recording")
        }
        if store.recordingPendingQueueBytes > 0 {
            items.append("Queue local \(formatStorageBytes(store.recordingPendingQueueBytes))")
        }
        if store.recordingPendingFinalizations > 0 {
            items.append("Còn \(store.recordingPendingFinalizations) recording chờ finalize")
        }
        if !store.overlayDataReady && store.activeMatch != nil {
            items.append("Overlay chưa có snapshot mới")
        }
        if !store.brandingReady && store.activeMatch != nil {
            items.append(store.brandingLoading ? "Branding đang tải" : "Branding chưa đầy đủ")
        }
        return items
    }

    private var warningTint: Color {
        if warningItems.contains(where: {
            $0.contains("offline")
                || $0.contains("Thiếu quyền")
                || $0.contains("quá thấp")
                || $0.contains("Pin thấp")
                || $0.contains("quá nóng")
        }) {
            return LivePalette.danger
        }
        return LivePalette.warning
    }

    private var signalIssueCount: Int {
        var issues = 0
        if store.freshEntryRequired { issues += 1 }
        if !store.networkConnected { issues += 1 }
        if !store.socketConnected || store.socketPayloadStale { issues += 1 }
        if store.socketRoomPending { issues += 1 }
        if store.socketRoomMismatch { issues += 1 }
        if !store.overlayDataReady && store.activeMatch != nil { issues += 1 }
        if !store.brandingReady && store.activeMatch != nil { issues += 1 }
        if store.overlayHealth.lastIssue?.trimmedNilIfBlank != nil { issues += 1 }
        if store.recoveryState.isActive { issues += 1 }
        if !store.previewReady { issues += 1 }
        if store.batteryLowWarning { issues += 1 }
        if store.thermalWarning { issues += 1 }
        if store.lastMemoryPressure != nil { issues += 1 }
        if store.safetyDegradeActive { issues += 1 }
        if store.recordingStorageWarning { issues += 1 }
        return issues
    }

    private var overlaySignalStatusLabel: String {
        if store.recoveryState.isActive {
            return store.recoveryState.stage.label
        }
        if store.freshEntryRequired {
            return "Chờ xác nhận"
        }
        if store.thermalCritical {
            return "Quá nóng"
        }
        if store.thermalWarning {
            return "Thiết bị nóng"
        }
        if store.batteryLowWarning {
            return "Pin thấp"
        }
        if store.safetyDegradeActive {
            return "Safety mode"
        }
        if store.recordingStorageHardBlock {
            return "Thiếu bộ nhớ"
        }
        if store.socketRoomPending {
            return "Chờ room"
        }
        if store.socketRoomMismatch {
            return "Sai room"
        }
        if store.overlayHealth.lastIssue?.trimmedNilIfBlank != nil {
            return "Overlay lỗi"
        }
        if store.recordingStorageRedWarning {
            return "Bộ nhớ thấp"
        }
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
            return store.brandingLoading ? "Đang tải branding" : "Thiếu branding"
        }
        return "Ổn định"
    }

    private var overlaySignalTint: Color {
        if store.recoveryState.severity == .critical {
            return LivePalette.danger
        }
        if store.thermalCritical {
            return LivePalette.danger
        }
        if !store.networkConnected {
            return LivePalette.danger
        }
        if store.recordingStorageHardBlock {
            return LivePalette.danger
        }
        if store.freshEntryRequired || !store.socketConnected || store.socketPayloadStale || store.socketRoomPending || store.socketRoomMismatch || !store.overlayDataReady || store.overlayHealth.lastIssue?.trimmedNilIfBlank != nil || store.thermalWarning || store.batteryLowWarning || store.safetyDegradeActive || store.recordingStorageWarning {
            return LivePalette.warning
        }
        return LivePalette.success
    }

    private var overlaySignalSummary: String {
        if let dialog = store.operatorRecoveryDialog {
            return dialog.detail
        }
        if store.freshEntryRequired {
            return "App vừa quay lại foreground sau lúc đang giữ phiên hoặc đang armed. Hãy refresh context hoặc bấm start lại có chủ đích để tránh vào sai nhịp."
        }
        if store.thermalCritical {
            return "Thiết bị đang quá nóng. Đây là trạng thái có thể làm encoder hoặc camera bị dừng đột ngột trên iPhone."
        }
        if store.thermalWarning {
            return "Thiết bị đang nóng. Nên giảm tải, hạn chế torch hoặc cắm nguồn ổn định để tránh phiên bị rớt."
        }
        if store.batteryLowWarning {
            return "Thiết bị đang pin thấp và không cắm sạc. Nên cấp nguồn trước khi tiếp tục phiên dài."
        }
        if store.socketRoomPending {
            return "Socket đã nối nhưng app vẫn chưa join vào room của match hiện tại. App sẽ đợi room khớp trước khi tự vào phiên."
        }
        if store.socketRoomMismatch {
            return "Socket đã nối nhưng vẫn chưa đúng room của match hiện tại. Overlay có thể đang chờ room mới hoặc vừa đổi trận."
        }
        if store.recordingStorageHardBlock {
            return "Bộ nhớ hiện tại không đủ để bắt đầu recording an toàn. App sẽ chặn phiên có ghi hình để tránh mất record."
        }
        if let storageMessage = store.recordingStorageStatusMessage, store.recordingStorageWarning {
            return storageMessage
        }
        if let safetyDegradeReason = store.safetyDegradeReason?.trimmedNilIfBlank {
            return "App đang tự hạ tải để giữ phiên ổn định: \(safetyDegradeReason)."
        }
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
            return store.brandingLoading
                ? "Overlay đã có dữ liệu trận nhưng branding assets vẫn đang tải. Burn-in sẽ đầy đủ hơn sau khi logo và sponsor nạp xong."
                : "Overlay có dữ liệu trận nhưng logo hoặc sponsor chưa đầy đủ nên burn-in sẽ mỏng hơn bản Android."
        }
        return "Overlay đang ổn định và có đủ dữ liệu trận để burn-in lên preview hoặc RTMP."
    }

    private var overlaySignalReasons: [String] {
        var reasons: [String] = []
        if store.freshEntryRequired {
            reasons.append("App vừa quay lại foreground và đang yêu cầu xác nhận lại context trước khi auto-start.")
        }
        if store.recoveryState.isActive {
            reasons.append("Recovery đang ở stage \(store.recoveryState.stage.label.lowercased()) với budget còn lại \(store.recoveryState.budgetRemaining).")
        }
        if let lastIssue = store.overlayHealth.lastIssue?.trimmedNilIfBlank {
            reasons.append("Overlay health báo lỗi: \(lastIssue).")
        }
        if !store.overlayDataReady {
            reasons.append("Chưa có overlay snapshot mới cho match hiện tại.")
        }
        if !store.socketConnected {
            reasons.append("Socket overlay chưa kết nối hoặc chưa join room match.")
        }
        if store.socketRoomPending {
            reasons.append("Socket đã nối nhưng app vẫn chưa xác nhận được room của match hiện tại.")
        }
        if store.socketRoomMismatch {
            reasons.append("Socket đang ở room match \(store.activeSocketMatchId?.trimmedNilIfBlank ?? "khác") thay vì match hiện tại.")
        }
        if store.socketPayloadStale {
            reasons.append("Payload socket đã stale \(store.socketPayloadAgeSeconds ?? 0) giây.")
        }
        if !store.brandingReady {
            reasons.append(
                store.brandingLoading
                    ? "Branding assets đang tải \(store.overlayHealth.brandingLoadedCount)/\(store.overlayHealth.brandingAssetCount)."
                    : "Overlay config chưa có đủ logo giải, web logo hoặc sponsor."
            )
        }
        if store.batteryLowWarning {
            reasons.append("Thiết bị đang còn ít pin: \(store.batteryStatusSummary).")
        }
        if store.thermalWarning {
            reasons.append("Nhiệt độ máy đang ở trạng thái \(store.thermalStateLabel.lowercased()).")
        }
        if store.systemLowPowerModeEnabled {
            reasons.append("iOS đang bật Low Power Mode, dư địa hiệu năng encode có thể thấp hơn.")
        }
        if let memoryPressure = store.latestMemoryPressureSummary {
            reasons.append(memoryPressure)
        }
        if let safetyDegradeReason = store.safetyDegradeReason?.trimmedNilIfBlank {
            reasons.append("App đã tự hạ tải để giữ ổn định: \(safetyDegradeReason).")
        }
        if let storageMessage = store.recordingStorageStatusMessage {
            reasons.append(storageMessage)
        }
        if store.recordingPendingFinalizations > 0 {
            reasons.append("Còn \(store.recordingPendingFinalizations) recording đang chờ finalize.")
        }
        if let pendingNextMatchId = store.pendingNextMatchId {
            reasons.append("Match kế tiếp đang chờ chuyển context: \(pendingNextMatchId).")
        }
        if reasons.isEmpty {
            reasons.append("Không có tín hiệu lỗi nổi bật ở thời điểm hiện tại.")
        }
        return reasons
    }

    private var observerStatusTint: Color {
        switch store.observerTelemetryStatusLabel {
        case "Đã kết nối":
            return LivePalette.success
        case "Đang lỗi":
            return LivePalette.danger
        case "Đã gửi trước đó":
            return LivePalette.warning
        default:
            return LivePalette.cardMuted
        }
    }

    private var settingsSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    ModalSheetHeader(
                        title: "Cài đặt",
                        subtitle: "Các thông tin chính của phiên live hiện tại."
                    ) {
                        showSettingsSheet = false
                    }

                    sessionSection
                    healthSection
                    observerSection

                    SecondaryActionButton(
                        title: "Đăng xuất",
                        systemImage: "rectangle.portrait.and.arrow.right"
                    ) {
                        showSignOutDialog = true
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var qualityPickerSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    ModalSheetHeader(
                        title: "Quality",
                        subtitle: "Chọn preset stream giống flow Android. Preset mới sẽ được áp dụng cho preview và phiên live tiếp theo."
                    ) {
                        showQualitySheet = false
                    }

                    LiveCard {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(
                                title: "Preset khả dụng",
                                subtitle: store.selectedQuality.title
                            )

                            VStack(spacing: 10) {
                                ForEach(LiveQualityPreset.allCases) { quality in
                                    SelectableModeCard(
                                        title: quality.title,
                                        summary: qualityDetail(quality),
                                        selected: store.selectedQuality == quality,
                                        disabled: false
                                    ) {
                                        store.applyQuality(quality)
                                        showQualitySheet = false
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

    private var recordingRequestSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    ModalSheetHeader(
                        title: "Request",
                        subtitle: "Chi tiết recording request, queue segment và playback của phiên hiện tại."
                    ) {
                        showRecordingSheet = false
                    }

                    recordingSection
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var warningCenterSheet: some View {
        ZStack {
            LiveBackdrop()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    ModalSheetHeader(
                        title: "Warning center",
                        subtitle: "Tổng hợp cảnh báo operator, recovery và các nút cứu nhanh khi đang giữ preview hoặc đang live."
                    ) {
                        showWarningsSheet = false
                    }

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

                            VStack(alignment: .leading, spacing: 10) {
                                if let recoveryDialog = store.operatorRecoveryDialog {
                                    DetailLine(label: "Stage", value: recoveryDialog.stage.label)
                                    DetailLine(label: "Severity", value: recoveryDialog.severity.label)
                                    DetailLine(label: "Attempt", value: "\(recoveryDialog.attempt)")
                                    DetailLine(label: "Budget", value: "\(recoveryDialog.budgetRemaining)")
                                    DetailLine(label: "Fail-soft", value: recoveryDialog.isFailSoftImminent ? "Near limit" : "No")
                                    if let lastFatal = recoveryDialog.lastFatalReason?.trimmedNilIfBlank {
                                        DetailLine(label: "Last fatal", value: lastFatal)
                                    }
                                    if !recoveryDialog.activeMitigations.isEmpty {
                                        DetailLine(label: "Mitigation", value: recoveryDialog.activeMitigations.joined(separator: " | "))
                                    }
                                }

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
                    ModalSheetHeader(
                        title: "Signal center",
                        subtitle: "Soi overlay, room socket, mạng và context sân để quyết định có cần dừng phiên hay chỉ refresh nhẹ."
                    ) {
                        showSignalsSheet = false
                    }

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
                            DetailLine(label: "Room state", value: store.socketRoomPending ? "Pending join" : (store.socketRoomMismatch ? "Mismatch" : "OK"))
                            DetailLine(label: "Room mismatch", value: store.socketRoomMismatch ? "Có" : "Không")
                            DetailLine(label: "Preview ready", value: store.previewReady ? "Sẵn sàng" : "Chưa sẵn sàng")
                            DetailLine(label: "Court", value: store.currentCourtIdentifier ?? store.selectedCourt?.displayName ?? "Chưa có")
                            DetailLine(label: "Match", value: store.activeMatch?.id ?? store.launchTarget.matchId ?? "Chưa có")
                            DetailLine(label: "Room socket", value: store.activeSocketMatchId?.trimmedNilIfBlank ?? "Chưa join")
                            DetailLine(label: "Lease ID", value: store.leaseId?.trimmedNilIfBlank ?? "None")
                            DetailLine(label: "Lease heartbeat", value: "\(max(store.leaseHeartbeatIntervalMs / 1000, 5))s")
                            DetailLine(label: "Recovery stage", value: store.recoveryState.isActive ? store.recoveryState.stage.label : "Stable")
                            DetailLine(label: "Recovery severity", value: store.recoveryState.isActive ? store.recoveryState.severity.label : "None")
                            DetailLine(label: "Overlay issue age", value: store.overlayIssueAgeSeconds.map { "\($0)s" } ?? "None")
                            DetailLine(label: "Memory pressure", value: store.latestMemoryPressureSummary ?? "None")
                            DetailLine(label: "Pin", value: store.batteryStatusSummary)
                            DetailLine(label: "Nhiệt độ máy", value: store.thermalStateLabel)
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
        self.storedBrightness = nil
    }

    private var previewPinchGesture: some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                if pinchZoomBase == nil {
                    pinchZoomBase = max(store.streamingService.stats.zoomFactor, 1)
                }
                let baseZoom = pinchZoomBase ?? max(store.streamingService.stats.zoomFactor, 1)
                let nextZoom = min(
                    max(baseZoom * scale, 1),
                    max(store.streamingService.maxZoomFactor, 1)
                )
                store.setZoom(nextZoom)
            }
            .onEnded { _ in
                pinchZoomBase = nil
            }
    }

    private func updateIdleTimer(disabled: Bool) {
        guard UIApplication.shared.applicationState == .active else { return }
        UIApplication.shared.isIdleTimerDisabled = disabled
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
                    ModalSheetHeader(
                        title: "Kiểm tra trước khi vào phiên",
                        subtitle: hasBlocker
                            ? "Có blocker cần xử lý trước khi cho phép bắt đầu."
                            : "App phát hiện warning trước khi vào live. Bạn có thể xem và tiếp tục nếu chấp nhận rủi ro."
                    ) {
                        onDismiss()
                    }

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
                    Color.black,
                    Color(red: 0.05, green: 0.05, blue: 0.05)
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            Circle()
                .fill(LivePalette.accent.opacity(0.08))
                .blur(radius: 70)
                .frame(width: 240, height: 240)
                .offset(x: -120, y: -250)

            Circle()
                .fill(LivePalette.accentSoft.opacity(0.1))
                .blur(radius: 80)
                .frame(width: 260, height: 260)
                .offset(x: 150, y: 260)
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
    var detail: String? = nil
    let tint: Color
    var onCopyDetail: (() -> Void)? = nil
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

                if let detail = detail?.trimmedNilIfBlank {
                    Text(detail)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(Color.white.opacity(0.8))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)

                    if let onCopyDetail {
                        Button(action: onCopyDetail) {
                            Label("Copy URL", systemImage: "doc.on.doc")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
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
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LivePalette.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
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
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(LivePalette.cardMuted)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(LivePalette.cardStroke, lineWidth: 1)
                    )
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
                .frame(width: 38, height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(LivePalette.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(LivePalette.cardStroke, lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }
}

private struct MobileScreenBar: View {
    let title: String
    let subtitle: String
    var leadingIcon: String?
    var leadingAction: (() -> Void)?
    var trailingTitle: String?
    var trailingTint: Color = LivePalette.accent
    var trailingAction: (() -> Void)?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let leadingIcon, let leadingAction {
                Button(action: leadingAction) {
                    Image(systemName: leadingIcon)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
            }

            Spacer(minLength: 0)

            if let trailingTitle, let trailingAction {
                Button(trailingTitle, action: trailingAction)
                    .buttonStyle(.plain)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(trailingTint)
            }
        }
    }
}

private struct MobileSelectionRow: View {
    let title: String
    let subtitle: String?
    let detail: String?
    let chipTitle: String?
    let chipTint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)

                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(LivePalette.textSecondary)
                    }

                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.9))
                    }
                }

                Spacer(minLength: 0)

                if let chipTitle, !chipTitle.isEmpty {
                    TinyBadge(title: chipTitle, tint: chipTint)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LivePalette.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(LivePalette.cardStroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct MobileMatchCard: View {
    let match: MatchData

    var body: some View {
        LiveCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    CompactTextPill(
                        title: match.displayCode?.trimmedNilIfBlank ?? match.id,
                        tint: LivePalette.cardMuted
                    )
                    Spacer()
                    CompactTextPill(
                        title: (match.status?.trimmedNilIfBlank ?? "Đang thi đấu").uppercased(),
                        tint: matchStatusTint(match.status)
                    )
                }

                Text("\(match.teamADisplayName) vs \(match.teamBDisplayName)")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                HStack {
                    Text("Tỉ số")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)
                    Spacer()
                    Text("\(match.scoreA ?? 0) - \(match.scoreB ?? 0)")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(LivePalette.accent)
                }

                Text(match.tournamentDisplayName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
            }
        }
    }
}

private struct CompactStatusPill: View {
    let title: String
    var systemImage: String?
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
            }
            Text(title)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(tint)
        )
    }
}

private struct CompactTextPill: View {
    let title: String
    let tint: Color

    var body: some View {
        CompactStatusPill(title: title, systemImage: nil, tint: tint)
    }
}

private struct CompactTimerPill: View {
    let startedAt: Date

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "timer")
                .font(.system(size: 11, weight: .bold))
            Text(startedAt, style: .timer)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(LivePalette.cardMuted)
        )
    }
}

private struct TopLiveIconButton: View {
    let systemImage: String
    let tint: Color
    var badge: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 34, height: 34)

                if let badge, !badge.isEmpty {
                    Text(badge)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(
                            Capsule(style: .continuous)
                                .fill(LivePalette.warning)
                        )
                        .offset(x: 6, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private struct LiveConnectionDot: View {
    let tint: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(tint)
            .frame(width: 8, height: 8)
    }
}

private struct FloatingConsoleCard: View {
    let title: String
    let message: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.84))
                .lineLimit(3)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(tint.opacity(0.65), lineWidth: 1)
                )
        )
    }
}

private struct CompactChoiceChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(selected ? LivePalette.accent : LivePalette.cardMuted)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct LiveCapturePlaceholder: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.9))
                .frame(width: 88, height: 88)
                .background(
                    Circle()
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )

            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
        }
    }
}

private struct MatchSwapLoadingPill: View {
    let title: String

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .tint(LivePalette.warning)
                .scaleEffect(0.7)

            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            Capsule(style: .continuous)
                .fill(Color.black.opacity(0.62))
        )
    }
}

private struct LiveStartupOverlay: View {
    let title: String
    let subtitle: String

    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .tint(LivePalette.accent)
                    .scaleEffect(1.15)

                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(LivePalette.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
            }
            .padding(.horizontal, 28)
        }
    }
}

private struct WaitingNextMatchOverlayCard: View {
    let previewReady: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "hourglass.tophalf.filled")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(LivePalette.warning)

                Text("Đang chờ trận kế tiếp")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
            }

            Text(
                previewReady
                    ? "Camera vẫn đang giữ preview. App đã dọn live và overlay của trận cũ, sẽ tự nạp overlay mới khi sân có trận tiếp theo."
                    : "App đang dựng lại preview để chờ trận kế tiếp. Khi có trận mới, overlay sẽ được nạp lại theo đúng trận đó."
            )
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.78))
            .lineSpacing(2)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.68))
        )
    }
}

private struct RoundConsoleButton: View {
    let title: String
    let systemImage: String
    let active: Bool
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(disabled ? LivePalette.textMuted : (active ? LivePalette.accent : Color.white))
                    .frame(width: 44, height: 44)
                    .background(
                        Circle()
                            .fill(disabled ? Color.white.opacity(0.06) : (active ? LivePalette.accentSoft : Color.white.opacity(0.1)))
                            .overlay(
                                Circle()
                                    .stroke(disabled ? Color.white.opacity(0.08) : LivePalette.cardStroke, lineWidth: 1)
                            )
                    )
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(disabled ? LivePalette.textMuted : Color.white.opacity(0.68))
            }
            .frame(width: 54)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
    }
}

private struct PrimaryRoundLiveButton: View {
    let state: LivePrimaryButtonVisualState
    let tint: Color
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                switch state {
                case .stop:
                    Image(systemName: "stop.fill")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(.white)
                case .busy:
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.1)
                case .waiting:
                    VStack(spacing: 2) {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 18, weight: .bold))
                        Text("CHỜ")
                            .font(.system(size: 9, weight: .black))
                    }
                    .foregroundStyle(.white)
                case .auto:
                    Text("AUTO")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(.white)
                case .cancel:
                    VStack(spacing: 2) {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .black))
                        Text("HỦY")
                            .font(.system(size: 9, weight: .black))
                    }
                    .foregroundStyle(.white)
                case .goLive:
                    Text("GO LIVE")
                        .font(.system(size: 11, weight: .black))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 72, height: 72)
            .background(
                Circle()
                    .fill(disabled ? Color.white.opacity(0.16) : tint)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.14), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

private struct CompactActionPill: View {
    let title: String
    let systemImage: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(active ? LivePalette.accent : LivePalette.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }
}

private struct ModalSheetHeader: View {
    let title: String
    let subtitle: String
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text(title)
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .foregroundStyle(.white)

                Spacer(minLength: 12)

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.1))
                                .overlay(
                                    Circle()
                                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                                )
                        )
                }
                .buttonStyle(.plain)
            }

            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(LivePalette.textSecondary)
        }
    }
}

private struct ClusterChipCard: View {
    let cluster: CourtClusterData
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Text(cluster.displayName)
                    .font(.system(size: 14, weight: .semibold))
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
            .padding(14)
            .frame(width: 188, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? LivePalette.accentSoft : LivePalette.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(selected ? LivePalette.accent : LivePalette.cardStroke, lineWidth: 1)
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
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(court.displayName)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(court.clusterName?.trimmedNilIfBlank ?? "Không có cluster")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(LivePalette.textSecondary)
                }

                Spacer()

                if let chipTitle = court.occupiedChipTitle {
                    TinyBadge(
                        title: chipTitle,
                        tint: presenceTint(court.activePresence)
                    )
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LivePalette.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(selected ? LivePalette.accent : LivePalette.cardStroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct OccupiedCourtAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

private struct LiveTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var textContentType: UITextContentType? = nil
    var keyboardType: UIKeyboardType = .default

    @ViewBuilder
    private var inputField: some View {
        if isSecure {
            SecureField(placeholder, text: $text)
                .textContentType(textContentType)
                .keyboardType(keyboardType)
        } else {
            TextField(placeholder, text: $text)
                .textContentType(textContentType)
                .keyboardType(keyboardType)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)

            inputField
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(LivePalette.cardMuted)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(LivePalette.cardStroke, lineWidth: 1)
                        )
                )
                .foregroundStyle(.white)
        }
    }
}

private struct LiveDisplayField: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)

            Text(value)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(LivePalette.cardMuted)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(LivePalette.cardStroke, lineWidth: 1)
                        )
                )
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
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
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
    static let accent = Color(red: 37.0 / 255.0, green: 194.0 / 255.0, blue: 160.0 / 255.0)
    static let accentSoft = Color(red: 79.0 / 255.0, green: 70.0 / 255.0, blue: 229.0 / 255.0)
    static let success = Color(red: 37.0 / 255.0, green: 194.0 / 255.0, blue: 160.0 / 255.0)
    static let warning = Color(red: 245.0 / 255.0, green: 158.0 / 255.0, blue: 11.0 / 255.0)
    static let danger = Color(red: 239.0 / 255.0, green: 68.0 / 255.0, blue: 68.0 / 255.0)
    static let teamA = Color(red: 37.0 / 255.0, green: 194.0 / 255.0, blue: 160.0 / 255.0)
    static let teamB = Color(red: 96.0 / 255.0, green: 165.0 / 255.0, blue: 250.0 / 255.0)
    static let card = Color(red: 26.0 / 255.0, green: 26.0 / 255.0, blue: 26.0 / 255.0)
    static let cardMuted = Color(red: 42.0 / 255.0, green: 42.0 / 255.0, blue: 42.0 / 255.0)
    static let cardStroke = Color(red: 68.0 / 255.0, green: 68.0 / 255.0, blue: 68.0 / 255.0)
    static let textSecondary = Color(red: 170.0 / 255.0, green: 170.0 / 255.0, blue: 170.0 / 255.0)
    static let textMuted = Color(red: 120.0 / 255.0, green: 120.0 / 255.0, blue: 120.0 / 255.0)
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

private func buildClusterChipTitle(_ cluster: CourtClusterData) -> String {
    let assignedCount = cluster.assignedTournamentCount ?? cluster.assignedTournaments.count
    let stationsCount = cluster.stationsCount ?? 0
    let liveCount = cluster.liveCount ?? 0
    if assignedCount > 0 {
        return "\(assignedCount) giải"
    }
    if liveCount > 0 {
        return "\(liveCount) live"
    }
    if stationsCount > 0 {
        return "\(stationsCount) sân"
    }
    return "Cụm sân"
}

private func buildClusterSubtitle(_ cluster: CourtClusterData) -> String {
    cluster.venueName?.trimmedNilIfBlank
        ?? cluster.description?.trimmedNilIfBlank
        ?? "Không có venue"
}

private func buildClusterAssignedTournamentDetail(_ cluster: CourtClusterData) -> String {
    let tournaments = cluster.assignedTournaments.filter { $0.name?.trimmedNilIfBlank != nil }
    guard !tournaments.isEmpty else {
        return "Giải đang gán: chưa có giải nào."
    }

    let preview = tournaments.prefix(3).map { tournament -> String in
        let meta = [
            tournamentStatusLabel(tournament.status),
            tournamentEventTypeLabel(tournament.eventType)
        ]
        .compactMap(\.self)
        .joined(separator: " • ")

        let title = tournament.name?.trimmedNilIfBlank ?? "Giải đấu"
        if meta.isEmpty {
            return "• \(title)"
        }
        return "• \(title) (\(meta))"
    }
    .joined(separator: "\n")

    let suffix = tournaments.count > 3 ? "\n+\(tournaments.count - 3) giải khác" : ""
    return "Giải đang gán:\n\(preview)\(suffix)"
}

private func tournamentStatusLabel(_ raw: String?) -> String? {
    switch raw?.trimmedNilIfBlank?.lowercased() {
    case "live", "ongoing", "running", "active":
        return "đang diễn ra"
    case "finished", "completed", "closed":
        return "đã kết thúc"
    case "published", "open":
        return "đang mở"
    case "draft":
        return "nháp"
    default:
        return nil
    }
}

private func tournamentEventTypeLabel(_ raw: String?) -> String? {
    switch raw?.trimmedNilIfBlank?.lowercased() {
    case "single", "singles":
        return "đơn"
    case "double", "doubles":
        return "đôi"
    case "team":
        return "đồng đội"
    case "round_robin":
        return "vòng tròn"
    default:
        return raw?.trimmedNilIfBlank
    }
}

private func matchStatusTint(_ status: String?) -> Color {
    let normalized = status?.trimmedNilIfBlank?.lowercased() ?? ""
    if normalized.contains("live") || normalized.contains("playing") {
        return LivePalette.danger
    }
    if normalized.contains("wait") || normalized.contains("preview") {
        return LivePalette.warning
    }
    return LivePalette.cardMuted
}

private extension DateFormatter {
    static let liveReadable: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()
}
