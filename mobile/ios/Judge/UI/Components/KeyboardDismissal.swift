import SwiftUI
import UIKit

extension View {
    /// Puts the keyboard away on a tap outside a text box, and gives multi-line
    /// boxes a button above the keyboard to do the same (their return key adds
    /// a line). Placed once, near the root; it covers sheets too.
    func dismissesKeyboard(closeLabel: String) -> some View {
        background(KeyboardDismissal(closeLabel: closeLabel))
    }
}

private struct KeyboardDismissal: UIViewRepresentable {
    let closeLabel: String

    func makeUIView(context: Context) -> Anchor { Anchor() }

    func updateUIView(_ view: Anchor, context: Context) {
        view.closeLabel = closeLabel
    }

    final class Anchor: UIView, UIGestureRecognizerDelegate {
        var closeLabel = ""
        private let tap = UITapGestureRecognizer()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            tap.addTarget(self, action: #selector(resign))
            tap.cancelsTouchesInView = false
            tap.delegate = self
            NotificationCenter.default.addObserver(
                self, selector: #selector(editingBegan(_:)), name: UITextView.textDidBeginEditingNotification, object: nil
            )
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            tap.view?.removeGestureRecognizer(tap)
            window?.addGestureRecognizer(tap)
        }

        @objc private func resign() {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }

        @objc private func editingBegan(_ note: Notification) {
            guard let textView = note.object as? UITextView, textView.inputAccessoryView == nil else { return }
            let bar = UIToolbar()
            let close = UIBarButtonItem(image: UIImage(systemName: "keyboard.chevron.compact.down"), style: .plain, target: self, action: #selector(resign))
            close.accessibilityLabel = closeLabel
            bar.items = [.flexibleSpace(), close]
            bar.sizeToFit()
            textView.inputAccessoryView = bar
            textView.reloadInputViews()
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            var view = touch.view
            while let current = view {
                if current is UITextView || current is UITextField { return false }
                view = current.superview
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
