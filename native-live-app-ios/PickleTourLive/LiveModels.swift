import CoreGraphics
import Foundation

struct AuthSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String?
    var idToken: String?
    var userId: String?
    var displayName: String?
}

struct UserMe: Codable, Identifiable, Equatable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case email
        case fullName
        case name
        case username
        case role
    }

    var id: String
    var email: String?
    var fullName: String?
    var name: String?
    var username: String?
    var role: String?

    var displayName: String {
        [fullName, name, username, email]
            .compactMap { $0?.trimmedNilIfBlank }
            .first ?? "Operator"
    }
}

struct TournamentData: Codable, Identifiable, Hashable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case title
        case sportType
        case status
        case logo
        case logoURL = "logoUrl"
    }

    var id: String
    var name: String?
    var title: String?
    var sportType: String?
    var status: String?
    var logo: String?
    var logoURL: String?

    var displayName: String {
        [name, title].compactMap { $0?.trimmedNilIfBlank }.first ?? "Giải đấu"
    }
}

struct AssignedTournamentData: Codable, Identifiable, Hashable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case image
        case status
        case eventType
        case nameDisplayMode
    }

    var id: String
    var name: String?
    var image: String?
    var status: String?
    var eventType: String?
    var nameDisplayMode: String?
}

struct CourtClusterData: Codable, Identifiable, Hashable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case slug
        case venueName
        case description
        case color
        case order
        case isActive
        case stationsCount
        case liveCount
        case assignedTournamentCount
        case assignedTournaments
    }

    var id: String
    var name: String?
    var slug: String?
    var venueName: String?
    var description: String?
    var color: String?
    var order: Int?
    var isActive: Bool?
    var stationsCount: Int?
    var liveCount: Int?
    var assignedTournamentCount: Int?
    var assignedTournaments: [AssignedTournamentData]

    var displayName: String {
        [name, venueName].compactMap { $0?.trimmedNilIfBlank }.first ?? "Cụm sân"
    }
}

struct CourtClusterListResponse: Codable {
    var items: [CourtClusterData]
}

struct RuntimePresenceHints: Codable, Equatable {
    var occupied: Bool?
    var screenState: String?
    var heartbeatIntervalMs: Int?
}

struct RuntimeLeaseHints: Codable, Equatable {
    var heartbeatIntervalMs: Int?
    var leaseTimeoutMs: Int?
}

struct CourtLiveScreenPresence: Codable, Equatable, Hashable {
    var occupied: Bool?
    var status: String?
    var screenState: String?
    var matchId: String?
    var startedAt: String?
    var lastHeartbeatAt: String?
    var expiresAt: String?
    var previewModeSince: String?
    var previewReleaseAt: String?
    var warningAt: String?
    var previewWarningMs: Int?
}

struct CourtLiveWatchItem: Codable, Equatable {
    var courtId: String
    var liveScreenPresence: CourtLiveScreenPresence?
}

struct CourtLiveWatchSnapshot: Codable, Equatable {
    var tournamentId: String
    var ts: String?
    var courts: [CourtLiveWatchItem]
}

struct CourtQueueItem: Codable, Equatable {
    var matchId: String?
    var order: Int?
    var queuedAt: String?
    var queuedBy: String?
}

struct AdminCourtData: Codable, Identifiable, Hashable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case label
        case number
        case code
        case status
        case clusterId
        case clusterName
        case assignmentMode
        case queueCount
        case currentMatchId
        case currentTournamentId
        case presence
        case liveScreenPresence
    }

    var id: String
    var name: String?
    var label: String?
    var number: Int?
    var code: String?
    var status: String?
    var clusterId: String?
    var clusterName: String?
    var assignmentMode: String?
    var queueCount: Int?
    var currentMatchId: String?
    var currentTournamentId: String?
    var presence: CourtLiveScreenPresence?
    var liveScreenPresence: CourtLiveScreenPresence?

    var displayName: String {
        [label, name, code].compactMap { $0?.trimmedNilIfBlank }.first ?? {
            if let number { return "Sân \(number)" }
            return "Sân"
        }()
    }

    var activePresence: CourtLiveScreenPresence? {
        liveScreenPresence ?? presence
    }
}

struct AdminCourtListResponse: Codable {
    var items: [AdminCourtData]
}

struct LiveAppBootstrapResponse: Codable {
    var ok: Bool
    var authenticated: Bool
    var canUseLiveApp: Bool
    var roleSummary: String?
    var reason: String?
    var message: String?
    var user: UserMe?
    var manageableTournaments: [TournamentData]
    var manageableCourtClusters: [CourtClusterData]
}

struct LiveAppCourtRuntimeResponse: Codable, Equatable {
    var ok: Bool
    var courtId: String
    var courtStationId: String?
    var courtClusterId: String?
    var courtClusterName: String?
    var tournamentId: String?
    var bracketId: String?
    var name: String?
    var status: String?
    var isActive: Bool?
    var currentMatchId: String?
    var nextMatchId: String?
    var assignmentMode: String?
    var queueCount: Int?
    var listEnabled: Bool?
    var remainingManualCount: Int?
    var recommendedPollIntervalMs: Int?
    var cacheTtlMs: Int?
    var presence: CourtLiveScreenPresence?
    var presenceHints: RuntimePresenceHints?
    var leaseHints: RuntimeLeaseHints?
}

struct SetScore: Codable, Equatable, Hashable {
    var index: Int
    var a: Int?
    var b: Int?
    var winner: String?
    var current: Bool?
}

struct TournamentInfo: Codable, Equatable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case displayNameMode
        case logoURL = "logoUrl"
        case imageURL = "imageUrl"
    }

    var id: String
    var name: String?
    var displayNameMode: String?
    var logoURL: String?
    var imageURL: String?
}

struct CourtInfo: Codable, Equatable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case label
        case number
    }

    var id: String
    var name: String?
    var label: String?
    var number: Int?
}

struct MatchData: Codable, Identifiable, Equatable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case code
        case displayCode
        case displayNameMode
        case liveVersion
        case teamAName
        case teamBName
        case scoreA
        case scoreB
        case serveSide
        case serveCount
        case status
        case tournamentName
        case courtName
        case tournamentLogoURL = "tournamentLogoUrl"
        case stageName
        case phaseText
        case roundLabel
        case seedA
        case seedB
        case breakNote
        case gameScores
        case video
        case courtStationId
        case courtStationName
        case courtClusterId
        case courtClusterName
        case tournament
        case court
    }

    var id: String
    var code: String?
    var displayCode: String?
    var displayNameMode: String?
    var liveVersion: Int?
    var teamAName: String?
    var teamBName: String?
    var scoreA: Int?
    var scoreB: Int?
    var serveSide: String?
    var serveCount: Int?
    var status: String?
    var tournamentName: String?
    var courtName: String?
    var tournamentLogoURL: String?
    var stageName: String?
    var phaseText: String?
    var roundLabel: String?
    var seedA: Int?
    var seedB: Int?
    var breakNote: String?
    var gameScores: [SetScore]?
    var video: String?
    var courtStationId: String?
    var courtStationName: String?
    var courtClusterId: String?
    var courtClusterName: String?
    var tournament: TournamentInfo?
    var court: CourtInfo?

    var teamADisplayName: String {
        teamAName?.trimmedNilIfBlank ?? "Đội A"
    }

    var teamBDisplayName: String {
        teamBName?.trimmedNilIfBlank ?? "Đội B"
    }

    var tournamentDisplayName: String {
        tournament?.name?.trimmedNilIfBlank
            ?? tournamentName?.trimmedNilIfBlank
            ?? "PickleTour"
    }

    var courtDisplayName: String {
        court?.name?.trimmedNilIfBlank
            ?? court?.label?.trimmedNilIfBlank
            ?? courtName?.trimmedNilIfBlank
            ?? courtStationName?.trimmedNilIfBlank
            ?? "Court"
    }
}

struct NextCourtMatchResponse: Codable {
    var matchId: String?
}

struct LiveSession: Codable, Equatable {
    var facebook: FacebookLive?
}

struct FacebookLive: Codable, Equatable {
    enum CodingKeys: String, CodingKey {
        case secureStreamURL = "secure_stream_url"
        case serverURL = "server_url"
        case streamKey = "stream_key"
        case watchURL = "watch_url"
        case permalinkURL = "permalink_url"
        case pageName
        case pageId
    }

    var secureStreamURL: String?
    var serverURL: String?
    var streamKey: String?
    var watchURL: String?
    var permalinkURL: String?
    var pageName: String?
    var pageId: String?

    var resolvedRTMPURL: String? {
        if let secureStreamURL, !secureStreamURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return secureStreamURL
        }

        guard
            let serverURL,
            let streamKey,
            let base = serverURL.trimmedNilIfBlank,
            let key = streamKey.trimmedNilIfBlank
        else {
            return nil
        }

        return "\(base.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/\(key)"
    }
}

struct SponsorItem: Codable, Hashable {
    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case logoURL = "logoUrl"
        case name
        case tier
    }

    var id: String
    var logoURL: String?
    var name: String
    var tier: String?
}

struct OverlayConfig: Codable, Equatable {
    var sponsors: [SponsorItem]
    var tournamentImageURL: String?
    var webLogoURL: String?

    enum CodingKeys: String, CodingKey {
        case sponsors
        case tournamentImageURL = "tournamentImageUrl"
        case webLogoURL = "webLogoUrl"
    }
}

struct StreamNotifyRequest: Codable {
    var platform: String = "facebook"
    var timestamp: String
    var clientSessionId: String?
}

struct StreamNotifyResponse: Codable, Equatable {
    var ok: Bool
    var matchId: String?
    var active: Bool?
}

struct CreateLiveRequest: Codable {
    var pageId: String?
}

struct CourtPresenceRequest: Codable {
    var clientSessionId: String
    var screenState: String?
    var matchId: String?
    var timestamp: String
}

struct CourtPresenceResponse: Codable, Equatable {
    var ok: Bool
    var occupied: Bool?
    var screenState: String?
    var expiresAt: String?
    var previewReleaseAt: String?
    var heartbeatIntervalMs: Int?
}

struct StartMatchRecordingRequest: Codable {
    var matchId: String
    var courtId: String?
    var tournamentId: String?
    var streamSessionId: String?
    var mode: String?
}

struct MatchRecordingSegment: Codable, Equatable, Hashable {
    var segmentId: String?
    var objectKey: String?
    var url: String?
    var status: String?
    var durationSeconds: Double?
}

struct MatchRecording: Codable, Equatable {
    var id: String?
    var matchId: String?
    var status: String?
    var uploadMode: String?
    var playback: RecordingLivePlayback?
    var segments: [MatchRecordingSegment]?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case matchId
        case status
        case uploadMode
        case playback
        case segments
    }
}

struct RecordingLivePlayback: Codable, Equatable {
    var manifestURL: String?
    var mp4URL: String?

    enum CodingKeys: String, CodingKey {
        case manifestURL = "manifestUrl"
        case mp4URL = "mp4Url"
    }
}

struct MatchRecordingResponse: Codable, Equatable {
    var ok: Bool
    var recording: MatchRecording?
}

struct RecordingSegmentPresignRequest: Codable {
    var recordingId: String
    var fileName: String
    var contentType: String
    var durationSeconds: Double?
    var bytes: Int64?
}

struct RecordingSegmentPresignResponse: Codable, Equatable {
    var ok: Bool
    var segmentId: String?
    var uploadURL: String?
    var objectKey: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case segmentId
        case uploadURL = "uploadUrl"
        case objectKey
    }
}

struct RecordingSegmentCompleteRequest: Codable {
    var recordingId: String
    var segmentId: String
    var bytes: Int64?
    var durationSeconds: Double?
}

struct RecordingMultipartStartRequest: Codable {
    var recordingId: String
    var fileName: String
    var contentType: String
    var bytes: Int64?
}

struct RecordingMultipartStartResponse: Codable, Equatable {
    var ok: Bool
    var segmentId: String?
    var uploadId: String?
    var objectKey: String?
}

struct RecordingMultipartPartURLRequest: Codable {
    var recordingId: String
    var segmentId: String
    var uploadId: String
    var partNumber: Int
}

struct RecordingMultipartPartURLResponse: Codable, Equatable {
    var ok: Bool
    var uploadURL: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case uploadURL = "uploadUrl"
    }
}

struct RecordingMultipartProgressRequest: Codable {
    var recordingId: String
    var segmentId: String
    var uploadedBytes: Int64
}

struct RecordingMultipartPartETag: Codable, Equatable {
    var partNumber: Int
    var etag: String
}

struct RecordingMultipartCompleteRequest: Codable {
    var recordingId: String
    var segmentId: String
    var uploadId: String
    var parts: [RecordingMultipartPartETag]
    var bytes: Int64?
    var durationSeconds: Double?
}

struct FinalizeMatchRecordingRequest: Codable {
    var recordingId: String
}

struct LiveOverlaySnapshot: Codable, Equatable {
    var tournamentName: String?
    var courtName: String?
    var tournamentLogoURL: String?
    var stageName: String?
    var phaseText: String?
    var roundLabel: String?
    var teamAName: String?
    var teamBName: String?
    var scoreA: Int?
    var scoreB: Int?
    var serveSide: String?
    var serveCount: Int?
    var breakNote: String?
    var seedA: Int?
    var seedB: Int?
    var sets: [SetScore]?
    var sponsorLogoURLs: [String]?
    var webLogoURL: String?

    enum CodingKeys: String, CodingKey {
        case tournamentName
        case courtName
        case tournamentLogoURL = "tournamentLogoUrl"
        case stageName
        case phaseText
        case roundLabel
        case teamAName
        case teamBName
        case scoreA
        case scoreB
        case serveSide
        case serveCount
        case breakNote
        case seedA
        case seedB
        case sets
        case sponsorLogoURLs = "sponsorLogos"
        case webLogoURL = "webLogoUrl"
    }

    init(
        tournamentName: String? = nil,
        courtName: String? = nil,
        tournamentLogoURL: String? = nil,
        stageName: String? = nil,
        phaseText: String? = nil,
        roundLabel: String? = nil,
        teamAName: String? = nil,
        teamBName: String? = nil,
        scoreA: Int? = nil,
        scoreB: Int? = nil,
        serveSide: String? = nil,
        serveCount: Int? = nil,
        breakNote: String? = nil,
        seedA: Int? = nil,
        seedB: Int? = nil,
        sets: [SetScore]? = nil,
        sponsorLogoURLs: [String]? = nil,
        webLogoURL: String? = nil
    ) {
        self.tournamentName = tournamentName
        self.courtName = courtName
        self.tournamentLogoURL = tournamentLogoURL
        self.stageName = stageName
        self.phaseText = phaseText
        self.roundLabel = roundLabel
        self.teamAName = teamAName
        self.teamBName = teamBName
        self.scoreA = scoreA
        self.scoreB = scoreB
        self.serveSide = serveSide
        self.serveCount = serveCount
        self.breakNote = breakNote
        self.seedA = seedA
        self.seedB = seedB
        self.sets = sets
        self.sponsorLogoURLs = sponsorLogoURLs
        self.webLogoURL = webLogoURL
    }

    init(match: MatchData) {
        self.init(
            tournamentName: match.tournamentDisplayName,
            courtName: match.courtDisplayName,
            tournamentLogoURL: match.tournament?.logoURL ?? match.tournamentLogoURL,
            stageName: match.stageName,
            phaseText: match.phaseText,
            roundLabel: match.roundLabel,
            teamAName: match.teamADisplayName,
            teamBName: match.teamBDisplayName,
            scoreA: match.scoreA,
            scoreB: match.scoreB,
            serveSide: match.serveSide,
            serveCount: match.serveCount,
            breakNote: match.breakNote,
            seedA: match.seedA,
            seedB: match.seedB,
            sets: match.gameScores
        )
    }
}

struct CourtClusterRuntimeResponse: Codable, Equatable {
    var cluster: CourtClusterData?
    var stations: [AdminCourtData]
}

struct CourtStationRuntimeResponse: Codable, Equatable {
    var cluster: CourtClusterData?
    var station: AdminCourtData?
    var currentMatch: MatchData?
}

enum AppRoute: Equatable {
    case login
    case adminHome
    case courtSetup
    case liveStream
}

enum LiveStreamMode: String, Codable, CaseIterable, Identifiable {
    case streamOnly = "stream_only"
    case streamAndRecord = "stream_and_record"
    case recordOnly = "record_only"

    var id: String { rawValue }

    var includesRecording: Bool {
        self == .streamAndRecord || self == .recordOnly
    }
}

enum LiveQualityPreset: String, CaseIterable, Identifiable, Codable {
    case stable720
    case balanced1080
    case aggressive1080

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stable720:
            return "Ổn định 720p"
        case .balanced1080:
            return "Cân bằng 1080p"
        case .aggressive1080:
            return "1080p mạnh"
        }
    }

    var resolution: (width: Int, height: Int) {
        switch self {
        case .stable720:
            return (1280, 720)
        case .balanced1080, .aggressive1080:
            return (1920, 1080)
        }
    }

    var frameRate: Int {
        switch self {
        case .stable720:
            return 24
        case .balanced1080:
            return 30
        case .aggressive1080:
            return 30
        }
    }

    var videoBitrate: Int {
        switch self {
        case .stable720:
            return 2_200_000
        case .balanced1080:
            return 4_200_000
        case .aggressive1080:
            return 5_800_000
        }
    }
}

enum StreamConnectionState: Equatable {
    case idle
    case preparingPreview
    case previewReady
    case connecting
    case live
    case reconnecting(String)
    case stopped
    case failed(String)
}

struct StreamStatsSnapshot: Equatable {
    var currentBitrate: Int
    var quality: LiveQualityPreset
    var torchEnabled: Bool
    var micEnabled: Bool
    var zoomFactor: CGFloat
}

struct LiveLaunchTarget: Equatable {
    var courtId: String?
    var matchId: String?
    var pageId: String?
}

struct RTMPDestination: Equatable {
    var connectURL: String
    var publishName: String

    static func parse(from rawURL: String) -> RTMPDestination? {
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed), let scheme = components.scheme, let host = components.host else {
            return nil
        }

        let pathParts = components.path.split(separator: "/").map(String.init)
        guard pathParts.count >= 2 else {
            return nil
        }

        let publishName = pathParts.last ?? ""
        let appPath = pathParts.dropLast().joined(separator: "/")
        var connectURL = "\(scheme)://\(host)"
        if let port = components.port {
            connectURL += ":\(port)"
        }
        connectURL += "/\(appPath)"
        if let query = components.percentEncodedQuery, !query.isEmpty {
            connectURL += "?\(query)"
        }
        return RTMPDestination(connectURL: connectURL, publishName: publishName)
    }
}

extension String {
    var trimmedNilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension Optional where Wrapped == String {
    var trimmedNilIfBlank: String? {
        switch self {
        case let .some(value):
            return value.trimmedNilIfBlank
        case .none:
            return nil
        }
    }
}

extension Date {
    var iso8601UTCString: String {
        ISO8601DateFormatter.liveApp.string(from: self)
    }
}

extension ISO8601DateFormatter {
    static let liveApp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()
}
