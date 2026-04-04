import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct PickleTourMatchActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var tournamentName: String
        var courtName: String
        var matchCode: String
        var teamAName: String
        var teamBName: String
        var scoreA: Int
        var scoreB: Int
        var statusText: String
        var detailText: String
        var updatedAt: Date
    }

    var matchId: String
}
#endif
