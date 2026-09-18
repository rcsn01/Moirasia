import AppKit
import Darwin
import Foundation

struct Product { let id: String; let name: String; let bundleIdentifier: String }
let products = [Product(id: "amove", name: "Amove", bundleIdentifier: "com.opense.Amove"), Product(id: "vox", name: "Vox", bundleIdentifier: "com.moirasia.vox"), Product(id: "bonded", name: "Bonded", bundleIdentifier: "com.opense.Bonded")]
func path(for product: Product) -> String? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: product.bundleIdentifier)?.path }
func running(_ product: Product) -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: product.bundleIdentifier) }
func printJSON(_ value: Any) { let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(data: data, encoding: .utf8)!) }

final class MenuBarHost: NSObject, NSApplicationDelegate {
    private let appPath: String
    private let iconPath: String
    private let pidPath: String
    private let lockDescriptor: Int32
    private var statusItem: NSStatusItem?

    init(appPath: String, iconPath: String, pidPath: String) throws {
        self.appPath = appPath
        self.iconPath = iconPath
        self.pidPath = pidPath
        let directory = URL(fileURLWithPath: pidPath).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let descriptor = Darwin.open(pidPath, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EWOULDBLOCK))
        }
        lockDescriptor = descriptor
        let pid = "\(getpid())\n"
        _ = ftruncate(descriptor, 0)
        _ = pid.withCString { write(descriptor, $0, strlen($0)) }
        _ = fsync(descriptor)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(contentsOfFile: iconPath) {
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            item.button?.image = image
        } else {
            item.button?.title = "M"
        }
        item.button?.toolTip = "Moirasia"
        item.button?.target = self
        item.button?.action = #selector(showMoirasia)
        let menu = NSMenu()
        let show = NSMenuItem(title: "Show Moirasia", action: #selector(showMoirasia), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Moirasia", action: #selector(quitMoirasia), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    @objc private func showMoirasia() {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.moirasia.desktop")
        if let instance = running.first {
            instance.activate(options: [.activateAllWindows])
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: appPath), configuration: configuration) { _, error in
            if let error { fputs("Could not launch Moirasia: \(error)\n", stderr) }
        }
    }

    @objc private func quitMoirasia() {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.moirasia.desktop").forEach { _ = $0.terminate() }
        NSApplication.shared.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        statusItem = nil
        try? FileManager.default.removeItem(atPath: pidPath)
        _ = flock(lockDescriptor, LOCK_UN)
        Darwin.close(lockDescriptor)
    }
}

func runMenuBarHost(arguments: [String]) -> Never {
    guard arguments.count == 4 else { exit(64) }
    do {
        let host = try MenuBarHost(appPath: arguments[1], iconPath: arguments[2], pidPath: arguments[3])
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.delegate = host
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { application.terminate(nil) }
        source.resume()
        application.run()
        exit(0)
    } catch let error as NSError where error.domain == NSPOSIXErrorDomain && error.code == Int(EWOULDBLOCK) {
        exit(0)
    } catch {
        fputs("Could not start Moirasia menu host: \(error)\n", stderr)
        exit(70)
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else { exit(64) }
switch command {
case "snapshot":
    printJSON(products.map { product in var value: [String: Any] = ["id": product.id, "installed": path(for: product) != nil, "running": !running(product).isEmpty]; if let applicationPath = path(for: product) { value["path"] = applicationPath }; return value })
case "open":
    guard arguments.count >= 2, let product = products.first(where: { $0.id == arguments[1] }), let applicationPath = path(for: product) else { exit(66) }
    if let instance = running(product).first { instance.activate(options: [.activateAllWindows]) }
    else { let configuration = NSWorkspace.OpenConfiguration(); configuration.activates = true; let semaphore = DispatchSemaphore(value: 0); var failure: Error?; NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: applicationPath), configuration: configuration) { _, error in failure = error; semaphore.signal() }; semaphore.wait(); if let failure { fputs("\(failure)\n", stderr); exit(70) } }
case "quit":
    guard arguments.count >= 2, let product = products.first(where: { $0.id == arguments[1] }) else { exit(64) }
    running(product).forEach { _ = $0.terminate() }; let deadline = Date().addingTimeInterval(9.5); while Date() < deadline && !running(product).isEmpty { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }; printJSON(["exited": running(product).isEmpty])
case "login-items-settings":
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension")!)
case "menu-host":
    runMenuBarHost(arguments: arguments)
default:
    exit(64)
}
