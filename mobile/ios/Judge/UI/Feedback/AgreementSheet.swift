import SwiftUI

/// The private details tick, with Continue enabled only once it is ticked.
struct AgreementSheet: View {
    @Environment(AppModel.self) private var app
    @State private var ticked = false

    var body: some View {
        let lang = app.lang
        let agreement = app.agreement
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(L10n.consentSensitiveTitle(lang))
                    .brandText(.display1)
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: 16) {
                    Button {
                        ticked.toggle()
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: ticked ? "checkmark.square.fill" : "square")
                                .font(.system(size: 22))
                                .foregroundStyle(ticked ? Brand.ink : Brand.muted)
                                .accessibilityHidden(true)
                            Text(L10n.consentSensitiveBody(lang))
                                .brandText(.bodyMedium)
                                .foregroundStyle(Brand.ink)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(ticked ? [.isToggle, .isSelected] : .isToggle)
                    if agreement.failed {
                        ErrorBanner(message: L10n.errorFallback(lang))
                    }
                    Button {
                        Task { await agreement.confirm(lang: lang) }
                    } label: {
                        if agreement.busy {
                            ProgressView().tint(Brand.ivory)
                        } else {
                            Text(L10n.consentSensitiveContinue(lang))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!ticked || agreement.busy)
                }
                .padding(20)
                .paperSurface(radius: Radius.card)
                .cardShadow()
            }
            .padding(.horizontal, 20)
            .padding(.top, 28)
            .padding(.bottom, 32)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .environment(\.locale, lang.locale)
        .environment(\.layoutDirection, lang.isRTL ? .rightToLeft : .leftToRight)
    }
}
