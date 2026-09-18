import Foundation
import MoirasiaProtocol

protocol FeatureModule: AnyObject {
    var id: String { get }
    var isRunning: Bool { get }
    var error: String? { get }
    /// Runtime hook: request a feature-snapshot event from the service.
    var publishHook: (() -> Void)? { get set }
    /// Runtime hook: emit a named protocol event (e.g. `ui.toggleShelf`).
    var eventHook: ((String) -> Void)? { get set }
    func snapshot() -> JSONValue
    func start() throws
    func stop()
    func handle(_ request: HostRequest) throws -> JSONValue
}

class BasicFeatureModule: FeatureModule {
    let id: String
    private(set) var isRunning = false
    private(set) var error: String?
    /// Runtime hook: request a feature-snapshot event from the service.
    var publishHook: (() -> Void)?
    /// Runtime hook: emit a named protocol event.
    var eventHook: ((String) -> Void)?

    init(id: String) { self.id = id }

    func start() throws {
        error = nil
        isRunning = true
    }

    func stop() { isRunning = false }

    func snapshot() -> JSONValue { .object(["version": .number(1), "state": .string(isRunning ? "running" : "stopped")]) }

    func handle(_ request: HostRequest) throws -> JSONValue {
        guard isRunning else { throw HostError(code: "feature_stopped", message: "Feature '\(id)' is stopped.") }
        if request.method == "\(id).getSnapshot" || request.method == "\(id).snapshot" { return snapshot() }
        return .object(["accepted": .bool(true)])
    }
}
