import AppKit
import Foundation

final class ElectronLauncher {
    private let applicationPath: String
    private var terminationObserver: NSObjectProtocol?
    /// Fired when the desktop application exits, so the host can reset the
    /// global-hotkey dispatch policy in the feature service.
    var onApplicationExit: (() -> Void)?

    init(applicationPath: String) { self.applicationPath = applicationPath }

    func show(arguments: [String] = ["--moirasia-open=shell"]) {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.moirasia.desktop")
        if let application = running.first {
            application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.arguments = arguments
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: applicationPath), configuration: configuration) { _, error in
            if let error { fputs("Could not launch Moirasia: \(error)\n", stderr) }
        }
    }

    func terminate() {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.moirasia.desktop").forEach { _ = $0.terminate() }
    }

    func observeTermination() {
        guard terminationObserver == nil else { return }
        let center = NSWorkspace.shared.notificationCenter
        let observer = center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            guard let application = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, application.bundleIdentifier == "com.moirasia.desktop" else { return }
            self?.onApplicationExit?()
        }
        terminationObserver = observer
    }

    deinit {
        if let observer = terminationObserver { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    }
}