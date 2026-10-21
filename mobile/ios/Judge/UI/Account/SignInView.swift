import SwiftUI

/// The sign-in sheet: Apple first, then Google, then an emailed six-digit
/// code, with the outside-AI consent line at the bottom. Only methods the
/// server reports as available are shown.
struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var webLink: WebLink?
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case email, code
    }

    var body: some View {
        let account = app.account
        let lang = app.lang
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                topBar(lang)
                VStack(alignment: .leading, spacing: 10) {
                    Text(L10n.signinTitle(lang))
                        .brandText(.display1)
                        .foregroundStyle(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(L10n.appSigninRequired(lang))
                        .brandText(.lead)
                        .foregroundStyle(Brand.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if account.notice == .sessionExpired {
                    NoticeBanner(message: L10n.appAccountSessionExpired(lang))
                }
                card(lang, account: account)
                legal(lang)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.ivory.ignoresSafeArea())
        .interactiveDismissDisabled(account.busy != nil)
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .environment(\.locale, lang.locale)
    }

    private func topBar(_ lang: AppLang) -> some View {
        HStack {
            BrandMark(width: 30)
            Spacer()
            Button {
                app.account.isSignInPresented = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Brand.ink2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Brand.paper))
                    .overlay(Circle().strokeBorder(Brand.line2, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(app.account.busy != nil)
            .accessibilityLabel(L10n.appCancel(lang))
        }
    }

    @ViewBuilder
    private func card(_ lang: AppLang, account: AccountModel) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            switch account.providers {
            case .loading:
                HStack(spacing: 10) {
                    ProgressView().tint(Brand.muted)
                    Text(L10n.signinLoading(lang))
                        .brandText(.slotText)
                        .foregroundStyle(Brand.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 120)
            case .failed:
                ErrorBanner(
                    message: L10n.appSigninUnavailable(lang),
                    retryTitle: L10n.appRetry(lang),
                    onRetry: { Task { await app.account.loadProviders() } }
                )
            case .loaded(let providers):
                if !providers.any {
                    ErrorBanner(message: L10n.appSigninUnavailable(lang))
                } else {
                    switch account.step {
                    case .choose:
                        chooser(lang, providers: providers, account: account)
                    case .code(let email):
                        codeForm(lang, email: email, account: account)
                    }
                }
            }
            if let failure = account.failure {
                ErrorBanner(message: failure.message(lang))
            }
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
    }

    @ViewBuilder
    private func chooser(_ lang: AppLang, providers: SignInProviders, account: AccountModel) -> some View {
        if providers.apple {
            Button {
                Task { await app.account.signInWithApple() }
            } label: {
                ProviderLabel(title: L10n.signinApple(lang), busy: account.busy == .apple, tint: .white) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 18, weight: .medium))
                }
            }
            .buttonStyle(AppleButtonStyle())
            .disabled(account.busy != nil)
        }
        if providers.google {
            Button {
                Task { await app.account.signInWithGoogle() }
            } label: {
                ProviderLabel(title: L10n.signinGoogle(lang), busy: account.busy == .google, tint: Brand.ink) {
                    GoogleMark().frame(width: 18, height: 18)
                }
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(account.busy != nil)
        }
        if providers.emailCode {
            if providers.apple || providers.google {
                OrDivider(text: L10n.appSigninOr(lang))
            }
            emailForm(lang, account: account)
        }
    }

    private func emailForm(_ lang: AppLang, account: AccountModel) -> some View {
        @Bindable var account = account
        return VStack(alignment: .leading, spacing: 10) {
            Text(L10n.signinEmailLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            TextField("", text: $account.email, prompt: Text(L10n.signinEmailPlaceholder(lang)).foregroundStyle(Brand.placeholder))
                .focused($focus, equals: .email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .onSubmit { sendCode() }
                .brandText(.body)
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .paperSurface(radius: Radius.field, fill: Brand.paper, border: focus == .email ? Brand.terraInk : Brand.line2)
                .accessibilityLabel(L10n.signinEmailLabel(lang))
            Button { sendCode() } label: {
                if account.busy == .sendCode {
                    ProgressView().tint(Brand.ink)
                } else {
                    Text(L10n.appSigninCodeRequest(lang))
                }
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(!account.canSendCode)
        }
    }

    private func codeForm(_ lang: AppLang, email: String, account: AccountModel) -> some View {
        @Bindable var account = account
        return VStack(alignment: .leading, spacing: 12) {
            Text(L10n.appSigninCodeSent(lang, email: email))
                .brandText(.slotText)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Text(L10n.appSigninCodeLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            TextField("", text: $account.code, prompt: Text("000000").foregroundStyle(Brand.placeholder.opacity(0.6)))
                .focused($focus, equals: .code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(.system(size: 28, weight: .semibold, design: .monospaced))
                .tracking(8)
                .multilineTextAlignment(.center)
                .foregroundStyle(Brand.ink)
                .frame(minHeight: 60)
                .paperSurface(radius: Radius.field, fill: Brand.paper, border: focus == .code ? Brand.terraInk : Brand.line2)
                .accessibilityLabel(L10n.appSigninCodeLabel(lang))
                .onChange(of: account.code) { old, new in
                    let digits = AccountModel.digits(new)
                    if digits != new { account.code = digits }
                    if digits.count == AccountModel.codeLength, AccountModel.digits(old).count < AccountModel.codeLength {
                        Task { await app.account.verifyCode() }
                    }
                }
            Button {
                Task { await app.account.verifyCode() }
            } label: {
                if account.busy == .verifyCode {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.appSigninCodeSubmit(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!account.canVerifyCode)
            HStack {
                Button(L10n.appSigninCodeResend(lang)) {
                    Task { await app.account.resendCode(lang: lang) }
                }
                .buttonStyle(LinkButtonStyle())
                Spacer(minLength: 12)
                Button(L10n.appSigninChangeEmail(lang)) {
                    app.account.changeEmail()
                    focus = .email
                }
                .buttonStyle(LinkButtonStyle())
            }
            .disabled(account.busy != nil)
        }
    }

    /// The consent line as one sentence with the policy as a tappable link.
    private func legal(_ lang: AppLang) -> some View {
        var sentence = AttributedString(L10n.signinLegal(lang) + " ")
        var link = AttributedString(L10n.signinLegalLink(lang))
        link.link = app.config.siteURL("privacy")
        link.foregroundColor = Brand.terraInk
        link.underlineStyle = Text.LineStyle(pattern: .solid)
        sentence += link
        sentence += AttributedString(L10n.signinLegalAfter(lang))
        return Text(sentence)
            .brandText(.footnote)
            .foregroundStyle(Brand.muted)
            .tint(Brand.terraInk)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in
                webLink = WebLink(url: url)
                return .handled
            })
    }

    private func sendCode() {
        Task {
            await app.account.sendCode(lang: app.lang)
            if case .code = app.account.step { focus = .code }
        }
    }
}

/// Icon, title and a spinner in place of the icon while busy.
private struct ProviderLabel<Icon: View>: View {
    let title: String
    let busy: Bool
    let tint: Color
    @ViewBuilder let icon: () -> Icon

    var body: some View {
        HStack(spacing: 10) {
            if busy {
                ProgressView().tint(tint)
            } else {
                icon()
            }
            Text(title)
        }
    }
}

/// Sign in with Apple: black pill, white text, the system's Apple logo.
struct AppleButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.button)
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 20)
            .background(Capsule().fill(Color.black.opacity(isEnabled ? 1 : 0.55)))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// A full-width paper pill with a hairline border (secondary actions).
struct OutlineButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.button)
            .foregroundStyle(Brand.ink.opacity(isEnabled ? 1 : 0.45))
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 20)
            .background(Capsule().fill(configuration.isPressed ? Color.white : Brand.paper))
            .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// "or" between two hairlines.
struct OrDivider: View {
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Brand.line2).frame(height: 1)
            Text(text)
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
            Rectangle().fill(Brand.line2).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}

/// A calm information box (sage), for notices that are not errors.
struct NoticeBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(Brand.sageInk)
                .accessibilityHidden(true)
            Text(message)
                .brandText(.slotText)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .paperSurface(radius: 16, fill: Brand.sageTint.opacity(0.7), border: Brand.sage.opacity(0.45))
        .accessibilityElement(children: .combine)
    }
}

/// The four-colour Google "G", drawn (no image asset).
struct GoogleMark: View {
    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let line = side * 0.2
            let radius = (side - line) / 2
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            func arc(_ from: Double, _ to: Double, _ color: Color) {
                var path = Path()
                path.addArc(center: center, radius: radius, startAngle: .degrees(from), endAngle: .degrees(to), clockwise: false)
                context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: line, lineCap: .butt))
            }
            let blue = Color(hex: 0x4285F4)
            // Angles run clockwise from three o'clock; the gap is upper right.
            arc(0, 50, blue)
            arc(50, 140, Color(hex: 0x34A853))
            arc(140, 220, Color(hex: 0xFBBC05))
            arc(220, 315, Color(hex: 0xEA4335))
            var bar = Path()
            bar.move(to: CGPoint(x: center.x, y: center.y))
            bar.addLine(to: CGPoint(x: center.x + radius + line / 2, y: center.y))
            context.stroke(bar, with: .color(blue), style: StrokeStyle(lineWidth: line, lineCap: .butt))
        }
        .accessibilityHidden(true)
    }
}
