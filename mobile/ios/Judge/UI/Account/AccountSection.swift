import SwiftUI

/// Settings → Account: who is signed in, plan and credits, restore
/// purchases (when the store is set up), sign out and delete; signed out, a
/// way into sign-in. Either action takes the account's verdicts off the
/// phone; ones no account has stay. The confirmations are alerts owned by
/// the list (alerts on list sections are unreliable).
struct AccountSection: View {
    @Environment(AppModel.self) private var app
    @Binding var confirmSignOut: Bool
    @Binding var confirmDelete: Bool
    @Binding var changePassword: Bool

    var body: some View {
        let account = app.account
        let lang = app.lang
        Section {
            if account.isSignedIn {
                signedIn(lang, account: account)
            } else {
                signedOut(lang)
            }
        } header: {
            Kicker(text: L10n.accountTitle(lang))
        } footer: {
            footer(lang, account: account)
        }
        .listRowBackground(Brand.paper)
    }

    @ViewBuilder
    private func signedIn(_ lang: AppLang, account: AccountModel) -> some View {
        if let email = account.user?.email, !email.isEmpty {
            Text(L10n.accountSignedInAs(lang, email: email))
                .brandText(.body)
                .foregroundStyle(Brand.ink)
        } else if account.failure != .loadFailed {
            HStack(spacing: 10) {
                ProgressView().tint(Brand.muted)
                Text(L10n.accountLoading(lang))
                    .brandText(.body)
                    .foregroundStyle(Brand.muted)
            }
        }
        if let entitlement = account.entitlement {
            fact(L10n.accountCredits(lang), value: String(entitlement.credits))
            if let subscription = entitlement.subscription {
                fact(L10n.accountSubscription(lang), value: subscriptionText(subscription, lang: lang))
            }
        }
        if app.purchases.canRestore(account.pricing) {
            let purchases = app.purchases
            actionRow(L10n.appPurchaseRestore(lang), busy: purchases.isRestoring, color: Brand.ink) {
                Task { await purchases.restore() }
            }
            .disabled(purchases.isRestoring || account.busy != nil)
        }
        if account.canManagePassword {
            actionRow(account.hasPassword ? L10n.accountPasswordChange(lang) : L10n.accountPasswordSet(lang), busy: false, color: Brand.ink) {
                account.beginPasswordChange()
                changePassword = true
            }
            .disabled(account.busy != nil)
        }
        actionRow(L10n.accountSignOut(lang), busy: account.busy == .signOut, color: Brand.ink) {
            confirmSignOut = true
        }
        .disabled(account.busy != nil)
        actionRow(L10n.accountDelete(lang), busy: account.busy == .delete, color: Brand.danger) {
            confirmDelete = true
        }
        .disabled(account.busy != nil)
    }

    private func signedOut(_ lang: AppLang) -> some View {
        Group {
            Text(L10n.accountSignInPrompt(lang))
                .brandText(.body)
                .foregroundStyle(Brand.ink2)
            actionRow(L10n.signinTitle(lang), busy: false, color: Brand.terraInk) {
                app.account.presentSignIn()
            }
        }
    }

    @ViewBuilder
    private func footer(_ lang: AppLang, account: AccountModel) -> some View {
        if let failure = account.failure, failure == .deleteFailed || failure == .loadFailed {
            Text(failure.message(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.danger)
        } else if account.isSignedIn, account.passwordSaved {
            Text(L10n.accountPasswordSaved(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.muted)
        } else if account.isSignedIn, let restored = app.purchases.restoreResult {
            Text(restored.text(lang))
                .brandText(.footnote)
                .foregroundStyle(restored == .failed ? Brand.danger : Brand.muted)
        } else if let notice = account.notice, notice != .sessionExpired || !account.isSignInPresented {
            Text(notice.message(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.muted)
        }
    }

    private func fact(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .brandText(.body)
                .foregroundStyle(Brand.ink2)
            Spacer(minLength: 12)
            Text(value)
                .brandText(.bodyMedium)
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func actionRow(_ title: String, busy: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .brandText(.body)
                    .foregroundStyle(color)
                Spacer()
                if busy {
                    ProgressView().tint(Brand.muted)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func subscriptionText(_ subscription: SubscriptionInfo, lang: AppLang) -> String {
        let date = ErrorText.formatDate(subscription.periodEnd, lang: lang) ?? subscription.periodEnd
        let period = subscription.willRenew
            ? L10n.accountSubscriptionRenews(lang, date: date)
            : L10n.accountSubscriptionUntil(lang, date: date)
        let usage = L10n.accountFairUse(lang, used: String(subscription.used), cap: String(subscription.cap))
        return period + "\n" + usage
    }
}

/// Settings → Password: set one, or replace the current one (which the
/// server asks for unless the session is a fresh code sign-in).
struct PasswordSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var showPassword = false
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case current, next
    }

    var body: some View {
        let account = app.account
        let lang = app.lang
        let replacing = account.hasPassword
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(replacing ? L10n.accountPasswordChange(lang) : L10n.accountPasswordSet(lang))
                    .brandText(.display1)
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                if replacing {
                    field(L10n.accountPasswordCurrent(lang), text: $current, type: .password, focus: .current)
                }
                field(L10n.signinPasswordNew(lang), text: $next, type: .newPassword, focus: .next)
                Button(L10n.signinPasswordShow(lang)) { showPassword.toggle() }
                    .buttonStyle(LinkButtonStyle())
                    .accessibilityAddTraits(showPassword ? .isSelected : [])
                if let failure = account.failure, failure != .loadFailed {
                    ErrorBanner(message: failure.message(lang))
                }
                Button {
                    save(replacing: replacing)
                } label: {
                    if account.busy == .password {
                        ProgressView().tint(Brand.ivory)
                    } else {
                        Text(L10n.signinPasswordSave(lang))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(account.busy != nil || next.isEmpty || (replacing && current.isEmpty))
                Button(L10n.appCancel(lang)) { dismiss() }
                    .buttonStyle(LinkButtonStyle())
                    .disabled(account.busy != nil)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.ivory.ignoresSafeArea())
        .interactiveDismissDisabled(account.busy != nil)
        .environment(\.locale, lang.locale)
        .onChange(of: account.isSignedIn) { _, signedIn in
            if !signedIn { dismiss() }
        }
    }

    private func field(_ label: String, text: Binding<String>, type: UITextContentType, focus which: Field) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label)
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            Group {
                if showPassword {
                    TextField("", text: text)
                } else {
                    SecureField("", text: text)
                }
            }
            .focused($focus, equals: which)
            .textContentType(type)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(which == .current ? .next : .go)
            .onSubmit {
                if which == .current { focus = .next } else { save(replacing: app.account.hasPassword) }
            }
            .brandText(.body)
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .paperSurface(radius: Radius.field, fill: Brand.paper, border: focus == which ? Brand.terraInk : Brand.line2)
            .accessibilityLabel(label)
        }
    }

    private func save(replacing: Bool) {
        guard !next.isEmpty, !replacing || !current.isEmpty else { return }
        Task {
            if await app.account.changePassword(next, current: replacing ? current : nil) { dismiss() }
        }
    }
}
