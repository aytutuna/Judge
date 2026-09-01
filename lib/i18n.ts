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
  tagline: "Tell it the argument. It digs to bedrock and rules.",
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
  "thinking.stillJudging": "Still judging — three AI judges rule one at a time…",
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
  share: "🔗 Share this verdict",
  copied: "✓ Link copied",
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
    "The judge is not configured: set GEMINI_API_KEY in .env and restart the server.",
  "error.quota": "The judge hit its AI quota for now — try again in a few minutes.",
  "error.unavailable": "The judge is unavailable right now — try again in a minute.",
  "error.too_short": "Tell us a bit more about the argument.",
  "error.too_long": "Keep it under 6000 characters.",
  "error.invalid": "Invalid request",
  "refused.headline": "The model declined to weigh in",
  "refused.crux":
    "The AI's own safety filter refused to judge this one — no verdict is better than a fake one.",
  "refused.bestPoint": "Try rephrasing, or accept that this one is beyond an app.",
  "refused.claim": "Not analyzed",
  // Intentionally language-invariant: each aria label is written in the
  // language of the audience it serves (the TR side speaks to Turkish
  // readers, the EN side to English readers), whatever the current lang.
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
} as const;

export type Key = keyof typeof en;

const tr = {
  tagline: "Tartışmayı anlat. Temele kadar kazsın, kararı versin.",
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
  "thinking.stillJudging": "Yargılama sürüyor — üç yapay zekâ yargıcı sırayla karar veriyor…",
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
  share: "🔗 Kararı paylaş",
  copied: "✓ Bağlantı kopyalandı",
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
    "Yargıç yapılandırılmamış: .env dosyasına GEMINI_API_KEY ekleyip sunucuyu yeniden başlat.",
  "error.quota": "Yargıç şimdilik yapay zekâ kotasına takıldı — birkaç dakika sonra tekrar dene.",
  "error.unavailable": "Yargıca şu anda ulaşılamıyor — bir dakika sonra tekrar dene.",
  "error.too_short": "Tartışmayı biraz daha anlat.",
  "error.too_long": "6000 karakterin altında tut.",
  "error.invalid": "Geçersiz istek",
  "refused.headline": "Model karar vermekten kaçındı",
  "refused.crux":
    "Yapay zekânın güvenlik filtresi bunu yargılamayı reddetti — sahte karardansa kararsızlık iyidir.",
  "refused.bestPoint": "Yeniden ifade etmeyi dene ya da bunun bir uygulamayı aştığını kabul et.",
  "refused.claim": "İncelenmedi",
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
};
