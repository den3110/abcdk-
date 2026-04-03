# PickleTour Live iOS

Standalone iOS operator app for PickleTour Live.

## Defaults

- App name: `PickleTour Live`
- Bundle identifier: `com.pkt.pickletour.live`
- URL scheme: `pickletour-live`
- Deployment target: `iOS 15.1+`

## Local setup

1. Open a macOS machine with Xcode 15+ and CocoaPods installed.
2. From this directory run `pod install`.
3. Open `PickleTourLive.xcworkspace`.
4. Set signing for the `PickleTourLive` target.
5. Override backend endpoints in `PickleTourLive/Info.plist` if needed.

## Backend contract

The app mirrors the Android `native-live-app` contract:

- Auth handoff: `pickletour-live://auth-init?osAuthToken=...&targetUrl=...&continueUrl=...`
- OAuth callback: `pickletour-live://auth`
- Stream launch: `pickletour-live://stream?courtId=...&matchId=...&pageId=...`

## CI

- Fastlane lane: `bundle exec fastlane ios beta`
- GitHub Actions workflow: `.github/workflows/ios-live-beta.yml`
