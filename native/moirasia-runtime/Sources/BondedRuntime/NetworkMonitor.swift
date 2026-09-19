import Foundation
import MoirasiaProtocol

public struct BondedMonitorStatus: Codable, Equatable, Sendable {
    public var state: String
    public var message: String
    public var startedAt: String?
    public var retryAt: String?
}

public final class NetworkMonitor {
    public var onSample: ((BondedNetworkSample) -> Void)?
    public var onStatus: ((BondedMonitorStatus) -> Void)?
    private var process: Process?
    private var timer: DispatchWorkItem?
    private var enabled = false
    private var retryIndex = 0
    private(set) public var status = BondedMonitorStatus(state: "stopped", message: "Monitoring is off.", startedAt: nil, retryAt: nil)
    private let parser = NettopCSVParser()
    private let executablePath: String
    private let arguments: [String]
    private let sampleInterval: TimeInterval

    public init(executablePath: String = "/usr/bin/nettop", arguments: [String] = ["-L", "1", "-n", "-J", "state"], sampleInterval: TimeInterval = 1) {
        self.executablePath = executablePath
        self.arguments = arguments
        self.sampleInterval = sampleInterval
    }

    public func start() {
        enabled = true
        if process == nil && timer == nil { launch() }
    }

    public func stop() {
        enabled = false
        timer?.cancel(); timer = nil
        process?.terminate(); process = nil
        retryIndex = 0
        update(BondedMonitorStatus(state: "stopped", message: "Monitoring is off.", startedAt: nil, retryAt: nil))
    }

    public func restart() { stop(); start() }

    private func launch() {
        guard enabled, process == nil else { return }
        update(BondedMonitorStatus(state: "starting", message: "Starting network monitor…", startedAt: nil, retryAt: nil))
        let child = Process(); child.executableURL = URL(fileURLWithPath: executablePath); child.arguments = arguments
        let output = Pipe(); let error = Pipe(); child.standardOutput = output; child.standardError = error
        child.terminationHandler = { [weak self] process in
            guard let self, self.process === process, self.enabled else { return }
            self.process = nil
            if process.terminationReason == .exit && process.terminationStatus == 0 {
                self.retryIndex = 0
                self.scheduleNextSample()
            } else {
                self.scheduleRetry(message: "nettop exited unexpectedly.")
            }
        }
        do { try child.run() } catch { scheduleRetry(message: error.localizedDescription); return }
        process = child
        update(BondedMonitorStatus(state: "running", message: "Watching live network activity.", startedAt: ISO8601DateFormatter().string(from: Date()), retryAt: nil))
        SafeIO.makeNonBlocking(output.fileHandleForReading.fileDescriptor)
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let result = SafeIO.drain(descriptor: handle.fileDescriptor) else { return }
            if result.ended { handle.readabilityHandler = nil; return }
            if !result.data.isEmpty { self?.retryIndex = 0 }
            for line in String(decoding: result.data, as: UTF8.self).split(whereSeparator: \.isNewline) { if let sample = self?.parser.parse(String(line)) { self?.onSample?(sample) } }
        }
        _ = error
    }

    private func scheduleNextSample() {
        guard enabled else { return }
        let startedAt = status.startedAt ?? ISO8601DateFormatter().string(from: Date())
        update(BondedMonitorStatus(state: "running", message: "Watching live network activity.", startedAt: startedAt, retryAt: nil))
        let work = DispatchWorkItem { [weak self] in self?.timer = nil; self?.launch() }
        timer = work; DispatchQueue.global().asyncAfter(deadline: .now() + sampleInterval, execute: work)
    }

    private func scheduleRetry(message: String) {
        guard enabled else { return }
        let delays: [TimeInterval] = [1, 2, 5, 10, 30]
        let delay = delays[min(retryIndex, delays.count - 1)]; retryIndex += 1
        let retryAt = Date().addingTimeInterval(delay)
        update(BondedMonitorStatus(state: "retrying", message: "Monitor interrupted. Retrying in \(Int(delay))s.", startedAt: nil, retryAt: ISO8601DateFormatter().string(from: retryAt)))
        let work = DispatchWorkItem { [weak self] in self?.timer = nil; self?.launch() }
        timer = work; DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func update(_ value: BondedMonitorStatus) { status = value; onStatus?(value) }
}
