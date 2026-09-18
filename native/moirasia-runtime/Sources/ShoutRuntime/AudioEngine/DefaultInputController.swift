import CoreAudio
import Foundation

// Writes/restores the system default input device around boost sessions.
//
// The restore file is written BEFORE switching the default to the Shout Mic,
// so a crash mid-boost can always be recovered at next startup. Restoring only
// happens while the default is still the Shout Mic — if the user changed it
// themselves in System Settings, their choice wins.

final class DefaultInputController {
    struct RestoreRecord: Codable {
        var uid: String
        var name: String
        var savedAt: Date
    }

    let fileURL: URL
    /// True while the boost session owns the default input (set by apply()).
    private(set) var ownsDefault = false

    init(dataDirectory: URL) {
        self.fileURL = dataDirectory.appendingPathComponent("shout-default-restore.json")
    }

    /// Applies "make Shout Mic the default input" and records the previous
    /// default for restoration. No-op when the default is already Shout Mic.
    /// - Returns: true when the default was switched.
    @discardableResult
    func apply(shoutDeviceID: AudioObjectID, shoutUID: String, currentDefaultUID: String?, deviceName: (String) -> String) -> Bool {
        guard currentDefaultUID != nil, currentDefaultUID != shoutUID, !ownsDefault else {
            return false
        }
        let previousUID = currentDefaultUID!
        let record = RestoreRecord(uid: previousUID, name: deviceName(previousUID), savedAt: Date())
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(record).write(to: fileURL, options: .atomic)
        } catch {
            // If we cannot persist the restore point, do not switch the
            // system default: recovery would be impossible.
            return false
        }
        guard setDefaultInput(shoutDeviceID) else {
            try? FileManager.default.removeItem(at: fileURL)
            return false
        }
        ownsDefault = true
        return true
    }

    /// Restores the previous default when Shout still owns it. Returns the
    /// restored device UID, if any.
    @discardableResult
    func restoreIfNeeded(shoutUID: String, currentDefaultUID: String?, deviceIDForUID: (String) -> AudioObjectID?) -> String? {
        guard currentDefaultUID == shoutUID || ownsDefault else { return nil }
        guard currentDefaultUID == shoutUID else {
            // User changed the default themselves; just drop our claim.
            ownsDefault = false
            try? FileManager.default.removeItem(at: fileURL)
            return nil
        }
        guard let record = readRecord(), let deviceID = deviceIDForUID(record.uid) else {
            ownsDefault = false
            try? FileManager.default.removeItem(at: fileURL)
            return nil
        }
        guard setDefaultInput(deviceID) else { return nil }
        ownsDefault = false
        try? FileManager.default.removeItem(at: fileURL)
        return record.uid
    }

    /// Startup recovery: if the system default is still Shout Mic from a
    /// previous session that never restored, put it back.
    @discardableResult
    func recoverAtStartup(shoutUID: String, currentDefaultUID: String?, deviceIDForUID: (String) -> AudioObjectID?) -> String? {
        guard currentDefaultUID == shoutUID else {
            // Stale file from a session that restored cleanly.
            if !ownsDefault { try? FileManager.default.removeItem(at: fileURL) }
            return nil
        }
        return restoreIfNeeded(shoutUID: shoutUID, currentDefaultUID: currentDefaultUID, deviceIDForUID: deviceIDForUID)
    }

    private func readRecord() -> RestoreRecord? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(RestoreRecord.self, from: data)
    }

    private func setDefaultInput(_ deviceID: AudioObjectID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = deviceID
        let size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, size, &id)
        return status == noErr
    }
}