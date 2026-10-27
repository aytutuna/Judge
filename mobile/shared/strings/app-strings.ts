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
  "app.pricing.free.account": {
    en: "Sign in with Apple, Google or email",
    tr: "Apple, Google ya da e-postayla giriş yap",
  },
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
  // Sign-in. Email in the apps is a 6-digit code, not a link.
  "app.signin.required": { en: "Sign in to get a verdict.", tr: "Karar almak için giriş yap." },
  "app.signin.or": { en: "or", tr: "ya da" },
  "app.signin.codeRequest": { en: "Email me a code", tr: "Bana kod gönder" },
  "app.signin.codeSent": {
    en: "We emailed a code to {email}. It works for 10 minutes.",
    tr: "{email} adresine bir kod gönderdik. 10 dakika geçerli.",
  },
  "app.signin.codeLabel": { en: "Enter the 6-digit code", tr: "6 haneli kodu gir" },
  "app.signin.codeSubmit": { en: "Sign in", tr: "Giriş yap" },
  "app.signin.codeInvalid": {
    en: "That code isn't right. Check the email and try again.",
    tr: "Bu kod doğru değil. E-postana bakıp tekrar dene.",
  },
  "app.signin.codeExpired": {
    en: "That code has expired. Ask for a new one.",
    tr: "Bu kodun süresi doldu. Yeni bir kod iste.",
  },
  "app.signin.codeTooMany": {
    en: "Too many wrong tries for this code. Ask for a new one.",
    tr: "Bu kod için çok fazla yanlış deneme oldu. Yeni bir kod iste.",
  },
  "app.signin.codeResend": { en: "Send a new code", tr: "Yeni kod gönder" },
  "app.signin.changeEmail": { en: "Use a different email", tr: "Başka bir e-posta kullan" },
  "app.signin.rateLimited": {
    en: "Too many tries. Wait a minute and try again.",
    tr: "Çok fazla deneme oldu. Bir dakika bekleyip tekrar dene.",
  },
  // App version of signin.unavailable, which talks about "this site".
  "app.signin.unavailable": {
    en: "Sign-in isn't available right now. Try again later.",
    tr: "Giriş şu an kullanılamıyor. Daha sonra tekrar dene.",
  },
  // Account. account.deleteConfirm is one web paragraph; native dialogs need
  // a title, a body and a button.
  "app.account.deleteTitle": { en: "Delete your account?", tr: "Hesabın silinsin mi?" },
  "app.account.deleteBody": {
    en: "Your sign-in details, credits, plan and personal data are deleted, and your share links stop working. Verdict text stays stored without your name, as explained in the Privacy Policy.",
    tr: "Giriş bilgilerin, kredilerin, planın ve kişisel verilerin silinir; paylaşım bağlantıların da çalışmaz olur. Karar metinleri, Gizlilik Politikası'nda anlatıldığı gibi adın olmadan saklanır.",
  },
  "app.account.deleteConfirm": { en: "Delete account", tr: "Hesabı sil" },
  // App version of account.deleted, which promises a trip to the home page.
  "app.account.deleted": { en: "Your account was deleted.", tr: "Hesabın silindi." },
  "app.account.signOutConfirm": {
    en: "Sign out of Judge on this phone?",
    tr: "Bu telefonda Judge'dan çıkış yapılsın mı?",
  },
  "app.account.signedOut": { en: "You're signed out.", tr: "Çıkış yaptın." },
  "app.account.sessionExpired": {
    en: "You've been signed out. Sign in again to continue.",
    tr: "Oturumun kapandı. Devam etmek için tekrar giriş yap.",
  },
  "app.close": { en: "Close", tr: "Kapat" },
  // Home with both sides on one screen. The joined text is what the judges
  // read when one person writes both sides.
  "app.home.title": { en: "Two sides, one ruling.", tr: "İki taraf, tek karar." },
  "app.home.lead": {
    en: "Write both sides, or send the other person a link to write theirs.",
    tr: "İki tarafı da yaz ya da karşı tarafa bir bağlantı gönder, kendi tarafını o yazsın.",
  },
  "app.home.leadSolo": {
    en: "Write your side, and theirs if you know it.",
    tr: "Kendi tarafını yaz, biliyorsan onunkini de.",
  },
  "app.home.yourSide": { en: "Your side", tr: "Senin tarafın" },
  "app.home.theirSide": { en: "Their side", tr: "Karşı taraf" },
  "app.home.yourName": { en: "Your name", tr: "Adın" },
  "app.home.theirName": { en: "Their name", tr: "Onun adı" },
  "app.home.yourPlaceholder": { en: "What happened, from where you stand?", tr: "Senin açından ne oldu?" },
  "app.home.theirPlaceholder": {
    en: "What do they say? Write it the way they would.",
    tr: "O ne diyor? Onun anlatacağı gibi yaz.",
  },
  "app.home.yourSideLabel": { en: "Your side of the argument", tr: "Tartışmada senin tarafın" },
  "app.home.theirSideLabel": { en: "Their side of the argument", tr: "Tartışmada karşı tarafın görüşü" },
  "app.home.sendLink": { en: "Or send them a link to write it", tr: "Ya da bağlantı gönder, kendisi yazsın" },
  "app.home.says": { en: "{name} says:", tr: "{name} diyor ki:" },
  "app.home.mySide": { en: "My side:", tr: "Benim tarafım:" },
  "app.home.otherSide": { en: "Their side:", tr: "Onun tarafı:" },
  // The case page while the other side has not written yet.
  "app.case.waitingKicker": { en: "Case · waiting", tr: "Dava · bekleniyor" },
  "app.case.waitingFor": { en: "Waiting for {name}", tr: "{name} bekleniyor" },
  "app.case.waitingLead": {
    en: "{name} writes their side without an account. Neither of you sees the other's words until the ruling.",
    tr: "{name} tarafını hesap açmadan yazar. Karar çıkana kadar ikiniz de birbirinizin yazdığını görmezsiniz.",
  },
  "app.case.waitingLeadAnon": {
    en: "They write their side without an account. Neither of you sees the other's words until the ruling.",
    tr: "Karşı taraf, tarafını hesap açmadan yazar. Karar çıkana kadar ikiniz de birbirinizin yazdığını görmezsiniz.",
  },
  "app.case.sendTo": { en: "Send {name} this link", tr: "Bu bağlantıyı {name} ile paylaş" },
  "app.case.stepYou": { en: "You wrote your side", tr: "Sen tarafını yazdın" },
  "app.case.stepYouNote": { en: "Sealed until the ruling", tr: "Karara kadar mühürlü" },
  "app.case.stepThem": { en: "{name} writes theirs", tr: "{name} kendi tarafını yazıyor" },
  "app.case.stepThemAnon": { en: "They write theirs", tr: "Karşı taraf kendi tarafını yazıyor" },
  "app.case.stepThemNote": { en: "This page updates when it's in", tr: "Gelince bu sayfa kendiliğinden güncellenir" },
  "app.case.stepJudges": { en: "Three judges rule", tr: "Üç yargıç karar verir" },
  "app.case.stepJudgesNote": { en: "Or judge now on your side alone", tr: "Ya da şimdi sadece senin tarafınla karar verilsin" },
  "app.case.judgeNowWithout": { en: "Judge now without {name}", tr: "{name} olmadan şimdi karar ver" },
  // The ruling card and its details screen.
  "app.verdict.vs": { en: "vs", tr: "ile" },
  "app.verdict.leanTo": { en: "The panel leaned to {name}", tr: "Kurul {name} tarafına yattı" },
  "app.verdict.leanNone": { en: "The panel didn't lean either way", tr: "Kurul iki taraftan birine yatmadı" },
  "app.verdict.sides": { en: "What each side stands on", tr: "Her taraf neye dayanıyor" },
  "app.verdict.claims": { en: "How each side got there", tr: "Taraflar oraya nasıl vardı" },
  "app.verdict.back": { en: "Ruling", tr: "Karar" },
  // Adding context to a ruling (one-sided verdicts and cases).
  "app.appeal.title": { en: "Add context & appeal", tr: "Bağlam ekle ve itiraz et" },
  "app.appeal.intro": {
    en: "Something the judges missed? Add it and they rule again. The first ruling stays on record.",
    tr: "Yargıçların kaçırdığı bir şey mi var? Ekle, yeniden karar versinler. İlk karar kayıtta kalır.",
  },
  "app.appeal.ask": { en: "What should they know?", tr: "Neyi bilmeleri gerekiyor?" },
  "app.appeal.placeholder": {
    en: "A fact, a message, or what was actually agreed.",
    tr: "Bir olgu, bir mesaj ya da aslında neyde anlaştığınız.",
  },
  "app.appeal.cost": {
    en: "Uses 1 premium verdict. You can do this twice per ruling; {left} left.",
    tr: "1 premium karar hakkı kullanır. Bunu bir karar için iki kez yapabilirsin; {left} hakkın kaldı.",
  },
  "app.appeal.costCase": {
    en: "Uses 1 premium verdict. You can do this once per case.",
    tr: "1 premium karar hakkı kullanır. Bunu bir dava için bir kez yapabilirsin.",
  },
  "app.appeal.submit": { en: "Rule again", tr: "Yeniden karar ver" },
};
