import SwiftUI
import UIKit

/// Premium's clarifying step (components/ClarifyStep.tsx), shown in place
/// of the form: up to two short questions, each answered by tapping a likely
/// answer or Other (a text box), or left empty, then "Get the verdict" or
/// "Skip and judge".
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
                        .accessibilityHidden(question.options.isEmpty)
                    if question.options.isEmpty {
                        ClarifyAnswerField(home: home, id: question.id, placeholder: L10n.clarifyPlaceholder(lang))
                            .paperSurface(radius: Radius.field, fill: Brand.paper, border: Brand.line2)
                            .accessibilityLabel(L10n.clarifyAnswerAria(lang, n: String(index + 1)) + " " + question.text)
                    } else {
                        ClarifyChoices(home: home, question: question, lang: lang)
                    }
                }
            }

            VStack(spacing: 10) {
                Button {
                    hideKeyboard()
                    home.finishClarify(skip: false, app: app)
                } label: {
                    Text(L10n.clarifySubmit(lang) + (lang.isRTL ? " ←" : " →"))
                }
                .buttonStyle(PrimaryButtonStyle())
                Button(L10n.clarifySkip(lang)) {
                    hideKeyboard()
                    home.finishClarify(skip: true, app: app)
                }
                .buttonStyle(GhostButtonStyle())
                .frame(maxWidth: .infinity)
                Button((lang.isRTL ? "→ " : "← ") + L10n.clarifyBack(lang)) {
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

/// The likely answers as single-select chips plus Other, which reveals the
/// text box. Nothing starts selected; tapping the selected chip clears it.
private struct ClarifyChoices: View {
    private enum Pick: Equatable {
        case option(Int)
        case other
    }

    let home: HomeModel
    let question: ClarifyQuestion
    let lang: AppLang
    @State private var pick: Pick?
    // Kept while an option is picked, so choosing Other again restores it.
    @State private var typed: String
    @FocusState private var otherFocused: Bool

    @MainActor
    init(home: HomeModel, question: ClarifyQuestion, lang: AppLang) {
        self.home = home
        self.question = question
        self.lang = lang
        let answer = home.clarify?.answers[question.id] ?? ""
        if let i = question.options.firstIndex(of: answer) {
            _pick = State(initialValue: .option(i))
            _typed = State(initialValue: "")
        } else if !answer.isEmpty {
            _pick = State(initialValue: .other)
            _typed = State(initialValue: answer)
        } else {
            _pick = State(initialValue: nil)
            _typed = State(initialValue: "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(Array(question.options.enumerated()), id: \.offset) { index, text in
                    chip(text, .option(index))
                }
                chip(L10n.clarifyOther(lang), .other)
            }
            if pick == .other {
                TextField(L10n.clarifyPlaceholder(lang), text: $typed, axis: .vertical)
                    .lineLimit(2...5)
                    .brandText(.body)
                    .foregroundStyle(Brand.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .paperSurface(radius: Radius.field, fill: Brand.paper, border: Brand.line2)
                    .focused($otherFocused)
                    .accessibilityLabel(question.text + " " + L10n.clarifyOther(lang))
                    .onChange(of: typed) { _, value in
                        let capped = HomeModel.capUTF16(value, max: HomeModel.maxAnswer)
                        if capped != value { typed = capped }
                        home.setAnswer(capped, for: question.id)
                    }
            }
        }
    }

    private func chip(_ text: String, _ value: Pick) -> some View {
        let selected = pick == value
        return Button {
            pick = selected ? nil : value
            switch pick {
            case .none: home.setAnswer("", for: question.id)
            case .other?:
                home.setAnswer(typed, for: question.id)
                otherFocused = true
            case .option(let i)?: home.setAnswer(question.options[i], for: question.id)
            }
        } label: {
            Text(text)
                .brandText(.chip)
                .foregroundStyle(selected ? Brand.ivory : Brand.ink)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(Capsule().fill(selected ? Brand.ink : Brand.paper))
                .overlay(Capsule().strokeBorder(selected ? Brand.ink : Brand.line2, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
