// NDJSON protocol between the Electron main process and the ShoutAudioHelper
// process. One JSON object per line on stdin (requests) and stdout (responses
// and events). The TypeScript side mirrors these shapes in
// src/shared/contracts.ts; both sides must stay in lockstep.

public enum HelperCommandType: String, Codable, Sendable, Equatable {
    case getState = "get-state"
    case getDevices = "get-devices"
    case setBoost = "set-boost"
    case setGain = "set-gain"
    case setLimiter = "set-limiter"
    case setSource = "set-source"
    case setDefaultInput = "set-default-input"
}

/// Capture lifecycle as reported to the UI.
public enum CaptureState: String, Codable, Sendable, Equatable {
    case idle
    case capturing
    case noSource
    case blocked
}

public struct HelperRequest: Codable, Sendable, Equatable {
    public var id: Int
    public var type: HelperCommandType
    public var enabled: Bool?
    public var db: Double?
    public var mode: SourceMode?
    public var uid: String?

    public init(id: Int, type: HelperCommandType, enabled: Bool? = nil, db: Double? = nil, mode: SourceMode? = nil, uid: String? = nil) {
        self.id = id
        self.type = type
        self.enabled = enabled
        self.db = db
        self.mode = mode
        self.uid = uid
    }
}

public struct HelperDevice: Codable, Sendable, Equatable {
    public var uid: String
    public var name: String
    public var isShoutMic: Bool
    public var sampleRate: Double?

    public init(uid: String, name: String, isShoutMic: Bool, sampleRate: Double? = nil) {
        self.uid = uid
        self.name = name
        self.isShoutMic = isShoutMic
        self.sampleRate = sampleRate
    }
}

public struct HelperState: Codable, Sendable, Equatable {
    public var version: Int
    /// Requested boost state (what the UI toggled).
    public var boostEnabled: Bool
    /// Whether capture + render IO is actually running.
    public var boostActive: Bool
    public var gainDb: Double
    public var limiterEnabled: Bool
    public var makeDefaultInput: Bool
    public var sourceMode: SourceMode
    /// Pinned source UID in device mode.
    public var sourceUid: String?
    /// Device actually being captured right now.
    public var activeSourceUid: String?
    public var activeSourceName: String?
    public var shoutMicPresent: Bool
    public var shoutMicUid: String
    public var defaultInputUid: String?
    public var defaultInputIsShoutMic: Bool
    public var captureState: CaptureState

    public init(
        version: Int = 1,
        boostEnabled: Bool = false,
        boostActive: Bool = false,
        gainDb: Double = 0,
        limiterEnabled: Bool = true,
        makeDefaultInput: Bool = false,
        sourceMode: SourceMode = .followDefault,
        sourceUid: String? = nil,
        activeSourceUid: String? = nil,
        activeSourceName: String? = nil,
        shoutMicPresent: Bool = false,
        shoutMicUid: String,
        defaultInputUid: String? = nil,
        defaultInputIsShoutMic: Bool = false,
        captureState: CaptureState = .idle
    ) {
        self.version = version
        self.boostEnabled = boostEnabled
        self.boostActive = boostActive
        self.gainDb = gainDb
        self.limiterEnabled = limiterEnabled
        self.makeDefaultInput = makeDefaultInput
        self.sourceMode = sourceMode
        self.sourceUid = sourceUid
        self.activeSourceUid = activeSourceUid
        self.activeSourceName = activeSourceName
        self.shoutMicPresent = shoutMicPresent
        self.shoutMicUid = shoutMicUid
        self.defaultInputUid = defaultInputUid
        self.defaultInputIsShoutMic = defaultInputIsShoutMic
        self.captureState = captureState
    }
}

public struct HelperResponse: Codable, Sendable, Equatable {
    public var id: Int
    public var ok: Bool
    public var state: HelperState?
    public var devices: [HelperDevice]?
    public var error: String?

    public init(id: Int, ok: Bool, state: HelperState? = nil, devices: [HelperDevice]? = nil, error: String? = nil) {
        self.id = id
        self.ok = ok
        self.state = state
        self.devices = devices
        self.error = error
    }
}

public struct HelperEvent: Codable, Sendable, Equatable {
    public var event: String
    public var state: HelperState?
    public var devices: [HelperDevice]?
    public var defaultInputUid: String?
    public var peakDbfs: Double?
    public var message: String?

    public init(event: String, state: HelperState? = nil, devices: [HelperDevice]? = nil, defaultInputUid: String? = nil, peakDbfs: Double? = nil, message: String? = nil) {
        self.event = event
        self.state = state
        self.devices = devices
        self.defaultInputUid = defaultInputUid
        self.peakDbfs = peakDbfs
        self.message = message
    }

    public static func stateChanged(_ state: HelperState) -> HelperEvent {
        HelperEvent(event: "state-changed", state: state)
    }
    public static func devicesChanged(_ devices: [HelperDevice]) -> HelperEvent {
        HelperEvent(event: "devices-changed", devices: devices)
    }
    public static func defaultInputChanged(_ uid: String?) -> HelperEvent {
        HelperEvent(event: "default-input-changed", defaultInputUid: uid)
    }
    public static func meter(peakDbfs: Double) -> HelperEvent {
        HelperEvent(event: "meter", peakDbfs: peakDbfs)
    }
    public static func error(_ message: String) -> HelperEvent {
        HelperEvent(event: "error", message: message)
    }
}