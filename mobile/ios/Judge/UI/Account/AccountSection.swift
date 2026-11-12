import SwiftUI

/// Settings → Account: who is signed in (a row into the account page),
/// plan and credits, restore purchases (when the store is set up) and
/// Pricing; signed out, a way into sign-in.
struct AccountSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let account = app.account
        let lang = app.lang
        Section {
            if account.isSignedIn {
                signedIn(lang, account: account)
            } else {
                signedOut(lang)
            }
            NavigationLink(value: SettingsRoute.pricing) {
                Label {
                    Text(L10n.navPricing(lang))
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                } icon: {
                    Image(systemName: "sparkle")
                        .foregroundStyle(Brand.terraInk)
                }
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
            NavigationLink(value: SettingsRoute.account) {
                Text(L10n.accountSignedInAs(lang, email: email))
                    .brandText(.body)
                    .foregroundStyle(Brand.ink)
            }
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
        if let failure = account.failure, failure == .loadFailed {
            Text(failure.message(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.danger)
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

/// Settings → Account page: the email and Delete account, with its
/// confirmation. Deleting takes the account's verdicts off the phone; ones
/// no account has stay.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmDelete = false

    var body: some View {
        let account = app.account
        let lang = app.lang
        // A subscription that still renews keeps billing after the account is gone.
        let billing = account.entitlement?.subscription?.willRenew == true
        List {
            Section {
                if let email = account.user?.email, !email.isEmpty {
                    Text(L10n.accountSignedInAs(lang, email: email))
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                }
                Button {
                    confirmDelete = true
                } label: {
                    HStack {
                        Text(L10n.accountDelete(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.danger)
                        Spacer()
                        if account.busy == .delete {
                            ProgressView().tint(Brand.muted)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(account.busy != nil)
            } footer: {
                if account.failure == .deleteFailed {
                    Text(AccountModel.Failure.deleteFailed.message(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.danger)
                }
            }
            .listRowBackground(Brand.paper)
        }
        .scrollContentBackground(.hidden)
        .background(Brand.ivory.ignoresSafeArea())
        .navigationTitle(L10n.accountTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .alert(L10n.appAccountDeleteTitle(lang), isPresented: $confirmDelete) {
            Button(L10n.appAccountDeleteConfirm(lang), role: .destructive) {
                Task { await app.account.deleteAccount() }
            }
            if billing {
                Button(L10n.appAccountManageSubscription(lang)) {
                    if let url = URL(string: "https://apps.apple.com/account/subscriptions") { openURL(url) }
                }
            }
            Button(L10n.accountDeleteCancel(lang), role: .cancel) {}
        } message: {
            if billing {
                Text(L10n.appAccountDeleteBody(lang) + "\n\n" + L10n.appAccountDeleteSubscription(lang))
            } else {
                Text(L10n.appAccountDeleteBody(lang))
            }
        }
        .onChange(of: account.isSignedIn) { _, signedIn in
            if !signedIn { dismiss() }
        }
    }
}
