import SwiftUI

/// Settings → Account: who is signed in, plan and credits, restore
/// purchases (when the store is set up), sign out and delete; signed out, a
/// way into sign-in. On-device history is never
/// touched by either action. The confirmations are alerts owned by the
/// list (alerts on list sections are unreliable).
struct AccountSection: View {
    @Environment(AppModel.self) private var app
    @Binding var confirmSignOut: Bool
    @Binding var confirmDelete: Bool

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
            actionRow(PurchaseStrings.restore(lang), busy: purchases.isRestoring, color: Brand.ink) {
                Task { await purchases.restore() }
            }
            .disabled(purchases.isRestoring || account.busy != nil)
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
