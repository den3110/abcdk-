import AVFoundation
import AppAuth
import Foundation
import Network
import Security
import UIKit

enum LiveAppConfig {
    static var baseURL: URL {
        requiredURL(for: "PTLiveBaseURL", fallback: "https://pickletour.vn/")
    }

    static var socketURL: URL {
        requiredURL(for: "PTLiveSocketURL", fallback: "https://pickletour.vn")
    }

    static var authorizationEndpoint: URL {
        requiredURL(for: "PTLiveAuthorizationEndpoint", fallback: "https://pickletour.vn/oauth/authorize")
    }

    static var tokenEndpoint: URL {
        requiredURL(for: "PTLiveTokenEndpoint", fallback: "https://pickletour.vn/api/oauth/token")
    }

    static var oauthClientId: String {
        plistValue(for: "PTLiveOAuthClientId", fallback: "pickletour-live-app")
    }

    static var oauthRedirectURI: URL {
        requiredURL(for: "PTLiveOAuthRedirectURI", fallback: "pickletour-live://auth")
    }

    static var oauthScope: String {
        plistValue(for: "PTLiveOAuthScope", fallback: "live_app_access")
    }

    static func plistValue(for key: String, fallback: String) -> String {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
            !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return fallback
        }
        return raw
    }

    private static func requiredURL(for key: String, fallback: String) -> URL {
        let rawValue = plistValue(for: key, fallback: fallback)
        if let url = URL(string: rawValue) {
            return url
        }

        if let fallbackURL = URL(string: fallback) {
            assertionFailure("Invalid URL for \(key): \(rawValue). Falling back to \(fallback).")
            return fallbackURL
        }

        assertionFailure("Invalid fallback URL for \(key): \(fallback). Using emergency base URL.")
        return URL(string: "https://pickletour.vn/") ?? URL(fileURLWithPath: "/")
    }
}

enum LiveAPIError: LocalizedError {
    case invalidURL
    case unauthorized
    case invalidResponse
    case server(statusCode: Int, message: String)
    case missingPresenter
    case missingToken
    case missingUploadTarget

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Địa chỉ API không hợp lệ."
        case .unauthorized:
            return "Phiên đăng nhập không còn hợp lệ."
        case .invalidResponse:
            return "Không đọc được phản hồi từ máy chủ."
        case let .server(_, message):
            return message
        case .missingPresenter:
            return "Không tìm thấy màn hình để mở đăng nhập."
        case .missingToken:
            return "Không lấy được access token."
        case .missingUploadTarget:
            return "Thiếu địa chỉ tải tệp lên."
        }
    }
}

private struct APIErrorPayload: Decodable {
    var message: String?
    var error: String?
    var reason: String?
}

final class KeychainStore {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func save<T: Encodable>(_ value: T, for key: String) throws {
        let data = try JSONEncoder().encode(value)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        SecItemDelete(query as CFDictionary)

        var next = query
        next[kSecValueData as String] = data
        let status = SecItemAdd(next as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    func load<T: Decodable>(_ type: T.Type, for key: String) -> T? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder.liveApp.decode(type, from: data)
    }

    func remove(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }
}

final class LiveSessionStore: ObservableObject {
    @Published private(set) var session: AuthSession?

    private let keychain: KeychainStore
    private let storageKey = "auth-session"

    init(keychain: KeychainStore) {
        self.keychain = keychain
        self.session = keychain.load(AuthSession.self, for: storageKey)
    }

    func replace(_ session: AuthSession?) {
        self.session = session
        if let session {
            try? keychain.save(session, for: storageKey)
        } else {
            keychain.remove(storageKey)
        }
    }
}

final class LiveAPIClient {
    private let sessionProvider: () -> String?
    private let urlSession: URLSession

    init(sessionProvider: @escaping () -> String?, urlSession: URLSession = .shared) {
        self.sessionProvider = sessionProvider
        self.urlSession = urlSession
    }

    func getMe() async throws -> UserMe {
        try await request(path: "api/users/me")
    }

    func getBootstrap() async throws -> LiveAppBootstrapResponse {
        try await request(path: "api/live-app/bootstrap")
    }

    func listClusters() async throws -> [CourtClusterData] {
        let response: CourtClusterListResponse = try await request(path: "api/live-app/clusters")
        return response.items
    }

    func listCourts(clusterId: String) async throws -> [AdminCourtData] {
        let response: AdminCourtListResponse = try await request(path: "api/live-app/clusters/\(clusterId)/courts")
        return response.items
    }

    func getCourtRuntime(courtId: String) async throws -> LiveAppCourtRuntimeResponse {
        try await request(path: "api/live-app/courts/\(courtId)/runtime")
    }

    func getNextMatchByCourt(courtId: String, afterMatchId: String? = nil) async throws -> String? {
        let response: NextCourtMatchResponse = try await request(
            path: "api/overlay/courts/\(courtId)/next",
            query: [URLQueryItem(name: "after", value: afterMatchId?.trimmedNilIfBlank)]
        )
        return response.matchId?.trimmedNilIfBlank
    }

    func getMatchInfo(matchId: String) async throws -> MatchData {
        try await request(path: "api/matches/\(matchId)")
    }

    func getMatchRuntime(matchId: String) async throws -> MatchData {
        try await request(path: "api/live-app/matches/\(matchId)/runtime")
    }

    func createLiveSession(matchId: String, pageId: String?, force: Bool = false) async throws -> LiveSession {
        let query = force ? [URLQueryItem(name: "force", value: "1")] : []
        return try await request(
            path: "api/live-app/matches/\(matchId)/live/create",
            method: "POST",
            query: query,
            body: CreateLiveRequest(pageId: pageId?.trimmedNilIfBlank)
        )
    }

    func notifyStreamStarted(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/start",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func notifyStreamHeartbeat(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/heartbeat",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func notifyStreamEnded(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/end",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func startCourtPresence(courtId: String, clientSessionId: String, screenState: String, matchId: String?) async throws -> CourtPresenceResponse {
        try await request(
            path: "api/live-app/courts/\(courtId)/presence/start",
            method: "POST",
            body: CourtPresenceRequest(
                clientSessionId: clientSessionId,
                screenState: screenState,
                matchId: matchId?.trimmedNilIfBlank,
                timestamp: Date().iso8601UTCString
            )
        )
    }

    func heartbeatCourtPresence(courtId: String, clientSessionId: String, screenState: String, matchId: String?) async throws -> CourtPresenceResponse {
        try await request(
            path: "api/live-app/courts/\(courtId)/presence/heartbeat",
            method: "POST",
            body: CourtPresenceRequest(
                clientSessionId: clientSessionId,
                screenState: screenState,
                matchId: matchId?.trimmedNilIfBlank,
                timestamp: Date().iso8601UTCString
            )
        )
    }

    func extendPreview(courtId: String, clientSessionId: String) async throws -> CourtPresenceResponse {
        try await request(
            path: "api/live-app/courts/\(courtId)/presence/extend-preview",
            method: "POST",
            body: CourtPresenceRequest(
                clientSessionId: clientSessionId,
                screenState: nil,
                matchId: nil,
                timestamp: Date().iso8601UTCString
            )
        )
    }

    func endCourtPresence(courtId: String, clientSessionId: String) async throws -> CourtPresenceResponse {
        try await request(
            path: "api/live-app/courts/\(courtId)/presence/end",
            method: "POST",
            body: CourtPresenceRequest(
                clientSessionId: clientSessionId,
                screenState: nil,
                matchId: nil,
                timestamp: Date().iso8601UTCString
            )
        )
    }

    func getOverlaySnapshot(matchId: String) async throws -> LiveOverlaySnapshot {
        try await request(path: "api/overlay/match/\(matchId)")
    }

    func getOverlayConfig(tournamentId: String?) async throws -> OverlayConfig {
        try await request(
            path: "api/public/overlay/config",
            query: [
                URLQueryItem(name: "tournamentId", value: tournamentId?.trimmedNilIfBlank),
                URLQueryItem(name: "limit", value: "12"),
                URLQueryItem(name: "featured", value: "1")
            ],
            requiresAuth: false
        )
    }

    func startRecording(_ body: StartMatchRecordingRequest) async throws -> MatchRecordingResponse {
        try await request(path: "api/live/recordings/v2/start", method: "POST", body: body)
    }

    func presignSegment(_ body: RecordingSegmentPresignRequest) async throws -> RecordingSegmentPresignResponse {
        try await request(path: "api/live/recordings/v2/segments/presign", method: "POST", body: body)
    }

    func completeSegment(_ body: RecordingSegmentCompleteRequest) async throws -> MatchRecordingResponse {
        try await request(path: "api/live/recordings/v2/segments/complete", method: "POST", body: body)
    }

    func startMultipartSegment(_ body: RecordingMultipartStartRequest) async throws -> RecordingMultipartStartResponse {
        try await request(path: "api/live/recordings/v2/segments/multipart/start", method: "POST", body: body)
    }

    func getMultipartPartURL(_ body: RecordingMultipartPartURLRequest) async throws -> RecordingMultipartPartURLResponse {
        try await request(path: "api/live/recordings/v2/segments/multipart/part-url", method: "POST", body: body)
    }

    func reportMultipartProgress(_ body: RecordingMultipartProgressRequest) async throws -> MatchRecordingResponse {
        try await request(path: "api/live/recordings/v2/segments/multipart/progress", method: "POST", body: body)
    }

    func completeMultipartSegment(_ body: RecordingMultipartCompleteRequest) async throws -> MatchRecordingResponse {
        try await request(path: "api/live/recordings/v2/segments/multipart/complete", method: "POST", body: body)
    }

    func finalizeRecording(recordingId: String) async throws -> MatchRecordingResponse {
        try await request(
            path: "api/live/recordings/v2/finalize",
            method: "POST",
            body: FinalizeMatchRecordingRequest(recordingId: recordingId)
        )
    }

    func recordingByMatch(matchId: String) async throws -> MatchRecordingResponse {
        try await request(path: "api/live/recordings/v2/by-match/\(matchId)")
    }

    private func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        requiresAuth: Bool = true
    ) async throws -> Response {
        let request = try buildRequest(path: path, method: method, query: query, bodyData: nil, requiresAuth: requiresAuth)
        let (data, response) = try await urlSession.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Body,
        requiresAuth: Bool = true
    ) async throws -> Response {
        let request = try buildRequest(
            path: path,
            method: method,
            query: query,
            bodyData: try JSONEncoder.liveApp.encode(body),
            requiresAuth: requiresAuth
        )
        let (data, response) = try await urlSession.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func decodeResponse<Response: Decodable>(data: Data, response: URLResponse) throws -> Response {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LiveAPIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw LiveAPIError.unauthorized
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            let payload = try? JSONDecoder.liveApp.decode(APIErrorPayload.self, from: data)
            let message = payload?.message ?? payload?.error ?? payload?.reason ?? "Máy chủ trả về lỗi \(httpResponse.statusCode)."
            throw LiveAPIError.server(statusCode: httpResponse.statusCode, message: message)
        }

        do {
            return try JSONDecoder.liveApp.decode(Response.self, from: data)
        } catch {
            throw LiveAPIError.invalidResponse
        }
    }

    private func buildRequest(
        path: String,
        method: String,
        query: [URLQueryItem],
        bodyData: Data?,
        requiresAuth: Bool
    ) throws -> URLRequest {
        guard var components = URLComponents(url: LiveAppConfig.baseURL, resolvingAgainstBaseURL: false) else {
            throw LiveAPIError.invalidURL
        }

        let prefix = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        let cleanedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        components.path = "\(prefix)/\(cleanedPath)"
        components.queryItems = query.compactMap { item in
            guard let value = item.value?.trimmedNilIfBlank else { return nil }
            return URLQueryItem(name: item.name, value: value)
        }

        guard let url = components.url else {
            throw LiveAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if requiresAuth {
            guard let token = sessionProvider()?.trimmedNilIfBlank else {
                throw LiveAPIError.unauthorized
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let bodyData {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = bodyData
        }

        return request
    }
}

final class LiveAppAuthCoordinator: NSObject {
    private var currentAuthorizationFlow: OIDExternalUserAgentSession?

    func handleOpenURL(_ url: URL) -> Bool {
        guard let currentAuthorizationFlow else { return false }
        let handled = currentAuthorizationFlow.resumeExternalUserAgentFlow(with: url)
        if handled {
            self.currentAuthorizationFlow = nil
        }
        return handled
    }

    @MainActor
    func signIn(osAuthToken: String? = nil) async throws -> AuthSession {
        guard let presenter = UIApplication.shared.topViewController() else {
            throw LiveAPIError.missingPresenter
        }

        let config = OIDServiceConfiguration(
            authorizationEndpoint: LiveAppConfig.authorizationEndpoint,
            tokenEndpoint: LiveAppConfig.tokenEndpoint
        )

        var additionalParameters: [String: String] = [:]
        if let osAuthToken = osAuthToken?.trimmedNilIfBlank {
            additionalParameters["os_auth_token"] = osAuthToken
        }

        let request = OIDAuthorizationRequest(
            configuration: config,
            clientId: LiveAppConfig.oauthClientId,
            clientSecret: nil,
            scopes: LiveAppConfig.oauthScope.split(separator: " ").map(String.init),
            redirectURL: LiveAppConfig.oauthRedirectURI,
            responseType: OIDResponseTypeCode,
            additionalParameters: additionalParameters.isEmpty ? nil : additionalParameters
        )

        return try await withCheckedThrowingContinuation { continuation in
            self.currentAuthorizationFlow = OIDAuthState.authState(
                byPresenting: request,
                presenting: presenter
            ) { authState, error in
                self.currentAuthorizationFlow = nil

                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let authState else {
                    continuation.resume(throwing: LiveAPIError.missingToken)
                    return
                }

                let token = authState.lastTokenResponse?.accessToken?.trimmedNilIfBlank
                    ?? authState.accessToken?.trimmedNilIfBlank

                guard let accessToken = token else {
                    continuation.resume(throwing: LiveAPIError.missingToken)
                    return
                }

                continuation.resume(
                    returning: AuthSession(
                        accessToken: accessToken,
                        refreshToken: authState.lastTokenResponse?.refreshToken,
                        idToken: authState.lastTokenResponse?.idToken,
                        userId: nil,
                        displayName: nil
                    )
                )
            }
        }
    }
}

actor LiveRecordingUploadCoordinator {
    private let apiClient: LiveAPIClient
    private let urlSession: URLSession
    private let multipartThresholdBytes: Int64 = 8 * 1024 * 1024
    private let multipartChunkBytes: Int = 8 * 1024 * 1024

    init(apiClient: LiveAPIClient, urlSession: URLSession = .shared) {
        self.apiClient = apiClient
        self.urlSession = urlSession
    }

    func uploadSegment(recordingId: String, fileURL: URL) async throws -> MatchRecordingResponse {
        let size = try fileURL.fileSizeBytes()
        if size >= multipartThresholdBytes {
            return try await uploadMultipartSegment(recordingId: recordingId, fileURL: fileURL)
        }
        return try await uploadSinglePartSegment(recordingId: recordingId, fileURL: fileURL)
    }

    func uploadSinglePartSegment(recordingId: String, fileURL: URL) async throws -> MatchRecordingResponse {
        let fileName = fileURL.lastPathComponent
        let size = try fileURL.fileSizeBytes()
        let duration = fileURL.mediaDurationSeconds()
        let presign = try await apiClient.presignSegment(
            RecordingSegmentPresignRequest(
                recordingId: recordingId,
                fileName: fileName,
                contentType: "video/mp4",
                durationSeconds: duration,
                bytes: size
            )
        )

        guard let uploadURLString = presign.uploadURL, let uploadURL = URL(string: uploadURLString), let segmentId = presign.segmentId else {
            throw LiveAPIError.missingUploadTarget
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        _ = try await urlSession.upload(for: request, fromFile: fileURL)

        let response = try await apiClient.completeSegment(
            RecordingSegmentCompleteRequest(
                recordingId: recordingId,
                segmentId: segmentId,
                bytes: size,
                durationSeconds: duration
            )
        )
        try? FileManager.default.removeItem(at: fileURL)
        return response
    }

    private func uploadMultipartSegment(recordingId: String, fileURL: URL) async throws -> MatchRecordingResponse {
        let fileName = fileURL.lastPathComponent
        let size = try fileURL.fileSizeBytes()
        let duration = fileURL.mediaDurationSeconds()
        let started = try await apiClient.startMultipartSegment(
            RecordingMultipartStartRequest(
                recordingId: recordingId,
                fileName: fileName,
                contentType: "video/mp4",
                bytes: size
            )
        )

        guard
            let segmentId = started.segmentId?.trimmedNilIfBlank,
            let uploadId = started.uploadId?.trimmedNilIfBlank
        else {
            throw LiveAPIError.missingUploadTarget
        }

        let handle = try FileHandle(forReadingFrom: fileURL)
        defer {
            try? handle.close()
        }

        var parts: [RecordingMultipartPartETag] = []
        var uploadedBytes: Int64 = 0
        var partNumber = 1

        while true {
            let chunk = try handle.read(upToCount: multipartChunkBytes) ?? Data()
            if chunk.isEmpty {
                break
            }

            let uploadPart = try await apiClient.getMultipartPartURL(
                RecordingMultipartPartURLRequest(
                    recordingId: recordingId,
                    segmentId: segmentId,
                    uploadId: uploadId,
                    partNumber: partNumber
                )
            )

            guard let uploadURLString = uploadPart.uploadURL, let uploadURL = URL(string: uploadURLString) else {
                throw LiveAPIError.missingUploadTarget
            }

            var request = URLRequest(url: uploadURL)
            request.httpMethod = "PUT"
            request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")

            let (_, response) = try await urlSession.upload(for: request, from: chunk)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw LiveAPIError.invalidResponse
            }

            let etag = httpResponse.value(forHTTPHeaderField: "ETag")?
                .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                .trimmedNilIfBlank

            guard let etag else {
                throw LiveAPIError.invalidResponse
            }

            parts.append(RecordingMultipartPartETag(partNumber: partNumber, etag: etag))
            uploadedBytes += Int64(chunk.count)

            _ = try? await apiClient.reportMultipartProgress(
                RecordingMultipartProgressRequest(
                    recordingId: recordingId,
                    segmentId: segmentId,
                    uploadedBytes: uploadedBytes
                )
            )

            partNumber += 1
        }

        let response = try await apiClient.completeMultipartSegment(
            RecordingMultipartCompleteRequest(
                recordingId: recordingId,
                segmentId: segmentId,
                uploadId: uploadId,
                parts: parts,
                bytes: size,
                durationSeconds: duration
            )
        )
        try? FileManager.default.removeItem(at: fileURL)
        return response
    }
}

final class LiveAppEnvironment {
    static let shared = LiveAppEnvironment()

    let keychain = KeychainStore(service: "com.pkt.pickletour.live")
    let sessionStore: LiveSessionStore
    let authCoordinator: LiveAppAuthCoordinator
    let apiClient: LiveAPIClient
    let matchSocket: MatchSocketCoordinator
    let courtRuntimeSocket: CourtRuntimeSocketCoordinator
    let courtPresenceSocket: CourtPresenceSocketCoordinator
    let recordingCoordinator: LiveRecordingUploadCoordinator
    let networkMonitor: LiveNetworkMonitor
    let deviceMonitor: LiveDeviceMonitor

    private init() {
        sessionStore = LiveSessionStore(keychain: keychain)
        networkMonitor = LiveNetworkMonitor()
        deviceMonitor = LiveDeviceMonitor()
        apiClient = LiveAPIClient(sessionProvider: { [weak sessionStore] in
            sessionStore?.session?.accessToken
        })
        authCoordinator = LiveAppAuthCoordinator()
        matchSocket = MatchSocketCoordinator(tokenProvider: { [weak sessionStore] in
            sessionStore?.session?.accessToken
        })
        courtRuntimeSocket = CourtRuntimeSocketCoordinator(tokenProvider: { [weak sessionStore] in
            sessionStore?.session?.accessToken
        })
        courtPresenceSocket = CourtPresenceSocketCoordinator(tokenProvider: { [weak sessionStore] in
            sessionStore?.session?.accessToken
        })
        recordingCoordinator = LiveRecordingUploadCoordinator(apiClient: apiClient)
    }
}

final class LiveNetworkMonitor: ObservableObject {
    @Published private(set) var isConnected = true
    @Published private(set) var isWiFi = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "PickleTourLive.NetworkMonitor")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.isConnected = path.status == .satisfied
                self?.isWiFi = path.usesInterfaceType(.wifi)
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

final class LiveDeviceMonitor: ObservableObject {
    @Published private(set) var batteryLevel = UIDevice.current.batteryLevel
    @Published private(set) var batteryState = UIDevice.current.batteryState
    @Published private(set) var lowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
    @Published private(set) var thermalState = ProcessInfo.processInfo.thermalState

    private var observers: [NSObjectProtocol] = []

    init(notificationCenter: NotificationCenter = .default) {
        UIDevice.current.isBatteryMonitoringEnabled = true
        refresh()

        observers.append(
            notificationCenter.addObserver(
                forName: UIDevice.batteryLevelDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refresh()
            }
        )

        observers.append(
            notificationCenter.addObserver(
                forName: UIDevice.batteryStateDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refresh()
            }
        )

        observers.append(
            notificationCenter.addObserver(
                forName: .NSProcessInfoPowerStateDidChange,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refresh()
            }
        )

        observers.append(
            notificationCenter.addObserver(
                forName: ProcessInfo.thermalStateDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.refresh()
            }
        )
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    func refresh() {
        batteryLevel = UIDevice.current.batteryLevel
        batteryState = UIDevice.current.batteryState
        lowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalState = ProcessInfo.processInfo.thermalState
    }
}

private extension JSONDecoder {
    static let liveApp: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()
}

private extension JSONEncoder {
    static let liveApp: JSONEncoder = {
        let encoder = JSONEncoder()
        return encoder
    }()
}

private extension UIApplication {
    func topViewController(
        base: UIViewController? = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController
    ) -> UIViewController? {
        if let navigation = base as? UINavigationController {
            return topViewController(base: navigation.visibleViewController)
        }
        if let tab = base as? UITabBarController, let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }
}

private extension URL {
    func fileSizeBytes() throws -> Int64 {
        let values = try resourceValues(forKeys: [.fileSizeKey])
        return Int64(values.fileSize ?? 0)
    }

    func mediaDurationSeconds() -> Double {
        let asset = AVURLAsset(url: self)
        let seconds = CMTimeGetSeconds(asset.duration)
        return seconds.isFinite ? seconds : 0
    }
}
