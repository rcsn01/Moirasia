import Darwin
import Foundation

final class SignalCoordinator {
    private let source: DispatchSourceSignal
    init(onTerminate: @escaping () -> Void) {
        signal(SIGTERM, SIG_IGN)
        source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler(handler: onTerminate)
        source.resume()
    }
}
