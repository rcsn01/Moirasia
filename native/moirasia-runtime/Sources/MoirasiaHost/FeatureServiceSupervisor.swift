import Foundation
import MoirasiaProtocol

final class FeatureServiceSupervisor {
    typealias EventHandler = (HostEvent) -> Void
    typealias ExitHandler = () -> Void

    private let executablePath: String
    private let userData: String
    private let eventHandler: EventHandler
    private let exitHandler: ExitHandler
    private var process: Process?
    private var input: FileHandle?
    private var decoder = LineDecoder()
    private var pending: [String: (HostResponse) -> Void] = [:]
    private let lock = NSLock()
    private var restartCount = 0
    private var stopped = false

    init(executablePath: String, userData: String, bondedHelperExecutable: String?, shoutDriverDirectory: String?, eventHandler: @escaping EventHandler, exitHandler: @escaping ExitHandler) {
        self.executablePath = executablePath
        self.userData = userData
        self.bondedHelperExecutable = bondedHelperExecutable
        self.shoutDriverDirectory = shoutDriverDirectory
        self.eventHandler = eventHandler
        self.exitHandler = exitHandler
    }

    private let bondedHelperExecutable: String?
    private let shoutDriverDirectory: String?

    func start() throws {
        stopped = false
        try launch()
    }

    func stop() {
        stopped = true
        process?.terminate()
        process = nil
        input = nil
        lock.lock(); pending.removeAll(); lock.unlock()
    }

    func request(_ request: HostRequest, completion: @escaping (HostResponse) -> Void) {
        lock.lock(); pending[request.id] = completion; lock.unlock()
        do {
            guard let input else { throw NSError(domain: "MoirasiaHost", code: 2, userInfo: [NSLocalizedDescriptionKey: "Feature service is not running."]) }
            try FramedWriter(handle: input).send(.request(request))
        } catch {
            lock.lock(); pending.removeValue(forKey: request.id); lock.unlock()
            completion(HostResponse(id: request.id, error: HostError(code: "feature_service_unavailable", message: error.localizedDescription)))
        }
    }

    private func launch() throws {
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
        child.terminationHandler = { [weak self] _ in self?.serviceExited() }
        try child.run()
        process = child
        input = childInput.fileHandleForWriting
        SafeIO.makeNonBlocking(childOutput.fileHandleForReading.fileDescriptor)
        childOutput.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let result = SafeIO.drain(descriptor: handle.fileDescriptor) else { return }
            if !result.data.isEmpty { self?.receive(result.data) }
            if result.ended { handle.readabilityHandler = nil }
        }
    }

    private func receive(_ data: Data) {
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
        } catch { serviceExited() }
    }

    private func serviceExited() {
        guard !stopped else { return }
        lock.lock()
        let callbacks = pending.values
        pending.removeAll()
        lock.unlock()
        callbacks.forEach { $0(HostResponse(id: UUID().uuidString, error: HostError(code: "feature_service_crashed", message: "MoirasiaFeatureService exited."))) }
        exitHandler()
        if restartCount < 3 {
            let delay = UInt64(250_000 * (1 << restartCount))
            restartCount += 1
            DispatchQueue.global().asyncAfter(deadline: .now() + .microseconds(Int(delay))) { [weak self] in
                guard let self, !self.stopped else { return }
                do { try self.launch() } catch { self.exitHandler() }
            }
        }
    }
}
