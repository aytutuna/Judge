import XCTest

@MainActor
class UITestCase: XCTestCase {
    var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func launch(_ state: String) {
        app.launchArguments = ["-JudgeScreenshotState", state]
        app.launch()
    }

    func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @discardableResult
    func wait(_ element: XCUIElement, exists: Bool = true, timeout: TimeInterval = 10) -> Bool {
        let predicate = NSPredicate(format: "exists == %@", NSNumber(value: exists))
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    func waitForFocus(_ element: XCUIElement) -> Bool {
        let predicate = NSPredicate(format: "hasKeyboardFocus == true")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: 10) == .completed
    }

    /// True when the element is still absent after a short time, for checks that nothing happens.
    func staysAbsent(_ element: XCUIElement, for seconds: TimeInterval = 1.5) -> Bool {
        let predicate = NSPredicate(format: "exists == true")
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: seconds) == .timedOut
    }

    /// Taps the middle of the element without asking it to be hittable first; the animated court keeps the accessibility check from settling.
    func press(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    var keyboard: XCUIElement { app.keyboards.firstMatch }
}
