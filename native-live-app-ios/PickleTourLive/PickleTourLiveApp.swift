import Combine
import SwiftUI

@main
struct PickleTourLiveApp: App {
    @UIApplicationDelegateAdaptor(LiveAppDelegate.self) private var appDelegate
    @StateObject private var store = LiveAppStore()

    var body: some Scene {
        WindowGroup {
            LiveAppRootView()
                .environmentObject(store)
                .task {
                    await store.bootstrapIfPossible()
                    for url in LiveAppURLRelay.shared.markReady() {
                        store.handleIncomingURL(url)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .liveAppDidReceiveURL)) { notification in
                    guard let url = notification.object as? URL else { return }
                    store.handleIncomingURL(url)
                }
        }
    }
}

@MainActor
private final class LiveAppURLRelay {
    static let shared = LiveAppURLRelay()

    private var isReady = false
    private var pendingURLs: [URL] = []

    func publish(_ url: URL) {
        if isReady {
            NotificationCenter.default.post(name: .liveAppDidReceiveURL, object: url)
        } else {
            pendingURLs.append(url)
        }
    }

    func markReady() -> [URL] {
        isReady = true
        let urls = pendingURLs
        pendingURLs.removeAll()
        return urls
    }
}

private extension Notification.Name {
    static let liveAppDidReceiveURL = Notification.Name("PickleTourLive.didReceiveURL")
}

final class LiveAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        let handledAuth = LiveAppEnvironment.shared.authCoordinator.handleOpenURL(url)
        if url.scheme == "pickletour-live" {
            Task { @MainActor in
                LiveAppURLRelay.shared.publish(url)
            }
        }
        return handledAuth || url.scheme == "pickletour-live"
    }
}
