import SwiftUI
import UIKit

/// "I'm 18 or older", the whole row tappable.
struct AgeCheckbox: View {
    let lang: AppLang
    let ticked: Bool
    let onToggle: (Bool) -> Void
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button {
            onToggle(!ticked)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: ticked ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(ticked ? Brand.ink : Brand.muted)
                    .accessibilityHidden(true)
                Text(L10n.appAgeCheckbox(lang))
                    .brandText(.bodyMedium)
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(isEnabled ? 1 : 0.5)
        .accessibilityAddTraits(ticked ? [.isToggle, .isSelected] : .isToggle)
    }
}

/// Over the whole app for the age check: the confirmation for an account
/// that hasn't confirmed 18+ yet, or the adults-only page.
struct AgeGateView: View {
    @Environment(AppModel.self) private var app
    @State private var confirmDelete = false
    let gate: AgeGate

    var body: some View {
        let lang = app.lang
        let account = app.account
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(L10n.appName(lang))
                    .brandText(.brand)
                    .foregroundStyle(Brand.ink)
                    .frame(minHeight: 44)
                switch gate {
                case .confirm:
                    confirm(lang, account: account)
                case .blocked:
                    blocked(lang, account: account)
                case .none:
                    EmptyView()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .accessibilityAddTraits(.isModal)
        .environment(\.locale, lang.locale)
        .alert(L10n.appAccountDeleteTitle(lang), isPresented: $confirmDelete) {
            Button(L10n.appAccountDeleteConfirm(lang), role: .destructive) {
                Task { await account.deleteAccount() }
            }
            Button(L10n.accountDeleteCancel(lang), role: .cancel) {}
        } message: {
            Text(L10n.appAccountDeleteBody(lang))
        }
    }

    @ViewBuilder
    private func confirm(_ lang: AppLang, account: AccountModel) -> some View {
        let busy = account.agePosting || account.busy != nil
        header(L10n.appAgeTitle(lang), lead: Text(L10n.appAgeLead(lang)))
        VStack(alignment: .leading, spacing: 16) {
            // The phone already said 18+ and only its report failed: no box to tick.
            if account.needsAgeCheckbox {
                AgeCheckbox(lang: lang, ticked: account.ageTicked) { account.setAgeTicked($0) }
                    .disabled(busy)
            }
            if let error = account.ageError {
                ErrorBanner(message: ErrorText.message(error, lang: lang))
            }
            Button {
                Task { await account.confirmAge() }
            } label: {
                if account.agePosting {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.appAgeContinue(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!account.ageAllowsSignIn || busy)
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
        VStack(spacing: 4) {
            Button(L10n.accountSignOut(lang)) {
                Task { await account.signOut() }
            }
            .buttonStyle(LinkButtonStyle())
            deleteButton(lang, account: account)
        }
        .disabled(busy)
        .frame(maxWidth: .infinity)
    }

    /// The account deletion from Settings, which a blocked or unconfirmed
    /// account can still reach.
    @ViewBuilder
    private func deleteButton(_ lang: AppLang, account: AccountModel) -> some View {
        if account.failure == .deleteFailed {
            ErrorBanner(message: L10n.accountDeleteFailed(lang))
        }
        Button {
            confirmDelete = true
        } label: {
            if account.busy == .delete {
                ProgressView().tint(Brand.danger)
            } else {
                Text(L10n.accountDelete(lang)).foregroundStyle(Brand.danger)
            }
        }
        .buttonStyle(LinkButtonStyle())
    }

    @ViewBuilder
    private func blocked(_ lang: AppLang, account: AccountModel) -> some View {
        header(L10n.appAgeBlockedTitle(lang), lead: Text(Self.contactLine(lang)))
        if account.isSignedIn {
            Button {
                Task { await account.signOut() }
            } label: {
                if account.busy == .signOut {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.accountSignOut(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(account.busy != nil)
            deleteButton(lang, account: account)
                .disabled(account.busy != nil)
                .frame(maxWidth: .infinity)
        }
    }

    private func header(_ title: String, lead: Text) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .brandText(.display1)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            lead
                .brandText(.lead)
                .foregroundStyle(Brand.ink2)
                .tint(Brand.terraInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The support address as a mail link wherever the language put it.
    static func contactLine(_ lang: AppLang) -> AttributedString {
        var text = AttributedString(L10n.appAgeBlockedBody(lang, email: AgeCheck.supportEmail))
        if let range = text.range(of: AgeCheck.supportEmail) {
            text[range].link = URL(string: "mailto:\(AgeCheck.supportEmail)")
            text[range].foregroundColor = Brand.terraInk
            text[range].underlineStyle = Text.LineStyle(pattern: .solid)
        }
        return text
    }
}

/// The age gate in a window of its own above the app's, so no sheet or
/// full-screen cover can sit on top of it.
@MainActor
final class AgeGateWindow {
    private var window: UIWindow?
    private weak var previous: UIWindow?

    func show(_ visible: Bool, app: AppModel) {
        guard visible else {
            guard let window else { return }
            window.isHidden = true
            self.window = nil
            (previous ?? window.windowScene?.windows.first { !$0.isHidden })?.makeKey()
            previous = nil
            return
        }
        guard window == nil,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first
        else { return }
        previous = scene.windows.first(where: \.isKeyWindow)
        // A keyboard left up underneath would sit over the gate.
        scene.windows.forEach { $0.endEditing(true) }
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = UIHostingController(rootView: AgeGateHost().environment(app))
        window.makeKeyAndVisible()
        self.window = window
    }
}

/// The window's content, with the settings RootView would have passed down.
private struct AgeGateHost: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let lang = app.lang
        AgeGateView(gate: app.account.ageGate)
            .environment(\.layoutDirection, lang.isRTL ? .rightToLeft : .leftToRight)
            .preferredColorScheme(app.appearance.colorScheme)
            .tint(Brand.terraInk)
    }
}
