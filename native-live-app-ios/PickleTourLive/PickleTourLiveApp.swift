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
                }
                .onOpenURL { url in
                    store.handleIncomingURL(url)
                }
        }
    }
}

final class LiveAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        LiveAppEnvironment.shared.authCoordinator.handleOpenURL(url)
    }
}
