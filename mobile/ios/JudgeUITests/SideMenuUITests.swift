import XCTest

final class SideMenuUITests: UITestCase {
    func testSwipingAVerdictShowsDelete() {
        launch("menu:en")
        // The first verdict is still being judged and cannot be removed.
        let row = app.buttons.matching(identifier: "menu.verdict").matching(NSPredicate(format: "label BEGINSWITH 'You are right'")).firstMatch
        XCTAssertTrue(wait(row))
        shot("8 side menu")
        XCTAssertFalse(app.buttons["Delete"].exists)
        // swipeLeft() is fast enough to count as a full swipe, which opens the dialog straight away.
        let start = row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: -110, dy: 0)), withVelocity: 300, thenHoldForDuration: 0.3)
        let delete = app.buttons["Delete"]
        XCTAssertTrue(wait(delete))
        XCTAssertFalse(removeQuestion.exists, "a full swipe opened the dialog")
        XCTAssertTrue((row.frame.minY...row.frame.maxY).contains(delete.frame.midY), "the Delete button is the row's swipe action")
        XCTAssertEqual(delete.label, "Delete")
        shot("9 swiped verdict")
        row.swipeRight()
    }

    func testRemoveAllLinksAsksAboutLinks() {
        launch("menu:en")
        let removeAll = app.buttons["Remove all"]
        XCTAssertTrue(wait(removeAll))
        removeAll.tap()
        let question = removeQuestion
        XCTAssertTrue(wait(question))
        XCTAssertTrue(question.label.contains("link"), question.label)
        XCTAssertFalse(question.label.contains("verdict"), question.label)
        XCTAssertFalse(app.buttons["Delete"].exists, "the dialog's button says Remove all")
        shot("10 remove all links")
        // iOS 26 shows the dialog as a popover with no Cancel button, sitting over the Links heading.
        // Tapping outside it is its cancel; the Verdicts heading is well clear and does nothing itself.
        let cancel = app.buttons["Cancel"]
        if cancel.exists {
            cancel.tap()
        } else {
            press(app.staticTexts["Verdicts"])
        }
        // The closed popover's text can stay in the tree for a while, off screen.
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR hittable == false"), object: question)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 10), .completed)
        XCTAssertTrue(removeAll.exists)
        shot("11 remove all cancelled")
    }

    // "Removed by Sam" on a link row also starts with "Remove".
    private var removeQuestion: XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Remove ' AND label ENDSWITH 'undone.'")).firstMatch
    }
}
