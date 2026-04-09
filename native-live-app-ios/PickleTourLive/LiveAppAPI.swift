import AVFoundation
import AppAuth
import Foundation
import Network
import Security
import UIKit

enum LiveAppConfig {
    static var baseURL: URL {
        requiredURL(for: "PTLiveBaseURL", fallback: "https://pickletour.vn/api/")
    }

    static var observerBaseURL: URL? {
        optionalURL(for: "PTLiveObserverBaseURL")
    }

    static var socketURL: URL {
        requiredURL(for: "PTLiveSocketURL", fallback: "https://pickletour.vn")
    }

    static var authorizationEndpoint: URL {
        requiredURL(for: "PTLiveAuthorizationEndpoint", fallback: "https://pickletour.vn/api/api/oauth/authorize")
    }

    static var tokenEndpoint: URL {
        requiredURL(for: "PTLiveTokenEndpoint", fallback: "https://pickletour.vn/api/api/oauth/token")
    }

    static var oauthClientId: String {
        plistValue(for: "PTLiveOAuthClientId", fallback: "pickletour-live-app")
    }

    static var oauthRedirectURI: URL {
        requiredURL(for: "PTLiveOAuthRedirectURI", fallback: "pickletour-live://auth")
    }

    static var oauthScope: String {
        plistValue(for: "PTLiveOAuthScope", fallback: "openid profile")
    }

    static var oauthApproveEndpoint: URL {
        requiredURL(for: "PTLiveOAuthApproveEndpoint", fallback: "https://pickletour.vn/api/api/oauth/authorize/approve")
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

    private static func optionalURL(for key: String) -> URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(string: trimmed)
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
    case missingAuthorizationCode
    case invalidAuthorizationState

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
        case .missingAuthorizationCode:
            return "Không nhận được mã xác thực từ máy chủ."
        case .invalidAuthorizationState:
            return "Phiên xác thực không còn khớp, hãy thử đăng nhập lại."
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

    func loginWithPassword(_ body: LivePasswordLoginRequest) async throws -> LivePasswordLoginResponse {
        try await request(path: "api/users/auth", method: "POST", body: body, requiresAuth: false)
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

    func getMatchRuntime(matchId: String, userMatch: Bool) async throws -> MatchData {
        try await request(
            path: "api/live-app/matches/\(matchId)/runtime",
            extraHeaders: userMatch ? ["x-pkt-match-kind": "user"] : [:]
        )
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

    func createLiveSession(
        matchId: String,
        pageId: String?,
        force: Bool = false,
        userMatch: Bool
    ) async throws -> LiveSession {
        let query = force ? [URLQueryItem(name: "force", value: "1")] : []
        return try await request(
            path: "api/live-app/matches/\(matchId)/live/create",
            method: "POST",
            query: query,
            body: CreateLiveRequest(pageId: pageId?.trimmedNilIfBlank),
            extraHeaders: userMatch ? ["x-pkt-match-kind": "user"] : [:]
        )
    }

    func notifyStreamStarted(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/start",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func notifyStreamStarted(
        matchId: String,
        clientSessionId: String,
        userMatch: Bool
    ) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/start",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId),
            extraHeaders: userMatch ? ["x-pkt-match-kind": "user"] : [:]
        )
    }

    func notifyStreamHeartbeat(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/heartbeat",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func notifyStreamHeartbeat(
        matchId: String,
        clientSessionId: String,
        userMatch: Bool
    ) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/heartbeat",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId),
            extraHeaders: userMatch ? ["x-pkt-match-kind": "user"] : [:]
        )
    }

    func notifyStreamEnded(matchId: String, clientSessionId: String) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/end",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId)
        )
    }

    func notifyStreamEnded(
        matchId: String,
        clientSessionId: String,
        userMatch: Bool
    ) async throws -> StreamNotifyResponse {
        try await request(
            path: "api/matches/\(matchId)/live/end",
            method: "POST",
            body: StreamNotifyRequest(timestamp: Date().iso8601UTCString, clientSessionId: clientSessionId),
            extraHeaders: userMatch ? ["x-pkt-match-kind": "user"] : [:]
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

    func sendObserverDeviceHeartbeat(_ body: LiveDeviceHeartbeatRequest) async throws -> ObserverIngestResponse {
        try await observerRequest(
            path: "api/observer/ingest/live-devices/heartbeat",
            method: "POST",
            body: body
        )
    }

    func sendObserverDeviceEvent(_ body: LiveDeviceEventRequest) async throws -> ObserverIngestResponse {
        try await observerRequest(
            path: "api/observer/ingest/live-devices/event",
            method: "POST",
            body: body
        )
    }

    private func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        requiresAuth: Bool = true,
        extraHeaders: [String: String] = [:]
    ) async throws -> Response {
        let request = try buildRequest(
            baseURL: LiveAppConfig.baseURL,
            path: path,
            method: method,
            query: query,
            bodyData: nil,
            requiresAuth: requiresAuth,
            extraHeaders: extraHeaders
        )
        let (data, response) = try await urlSession.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Body,
        requiresAuth: Bool = true,
        extraHeaders: [String: String] = [:]
    ) async throws -> Response {
        let request = try buildRequest(
            baseURL: LiveAppConfig.baseURL,
            path: path,
            method: method,
            query: query,
            bodyData: try JSONEncoder.liveApp.encode(body),
            requiresAuth: requiresAuth,
            extraHeaders: extraHeaders
        )
        let (data, response) = try await urlSession.data(for: request)
        return try decodeResponse(data: data, response: response)
    }

    private func observerRequest<Response: Decodable, Body: Encodable>(
        path: String,
        method: String = "POST",
        body: Body,
        extraHeaders: [String: String] = [:]
    ) async throws -> Response {
        guard let observerBaseURL = LiveAppConfig.observerBaseURL else {
            throw LiveAPIError.invalidURL
        }

        let request = try buildRequest(
            baseURL: observerBaseURL,
            path: path,
            method: method,
            query: [],
            bodyData: try JSONEncoder.liveApp.encode(body),
            requiresAuth: true,
            extraHeaders: extraHeaders
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
        } catch let decodingError as DecodingError {
            print("DECODE ERROR: \(decodingError)")
            throw LiveAPIError.server(statusCode: httpResponse.statusCode, message: "Decode Error: \(decodingError)")
        } catch {
            throw LiveAPIError.invalidResponse
        }
    }

    private func buildRequest(
        baseURL: URL,
        path: String,
        method: String,
        query: [URLQueryItem],
        bodyData: Data?,
        requiresAuth: Bool,
        extraHeaders: [String: String]
    ) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
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

        for (header, value) in extraHeaders where !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue(value, forHTTPHeaderField: header)
        }

        return request
    }
}

final class LiveAppAuthCoordinator: NSObject {
    private var currentAuthorizationFlow: OIDExternalUserAgentSession?
    private var pendingAuthorizationRequest: OIDAuthorizationRequest?
    private let urlSession: URLSession

    override init() {
        self.urlSession = .shared
        super.init()
    }

    func handleOpenURL(_ url: URL) -> Bool {
        guard let currentAuthorizationFlow else { return false }
        let handled = currentAuthorizationFlow.resumeExternalUserAgentFlow(with: url)
        if handled {
            self.currentAuthorizationFlow = nil
        }
        return handled
    }

    func prepareAuthorizationRequestURL() -> URL {
        let request = buildAuthorizationRequest()
        pendingAuthorizationRequest = request
        return request.authorizationRequestURL()
    }

    @MainActor
    func cancelInteractiveAuthorizationFlow() {
        pendingAuthorizationRequest = nil
        currentAuthorizationFlow?.cancel()
        currentAuthorizationFlow = nil
    }

    @MainActor
    func signIn(osAuthToken: String? = nil) async throws -> AuthSession {
        if let osAuthToken = osAuthToken?.trimmedNilIfBlank {
            return try await signInWithOsAuthToken(osAuthToken)
        }

        let request = pendingAuthorizationRequest ?? buildAuthorizationRequest()
        pendingAuthorizationRequest = request

        guard let presenter = UIApplication.shared.topViewController() else {
            throw LiveAPIError.missingPresenter
        }

        defer {
            pendingAuthorizationRequest = nil
        }

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

    private func buildAuthorizationRequest(osAuthToken: String? = nil) -> OIDAuthorizationRequest {
        let config = OIDServiceConfiguration(
            authorizationEndpoint: LiveAppConfig.authorizationEndpoint,
            tokenEndpoint: LiveAppConfig.tokenEndpoint
        )

        var additionalParameters: [String: String] = [:]
        if let osAuthToken = osAuthToken?.trimmedNilIfBlank {
            additionalParameters["os_auth_token"] = osAuthToken
        }

        return OIDAuthorizationRequest(
            configuration: config,
            clientId: LiveAppConfig.oauthClientId,
            clientSecret: nil,
            scopes: LiveAppConfig.oauthScope.split(separator: " ").map(String.init),
            redirectURL: LiveAppConfig.oauthRedirectURI,
            responseType: OIDResponseTypeCode,
            additionalParameters: additionalParameters.isEmpty ? nil : additionalParameters
        )
    }

    private func signInWithOsAuthToken(_ token: String) async throws -> AuthSession {
        let request = pendingAuthorizationRequest ?? buildAuthorizationRequest()
        pendingAuthorizationRequest = request
        defer {
            pendingAuthorizationRequest = nil
        }

        let redirectURL = try await approveAuthorizationRequest(request, osAuthToken: token)
        let components = URLComponents(url: redirectURL, resolvingAgainstBaseURL: false)
        let code = components?
            .queryItems?
            .first(where: { $0.name == "code" })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let state = components?
            .queryItems?
            .first(where: { $0.name == "state" })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard let code, !code.isEmpty else {
            throw LiveAPIError.missingAuthorizationCode
        }
        guard state == request.state else {
            throw LiveAPIError.invalidAuthorizationState
        }

        let tokenResponse = try await exchangeAuthorizationCode(code: code, request: request)
        guard let accessToken = tokenResponse.accessToken?.trimmedNilIfBlank else {
            throw LiveAPIError.missingToken
        }

        return AuthSession(
            accessToken: accessToken,
            refreshToken: tokenResponse.refreshToken?.trimmedNilIfBlank,
            idToken: tokenResponse.idToken?.trimmedNilIfBlank,
            userId: nil,
            displayName: nil
        )
    }

    private func approveAuthorizationRequest(
        _ request: OIDAuthorizationRequest,
        osAuthToken: String
    ) async throws -> URL {
        guard let redirectURL = request.redirectURL else {
            throw LiveAPIError.invalidURL
        }

        let requestBody = OAuthApproveRequest(
            clientID: request.clientID,
            redirectURI: redirectURL.absoluteString,
            responseType: request.responseType,
            scope: request.scope ?? LiveAppConfig.oauthScope,
            state: request.state ?? "",
            codeChallenge: request.codeChallenge ?? "",
            codeChallengeMethod: request.codeChallengeMethod ?? "",
            osAuthToken: osAuthToken
        )

        var urlRequest = URLRequest(url: LiveAppConfig.oauthApproveEndpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder.liveApp.encode(requestBody)

        let (data, response) = try await urlSession.data(for: urlRequest)
        let payload = try decodeJSON(OAuthApproveResponse.self, from: data, response: response)

        guard let redirectTo = payload.redirectTo?.trimmedNilIfBlank, let redirectURL = URL(string: redirectTo) else {
            throw LiveAPIError.invalidResponse
        }
        return redirectURL
    }

    private func exchangeAuthorizationCode(
        code: String,
        request: OIDAuthorizationRequest
    ) async throws -> OAuthTokenResponse {
        guard let redirectURL = request.redirectURL else {
            throw LiveAPIError.invalidURL
        }
        guard let codeVerifier = request.codeVerifier?.trimmedNilIfBlank else {
            throw LiveAPIError.invalidResponse
        }

        var bodyComponents = URLComponents()
        bodyComponents.queryItems = [
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: request.clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURL.absoluteString),
            URLQueryItem(name: "code_verifier", value: codeVerifier)
        ]

        var urlRequest = URLRequest(url: LiveAppConfig.tokenEndpoint)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue("application/x-www-form-urlencoded; charset=utf-8", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = bodyComponents.percentEncodedQuery?.data(using: .utf8)

        let (data, response) = try await urlSession.data(for: urlRequest)
        return try decodeJSON(OAuthTokenResponse.self, from: data, response: response)
    }

    private func decodeJSON<Response: Decodable>(
        _ type: Response.Type,
        from data: Data,
        response: URLResponse
    ) throws -> Response {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LiveAPIError.invalidResponse
        }

        if (200..<300).contains(httpResponse.statusCode) {
            do {
                return try JSONDecoder.liveApp.decode(type, from: data)
            } catch let decodingError as DecodingError {
                print("DECODE ERROR: \(decodingError)")
                throw LiveAPIError.server(statusCode: httpResponse.statusCode, message: "Decode \(type) Error: \(decodingError)")
            }
        }

        if let apiError = try? JSONDecoder.liveApp.decode(OAuthErrorResponse.self, from: data) {
            let message =
                apiError.message?.trimmedNilIfBlank ??
                apiError.errorDescription?.trimmedNilIfBlank ??
                apiError.reason?.trimmedNilIfBlank ??
                apiError.error?.trimmedNilIfBlank ??
                HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw LiveAPIError.server(statusCode: httpResponse.statusCode, message: message)
        }

        throw LiveAPIError.server(
            statusCode: httpResponse.statusCode,
            message: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
        )
    }
}

private struct OAuthApproveRequest: Encodable {
    let clientID: String
    let redirectURI: String
    let responseType: String
    let scope: String
    let state: String
    let codeChallenge: String
    let codeChallengeMethod: String
    let osAuthToken: String

    enum CodingKeys: String, CodingKey {
        case clientID = "client_id"
        case redirectURI = "redirect_uri"
        case responseType = "response_type"
        case scope
        case state
        case codeChallenge = "code_challenge"
        case codeChallengeMethod = "code_challenge_method"
        case osAuthToken = "os_auth_token"
    }
}

private struct OAuthApproveResponse: Decodable {
    let redirectTo: String?
    let message: String?
    let reason: String?
}

private struct OAuthTokenResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let idToken: String?
    let tokenType: String?
    let expiresIn: Int?
    let scope: String?
    let error: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case scope
        case error
        case errorDescription = "error_description"
    }
}

private struct OAuthErrorResponse: Decodable {
    let message: String?
    let reason: String?
    let error: String?
    let errorDescription: String?

    enum CodingKeys: String, CodingKey {
        case message
        case reason
        case error
        case errorDescription = "error_description"
    }
}

actor LiveRecordingUploadCoordinator {
    private let apiClient: LiveAPIClient
    private let urlSession: URLSession
    private let fileManager: FileManager
    private let multipartThresholdBytes: Int64 = 8 * 1024 * 1024
    private let multipartChunkBytes: Int = 8 * 1024 * 1024
    private let queueRootDirectory: URL
    private let queueSegmentsDirectory: URL
    private let manifestFileURL: URL
    private var manifest: RecordingQueueManifest
    private var inFlightSegmentIDs = Set<String>()
    private var inFlightFinalizeIDs = Set<String>()

    var onQueueSnapshotChange: (@MainActor @Sendable (RecordingQueueSnapshot) -> Void)?
    var onRecordingUpdate: (@MainActor @Sendable (MatchRecording) -> Void)?
    var onError: (@MainActor @Sendable (String) -> Void)?

    init(apiClient: LiveAPIClient, urlSession: URLSession = .shared, fileManager: FileManager = .default) {
        self.apiClient = apiClient
        self.urlSession = urlSession
        self.fileManager = fileManager

        let rootDirectory = Self.resolveQueueRootDirectory(fileManager: fileManager)
        let segmentsDirectory = rootDirectory.appendingPathComponent("segments", isDirectory: true)
        let manifestFileURL = rootDirectory.appendingPathComponent("queue-manifest.json")

        try? fileManager.createDirectory(at: rootDirectory, withIntermediateDirectories: true, attributes: nil)
        try? fileManager.createDirectory(at: segmentsDirectory, withIntermediateDirectories: true, attributes: nil)

        self.queueRootDirectory = rootDirectory
        self.queueSegmentsDirectory = segmentsDirectory
        self.manifestFileURL = manifestFileURL
        self.manifest = Self.loadManifest(from: manifestFileURL)
    }

    func setCallbacks(
        onQueueSnapshotChange: (@MainActor @Sendable (RecordingQueueSnapshot) -> Void)?,
        onRecordingUpdate: (@MainActor @Sendable (MatchRecording) -> Void)?,
        onError: (@MainActor @Sendable (String) -> Void)?
    ) {
        self.onQueueSnapshotChange = onQueueSnapshotChange
        self.onRecordingUpdate = onRecordingUpdate
        self.onError = onError
    }

    func restorePersistedQueue() async -> RecordingQueueSnapshot {
        manifest = Self.loadManifest(from: manifestFileURL)
        manifest.pendingSegments = manifest.pendingSegments.filter { segment in
            fileManager.fileExists(atPath: segment.filePath)
        }
        persistManifest()
        publishSnapshot()
        return queueSnapshot()
    }

    func queueSnapshot() -> RecordingQueueSnapshot {
        RecordingQueueSnapshot(
            pendingSegments: manifest.pendingSegments,
            pendingFinalizations: manifest.pendingFinalizations,
            pendingQueueBytes: manifest.pendingSegments.reduce(Int64(0)) { partial, segment in
                partial + max(0, segment.sizeBytes - segment.uploadedBytes)
            }
        )
    }

    @discardableResult
    func enqueueSegment(_ segment: LocalRecordingSegment) async throws -> RecordingQueueSnapshot {
        let persistedURL = try persistSegmentFile(segment)
        let size = try persistedURL.fileSizeBytes()

        let pending = PendingRecordingSegment(
            recordingId: segment.recordingId,
            matchId: segment.matchId,
            segmentIndex: segment.segmentIndex,
            filePath: persistedURL.path,
            fileName: persistedURL.lastPathComponent,
            durationSeconds: segment.durationSeconds,
            sizeBytes: size,
            isFinal: segment.isFinal,
            uploadMode: size >= multipartThresholdBytes ? "multipart" : "single",
            segmentId: nil,
            uploadId: nil,
            objectKey: nil,
            uploadedBytes: 0,
            parts: [],
            lastError: nil,
            createdAtMs: Self.nowMs()
        )

        manifest.pendingSegments.removeAll { $0.id == pending.id }
        manifest.pendingSegments.append(pending)

        if segment.isFinal {
            let finalize = PendingFinalizeRecording(recordingId: segment.recordingId, matchId: segment.matchId)
            if !manifest.pendingFinalizations.contains(finalize) {
                manifest.pendingFinalizations.append(finalize)
            }
        }

        persistManifest()
        publishSnapshot()
        return queueSnapshot()
    }

    @discardableResult
    func resumePendingUploads() async -> [MatchRecording] {
        var updatedRecordings: [MatchRecording] = []

        while let nextSegment = nextPendingSegment() {
            if Task.isCancelled { break }
            guard !inFlightSegmentIDs.contains(nextSegment.id) else { break }

            inFlightSegmentIDs.insert(nextSegment.id)
            do {
                let response = try await uploadPendingSegment(nextSegment)
                if let recording = response.recording {
                    updatedRecordings.append(recording)
                    publishRecordingUpdate(recording)
                }
                inFlightSegmentIDs.remove(nextSegment.id)
                removePendingSegment(nextSegment.id)
            } catch {
                inFlightSegmentIDs.remove(nextSegment.id)
                markSegmentError(nextSegment.id, message: error.localizedDescription)
                publishError(error.localizedDescription)
                break
            }
        }

        let finalizations = manifest.pendingFinalizations
        for finalize in finalizations {
            if Task.isCancelled { break }
            guard !manifest.pendingSegments.contains(where: { $0.recordingId == finalize.recordingId }) else {
                continue
            }
            guard !inFlightFinalizeIDs.contains(finalize.id) else { continue }

            inFlightFinalizeIDs.insert(finalize.id)
            do {
                if let recording = try await finalizeRecordingIfPossible(finalize) {
                    updatedRecordings.append(recording)
                    publishRecordingUpdate(recording)
                }
                inFlightFinalizeIDs.remove(finalize.id)
                removePendingFinalize(finalize.id)
            } catch {
                inFlightFinalizeIDs.remove(finalize.id)
                publishError(error.localizedDescription)
            }
        }

        publishSnapshot()
        return updatedRecordings
    }

    func finalizeWhenReady(recordingId: String, matchId: String) async throws -> MatchRecording? {
        let finalize = PendingFinalizeRecording(recordingId: recordingId, matchId: matchId)
        if !manifest.pendingFinalizations.contains(finalize) {
            manifest.pendingFinalizations.append(finalize)
            persistManifest()
            publishSnapshot()
        }

        guard !manifest.pendingSegments.contains(where: { $0.recordingId == recordingId }) else {
            return nil
        }

        let recording = try await finalizeRecordingIfPossible(finalize)
        removePendingFinalize(finalize.id)
        if let recording {
            publishRecordingUpdate(recording)
        }
        publishSnapshot()
        return recording
    }

    func clearCompletedArtifacts() async {
        let referencedPaths = Set(manifest.pendingSegments.map(\.filePath))
        let persistedFiles = (try? fileManager.subpathsOfDirectory(atPath: queueSegmentsDirectory.path)) ?? []
        for relativePath in persistedFiles {
            let fileURL = queueSegmentsDirectory.appendingPathComponent(relativePath)
            if fileManager.directoryExists(at: fileURL) { continue }
            if !referencedPaths.contains(fileURL.path) {
                try? fileManager.removeItem(at: fileURL)
            }
        }
    }

    private func uploadPendingSegment(_ segment: PendingRecordingSegment) async throws -> MatchRecordingResponse {
        if segment.uploadMode == "multipart" || segment.sizeBytes >= multipartThresholdBytes {
            return try await uploadMultipartSegment(segment)
        }
        return try await uploadSinglePartSegment(segment)
    }

    private func uploadSinglePartSegment(_ segment: PendingRecordingSegment) async throws -> MatchRecordingResponse {
        if let segmentId = segment.segmentId?.trimmedNilIfBlank {
            do {
                return try await apiClient.completeSegment(
                    RecordingSegmentCompleteRequest(
                        recordingId: segment.recordingId,
                        segmentId: segmentId,
                        bytes: segment.sizeBytes,
                        durationSeconds: segment.durationSeconds
                    )
                )
            } catch {
                updatePendingSegment(segment.id) { current in
                    current.segmentId = nil
                    current.objectKey = nil
                    current.uploadedBytes = 0
                    current.lastError = "Complete lại thất bại, app sẽ presign lại."
                }
            }
        }

        let presign = try await apiClient.presignSegment(
            RecordingSegmentPresignRequest(
                recordingId: segment.recordingId,
                fileName: segment.fileName,
                contentType: "video/mp4",
                durationSeconds: segment.durationSeconds,
                bytes: segment.sizeBytes
            )
        )

        guard
            let uploadURLString = presign.uploadURL?.trimmedNilIfBlank,
            let uploadURL = URL(string: uploadURLString),
            let segmentId = presign.segmentId?.trimmedNilIfBlank
        else {
            throw LiveAPIError.missingUploadTarget
        }

        updatePendingSegment(segment.id) { current in
            current.segmentId = segmentId
            current.objectKey = presign.objectKey?.trimmedNilIfBlank
            current.uploadMode = "single"
            current.lastError = nil
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "PUT"
        request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        _ = try await urlSession.upload(for: request, fromFile: segment.fileURL)

        let response = try await apiClient.completeSegment(
            RecordingSegmentCompleteRequest(
                recordingId: segment.recordingId,
                segmentId: segmentId,
                bytes: segment.sizeBytes,
                durationSeconds: segment.durationSeconds
            )
        )
        return response
    }

    private func uploadMultipartSegment(_ segment: PendingRecordingSegment) async throws -> MatchRecordingResponse {
        var working = segment
        if working.segmentId?.trimmedNilIfBlank == nil || working.uploadId?.trimmedNilIfBlank == nil {
            let started = try await apiClient.startMultipartSegment(
                RecordingMultipartStartRequest(
                    recordingId: working.recordingId,
                    fileName: working.fileName,
                    contentType: "video/mp4",
                    bytes: working.sizeBytes
                )
            )

            guard
                let segmentId = started.segmentId?.trimmedNilIfBlank,
                let uploadId = started.uploadId?.trimmedNilIfBlank
            else {
                throw LiveAPIError.missingUploadTarget
            }

            updatePendingSegment(working.id) { current in
                current.segmentId = segmentId
                current.uploadId = uploadId
                current.objectKey = started.objectKey?.trimmedNilIfBlank
                current.uploadMode = "multipart"
                current.parts = []
                current.uploadedBytes = 0
                current.lastError = nil
            }

            working = manifest.pendingSegments.first(where: { $0.id == segment.id }) ?? working
        }

        guard
            let segmentId = working.segmentId?.trimmedNilIfBlank,
            let uploadId = working.uploadId?.trimmedNilIfBlank
        else {
            throw LiveAPIError.missingUploadTarget
        }

        let handle = try FileHandle(forReadingFrom: working.fileURL)
        defer {
            try? handle.close()
        }

        let completedParts = working.parts.sorted { $0.partNumber < $1.partNumber }
        let completedPartCount = completedParts.count

        if completedPartCount > 0 {
            let offset = UInt64(completedPartCount * multipartChunkBytes)
            try handle.seek(toOffset: offset)
        }

        var parts = completedParts
        var uploadedBytes = working.uploadedBytes
        var partNumber = completedPartCount + 1

        while true {
            let chunk = try handle.read(upToCount: multipartChunkBytes) ?? Data()
            if chunk.isEmpty {
                break
            }

            let uploadPart = try await apiClient.getMultipartPartURL(
                RecordingMultipartPartURLRequest(
                    recordingId: working.recordingId,
                    segmentId: segmentId,
                    uploadId: uploadId,
                    partNumber: partNumber
                )
            )

            guard let uploadURLString = uploadPart.uploadURL?.trimmedNilIfBlank, let uploadURL = URL(string: uploadURLString) else {
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
                    recordingId: working.recordingId,
                    segmentId: segmentId,
                    uploadedBytes: uploadedBytes
                )
            )

            updatePendingSegment(working.id) { current in
                current.parts = parts.sorted { $0.partNumber < $1.partNumber }
                current.uploadedBytes = uploadedBytes
                current.lastError = nil
            }

            partNumber += 1
        }

        let response = try await apiClient.completeMultipartSegment(
            RecordingMultipartCompleteRequest(
                recordingId: working.recordingId,
                segmentId: segmentId,
                uploadId: uploadId,
                parts: parts.sorted { $0.partNumber < $1.partNumber },
                bytes: working.sizeBytes,
                durationSeconds: working.durationSeconds
            )
        )
        return response
    }

    private func finalizeRecordingIfPossible(_ finalize: PendingFinalizeRecording) async throws -> MatchRecording? {
        guard !manifest.pendingSegments.contains(where: { $0.recordingId == finalize.recordingId }) else {
            return nil
        }

        let response = try await apiClient.finalizeRecording(recordingId: finalize.recordingId)
        return response.recording
    }

    private func nextPendingSegment() -> PendingRecordingSegment? {
        manifest.pendingSegments
            .sorted {
                if $0.createdAtMs == $1.createdAtMs {
                    return $0.segmentIndex < $1.segmentIndex
                }
                return $0.createdAtMs < $1.createdAtMs
            }
            .first
    }

    private func removePendingSegment(_ id: String) {
        guard let segment = manifest.pendingSegments.first(where: { $0.id == id }) else { return }
        manifest.pendingSegments.removeAll { $0.id == id }
        try? fileManager.removeItem(at: segment.fileURL)
        persistManifest()
        publishSnapshot()
    }

    private func removePendingFinalize(_ id: String) {
        manifest.pendingFinalizations.removeAll { $0.id == id }
        persistManifest()
        publishSnapshot()
    }

    private func markSegmentError(_ id: String, message: String) {
        updatePendingSegment(id) { current in
            current.lastError = message
        }
    }

    private func updatePendingSegment(_ id: String, update: (inout PendingRecordingSegment) -> Void) {
        guard let index = manifest.pendingSegments.firstIndex(where: { $0.id == id }) else { return }
        var current = manifest.pendingSegments[index]
        update(&current)
        manifest.pendingSegments[index] = current
        persistManifest()
        publishSnapshot()
    }

    private func persistSegmentFile(_ segment: LocalRecordingSegment) throws -> URL {
        let recordingDirectory = queueSegmentsDirectory.appendingPathComponent(segment.recordingId, isDirectory: true)
        try fileManager.createDirectory(at: recordingDirectory, withIntermediateDirectories: true, attributes: nil)
        let destinationURL = recordingDirectory.appendingPathComponent(segment.fileURL.lastPathComponent)

        if destinationURL.path == segment.fileURL.path {
            return destinationURL
        }

        if fileManager.fileExists(atPath: destinationURL.path) {
            try? fileManager.removeItem(at: destinationURL)
        }

        do {
            try fileManager.moveItem(at: segment.fileURL, to: destinationURL)
        } catch {
            if fileManager.fileExists(atPath: destinationURL.path) {
                try? fileManager.removeItem(at: destinationURL)
            }
            try fileManager.copyItem(at: segment.fileURL, to: destinationURL)
            try? fileManager.removeItem(at: segment.fileURL)
        }

        return destinationURL
    }

    private func persistManifest() {
        do {
            let data = try JSONEncoder.liveApp.encode(manifest)
            try data.write(to: manifestFileURL, options: [.atomic])
        } catch {
            publishError("Không ghi được recording manifest: \(error.localizedDescription)")
        }
    }

    private func publishSnapshot() {
        let snapshot = queueSnapshot()
        let callback = onQueueSnapshotChange
        Task { @MainActor in
            callback?(snapshot)
        }
    }

    private func publishRecordingUpdate(_ recording: MatchRecording) {
        let callback = onRecordingUpdate
        Task { @MainActor in
            callback?(recording)
        }
    }

    private func publishError(_ message: String) {
        let callback = onError
        Task { @MainActor in
            callback?(message)
        }
    }

    private static func resolveQueueRootDirectory(fileManager: FileManager) -> URL {
        if let url = try? fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) {
            return url.appendingPathComponent("PickleTourLiveRecordingQueue", isDirectory: true)
        }
        if let url = try? fileManager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true) {
            return url.appendingPathComponent("PickleTourLiveRecordingQueue", isDirectory: true)
        }
        return URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("PickleTourLiveRecordingQueue", isDirectory: true)
    }

    private static func loadManifest(from url: URL) -> RecordingQueueManifest {
        guard let data = try? Data(contentsOf: url) else {
            return RecordingQueueManifest()
        }
        return (try? JSONDecoder.liveApp.decode(RecordingQueueManifest.self, from: data)) ?? RecordingQueueManifest()
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
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
    let runtimeRegistry: LiveStreamRuntimeRegistry

    private init() {
        sessionStore = LiveSessionStore(keychain: keychain)
        networkMonitor = LiveNetworkMonitor()
        deviceMonitor = LiveDeviceMonitor()
        runtimeRegistry = LiveStreamRuntimeRegistry()
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
    @Published private(set) var lastThermalEvent: ThermalEvent?
    @Published private(set) var thermalEvents: [ThermalEvent] = []
    @Published private(set) var lastMemoryPressure: MemoryPressureEvent?
    @Published private(set) var memoryPressureEvents: [MemoryPressureEvent] = []

    private let notificationCenter: NotificationCenter
    private var observers: [NSObjectProtocol] = []

    init(notificationCenter: NotificationCenter = .default) {
        self.notificationCenter = notificationCenter
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
                self?.recordThermalEvent()
                self?.refresh()
            }
        )

        observers.append(
            notificationCenter.addObserver(
                forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.recordMemoryPressure(level: 2, summary: "iOS vừa phát memory warning.")
            }
        )
    }

    deinit {
        observers.forEach(notificationCenter.removeObserver)
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    func refresh() {
        batteryLevel = UIDevice.current.batteryLevel
        batteryState = UIDevice.current.batteryState
        lowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
        thermalState = ProcessInfo.processInfo.thermalState
    }

    private func recordThermalEvent() {
        let event = ThermalEvent(
            thermalStateRawValue: ProcessInfo.processInfo.thermalState.rawValue,
            atMs: Int64(Date().timeIntervalSince1970 * 1000),
            tempC: nil
        )
        lastThermalEvent = event
        thermalEvents = Array(([event] + thermalEvents).prefix(6))
    }

    private func recordMemoryPressure(level: Int, summary: String) {
        let event = MemoryPressureEvent(
            level: level,
            summary: summary,
            atMs: Int64(Date().timeIntervalSince1970 * 1000)
        )
        lastMemoryPressure = event
        memoryPressureEvents = Array(([event] + memoryPressureEvents).prefix(6))
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

private extension FileManager {
    func directoryExists(at url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        let exists = fileExists(atPath: url.path, isDirectory: &isDirectory)
        return exists && isDirectory.boolValue
    }
}
