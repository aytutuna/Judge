import SwiftUI

/// The sign-in sheet: Apple, Google, then an email that leads to its
/// password or an emailed six-digit code, with the consent line at the
/// bottom. Only methods the server reports as available are shown.
struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var webLink: WebLink?
    @State private var showPassword = false
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case email, password, code
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
                if account.step == .choose { legal(lang) }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.ivory.ignoresSafeArea())
        .interactiveDismissDisabled(account.busy != nil || account.step == .choosePassword)
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
        .environment(\.locale, lang.locale)
        .onAppear { app.analytics.track("screen_view", ["screen": "sign_in"]) }
        .task {
            if app.account.needsPlatformAge(onSignIn: true) { await app.account.checkPlatformAge() }
        }
    }


    private func topBar(_ lang: AppLang) -> some View {
        HStack {
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
            .disabled(app.account.busy != nil || app.account.step == .choosePassword)
            .opacity(app.account.step == .choosePassword ? 0 : 1)
            .accessibilityHidden(app.account.step == .choosePassword)
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
                    case .password:
                        passwordScreen(lang, account: account)
                    case .code(let email):
                        codeForm(lang, email: email, account: account)
                    case .choosePassword:
                        passwordChoice(lang, account: account)
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
                app.analytics.track("sign_in_started", ["provider": "apple"])
                Task { await app.account.signInWithApple() }
            } label: {
                ProviderLabel(title: L10n.signinApple(lang), busy: account.busy == .apple, tint: AppleButtonStyle.label) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 18, weight: .medium))
                }
            }
            .buttonStyle(AppleButtonStyle())
            .disabled(account.busy != nil)
            .overlay(alignment: .trailing) { lastUsedTag(lang, .apple, tint: AppleButtonStyle.label) }
        }
        if providers.google {
            Button {
                app.analytics.track("sign_in_started", ["provider": "google"])
                Task { await app.account.signInWithGoogle() }
            } label: {
                ProviderLabel(title: L10n.signinGoogle(lang), busy: account.busy == .google, tint: Brand.ink) {
                    GoogleMark().frame(width: 18, height: 18)
                }
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(account.busy != nil)
            .overlay(alignment: .trailing) { lastUsedTag(lang, .google, tint: Brand.muted) }
        }
        if providers.emailCode {
            if providers.apple || providers.google {
                OrDivider(text: L10n.appSigninOr(lang))
            }
            emailForm(lang, account: account)
        }
    }

    /// The "Last used" tag, on the method the last sign-in on this phone used.
    @ViewBuilder
    private func lastUsedTag(_ lang: AppLang, _ method: AccountModel.LastMethod, tint: Color) -> some View {
        if app.account.lastMethod == method {
            Text(L10n.signinLastUsed(lang))
                .brandText(.footnote)
                .foregroundStyle(tint)
                .padding(.trailing, 20)
                .allowsHitTesting(false)
        }
    }

    private func emailForm(_ lang: AppLang, account: AccountModel) -> some View {
        @Bindable var account = account
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(L10n.signinEmailLabel(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Spacer(minLength: 12)
                if account.lastMethod == .email {
                    Text(L10n.signinLastUsed(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                }
            }
            TextField("", text: $account.email, prompt: Text(L10n.signinEmailPlaceholder(lang)).foregroundStyle(Brand.placeholder))
                .focused($focus, equals: .email)
                .textContentType(account.passwordSignIn ? .username : .emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.continue)
                .onSubmit { continueWithEmail() }
                .disabled(account.busy != nil)
                .brandText(.body)
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .paperSurface(radius: Radius.field, fill: Brand.paper, border: focus == .email ? Brand.terraInk : Brand.line2)
                .accessibilityLabel(L10n.signinEmailLabel(lang))
            Button { continueWithEmail() } label: {
                if account.busy == .sendCode {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.signinContinue(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!account.canSendCode)
        }
    }

    /// The address takes a password (sign in) or has none yet (create one).
    private func passwordScreen(_ lang: AppLang, account: AccountModel) -> some View {
        @Bindable var account = account
        let creating = account.mode == .create
        return VStack(alignment: .leading, spacing: 12) {
            // A read-only field, so AutoFill ties the password to the address.
            TextField("", text: .constant(account.email))
                .textContentType(.username)
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .allowsHitTesting(false)
            Text(creating ? L10n.signinPasswordNew(lang) : L10n.signinPassword(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            passwordField(lang, text: $account.password, creating: creating) {
                submitPassword(creating: creating)
            }
            Button { submitPassword(creating: creating) } label: {
                if account.busy == (creating ? .sendCode : .password) {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(creating ? L10n.signinContinue(lang) : L10n.signinPasswordSubmit(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(creating ? !account.canSendCode : !account.canSignInWithPassword)
            VStack(alignment: .leading, spacing: 0) {
                if !creating {
                    Button(L10n.signinForgot(lang)) {
                        showPassword = false
                        Task {
                            await app.account.forgotPassword(lang: lang)
                            if case .code = app.account.step { focus = .code }
                        }
                    }
                    .buttonStyle(LinkButtonStyle())
                    Button(L10n.signinUseCode(lang)) {
                        showPassword = false
                        Task {
                            await app.account.useCode(lang: lang)
                            if case .code = app.account.step { focus = .code }
                        }
                    }
                    .buttonStyle(LinkButtonStyle())
                }
                Button(L10n.appSigninChangeEmail(lang)) {
                    showPassword = false
                    app.account.changeEmail()
                    focus = .email
                }
                .buttonStyle(LinkButtonStyle())
            }
            .disabled(account.busy != nil)
        }
    }

    /// A password box with a show/hide link under it. `onSubmit` runs on the
    /// keyboard's return key.
    private func passwordField(_ lang: AppLang, text: Binding<String>, creating: Bool, onSubmit: @escaping () -> Void) -> some View {
        let type: UITextContentType = creating ? .newPassword : .password
        return VStack(alignment: .leading, spacing: 0) {
            Group {
                if showPassword {
                    TextField("", text: text)
                } else {
                    SecureField("", text: text)
                }
            }
            .focused($focus, equals: .password)
            .textContentType(type)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .onSubmit(onSubmit)
            .brandText(.body)
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .paperSurface(radius: Radius.field, fill: Brand.paper, border: focus == .password ? Brand.terraInk : Brand.line2)
            .accessibilityLabel(creating ? L10n.signinPasswordNew(lang) : L10n.signinPassword(lang))
            Button(L10n.signinPasswordShow(lang)) { showPassword.toggle() }
                .buttonStyle(LinkButtonStyle())
                .accessibilityAddTraits(showPassword ? .isSelected : [])
        }
    }

    /// Signed in by the code: choose a password, or skip.
    private func passwordChoice(_ lang: AppLang, account: AccountModel) -> some View {
        @Bindable var account = account
        return VStack(alignment: .leading, spacing: 12) {
            Text(L10n.signinPasswordChoose(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Text(L10n.signinPasswordNew(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            passwordField(lang, text: $account.password, creating: true) {
                Task { await app.account.saveChosenPassword() }
            }
            Button {
                Task { await app.account.saveChosenPassword() }
            } label: {
                if account.busy == .password {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(account.failure == nil ? L10n.signinPasswordSave(lang) : L10n.appRetry(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(account.busy != nil || account.password.isEmpty)
            Button(L10n.signinSkip(lang)) { app.account.skipPassword() }
                .buttonStyle(LinkButtonStyle())
                .disabled(account.busy != nil)
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
                    if AccountModel.digits(old).count < AccountModel.codeLength, app.account.shouldAutoSubmitCode {
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
                Button(account.resendIn > 0 ? L10n.signinCodeResendIn(lang, n: String(account.resendIn)) : L10n.appSigninCodeResend(lang)) {
                    Task { await app.account.resendCode(lang: lang) }
                }
                .buttonStyle(LinkButtonStyle())
                .disabled(account.resendIn > 0)
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

    /// The consent line as one sentence with the Terms and the Privacy
    /// Policy as tappable links.
    private func legal(_ lang: AppLang) -> some View {
        func link(_ text: String, _ url: URL) -> AttributedString {
            var part = AttributedString(text)
            part.link = url
            part.foregroundColor = Brand.terraInk
            part.underlineStyle = Text.LineStyle(pattern: .solid)
            return part
        }
        var sentence = AttributedString(L10n.appSigninLegal(lang))
        sentence += link(L10n.appSigninLegalTerms(lang), app.config.termsURL)
        sentence += AttributedString(L10n.appSigninLegalAnd(lang))
        sentence += link(L10n.appSigninLegalPrivacy(lang), app.config.privacyURL)
        sentence += AttributedString(L10n.appSigninLegalAfter(lang))
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

    private func continueWithEmail() {
        guard app.account.canSendCode else { return }
        app.analytics.track("sign_in_started", ["provider": "email"])
        Task {
            await app.account.continueWithEmail(lang: app.lang)
            switch app.account.step {
            case .code: focus = .code
            case .password: focus = .password
            default: break
            }
        }
    }

    private func submitPassword(creating: Bool) {
        guard creating else {
            app.analytics.track("sign_in_started", ["provider": "password"])
            Task { await app.account.signInWithPassword() }
            return
        }
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

/// Sign in with Apple: black pill, white text, the system's Apple logo;
/// white on black in dark, as Apple's own button does.
struct AppleButtonStyle: ButtonStyle {
    static let label = Color(light: .white, dark: .black)
    private static let fill = Color(light: .black, dark: .white)

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.button)
            .foregroundStyle(Self.label)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 20)
            .background(Capsule().fill(Self.fill.opacity(isEnabled ? 1 : 0.55)))
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
            .background(Capsule().fill(configuration.isPressed ? Brand.paperHi : Brand.paper))
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
