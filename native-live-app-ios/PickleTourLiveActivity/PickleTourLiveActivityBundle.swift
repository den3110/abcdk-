import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PickleTourLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        PickleTourMatchLiveActivity()
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct PickleTourMatchLiveActivity: Widget {
    var body: some Widget {
        ActivityConfiguration(for: PickleTourMatchActivityAttributes.self) { context in
            LiveActivityLockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.92))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    DynamicIslandTeamColumn(
                        title: context.state.teamAName,
                        score: context.state.scoreA,
                        isLeading: true
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    DynamicIslandTeamColumn(
                        title: context.state.teamBName,
                        score: context.state.scoreB,
                        isLeading: false
                    )
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 4) {
                        Text(context.state.matchCode)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Text(context.state.statusText)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(Color.yellow.opacity(0.92))
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.state.detailText)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.86))
                            .lineLimit(1)
                        Text("\(context.state.courtName) | \(context.state.tournamentName)")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.68))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Text("\(context.state.scoreA)")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(Color(red: 0.78, green: 0.93, blue: 0.47))
            } compactTrailing: {
                Text("\(context.state.scoreB)")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(Color(red: 0.43, green: 0.82, blue: 0.98))
            } minimal: {
                Text("\(context.state.scoreA)-\(context.state.scoreB)")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .widgetURL(URL(string: "pickletour-live://stream?matchId=\(context.attributes.matchId)"))
            .keylineTint(Color.yellow.opacity(0.9))
        }
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct LiveActivityLockScreenView: View {
    let context: ActivityViewContext<PickleTourMatchActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.state.matchCode)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text(context.state.statusText)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.yellow.opacity(0.92))
                }
                Spacer(minLength: 12)
                Text(context.state.courtName)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.72))
                    .lineLimit(1)
            }

            HStack(spacing: 16) {
                DynamicIslandTeamColumn(
                    title: context.state.teamAName,
                    score: context.state.scoreA,
                    isLeading: true
                )
                Spacer(minLength: 8)
                DynamicIslandTeamColumn(
                    title: context.state.teamBName,
                    score: context.state.scoreB,
                    isLeading: false
                )
            }

            Text(context.state.detailText)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.78))
                .lineLimit(1)

            Text(context.state.tournamentName)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.58))
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct DynamicIslandTeamColumn: View {
    let title: String
    let score: Int
    let isLeading: Bool

    var body: some View {
        VStack(alignment: isLeading ? .leading : .trailing, spacing: 4) {
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.8))
                .lineLimit(1)
                .multilineTextAlignment(isLeading ? .leading : .trailing)
            Text("\(score)")
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: isLeading ? .leading : .trailing)
    }
}
