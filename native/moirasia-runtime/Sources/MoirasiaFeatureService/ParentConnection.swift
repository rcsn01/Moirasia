import Darwin
import Foundation
import MoirasiaProtocol

/// Reads framed requests from the parent via an event-driven stdin reader.
/// EOF (parent death) terminates the feature service instead of leaving a
/// detached owner behind.
final class ParentConnection {
    private let input: FileHandle
    private let writer: FramedWriter
    private var decoder = LineDecoder()
    private let runtime: FeatureRuntime
    private var closed = false
    private let lock = NSLock()
    private let stateQueue: DispatchQueue

    init(runtime: FeatureRuntime, writer: FramedWriter, stateQueue: DispatchQueue) {
        self.input = FileHandle.standardInput
        self.writer = writer
        self.runtime = runtime
        self.stateQueue = stateQueue
    }

    func start() {
        // Install the reader before starting modules. Requests are serialized
        // behind startInstalled on the same queue, so no module can race its
        // initial lease or settings load.
        SafeIO.makeNonBlocking(input.fileDescriptor)
        input.readabilityHandler = { [weak self] incoming in
            guard let self else { incoming.readabilityHandler = nil; return }
            guard let result = SafeIO.drain(descriptor: incoming.fileDescriptor) else { return }
            if !result.data.isEmpty { self.process(result.data) }
            if result.ended { self.parentEnded() }
        }
        stateQueue.async { [weak self] in self?.runtime.startInstalled() }
    }

    func stop() {
        guard markClosed() else { return }
        stateQueue.async { [runtime] in Self.stopAndLog(runtime) }
    }

    private func parentEnded() {
        guard markClosed() else { return }
        stateQueue.async { [runtime] in
            Self.stopAndLog(runtime)
            Darwin.exit(0)
        }
    }

    private static func stopAndLog(_ runtime: FeatureRuntime) {
        for error in runtime.stopAll() { fputs("MoirasiaFeatureService cleanup failed: \(error)\n", stderr) }
    }

    private func markClosed() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !closed else { return false }
        closed = true
        input.readabilityHandler = nil
        return true
    }

    private func process(_ data: Data) {
        lock.lock(); let stopped = closed; lock.unlock()
        guard !stopped else { return }
        do {
            for message in try decoder.append(data) {
                guard case .request(let request) = message else { throw ProtocolError.invalidEnvelope }
                stateQueue.async { [weak self] in
                    guard let self else { return }
                    self.lock.lock(); let active = !self.closed; self.lock.unlock()
                    guard active else { return }
                    do { try self.writer.send(.response(self.runtime.handle(request))) }
                    catch {
                        fputs("MoirasiaFeatureService output error: \(error)\n", stderr)
                        self.parentEnded()
                    }
                }
            }
        } catch {
            fputs("MoirasiaFeatureService protocol error: \(error)\n", stderr)
            parentEnded()
        }
    }
}
