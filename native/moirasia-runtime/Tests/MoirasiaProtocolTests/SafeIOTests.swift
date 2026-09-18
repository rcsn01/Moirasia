import XCTest
import Darwin
import MoirasiaProtocol

/// Regression tests for the POSIX IPC layer: Foundation's FileHandle read and
/// write APIs raise uncatchable Objective-C exceptions at EOF or on a broken
/// pipe (macOS 26), which aborted the host and the feature service. SafeIO
/// must surface those conditions as ordinary return values and Swift errors.
final class SafeIOTests: XCTestCase {
    override func setUp() {
        super.setUp()
        signal(SIGPIPE, SIG_IGN)
    }

    private func makeSocketPair() throws -> (Int32, Int32) {
        var fds: [Int32] = [0, 0]
        let result = socketpair(AF_UNIX, SOCK_STREAM, 0, &fds)
        XCTAssertEqual(result, 0, "socketpair failed: errno \(errno)")
        return (fds[0], fds[1])
    }

    func testDrainReturnsDataThenEndOfStreamAfterPeerCloses() throws {
        let (writer, reader) = try makeSocketPair()
        SafeIO.makeNonBlocking(reader)
        try SafeIO.write(descriptor: writer, Data("hello\n".utf8))
        guard let first = SafeIO.drain(descriptor: reader) else { return XCTFail("expected data") }
        XCTAssertFalse(first.ended, "live peer drains without EOF")
        XCTAssertEqual(String(decoding: first.data, as: UTF8.self), "hello\n")
        close(writer)
        guard let second = SafeIO.drain(descriptor: reader) else { return XCTFail("expected EOF read") }
        XCTAssertTrue(second.ended)
        XCTAssertTrue(second.data.isEmpty)
        close(reader)
    }

    func testDrainWithoutAvailableDataReturnsNil() throws {
        let (a, b) = try makeSocketPair()
        SafeIO.makeNonBlocking(a)
        SafeIO.makeNonBlocking(b)
        XCTAssertNil(SafeIO.drain(descriptor: a))
        close(a)
        close(b)
    }

    func testWriteToBrokenPipeThrowsInsteadOfCrashing() throws {
        let (writer, _) = try makeSocketPair()
        close(writer)
        XCTAssertThrowsError(try SafeIO.write(descriptor: writer, Data("x".utf8)))
    }

    func testFramedWriterSurvivesClosedPeer() throws {
        let (writer, _) = try makeSocketPair()
        let handle = FileHandle(fileDescriptor: writer, closeOnDealloc: false)
        close(writer)
        let framed = FramedWriter(handle: handle)
        XCTAssertThrowsError(try framed.send(.event(HostEvent(event: "host.snapshotChanged", revision: 1, payload: .object([:])))))
    }

    func testFramedWriterRoundTripsThroughReadToEnd() throws {
        let (writer, reader) = try makeSocketPair()
        let handle = FileHandle(fileDescriptor: writer, closeOnDealloc: false)
        let framed = FramedWriter(handle: handle)
        try framed.send(.request(HostRequest(id: "one", method: "host.authenticate", params: ["token": .string("t")])))
        try framed.send(.response(HostResponse(id: "two", result: .object(["ok": .bool(true)]))))
        try framed.send(.event(HostEvent(event: "host.willQuit", revision: 3, payload: .object([:]))))
        handle.closeFile()
        let data = SafeIO.readToEnd(descriptor: reader)
        close(reader)
        var decoder = LineDecoder()
        let messages = try decoder.append(data)
        XCTAssertEqual(messages.count, 3)
        guard case .request(let request) = messages[0] else { return XCTFail("expected request") }
        XCTAssertEqual(request.id, "one")
        guard case .response(let response) = messages[1] else { return XCTFail("expected response") }
        XCTAssertEqual(response.ok, true)
        guard case .event(let event) = messages[2] else { return XCTFail("expected event") }
        XCTAssertEqual(event.event, "host.willQuit")
    }

    func testReadToEndOfClosedPipeReturnsCollectedBytes() throws {
        let (writer, reader) = try makeSocketPair()
        try SafeIO.write(descriptor: writer, Data("stderr text".utf8))
        close(writer)
        XCTAssertEqual(String(decoding: SafeIO.readToEnd(descriptor: reader), as: UTF8.self), "stderr text")
        close(reader)
    }
}