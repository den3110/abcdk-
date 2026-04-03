import SwiftUI

struct LiveAppRootView: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.09, blue: 0.14),
                    Color(red: 0.02, green: 0.03, blue: 0.06)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                header

                if let errorMessage = store.errorMessage {
                    MessageBanner(text: errorMessage, tint: Color(red: 0.78, green: 0.24, blue: 0.24))
                } else if let bannerMessage = store.bannerMessage {
                    MessageBanner(text: bannerMessage, tint: Color(red: 0.10, green: 0.55, blue: 0.42))
                }

                Group {
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
                .frame(maxWidth: 980)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(20)
        }
        .tint(Color(red: 0.15, green: 0.76, blue: 0.63))
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("PICKLETOUR LIVE")
                    .font(.caption.weight(.heavy))
                    .tracking(1.8)
                    .foregroundStyle(Color(red: 0.54, green: 0.83, blue: 0.98))
                Text(title)
                    .font(.system(size: 30, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }

            Spacer()

            if store.isWorking {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
            }
        }
    }

    private var title: String {
        switch store.route {
        case .login:
            return "Operator App"
        case .adminHome:
            return "Chọn Cụm Sân"
        case .courtSetup:
            return "Chuẩn Bị Live"
        case .liveStream:
            return "Điều Khiển Phát Sóng"
        }
    }
}

private struct LoginScreen: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        CardPanel {
            VStack(alignment: .leading, spacing: 18) {
                Text("App iOS độc lập cho vận hành PickleTour Live.")
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)

                Text("App này nhận deep link `pickletour-live://stream`, tự lấy phiên từ PickleTour nếu có thể, và fallback sang OAuth khi cần.")
                    .font(.body)
                    .foregroundStyle(Color.white.opacity(0.72))

                VStack(spacing: 12) {
                    Button {
                        store.requestPickleTourHandoff()
                    } label: {
                        Text("Tiếp tục với PickleTour")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryPillButtonStyle(fill: Color(red: 0.15, green: 0.76, blue: 0.63)))

                    Button {
                        Task { await store.signInWithWeb() }
                    } label: {
                        Text("Đăng nhập web")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryPillButtonStyle())
                }

                InfoGrid(items: [
                    ("Bundle ID", "com.pkt.pickletour.live"),
                    ("Scheme", "pickletour-live"),
                    ("Target", "iOS 15.1+")
                ])
            }
        }
        .frame(maxWidth: 620)
        .frame(maxHeight: .infinity, alignment: .center)
    }
}

private struct AdminHomeScreen: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        VStack(spacing: 16) {
            CardPanel {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.user?.displayName ?? "Operator")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Chọn cụm sân rồi vào đúng court để mở preview hoặc phát live.")
                            .foregroundStyle(Color.white.opacity(0.72))
                    }

                    Spacer()

                    Button("Đăng xuất") {
                        store.signOut()
                    }
                    .buttonStyle(SecondaryPillButtonStyle())
                }
            }

            CardPanel {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Cụm sân")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(store.clusters, id: \.id) { cluster in
                                Button {
                                    Task { await store.selectCluster(cluster) }
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(cluster.displayName)
                                            .font(.subheadline.weight(.bold))
                                        Text("\(cluster.stationsCount ?? 0) sân")
                                            .font(.caption)
                                    }
                                    .foregroundStyle(store.selectedCluster?.id == cluster.id ? Color.black : Color.white)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .fill(store.selectedCluster?.id == cluster.id ? Color(red: 0.70, green: 0.88, blue: 0.50) : Color.white.opacity(0.08))
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }

            CardPanel {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Text("Sân khả dụng")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                        Spacer()
                        Button("Nhập thủ công") {
                            store.showManualSetup()
                        }
                        .buttonStyle(SecondaryPillButtonStyle())
                    }

                    if store.courts.isEmpty {
                        Text("Chưa có sân trong cụm đang chọn.")
                            .foregroundStyle(Color.white.opacity(0.64))
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(store.courts, id: \.id) { court in
                                    CourtCard(court: court)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct CourtCard: View {
    @EnvironmentObject private var store: LiveAppStore
    let court: AdminCourtData

    var body: some View {
        Button {
            Task { await store.openCourt(court) }
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(court.displayName)
                        .font(.title3.weight(.bold))
                    Spacer()
                    PresenceChip(presence: court.activePresence)
                }
                .foregroundStyle(.white)

                HStack(spacing: 10) {
                    Label("Queue \(court.queueCount ?? 0)", systemImage: "list.number")
                    Label(court.status?.trimmedNilIfBlank ?? "idle", systemImage: "dot.radiowaves.left.and.right")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.white.opacity(0.62))
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct CourtSetupScreen: View {
    @EnvironmentObject private var store: LiveAppStore
    @State private var courtId = ""
    @State private var matchId = ""
    @State private var pageId = ""

    var body: some View {
        CardPanel {
            VStack(alignment: .leading, spacing: 18) {
                Text("Chốt court hoặc match trước khi vào màn live.")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)

                if let selectedCourt = store.selectedCourt {
                    InfoGrid(items: [
                        ("Court", selectedCourt.displayName),
                        ("Match hiện tại", store.courtRuntime?.currentMatchId ?? "Chưa có"),
                        ("Match kế tiếp", store.courtRuntime?.nextMatchId ?? "Chưa có")
                    ])
                }

                Group {
                    inputField(title: "courtId", text: $courtId)
                    inputField(title: "matchId", text: $matchId)
                    inputField(title: "pageId", text: $pageId)
                }

                HStack(spacing: 12) {
                    Button {
                        store.updateLaunchTarget(courtId: courtId, matchId: matchId, pageId: pageId)
                        Task { await store.continueFromSetup() }
                    } label: {
                        Text("Mở live")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryPillButtonStyle(fill: Color(red: 0.15, green: 0.76, blue: 0.63)))

                    Button {
                        store.route = .adminHome
                    } label: {
                        Text("Quay lại")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryPillButtonStyle())
                }
            }
            .onAppear {
                courtId = store.launchTarget.courtId ?? store.selectedCourt?.id ?? ""
                matchId = store.launchTarget.matchId ?? ""
                pageId = store.launchTarget.pageId ?? ""
            }
        }
    }

    private func inputField(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption.weight(.heavy))
                .tracking(1.2)
                .foregroundStyle(Color.white.opacity(0.56))
            TextField("", text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
                .foregroundStyle(.white)
        }
    }
}

private struct LiveStreamScreen: View {
    @EnvironmentObject private var store: LiveAppStore

    var body: some View {
        VStack(spacing: 16) {
            ZStack(alignment: .topLeading) {
                LivePreviewSurface(service: store.streamingService)
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .frame(minHeight: 320, maxHeight: 460)
                    .overlay {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    }

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        StatusBadge(
                            title: statusTitle(store.streamState),
                            color: statusColor(store.streamState)
                        )
                        StatusBadge(
                            title: store.socketConnected ? "Socket OK" : "Socket off",
                            color: store.socketConnected ? Color.green : Color.orange
                        )
                        if store.liveMode.includesRecording {
                            StatusBadge(title: store.recordingStateText, color: Color(red: 0.84, green: 0.24, blue: 0.24))
                        }
                    }

                    if let overlay = store.overlaySnapshot {
                        ScoreboardOverlay(snapshot: overlay)
                    }
                }
                .padding(18)
            }

            HStack(alignment: .top, spacing: 16) {
                CardPanel {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Điều khiển")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)

                        Picker("Mode", selection: $store.liveMode) {
                            ForEach(LiveStreamMode.allCases) { mode in
                                Text(mode.rawValue).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)

                        Picker("Quality", selection: Binding(
                            get: { store.selectedQuality },
                            set: { store.applyQuality($0) }
                        )) {
                            ForEach(LiveQualityPreset.allCases) { preset in
                                Text(preset.title).tag(preset)
                            }
                        }
                        .pickerStyle(.menu)

                        HStack(spacing: 12) {
                            Button {
                                Task { await store.startLive() }
                            } label: {
                                Text("Go Live")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(PrimaryPillButtonStyle(fill: Color(red: 0.84, green: 0.24, blue: 0.24)))

                            Button {
                                Task { await store.stopLive() }
                            } label: {
                                Text("Stop")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(SecondaryPillButtonStyle())
                        }

                        HStack(spacing: 12) {
                            ActionIconButton(title: "Cam", systemImage: "arrow.triangle.2.circlepath.camera") {
                                Task { await store.toggleCamera() }
                            }
                            ActionIconButton(title: "Torch", systemImage: "flashlight.on.fill") {
                                store.toggleTorch()
                            }
                            ActionIconButton(title: "Mic", systemImage: "mic.fill") {
                                store.toggleMicrophone()
                            }
                            ActionIconButton(title: "Overlay", systemImage: "rectangle.on.rectangle") {
                                Task { await store.refreshOverlay() }
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Zoom \(store.streamingService.stats.zoomFactor, specifier: "%.1fx")")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                            Slider(
                                value: Binding(
                                    get: { Double(store.streamingService.stats.zoomFactor) },
                                    set: { store.setZoom(CGFloat($0)) }
                                ),
                                in: 1...4
                            )
                        }
                    }
                }

                CardPanel {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Trạng thái")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)

                        InfoGrid(items: [
                            ("Court", store.selectedCourt?.displayName ?? store.launchTarget.courtId ?? "N/A"),
                            ("Match", store.activeMatch?.displayCode ?? store.activeMatch?.id ?? "N/A"),
                            ("Presence", store.courtPresence?.screenState ?? "idle"),
                            ("Bitrate", "\(store.streamingService.stats.currentBitrate / 1000) kbps")
                        ])

                        if let activeMatch = store.activeMatch {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(activeMatch.tournamentDisplayName)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                Text("\(activeMatch.teamADisplayName) vs \(activeMatch.teamBDisplayName)")
                                    .foregroundStyle(Color.white.opacity(0.74))
                            }
                        }

                        Button {
                            Task { await store.leaveLiveScreen() }
                        } label: {
                            Text("Thoát màn live")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryPillButtonStyle())
                    }
                }
            }

            CardPanel {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Diagnostics")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)

                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(store.streamingService.diagnostics, id: \.self) { line in
                                Text(line)
                                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(0.72))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .frame(maxHeight: 160)
                }
            }
        }
    }

    private func statusTitle(_ state: StreamConnectionState) -> String {
        switch state {
        case .idle:
            return "Idle"
        case .preparingPreview:
            return "Preparing"
        case .previewReady:
            return "Preview Ready"
        case .connecting:
            return "Connecting"
        case .live:
            return "LIVE"
        case let .reconnecting(message):
            return "Reconnecting \(message)"
        case .stopped:
            return "Stopped"
        case let .failed(message):
            return "Error \(message)"
        }
    }

    private func statusColor(_ state: StreamConnectionState) -> Color {
        switch state {
        case .live:
            return Color.red
        case .previewReady:
            return Color.green
        case .connecting, .preparingPreview:
            return Color.orange
        case .reconnecting(_):
            return Color.orange
        case .failed(_):
            return Color.red
        case .idle, .stopped:
            return Color.gray
        }
    }
}

private struct ScoreboardOverlay: View {
    let snapshot: LiveOverlaySnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(snapshot.tournamentName?.trimmedNilIfBlank ?? "PickleTour")
                    .font(.caption.weight(.heavy))
                    .tracking(1.4)
                    .foregroundStyle(Color.white.opacity(0.66))
                Text(snapshot.courtName?.trimmedNilIfBlank ?? "Court")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
            }

            HStack(spacing: 12) {
                scoreColumn(name: snapshot.teamAName?.trimmedNilIfBlank ?? "Team A", score: snapshot.scoreA ?? 0, tint: Color(red: 0.69, green: 0.87, blue: 0.47))
                scoreColumn(name: snapshot.teamBName?.trimmedNilIfBlank ?? "Team B", score: snapshot.scoreB ?? 0, tint: Color(red: 0.47, green: 0.78, blue: 0.96))
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .frame(maxWidth: 380, alignment: .leading)
    }

    private func scoreColumn(name: String, score: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text("\(score)")
                .font(.system(size: 40, weight: .black, design: .rounded))
                .foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MessageBanner: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(tint.opacity(0.88))
            )
            .frame(maxWidth: 980)
    }
}

private struct CardPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
    }
}

private struct InfoGrid: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(Array(items.enumerated()), id: \.offset) { entry in
                let item = entry.element
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.0.uppercased())
                        .font(.caption2.weight(.heavy))
                        .tracking(1.2)
                        .foregroundStyle(Color.white.opacity(0.48))
                    Text(item.1)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                )
            }
        }
    }
}

private struct PresenceChip: View {
    let presence: CourtLiveScreenPresence?

    var body: some View {
        let occupied = presence?.occupied ?? false
        Text(occupied ? "Đang giữ" : "Trống")
            .font(.caption.weight(.heavy))
            .foregroundStyle(occupied ? Color.black : Color.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(occupied ? Color(red: 0.92, green: 0.83, blue: 0.43) : Color.white.opacity(0.12))
            )
    }
}

private struct StatusBadge: View {
    let title: String
    let color: Color

    var body: some View {
        Text(title)
            .font(.caption.weight(.heavy))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(.white)
            .background(
                Capsule(style: .continuous)
                    .fill(color.opacity(0.82))
            )
    }
}

private struct ActionIconButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.headline.weight(.bold))
                Text(title)
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct PrimaryPillButtonStyle: ButtonStyle {
    let fill: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.heavy))
            .foregroundStyle(Color.black)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(
                Capsule(style: .continuous)
                    .fill(fill.opacity(configuration.isPressed ? 0.78 : 1))
            )
    }
}

private struct SecondaryPillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(configuration.isPressed ? 0.10 : 0.06))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
            )
    }
}
