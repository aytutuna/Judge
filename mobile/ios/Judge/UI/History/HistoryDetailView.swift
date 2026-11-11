import SwiftData
import SwiftUI

/// A verdict kept on the phone, viewable offline (translations come from
/// the cache first, otherwise they are fetched when online).
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
