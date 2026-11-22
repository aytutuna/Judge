import SwiftUI

/// Asked once, under the verdict after the person's second finished one.
struct ConsentCard: View {
    @Environment(AppModel.self) private var app
    @State private var webLink: WebLink?
    let lang: AppLang

    var body: some View {
        if app.consent.showCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(L10n.consentCardTitle(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Text(bodyWithLink)
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                    .tint(Brand.terraInk)
                    .environment(\.openURL, OpenURLAction { _ in
                        webLink = WebLink(url: app.config.helpImproveURL)
                        return .handled
                    })
                HStack(spacing: 16) {
                    Button(L10n.consentCardYes(lang)) {
                        Task { await app.consent.answerCard(true, lang: lang) }
                    }
                    Button(L10n.consentCardNo(lang)) {
                        Task { await app.consent.answerCard(false, lang: lang) }
                    }
                }
                .brandText(.chip)
                .foregroundStyle(Brand.terraInk)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 14).fill(Brand.paper))
            .accessibilityElement(children: .contain)
            .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            .sheet(item: $webLink) { link in
                SafariView(url: link.url).ignoresSafeArea()
            }
        }
    }

    /// The body with "How it works" as a tappable run at the end of the sentence.
    private var bodyWithLink: AttributedString {
        var link = AttributedString(L10n.consentCardLink(lang))
        link.link = app.config.helpImproveURL
        link.foregroundColor = Brand.terraInk
        link.underlineStyle = Text.LineStyle(pattern: .solid)
        return AttributedString(L10n.consentCardBody(lang) + " ") + link
    }
}

/// "Fair verdict?" with two thumbs; a tap on the chosen one clears it.
struct RatingRow: View {
    @Environment(AppModel.self) private var app
    let id: String
    let lang: AppLang
    @State private var rating: Rating?

    var body: some View {
        // The consent card goes first; the row takes its place once it is answered.
        Group {
            if !app.consent.showCard {
                HStack(spacing: 14) {
                    Spacer()
                    Text(L10n.ratingPrompt(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                    thumb(.up, "hand.thumbsup", L10n.ratingFair(lang))
                    thumb(.down, "hand.thumbsdown", L10n.ratingNotFair(lang))
                    Spacer()
                }
                .padding(.top, 8)
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            }
        }
        .task(id: "\(id) \(app.account.isSignedIn)") {
            rating = nil
            guard app.account.isSignedIn else { return }
            rating = try? await app.api.rating(id: id)
        }
    }

    private func thumb(_ value: Rating, _ symbol: String, _ label: String) -> some View {
        let chosen = rating == value
        return Button {
            tap(value)
        } label: {
            Image(systemName: chosen ? symbol + ".fill" : symbol)
                .foregroundStyle(chosen ? Brand.terraInk : Brand.muted)
                .frame(minWidth: 44, minHeight: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func tap(_ value: Rating) {
        guard app.account.isSignedIn else {
            app.account.presentSignIn()
            return
        }
        let before = rating
        let next = before == value ? nil : value
        rating = next
        let id = id
        Task {
            do {
                try await app.api.setRating(id: id, next)
            } catch {
                if rating == next { rating = before }
            }
        }
    }
}
