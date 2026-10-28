import SwiftUI
import UIKit

/// Premium's clarifying step (components/ClarifyStep.tsx), shown in place
/// of the form: up to two short questions, each with an optional answer,
/// then "Get the verdict" or "Skip and judge".
struct ClarifyCard: View {
    @Environment(AppModel.self) private var app
    let home: HomeModel
    let state: HomeModel.ClarifyState
    let lang: AppLang

    private static let title = TypeStyle(face: .interTight, weight: 700, size: 26, lineHeight: 1.1, tracking: -0.02, textStyle: .title2, maxScale: 1.4)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(L10n.clarifyTitle(lang))
                .brandText(Self.title)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            Text(L10n.clarifyLead(lang))
                .brandText(.body)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(Array(state.questions.enumerated()), id: \.element.id) { index, question in
                VStack(alignment: .leading, spacing: 8) {
                    Text(question.text)
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityHidden(true)
                    ClarifyAnswerField(home: home, id: question.id, placeholder: L10n.clarifyPlaceholder(lang))
                        .paperSurface(radius: Radius.field, fill: Brand.paper, border: Brand.line2)
                        .accessibilityLabel(L10n.clarifyAnswerAria(lang, n: String(index + 1)) + " " + question.text)
                }
            }

            VStack(spacing: 10) {
                Button {
                    hideKeyboard()
                    home.finishClarify(skip: false, app: app)
                } label: {
                    Text(L10n.clarifySubmit(lang) + " →")
                }
                .buttonStyle(PrimaryButtonStyle())
                Button(L10n.clarifySkip(lang)) {
                    hideKeyboard()
                    home.finishClarify(skip: true, app: app)
                }
                .buttonStyle(GhostButtonStyle())
                .frame(maxWidth: .infinity)
                Button("← " + L10n.clarifyBack(lang)) {
                    hideKeyboard()
                    home.clarifyBack()
                }
                .buttonStyle(LinkButtonStyle())
            }
            .padding(.top, 4)
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
    }

    private func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

/// One optional answer (at most 500 characters), written through to the model.
private struct ClarifyAnswerField: View {
    let home: HomeModel
    let id: String
    let placeholder: String
    @State private var text: String

    @MainActor
    init(home: HomeModel, id: String, placeholder: String) {
        self.home = home
        self.id = id
        self.placeholder = placeholder
        _text = State(initialValue: home.clarify?.answers[id] ?? "")
    }

    var body: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .lineLimit(2...5)
            .brandText(.body)
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .onChange(of: text) { _, value in
                let capped = HomeModel.capUTF16(value, max: HomeModel.maxAnswer)
                if capped != value { text = capped }
                home.setAnswer(capped, for: id)
            }
    }
}
