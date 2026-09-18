import AppKit
import Foundation
import MoirasiaProtocol

func value(after flag: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
    return arguments[index + 1]
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.first == "--stdio", let userData = value(after: "--user-data", in: arguments) else {
    fputs("Usage: MoirasiaFeatureService --stdio --user-data PATH [--bonded-helper PATH]\n", stderr)
    exit(64)
}
let bondedHelper = value(after: "--bonded-helper", in: arguments)
let shoutDriver = value(after: "--shout-driver", in: arguments)

let writeLock = NSLock()
let runtime = FeatureRuntime(userData: userData, bondedHelperExecutable: bondedHelper, shoutDriverDirectory: shoutDriver) { event in
    writeLock.lock()
    defer { writeLock.unlock() }
    do { try FramedWriter(handle: .standardOutput).send(.event(event)) }
    catch { fputs("MoirasiaFeatureService could not publish event: \(error)\n", stderr) }
}
let signals = SignalCoordinator { runtime.stopAll(); exit(0) }
_ = signals
signal(SIGPIPE, SIG_IGN) // POSIX writes report EPIPE as an error, never as a signal
let parent = ParentConnection(runtime: runtime)
parent.start()
// Carbon global hotkeys (Amove) need a running application event loop; the
// activation policy keeps the service out of the Dock.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
application.run()
