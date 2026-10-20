import SwiftData
import SwiftUI

enum HistoryRoute: Hashable {
    case detail(id: String)
}

/// "My verdicts": everything judged on this phone, newest first.
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    @Query(sort: \SavedVerdict.createdAt, order: .reverse) private var saved: [SavedVerdict]
    @State private var confirmClear = false

    var body: some View {
        let lang = app.lang
        Group {
            if saved.isEmpty {
                VStack(spacing: 14) {
                    BrandMark(width: 56)
                    Text(L10n.appHistoryEmpty(lang))
                        .brandText(.body)
                        .foregroundStyle(Brand.ink2)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    Section {
                        ForEach(saved) { row in
                            NavigationLink(value: HistoryRoute.detail(id: row.id)) {
                                HistoryRow(row: row, lang: lang)
                            }
                            .listRowBackground(Brand.paper)
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    try? app.history.delete(id: row.id)
                                } label: {
                                    Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button(role: .destructive) {
                                    try? app.history.delete(id: row.id)
                                } label: {
                                    Label(L10n.appHistoryDelete(lang), systemImage: "trash")
                                }
                            }
                        }
                    } footer: {
                        Text(L10n.appHistoryDeviceOnly(lang))
                            .brandText(.footnote)
                            .foregroundStyle(Brand.muted)
                            .padding(.top, 8)
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .background(Brand.ivory.ignoresSafeArea())
        .navigationTitle(L10n.appHistoryTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            if !saved.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.appHistoryClearAll(lang), role: .destructive) { confirmClear = true }
                        .tint(Brand.danger)
                }
            }
        }
        .confirmationDialog(L10n.appHistoryClearConfirm(lang), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(L10n.appHistoryClearYes(lang), role: .destructive) { try? app.history.deleteAll() }
            Button(L10n.appCancel(lang), role: .cancel) {}
        }
    }
}

private struct HistoryRow: View {
    let row: SavedVerdict
    let lang: AppLang

    var body: some View {
        let nameMap = row.nameMap
        let selfLang = row.contentLang
        let parties = Names.partyNames(nameMap, lang: lang, selfLang: selfLang)
        // Display-only: the stored headline stays anonymized. It is the
        // original's, so it is written in the language it was judged in.
        let headline = Names.restoreNames(row.headline, parties: Names.resolveParties(nameMap, selfLang: selfLang), textLang: selfLang)
        let verdict = row.finalVerdict
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(sealColor(VerdictDisplay.seal(verdict)))
                .frame(width: 12, height: 12)
                .padding(.top, 4)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(VerdictDisplay.label(verdict, parties: parties, lang: lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Text(headline)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
                    .lineLimit(2)
                Text(row.createdAt.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(lang.locale)))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func sealColor(_ seal: VerdictDisplay.Seal) -> Color {
        switch seal {
        case .a: return Brand.terraInk
        case .b: return Brand.sageInk
        case .none: return Brand.ink
        }
    }
}

/// A saved verdict, viewable offline (translations come from the cache
/// first, otherwise they are fetched when online).
struct HistoryDetailView: View {
    @Environment(AppModel.self) private var app
    let id: String

    var body: some View {
        if let row = try? app.history.find(id: id), let session = row.session() {
            VerdictScreen(session: session)
        } else {
            MissingVerdictView()
        }
    }
}
