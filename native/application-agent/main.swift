import AppKit
import Foundation

struct Product { let id: String; let name: String; let bundleIdentifier: String }
let products = [Product(id: "amove", name: "Amove", bundleIdentifier: "com.opense.Amove"), Product(id: "vox", name: "Vox", bundleIdentifier: "com.moirasia.vox"), Product(id: "exithibition", name: "Exithibition", bundleIdentifier: "com.local.Exithibition"), Product(id: "bonded", name: "Bonded", bundleIdentifier: "com.opense.Bonded")]
func path(for product: Product) -> String? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: product.bundleIdentifier)?.path }
func running(_ product: Product) -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: product.bundleIdentifier) }
func printJSON(_ value: Any) { let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); print(String(data: data, encoding: .utf8)!) }
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
default: exit(64)
}
