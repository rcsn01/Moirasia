import XCTest
import MoirasiaProtocol

final class HostUiStateTests: XCTestCase {
    func testDefaultsAndCompleteParams() {
        let state = HostUiState()

        XCTAssertFalse(state.mainVisible)
        XCTAssertFalse(state.mainFocused)
        XCTAssertFalse(state.shelfVisible)
        XCTAssertEqual(state.params, [
            "mainVisible": .bool(false),
            "mainFocused": .bool(false),
            "shelfVisible": .bool(false)
        ])
    }

    func testPartialPatchesMergeAndReportWhetherStateChanged() throws {
        var state = HostUiState()

        XCTAssertTrue(try state.apply(["mainVisible": .bool(true)]))
        XCTAssertTrue(try state.apply(["mainFocused": .bool(true)]))
        XCTAssertTrue(try state.apply(["shelfVisible": .bool(true)]))
        XCTAssertEqual(state.params, [
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ])

        XCTAssertFalse(try state.apply(["mainFocused": .bool(true)]))
        XCTAssertEqual(state.params["mainVisible"], .bool(true))
        XCTAssertEqual(state.params["shelfVisible"], .bool(true))
    }

    func testEmptyAndUnknownPatchesAreIgnored() throws {
        var state = HostUiState()
        let before = state.params

        XCTAssertFalse(try state.apply([:]))
        XCTAssertFalse(try state.apply(["page": .object(["invalid": .array([])])]))
        XCTAssertEqual(state.params, before)

        XCTAssertTrue(try state.apply(["mainFocused": .bool(true), "page": .string("ignored")]))
        XCTAssertEqual(state.params, [
            "mainVisible": .bool(false),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(false)
        ])
    }

    func testRecognizedFieldsValidateAtomicallyWithStableErrorOrder() throws {
        var state = HostUiState()
        _ = try state.apply([
            "mainVisible": .bool(true),
            "mainFocused": .bool(true),
            "shelfVisible": .bool(true)
        ])
        let before = state.params
        let invalidFields: [(field: String, validField: String)] = [
            ("mainVisible", "mainFocused"),
            ("mainFocused", "shelfVisible"),
            ("shelfVisible", "mainFocused")
        ]

        for (field, validField) in invalidFields {
            XCTAssertThrowsError(try state.apply([
                field: .string("true"),
                validField: .bool(false)
            ])) { error in
                XCTAssertEqual(error as? HostError, HostError(
                    code: "invalid_params",
                    message: "\(field) must be a boolean."
                ))
            }
            XCTAssertEqual(state.params, before)
        }

        XCTAssertThrowsError(try state.apply([
            "mainVisible": .string("true"),
            "mainFocused": .number(1),
            "shelfVisible": .array([])
        ])) { error in
            XCTAssertEqual(error as? HostError, HostError(
                code: "invalid_params",
                message: "mainVisible must be a boolean."
            ))
        }
        XCTAssertEqual(state.params, before)
    }
}
