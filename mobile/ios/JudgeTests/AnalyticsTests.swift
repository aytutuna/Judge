import XCTest
@testable import Judge

/// Records each batch and answers with the next scripted delivery.
private final class StubTransport: AnalyticsTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var bodies: [Data] = []
    var answer: AnalyticsDelivery = .sent

    func sendEvents(_ body: Data) async -> AnalyticsDelivery {
        lock.lock()
        defer { lock.unlock() }
        bodies.append(body)
        return answer
    }

    /// The events of every batch sent, in order.
    var batches: [[[String: Any]]] {
        lock.lock()
        defer { lock.unlock() }
        return bodies.map { body in
            let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
            return object?["events"] as? [[String: Any]] ?? []
        }
    }

    var first: [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        return bodies.first.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
    }
}

private final class Clock {
    var now = Date(timeIntervalSince1970: 1_800_000_000)
}

final class AnalyticsTests: XCTestCase {
    private let context = AnalyticsContext(
        appVersion: "1.2.0+7",
        anonID: "0b0e4a8e-4d55-4c6a-9e3a-2f6f0a1c9d11",
        deviceID: "F2D4C1B0-1111-4222-8333-944455556666",
        osVersion: "18.1",
        deviceModel: "iPhone15,2",
        locale: "en-US"
    )

    @MainActor
    private func make(_ transport: StubTransport, clock: Clock = Clock(), file: URL? = nil, allowed: Bool = true) -> Analytics {
        Analytics(transport: transport, context: context, file: file, allowed: allowed, now: { clock.now })
    }

    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "analytics-\(UUID().uuidString).json")
    }

    @MainActor
    func testEventsWaitForTheServerSwitch() async {
        let transport = StubTransport()
        let analytics = make(transport)
        analytics.track("app_open")
        analytics.track("screen_view", ["screen": "home"])
        await analytics.flush()
        XCTAssertTrue(transport.batches.isEmpty)
        XCTAssertEqual(analytics.queue.count, 2)

        analytics.setServerOn(true)
        await analytics.flush()
        XCTAssertEqual(transport.batches.map(\.count), [2])
        XCTAssertTrue(analytics.queue.isEmpty)
    }

    @MainActor
    func testTheBodyMatchesTheEventsRoute() async throws {
        let transport = StubTransport()
        let clock = Clock()
        let analytics = make(transport, clock: clock)
        analytics.setServerOn(true)
        analytics.track("buy_tapped", ["product": "pack_10"])
        analytics.track("case_submitted")
        await analytics.flush()

        let body = try XCTUnwrap(transport.first)
        XCTAssertEqual(Set(body.keys), ["context", "events"])
        let sentContext = try XCTUnwrap(body["context"] as? [String: String])
        XCTAssertEqual(sentContext, [
            "platform": "ios", "app_version": "1.2.0+7", "anon_id": "0b0e4a8e-4d55-4c6a-9e3a-2f6f0a1c9d11",
            "device_id": "F2D4C1B0-1111-4222-8333-944455556666", "os_version": "18.1", "device_model": "iPhone15,2",
            "locale": "en-US",
        ])
        let events = try XCTUnwrap(body["events"] as? [[String: Any]])
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(Set(events[0].keys), ["name", "at", "props"])
        XCTAssertEqual(events[0]["name"] as? String, "buy_tapped")
        XCTAssertEqual(events[0]["at"] as? Int64, Int64(clock.now.timeIntervalSince1970 * 1000))
        XCTAssertEqual(events[0]["props"] as? [String: String], ["product": "pack_10"])
        // An event without props sends none.
        XCTAssertEqual(Set(events[1].keys), ["name", "at"])
    }

    @MainActor
    func testBatchesHoldAtMostFifty() async {
        let transport = StubTransport()
        let analytics = make(transport)
        for _ in 0..<120 { analytics.track("evidence_added") }
        analytics.setServerOn(true)
        await analytics.flush()
        XCTAssertEqual(transport.batches.map(\.count), [50, 50, 20])
        XCTAssertTrue(analytics.queue.isEmpty)
    }

    @MainActor
    func testTwentyQueuedEventsSendThemselves() async throws {
        let transport = StubTransport()
        let analytics = make(transport)
        analytics.setServerOn(true)
        await analytics.flush()
        for _ in 0..<19 { analytics.track("question_answered") }
        await Task.yield()
        XCTAssertTrue(transport.batches.isEmpty)
        analytics.track("question_answered")
        for _ in 0..<100 where !analytics.queue.isEmpty { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(transport.batches.map(\.count), [20])
    }

    @MainActor
    func testTheQueueKeepsTheNewestFiveHundred() {
        let analytics = make(StubTransport())
        for i in 0..<510 { analytics.track("screen_view", ["screen": "s\(i)"]) }
        XCTAssertEqual(analytics.queue.count, Analytics.cap)
        XCTAssertEqual(analytics.queue.first?.props?["screen"], "s10")
        XCTAssertEqual(analytics.queue.last?.props?["screen"], "s509")
    }

    @MainActor
    func testARefusedBatchIsDropped() async {
        let transport = StubTransport()
        transport.answer = .rejected
        let analytics = make(transport)
        analytics.setServerOn(true)
        analytics.track("share_tapped")
        await analytics.flush()
        XCTAssertEqual(transport.batches.count, 1)
        XCTAssertTrue(analytics.queue.isEmpty)
        XCTAssertNil(analytics.retryAt)
    }

    @MainActor
    func testAFailedSendKeepsTheEventsAndBacksOff() async {
        let transport = StubTransport()
        transport.answer = .failed
        let clock = Clock()
        let analytics = make(transport, clock: clock)
        analytics.setServerOn(true)
        analytics.track("verdict_viewed")
        await analytics.flush()
        XCTAssertEqual(transport.batches.count, 1)
        XCTAssertEqual(analytics.queue.count, 1)
        XCTAssertEqual(analytics.retryAt, clock.now.addingTimeInterval(60))

        // Not again within the minute.
        clock.now += 30
        await analytics.flush()
        XCTAssertEqual(transport.batches.count, 1)

        clock.now += 31
        await analytics.flush()
        XCTAssertEqual(transport.batches.count, 2)
        XCTAssertEqual(analytics.retryAt, clock.now.addingTimeInterval(120))

        transport.answer = .sent
        clock.now += 121
        await analytics.flush()
        XCTAssertTrue(analytics.queue.isEmpty)
        XCTAssertNil(analytics.retryAt)
    }

    @MainActor
    func testTheQueueSurvivesARestart() {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let first = make(StubTransport(), file: file)
        first.track("app_open")
        first.track("screen_view", ["screen": "settings"])

        let again = make(StubTransport(), file: file)
        XCTAssertEqual(again.queue.map(\.name), ["app_open", "screen_view"])
        again.track("case_started")
        XCTAssertEqual(Set(again.queue.map(\.seq)).count, 3)
    }

    @MainActor
    func testTurningTheSettingOffClearsTheQueue() async {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let transport = StubTransport()
        let analytics = make(transport, file: file)
        analytics.track("app_open")
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path()))

        analytics.allowed = false
        XCTAssertTrue(analytics.queue.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path()))
        analytics.track("app_open")
        analytics.setServerOn(true)
        await analytics.flush()
        XCTAssertTrue(analytics.queue.isEmpty)
        XCTAssertTrue(transport.batches.isEmpty)
    }

    @MainActor
    func testTheServerSwitchOffDropsTheQueue() {
        let analytics = make(StubTransport())
        analytics.track("app_open")
        analytics.setServerOn(false)
        XCTAssertTrue(analytics.queue.isEmpty)
        analytics.track("app_open")
        XCTAssertTrue(analytics.queue.isEmpty)
    }

    @MainActor
    func testAppOpenOnLaunchAndAfterHalfAnHourAway() {
        let clock = Clock()
        let analytics = make(StubTransport(), clock: clock)
        analytics.becameActive()
        analytics.enteredBackground()
        clock.now += 10 * 60
        analytics.becameActive()
        XCTAssertEqual(analytics.queue.map(\.name), ["app_open"])

        analytics.enteredBackground()
        clock.now += 31 * 60
        analytics.becameActive()
        analytics.enteredBackground()
        XCTAssertEqual(analytics.queue.map(\.name), ["app_open", "app_open"])
    }

    @MainActor
    func testOnlyTheListedPropsAndTokenValuesPass() {
        XCTAssertNil(Analytics.problem(name: "screen_view", props: ["screen": "case_detail"]))
        XCTAssertNil(Analytics.problem(name: "error_shown", props: ["code": "INVALID_OTP"]))
        XCTAssertNil(Analytics.problem(name: "case_submitted", props: [:]))
        XCTAssertNotNil(Analytics.problem(name: "case_submitted", props: ["screen": "home"]))
        XCTAssertNotNil(Analytics.problem(name: "screen_view", props: ["name": "home"]))
        XCTAssertNotNil(Analytics.problem(name: "screen_view", props: ["screen": "two words"]))
        XCTAssertNotNil(Analytics.problem(name: "screen_view", props: ["screen": "ann@example.com"]))
        XCTAssertNotNil(Analytics.problem(name: "screen_view", props: ["screen": ""]))
        XCTAssertNotNil(Analytics.problem(name: "screen_view", props: ["screen": String(repeating: "a", count: 65)]))
        XCTAssertNotNil(Analytics.problem(name: "sign_in", props: [:]))
        XCTAssertNotNil(Analytics.problem(name: "Screen View", props: [:]))
    }

    @MainActor
    func testTheUsageSettingIsOnUntilTurnedOff() throws {
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let app = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false, caseNames: MemoryCaseNamesStore())
        XCTAssertTrue(app.usageStats)
        app.analytics.track("app_open")
        app.setUsageStats(false)
        XCTAssertFalse(app.analytics.allowed)
        XCTAssertTrue(app.analytics.queue.isEmpty)

        let again = AppModel(config: config, container: HistoryContainer.inMemory(), defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false, caseNames: MemoryCaseNamesStore())
        XCTAssertFalse(again.usageStats)
        XCTAssertFalse(again.analytics.allowed)
    }
}

/// POST /api/v1/events and the device headers at sign-in, against the stub.
final class EventsAPITests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private func api(deviceID: String? = nil, token: String? = nil) -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            deviceID: deviceID
        )
    }

    func testEventsGoOutAsJSONWithTheSession() async throws {
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(status: 204) }
        let delivery = await api(token: "s3ss10n").sendEvents(Data(#"{"context":{},"events":[]}"#.utf8))
        XCTAssertEqual(delivery, .sent)
        let sent = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "https://okjudge.com/api/v1/events")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer s3ss10n")
    }

    func testStatusesMapToDeliveries() async {
        let cases: [(StubURLProtocol.Reply, AnalyticsDelivery)] = [
            (StubURLProtocol.Reply(status: 400), .rejected),
            (StubURLProtocol.Reply(status: 429), .failed),
            (StubURLProtocol.Reply(status: 503), .failed),
            (StubURLProtocol.Reply(error: URLError(.notConnectedToInternet)), .failed),
        ]
        for (reply, want) in cases {
            StubURLProtocol.handler = { _ in reply }
            let got = await api().sendEvents(Data("{}".utf8))
            XCTAssertEqual(got, want, "\(reply.status)")
        }
    }

    func testSignInCarriesTheDevice() async throws {
        StubURLProtocol.handler = { _ in
            StubURLProtocol.Reply(body: Data(#"{"token":"t0k3n","user":null}"#.utf8))
        }
        _ = try await api(deviceID: "F2D4C1B0-1111-4222-8333-944455556666").signInWithCode(email: "ann@example.com", code: "123456")
        let sent = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Device-Id"), "F2D4C1B0-1111-4222-8333-944455556666")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Device-Platform"), "ios")
    }
}
