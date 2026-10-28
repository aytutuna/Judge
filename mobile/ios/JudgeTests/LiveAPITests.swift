import XCTest
@testable import Judge

/// One real request against a live server. Skipped unless JUDGE_LIVE_BASE_URL
/// is set (for xcodebuild, export TEST_RUNNER_JUDGE_LIVE_BASE_URL; the prefix
/// is stripped for the test process). A free verdict costs real money and
/// counts against the rate limit, so it is never part of a normal run.
final class LiveAPITests: XCTestCase {
    func testOneRealVerdict() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let raw = environment["JUDGE_LIVE_BASE_URL"], let base = AppConfig.parseOrigin(raw) else {
            throw XCTSkip("set JUDGE_LIVE_BASE_URL to run the live check")
        }
        // TODO: verdicts need an account now; this needs a session token to pass.
        let api = JudgeAPI(baseURL: base, userAgent: "Judge-iOS/live-test")
        let argument = "My friend Sam says a hot dog is a sandwich because it is a filling in a split roll. "
            + "I say it is its own thing: no menu lists it under sandwiches and nobody orders a sandwich expecting one."
        let body = VerdictRequest(argument: argument, framework: .init(preset: Preset.defaultID), lang: .en)
        do {
            let payload = try await api.verdict(body)
            let result = payload.result.result
            print("LIVE verdict id=\(payload.id) verdict=\(result.verdict.rawValue) confidence=\(result.confidence) "
                + "lang=\(ContentLang.verdictLang(result).rawValue) headline=\(result.headline) "
                + "names=\(payload.nameMap.map { "\($0.original)->\($0.replacement)" })")
            XCTAssertFalse(payload.id.isEmpty)
            XCTAssertFalse(result.headline.isEmpty)
        } catch let error as APIError {
            // A parsed error body still proves the client end to end; report it.
            print("LIVE error \(error) code=\(error.code ?? "-") message=\(ErrorText.message(error, lang: .en))")
            throw error
        }
    }
}
