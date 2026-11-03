import SwiftUI

/// A side's name in its card on Home (at most 40 characters). Your side is
/// prefilled with the account's first name until the user types.
struct CaseNameField: View {
    @Binding var name: String?
    /// The account first name the field falls back to.
    let fallback: String
    let placeholder: String
    let disabled: Bool
    @State private var text: String

    @MainActor
    init(name: Binding<String?>, fallback: String, placeholder: String, disabled: Bool) {
        _name = name
        self.fallback = fallback
        self.placeholder = placeholder
        self.disabled = disabled
        _text = State(initialValue: name.wrappedValue ?? fallback)
    }

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Brand.placeholder))
            .textContentType(.givenName)
            .brandText(TypeStyle(face: .inter, weight: 600, size: 14, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.8))
            .foregroundStyle(Brand.ink)
            .frame(minHeight: 32)
            .disabled(disabled)
            .accessibilityLabel(placeholder)
            .onChange(of: text) { _, value in
                let capped = HomeModel.capUTF16(value, max: 40)
                if capped != value { text = capped }
                if capped != (name ?? fallback) { name = capped }
            }
            .onChange(of: name) { _, value in
                // A created case or the "+" clears the name, an example writes
                // one: show what the model holds.
                let shown = value ?? fallback
                if shown != text { text = shown }
            }
            .onChange(of: fallback) { _, value in
                if name == nil { text = value }
            }
    }
}
