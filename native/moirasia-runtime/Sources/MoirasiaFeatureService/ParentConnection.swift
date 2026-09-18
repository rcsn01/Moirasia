import Foundation
import MoirasiaProtocol

/// Reads framed requests from the parent via an event-driven stdin reader.
/// EOF (parent death) triggers a clean shutdown.
final class ParentConnection {
    private let input: FileHandle
    private let writer: FramedWriter
    private var decoder = LineDecoder()
    private let runtime: FeatureRuntime
    private var closed = false
    private let lock = NSLock()

    init(runtime: FeatureRuntime) {
        self.input = FileHandle.standardInput
        self.writer = FramedWriter(handle: .standardOutput)
        self.runtime = runtime
    }

    func start() {
        // The parent may send requests while startup is still in flight; the
        // reader is installed first so requests buffer and get answered.
        // POSIX drain: FileHandle's availableData raises at EOF (parent death).
        SafeIO.makeNonBlocking(input.fileDescriptor)
        input.readabilityHandler = { [weak self] incoming in
            guard let self else { incoming.readabilityHandler = nil; return }
            guard let result = SafeIO.drain(descriptor: incoming.fileDescriptor) else { return }
            if !result.data.isEmpty { self.process(result.data) }
            if result.ended { self.stop() }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.runtime.startInstalled() }
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return }
        closed = true
        input.readabilityHandler = nil
        runtime.stopAll()
    }

    private func process(_ data: Data) {
        lock.lock(); let stopped = closed; lock.unlock()
        guard !stopped else { return }
        do {
            for message in try decoder.append(data) {
                guard case .request(let request) = message else { continue }
                let response = runtime.handle(request)
                try writer.send(.response(response))
            }
        } catch {
            fputs("MoirasiaFeatureService protocol error: \(error)\n", stderr)
            stop()
            exit(0)
        }
    }
}