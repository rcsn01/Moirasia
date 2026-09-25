import Foundation
import MoirasiaProtocol

protocol FeatureModule: AnyObject {
    var id: String { get }
    var isRunning: Bool { get }
    var error: String? { get }
    /// Request a feature snapshot; callbacks may originate on module-owned queues.
    /// FeatureRuntime schedules snapshot publication asynchronously.
    var publishHook: (() -> Void)? { get set }
    /// Emit a named event (e.g. `ui.toggleShelf`); FeatureRuntime serializes publication.
    var eventHook: ((String) -> Void)? { get set }
    func snapshot() -> JSONValue
    func start() throws
    func stop() throws
    func handle(_ request: HostRequest) throws -> JSONValue
}

class BasicFeatureModule: FeatureModule {
    let id: String
    private(set) var isRunning = false
    private(set) var error: String?
    /// Request a feature snapshot; callbacks may originate on module-owned queues.
    /// FeatureRuntime schedules snapshot publication asynchronously.
    var publishHook: (() -> Void)?
    /// Emit a named event; FeatureRuntime serializes publication.
    var eventHook: ((String) -> Void)?

    init(id: String) { self.id = id }

    func start() throws {
        error = nil
        isRunning = true
    }

    func stop() throws { isRunning = false }

    func snapshot() -> JSONValue { .object(["version": .number(1), "state": .string(isRunning ? "running" : "stopped")]) }

    func handle(_ request: HostRequest) throws -> JSONValue {
        guard isRunning else { throw HostError(code: "feature_stopped", message: "Feature '\(id)' is stopped.") }
        if request.method == "\(id).getSnapshot" || request.method == "\(id).snapshot" { return snapshot() }
        return .object(["accepted": .bool(true)])
    }
}
