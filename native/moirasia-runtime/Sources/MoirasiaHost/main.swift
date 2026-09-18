import AppKit
import Foundation

func argument(_ name: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
    return arguments[index + 1]
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.first == "--host" else { exit(64) }
guard let applicationPath = argument("--application", in: arguments),
      let userData = argument("--user-data", in: arguments),
      let featureService = argument("--feature-service", in: arguments) else {
    fputs("Usage: MoirasiaHost --host --application PATH --user-data PATH --feature-service PATH [--icon PATH] [--presence dock|menu-bar]\n", stderr)
    exit(64)
}
let iconPath = argument("--icon", in: arguments) ?? ""
let configuration = HostConfiguration(
    applicationPath: applicationPath,
    iconPath: iconPath,
    userData: userData,
    featureServicePath: featureService,
    presence: argument("--presence", in: arguments),
    bondedHelperPath: argument("--bonded-helper", in: arguments) ?? defaultStagedPath("features/bonded/native/BondedFirewallHelper"),
    shoutDriverPath: argument("--shout-driver", in: arguments) ?? defaultStagedPath("features/shout/driver/ShoutMic.driver")
)

/// Resolves feature resources next to the runtime bundle (dev:
/// native/staged/features, packaged: Contents/Resources/features).
func defaultStagedPath(_ relative: String) -> String? {
    let candidate = Bundle.main.bundleURL.appendingPathComponent("../../\(relative)").standardizedFileURL.path
    return FileManager.default.fileExists(atPath: candidate) ? candidate : nil
}

do {
    let host = try HostApplication(configuration: configuration)
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    application.delegate = host
    signal(SIGTERM, SIG_IGN)
    signal(SIGPIPE, SIG_IGN) // POSIX writes report EPIPE as an error, never as a signal
    let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    signalSource.setEventHandler { host.shutdown() }
    signalSource.resume()
    try host.start()
    application.run()
} catch let error as NSError where error.domain == NSPOSIXErrorDomain && error.code == Int(EWOULDBLOCK) {
    exit(0)
} catch {
    fputs("Could not start MoirasiaHost: \(error)\n", stderr)
    exit(70)
}
