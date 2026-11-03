import XCTest
@testable import Judge

/// Answers URLSession requests from a handler instead of the network.
final class StubURLProtocol: URLProtocol {
    struct Reply: Sendable {
        var status = 200
        var headers: [String: String] = ["Content-Type": "application/json"]
        var body = Data()
        var error: URLError?
    }

    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) -> Reply)?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var recorded = request
        if recorded.httpBody == nil, let stream = request.httpBodyStream {
            recorded.httpBody = Self.read(stream)
        }
        Self.requests.append(recorded)
        let reply = Self.handler?(recorded) ?? Reply(error: URLError(.unknown))
        if let error = reply.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private struct FixedTokenStore: TokenStore {
    let value: String
    func token() -> String? { value }
    func setToken(_ token: String) {}
    func clear() {}
}

final class JudgeAPITests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    private func api(tokenStore: any TokenStore = NoTokenStore()) -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/1.0.0 (1)",
            tokenStore: tokenStore,
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    private func request() -> VerdictRequest {
        VerdictRequest(argument: "My friend Sam says a hot dog is a sandwich.", lang: .en)
    }

    private func reply(_ status: Int, json: Any?, headers: [String: String] = [:]) throws -> StubURLProtocol.Reply {
        var all = ["Content-Type": "application/json"]
        all.merge(headers) { _, new in new }
        let body = try json.map { try JSONSerialization.data(withJSONObject: $0) } ?? Data()
        return StubURLProtocol.Reply(status: status, headers: all, body: body)
    }

    func testVerdictRequestShapeAndDecoding() async throws {
        let sample = try Fixtures.sampleData("win_a_self")
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: sample) }
        let payload = try await api().verdict(request())
        XCTAssertEqual(payload.id, "abc123DEF0")

        let sent = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "https://okjudge.com/api/v1/verdict")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "User-Agent"), "Judge-iOS/1.0.0 (1)")
        XCTAssertNil(sent.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(sent.timeoutInterval, 310)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(sent.httpBody)) as? [String: Any])
        XCTAssertEqual(body["argument"] as? String, request().argument)
        XCTAssertEqual(body["tier"] as? String, "free")
    }

    func testBearerTokenWhenOneExists() async throws {
        let sample = try Fixtures.sampleData("win_a_self")
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: sample) }
        _ = try await api(tokenStore: FixedTokenStore(value: "s3ss10n")).verdict(request())
        XCTAssertEqual(StubURLProtocol.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer s3ss10n")
    }

    func testTranslateRequest() async throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["translateResponse"])
        let data = try JSONSerialization.data(withJSONObject: body)
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: data) }
        let payload = try await api().translate(id: "abc123DEF0", to: .tr)
        XCTAssertEqual(payload.lang, .tr)
        let sent = try XCTUnwrap(StubURLProtocol.requests.first)
        XCTAssertEqual(sent.httpMethod, "POST")
        XCTAssertEqual(sent.url?.absoluteString, "https://okjudge.com/api/v1/verdicts/abc123DEF0/translate?lang=tr")
        XCTAssertEqual(sent.timeoutInterval, 90)
    }

    func testStoredVerdictRequest() async throws {
        let body = try XCTUnwrap(Fixtures.verdicts()["storedVerdictResponse"])
        let data = try JSONSerialization.data(withJSONObject: body)
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: data) }
        let payload = try await api().storedVerdict(id: "winB000001")
        XCTAssertEqual(payload.id, "winB000001")
        XCTAssertEqual(StubURLProtocol.requests.first?.httpMethod, "GET")
        XCTAssertEqual(StubURLProtocol.requests.first?.url?.absoluteString, "https://okjudge.com/api/v1/verdicts/winB000001")
    }

    func testEveryFixtureErrorBodyMapsToItsCode() async throws {
        let bodies = try Fixtures.list("errorBodies", in: Fixtures.verdicts())
        for entry in bodies {
            let status = try XCTUnwrap((entry["status"] as? NSNumber)?.intValue)
            let json = entry["body"] as? [String: Any]
            let stub: StubURLProtocol.Reply
            if let json {
                stub = try reply(status, json: json)
            } else {
                stub = StubURLProtocol.Reply(status: status, headers: ["Content-Type": "text/html"], body: Data("<html>oops</html>".utf8))
            }
            StubURLProtocol.handler = { _ in stub }
            do {
                _ = try await api().verdict(request())
                XCTFail("expected an error for \(status)")
            } catch let error as APIError {
                let expectedCode = (json?["code"] as? String) ?? (status == 429 ? "rate_limited" : status >= 500 ? "unavailable" : nil)
                XCTAssertEqual(error.code, expectedCode, "status \(status)")
                if let wait = (json?["retryAfterSec"] as? NSNumber)?.doubleValue {
                    XCTAssertEqual(error.retryAfterSec, wait)
                }
                XCTAssertFalse(ErrorText.message(error, lang: .en).isEmpty)
            }
        }
    }

    func testRetryAfterHeaderFillsAMissingWait() async throws {
        let stub = try reply(429, json: ["error": "slow down", "code": "rate_limited"], headers: ["Retry-After": "120"])
        StubURLProtocol.handler = { _ in stub }
        do {
            _ = try await api().verdict(request())
            XCTFail("expected rate_limited")
        } catch let error as APIError {
            XCTAssertEqual(error.code, "rate_limited")
            XCTAssertEqual(error.retryAfterSec, 120)
            XCTAssertEqual(ErrorText.message(error, lang: .en), L10n.errorRateLimited(.en, wait: L10n.waitMinutes(.en, n: 2)))
        }
    }

    func testCloudflareTimeoutAndHTMLErrors() async throws {
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(status: 524, headers: ["Content-Type": "text/html"], body: Data("<html>".utf8)) }
        await assertFails(with: .timeout)

        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(status: 504, headers: ["Content-Type": "text/html"], body: Data("<html>".utf8)) }
        await assertFails(with: .timeout)

        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(status: 502, headers: ["Content-Type": "text/html"], body: Data("<html>".utf8)) }
        await assertFails(with: .server(status: 502, body: ApiErrorBody(code: "unavailable")))
    }

    func testTransportErrors() async throws {
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(error: URLError(.notConnectedToInternet)) }
        await assertFails(with: .offline)
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(error: URLError(.timedOut)) }
        await assertFails(with: .timeout)
    }

    func testMalformedSuccessBody() async throws {
        StubURLProtocol.handler = { _ in StubURLProtocol.Reply(body: Data(#"{"nope":true}"#.utf8)) }
        await assertFails(with: .malformed)
    }

    func testTheVerdictPostIsNeverRetried() async throws {
        let stub = try reply(503, json: ["error": "x", "code": "unavailable"])
        StubURLProtocol.handler = { _ in stub }
        await assertFails(with: .server(status: 503, body: ApiErrorBody(error: "x", code: "unavailable")))
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    private func assertFails(with expected: APIError, file: StaticString = #filePath, line: UInt = #line) async {
        StubURLProtocol.requests = []
        do {
            _ = try await api().verdict(request())
            XCTFail("expected \(expected)", file: file, line: line)
        } catch let error as APIError {
            XCTAssertEqual(error, expected, file: file, line: line)
        } catch {
            XCTFail("unexpected \(error)", file: file, line: line)
        }
    }
}

final class ErrorMappingTests: XCTestCase {
    func testStatusMapping() {
        XCTAssertEqual(APIError.from(status: 524, body: Data(), retryAfterHeader: nil), .timeout)
        XCTAssertEqual(APIError.from(status: 504, body: Data(), retryAfterHeader: nil), .timeout)
        XCTAssertEqual(APIError.from(status: 504, body: Data(#"{"code":"unavailable"}"#.utf8), retryAfterHeader: nil), .timeout)
        XCTAssertEqual(APIError.from(status: 503, body: Data("<html>".utf8), retryAfterHeader: nil), .server(status: 503, body: ApiErrorBody(code: "unavailable")))
        XCTAssertEqual(APIError.from(status: 429, body: Data(), retryAfterHeader: nil).code, "rate_limited")
        XCTAssertNil(APIError.from(status: 404, body: Data("nope".utf8), retryAfterHeader: nil).code)
        let header = APIError.from(status: 429, body: Data(#"{"code":"rate_limited"}"#.utf8), retryAfterHeader: " 90 ")
        XCTAssertEqual(header.retryAfterSec, 90)
        let bodyWins = APIError.from(status: 429, body: Data(#"{"code":"rate_limited","retryAfterSec":420}"#.utf8), retryAfterHeader: "90")
        XCTAssertEqual(bodyWins.retryAfterSec, 420)
    }

    func testTransportMapping() {
        XCTAssertEqual(APIError.from(transport: URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(APIError.from(transport: URLError(.cannotFindHost)), .offline)
        XCTAssertEqual(APIError.from(transport: URLError(.timedOut)), .timeout)
        XCTAssertTrue(APIError.isCancellation(URLError(.cancelled)))
        XCTAssertTrue(APIError.isCancellation(CancellationError()))
        XCTAssertFalse(APIError.isCancellation(URLError(.timedOut)))
    }

    func testMessagesForAppErrors() {
        XCTAssertEqual(ErrorText.message(.offline, lang: .tr), L10n.appErrorOffline(.tr))
        XCTAssertEqual(ErrorText.message(.timeout, lang: .en), L10n.appErrorTimeout(.en))
        XCTAssertEqual(ErrorText.message(.malformed, lang: .en), L10n.errorFallback(.en))
        XCTAssertEqual(ErrorText.message(.interrupted, lang: .tr), L10n.appErrorInterrupted(.tr))
        let badOrigin = APIError.server(status: 403, body: ApiErrorBody(code: "bad_origin"))
        XCTAssertEqual(ErrorText.message(badOrigin, lang: .tr), L10n.appErrorBadOrigin(.tr))
        let limited = APIError.server(status: 429, body: ApiErrorBody(code: "rate_limited", retryAfterSec: 420))
        XCTAssertEqual(ErrorText.message(limited, lang: .en), "Order in the court! You've hit the limit for now. Try again in 7 minutes.")
    }

    func testRetryOffer() {
        XCTAssertTrue(APIError.offline.offersRetry)
        XCTAssertTrue(APIError.timeout.offersRetry)
        XCTAssertTrue(APIError.server(status: 503, body: ApiErrorBody(code: "unavailable")).offersRetry)
        XCTAssertFalse(APIError.server(status: 429, body: ApiErrorBody(code: "rate_limited")).offersRetry)
        XCTAssertFalse(APIError.server(status: 400, body: ApiErrorBody(code: "too_short")).offersRetry)
    }
}
