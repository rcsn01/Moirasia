import Foundation
import MoirasiaProtocol

final class FeatureServiceSupervisor {
    enum HealthState: String {
        case starting
        case running
        case error
        case stopped
    }

    typealias EventHandler = (HostEvent) -> Void
    typealias ExitHandler = () -> Void
    typealias HealthHandler = (_ state: HealthState, _ error: String?, _ restartCount: Int) -> Void

    private let executablePath: String
    private let userData: String
    private let eventHandler: EventHandler
    private let exitHandler: ExitHandler
    private let healthHandler: HealthHandler
    private var process: Process?
    private var input: FileHandle?
    private var decoder = LineDecoder()
    private var pending: [String: (HostResponse) -> Void] = [:]
    private let lock = NSLock()
    private var restartCount = 0
    private var lifecycleGeneration: UInt64 = 0
    private var stopped = true
    private var reportedStopped = false

    private let bondedHelperExecutable: String?
    private let shoutDriverDirectory: String?

    init(executablePath: String, userData: String, bondedHelperExecutable: String?, shoutDriverDirectory: String?, eventHandler: @escaping EventHandler, exitHandler: @escaping ExitHandler, healthHandler: @escaping HealthHandler) {
        self.executablePath = executablePath
        self.userData = userData
        self.bondedHelperExecutable = bondedHelperExecutable
        self.shoutDriverDirectory = shoutDriverDirectory
        self.eventHandler = eventHandler
        self.exitHandler = exitHandler
        self.healthHandler = healthHandler
    }

    func start() throws {
        lock.lock()
        stopped = false
        reportedStopped = false
        restartCount = 0
        lifecycleGeneration &+= 1
        let generation = lifecycleGeneration
        lock.unlock()
        report(.starting, error: nil, restartCount: 0)
        do {
            try launch(generation: generation)
            report(.running, error: nil, restartCount: 0)
        } catch {
            serviceFailed(generation: generation, error: error)
            throw error
        }
    }

    func stop() {
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true
        lifecycleGeneration &+= 1
        let child = process
        process = nil
        input = nil
        let callbacks = pending.values
        pending.removeAll()
        let shouldReport = !reportedStopped
        reportedStopped = true
        lock.unlock()

        child?.terminate()
        callbacks.forEach { $0(HostResponse(id: UUID().uuidString, error: HostError(code: "feature_service_unavailable", message: "MoirasiaFeatureService stopped."))) }
        if shouldReport { report(.stopped, error: nil, restartCount: restartCount) }
    }

    func request(_ request: HostRequest, completion: @escaping (HostResponse) -> Void) {
        lock.lock()
        guard !stopped, let input else {
            lock.unlock()
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: "Feature service is not running.")))
            return
        }
        pending[request.id] = completion
        lock.unlock()
        do {
            try FramedWriter(handle: input).send(.request(request))
        } catch {
            lock.lock(); pending.removeValue(forKey: request.id); lock.unlock()
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: error.localizedDescription)))
        }
    }

    private func launch(generation: UInt64) throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: executablePath)
        var arguments = ["--stdio", "--user-data", userData]
        if let bondedHelperExecutable, !bondedHelperExecutable.isEmpty { arguments += ["--bonded-helper", bondedHelperExecutable] }
        if let shoutDriverDirectory, !shoutDriverDirectory.isEmpty { arguments += ["--shout-driver", shoutDriverDirectory] }
        child.arguments = arguments
        let childInput = Pipe()
        let childOutput = Pipe()
        child.standardInput = childInput
        child.standardOutput = childOutput
        child.standardError = FileHandle.standardError
        child.terminationHandler = { [weak self] _ in self?.serviceExited(generation: generation, error: "MoirasiaFeatureService exited.") }
        lock.lock()
        guard !stopped, generation == lifecycleGeneration else {
            lock.unlock()
            return
        }
        process = child
        input = nil
        decoder = LineDecoder()
        lock.unlock()
        do {
            try child.run()
        } catch {
            lock.lock()
            if process === child { process = nil }
            lock.unlock()
            throw error
        }

        lock.lock()
        guard !stopped, generation == lifecycleGeneration, process === child else {
            lock.unlock()
            child.terminate()
            return
        }
        input = childInput.fileHandleForWriting
        lock.unlock()

        let output = childOutput.fileHandleForReading
        SafeIO.makeNonBlocking(output.fileDescriptor)
        output.readabilityHandler = { [weak self] handle in
            guard let result = SafeIO.drain(descriptor: handle.fileDescriptor) else { return }
            if !result.data.isEmpty { self?.receive(result.data, generation: generation) }
            if result.ended {
                handle.readabilityHandler = nil
                self?.serviceExited(generation: generation, error: "MoirasiaFeatureService output closed.")
            }
        }
    }

    private func receive(_ data: Data, generation: UInt64) {
        lock.lock(); let current = generation == lifecycleGeneration && !stopped; lock.unlock()
        guard current else { return }
        do {
            for message in try decoder.append(data) {
                switch message {
                case .event(let event): eventHandler(event)
                case .response(let response):
                    lock.lock(); let completion = pending.removeValue(forKey: response.id); lock.unlock()
                    completion?(response)
                case .request: break
                }
            }
        } catch {
            serviceExited(generation: generation, error: "MoirasiaFeatureService protocol error: \(error)")
        }
    }

    private func serviceExited(generation: UInt64, error: String) {
        lock.lock()
        guard !stopped, generation == lifecycleGeneration, process != nil else { lock.unlock(); return }
        process = nil
        input = nil
        let callbacks = pending.values
        pending.removeAll()
        restartCount += 1
        let attempt = restartCount
        lock.unlock()
        callbacks.forEach { $0(HostResponse(id: UUID().uuidString, error: HostError(code: "feature_service_crashed", message: error))) }
        report(.error, error: error, restartCount: attempt)
        exitHandler()
        guard attempt <= 3 else { return }
        let delay = UInt64(250_000 * (1 << max(0, attempt - 1)))
        lock.lock(); lifecycleGeneration &+= 1; let nextGeneration = lifecycleGeneration; lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + .microseconds(Int(delay))) { [weak self] in
            guard let self else { return }
            self.lock.lock(); let canRestart = !self.stopped && self.lifecycleGeneration == nextGeneration; self.lock.unlock()
            guard canRestart else { return }
            self.report(.starting, error: nil, restartCount: attempt)
            do {
                try self.launch(generation: nextGeneration)
                self.report(.running, error: nil, restartCount: attempt)
            } catch {
                self.serviceFailed(generation: nextGeneration, error: error)
            }
        }
    }

    private func serviceFailed(generation: UInt64, error: Error) {
        let message = error.localizedDescription
        lock.lock()
        guard !stopped, generation == lifecycleGeneration else { lock.unlock(); return }
        restartCount += 1
        let attempt = restartCount
        lock.unlock()
        report(.error, error: message, restartCount: attempt)
        exitHandler()
        guard attempt <= 3 else { return }
        lock.lock(); lifecycleGeneration &+= 1; let nextGeneration = lifecycleGeneration; lock.unlock()
        let delay = UInt64(250_000 * (1 << max(0, attempt - 1)))
        DispatchQueue.global().asyncAfter(deadline: .now() + .microseconds(Int(delay))) { [weak self] in
            guard let self else { return }
            self.lock.lock(); let canRestart = !self.stopped && self.lifecycleGeneration == nextGeneration; self.lock.unlock()
            guard canRestart else { return }
            self.report(.starting, error: nil, restartCount: attempt)
            do {
                try self.launch(generation: nextGeneration)
                self.report(.running, error: nil, restartCount: attempt)
            } catch {
                self.serviceFailed(generation: nextGeneration, error: error)
            }
        }
    }

    private func report(_ state: HealthState, error: String?, restartCount: Int) {
        healthHandler(state, error, restartCount)
    }
}
