import XCTest
@testable import MoirasiaProtocol

final class ProtocolTests: XCTestCase {
    func testRoundTripsRequestResponseAndEvent() throws {
        let request = HostMessage.request(HostRequest(id: "request-1", method: "host.getSnapshot"))
        let decodedRequest = try HostMessage(data: Data(try request.encodedLine().dropLast()))
        XCTAssertEqual(decodedRequest, request)

        let response = HostMessage.response(HostResponse(id: "request-1", result: jsonObject([("ready", .bool(true))])))
        XCTAssertEqual(try HostMessage(data: Data(try response.encodedLine().dropLast())), response)

        let event = HostMessage.event(HostEvent(event: "host.snapshotChanged", revision: 2, payload: .object([:])))
        XCTAssertEqual(try HostMessage(data: Data(try event.encodedLine().dropLast())), event)
    }

    func testRejectsVersionMismatch() throws {
        let data = Data(#"{"version":2,"id":"one","method":"host.getSnapshot","params":{}}"#.utf8)
        XCTAssertThrowsError(try HostMessage(data: data)) { error in
            XCTAssertEqual(error as? ProtocolError, .unsupportedVersion(2))
        }
    }

    func testRejectsOversizedMessage() {
        XCTAssertThrowsError(try HostMessage(data: Data(repeating: 0x20, count: moirasiaMaximumMessageBytes + 1))) { error in
            XCTAssertEqual(error as? ProtocolError, .oversizedMessage)
        }
    }

    func testLineDecoderHandlesPartialLines() throws {
        let decoder = LineDecoder()
        let line = try HostMessage.request(HostRequest(id: "one", method: "host.getSnapshot")).encodedLine()
        XCTAssertEqual(try decoder.append(line.prefix(4)).count, 0)
        XCTAssertEqual(try decoder.append(line.dropFirst(4)).count, 1)
    }
}
