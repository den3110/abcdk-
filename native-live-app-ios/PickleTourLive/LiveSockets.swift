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
        return try? JSONDecoder().decode(type, from: data)
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

    init(tokenProvider: @escaping () -> String?) {
        self.tokenProvider = tokenProvider
    }

    func connectIfNeeded() {
        let token = tokenProvider()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else {
            disconnect()
            return
        }

        if self.token == token, socket?.status == .connected || socket?.status == .connecting {
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
            self.onActiveMatchChange?(self.joinedMatchId)
        }

        for event in ["match:snapshot", "score:updated", "score:update", "match:update", "match:patched", "status:updated", "winner:updated"] {
            socket.on(event) { [weak self] data, _ in
                self?.handleMatchPayload(data.first)
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

    private func handleMatchPayload(_ payload: Any?) {
        onPayloadTimestamp?(Date())

        if let snapshot = SocketDecode.decode(LiveOverlaySnapshot.self, from: payload) {
            onOverlaySnapshot?(snapshot)
        } else if let match = SocketDecode.decode(MatchData.self, from: payload) {
            onOverlaySnapshot?(LiveOverlaySnapshot(match: match))
            onStatusChange?(match.status)
        }

        if let body = payload as? [String: Any], let status = body["status"] as? String {
            onStatusChange?(status)
        }
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

        if self.token == token, socket?.status == .connected || socket?.status == .connecting {
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

    private func connectIfNeeded() {
        let token = tokenProvider()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !token.isEmpty else {
            disconnect()
            return
        }

        if self.token == token, socket?.status == .connected || socket?.status == .connecting {
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
