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
  "app.pricing.headline": { en: "Your first verdict is on us.", tr: "İlk karar bizden." },
  "app.pricing.sub": {
    en: "Create an account and your first verdict is free, with every feature. After that, pick a pack or go monthly.",
    tr: "Hesap açtığında ilk kararın bütün özellikleriyle ücretsiz. Sonrasında bir paket seç ya da aylık plana geç.",
  },
  // Every verdict, a case included, uses one credit or one of the monthly plan's.
  "app.balance.left.one": { en: "{n} verdict left", tr: "{n} karar hakkın kaldı" },
  "app.balance.left.other": { en: "{n} verdicts left", tr: "{n} karar hakkın kaldı" },
  "app.balance.monthly": {
    en: "{left} of {cap} left this month",
    tr: "Bu ay {cap} hakkından {left} tanesi kaldı",
  },
  "app.balance.none": { en: "No verdicts left", tr: "Karar hakkın kalmadı" },
  "app.balance.caseCost": { en: "Sending a link uses 1 verdict", tr: "Bağlantı göndermek 1 karar hakkı kullanır" },
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
  "app.home.example": { en: "Try an example", tr: "Bir örnek dene" },
  // Cases the example button fills in, a on "your side" and b on "theirs".
  "app.example.dishwasher.aName": { en: "Alex", tr: "Elif" },
  "app.example.dishwasher.a": {
    en: "You put the bowls on the top rack again. They never come out clean up there, that's what the bottom is for.",
    tr: "Kâseleri yine üst rafa koymuşsun. Orada hiç temiz çıkmıyorlar, alt raf bunun için var.",
  },
  "app.example.dishwasher.bName": { en: "Sam", tr: "Can" },
  "app.example.dishwasher.b": {
    en: "They fit fine up there and it leaves the bottom free for the pans. I've loaded it like this for years and nothing's come out dirty.",
    tr: "Üstte gayet sığıyorlar, alt raf da tencerelere kalıyor. Yıllardır böyle diziyorum, bir kere bile kirli çıkmadı.",
  },
  "app.example.bill.aName": { en: "Priya", tr: "Zeynep" },
  "app.example.bill.a": {
    en: "I didn't drink anything, so I shouldn't pay a quarter of the wine. Splitting the food evenly is fine with me.",
    tr: "Hiç içmedim, şarabın dörtte birini ben ödememeliyim. Yemeği eşit bölelim, ona itirazım yok.",
  },
  "app.example.bill.bName": { en: "Jordan", tr: "Mert" },
  "app.example.bill.b": {
    en: "We always just split it four ways. Working out who had what every time is a pain, and it's not much of a difference anyway.",
    tr: "Hep dörde bölüyoruz zaten. Her seferinde kim ne yedi diye hesap yapmak çok uğraştırıyor, fark da o kadar değil.",
  },
  "app.example.thermostat.aName": { en: "Taylor", tr: "Selin" },
  "app.example.thermostat.a": {
    en: "It's 19 degrees in here and I'm cold even in a hoodie. Turning it up to 22 isn't crazy.",
    tr: "İçerisi 19 derece, kapüşonluyla bile üşüyorum. Kombiyi 22'ye almak abartı değil.",
  },
  "app.example.thermostat.bName": { en: "Chris", tr: "Emre" },
  "app.example.thermostat.b": {
    en: "22 is way too warm to sleep in. You can put on another layer, I can't take anything else off.",
    tr: "22 derecede uyunmaz, çok sıcak. Sen bir kat daha giyebilirsin ama ben daha fazla bir şey çıkaramam.",
  },
  "app.example.roadTrip.aName": { en: "Morgan", tr: "Deniz" },
  "app.example.roadTrip.a": {
    en: "I drove the whole six hours there. It's only fair that you drive us back.",
    tr: "Gidişte altı saat boyunca hep ben sürdüm. Dönüşte senin sürmen adil olur.",
  },
  "app.example.roadTrip.bName": { en: "Riley", tr: "Burak" },
  "app.example.roadTrip.b": {
    en: "I said before we left that I hate driving at night, and we're leaving at 7. I'll take the morning drives next trip.",
    tr: "Yola çıkmadan gece araba kullanmaktan nefret ettiğimi söyledim, akşam yedide çıkıyoruz. Bir dahaki yolculukta sabahları ben sürerim.",
  },
  "app.example.seat.aName": { en: "Jamie", tr: "Ece" },
  "app.example.seat.a": {
    en: "My seat reclines, so I'm reclining it. It's a night flight and everyone's trying to sleep.",
    tr: "Koltuğum yatıyor, ben de yatırıyorum. Gece uçuşu, herkes uyumaya çalışıyor.",
  },
  "app.example.seat.bName": { en: "Casey", tr: "Kaan" },
  "app.example.seat.b": {
    en: "I'm 6'3\" and my knees are already pressed into your seat. You could at least ask before dropping it all the way back.",
    tr: "Boyum 1,90, dizlerim zaten koltuğuna değiyor. Sonuna kadar yatırmadan önce en azından sorabilirdin.",
  },
  "app.example.spoiler.aName": { en: "Maya", tr: "Defne" },
  "app.example.spoiler.a": {
    en: "You told me who the killer was before I'd even started the last episode. I'd been waiting all week for it.",
    tr: "Son bölümü açmadan katilin kim olduğunu söyledin. Bütün hafta onu bekliyordum.",
  },
  "app.example.spoiler.bName": { en: "Leo", tr: "Ozan" },
  "app.example.spoiler.b": {
    en: "It came out three weeks ago and you said you'd finished it. I can't keep track of where everyone is.",
    tr: "Üç hafta önce çıktı, sen de bitirdim demiştin. Herkesin hangi bölümde olduğunu takip edemem.",
  },
  "app.example.jacket.aName": { en: "Noah", tr: "Ayşe" },
  "app.example.jacket.a": {
    en: "You wore my denim jacket to the concert without asking. It came back smelling like smoke.",
    tr: "Kot ceketimi bana sormadan konsere giymişsin. Sigara kokarak geri geldi.",
  },
  "app.example.jacket.bName": { en: "Ava", tr: "Berk" },
  "app.example.jacket.b": {
    en: "It was hanging by the door and you never wear it. I would've asked, but you were asleep and I was already late.",
    tr: "Kapının yanında asılıydı, sen de hiç giymiyorsun. Sorardım ama uyuyordun, ben de zaten geç kalmıştım.",
  },
  "app.example.lastSlice.aName": { en: "Ben", tr: "Cem" },
  "app.example.lastSlice.a": {
    en: "I called dibs on the last slice before the movie started. Everyone heard me.",
    tr: "Film başlamadan \"son dilim benim\" dedim. Herkes duydu.",
  },
  "app.example.lastSlice.bName": { en: "Lily", tr: "Naz" },
  "app.example.lastSlice.b": {
    en: "You can't call dibs and then not touch it for two hours. It was just sitting there going cold, so I ate it.",
    tr: "\"Benim\" deyip iki saat dokunmamak olmaz. Orada soğuyup duruyordu, ben de yedim.",
  },
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
  "app.verdict.vs": { en: "vs", tr: "–" },
  "app.verdict.leanTo": { en: "The panel leaned to {name}", tr: "Kurul {name} tarafına yattı" },
  "app.verdict.leanNone": { en: "The panel didn't lean either way", tr: "Kurul iki taraftan birine yatmadı" },
  "app.verdict.sides": { en: "What each side stands on", tr: "Her taraf neye dayanıyor" },
  "app.verdict.claims": { en: "How each side got there", tr: "Her taraf görüşüne nasıl vardı" },
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
  "app.appeal.submit": { en: "Rule again", tr: "Yeniden yargılat" },
  // The web's appeal.* lines in the sheet's wording.
  "app.appeal.upsell": {
    en: "Something missing? Add context and have it re-judged. That's a Premium feature.",
    tr: "Eksik bir şey mi var? Bağlam ekle, yeniden yargılansın. Bu bir Premium özelliği.",
  },
  "app.appeal.signIn": { en: "Sign in to add context & appeal", tr: "Bağlam ekleyip itiraz etmek için giriş yap" },
  "app.appeal.used": { en: "You've already added context to this case.", tr: "Bu davaya zaten bağlam ekledin." },
  "app.appeal.limit": {
    en: "You've added context twice. That's the limit for one verdict.",
    tr: "İki kez bağlam ekledin. Bir karar için sınır bu.",
  },
};
