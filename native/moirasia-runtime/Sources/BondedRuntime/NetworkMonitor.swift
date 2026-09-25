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
    private let stopTimeout: TimeInterval

    public init(executablePath: String = "/usr/bin/nettop", arguments: [String] = ["-L", "1", "-n", "-J", "state"], sampleInterval: TimeInterval = 1, stopTimeout: TimeInterval = 1) {
        self.executablePath = executablePath
        self.arguments = arguments
        self.sampleInterval = sampleInterval
        self.stopTimeout = stopTimeout
    }

    public func start() {
        enabled = true
        if process == nil && timer == nil { launch() }
    }

    public func stop() throws {
        enabled = false
        timer?.cancel(); timer = nil
        retryIndex = 0
        guard let child = process else {
            update(BondedMonitorStatus(state: "stopped", message: "Monitoring is off.", startedAt: nil, retryAt: nil))
            return
        }
        let terminated = DispatchSemaphore(value: 0)
        child.terminationHandler = { [weak self] process in
            terminated.signal()
            self?.handleTermination(of: process)
        }
        child.terminate()
        if child.isRunning && terminated.wait(timeout: .now() + stopTimeout) != .success {
            if child.isRunning { _ = Darwin.kill(child.processIdentifier, SIGKILL) }
            if child.isRunning && terminated.wait(timeout: .now() + stopTimeout) != .success {
                let error = NSError(domain: "com.moirasia.Bonded", code: 1, userInfo: [NSLocalizedDescriptionKey: "nettop did not exit after SIGTERM and SIGKILL."])
                update(BondedMonitorStatus(state: "error", message: error.localizedDescription, startedAt: nil, retryAt: nil))
                throw error
            }
        }
        if process === child { process = nil }
        update(BondedMonitorStatus(state: "stopped", message: "Monitoring is off.", startedAt: nil, retryAt: nil))
    }

    public func restart() throws { try stop(); start() }

    private func launch() {
        guard enabled, process == nil else { return }
        update(BondedMonitorStatus(state: "starting", message: "Starting network monitor…", startedAt: nil, retryAt: nil))
        let child = Process(); child.executableURL = URL(fileURLWithPath: executablePath); child.arguments = arguments
        let output = Pipe(); let error = Pipe(); child.standardOutput = output; child.standardError = error
        process = child
        child.terminationHandler = { [weak self] process in self?.handleTermination(of: process) }
        do { try child.run() } catch {
            if self.process === child { self.process = nil }
            scheduleRetry(message: error.localizedDescription)
            return
        }
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

    private func handleTermination(of child: Process) {
        guard process === child else { return }
        process = nil
        guard enabled else { return }
        if child.terminationReason == .exit && child.terminationStatus == 0 {
            retryIndex = 0
            scheduleNextSample()
        } else {
            scheduleRetry(message: "nettop exited unexpectedly.")
        }
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
