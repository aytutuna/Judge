import type { ClaimKind } from "./types";

/**
 * UI dictionary: every user-facing string, one WHOLE string per language.
 * Never build a sentence or label by concatenating translated fragments —
 * templates only interpolate names/numbers into slots the string was
 * designed around (predicate-final in Turkish, so no suffix ever attaches
 * to an inserted name).
 *
 * Pure module (no "use client") — safe to import from server code.
 */

export type Lang = "en" | "tr";

const en = {
  "hero.title": "Who's right? Settle it.",
  "hero.lead":
    "Describe the argument. Three independent AI judges dig to what it's really about and rule, with an honest confidence score.",
  "input.label": "The argument",
  placeholder:
    "Describe the argument. Who says what, and why?\n\nInclude the other person's side as they would state it — the judge steelmans both sides either way.",
  getVerdict: "Get the verdict",
  privacyNote:
    "Names are replaced with Party A / Party B before judging — the judge never knows who is who, and only the anonymous version is stored.",
  judgeBy: "Judge by",
  fineTune: "Fine-tune ▸",
  hideFineTune: "Hide fine-tuning",
  sliderNote: "Middle = neutral. These only matter when the argument comes down to values.",
  "preset.balanced.label": "Balanced",
  "preset.balanced.blurb": "Common-sense mix",
  "preset.outcomes.label": "Outcomes",
  "preset.outcomes.blurb": "Results matter most",
  "preset.principles.label": "Principles",
  "preset.principles.blurb": "Rules & rights first",
  "preset.fairness.label": "Fairness",
  "preset.fairness.blurb": "Equal treatment",
  "preset.loyalty.label": "Loyalty",
  "preset.loyalty.blurb": "People before rules",
  "slider.freedom_safety.left": "Freedom",
  "slider.freedom_safety.right": "Safety",
  "slider.individual_group.left": "Individual",
  "slider.individual_group.right": "Group",
  "slider.head_heart.left": "Head",
  "slider.head_heart.right": "Heart",
  "slider.aria": "{left} versus {right}",
  "thinking.eyebrow": "How the judge works",
  "thinking.read": "Reading and steelmanning both sides…",
  "thinking.label": "Labeling claims: fact, value, definition, logic…",
  "thinking.dig": "Digging down to bedrock…",
  "thinking.reach": "Reaching each side's bedrock…",
  "thinking.crux": "Locating the crux…",
  "thinking.judges": "Three independent judges deliberating…",
  "thinking.votes": "Counting the votes…",
  "thinking.helper": "Three separate AI judges rule independently — this can take a minute.",
  "thinking.finish": "Digging to the crux…",
  "thinking.stillJudging": "Still judging — the three AI judges are deliberating…",
  "thinking.ready": "Verdict ready.",
  "verdict.win": "{name} is right",
  "verdict.winSelf": "You're right",
  "verdict.split": "Split decision",
  "verdict.conditional": "It depends on your values",
  "verdict.dissolved": "Same word, different meanings",
  "verdict.tooClose": "Too close to call",
  "lean.title": "Forced ruling: {name} is more right",
  "lean.titleSelf": "Forced ruling: you're more right",
  "lean.unanimous": "Every judge leaned this way.",
  "lean.majority": "The judges leaned this way 2–1.",
  "lean.tie": "Even forced to rule, the judges split evenly.",
  splitWin: "{name} is right:",
  splitWinSelf: "You're right about this:",
  ifPrefix: "If",
  "badge.factual": "Factual dispute",
  "badge.logical": "Logical dispute",
  "badge.definitional": "Definitional dispute",
  "badge.values": "Values dispute",
  "badge.mixed": "Mixed dispute",
  "kind.fact": "fact",
  "kind.value": "value",
  "kind.definition": "definition",
  "kind.logic": "logic",
  bedrock: "🪨 Bedrock",
  cruxShort: "⚡ The crux",
  cruxTitle: "⚡ The crux — what this is really about",
  mapTitle: "The argument, mapped to bedrock",
  factsTitle: "Facts this verdict leans on — check them",
  bestPointTitle: "🤍 Strongest point for the other side",
  share: "📤 Share",
  copyLink: "🔗 Copy link",
  copied: "✓ Link copied",
  shareText: "The verdict is in. Who's right?",
  copyPrompt: "Copy this link:",
  judgeAnother: "Judge another argument",
  "judgesVoted.one": "1 independent AI judge voted:",
  "judgesVoted.other": "{n} independent AI judges voted:",
  "vote.split": "split",
  "vote.conditional": "conditional",
  "vote.dissolved": "dissolved",
  refusedNote: "The AI declined to judge this one — no verdict beats a fake one.",
  demoNote: "🎭 Demo mode — sample verdict, no AI key configured",
  "trial.survived":
    "🛡️ The ruling survived adversarial cross-examination — confidence unchanged",
  "trial.uncertain": "⚠️ Cross-examination left real doubts — confidence capped",
  "trial.overturned": "⚠️ The ruling did not survive cross-examination — confidence capped",
  "trial.whatWasTested": "What was tested",
  "trial.attackPrefix": "Strongest attack:",
  "trial.refereePrefix": "Referee:",
  "confidence.1": "Very low",
  "confidence.2": "Low",
  "confidence.3": "Moderate",
  "confidence.4": "High",
  "confidence.5": "Very high",
  confidenceWord: "{word} confidence · {n}/5",
  confidenceAria: "Confidence {n} of 5",
  verdictAria: "Verdict: {label}",
  "party.a": "Party A",
  "party.b": "Party B",
  you: "You",
  "shared.subtitle": "A shared ruling · parties anonymized",
  "shared.cta": "Settle your own argument →",
  errorFallback: "Something went wrong",
  "error.not_configured":
    "The judge is not configured: set ANTHROPIC_API_KEY in .env and restart the server.",
  "error.quota": "The judge hit its AI quota for now — try again in a few minutes.",
  "error.unavailable": "The judge is unavailable right now — try again in a minute.",
  "error.too_short": "Tell us a bit more about the argument.",
  "error.too_long": "Keep it under 6000 characters.",
  "error.invalid": "Invalid request",
  "error.rate_limited": "Order in the court! You've hit the limit for now. Try again in {wait}.",
  "error.daily_cap":
    "The court is closed for today: it has heard all the arguments it can. Back in {wait}.",
  "error.captcha_failed": "We couldn't confirm you're human. Give the check another go and resubmit.",
  "wait.moment": "a few minutes",
  "wait.minute": "1 minute",
  "wait.minutes": "{n} minutes",
  "wait.hour": "1 hour",
  "wait.hours": "{n} hours",
  "refused.headline": "The model declined to weigh in",
  "refused.crux":
    "The AI's own safety filter refused to judge this one — no verdict is better than a fake one.",
  "refused.bestPoint": "Try rephrasing, or accept that this one is beyond an app.",
  "refused.claim": "Not analyzed",
  "nav.skip": "Skip to content",
  "nav.home": "Verdict home page",
  "nav.how": "How it works",
  "examples.label": "Need a spark? Try one:",
  "example.hotdog.label": "🌭 Is a hot dog a sandwich?",
  "example.hotdog.text":
    "My friend Sam says a hot dog is a sandwich: it's a filling inside sliced bread, end of story. I say it's its own thing. Nobody orders a sandwich and expects a hot dog, and no menu lists it under sandwiches.",
  "example.tomato.label": "🍅 Is a tomato a fruit?",
  "example.tomato.text":
    "Alex insists a tomato is a vegetable because that's how everyone cooks and eats it. I say it's a fruit, because botanically it grows from the flower and carries the seeds.",
  "example.whiteLie.label": "🤥 Are white lies OK?",
  "example.whiteLie.text":
    "Jordan told a friend they loved her new haircut when they actually hated it, and says a white lie like that is just kindness. I think real friends should hear the truth, said gently.",
  "example.knuckles.label": "🦴 Does knuckle cracking cause arthritis?",
  "example.knuckles.text":
    "My mom says cracking my knuckles will give me arthritis. I crack them all the time and I say that's a myth with no evidence behind it.",
  "example.pineapple.label": "🍍 Pineapple on pizza?",
  "example.pineapple.text":
    "Riley says pineapple on pizza is a crime against Italian cooking. I say pizza is whatever tastes good, and tradition alone is not an argument.",
  "advanced.summary": "Advanced: value framework",
  "advanced.current": "Now: {label}",
  "turnstile.label": "Quick check that you're human",
  "turnstile.error": "The human check couldn't load. Refresh the page and try again.",
  privacyLink: "How we handle your text",
  "how.title": "How it works",
  "how.lead": "No coin flips. Every argument goes through the same five steps.",
  "how.step1.title": "Steelman both sides",
  "how.step1.body": "Each side is restated in its strongest form, including the one you disagree with.",
  "how.step2.title": "Sort the claims",
  "how.step2.body":
    "Every claim is tagged as fact, value, definition or logic, because each kind gets settled differently.",
  "how.step3.title": "Find the crux",
  "how.step3.body":
    "It digs under each side to its bedrock premise and finds the one thing the fight really turns on.",
  "how.step4.title": "Three independent judges",
  "how.step4.body":
    "Three judges rule separately. Confidence comes from how much they agree, never from how sure they sound.",
  "how.step5.title": "Verdict and cross-examination",
  "how.step5.body":
    "You get a ruling, a confidence score and the strongest point for the other side. Factual wins are cross-examined before they stand.",
  "sample.title": "What a verdict looks like",
  "sample.lead":
    "Here's the hot dog case. Your own verdict also maps every claim down to bedrock and lists the facts it leans on.",
  "sample.badge": "Example",
  "sample.nameA": "Sam",
  "sample.nameB": "You",
  "sample.label": "You're right",
  "sample.headline": "In everyday speech a hot dog is its own category, not a sandwich.",
  "sample.crux":
    "Is a sandwich defined by its structure (filling in bread) or by how people actually use the word?",
  "sample.bestPoint":
    "Structurally, a split roll holding a filling does fit most dictionary definitions of a sandwich.",
  "faq.title": "Questions, answered",
  "faq.fair.q": "Is it fair?",
  "faq.fair.a":
    "It tries hard to be. Names are swapped for Party A and Party B so the judges never know who's who, both sides are steelmanned, and three judges rule separately. When they disagree, the confidence score drops and says so. It can still be wrong, so check the facts it lists.",
  "faq.private.q": "Is my text private?",
  "faq.private.a":
    "There are no accounts. Your text, names included, is sent once to Anthropic's API so the names can be swapped for Party A and Party B. Only that anonymized version is judged, and only it is stored so your share link works. Leave out anything you wouldn't want on a shareable page.",
  "faq.powers.q": "What powers it?",
  "faq.powers.a":
    "Anthropic's Claude. Three judges run in parallel with a structured judging prompt, and winning factual rulings get a separate cross-examination. The confidence math is plain code: it counts how often the judges agree.",
  "faq.taste.q": "What if it's just a matter of taste?",
  "faq.taste.a":
    "Then it says so: “It depends on your values” or “Same word, different meanings”. It still tells you which way the judges lean, clearly labeled as a forced ruling.",
  "faq.legal.q": "Is this legal advice?",
  "faq.legal.a":
    "No. Verdict is for fun and for thinking more clearly about everyday disagreements. For anything legal, medical or financial, ask a qualified human.",
  "footer.about": "About",
  "footer.privacy": "Privacy",
  "footer.home": "Settle an argument",
  "footer.note": "For fun and clarity, not legal advice. Runs on Anthropic's Claude.",
  "footer.language": "Language",
  "footer.nav": "Site links",
  "shared.ctaLead": "Got an argument of your own?",
  "notFound.title": "This verdict has left the courtroom",
  "notFound.body": "The link may be mistyped, or the verdict no longer exists.",
  "about.title": "About Verdict",
  "about.lead":
    "Verdict is a small, opinionated referee for everyday arguments. Describe a disagreement and it tells you who's right, or, just as usefully, why nobody is.",
  "about.methodTitle": "The method",
  "about.honestTitle": "Honest labels",
  "about.honest":
    "Not every fight has a winner. A verdict can be a clear win, a split decision, “it depends on your values”, or “same word, different meanings”. If you want a winner anyway, it gives a forced ruling and labels it as one.",
  "about.limitsTitle": "Limits",
  "about.limit1":
    "It only knows what you tell it, and how you tell the story shapes the result. Include the other side the way they'd put it.",
  "about.limit2":
    "AI judges can get facts wrong. Every verdict lists the facts it leans on so you can check them.",
  "about.limit3": "Name replacement is best effort. Unusual names or nicknames can slip through.",
  "about.limit4": "It's for fun and clarity, not legal, medical or financial advice.",
  "about.builtTitle": "Under the hood",
  "about.built":
    "Verdict runs on Anthropic's Claude. Three judges run in parallel, their agreement sets the confidence score, and winning factual rulings face a separate cross-examination before they stand.",
  "privacy.title": "Privacy",
  "privacy.lead": "Short version: no accounts, no real names stored, nothing sold.",
  "privacy.storedTitle": "What we store",
  "privacy.stored":
    "When you get a verdict, we save the anonymized argument (names swapped for Party A and Party B), the value framework you picked and the verdict, so the share link keeps working. The real names you typed are never saved; they only go back to your own browser to label the result.",
  "privacy.notStoredTitle": "What we don't do",
  "privacy.notStored":
    "No accounts, no ad trackers, no selling data. Your language choice is kept in your browser's local storage, nowhere else.",
  "privacy.ipTitle": "Rate limiting",
  "privacy.ip":
    "To keep the court open for everyone, we limit how many verdicts one visitor can request. For that we keep a keyed hash of your IP address (not the address itself) in our rate-limit store for up to 24 hours. If the human check is on, your IP address is also passed to Cloudflare to verify it. It is never saved with your verdict.",
  "privacy.processorsTitle": "Who else handles your text",
  "privacy.processors":
    "The text you type, real names included, is first sent to Anthropic's API (Claude) so the names can be removed. Only the anonymized version is then judged and stored. If the human check is on, Cloudflare Turnstile runs in your browser and checks the result with Cloudflare. Our hosting provider keeps standard server logs.",
  "privacy.shareTitle": "Share links",
  "privacy.share":
    "Anyone with a verdict's link can view it. Links use long random IDs, and share pages ask search engines not to index them. Leave out addresses, phone numbers or anything else you wouldn't want on a public page.",
  "privacy.contactTitle": "Contact",
  "privacy.contact": "Questions, or want a verdict removed? Email {email} and include the link.",
  // Intentionally language-invariant: each aria label is written in the
  // language of the audience it serves (the TR side speaks to Turkish
  // readers, the EN side to English readers), whatever the current lang.
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
} as const;

export type Key = keyof typeof en;

const tr = {
  "hero.title": "Kim haklı? Hemen çözelim.",
  "hero.lead":
    "Tartışmayı anlat. Üç bağımsız yapay zekâ yargıcı meselenin özüne iner ve dürüst bir güven puanıyla karar verir.",
  "input.label": "Tartışma",
  placeholder:
    "Kavgayı anlat. Kim ne diyor, neden?\n\nKarşı tarafın görüşünü onun anlatacağı gibi ekle — yargıç iki tarafı da en güçlü hâliyle ele alır.",
  getVerdict: "Hükmü ver",
  privacyNote:
    "İsimler yargılamadan önce anonim etiketlerle değiştirilir — yargıç kimin kim olduğunu bilmez ve yalnızca anonim metin saklanır.",
  judgeBy: "Ölçüt",
  fineTune: "İnce ayar ▸",
  hideFineTune: "İnce ayarı gizle",
  sliderNote: "Orta = tarafsız. Bunlar yalnızca tartışma değerlere dayanıyorsa devreye girer.",
  "preset.balanced.label": "Dengeli",
  "preset.balanced.blurb": "Sağduyulu denge",
  "preset.outcomes.label": "Sonuçlar",
  "preset.outcomes.blurb": "Önemli olan sonuç",
  "preset.principles.label": "İlkeler",
  "preset.principles.blurb": "Önce kurallar ve haklar",
  "preset.fairness.label": "Hakkaniyet",
  "preset.fairness.blurb": "Eşit muamele",
  "preset.loyalty.label": "Sadakat",
  "preset.loyalty.blurb": "Kurallardan önce insan",
  "slider.freedom_safety.left": "Özgürlük",
  "slider.freedom_safety.right": "Güvenlik",
  "slider.individual_group.left": "Birey",
  "slider.individual_group.right": "Toplum",
  "slider.head_heart.left": "Akıl",
  "slider.head_heart.right": "Kalp",
  "slider.aria": "{left} / {right} dengesi",
  "thinking.eyebrow": "Yargıç nasıl çalışır",
  "thinking.read": "İki taraf da okunup en güçlü hâliyle yeniden kuruluyor…",
  "thinking.label": "İddialar etiketleniyor: olgu, değer, tanım, mantık…",
  "thinking.dig": "Temele doğru kazılıyor…",
  "thinking.reach": "Her tarafın temeline ulaşılıyor…",
  "thinking.crux": "Düğüm noktası aranıyor…",
  "thinking.judges": "Üç bağımsız yargıç ayrı ayrı değerlendiriyor…",
  "thinking.votes": "Oylar sayılıyor…",
  "thinking.helper": "Üç ayrı yapay zekâ yargıcı bağımsız karar verir — bu bir dakika sürebilir.",
  "thinking.finish": "Düğüm noktasına iniliyor…",
  "thinking.stillJudging": "Yargılama sürüyor — üç yapay zekâ yargıcı hâlâ değerlendiriyor…",
  "thinking.ready": "Karar hazır.",
  "verdict.win": "{name} haklı",
  "verdict.winSelf": "Sen haklısın",
  "verdict.split": "Bölünmüş karar",
  "verdict.conditional": "Değerlerine bağlı",
  "verdict.dissolved": "Aynı kelime, farklı anlamlar",
  "verdict.tooClose": "Başa baş — karar verilemedi",
  "lean.title": "Zorunlu hüküm: {name} daha haklı",
  "lean.titleSelf": "Zorunlu hüküm: sen daha haklısın",
  "lean.unanimous": "Yargıçların hepsi bu tarafı seçti.",
  "lean.majority": "Yargıçlar bu tarafı 2–1 seçti.",
  "lean.tie": "Zorunlu hükümde bile yargıçlar yarı yarıya bölündü.",
  splitWin: "{name} şu konuda haklı:",
  splitWinSelf: "Sen şu konuda haklısın:",
  ifPrefix: "Eğer",
  "badge.factual": "Olgusal tartışma",
  "badge.logical": "Mantıksal tartışma",
  "badge.definitional": "Tanımsal tartışma",
  "badge.values": "Değer tartışması",
  "badge.mixed": "Karma tartışma",
  "kind.fact": "olgu",
  "kind.value": "değer",
  "kind.definition": "tanım",
  "kind.logic": "mantık",
  bedrock: "🪨 Ana kaya",
  cruxShort: "⚡ Düğüm noktası",
  cruxTitle: "⚡ Düğüm noktası — bu kavga aslında ne hakkında",
  mapTitle: "Tartışmanın temele inen haritası",
  factsTitle: "Bu kararın dayandığı olgular — kendin doğrula",
  bestPointTitle: "🤍 Karşı tarafın en güçlü noktası",
  share: "📤 Paylaş",
  copyLink: "🔗 Bağlantıyı kopyala",
  copied: "✓ Bağlantı kopyalandı",
  shareText: "Karar çıktı. Kim haklı?",
  copyPrompt: "Bu bağlantıyı kopyala:",
  judgeAnother: "Başka bir tartışma çözdür",
  "judgesVoted.one": "{n} bağımsız yapay zekâ yargıcı oy verdi:",
  "judgesVoted.other": "{n} bağımsız yapay zekâ yargıcı oy verdi:",
  "vote.split": "bölünmüş",
  "vote.conditional": "koşullu",
  "vote.dissolved": "çözüldü",
  refusedNote: "Yapay zekâ bunu yargılamayı reddetti — sahte karardansa kararsızlık iyidir.",
  demoNote: "🎭 Demo modu — örnek karar, API anahtarı yok",
  "trial.survived": "🛡️ Karar çapraz sorgudan geçti — güven değişmedi",
  "trial.uncertain": "⚠️ Çapraz sorgu ciddi şüphe bıraktı — güven sınırlandı",
  "trial.overturned": "⚠️ Karar çapraz sorguda ayakta kalamadı — güven sınırlandı",
  "trial.whatWasTested": "Ne test edildi",
  "trial.attackPrefix": "En güçlü itiraz:",
  "trial.refereePrefix": "Hakem:",
  "confidence.1": "Çok düşük",
  "confidence.2": "Düşük",
  "confidence.3": "Orta",
  "confidence.4": "Yüksek",
  "confidence.5": "Çok yüksek",
  confidenceWord: "{word} güven · {n}/5",
  confidenceAria: "Güven: 5 üzerinden {n}",
  verdictAria: "Karar: {label}",
  "party.a": "Taraf A",
  "party.b": "Taraf B",
  you: "Sen",
  "shared.subtitle": "Paylaşılan bir karar · taraflar anonim",
  "shared.cta": "Sen de tartışmanı çözdür →",
  errorFallback: "Bir şeyler ters gitti",
  "error.not_configured":
    "Yargıç yapılandırılmamış: .env dosyasına ANTHROPIC_API_KEY ekleyip sunucuyu yeniden başlat.",
  "error.quota": "Yargıç şimdilik yapay zekâ kotasına takıldı — birkaç dakika sonra tekrar dene.",
  "error.unavailable": "Yargıca şu anda ulaşılamıyor — bir dakika sonra tekrar dene.",
  "error.too_short": "Tartışmayı biraz daha anlat.",
  "error.too_long": "6000 karakterin altında tut.",
  "error.invalid": "Geçersiz istek",
  "error.rate_limited": "Mahkemede sükût! Şimdilik sınıra ulaştın. {wait} sonra tekrar dene.",
  "error.daily_cap":
    "Mahkeme bugünlük kapandı: dinleyebileceği bütün tartışmaları dinledi. {wait} sonra yeniden açılıyor.",
  "error.captcha_failed": "İnsan olduğunu doğrulayamadık. Doğrulamayı yeniden dene ve tekrar gönder.",
  "wait.moment": "birkaç dakika",
  "wait.minute": "1 dakika",
  "wait.minutes": "{n} dakika",
  "wait.hour": "1 saat",
  "wait.hours": "{n} saat",
  "refused.headline": "Model karar vermekten kaçındı",
  "refused.crux":
    "Yapay zekânın güvenlik filtresi bunu yargılamayı reddetti — sahte karardansa kararsızlık iyidir.",
  "refused.bestPoint": "Yeniden ifade etmeyi dene ya da bunun bir uygulamayı aştığını kabul et.",
  "refused.claim": "İncelenmedi",
  "nav.skip": "İçeriğe geç",
  "nav.home": "Verdict ana sayfası",
  "nav.how": "Nasıl çalışır",
  "examples.label": "Aklına bir şey gelmedi mi? Birini dene:",
  "example.hotdog.label": "🌭 Sosisli bir sandviç mi?",
  "example.hotdog.text":
    "Arkadaşım Mert sosislinin bir sandviç olduğunu söylüyor: dilimlenmiş ekmeğin içinde bir dolgu, bu kadar. Bence sosisli kendi başına bir şey. Kimse sandviç isteyip önüne sosisli gelmesini beklemez, hiçbir menü onu sandviçlerin altında yazmaz.",
  "example.tomato.label": "🍅 Domates meyve mi?",
  "example.tomato.text":
    "Ece domatesin sebze olduğunda ısrar ediyor, çünkü herkes onu sebze gibi pişirip yiyor. Bence meyve, çünkü botanik olarak çiçekten gelişiyor ve tohum taşıyor.",
  "example.whiteLie.label": "🤥 Beyaz yalan masum mu?",
  "example.whiteLie.text":
    "Deniz, aslında hiç beğenmediği hâlde arkadaşına yeni saçını çok sevdiğini söyledi ve böyle bir beyaz yalanın sadece incelik olduğunu savunuyor. Bence gerçek arkadaşlar doğruyu, nazikçe söylenmiş hâliyle duymalı.",
  "example.knuckles.label": "🦴 Parmak çıtlatmak kireçlenme yapar mı?",
  "example.knuckles.text":
    "Annem parmaklarımı çıtlatırsam kireçlenme olacağını söylüyor. Ben sürekli çıtlatıyorum ve bunun hiçbir kanıtı olmayan bir efsane olduğunu düşünüyorum.",
  "example.pineapple.label": "🍍 Pizzaya ananas olur mu?",
  "example.pineapple.text":
    "Selin pizzaya ananas koymanın İtalyan mutfağına hakaret olduğunu söylüyor. Bence pizza neyle lezzetliyse odur, gelenek tek başına bir argüman değil.",
  "advanced.summary": "Gelişmiş: değer çerçevesi",
  "advanced.current": "Şu an: {label}",
  "turnstile.label": "İnsan olduğunu hızlıca doğrulayalım",
  "turnstile.error": "İnsan doğrulaması yüklenemedi. Sayfayı yenileyip tekrar dene.",
  privacyLink: "Metnini nasıl işliyoruz",
  "how.title": "Nasıl çalışır",
  "how.lead": "Yazı tura yok. Her tartışma aynı beş adımdan geçer.",
  "how.step1.title": "İki tarafı da güçlendir",
  "how.step1.body": "Her taraf en güçlü hâliyle yeniden kurulur, katılmadığın taraf da.",
  "how.step2.title": "İddiaları ayır",
  "how.step2.body":
    "Her iddia olgu, değer, tanım ya da mantık olarak etiketlenir, çünkü her biri farklı yoldan çözülür.",
  "how.step3.title": "Düğüm noktasını bul",
  "how.step3.body":
    "Her tarafın altını ana kayaya kadar kazar ve kavganın gerçekte döndüğü tek noktayı bulur.",
  "how.step4.title": "Üç bağımsız yargıç",
  "how.step4.body":
    "Üç yargıç ayrı ayrı karar verir. Güven puanı ne kadar emin göründüklerinden değil, ne kadar hemfikir olduklarından gelir.",
  "how.step5.title": "Karar ve çapraz sorgu",
  "how.step5.body":
    "Bir hüküm, bir güven puanı ve karşı tarafın en güçlü noktasını alırsın. Olgusal zaferler kesinleşmeden önce çapraz sorgudan geçer.",
  "sample.title": "Bir karar nasıl görünür",
  "sample.lead":
    "İşte sosisli davası. Senin kararın ayrıca her iddiayı ana kayaya kadar haritalar ve dayandığı olguları listeler.",
  "sample.badge": "Örnek",
  "sample.nameA": "Mert",
  "sample.nameB": "Sen",
  "sample.label": "Sen haklısın",
  "sample.headline": "Gündelik dilde sosisli sandviç değil, kendi başına bir kategori.",
  "sample.crux":
    "Sandviç yapısıyla mı (ekmek içinde dolgu), yoksa insanların kelimeyi gerçekte nasıl kullandığıyla mı tanımlanır?",
  "sample.bestPoint":
    "Yapı olarak, içinde dolgu olan yarılmış bir ekmek çoğu sözlükteki sandviç tanımına uyuyor.",
  "faq.title": "Merak edilenler",
  "faq.fair.q": "Adil mi?",
  "faq.fair.a":
    "Olmak için çok uğraşıyor. İsimler Taraf A ve Taraf B ile değiştirilir, böylece yargıçlar kimin kim olduğunu bilmez; iki taraf da en güçlü hâliyle ele alınır ve üç yargıç ayrı ayrı karar verir. Anlaşamazlarsa güven puanı düşer ve bunu açıkça söyler. Yine de yanılabilir, listelediği olguları kontrol et.",
  "faq.private.q": "Metnim gizli kalıyor mu?",
  "faq.private.a":
    "Hesap yok. Metnin, isimler dahil, isimlerin Taraf A ve Taraf B ile değiştirilmesi için bir kez Anthropic'in API'sine gönderilir. Yalnızca bu anonim hâli yargılanır ve paylaşım bağlantısı çalışsın diye yalnızca o saklanır. Paylaşılabilir bir sayfada görmek istemeyeceğin ayrıntıları yazma.",
  "faq.powers.q": "Arkasında ne var?",
  "faq.powers.a":
    "Anthropic'in Claude modeli. Üç yargıç yapılandırılmış bir yargılama talimatıyla paralel çalışır, kazanan olgusal hükümler ayrıca çapraz sorgudan geçer. Güven hesabı düz koddur: yargıçların ne sıklıkla hemfikir olduğunu sayar.",
  "faq.taste.q": "Ya mesele sadece zevk meselesiyse?",
  "faq.taste.a":
    "O zaman bunu söyler: “Değerlerine bağlı” ya da “Aynı kelime, farklı anlamlar”. Yine de yargıçların hangi tarafa yattığını, zorunlu hüküm olarak açıkça etiketleyip gösterir.",
  "faq.legal.q": "Bu hukuki tavsiye mi?",
  "faq.legal.a":
    "Hayır. Verdict eğlence ve gündelik anlaşmazlıklar üzerine daha net düşünmek için. Hukuki, tıbbi ya da mali konularda yetkin bir insana danış.",
  "footer.about": "Hakkında",
  "footer.privacy": "Gizlilik",
  "footer.home": "Bir tartışma çözdür",
  "footer.note": "Eğlence ve netlik için, hukuki tavsiye değildir. Anthropic'in Claude modeliyle çalışır.",
  "footer.language": "Dil",
  "footer.nav": "Site bağlantıları",
  "shared.ctaLead": "Senin de bir tartışman mı var?",
  "notFound.title": "Bu karar mahkemeden ayrılmış",
  "notFound.body": "Bağlantı hatalı yazılmış olabilir ya da karar artık mevcut değil.",
  "about.title": "Verdict hakkında",
  "about.lead":
    "Verdict, gündelik tartışmalar için küçük ve kararlı bir hakem. Bir anlaşmazlığı anlat; sana kimin haklı olduğunu ya da, en az onun kadar işe yarar biçimde, neden kimsenin haklı olmadığını söylesin.",
  "about.methodTitle": "Yöntem",
  "about.honestTitle": "Dürüst etiketler",
  "about.honest":
    "Her kavganın bir kazananı yoktur. Karar net bir galibiyet, bölünmüş bir karar, “değerlerine bağlı” ya da “aynı kelime, farklı anlamlar” olabilir. Yine de bir kazanan istersen zorunlu bir hüküm verir ve bunu açıkça belirtir.",
  "about.limitsTitle": "Sınırlar",
  "about.limit1":
    "Yalnızca ona anlattıklarını bilir ve hikâyeyi nasıl anlattığın sonucu etkiler. Karşı tarafı da onun anlatacağı gibi ekle.",
  "about.limit2":
    "Yapay zekâ yargıçları olgularda yanılabilir. Her karar dayandığı olguları listeler, böylece kontrol edebilirsin.",
  "about.limit3":
    "İsim değiştirme elinden geleni yapar. Alışılmadık isimler ya da lakaplar gözden kaçabilir.",
  "about.limit4": "Eğlence ve netlik içindir; hukuki, tıbbi ya da mali tavsiye değildir.",
  "about.builtTitle": "Perde arkası",
  "about.built":
    "Verdict, Anthropic'in Claude modeliyle çalışır. Üç yargıç paralel çalışır, hemfikir olma oranları güven puanını belirler ve kazanan olgusal hükümler kesinleşmeden önce ayrı bir çapraz sorgudan geçer.",
  "privacy.title": "Gizlilik",
  "privacy.lead": "Kısacası: hesap yok, gerçek isim saklanmıyor, hiçbir şey satılmıyor.",
  "privacy.storedTitle": "Neyi saklıyoruz",
  "privacy.stored":
    "Bir karar aldığında, paylaşım bağlantısı çalışmaya devam etsin diye anonimleştirilmiş tartışmayı (isimler Taraf A ve Taraf B ile değiştirilmiş), seçtiğin değer çerçevesini ve kararı kaydederiz. Yazdığın gerçek isimler asla kaydedilmez; yalnızca sonucu etiketlemek için kendi tarayıcına geri gönderilir.",
  "privacy.notStoredTitle": "Neyi yapmıyoruz",
  "privacy.notStored":
    "Hesap yok, reklam takibi yok, veri satışı yok. Dil tercihin yalnızca tarayıcının yerel depolamasında tutulur.",
  "privacy.ipTitle": "Kullanım sınırı",
  "privacy.ip":
    "Mahkeme herkese açık kalsın diye bir ziyaretçinin kaç karar isteyebileceğini sınırlıyoruz. Bunun için IP adresinin kendisini değil, anahtarlı bir özetini (hash) kullanım sınırı deposunda en fazla 24 saat tutarız. İnsan doğrulaması açıksa IP adresin doğrulama için Cloudflare'a da iletilir. Kararınla birlikte asla kaydedilmez.",
  "privacy.processorsTitle": "Metnini başka kim işliyor",
  "privacy.processors":
    "Yazdığın metin, gerçek isimler dahil, isimlerin çıkarılması için önce Anthropic'in API'sine (Claude) gönderilir. Ardından yalnızca anonim hâli yargılanır ve saklanır. İnsan doğrulaması açıksa Cloudflare Turnstile tarayıcında çalışır ve sonucu Cloudflare ile doğrular. Barındırma sağlayıcımız standart sunucu kayıtlarını tutar.",
  "privacy.shareTitle": "Paylaşım bağlantıları",
  "privacy.share":
    "Bir kararın bağlantısına sahip olan herkes onu görebilir. Bağlantılar uzun rastgele kimlikler kullanır ve paylaşım sayfaları arama motorlarından dizine eklememelerini ister. Adres, telefon numarası ya da herkese açık bir sayfada görmek istemeyeceğin başka bir şey yazma.",
  "privacy.contactTitle": "İletişim",
  "privacy.contact":
    "Sorun mu var ya da bir kararın kaldırılmasını mı istiyorsun? Bağlantıyla birlikte {email} adresine yaz.",
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
} as const satisfies Record<Key, string>;

export const STRINGS = { en, tr } as const;

/** Look up a string and interpolate `{var}` slots. Unknown braces are left alone. */
export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[lang][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** Claim-kind tag labels, shared by ArgumentMap and ThinkingDig. */
export const KIND_KEY = {
  fact: "kind.fact",
  value: "kind.value",
  definition: "kind.definition",
  logic: "kind.logic",
} as const satisfies Record<ClaimKind, Key>;

/**
 * API error `code` → dictionary key. The route sends a stable machine code
 * alongside its English `error` text; the client localizes from the code.
 */
export const ERROR_KEY_BY_CODE: Partial<Record<string, Key>> = {
  invalid: "error.invalid",
  too_short: "error.too_short",
  too_long: "error.too_long",
  not_configured: "error.not_configured",
  quota: "error.quota",
  unavailable: "error.unavailable",
  rate_limited: "error.rate_limited",
  daily_cap: "error.daily_cap",
  captcha_failed: "error.captcha_failed",
};

/** A server-provided wait (seconds) as a whole human phrase: minutes below
 * 90, hours beyond. Always rounds UP so "try again in 1 minute" never
 * undersells the wait. Missing or nonsense input reads as "a few minutes". */
export function formatWait(lang: Lang, seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return t(lang, "wait.moment");
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) {
    return minutes === 1 ? t(lang, "wait.minute") : t(lang, "wait.minutes", { n: minutes });
  }
  const hours = Math.ceil(seconds / 3600);
  return hours === 1 ? t(lang, "wait.hour") : t(lang, "wait.hours", { n: hours });
}

/**
 * Localized message for a failed POST /api/verdict. `body` is whatever the
 * response parsed to (null when it was not JSON); `status` lets a bare 429
 * from the hosting layer still read as a rate limit. Unknown codes fall back
 * to the server's English `error` text, then to the generic fallback.
 */
export function apiErrorMessage(lang: Lang, body: unknown, status?: number): string {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof b.code === "string" ? b.code : status === 429 ? "rate_limited" : undefined;
  const key = code !== undefined ? ERROR_KEY_BY_CODE[code] : undefined;
  if (key !== undefined) return t(lang, key, { wait: formatWait(lang, b.retryAfterSec) });
  if (typeof b.error === "string" && b.error.trim()) return b.error;
  return t(lang, "errorFallback");
}

/**
 * Best-effort language of stored verdict TEXT, which keeps whatever language
 * it was judged in (the language itself is never stored). Only for places
 * with no viewer preference, such as link-preview images fetched by
 * crawlers. Turkish-only letters or the Turkish party label decide it.
 */
export function contentLang(text: string): Lang {
  return /[ğıİşĞŞ]|\bTaraf [AB]\b/.test(text) ? "tr" : "en";
}
