import { isEnabled, type Lang } from "./langs";

/**
 * The language a dispute is written in, from the text alone. Scripts decide
 * most languages; the shared ones (Arabic/Urdu, Russian/Ukrainian, Hindi/
 * Marathi, Han) look at a few telltale letters or words, and the Latin ones
 * count function words. Null whenever it cannot tell: the text is short, mixes
 * two languages, or is in a language Judge does not write in. Pure.
 */

const MIN_LETTERS = 8;
const MIN_TOKENS = 4;
/** Share of the letters the leading script must hold, else it is a mix. */
const MIN_SCRIPT_SHARE = 0.75;
/** Share of the words that must be function words of the winning language. */
const MIN_WORD_SHARE = 0.12;
/** The runner-up may score at most this much of the winner's score. */
const MAX_RUNNER_UP = 0.75;
/** Telltale letters add at most this much to a Latin language's score. */
const MAX_LETTER_BONUS = 3;

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

// Close pairs score as one language and their own words settle which.
const DA = words(`og at det der som en et er jeg ikke på med for af til den har de han hun vi i du mig dig sig min mit din hans hendes
    deres vores denne dette var været blev bliver kan skal ville vil må men eller hvis da så bare også allerede meget nu altid
    aldrig alt intet noget sagde siger efter før mellem uden fra over under ved hvordan hvad hvem hvorfor hvor her ud op ned
    mere sin sit sine dem os jer ham hende ingen nogle selv fordi dog alligevel`);
const NB = words(`og å det som en et er jeg ikke på med for av til den har de han hun vi du meg deg seg min mitt din hans hennes
    deres vår denne dette var vært ble blir kan skal ville vil må men eller hvis da så bare også allerede veldig nå alltid
    aldri alt ingenting noe sa sier etter før mellom uten fra over under ved hvordan hva hvem hvorfor hvor her ut opp ned
    mer sin sitt sine dem oss dere ham henne ingen noen selv fordi likevel mye`);
const ID = words(`yang dan di itu ini dengan untuk tidak saya dia akan pada dari ke sudah bisa karena juga aku kamu gue nggak ga
    banget tapi kalau mereka kami kita adalah ada atau sebagai dalam oleh tetapi saat ketika belum hanya sangat lebih semua
    apa siapa bagaimana mengapa kenapa bukan jangan mau ingin harus sama lagi sedang dong deh sih lah pun tahu tau bilang
    katanya`);
const MS = words(`yang dan di itu ini dengan untuk tidak saya dia akan pada dari ke telah boleh kerana juga aku awak kami kita
    tetapi jika mereka adalah ada atau sebagai dalam oleh apabila ketika belum hanya sangat lebih semua apa siapa bagaimana
    mengapa kenapa bukan jangan mahu nak perlu tak sudah dah lagi sedang pun tahu kata sebab kalau`);

const LATIN_WORDS: Record<string, Set<string>> = {
  da: new Set([...DA, ...NB]),
  id: new Set([...ID, ...MS]),
  en: words(`the and of to was that it with for my you he she they have has had but not this are were what who because
    about said would could from their his her we our your been just when then there don didn doesn isn which if also even
    into than them will can does did am very really still always never nothing something everything a is in on at by be as
    i should say says all more some out up one how why where us him`),
  tr: words(`bir ve bu ben için icin ama çok cok değil degil ile var yok gibi daha sonra çünkü cunku benim sen onun ona şu her
    hiç kadar olan oldu olarak bana beni biz siz onlar yani ise diye ancak fakat şey sey kendi bunu bunun söyledi mı mi mu mü
    bence sadece hala artık ayrıca zaten nasıl neden ya hem şimdi simdi bütün tüm bile onu bize size sana seni dedi dedim söyledim
    istiyor istiyorum hiçbir biraz evet hayır önce göre rağmen değildi değilim olmadı etti`),
  de: words(`der die das und ist nicht ich ein eine zu mit auf für von den dem sie er wir haben hat war wird aber auch wie wenn
    dass mich mir sich nach bei noch nur oder aus über kein keine sind wurde weil ihr ihm meine mein dann doch schon immer
    wieder habe hatte hätte soll will kann mehr alles nichts etwas`),
  fr: words(`les des du une est qui pas pour dans avec je il elle nous vous ils elles ce cette sur au aux mais où par ses mon
    mes être suis sont était comme très aussi tout tous sans parce car même quand donc alors moi toi lui leur qu j fait
    ai avoir rien quelque jamais toujours ne le la de un et en a`),
  es: words(`el los las una unos que y en es no se por con para su sus mi mis yo tú él ella nosotros pero como más muy ya esto
    esta este eso ese hay fue era soy está están ser tiene tengo también porque cuando sin sobre entre todo todos del al
    qué mismo hace después ahora así solo nada algo quiero dijo de la le lo un nunca dice`),
  pt: words(`os as um uma do dos das em no na nos nas que é não se por para com mais mas como foi era eu ele ela nós você vocês
    eles elas meu minha seu sua isso isto esse essa este esta muito também já ainda só quando porque sobre entre depois ser
    estar tem têm tenho está estão fazer fez disse ao aos às pelo pela nem mesmo sem até então agora tudo nada lhe ter há são
    sou estou ou mim de a o e`),
  ca: words(`els les uns unes del dels i que és no es per amb què jo ell ella nosaltres vosaltres ells elles però com més molt
    també ja això aquest aquesta hi ha han va vaig són sóc soc està estic tinc té tenen perquè quan sense sobre entre tot tots
    em et li ens us al als mateix fer fa després ara així només res alguna vull meu meva seu seva nostre doncs encara sempre
    mai el la de un en`),
  it: words(`il lo gli le uno una di del della dei delle e è che non si per con da su più ma come io lui lei noi voi loro mio
    mia tuo suo sua questo questa quello quella molto anche già ancora solo quando perché sopra tra fra dopo essere ho ha
    hanno sono era stato fatto fare detto cosa niente nulla ogni tutto tutti mi ti ci ne ed né però quindi così adesso
    sempre mai dove chi cui nel nella nei sul sulla alla agli allo dal dalla degli negli sto stai la un in`),
  ro: words(`și şi că nu un o de în pe cu la să se mai dar sau este sunt am are au fost fi eu el ea noi voi ei ele meu mea lui
    lor acest această acea foarte încă doar când pentru despre între după fără dacă deci acum mereu niciodată tot toate toți
    mă te îl ne vă le unui unei ce cine care cum unde atunci însă nimic ceva spus vreau pot poate trebuie fac face avea avut`),
  nl: words(`de het een en van ik je jij dat die dit niet was zijn ze hij zij wij jullie op aan met voor naar bij uit om maar
    ook als dan nog wel geen heb heeft had hebben worden wordt werd kan zou wil moet mijn jouw haar hun onze deze er hier daar
    toen nu altijd nooit alles niets iets zei omdat wanneer want of dus echter tegen tussen zonder na over onder door mij hem
    ons hen erg heel veel meer al ben bent gaan gaat ging`),
  sv: words(`och att det som en ett är jag inte på med för av till den har de han hon vi ni du mig dig sig min mitt din hans
    hennes deras vår detta denna var varit blev blir kan ska skulle vill måste men eller om när då så bara också redan mycket
    nu alltid aldrig allt inget något sa säger efter innan mellan utan från över under vid hur vad vem varför där här ut upp
    ner mer sin sitt sina dem oss er honom henne ingen några själv eftersom dock ändå`),
  fi: words(`ja on ei että se oli mutta kun niin kuin joka jotka olen olet ovat olla ole hän he minä sinä me te minun sinun
    hänen heidän tämä tuo nämä ne tässä mitä kuka missä miksi koska jos vaan vain myös jo vielä hyvin nyt aina koskaan kaikki
    mitään jotain sanoi haluan voin voi täytyy tai eikä sitten kanssa ilman jälkeen ennen mukaan minua minulle sinua häntä
    hänelle meille heille tätä sitä sen tämän ollut kyllä`),
  hu: words(`az és hogy nem egy is de van volt ez azt ezt meg el ki be fel le át vissza én te ő mi ti ők nekem neked neki
    nekünk nekik engem téged minket őt mert ha mint csak már még nagyon most mindig soha minden semmi valami mondta akarok
    tudok lehet kell vagy után előtt között nélkül miatt által ellen ezért azért hanem viszont tehát itt ott mikor hol miért
    hogyan amit aki ami akik amely`),
  pl: words(`i w nie na się że z do to jest jak ale po co tak za od o czy już tylko być mam ma są był była było mnie mi ci ty
    on ona my wy oni one mój moja jego jej ich ten ta te tego tej bardzo też jeszcze kiedy ponieważ bo przez przy dla bez
    między potem teraz zawsze nigdy wszystko nic coś powiedział chcę mogę można trzeba jeśli żeby który która które gdzie
    kto więc jednak albo lub oraz sobie siebie mu go ją nas was im`),
  cs: words(`a v ve se že na je to s z do ale jak pro by byl byla bylo jsem jsi jsme jsou nebo když protože už jen také ještě
    velmi teď vždy nikdy všechno nic něco řekl chci můžu může musí pokud aby který která které kde kdo tedy však mi mě ti ty
    on ona my vy oni jeho její jejich ten ta tohle tento tato před při bez mezi potom po od o i ani než tak jako tam mám má
    máme mají`),
  sk: words(`a v sa že na je to s z do ale ako pre by bol bola bolo som si sme sú alebo keď pretože už len tiež ešte veľmi
    teraz vždy nikdy všetko nič niečo povedal chcem môžem môže musí ak aby ktorý ktorá ktoré kde kto teda však mi mňa ti ty
    on ona my vy oni jeho jej ich ten tá toto tento táto pred pri bez medzi potom po od o ani než tak tam mám má máme majú`),
  hr: words(`i u je se da na za s sa od do ne to što kako ali su bio bila bilo sam si smo ste ili kada jer već samo također
    još vrlo sada uvijek nikad sve ništa nešto rekao želim mogu može treba ako koji koja koje gdje tko dakle međutim mi me ti
    ga ju ih on ona vi oni njegov njezin njihov ovaj ova ovo taj ta prije pri bez između poslije nakon kroz nego pa tako
    ovdje tamo imam ima imamo imaju hoću htio bih`),
  sl: words(`in v je se da na za s z od do ne to kaj kako ampak so bil bila bilo sem si smo ste ali ko ker že samo tudi še zelo
    zdaj vedno nikoli vse nič nekaj rekel želim lahko treba če ki kje kdo torej vendar mi me ti ga jo jih on ona vi oni
    njegov njen njihov ta pred pri brez med po potem kot tako tukaj tam imam ima imamo imajo hočem želel bi`),
  vi: words(`và là của một không có được trong cho với này đó tôi bạn anh chị em ông bà họ chúng như nhưng vì nếu khi đã sẽ
    đang rất cũng còn đều để ra vào lên xuống nói muốn biết thấy làm đi về người những các mình bị tại nên nữa thì mà cái
    sau trước ở từ ai gì đâu sao thế vậy`),
};

/** Letters that mark a language on their own, counted as extra evidence. */
const LATIN_LETTERS: Partial<Record<string, RegExp>> = {
  tr: /[ğı]/g,
  de: /ß/g,
  es: /[ñ¿¡]/g,
  pt: /[ãõ]/g,
  ca: /·/g,
  ro: /[ășț]/g,
  pl: /[ąęłńśźż]/g,
  cs: /[ěřů]/g,
  sk: /[ľĺŕô]/g,
  hr: /đ/g,
  hu: /[őű]/g,
  da: /[æø]/g,
  vi: /[Ạ-ỹơư]/g,
};

const AFRIKAANS = words(`ek jy nie sê`);

const PT_BR = words(`você vocês pra tá tô né gente celular legal cara ônibus`);
const PT_PT = words(`facto telemóvel autocarro comboio ecrã estás tens fazes consigo miúdo rapariga contactar`);

const only = (x: Set<string>, y: Set<string>): Set<string> => new Set([...x].filter((w) => !y.has(w)));

/** What tells the two languages of a merged entry apart, and the answer when
 * the text does not (the app language if it is one of them, else this). */
const VARIANTS: Record<string, { langs: [Lang, Lang]; markers: [Set<string>, Set<string>]; fallback: Lang | null }> = {
  pt: { langs: ["pt-BR", "pt-PT"], markers: [PT_BR, PT_PT], fallback: "pt-BR" },
  da: { langs: ["da", "nb"], markers: [only(DA, NB), only(NB, DA)], fallback: null },
  id: { langs: ["id", "ms"], markers: [only(ID, MS), only(MS, ID)], fallback: "id" },
};

const SIMPLIFIED = "这个说国对时会发后没来还经点现开关东书车门问间长为与学见应无从么实动种进过让将总处头样机体电马鸟风飞们记请吗饭钱网费买卖";
const TRADITIONAL = "這個說國對時會發後沒來還經點現開關東書車門問間長為與學見應無從麼實動種進過讓將總處頭樣機體電馬鳥風飛們記請嗎飯錢網費買賣";

const RU_WORDS = words(`что это его они меня мне был была было были если когда чтобы очень только тебя нас нет уже ещё`);

const MARATHI = words(`आहे आणि नाही मी तो ती होते होता काय मला तुला आम्ही तुम्ही त्याने केले म्हणून पण`);
const HINDI = words(`है हैं और नहीं मैं था थी थे का की के को में से पर यह वह क्या मुझे तुम हम कि लेकिन भी एक किया गया`);

function latin(text: string, hint?: Lang): Lang | null {
  const lower = text.replace(/İ/g, "i").toLowerCase();
  const tokens = lower.match(/\p{L}+/gu) ?? [];
  if (tokens.length < MIN_TOKENS) return null;
  const scores = Object.entries(LATIN_WORDS).map(([key, set]) => {
    let score = tokens.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    const letters = LATIN_LETTERS[key];
    if (letters) score += Math.min(count(lower, letters), MAX_LETTER_BONUS);
    return [key, score] as const;
  });
  scores.sort((a, b) => b[1] - a[1]);
  const [key, best] = scores[0];
  const runnerUp = scores[1][1];
  // Azerbaijani, Lithuanian and Afrikaans borrow the function words of Turkish, Polish and Dutch.
  if (/[əėįųū]/.test(lower)) return null;
  if (key === "nl" && tokens.some((w) => AFRIKAANS.has(w))) return null;
  if (best < 3 || best / tokens.length < MIN_WORD_SHARE) return null;
  if (best - runnerUp < 2 || runnerUp > best * MAX_RUNNER_UP) return null;
  const variant = VARIANTS[key];
  if (!variant) return key as Lang;
  const [first, second] = variant.markers.map((set) => tokens.filter((w) => set.has(w)).length);
  if (first !== second) return variant.langs[first > second ? 0 : 1];
  return variant.langs.find((l) => l === hint) ?? variant.fallback;
}

function arabic(text: string): Lang | null {
  if (count(text, /[ٹڈڑںےۓ]/g) > 0) return "ur";
  // Farsi yeh and kaf mark Persian, Pashto and the like, which Judge does not write in.
  if (count(text, /[یک]/g) > count(text, /[يك]/g)) return null;
  return "ar";
}

function cyrillic(text: string): Lang | null {
  // Kazakh, Kyrgyz and Belarusian letters: not Russian or Ukrainian.
  if (/[әғқңөұүһў]/i.test(text)) return null;
  const uk = count(text, /[іїєґ]/g);
  const ru = count(text, /[ыэё]/g);
  if (uk !== ru) return uk > ru ? "uk" : "ru";
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return tokens.filter((w) => RU_WORDS.has(w)).length >= 2 ? "ru" : null;
}

function devanagari(text: string): Lang | null {
  const tokens = text.match(/[\p{L}\p{M}]+/gu) ?? [];
  const mr = tokens.filter((w) => MARATHI.has(w)).length + count(text, /ळ/g);
  const hi = tokens.filter((w) => HINDI.has(w)).length;
  if (mr === hi) return null;
  return mr > hi ? "mr" : "hi";
}

function han(text: string, hint?: Lang): Lang {
  if (count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu) >= 3) return "ja";
  const simplified = [...text].filter((c) => SIMPLIFIED.includes(c)).length;
  const traditional = [...text].filter((c) => TRADITIONAL.includes(c)).length;
  if (simplified !== traditional) return traditional > simplified ? "zh-Hant" : "zh-Hans";
  return hint === "zh-Hant" ? "zh-Hant" : "zh-Hans";
}

const SINGLE_SCRIPT: [Lang, RegExp][] = [
  ["he", /\p{Script=Hebrew}/gu],
  ["el", /\p{Script=Greek}/gu],
  ["bn", /\p{Script=Bengali}/gu],
  ["gu", /\p{Script=Gujarati}/gu],
  ["pa", /\p{Script=Gurmukhi}/gu],
  ["or", /\p{Script=Oriya}/gu],
  ["ta", /\p{Script=Tamil}/gu],
  ["te", /\p{Script=Telugu}/gu],
  ["kn", /\p{Script=Kannada}/gu],
  ["ml", /\p{Script=Malayalam}/gu],
  ["th", /\p{Script=Thai}/gu],
  ["ko", /\p{Script=Hangul}/gu],
];

/**
 * The supported language `text` is written in, or null when it is too short
 * to tell, a mix, or in another language. `hint` (the app language) only
 * settles what the text cannot: Brazilian or European Portuguese, Simplified
 * or Traditional Chinese.
 */
export function detectLang(text: string, hint?: Lang): Lang | null {
  const total = count(text, /\p{L}/gu);
  if (total < MIN_LETTERS) return null;
  const groups: [number, () => Lang | null][] = [
    [count(text, /\p{Script=Latin}/gu), () => latin(text, hint)],
    [count(text, /\p{Script=Arabic}/gu), () => arabic(text)],
    [count(text, /\p{Script=Cyrillic}/gu), () => cyrillic(text)],
    [count(text, /\p{Script=Devanagari}/gu), () => devanagari(text)],
    [count(text, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu), () => han(text, hint)],
    ...SINGLE_SCRIPT.map(([lang, re]): [number, () => Lang | null] => [count(text, re), () => lang]),
  ];
  const [n, resolve] = groups.reduce((a, b) => (b[0] > a[0] ? b : a));
  if (n / total < MIN_SCRIPT_SHARE) return null;
  const lang = resolve();
  return lang && isEnabled(lang) ? lang : null;
}

/** The language the judges write in: the one the text is in, else the app's. */
export function answerLang(text: string, appLang: Lang): Lang {
  return detectLang(text, appLang) ?? appLang;
}
