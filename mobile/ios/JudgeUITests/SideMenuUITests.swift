import XCTest

final class SideMenuUITests: UITestCase {
    func testSwipingAVerdictShowsDelete() {
        launch("menu:en")
        // The first verdict is still being judged and cannot be removed.
        let row = app.buttons.matching(identifier: "menu.verdict").matching(NSPredicate(format: "label BEGINSWITH 'You are right'")).firstMatch
        XCTAssertTrue(wait(row))
        shot("8 side menu")
        row.swipeLeft()
        let delete = app.buttons["Delete"]
        XCTAssertTrue(wait(delete))
        XCTAssertEqual(delete.label, "Delete")
        shot("9 swiped verdict")
        row.swipeRight()
    }

    func testRemoveAllLinksAsksAboutLinks() {
        launch("menu:en")
        let removeAll = app.buttons["Remove all"]
        XCTAssertTrue(wait(removeAll))
        removeAll.tap()
        let question = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Remove'")).firstMatch
        XCTAssertTrue(wait(question))
        XCTAssertTrue(question.label.contains("link"), question.label)
        XCTAssertFalse(question.label.contains("verdict"), question.label)
        shot("10 remove all links")
        // iOS 26 shows the dialog as a popover with no Cancel button; tapping outside it, on the menu panel, is its cancel.
        let cancel = app.buttons["Cancel"]
        if cancel.exists {
            cancel.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.97)).tap()
        }
        XCTAssertTrue(wait(question, exists: false))
        XCTAssertTrue(removeAll.exists)
    }
}
