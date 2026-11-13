import XCTest

final class HomeSidesUITests: UITestCase {
    private let yours = "Your side of the argument"
    private let theirs = "Their side of the argument"

    /// Exposed as an alert, since the lifted box is modal for VoiceOver.
    private var liftedCard: XCUIElement {
        app.descendants(matching: .any).matching(identifier: "side.lifted").firstMatch
    }

    private func addTheirSide() {
        let add = app.buttons["Add their side"]
        XCTAssertTrue(wait(add))
        press(add)
        XCTAssertTrue(wait(app.buttons[theirs]))
    }

    private func lift(_ label: String) -> XCUIElement {
        press(app.buttons[label])
        let card = liftedCard
        XCTAssertTrue(wait(card))
        XCTAssertTrue(wait(keyboard))
        return card
    }

    func testAddingASideKeepsTheKeyboardDown() {
        launch("home:en")
        XCTAssertFalse(keyboard.exists)
        shot("1 one side")
        addTheirSide()
        XCTAssertTrue(staysAbsent(keyboard))
        XCTAssertFalse(liftedCard.exists)
        shot("2 their side added")
    }

    func testSeveralSidesScrollAndOnlyTheSendRowIsPinned() {
        launch("home:en")
        addTheirSide()
        let list = app.scrollViews.firstMatch
        let send = app.buttons["Get the verdict"]
        XCTAssertTrue(send.exists)
        XCTAssertFalse(list.buttons["Get the verdict"].exists, "the send row belongs at the bottom, outside the list")
        for label in [yours, theirs] {
            let box = app.buttons[label]
            XCTAssertTrue(list.buttons[label].exists, "\(label) is in the list")
            XCTAssertLessThan(box.frame.maxY, send.frame.minY)
        }
        // No text box is pinned next to the send button.
        XCTAssertEqual(app.textViews.count, 0)

        let more = app.buttons["Add another side"]
        XCTAssertTrue(wait(more))
        press(more)
        XCTAssertTrue(wait(app.buttons["Party C"]))
        XCTAssertTrue(list.buttons["Party C"].exists)
        XCTAssertEqual(app.textViews.count, 0)
        XCTAssertFalse(list.buttons["Get the verdict"].exists)
        shot("3 three sides in the list")
    }

    func testTappingASideLiftsItAndTypingGrowsIt() {
        launch("home:en")
        addTheirSide()
        let card = lift(theirs)
        let editor = app.textViews[theirs]
        XCTAssertTrue(wait(editor))
        XCTAssertTrue(waitForFocus(editor))
        shot("4 lifted with keyboard")

        let before = card.frame.height
        app.typeText("They never did the dishes")
        XCTAssertEqual(editor.value as? String, "They never did the dishes")
        app.typeText(String(repeating: "\nand another line", count: 6))
        XCTAssertGreaterThan(card.frame.height, before)
        shot("5 typed and grown")

        press(app.buttons["Close"])
        XCTAssertTrue(wait(card, exists: false))
        let theirBox = app.buttons[theirs]
        XCTAssertTrue(wait(theirBox))
        XCTAssertTrue((theirBox.value as? String ?? "").hasPrefix("They never did the dishes"))
        XCTAssertEqual(app.buttons[yours].value as? String ?? "", "", "the text went to their side only")
    }

    private enum Start: String, CaseIterable { case grabber, header }

    private func point(on card: XCUIElement, _ start: Start) -> XCUICoordinate {
        let top = card.coordinate(withNormalizedOffset: .zero)
        switch start {
        case .grabber: return top.withOffset(CGVector(dx: card.frame.width / 2, dy: 12))
        case .header: return top.withOffset(CGVector(dx: 28, dy: 52))
        }
    }

    func testFlingingTheLiftedBoxAwayUnselectsIt() {
        launch("home:en")
        addTheirSide()
        let directions: [(String, CGVector)] = [
            ("up", CGVector(dx: 0, dy: -350)),
            ("down", CGVector(dx: 0, dy: 400)),
            ("left", CGVector(dx: -280, dy: 0)),
            ("right", CGVector(dx: 280, dy: 0)),
        ]
        var typed = false
        for start in Start.allCases {
            for (name, vector) in directions {
                let card = lift(theirs)
                XCTAssertTrue(waitForFocus(app.textViews[theirs]))
                if !typed {
                    app.typeText("kept text")
                    typed = true
                }
                let from = point(on: card, start)
                from.press(forDuration: 0.05, thenDragTo: from.withOffset(vector), withVelocity: .fast, thenHoldForDuration: 0)
                XCTAssertTrue(wait(card, exists: false), "\(start) \(name): lifted box is gone")
                XCTAssertTrue(wait(keyboard, exists: false), "\(start) \(name): keyboard is gone")
                XCTAssertFalse(app.textViews[theirs].exists)
                let box = app.buttons[theirs]
                XCTAssertTrue(wait(box), "\(start) \(name): the list card is back")
                XCTAssertEqual(box.value as? String, "kept text", "\(start) \(name): text kept")
                if start == .grabber, name == "up" { shot("6 after the fling up") }
            }
        }
    }

    func testShortDragSpringsBack() {
        launch("home:en")
        addTheirSide()
        let card = lift(theirs)
        let rest = card.frame
        for start in Start.allCases {
            let from = point(on: card, start)
            from.press(forDuration: 0.3, thenDragTo: from.withOffset(CGVector(dx: 0, dy: -25)), withVelocity: XCUIGestureVelocity(rawValue: 30), thenHoldForDuration: 0.6)
            shot("after short drag \(start)")
            let settled = NSPredicate { _, _ in abs(card.frame.minY - rest.minY) < 2 }
            let back = XCTNSPredicateExpectation(predicate: settled, object: nil)
            XCTAssertEqual(XCTWaiter().wait(for: [back], timeout: 5), .completed, "\(start): the box springs back")
            XCTAssertTrue(card.exists, "\(start): the box stays lifted")
            XCTAssertTrue(keyboard.exists, "\(start): the keyboard stays up")
        }
        shot("7 after a short drag")
    }
}
