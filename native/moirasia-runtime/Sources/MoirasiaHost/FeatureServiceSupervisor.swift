import Foundation
import MoirasiaProtocol

protocol FeatureServiceSupervisorDriving: AnyObject {
    func start() throws
    func stop()
    func request(_ request: HostRequest, completion: @escaping (HostResponse, UInt64) -> Void)
}

final class FeatureServiceSupervisor: FeatureServiceSupervisorDriving {
    enum HealthState: String {
        case starting
        case running
        case error
        case stopped
    }

    typealias EventHandler = (HostEvent, UInt64) -> Void
    typealias ExitHandler = () -> Void
    typealias HealthHandler = (_ state: HealthState, _ error: String?, _ restartCount: Int, _ generation: UInt64) -> Void

    private struct PendingRequest {
        let id: String
        let generation: UInt64
        let completion: (HostResponse, UInt64) -> Void
    }

    private let executablePath: String
    private let userData: String
    private let eventHandler: EventHandler
    private let exitHandler: ExitHandler
    private let healthHandler: HealthHandler
    private var process: Process?
    private var input: FileHandle?
    private var pending: [String: PendingRequest] = [:]
    private let lock = NSLock()
    private var restartCount = 0
    private var lifecycleGeneration: UInt64 = 0
    private var reportedGeneration: UInt64 = 0
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
        reportedGeneration = generation
        lock.unlock()
        report(.starting, error: nil, restartCount: 0, generation: generation)
        do {
            try launch(generation: generation)
            report(.running, error: nil, restartCount: 0, generation: generation)
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
        let stoppedGeneration = reportedGeneration
        let stoppedRestartCount = restartCount
        process = nil
        input = nil
        let callbacks = Array(pending.values)
        pending.removeAll()
        let shouldReport = !reportedStopped
        reportedStopped = true
        lock.unlock()

        child?.terminate()
        callbacks.forEach { pending in
            pending.completion(HostResponse(id: pending.id, error: HostError(code: "feature_service_unavailable", message: "MoirasiaFeatureService stopped.")), pending.generation)
        }
        if shouldReport { report(.stopped, error: nil, restartCount: stoppedRestartCount, generation: stoppedGeneration) }
    }

    func request(_ request: HostRequest, completion: @escaping (HostResponse, UInt64) -> Void) {
        lock.lock()
        let requestGeneration = lifecycleGeneration
        guard !stopped, let input else {
            lock.unlock()
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: "Feature service is not running.")), requestGeneration)
            return
        }
        pending[request.id] = PendingRequest(id: request.id, generation: requestGeneration, completion: completion)
        lock.unlock()
        do {
            try FramedWriter(handle: input).send(.request(request))
        } catch {
            lock.lock(); let pendingRequest = pending.removeValue(forKey: request.id); lock.unlock()
            pendingRequest?.completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: error.localizedDescription)), requestGeneration)
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
        let childDecoder = LineDecoder()
        SafeIO.makeNonBlocking(output.fileDescriptor)
        output.readabilityHandler = { [weak self] handle in
            guard let result = SafeIO.drain(descriptor: handle.fileDescriptor) else { return }
            if !result.data.isEmpty { self?.receive(result.data, generation: generation, decoder: childDecoder) }
            if result.ended {
                handle.readabilityHandler = nil
                self?.serviceExited(generation: generation, error: "MoirasiaFeatureService output closed.")
            }
        }
    }

    private func receive(_ data: Data, generation: UInt64, decoder: LineDecoder) {
        lock.lock(); let current = generation == lifecycleGeneration && !stopped; lock.unlock()
        guard current else { return }
        do {
            for message in try decoder.append(data) {
                switch message {
                case .event(let event):
                    lock.lock(); let current = generation == lifecycleGeneration && !stopped; lock.unlock()
                    if current { eventHandler(event, generation) }
                case .response(let response):
                    lock.lock()
                    let pendingRequest: PendingRequest?
                    if generation == lifecycleGeneration, !stopped,
                       let currentRequest = pending[response.id], currentRequest.generation == generation {
                        pendingRequest = pending.removeValue(forKey: response.id)
                    } else {
                        pendingRequest = nil
                    }
                    lock.unlock()
                    if let pendingRequest { pendingRequest.completion(response, pendingRequest.generation) }
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
        let callbacks = Array(pending.values)
        pending.removeAll()
        restartCount += 1
        let attempt = restartCount
        lifecycleGeneration &+= 1
        let nextGeneration = lifecycleGeneration
        lock.unlock()
        callbacks.forEach { pending in
            pending.completion(HostResponse(id: pending.id, error: HostError(code: "feature_service_crashed", message: error)), pending.generation)
        }
        report(.error, error: error, restartCount: attempt, generation: generation)
        exitHandler()
        scheduleRestart(after: attempt, generation: nextGeneration)
    }

    private func serviceFailed(generation: UInt64, error: Error) {
        let message = error.localizedDescription
        lock.lock()
        guard !stopped, generation == lifecycleGeneration else { lock.unlock(); return }
        restartCount += 1
        let attempt = restartCount
        lifecycleGeneration &+= 1
        let nextGeneration = lifecycleGeneration
        lock.unlock()
        report(.error, error: message, restartCount: attempt, generation: generation)
        exitHandler()
        scheduleRestart(after: attempt, generation: nextGeneration)
    }

    private func scheduleRestart(after attempt: Int, generation nextGeneration: UInt64) {
        guard attempt <= 3 else { return }
        let delay = UInt64(250_000 * (1 << max(0, attempt - 1)))
        DispatchQueue.global().asyncAfter(deadline: .now() + .microseconds(Int(delay))) { [weak self] in
            guard let self, self.reportStarting(generation: nextGeneration, restartCount: attempt) else { return }
            do {
                try self.launch(generation: nextGeneration)
                self.report(.running, error: nil, restartCount: attempt, generation: nextGeneration)
            } catch {
                self.serviceFailed(generation: nextGeneration, error: error)
            }
        }
    }

    private func reportStarting(generation: UInt64, restartCount: Int) -> Bool {
        lock.lock()
        guard !stopped, lifecycleGeneration == generation else { lock.unlock(); return false }
        reportedGeneration = generation
        lock.unlock()
        report(.starting, error: nil, restartCount: restartCount, generation: generation)
        return true
    }

    private func report(_ state: HealthState, error: String?, restartCount: Int, generation: UInt64) {
        healthHandler(state, error, restartCount, generation)
    }
}
