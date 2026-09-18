// Input device facts and source selection rules.
//
// Shout must never feed itself: the resolver refuses to pick the virtual
// Shout Mic as the capture source, falls back gracefully when a chosen device
// disappears, and avoids default-input feedback loops by remembering the last
// physical default.

public struct AudioDeviceSnapshot: Equatable, Sendable {
    public let uid: String
    public let name: String
    public let hasInputStream: Bool
    public let isShoutMic: Bool
    public let sampleRate: Double?

    public init(uid: String, name: String, hasInputStream: Bool, isShoutMic: Bool, sampleRate: Double? = nil) {
        self.uid = uid
        self.name = name
        self.hasInputStream = hasInputStream
        self.isShoutMic = isShoutMic
        self.sampleRate = sampleRate
    }
}

/// How the capture source is chosen.
public enum SourceMode: String, Equatable, Sendable, Codable {
    /// Always capture the system default input device.
    case followDefault = "follow-default"
    /// Capture one pinned device, falling back to the default if it is gone.
    case device = "device"
}

public struct SourceRequest: Equatable, Sendable {
    public let mode: SourceMode
    /// Pinned device UID (device mode only).
    public let selectedUid: String?
    /// Current system default input UID, if known.
    public let defaultInputUid: String?
    /// Last default input that was not the Shout Mic, if known.
    public let lastPhysicalDefaultUid: String?
    public let devices: [AudioDeviceSnapshot]

    public init(
        mode: SourceMode,
        selectedUid: String?,
        defaultInputUid: String?,
        lastPhysicalDefaultUid: String?,
        devices: [AudioDeviceSnapshot]
    ) {
        self.mode = mode
        self.selectedUid = selectedUid
        self.defaultInputUid = defaultInputUid
        self.lastPhysicalDefaultUid = lastPhysicalDefaultUid
        self.devices = devices
    }
}

public enum SourceResolver {
    /// Resolves the device to capture. Returns nil when no usable source
    /// exists (boost pauses and the render path delivers silence).
    public static func resolve(_ request: SourceRequest) -> AudioDeviceSnapshot? {
        let candidates = request.devices.filter { $0.hasInputStream && !$0.isShoutMic }
        func byUid(_ uid: String?) -> AudioDeviceSnapshot? {
            guard let uid else { return nil }
            return candidates.first { $0.uid == uid }
        }

        if request.mode == .device, let pinned = byUid(request.selectedUid) {
            return pinned
        }
        // Device mode falls back to follow-default when the pin is invalid.
        if let fallback = byUid(request.defaultInputUid) {
            return fallback
        }
        if let lastPhysical = byUid(request.lastPhysicalDefaultUid) {
            return lastPhysical
        }
        return candidates.first
    }
}