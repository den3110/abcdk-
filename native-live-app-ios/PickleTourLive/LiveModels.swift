import Combine
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

struct LivePasswordLoginRequest: Codable {
    var email: String?
    var phone: String?
    var nickname: String?
    var password: String
}

struct LivePasswordLoginResponse: Codable {
    var token: String?
    var user: UserMe?
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

    var isEffectivelyOccupied: Bool {
        activePresence?.isEffectivelyOccupied() ?? false
    }

    var occupiedChipTitle: String? {
        guard isEffectivelyOccupied else { return nil }
        return activePresence?.operatorChipTitle ?? "Đang bận"
    }

    var occupiedMessage: String? {
        guard isEffectivelyOccupied else { return nil }
        return activePresence?.occupiedMessage(for: displayName)
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
    var leaseStatus: String?
    var leaseId: String?
    var clientSessionId: String?
    var expiresAt: String?
    var heartbeatIntervalMs: Int?
    var leaseTimeoutMs: Int?
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
    var leaseId: String?
    var occupied: Bool?
    var screenState: String?
    var expiresAt: String?
    var previewReleaseAt: String?
    var heartbeatIntervalMs: Int?
}

extension CourtLiveScreenPresence {
    private var normalizedScreenState: String {
        screenState?.trimmedNilIfBlank?.lowercased() ?? ""
    }

    private var previewLikeScreenState: Bool {
        switch normalizedScreenState {
        case "preview", "preview_unknown", "waiting_for_court", "waiting_for_next_match", "idle":
            return true
        default:
            return false
        }
    }

    func isEffectivelyOccupied(at now: Date = Date()) -> Bool {
        guard occupied == true else { return false }

        if let expiresAt = liveAppParseDate(expiresAt), expiresAt <= now {
            return false
        }

        if previewLikeScreenState,
           let previewReleaseAt = liveAppParseDate(previewReleaseAt),
           previewReleaseAt <= now {
            return false
        }

        return true
    }

    var operatorChipTitle: String {
        switch normalizedScreenState {
        case "live":
            return "Đang live"
        case "preview", "preview_unknown":
            return "Đang preview"
        case "waiting_for_court", "waiting_for_next_match", "idle":
            return "Đang giữ"
        default:
            return "Đang bận"
        }
    }

    func occupiedMessage(for courtName: String) -> String {
        guard occupied == true else {
            return "\(courtName) đang được giữ trên một thiết bị khác."
        }

        let stateText: String
        switch normalizedScreenState {
        case "live":
            stateText = "Thiết bị khác đang LIVE trên sân này."
        case "connecting", "reconnecting", "starting_countdown":
            stateText = "Thiết bị khác đang chuẩn bị phát hoặc đang kết nối stream."
        default:
            stateText = "Thiết bị khác đang ở màn live/preview của sân này."
        }

        let releaseText = formattedPreviewReleaseAt.map {
            " Nếu máy kia chỉ ở preview quá lâu, sân dự kiến sẽ tự động được trả lúc \($0)."
        } ?? ""

        return "\(courtName) đang được giữ. \(stateText)\(releaseText)"
    }

    var formattedPreviewReleaseAt: String? {
        guard let date = liveAppParseDate(previewReleaseAt) else { return nil }
        return liveAppTimeFormatter.string(from: date)
    }
}

struct StartMatchRecordingRequest: Codable {
    var matchId: String
    var courtId: String?
    var tournamentId: String?
    var streamSessionId: String?
    var quality: String?
    var recordingSessionId: String?
    var mode: String?
}

struct MatchRecordingSegment: Codable, Equatable, Hashable {
    var segmentId: String?
    var objectKey: String?
    var url: String?
    var status: String?
    var durationSeconds: Double?
}

struct MatchRecording: Decodable, Equatable {
    var id: String?
    var matchId: String?
    var courtId: String?
    var quality: String?
    var status: String?
    var recordingSessionId: String?
    var uploadMode: String?
    var playbackURL: String?
    var playback: RecordingLivePlayback?
    var segments: [MatchRecordingSegment]?

    enum CodingKeys: String, CodingKey {
        case id
        case legacyId = "_id"
        case matchId
        case courtId
        case quality
        case status
        case recordingSessionId
        case uploadMode
        case playbackURL = "playbackUrl"
        case playback
        case segments
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decodeIfPresent(String.self, forKey: .legacyId)
        matchId = try container.decodeIfPresent(String.self, forKey: .matchId)
        courtId = try container.decodeIfPresent(String.self, forKey: .courtId)
        quality = try container.decodeIfPresent(String.self, forKey: .quality)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        recordingSessionId = try container.decodeIfPresent(String.self, forKey: .recordingSessionId)
        uploadMode = try container.decodeIfPresent(String.self, forKey: .uploadMode)
        playbackURL = try container.decodeIfPresent(String.self, forKey: .playbackURL)
        playback = try container.decodeIfPresent(RecordingLivePlayback.self, forKey: .playback)
        segments = try container.decodeIfPresent([MatchRecordingSegment].self, forKey: .segments)
    }
}

extension MatchRecording {
    var playbackURLString: String? {
        playbackURL?.trimmedNilIfBlank
            ?? playback?.mp4URL?.trimmedNilIfBlank
            ?? playback?.manifestURL?.trimmedNilIfBlank
    }

    var segmentCount: Int {
        segments?.count ?? 0
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

struct MatchRecordingResponse: Decodable, Equatable {
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

struct RecordingMultipartPartETag: Codable, Equatable, Hashable {
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

enum LiveLaunchMode: String, Codable, Equatable {
    case tournamentCourt = "tournament_court"
    case userMatch = "user_match"
}

enum LiveStreamMode: String, Codable, CaseIterable, Identifiable {
    case streamOnly = "stream_only"
    case streamAndRecord = "stream_and_record"
    case recordOnly = "record_only"

    var id: String { rawValue }

    var includesRecording: Bool {
        self == .streamAndRecord || self == .recordOnly
    }

    var includesLivestream: Bool {
        self == .streamOnly || self == .streamAndRecord
    }

    var title: String {
        switch self {
        case .streamOnly:
            return "Chỉ live"
        case .streamAndRecord:
            return "Live + ghi hình"
        case .recordOnly:
            return "Chỉ ghi hình"
        }
    }

    var summary: String {
        switch self {
        case .streamOnly:
            return "Phát RTMP, không lưu recording cục bộ."
        case .streamAndRecord:
            return "Phát RTMP và cắt segment recording để tải nền."
        case .recordOnly:
            return "Giữ preview và tự ghi theo trận, không phát RTMP."
        }
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

    var recordingAPIValue: String {
        switch self {
        case .stable720:
            return "720p 24fps"
        case .balanced1080:
            return "1080p 30fps"
        case .aggressive1080:
            return "1080p 30fps high"
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
    var launchMode: LiveLaunchMode = .tournamentCourt

    var isUserMatchLaunch: Bool {
        launchMode == .userMatch
    }
}

enum DeviceOrientationMode: String, CaseIterable, Identifiable, Codable {
    case auto
    case portrait
    case landscape

    var id: String { rawValue }

    var title: String {
        switch self {
        case .auto:
            return "Auto"
        case .portrait:
            return "Dọc"
        case .landscape:
            return "Ngang"
        }
    }

    var systemImage: String {
        switch self {
        case .auto:
            return "arrow.trianglehead.2.clockwise.rotate.90"
        case .portrait:
            return "iphone"
        case .landscape:
            return "iphone.landscape"
        }
    }

    func next() -> DeviceOrientationMode {
        switch self {
        case .auto:
            return .portrait
        case .portrait:
            return .landscape
        case .landscape:
            return .auto
        }
    }
}

enum LivePreflightSeverity: String, Identifiable, Codable {
    case blocker
    case warning
    case info

    var id: String { rawValue }

    var title: String {
        switch self {
        case .blocker:
            return "Chặn"
        case .warning:
            return "Cảnh báo"
        case .info:
            return "Thông tin"
        }
    }
}

struct LivePreflightIssue: Identifiable, Equatable, Codable {
    let id: String
    let severity: LivePreflightSeverity
    let title: String
    let detail: String
}

struct LiveRecoverySummary: Equatable {
    let title: String
    let detail: String
    let canRetryPreview: Bool
    let canRetrySession: Bool
}

enum RecoveryStage: String, Codable, CaseIterable, Identifiable {
    case idle
    case socketSelfHeal = "socket_self_heal"
    case degraded
    case overlayRebuild = "overlay_rebuild"
    case pipelineRebuild = "pipeline_rebuild"
    case cameraRebuild = "camera_rebuild"
    case failSoftGuard = "fail_soft_guard"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .idle:
            return "Ổn định"
        case .socketSelfHeal:
            return "Tự nối lại"
        case .degraded:
            return "Giảm tải"
        case .overlayRebuild:
            return "Dựng lại overlay"
        case .pipelineRebuild:
            return "Dựng lại pipeline"
        case .cameraRebuild:
            return "Dựng lại camera"
        case .failSoftGuard:
            return "Ngưỡng cảnh báo"
        }
    }
}

enum RecoverySeverity: String, Codable, CaseIterable, Identifiable {
    case info
    case warning
    case critical

    var id: String { rawValue }

    var label: String {
        switch self {
        case .info:
            return "Thông tin"
        case .warning:
            return "Cảnh báo"
        case .critical:
            return "Nghiêm trọng"
        }
    }
}

struct RecoveryEvent: Codable, Equatable, Hashable, Identifiable, Sendable {
    var reason: String
    var atMs: Int64

    var id: String {
        "\(atMs)-\(reason)"
    }
}

struct StreamRecoveryState: Codable, Equatable, Sendable {
    var stage: RecoveryStage = .idle
    var severity: RecoverySeverity = .info
    var summary: String = ""
    var detail: String?
    var attempt: Int = 0
    var budgetRemaining: Int = 0
    var activeMitigations: [String] = []
    var lastFatalReason: String?
    var isFailSoftImminent: Bool = false
    var atMs: Int64 = 0

    var isActive: Bool {
        stage != .idle
    }
}

struct OverlayHealth: Codable, Equatable, Sendable {
    var attached: Bool = false
    var reattaching: Bool = false
    var snapshotFresh: Bool = false
    var roomMismatch: Bool = false
    var brandingConfigured: Bool = false
    var brandingLoading: Bool = false
    var brandingReady: Bool = false
    var brandingLoadedCount: Int = 0
    var brandingAssetCount: Int = 0
    var destinationBound: Bool = false
    var lastAttachedAtMs: Int64 = 0
    var lastIssue: String?
    var lastIssueAtMs: Int64 = 0
    var lastEvent: String?

    var healthy: Bool {
        attached
            && snapshotFresh
            && !roomMismatch
            && lastIssue == nil
            && (!brandingConfigured || brandingReady)
    }
}

struct LiveRuntimeSnapshot: Equatable {
    var routeLabel: String = "login"
    var courtId: String?
    var courtName: String?
    var matchId: String?
    var matchCode: String?
    var liveSessionId: String?
    var streamStateSummary: String = "idle"
    var recordingStateSummary: String = "idle"
    var overlayAttached: Bool = false
    var overlayRoomMismatch: Bool = false
    var overlayIssue: String?
    var waitingForCourt: Bool = false
    var waitingForMatchLive: Bool = false
    var waitingForNextMatch: Bool = false
    var updatedAt: Date = .distantPast

    var summaryLine: String {
        [
            "route=\(routeLabel)",
            courtId?.trimmedNilIfBlank.map { "court=\($0)" },
            matchId?.trimmedNilIfBlank.map { "match=\($0)" },
            liveSessionId?.trimmedNilIfBlank.map { "session=\($0)" },
            "stream=\(streamStateSummary)",
            "recording=\(recordingStateSummary)",
            overlayAttached ? "overlay=attached" : "overlay=detached",
            overlayRoomMismatch ? "room=mismatch" : nil,
            waitingForCourt ? "wait=court" : nil,
            waitingForMatchLive ? "wait=match_live" : nil,
            waitingForNextMatch ? "wait=next_match" : nil
        ]
        .compactMap { $0 }
        .joined(separator: " | ")
    }
}

final class LiveStreamRuntimeRegistry: ObservableObject {
    @Published private(set) var snapshot = LiveRuntimeSnapshot()

    func update(_ snapshot: LiveRuntimeSnapshot) {
        self.snapshot = snapshot
    }

    func clear() {
        snapshot = LiveRuntimeSnapshot()
    }
}

struct ThermalEvent: Codable, Equatable, Hashable, Identifiable, Sendable {
    var thermalStateRawValue: Int
    var atMs: Int64
    var tempC: Double?

    var id: String {
        "\(atMs)-\(thermalStateRawValue)"
    }
}

struct MemoryPressureEvent: Codable, Equatable, Hashable, Identifiable, Sendable {
    var level: Int
    var summary: String
    var atMs: Int64

    var id: String {
        "\(atMs)-\(level)"
    }
}

struct ObserverIngestResponse: Codable, Equatable {
    var ok: Bool
    var source: String?
    var deviceId: String?
    var id: String?
}

struct LiveDeviceHeartbeatRequest: Codable, Equatable {
    var source: String
    var deviceId: String
    var capturedAt: String
    var heartbeatIntervalMs: Int
    var status: LiveDeviceTelemetryStatus
}

struct LiveDeviceEventRequest: Codable, Equatable {
    var source: String
    var deviceId: String
    var capturedAt: String
    var event: LiveDeviceTelemetryEvent
    var status: LiveDeviceTelemetryStatus?
}

struct LiveDeviceTelemetryEvent: Codable, Equatable {
    var type: String
    var level: String
    var reasonCode: String
    var reasonText: String
    var stage: String?
    var severity: String?
    var occurredAt: String
    var courtId: String?
    var courtName: String?
    var matchId: String?
    var matchCode: String?
    var operatorUserId: String?
    var operatorName: String?
    var payload: LiveDeviceTelemetryEventPayload?
}

struct LiveDeviceTelemetryEventPayload: Codable, Equatable {
    var summary: String?
    var detail: String?
    var overlayIssue: String?
    var thermalState: String?
    var memoryPressure: String?
    var diagnostics: [String]
}

struct LiveDeviceTelemetryStatus: Codable, Equatable {
    var platform: String
    var clientSessionId: String
    var deviceId: String
    var screenState: String
    var routeLabel: String
    var app: LiveDeviceTelemetryAppInfo
    var device: LiveDeviceTelemetryDeviceInfo
    var operatorInfo: LiveDeviceTelemetryOperatorInfo
    var route: LiveDeviceTelemetryRouteInfo
    var court: LiveDeviceTelemetryCourtInfo
    var match: LiveDeviceTelemetryMatchInfo
    var stream: LiveDeviceTelemetryStreamInfo
    var recording: LiveDeviceTelemetryRecordingInfo
    var overlay: LiveDeviceTelemetryOverlayInfo
    var presence: CourtLiveScreenPresence?
    var network: LiveDeviceTelemetryNetworkInfo
    var battery: LiveDeviceTelemetryBatteryInfo
    var thermal: LiveDeviceTelemetryThermalInfo
    var recovery: StreamRecoveryState
    var warnings: [String]
    var diagnostics: [String]

    enum CodingKeys: String, CodingKey {
        case platform
        case clientSessionId
        case deviceId
        case screenState
        case routeLabel
        case app
        case device
        case operatorInfo = "operator"
        case route
        case court
        case match
        case stream
        case recording
        case overlay
        case presence
        case network
        case battery
        case thermal
        case recovery
        case warnings
        case diagnostics
    }
}

struct LiveDeviceTelemetryAppInfo: Codable, Equatable {
    var bundleId: String?
    var appVersion: String?
    var buildNumber: String?
    var liveMode: String
    var quality: String
}

struct LiveDeviceTelemetryDeviceInfo: Codable, Equatable {
    var name: String
    var model: String
    var systemName: String
    var systemVersion: String
}

struct LiveDeviceTelemetryOperatorInfo: Codable, Equatable {
    var userId: String?
    var displayName: String?
    var role: String?
}

struct LiveDeviceTelemetryRouteInfo: Codable, Equatable {
    var label: String
    var waitingForCourt: Bool
    var waitingForMatchLive: Bool
    var waitingForNextMatch: Bool
    var freshEntryRequired: Bool
    var appIsActive: Bool
}

struct LiveDeviceTelemetryCourtInfo: Codable, Equatable {
    var id: String?
    var name: String?
    var clusterId: String?
    var clusterName: String?
}

struct LiveDeviceTelemetryMatchInfo: Codable, Equatable {
    var id: String?
    var code: String?
    var status: String?
    var tournamentName: String?
}

struct LiveDeviceTelemetryStreamInfo: Codable, Equatable {
    var state: String
    var bitrate: Int
    var quality: String
    var socketConnected: Bool
    var runtimeSocketConnected: Bool
    var presenceSocketConnected: Bool
    var activeSocketMatchId: String?
    var socketPayloadStale: Bool
    var liveStartedAt: String?
}

struct LiveDeviceTelemetryRecordingInfo: Codable, Equatable {
    var stateText: String
    var pendingUploads: Int
    var pendingQueueBytes: Int64
    var pendingFinalizations: Int
    var segmentCount: Int
    var uploadMode: String?
    var playbackURL: String?
    var storageFreeBytes: Int64
    var storageTotalBytes: Int64
}

struct LiveDeviceTelemetryOverlayInfo: Codable, Equatable {
    var attached: Bool
    var healthy: Bool
    var reattaching: Bool
    var snapshotFresh: Bool
    var roomMismatch: Bool
    var brandingConfigured: Bool
    var brandingLoading: Bool
    var brandingReady: Bool
    var brandingLoadedCount: Int
    var brandingAssetCount: Int
    var destinationBound: Bool
    var issue: String?
    var issueAtMs: Int64
    var lastEvent: String?
}

struct LiveDeviceTelemetryNetworkInfo: Codable, Equatable {
    var connected: Bool
    var wifi: Bool
    var lowPowerModeEnabled: Bool
}

struct LiveDeviceTelemetryBatteryInfo: Codable, Equatable {
    var levelPercent: Int?
    var state: String
    var lowWarning: Bool
}

struct LiveDeviceTelemetryThermalInfo: Codable, Equatable {
    var state: String
    var stateRawValue: Int
    var warning: Bool
    var critical: Bool
    var lastEventAtMs: Int64?
    var lastEventSummary: String?
    var memoryPressureSummary: String?
}

struct OperatorRecoveryDialogState: Equatable {
    var title: String
    var summary: String
    var detail: String
    var severity: RecoverySeverity
    var stage: RecoveryStage
    var attempt: Int
    var budgetRemaining: Int
    var activeMitigations: [String]
    var lastFatalReason: String?
    var isFailSoftImminent: Bool
}

struct PendingRecordingSegment: Codable, Equatable, Hashable, Identifiable {
    var recordingId: String
    var matchId: String
    var segmentIndex: Int
    var filePath: String
    var fileName: String
    var durationSeconds: Double
    var sizeBytes: Int64
    var isFinal: Bool
    var uploadMode: String?
    var segmentId: String?
    var uploadId: String?
    var objectKey: String?
    var uploadedBytes: Int64
    var parts: [RecordingMultipartPartETag]
    var lastError: String?
    var createdAtMs: Int64

    var id: String {
        "\(recordingId)-\(segmentIndex)-\(fileName)"
    }

    var fileURL: URL {
        URL(fileURLWithPath: filePath)
    }
}

struct PendingFinalizeRecording: Codable, Equatable, Hashable, Identifiable {
    var recordingId: String
    var matchId: String

    var id: String {
        "\(recordingId)-\(matchId)"
    }
}

struct RecordingQueueManifest: Codable, Equatable {
    var pendingSegments: [PendingRecordingSegment] = []
    var pendingFinalizations: [PendingFinalizeRecording] = []
}

struct RecordingQueueSnapshot: Equatable {
    var pendingSegments: [PendingRecordingSegment] = []
    var pendingFinalizations: [PendingFinalizeRecording] = []
    var pendingQueueBytes: Int64 = 0

    var pendingUploadCount: Int {
        pendingSegments.count
    }
}

struct RecordingStorageStatus: Equatable {
    var minimumBytes: Int64 = 0
    var standardBytes: Int64 = 0
    var recommendedBytes: Int64 = 0
    var pendingQueueBytes: Int64 = 0
    var runwayMinutes: Int? = nil
    var hardBlock: Bool = false
    var redWarning: Bool = false
    var warning: Bool = false
    var message: String? = nil
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

    static let liveAppFallback: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()
}

private let liveAppTimeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "vi_VN")
    formatter.timeZone = .current
    formatter.dateFormat = "HH:mm"
    return formatter
}()

private func liveAppParseDate(_ raw: String?) -> Date? {
    guard let raw = raw?.trimmedNilIfBlank else { return nil }
    if let parsed = ISO8601DateFormatter.liveApp.date(from: raw) {
        return parsed
    }
    if let parsed = ISO8601DateFormatter.liveAppFallback.date(from: raw) {
        return parsed
    }
    if let epoch = Double(raw) {
        let seconds = epoch > 10_000_000_000 ? epoch / 1000 : epoch
        return Date(timeIntervalSince1970: seconds)
    }
    return nil
}
