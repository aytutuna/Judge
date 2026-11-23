import XCTest

/// Walks the sign-in screens against a dev server. Skipped unless
/// JUDGE_WALK_CODE_URL names a small service that answers
/// GET /code?email=<address> with the last emailed code; the app must be
/// built with API_BASE_URL pointing at the dev server (Config/Local.xcconfig).
final class SignInWalkUITests: UITestCase {
    private let pwEmail = "ios1@example.com"
    private let codeOnlyEmail = "codeonly2@example.com"
    private let password = "Passw0rd_example1"

    private var codeURL: String? { ProcessInfo.processInfo.environment["JUDGE_WALK_CODE_URL"] }

    override func setUp() async throws {
        try await super.setUp()
        try XCTSkipIf(codeURL == nil, "JUDGE_WALK_CODE_URL is not set")
        continueAfterFailure = true
    }

    private func emailedCode(_ email: String) -> String {
        guard let base = codeURL, let url = URL(string: "\(base)/code?email=\(email)") else { return "" }
        var out = ""
        let done = expectation(description: "code")
        URLSession.shared.dataTask(with: url) { data, _, _ in
            out = String(decoding: data ?? Data(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return out
    }

    private func begin() {
        app.launchArguments = []
        app.launch()
        signOutIfNeeded()
    }

    private func signOutIfNeeded() {
        let menu = app.buttons["Sections"]
        guard wait(menu) else { return }
        press(menu)
        let profile = app.buttons.matching(NSPredicate(format: "label CONTAINS '@'")).firstMatch
        if wait(profile, timeout: 3) {
            press(profile)
            let out = app.buttons["Sign out"]
            if wait(out, timeout: 3) {
                press(out)
                let confirm = app.alerts.buttons["Sign out"]
                if wait(confirm, timeout: 3) { confirm.tap() }
                _ = wait(app.buttons["Sections"], timeout: 5)
                return
            }
        }
        let close = app.buttons["Close"]
        if close.exists { press(close) }
    }

    private func typeArgument() {
        let editor = app.textViews["Your side of the argument"]
        guard wait(editor) else { shot("FAIL no editor"); return }
        press(editor)
        app.typeText("He ate my lunch again and I want a verdict about it")
        _ = wait(app.buttons["Get the verdict"])
    }

    private func openSignIn() {
        typeArgument()
        press(app.buttons["Get the verdict"])
    }

    private var emailField: XCUIElement { app.textFields["Email address"] }

    private func setEmail(_ email: String) {
        let field = emailField
        guard wait(field) else { return }
        field.tap()
        if let current = field.value as? String, current != "you@example.com", !current.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        field.typeText(email)
    }

    private func tapButton(_ label: String) {
        let button = app.buttons[label]
        if wait(button, timeout: 8) { button.tap() } else { XCTFail("no button \(label)") }
    }

    private func enterCode(for email: String) {
        let field = app.textFields["Enter the 6-digit code"]
        guard wait(field) else { XCTFail("no code field"); return }
        shot("code screen")
        let code = emailedCode(email)
        XCTAssertEqual(code.count, 6, "emailed code")
        field.tap()
        field.typeText(code)
    }

    private func skipPasswordIfAsked() {
        let skip = app.buttons["Skip"]
        if wait(skip, timeout: 6) {
            shot("choose password empty")
            skip.tap()
        }
    }

    func test1CreateWithNewEmail() {
        begin()
        openSignIn()
        wait(emailField)
        shot("1 screen one")
        XCTAssertTrue(app.buttons["Continue with Google"].isHittable, "Google button")
        XCTAssertTrue(app.buttons["Continue with Apple"].isHittable, "Apple button")
        setEmail(pwEmail)
        shot("2 email typed")
        tapButton("Continue")
        let pw = app.secureTextFields["New password"]
        guard wait(pw) else { shot("FAIL no create password"); return }
        shot("3 create password")
        pw.tap()
        pw.typeText(password)
        tapButton("Continue")
        enterCode(for: pwEmail)
        sleep(4)
        shot("4 after code")
        skipPasswordIfAsked()
        sleep(3)
        shot("5 signed in, verdict resumed")
    }

    func test2WrongPasswordThenForgot() {
        begin()
        openSignIn()
        wait(emailField)
        shot("6 prefilled with last used")
        XCTAssertEqual(emailField.value as? String, pwEmail)
        tapButton("Continue")
        let pw = app.secureTextFields["Password"]
        guard wait(pw) else { shot("FAIL no password screen"); return }
        shot("7 password screen")
        pw.tap()
        pw.typeText("wrongpassword99\n")
        sleep(3)
        shot("8 wrong password")
        tapButton("Forgot password?")
        enterCode(for: pwEmail)
        sleep(4)
        shot("9 choose password after forgot")
        XCTAssertTrue(app.buttons["Skip"].exists)
        skipPasswordIfAsked()
        sleep(2)
        shot("10 after skip")
    }

    func test3EmailMeACodeInstead() {
        begin()
        openSignIn()
        wait(emailField)
        tapButton("Continue")
        guard wait(app.secureTextFields["Password"]) else { shot("FAIL no password screen"); return }
        tapButton("Email me a code instead")
        enterCode(for: pwEmail)
        sleep(4)
        shot("11 signed in by code")
        skipPasswordIfAsked()
    }

    func test4CodeOnlyAccountAndDifferentEmail() {
        begin()
        openSignIn()
        setEmail(codeOnlyEmail)
        tapButton("Continue")
        guard wait(app.textFields["Enter the 6-digit code"]) else { shot("FAIL no code screen"); return }
        shot("12 code sent straight away")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Resend in'")).firstMatch.exists, "resend countdown")
        sleep(31)
        shot("13 resend enabled")
        XCTAssertTrue(app.buttons["Resend code"].exists)
        tapButton("Use a different email")
        wait(emailField)
        shot("14 back to screen one")
        setEmail(codeOnlyEmail)
        tapButton("Continue")
        enterCode(for: codeOnlyEmail)
        sleep(4)
        shot("15 code-only signed in")
        skipPasswordIfAsked()
    }
}
