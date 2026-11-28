import SwiftUI
import UIKit

/// Over the whole app for the age check: the date of birth step, the
/// refusals (closed for good, closed for the region), or the parent step.
struct AgeGateView: View {
    @Environment(AppModel.self) private var app
    @State private var confirmDelete = false
    @AccessibilityFocusState private var confirmFocused: Bool
    let gate: AgeGate

    var body: some View {
        let lang = app.lang
        let account = app.account
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                switch gate {
                case .date:
                    if account.dobConfirming {
                        confirm(lang, account: account)
                    } else {
                        date(lang, account: account)
                    }
                case .blocked:
                    blocked(lang, account: account)
                case .restricted:
                    restricted(lang, account: account)
                case .parent:
                    parentStep(lang, account: account)
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
        .deleteAccountAlert(isPresented: $confirmDelete, app: app)
        .task(id: gate) {
            if gate == .parent { await watchParent(account) }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            if gate == .parent || gate == .restricted { Task { await account.refresh() } }
        }
    }

    @ViewBuilder
    private func date(_ lang: AppLang, account: AccountModel) -> some View {
        let busy = account.agePosting || account.busy != nil
        header(L10n.ageTitle(lang), lead: Text(L10n.ageLead(lang)))
        VStack(alignment: .leading, spacing: 16) {
            DatePicker(
                L10n.ageTitle(lang),
                selection: Binding(get: { account.dobDate }, set: { account.pickDob($0) }),
                in: AgeCheck.dobRange(),
                displayedComponents: .date
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            .accessibilityLabel(L10n.ageTitle(lang))
            .accessibilityHint(L10n.ageLead(lang))
            .disabled(busy)
            if account.asksCountry {
                countryQuestion(lang, account: account)
            }
            if account.asksQuebec {
                quebecQuestion(lang, account: account)
            }
            if account.ageError != nil {
                ErrorBanner(message: L10n.ageFailed(lang))
            }
            Button {
                Task { await account.submitDob() }
            } label: {
                Text(L10n.ageContinue(lang))
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !account.canSubmitDob)
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
        .task { await account.loadAgeHint() }
        signOutAndDelete(lang, account: account)
    }

    /// Where a 13 to 15 year old lives: it decides whether a parent has to say yes.
    private func countryQuestion(_ lang: AppLang, account: AccountModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.ageWhereWhy(lang))
                .brandText(.lead)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Text(L10n.ageWhere(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Spacer()
                Picker(L10n.ageWhere(lang), selection: Binding(get: { account.dobCountry }, set: { account.pickCountry($0) })) {
                    Text("-").tag(String?.none)
                    ForEach(Countries.options(lang: lang)) { country in
                        Text(country.name).tag(String?.some(country.code))
                    }
                }
                .pickerStyle(.menu)
                .tint(Brand.terraInk)
            }
        }
    }

    /// Asked of a 13 year old in Canada.
    private func quebecQuestion(_ lang: AppLang, account: AccountModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.ageQuebec(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            Picker(L10n.ageQuebec(lang), selection: Binding(get: { account.dobQuebec }, set: { account.pickQuebec($0) })) {
                Text(L10n.ageYes(lang)).tag(Bool?.some(true))
                Text(L10n.ageNo(lang)).tag(Bool?.some(false))
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder
    private func confirm(_ lang: AppLang, account: AccountModel) -> some View {
        let busy = account.agePosting || account.busy != nil
        Text(L10n.ageTitle(lang))
            .brandText(.display1)
            .foregroundStyle(Brand.ink)
            .accessibilityAddTraits(.isHeader)
        VStack(alignment: .leading, spacing: 16) {
            Text(L10n.ageConfirmDate(lang, date: AgeCheck.longDate(account.dob, lang: lang)))
                .brandText(.lead)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityFocused($confirmFocused)
            if account.ageError != nil {
                ErrorBanner(message: L10n.ageFailed(lang))
            }
            Button {
                Task { await account.submitDob() }
            } label: {
                if account.agePosting {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.ageConfirmYes(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)
            Button(L10n.ageChange(lang)) {
                account.changeDob()
            }
            .buttonStyle(LinkButtonStyle())
            .frame(maxWidth: .infinity)
            .disabled(busy)
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
        .onAppear { confirmFocused = true }
        signOutAndDelete(lang, account: account)
    }

    func signOutAndDelete(_ lang: AppLang, account: AccountModel) -> some View {
        VStack(spacing: 4) {
            Button(L10n.accountSignOut(lang)) {
                Task { await account.signOut() }
            }
            .buttonStyle(LinkButtonStyle())
            deleteButton(lang, account: account)
        }
        .disabled(account.agePosting || account.busy != nil)
        .frame(maxWidth: .infinity)
    }

    /// The account deletion from Settings, which a blocked or unconfirmed
    /// account can still reach.
    @ViewBuilder
    func deleteButton(_ lang: AppLang, account: AccountModel) -> some View {
        if let failure = account.failure, AccountModel.deleteFailures.contains(failure) {
            ErrorBanner(message: failure.message(lang))
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
        refusal(lang, account: account, title: L10n.ageBlockedTitle(lang), lead: Self.contactLine(lang))
    }

    @ViewBuilder
    private func restricted(_ lang: AppLang, account: AccountModel) -> some View {
        refusal(lang, account: account, title: L10n.ageRegionTitle(lang), lead: Self.regionLine(lang))
    }

    @ViewBuilder
    private func refusal(_ lang: AppLang, account: AccountModel, title: String, lead: AttributedString) -> some View {
        header(title, lead: Text(lead))
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

    func header(_ title: String, lead: Text) -> some View {
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
        mailLink(L10n.ageBlocked(lang) + " " + L10n.ageBlockedContact(lang, email: AgeCheck.supportEmail))
    }

    /// The refusal for a region, with the same mail link.
    static func regionLine(_ lang: AppLang) -> AttributedString {
        mailLink(L10n.ageRegion(lang) + " " + L10n.ageRegionContact(lang, email: AgeCheck.supportEmail))
    }

    private static func mailLink(_ line: String) -> AttributedString {
        var text = AttributedString(line)
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
