import Foundation
import SocketIO

private enum SocketDecode {
    static func data(from payload: Any?) -> Data? {
        guard let payload else { return nil }

        if let string = payload as? String {
            return string.data(using: .utf8)
        }

        if JSONSerialization.isValidJSONObject(payload) {
            return try? JSONSerialization.data(withJSONObject: payload)
        }

        if let dictionary = payload as? [String: Any], JSONSerialization.isValidJSONObject(dictionary) {
            return try? JSONSerialization.data(withJSONObject: dictionary)
        }

        if let array = payload as? [Any], JSONSerialization.isValidJSONObject(array) {
            return try? JSONSerialization.data(withJSONObject: array)
        }

        return nil
    }

    static func decode<T: Decodable>(_ type: T.Type, from payload: Any?) -> T? {
        guard let data = data(from: payload) else { return nil }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            #if DEBUG
            print("[PTLive socket] decode \(T.self) FAILED: \(error)")
            #endif
            return nil
        }
    }
}

final class MatchSocketCoordinator {
    var onOverlaySnapshot: ((LiveOverlaySnapshot) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?
    var onStatusChange: ((String?) -> Void)?
    var onActiveMatchChange: ((String?) -> Void)?
    var onLog: ((String) -> Void)?
    var onPayloadTimestamp: ((Date) -> Void)?

    private let tokenProvider: () -> String?
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var token: String?
    private var joinedMatchId: String?
    private var desiredMatchId: String?
    /// Gate version như Android: bỏ payload có liveVersion < bản đã áp (bằng thì nhận).
    private var lastAppliedVersion: Int = -1
    private var lastSnapshotRequestAt: Date?

    init(tokenProvider: @escaping () -> String?) {
        self.tokenProvider = tokenProvider
    }

    func connectIfNeeded() {
        let token = tokenProvider()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else {
            disconnect()
            return
        }

        if
            self.token == token,
            let status = socket?.status,
            status == .connected || status == .connecting
        {
            return
        }

        reconnect(token: token)
    }

    func watch(matchId: String) {
        guard let normalized = matchId.trimmedNilIfBlank else {
            unwatch()
            return
        }
        desiredMatchId = normalized
        connectIfNeeded()
        joinDesiredMatchIfPossible()
    }

    func unwatch() {
        if let joinedMatchId {
            socket?.emit("match:leave", ["matchId": joinedMatchId])
        }
        joinedMatchId = nil
        desiredMatchId = nil
        lastAppliedVersion = -1
        onActiveMatchChange?(nil)
    }

    func disconnect(clearDesiredMatch: Bool = true) {
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager = nil
        socket = nil
        token = nil
        joinedMatchId = nil
        if clearDesiredMatch {
            desiredMatchId = nil
        }
        onConnectionChange?(false)
        onActiveMatchChange?(nil)
    }

    private func reconnect(token: String) {
        let desiredMatchId = desiredMatchId
        disconnect(clearDesiredMatch: false)
        self.token = token
        self.desiredMatchId = desiredMatchId

        let manager = SocketManager(
            socketURL: LiveAppConfig.socketURL,
            config: [
                .log(false),
                .compress,
                .forceWebsockets(true),
                .path("/socket.io"),
                .extraHeaders(["Authorization": "Bearer \(token)"]),
                .connectParams([
                    "token": token,
                    "authorization": "Bearer \(token)"
                ])
            ]
        )

        let socket = manager.defaultSocket
        configure(socket: socket)
        self.manager = manager
        self.socket = socket
        socket.connect()
    }

    private func configure(socket: SocketIOClient) {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            self?.onConnectionChange?(true)
            self?.joinDesiredMatchIfPossible()
        }

        socket.on(clientEvent: .disconnect) { [weak self] data, _ in
            self?.joinedMatchId = nil
            self?.onConnectionChange?(false)
            self?.onActiveMatchChange?(nil)
            let reason = data.first as? String ?? "disconnect"
            self?.onLog?("Match socket disconnected: \(reason)")
        }

        socket.on(clientEvent: .error) { [weak self] data, _ in
            self?.onLog?("Match socket error: \(String(describing: data.first))")
        }

        socket.on("match:joined") { [weak self] data, _ in
            guard let self else { return }
            let matchId = (data.first as? [String: Any])?["matchId"] as? String
            self.joinedMatchId = matchId?.trimmedNilIfBlank
            self.lastAppliedVersion = -1 // room mới → bỏ gate version cũ
            self.onActiveMatchChange?(self.joinedMatchId)
        }

        for event in ["match:snapshot", "score:updated", "score:update", "match:update", "match:patched", "status:updated", "winner:updated"] {
            socket.on(event) { [weak self] data, _ in
                self?.handleMatchPayload(data.first, event: event)
            }
        }
    }

    private func joinDesiredMatchIfPossible() {
        guard socket?.status == .connected, let desiredMatchId = desiredMatchId?.trimmedNilIfBlank else { return }
        if joinedMatchId == desiredMatchId { return }
        if let joinedMatchId {
            socket?.emit("match:leave", ["matchId": joinedMatchId])
        }
        socket?.emit("match:join", ["matchId": desiredMatchId])
    }

    /// Key chứng tỏ payload có dữ liệu trận. Thiếu hết → patch-only (match:patched,
    /// status:updated…) → xin snapshot đầy đủ như Android.
    private static let informativeMatchKeys = ["gameScores", "currentGame", "scoreA", "scoreB", "teamAName", "teamBName", "serve", "sets"]

    /// Xin server gửi lại `match:snapshot` (DTO đầy đủ). Throttle 600ms như Android
    /// (server cũng giới hạn 500ms/socket + dedupe 750ms).
    func requestSnapshot(reason: String, minIntervalMs: Int = 600) {
        guard socket?.status == .connected,
              let matchId = (joinedMatchId ?? desiredMatchId)?.trimmedNilIfBlank else { return }
        let now = Date()
        if minIntervalMs > 0, let last = lastSnapshotRequestAt,
           now.timeIntervalSince(last) * 1000 < Double(minIntervalMs) {
            return
        }
        lastSnapshotRequestAt = now
        socket?.emit("match:snapshot:request", ["matchId": matchId, "reason": reason])
    }

    /// `_id` có thể là String, NSNumber hoặc {"$oid": ...}.
    private static func idString(_ value: Any?) -> String? {
        if let string = value as? String { return string.trimmedNilIfBlank }
        if let number = value as? NSNumber { return number.stringValue }
        if let dict = value as? [String: Any] { return idString(dict["$oid"] ?? dict["_id"] ?? dict["id"]) }
        return nil
    }

    /// Socket.IO-Swift giao số dạng NSNumber (Int/Double) hoặc chuỗi số.
    private static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }

    private func handleMatchPayload(_ payload: Any?, event: String = "?") {
        guard let root = payload as? [String: Any] else {
            #if DEBUG
            print("[PTLive socket] \(event): payload không phải object")
            #endif
            return
        }
        let hasInfo: ([String: Any]) -> Bool = { dict in
            Self.informativeMatchKeys.contains { dict[$0] != nil }
        }

        // Android: match = obj.match ?? obj.data ?? obj — bóc envelope của `match:update`
        // ({type, matchId, bracketId, tournamentId, data: DTO}).
        var body = root
        if !hasInfo(root) {
            if let wrapped = root["match"] as? [String: Any] {
                body = wrapped
            } else if let wrapped = root["data"] as? [String: Any] {
                body = wrapped
            }
        }

        // Guard matchId: bỏ payload của trận khác (room cũ / chuyển trận trên cùng sân).
        let payloadId = Self.idString(root["_id"]) ?? Self.idString(root["id"]) ?? Self.idString(root["matchId"])
            ?? Self.idString(body["_id"]) ?? Self.idString(body["matchId"])
        if let payloadId, let expected = (joinedMatchId ?? desiredMatchId)?.trimmedNilIfBlank, payloadId != expected {
            #if DEBUG
            print("[PTLive socket] \(event): BỎ — payload của trận \(payloadId), đang theo \(expected)")
            #endif
            return
        }

        let status = (body["status"] as? String) ?? (root["status"] as? String)

        // Patch-only (match:patched, status:updated, winner:updated…): không có gì để vẽ → xin
        // snapshot đầy đủ như Android. KHÔNG tính là "payload mới" để socketPayloadStale đúng.
        guard hasInfo(body) else {
            #if DEBUG
            print("[PTLive socket] \(event): patch-only (keys: \(Array(root.keys).sorted().joined(separator: ","))) → xin match:snapshot")
            #endif
            requestSnapshot(reason: "lightweight")
            if let status { onStatusChange?(status) }
            return
        }

        // Gate version: bỏ payload cũ hơn bản đã áp (strict <, bằng thì nhận — Android).
        let version = Self.intValue(root["version"]) ?? Self.intValue(root["liveVersion"])
            ?? Self.intValue(body["version"]) ?? Self.intValue(body["liveVersion"])
        if let version, lastAppliedVersion >= 0, version < lastAppliedVersion {
            #if DEBUG
            print("[PTLive socket] \(event): BỎ — version \(version) < đã áp \(lastAppliedVersion)")
            #endif
            return
        }

        onPayloadTimestamp?(Date())

        // DTO trận giải KHÔNG có scoreA/scoreB → withDerivedLiveState() suy điểm từ
        // gameScores/currentGame/serve đúng như Android (extractCurrentScore).
        var derived: LiveOverlaySnapshot?
        if let snapshot = SocketDecode.decode(LiveOverlaySnapshot.self, from: body) {
            derived = snapshot.withDerivedLiveState()
        } else if let match = SocketDecode.decode(MatchData.self, from: body) {
            derived = LiveOverlaySnapshot(match: match).withDerivedLiveState()
        }
        if let derived {
            if let version { lastAppliedVersion = max(lastAppliedVersion, version) }
            #if DEBUG
            print("[PTLive socket] \(event) v=\(version ?? -1) điểm=\(derived.scoreA ?? -1)-\(derived.scoreB ?? -1) giao=\(derived.serveSide ?? "-")/\(derived.serveCount ?? -1) game=\(derived.currentGame ?? -1)/\((derived.gameScores ?? []).count) A=\(derived.teamAName ?? "-") B=\(derived.teamBName ?? "-") status=\(status ?? "-")")
            #endif
            onOverlaySnapshot?(derived)
        } else {
            #if DEBUG
            print("[PTLive socket] \(event): decode THẤT BẠI cả LiveOverlaySnapshot lẫn MatchData (keys: \(Array(body.keys).sorted().joined(separator: ",")))")
            #endif
        }
        if let status { onStatusChange?(status) }
    }
}

final class CourtRuntimeSocketCoordinator {
    var onClusterUpdate: ((CourtClusterRuntimeResponse) -> Void)?
    var onStationUpdate: ((CourtStationRuntimeResponse) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?
    var onLog: ((String) -> Void)?

    private let tokenProvider: () -> String?
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var token: String?
    private var watchedClusterIds: Set<String> = []
    private var watchedStationIds: Set<String> = []

    init(tokenProvider: @escaping () -> String?) {
        self.tokenProvider = tokenProvider
    }

    func connectIfNeeded() {
        let token = tokenProvider()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else {
            disconnect()
            return
        }

        if
            self.token == token,
            let status = socket?.status,
            status == .connected || status == .connecting
        {
            return
        }

        disconnect()
        self.token = token

        let manager = SocketManager(
            socketURL: LiveAppConfig.socketURL,
            config: [
                .log(false),
                .compress,
                .forceWebsockets(true),
                .path("/socket.io"),
                .extraHeaders(["Authorization": "Bearer \(token)"]),
                .connectParams([
                    "token": token,
                    "authorization": "Bearer \(token)"
                ])
            ]
        )
        let socket = manager.defaultSocket
        configure(socket: socket)
        self.manager = manager
        self.socket = socket
        socket.connect()
    }

    func watchCluster(_ clusterId: String) {
        let clusterId = clusterId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clusterId.isEmpty else { return }
        watchedClusterIds.insert(clusterId)
        connectIfNeeded()
        if socket?.status == .connected {
            socket?.emit("court-cluster:watch", ["clusterId": clusterId])
        }
    }

    func unwatchCluster(_ clusterId: String) {
        let clusterId = clusterId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clusterId.isEmpty else { return }
        watchedClusterIds.remove(clusterId)
        socket?.emit("court-cluster:unwatch", ["clusterId": clusterId])
    }

    func watchStation(_ stationId: String) {
        let stationId = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !stationId.isEmpty else { return }
        watchedStationIds.insert(stationId)
        connectIfNeeded()
        if socket?.status == .connected {
            socket?.emit("court-station:watch", ["stationId": stationId])
        }
    }

    func unwatchStation(_ stationId: String) {
        let stationId = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !stationId.isEmpty else { return }
        watchedStationIds.remove(stationId)
        socket?.emit("court-station:unwatch", ["stationId": stationId])
    }

    func disconnect() {
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager = nil
        socket = nil
        token = nil
        onConnectionChange?(false)
    }

    private func configure(socket: SocketIOClient) {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            guard let self else { return }
            self.onConnectionChange?(true)
            self.watchedClusterIds.forEach { clusterId in
                socket.emit("court-cluster:watch", ["clusterId": clusterId])
            }
            self.watchedStationIds.forEach { stationId in
                socket.emit("court-station:watch", ["stationId": stationId])
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.onConnectionChange?(false)
        }

        socket.on(clientEvent: .error) { [weak self] data, _ in
            self?.onLog?("Court runtime socket error: \(String(describing: data.first))")
        }

        socket.on("court-cluster:update") { [weak self] data, _ in
            if let payload = SocketDecode.decode(CourtClusterRuntimeResponse.self, from: data.first) {
                self?.onClusterUpdate?(payload)
            }
        }

        socket.on("court-station:update") { [weak self] data, _ in
            if let payload = SocketDecode.decode(CourtStationRuntimeResponse.self, from: data.first) {
                self?.onStationUpdate?(payload)
            }
        }
    }
}

final class CourtPresenceSocketCoordinator {
    var onSnapshot: ((CourtLiveWatchSnapshot) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?
    var onLog: ((String) -> Void)?

    private let tokenProvider: () -> String?
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private var token: String?
    private var watchedTournamentId: String?

    init(tokenProvider: @escaping () -> String?) {
        self.tokenProvider = tokenProvider
    }

    func watchTournament(_ tournamentId: String) {
        let tournamentId = tournamentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tournamentId.isEmpty else { return }
        watchedTournamentId = tournamentId
        connectIfNeeded()
        if socket?.status == .connected {
            socket?.emit("court-live:watch", ["tournamentId": tournamentId])
        }
    }

    func unwatchTournament() {
        if let watchedTournamentId {
            socket?.emit("court-live:unwatch", ["tournamentId": watchedTournamentId])
        }
        watchedTournamentId = nil
    }

    func disconnect() {
        if let watchedTournamentId {
            socket?.emit("court-live:unwatch", ["tournamentId": watchedTournamentId])
        }
        socket?.removeAllHandlers()
        socket?.disconnect()
        manager = nil
        socket = nil
        token = nil
        onConnectionChange?(false)
    }

    func connectIfNeeded() {
        let token = tokenProvider()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else {
            disconnect()
            return
        }

        if
            self.token == token,
            let status = socket?.status,
            status == .connected || status == .connecting
        {
            return
        }

        disconnect()
        self.token = token

        let manager = SocketManager(
            socketURL: LiveAppConfig.socketURL,
            config: [
                .log(false),
                .compress,
                .forceWebsockets(true),
                .path("/socket.io"),
                .extraHeaders(["Authorization": "Bearer \(token)"]),
                .connectParams([
                    "token": token,
                    "authorization": "Bearer \(token)"
                ])
            ]
        )
        let socket = manager.defaultSocket
        configure(socket: socket)
        self.manager = manager
        self.socket = socket
        socket.connect()
    }

    private func configure(socket: SocketIOClient) {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            guard let self else { return }
            self.onConnectionChange?(true)
            if let watchedTournamentId = self.watchedTournamentId {
                socket.emit("court-live:watch", ["tournamentId": watchedTournamentId])
            }
        }

        socket.on(clientEvent: .disconnect) { [weak self] _, _ in
            self?.onConnectionChange?(false)
        }

        socket.on(clientEvent: .error) { [weak self] data, _ in
            self?.onLog?("Court presence socket error: \(String(describing: data.first))")
        }

        socket.on("court-live:update") { [weak self] data, _ in
            if let payload = SocketDecode.decode(CourtLiveWatchSnapshot.self, from: data.first) {
                self?.onSnapshot?(payload)
            }
        }
    }
}
