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
    static var orientationMask: UIInterfaceOrientationMask = .allButUpsideDown

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

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        Self.orientationMask
    }
}

enum LiveAppOrientationController {
    @MainActor
    static func apply(_ mode: DeviceOrientationMode) {
        let mask: UIInterfaceOrientationMask
        let orientationValue: UIInterfaceOrientation

        switch mode {
        case .auto:
            mask = .allButUpsideDown
            orientationValue = .unknown
        case .portrait:
            mask = .portrait
            orientationValue = .portrait
        case .landscape:
            mask = .landscape
            orientationValue = .landscapeRight
        }

        LiveAppDelegate.orientationMask = mask
        guard UIApplication.shared.applicationState == .active else {
            return
        }

        if #available(iOS 16.0, *) {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .forEach { scene in
                    try? scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
                }
        } else if orientationValue != .unknown {
            UIDevice.current.setValue(orientationValue.rawValue, forKey: "orientation")
        }

        UIViewController.attemptRotationToDeviceOrientation()
    }
}
