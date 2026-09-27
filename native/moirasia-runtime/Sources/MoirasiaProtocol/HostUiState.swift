public struct HostUiState: Equatable, Sendable {
    public private(set) var mainVisible: Bool
    public private(set) var mainFocused: Bool
    public private(set) var shelfVisible: Bool

    public init() {
        mainVisible = false
        mainFocused = false
        shelfVisible = false
    }

    @discardableResult
    public mutating func apply(_ params: [String: JSONValue]) throws -> Bool {
        var updated = self
        if let value = params["mainVisible"] {
            guard let boolean = value.boolValue else {
                throw HostError(code: "invalid_params", message: "mainVisible must be a boolean.")
            }
            updated.mainVisible = boolean
        }
        if let value = params["mainFocused"] {
            guard let boolean = value.boolValue else {
                throw HostError(code: "invalid_params", message: "mainFocused must be a boolean.")
            }
            updated.mainFocused = boolean
        }
        if let value = params["shelfVisible"] {
            guard let boolean = value.boolValue else {
                throw HostError(code: "invalid_params", message: "shelfVisible must be a boolean.")
            }
            updated.shelfVisible = boolean
        }

        let changed = updated != self
        if changed { self = updated }
        return changed
    }

    public var params: [String: JSONValue] {
        [
            "mainVisible": .bool(mainVisible),
            "mainFocused": .bool(mainFocused),
            "shelfVisible": .bool(shelfVisible)
        ]
    }
}
