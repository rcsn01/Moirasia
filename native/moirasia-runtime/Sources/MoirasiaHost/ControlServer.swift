import Darwin
import Foundation
import MoirasiaProtocol

final class ControlServer {
    typealias RequestHandler = (ClientConnection, HostRequest) -> Void
    typealias DisconnectHandler = (ClientConnection) -> Void

    private let path: String
    private let handler: RequestHandler
    private let disconnected: DisconnectHandler
    private var descriptor: Int32 = -1
    private var accepting = true
    private let queue = DispatchQueue(label: "com.moirasia.host.control", qos: .userInitiated)
    private var clients: [ObjectIdentifier: ClientConnection] = [:]
    private let clientsLock = NSLock()

    init(path: String, handler: @escaping RequestHandler, disconnected: @escaping DisconnectHandler) {
        self.path = path
        self.handler = handler
        self.disconnected = disconnected
    }

    func start() throws {
        let directory = URL(fileURLWithPath: path).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(atPath: path) }
        let value = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard value >= 0 else { throw posixError() }
        descriptor = value
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8) + [0]
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard pathBytes.count <= capacity else { throw NSError(domain: "MoirasiaHost", code: 1, userInfo: [NSLocalizedDescriptionKey: "Socket path is too long."]) }
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            for (index, byte) in pathBytes.enumerated() { buffer[index] = byte }
        }
        let addressLength = socklen_t(MemoryLayout<sa_family_t>.size + pathBytes.count)
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(value, $0, addressLength) }
        }
        guard bindResult == 0 else { throw posixError() }
        chmod(path, 0o600)
        guard Darwin.listen(value, 16) == 0 else { throw posixError() }
        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        accepting = false
        if descriptor >= 0 { Darwin.shutdown(descriptor, SHUT_RDWR); Darwin.close(descriptor); descriptor = -1 }
        clientsLock.lock()
        let current = Array(clients.values)
        clients.removeAll()
        clientsLock.unlock()
        current.forEach { $0.close() }
        try? FileManager.default.removeItem(atPath: path)
    }

    func broadcast(_ event: HostEvent) {
        clientsLock.lock(); let current = Array(clients.values); clientsLock.unlock()
        current.forEach { $0.send(.event(event)) }
    }

    func hasAuthenticatedClient() -> Bool {
        clientsLock.lock(); let result = clients.values.contains(where: { $0.isAuthenticated() }); clientsLock.unlock()
        return result
    }

    private func acceptLoop() {
        while accepting {
            let clientDescriptor = Darwin.accept(descriptor, nil, nil)
            if clientDescriptor < 0 {
                if accepting { usleep(20_000) }
                continue
            }
            let client = ClientConnection(descriptor: clientDescriptor, handler: handler, disconnected: { [weak self] client in
                self?.remove(client)
                self?.disconnected(client)
            })
            clientsLock.lock(); clients[ObjectIdentifier(client)] = client; clientsLock.unlock()
            client.start()
        }
    }

    private func remove(_ client: ClientConnection) {
        clientsLock.lock(); clients.removeValue(forKey: ObjectIdentifier(client)); clientsLock.unlock()
    }

    private func posixError() -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
}

final class ClientConnection: @unchecked Sendable {
    private let handle: FileHandle
    private let writer: FramedWriter
    private let handler: ControlServer.RequestHandler
    private let disconnected: (ClientConnection) -> Void
    private var decoder = LineDecoder()
    private var authenticated = false
    private var requestIDs = Set<String>()
    private var closed = false
    private var disconnectedNotified = false
    private let lock = NSLock()

    init(descriptor: Int32, handler: @escaping ControlServer.RequestHandler, disconnected: @escaping (ClientConnection) -> Void) {
        self.handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        // POSIX reads need non-blocking descriptors so draining in the
        // readability handler cannot stall; EOF is handled as a return value.
        SafeIO.makeNonBlocking(descriptor)
        self.writer = FramedWriter(handle: handle)
        self.handler = handler
        self.disconnected = disconnected
    }

    func start() {
        handle.readabilityHandler = { [weak self] incoming in
            guard let self else { incoming.readabilityHandler = nil; return }
            guard let result = SafeIO.drain(descriptor: incoming.fileDescriptor) else { return }
            if !result.data.isEmpty { self.process(result.data) }
            guard result.ended else { return }
            incoming.readabilityHandler = nil
            self.close()
        }
    }

    func send(_ message: HostMessage) {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        do {
            try writer.send(message)
            lock.unlock()
        } catch {
            lock.unlock()
            close()
        }
    }

    func close() {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        closed = true
        handle.readabilityHandler = nil
        try? handle.close()
        let shouldNotify = !disconnectedNotified
        disconnectedNotified = true
        lock.unlock()
        if shouldNotify { disconnected(self) }
    }

    func authenticate(token: String, expected: String) -> Bool {
        guard token == expected else { return false }
        lock.lock(); authenticated = true; lock.unlock()
        return true
    }

    func isAuthenticated() -> Bool { lock.lock(); defer { lock.unlock() }; return authenticated }

    /// Readability callbacks are serialized per file handle; decoder and
    /// request bookkeeping live on that single queue, `closed` is shared.
    private func process(_ data: Data) {
        lock.lock(); let stopped = closed; lock.unlock()
        guard !stopped else { return }
        do {
            for message in try decoder.append(data) {
                guard case .request(let request) = message else { throw ProtocolError.invalidEnvelope }
                if requestIDs.contains(request.id) { throw ProtocolError.duplicateRequest(request.id) }
                requestIDs.insert(request.id)
                handler(self, request)
            }
        } catch {
            let id = UUID().uuidString
            send(.response(HostResponse(id: id, error: HostError(code: "protocol_error", message: String(describing: error)))))
            close()
        }
    }
}
