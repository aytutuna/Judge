/**
 * Strings only the native apps need (tabs, history, offline states). Same
 * rules as lib/i18n.ts: one whole string per language, informal Turkish
 * ("sen"), `{slot}` placeholders only where the sentence was written around
 * them. Keys use an "app." prefix so they can never collide with web keys.
 * A key ending in ".one"/".other" becomes a plural with `{n}` as the count.
 */
export const APP_STRINGS: Record<string, { en: string; tr: string }> = {
  "app.name": { en: "Judge", tr: "Judge" },
  "app.tab.new": { en: "New", tr: "Yeni" },
  "app.tab.history": { en: "My verdicts", tr: "Kararlarım" },
  "app.tab.settings": { en: "Settings", tr: "Ayarlar" },
  "app.input.counter": { en: "{count} / {max}", tr: "{count} / {max}" },
  "app.history.title": { en: "My verdicts", tr: "Kararlarım" },
  "app.history.empty": {
    en: "No verdicts yet. Settle your first argument and it shows up here.",
    tr: "Henüz kararın yok. İlk tartışmanı çözdüğünde burada görünür.",
  },
  "app.history.deviceOnly": {
    en: "Saved on this phone only. Deleting one here doesn't take down its share link.",
    tr: "Sadece bu telefonda saklanır. Buradan silmek paylaşım linkini kaldırmaz.",
  },
  "app.history.delete": { en: "Delete", tr: "Sil" },
  "app.history.clearAll": { en: "Delete all", tr: "Hepsini sil" },
  "app.history.clearConfirm": {
    en: "Delete every saved verdict from this phone? Share links keep working.",
    tr: "Bu telefondaki bütün kayıtlı kararlar silinsin mi? Paylaşım linkleri çalışmaya devam eder.",
  },
  "app.history.clearYes": { en: "Yes, delete them", tr: "Evet, sil" },
  "app.cancel": { en: "Cancel", tr: "Vazgeç" },
  "app.retry": { en: "Try again", tr: "Tekrar dene" },
  "app.error.offline": {
    en: "You seem to be offline. Check your connection and try again.",
    tr: "İnternete bağlı değilsin gibi. Bağlantını kontrol edip tekrar dene.",
  },
  "app.error.timeout": {
    en: "The judges took too long to answer. Try again in a minute.",
    tr: "Yargıçlar cevap vermekte çok gecikti. Bir dakika sonra tekrar dene.",
  },
  "app.error.interrupted": {
    en: "The connection dropped while Judge was in the background. Keep the app open until the verdict arrives, then try again.",
    tr: "Judge arka plandayken bağlantı koptu. Karar gelene kadar uygulamayı açık tut, sonra tekrar dene.",
  },
  // App versions of web copy that talks about pages, tabs and reloading
  // (turnstile.error, factcheck.sourceAria, error.bad_origin; see EXCLUDE_KEYS).
  "app.turnstile.error": {
    en: "The human check couldn't load. Check your connection and try again.",
    tr: "İnsan doğrulaması yüklenemedi. Bağlantını kontrol edip tekrar dene.",
  },
  "app.factcheck.sourceAria": { en: "{title}, opens the web page", tr: "{title}, web sayfasını açar" },
  "app.error.badOrigin": {
    en: "That request came from somewhere we don't recognize. Make sure the app is up to date and try again.",
    tr: "Bu istek tanımadığımız bir yerden geldi. Uygulamanın güncel olduğundan emin olup tekrar dene.",
  },
  "app.translate.offline": {
    en: "Can't translate while you're offline, so here's the original.",
    tr: "Çevrimdışıyken çeviremiyoruz, o yüzden aslını gösteriyoruz.",
  },
  "app.share.title": { en: "Share the verdict", tr: "Kararı paylaş" },
  "app.settings.language": { en: "Language", tr: "Dil" },
  "app.settings.languageDevice": { en: "Same as the phone", tr: "Telefonla aynı" },
  "app.settings.about": { en: "About Judge", tr: "Judge hakkında" },
  "app.settings.version": { en: "Version {version}", tr: "Sürüm {version}" },
  "app.lang.en": { en: "English", tr: "English" },
  "app.lang.tr": { en: "Türkçe", tr: "Türkçe" },
};
