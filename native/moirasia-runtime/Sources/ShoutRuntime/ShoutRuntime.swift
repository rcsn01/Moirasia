import AVFoundation
import Foundation
import MoirasiaProtocol
import ShoutAudioCore

public protocol MicrophonePermissionProvider: AnyObject {
    func authorizationStatus() -> String
    func requestAccess(completion: @escaping (Bool) -> Void)
}

public final class NativeMicrophonePermissionProvider: MicrophonePermissionProvider {
    public init() {}
    public func authorizationStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) { case .authorized: return "granted"; case .denied, .restricted: return "denied"; case .notDetermined: return "not-determined"; @unknown default: return "unknown" }
    }
    public func requestAccess(completion: @escaping (Bool) -> Void) { AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion) }
}

public struct ShoutDevice: Codable, Equatable, Sendable {
    public var uid: String
    public var name: String
    public var sampleRate: Double?
}

public struct ShoutRuntimeSnapshot: Codable, Equatable, Sendable {
    public var version = 1
    public var boostEnabled = false
    public var boostActive = false
    public var gainDb = 0.0
    public var limiterEnabled = true
    public var makeDefaultInput = false
    public var sourceMode = "follow-default"
    public var sourceUid: String?
    public var activeSourceUid: String?
    public var activeSourceName: String?
    public var captureState = "idle"
    public var permissionState = "unknown"
    public var shoutMicPresent = false
    public var defaultInputUid: String?
    public var defaultInputIsShoutMic = false
    public var meterPeakDbfs: Double?
    public var devices: [ShoutDevice] = []
    public var error: String?
}

/// Native Shout control plane. The HAL engine owns the realtime path; this
/// object owns permissions, persistence, and the feature-service-facing state.
public final class ShoutRuntime {
    public private(set) var snapshot: ShoutRuntimeSnapshot
    public let permission: MicrophonePermissionProvider
    private let directory: URL
    private let settingsStore: ShoutSettingsStore
    private var engine: ShoutEngine?
    public var onSnapshot: ((ShoutRuntimeSnapshot) -> Void)?

    public init(dataDirectory: String, permission: MicrophonePermissionProvider = NativeMicrophonePermissionProvider()) {
        directory = URL(fileURLWithPath: dataDirectory, isDirectory: true)
        settingsStore = ShoutSettingsStore(dataDirectory: dataDirectory)
        self.permission = permission
        let controls = settingsStore.load()
        snapshot = ShoutRuntimeSnapshot()
        snapshot.boostEnabled = controls.boostEnabled
        snapshot.gainDb = controls.gainDb
        snapshot.limiterEnabled = controls.limiterEnabled
        snapshot.makeDefaultInput = controls.makeDefaultInput
        snapshot.sourceMode = controls.sourceMode
        snapshot.sourceUid = controls.sourceUid
        snapshot.permissionState = permission.authorizationStatus()
    }

    public func start() {
        guard engine == nil else { publish(); return }
        let controls = storedControls()
        let resumeBoost = controls.boostEnabled && permission.authorizationStatus() == "granted"
        let runtime = ShoutEngine(dataDirectory: directory) { [weak self] event in self?.consume(event) }
        engine = runtime
        runtime.start()
        applyStoredControls(controls)
        if resumeBoost { setBoost(true) }
        publish()
    }

    public func stop() {
        engine?.shutdown()
        engine = nil
        snapshot.boostActive = false
        snapshot.captureState = "idle"
        writeRecovery(restored: true)
        publish()
    }

    public func setBoost(_ enabled: Bool, requestPermission: Bool = false, completion: ((Error?) -> Void)? = nil) {
        if enabled && snapshot.permissionState == "not-determined" {
            guard requestPermission else { snapshot.boostEnabled = true; snapshot.boostActive = false; snapshot.captureState = "blocked"; publish(); completion?(nil); return }
            permission.requestAccess { [weak self] granted in
                guard let self else { return }
                self.snapshot.permissionState = granted ? "granted" : "denied"
                guard granted else {
                    self.snapshot.boostEnabled = false
                    self.snapshot.boostActive = false
                    self.snapshot.captureState = "blocked"
                    self.snapshot.error = ShoutRuntimeError.permissionDenied.localizedDescription
                    self.publish()
                    completion?(ShoutRuntimeError.permissionDenied)
                    return
                }
                self.send(.setBoost, enabled: true, completion: completion)
            }
            return
        }
        if enabled && snapshot.permissionState != "granted" {
            snapshot.boostEnabled = false
            snapshot.boostActive = false
            snapshot.captureState = "blocked"
            snapshot.error = ShoutRuntimeError.permissionDenied.localizedDescription
            publish()
            completion?(ShoutRuntimeError.permissionDenied)
            return
        }
        send(.setBoost, enabled: enabled, completion: completion)
    }

    public func setGain(_ db: Double, completion: ((Error?) -> Void)? = nil) {
        send(.setGain, db: db) { [weak self] error in
            if error == nil { self?.snapshot.gainDb = db; self?.publish() }
            completion?(error)
        }
    }
    public func setLimiter(_ enabled: Bool, completion: ((Error?) -> Void)? = nil) {
        send(.setLimiter, enabled: enabled) { [weak self] error in
            if error == nil { self?.snapshot.limiterEnabled = enabled; self?.publish() }
            completion?(error)
        }
    }
    public func setMakeDefaultInput(_ enabled: Bool, completion: ((Error?) -> Void)? = nil) {
        send(.setDefaultInput, enabled: enabled) { [weak self] error in
            if error == nil { self?.snapshot.makeDefaultInput = enabled; self?.publish() }
            completion?(error)
        }
    }
    public func setSource(mode: String, uid: String?, completion: ((Error?) -> Void)? = nil) {
        guard let mode = SourceMode(rawValue: mode) else { completion?(ShoutRuntimeError.invalidSource); return }
        send(.setSource, mode: mode, uid: uid) { [weak self] error in
            if error == nil { self?.snapshot.sourceMode = mode.rawValue; self?.snapshot.sourceUid = mode == .device ? uid : nil; self?.publish() }
            completion?(error)
        }
    }

    private func storedControls() -> ShoutControlSettings {
        var controls = ShoutControlSettings()
        controls.boostEnabled = snapshot.boostEnabled
        controls.gainDb = snapshot.gainDb
        controls.limiterEnabled = snapshot.limiterEnabled
        controls.makeDefaultInput = snapshot.makeDefaultInput
        controls.sourceMode = snapshot.sourceMode
        controls.sourceUid = snapshot.sourceUid
        return controls
    }

    private func applyStoredControls(_ controls: ShoutControlSettings) {
        setGain(controls.gainDb)
        setLimiter(controls.limiterEnabled)
        setSource(mode: controls.sourceMode, uid: controls.sourceUid)
        setMakeDefaultInput(controls.makeDefaultInput)
    }

    private func send(_ type: HelperCommandType, enabled: Bool? = nil, db: Double? = nil, mode: SourceMode? = nil, uid: String? = nil, completion: ((Error?) -> Void)?) {
        guard let engine else {
            let error = ShoutRuntimeError.engine("Shout audio engine is not running.")
            snapshot.error = error.localizedDescription
            publish()
            completion?(error)
            return
        }
        let request = HelperRequest(id: Int.random(in: 1...Int.max), type: type, enabled: enabled, db: db, mode: mode, uid: uid)
        engine.handle(request) { [weak self] response in
            if let state = response.state { self?.consume(state) }
            let error = response.ok ? nil : ShoutRuntimeError.engine(response.error ?? "Shout audio engine rejected the request.")
            self?.snapshot.error = error?.localizedDescription
            if error != nil { self?.publish() }
            completion?(error)
        }
    }

    private func store(devices: [HelperDevice]) {
        snapshot.devices = devices.filter { !$0.isShoutMic }.map { ShoutDevice(uid: $0.uid, name: $0.name, sampleRate: $0.sampleRate) }
        snapshot.shoutMicPresent = snapshot.shoutMicPresent || devices.contains { $0.isShoutMic }
    }

    private func consume(_ event: HelperEvent) {
        if let state = event.state { consume(state) }
        if let devices = event.devices, event.event == "devices-changed" { store(devices: devices) }
        if event.event == "meter", let peak = event.peakDbfs { snapshot.meterPeakDbfs = peak }
        if event.event == "default-input-changed" { snapshot.defaultInputUid = event.defaultInputUid; snapshot.defaultInputIsShoutMic = event.defaultInputUid == "ShoutMic_UID" }
        if event.event == "error", let message = event.message { snapshot.error = message }
    }
    private func consume(_ state: HelperState) {
        snapshot.boostEnabled = state.boostEnabled
        snapshot.boostActive = state.boostActive
        snapshot.gainDb = state.gainDb
        snapshot.limiterEnabled = state.limiterEnabled
        snapshot.makeDefaultInput = state.makeDefaultInput
        snapshot.sourceMode = state.sourceMode.rawValue
        snapshot.sourceUid = state.sourceUid
        snapshot.activeSourceUid = state.activeSourceUid
        snapshot.activeSourceName = state.activeSourceName
        snapshot.captureState = state.captureState.rawValue
        snapshot.shoutMicPresent = state.shoutMicPresent
        snapshot.defaultInputUid = state.defaultInputUid
        snapshot.defaultInputIsShoutMic = state.defaultInputIsShoutMic
        publish()
    }

    private func publish() { writeSettings(); onSnapshot?(snapshot) }
    private func writeSettings() { try? settingsStore.save(storedControls()) }
    private func writeRecovery(restored: Bool) { let value = ["restored": restored, "timestamp": ISO8601DateFormatter().string(from: Date())] as [String: Any]; if let data = try? JSONSerialization.data(withJSONObject: value) { try? data.write(to: directory.appendingPathComponent("default-input-recovery.json"), options: .atomic) } }
}

public enum ShoutRuntimeError: Error, LocalizedError {
    case permissionDenied
    case invalidSource
    case engine(String)
    public var errorDescription: String? { switch self { case .permissionDenied: return "Microphone permission was denied."; case .invalidSource: return "Shout source mode is invalid."; case .engine(let message): return message } }
}
