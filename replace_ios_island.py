import sys

new_content = r'''import ActivityKit
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
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PickleTourMatchActivityAttributes.self) { context in
            LiveActivityLockScreenView(context: context)
                .activityBackgroundTint(Color(red: 0.08, green: 0.11, blue: 0.14).opacity(0.95))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    DynamicIslandTeamColumn(
                        title: context.state.teamAName,
                        score: context.state.scoreA,
                        isLeading: true,
                        scoreColor: Color(red: 0.31, green: 0.89, blue: 0.76) // Cyan
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    DynamicIslandTeamColumn(
                        title: context.state.teamBName,
                        score: context.state.scoreB,
                        isLeading: false,
                        scoreColor: Color(red: 1.0, green: 0.42, blue: 0.42) // Red/Orange
                    )
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 4) {
                        HStack(spacing: 4) {
                            Circle()
                                .fill(Color.red)
                                .frame(width: 6, height: 6)
                            Text(context.state.matchCode)
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundStyle(.white)
                        }
                        Text(context.state.statusText)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(red: 1.0, green: 0.8, blue: 0.2))
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "tennis.racket")
                                .font(.system(size: 12))
                                .foregroundStyle(Color(red: 0.31, green: 0.89, blue: 0.76))
                            Text(context.state.detailText)
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(Color.white.opacity(0.9))
                        }
                        HStack(spacing: 6) {
                            Image(systemName: "location.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(Color.gray)
                            Text("\(context.state.courtName) • \(context.state.tournamentName)")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(Color.white.opacity(0.65))
                                .lineLimit(1)
                        }
                    }
                    .padding(.top, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Text("\(context.state.scoreA)")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(red: 0.31, green: 0.89, blue: 0.76))
            } compactTrailing: {
                Text("\(context.state.scoreB)")
                    .font(.system(size: 14, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(red: 1.0, green: 0.42, blue: 0.42))
            } minimal: {
                Text("\(context.state.scoreA)-\(context.state.scoreB)")
                    .font(.system(size: 12, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }
            .widgetURL(URL(string: "pickletour-live://stream?matchId=\(context.attributes.matchId)"))
            .keylineTint(Color(red: 0.31, green: 0.89, blue: 0.76))
        }
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct LiveActivityLockScreenView: View {
    let context: ActivityViewContext<PickleTourMatchActivityAttributes>

    var body: some View {
        VStack(spacing: 16) {
            // HEADER
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 8, height: 8)
                        .opacity(0.9)
                        .shadow(color: .red, radius: 2)
                    Text("LIVE")
                        .font(.system(size: 12, weight: .black, design: .rounded))
                        .foregroundStyle(.red)
                    Text("•")
                        .foregroundStyle(.gray)
                    Text(context.state.matchCode)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
                Spacer()
                Text(context.state.statusText)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.yellow.opacity(0.15))
                    .foregroundStyle(Color(red: 1.0, green: 0.8, blue: 0.2))
                    .clipShape(Capsule())
            }

            // SCOREBOARD
            HStack(alignment: .center) {
                // Team A
                VStack(spacing: 6) {
                    Text("\(context.state.scoreA)")
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .foregroundStyle(Color(red: 0.31, green: 0.89, blue: 0.76)) // Cyan
                        .shadow(color: Color(red: 0.31, green: 0.89, blue: 0.76).opacity(0.3), radius: 5)
                    Text(context.state.teamAName)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.9))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)

                // VS
                VStack {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.1))
                            .frame(width: 32, height: 32)
                        Text("VS")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
                .padding(.horizontal, 4)

                // Team B
                VStack(spacing: 6) {
                    Text("\(context.state.scoreB)")
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.42, blue: 0.42)) // Red/Orange
                        .shadow(color: Color(red: 1.0, green: 0.42, blue: 0.42).opacity(0.3), radius: 5)
                    Text(context.state.teamBName)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.9))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity)
            }

            // FOOTER INFO
            VStack(spacing: 6) {
                HStack {
                    Image(systemName: "tennisball.fill")
                        .foregroundStyle(Color(red: 0.31, green: 0.89, blue: 0.76))
                        .font(.system(size: 12))
                    Text(context.state.detailText)
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(.white)
                }
                HStack(spacing: 4) {
                    Image(systemName: "mappin.and.ellipse")
                        .foregroundStyle(.gray)
                        .font(.system(size: 11))
                    Text("\(context.state.courtName) • \(context.state.tournamentName)")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .lineLimit(1)
                }
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 20)
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct DynamicIslandTeamColumn: View {
    let title: String
    let score: Int
    let isLeading: Bool
    let scoreColor: Color

    var body: some View {
        VStack(alignment: isLeading ? .leading : .trailing, spacing: 2) {
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.85))
                .lineLimit(1)
                .multilineTextAlignment(isLeading ? .leading : .trailing)
            Text("\(score)")
                .font(.system(size: 32, weight: .heavy, design: .rounded))
                .foregroundStyle(scoreColor)
                .lineLimit(1)
                .shadow(color: scoreColor.opacity(0.35), radius: 2)
        }
        .frame(maxWidth: .infinity, alignment: isLeading ? .leading : .trailing)
        .padding(isLeading ? .leading : .trailing, 4)
    }
}
'''

with open('native-live-app-ios/PickleTourLiveActivity/PickleTourLiveActivityBundle.swift', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Success: Replaced PickleTourLiveActivityBundle.swift')
