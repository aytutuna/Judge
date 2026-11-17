import { describe, expect, it } from "vitest";
import { answerLang, detectLang } from "../lib/detect-lang";
import type { Lang } from "../lib/langs";

const LATIN: [Lang, string][] = [
  ["en", "My roommate says I owe him half of the internet bill, but we never agreed that I would pay for it when I was away."],
  ["tr", "Ev arkadaşım internet faturasının yarısını bana ödetmek istiyor ama ben evde olmadığım zamanlar için ödemeyeceğimizi konuşmuştuk."],
  ["de", "Mein Mitbewohner sagt, ich schulde ihm die Hälfte der Internetrechnung, aber wir haben nie vereinbart, dass ich auch zahle, wenn ich weg bin."],
  ["fr", "Mon colocataire dit que je lui dois la moitié de la facture d'internet, mais nous n'avons jamais convenu que je paierais quand je suis absent."],
  ["es", "Mi compañero de piso dice que le debo la mitad de la factura de internet, pero nunca acordamos que yo pagaría cuando estoy fuera."],
  ["pt-BR", "Meu colega de apartamento diz que eu devo a metade da conta de internet, mas a gente nunca combinou que eu pagaria quando estivesse fora, você entende?"],
  ["pt-PT", "O meu colega de casa diz que lhe devo metade da conta da internet, mas nunca combinámos que eu pagaria quando estivesse fora, e o facto é que estás a ver."],
  ["it", "Il mio coinquilino dice che gli devo metà della bolletta di internet, ma non abbiamo mai deciso che avrei pagato quando ero via."],
  ["nl", "Mijn huisgenoot zegt dat ik hem de helft van de internetrekening schuldig ben, maar we hebben nooit afgesproken dat ik zou betalen als ik weg ben."],
  ["sv", "Min kompis säger att jag är skyldig honom hälften av interneträkningen, men vi har aldrig kommit överens om att jag skulle betala när jag är borta."],
  ["da", "Min værelseskammerat siger, at jeg skylder ham halvdelen af internetregningen, men vi har aldrig aftalt, at jeg skulle betale, når jeg er væk."],
  ["nb", "Samboeren min sier at jeg skylder ham halvparten av internettregningen, men vi ble aldri enige om at jeg skulle betale når jeg er borte."],
  ["fi", "Kämppäni sanoo, että olen hänelle velkaa puolet netin laskusta, mutta emme koskaan sopineet, että maksaisin silloin kun olen poissa."],
  ["pl", "Mój współlokator twierdzi, że jestem mu winien połowę rachunku za internet, ale nigdy nie ustaliliśmy, że będę płacić, kiedy mnie nie ma."],
  ["cs", "Můj spolubydlící tvrdí, že mu dlužím polovinu účtu za internet, ale nikdy jsme se nedohodli, že budu platit, když jsem pryč."],
  ["sk", "Môj spolubývajúci tvrdí, že mu dlžím polovicu účtu za internet, ale nikdy sme sa nedohodli, že budem platiť, keď som preč."],
  ["hr", "Moj cimer kaže da mu dugujem pola računa za internet, ali nikad nismo dogovorili da ću plaćati kad sam odsutan, što je jasno."],
  ["sl", "Moj cimer pravi, da mu dolgujem polovico računa za internet, ampak se nikoli nisva dogovorila, da bom plačeval, ko me ni doma."],
  ["ro", "Colegul meu de apartament spune că îi datorez jumătate din factura de internet, dar nu am stabilit niciodată că voi plăti când sunt plecat."],
  ["hu", "A lakótársam azt mondja, hogy tartozom neki az internetszámla felével, de soha nem egyeztünk meg abban, hogy fizetek, amikor nem vagyok itthon."],
  ["id", "Teman sekamar saya bilang saya harus membayar separuh tagihan internet, tetapi kami tidak pernah sepakat bahwa saya akan membayar saat saya pergi."],
  ["ms", "Rakan serumah saya kata saya perlu bayar separuh bil internet, tetapi kami tidak pernah bersetuju bahawa saya akan membayar apabila saya tiada."],
  ["ca", "El meu company de pis diu que li dec la meitat de la factura d'internet, però mai vam quedar que jo pagaria quan sóc fora de casa."],
  ["vi", "Bạn cùng phòng của tôi nói tôi nợ anh ấy một nửa hóa đơn internet, nhưng chúng tôi chưa bao giờ thống nhất là tôi sẽ trả khi tôi đi vắng."],
];

const OTHER: [Lang, string][] = [
  ["ar", "يقول زميلي في السكن إنني مدين له بنصف فاتورة الإنترنت، لكننا لم نتفق أبدا على أن أدفع عندما أكون مسافرا."],
  ["ur", "میرا روم میٹ کہتا ہے کہ مجھے انٹرنیٹ کے بل کا آدھا دینا ہے، لیکن ہم نے کبھی یہ طے نہیں کیا تھا کہ میں غیر موجودگی میں بھی دوں گا۔"],
  ["he", "השותף שלי לדירה אומר שאני חייב לו חצי מחשבון האינטרנט, אבל אף פעם לא הסכמנו שאשלם כשאני לא בבית."],
  ["el", "Ο συγκάτοικός μου λέει ότι του χρωστάω το μισό του λογαριασμού του ίντερνετ, αλλά ποτέ δεν συμφωνήσαμε να πληρώνω όταν λείπω."],
  ["ru", "Мой сосед говорит, что я должен ему половину счёта за интернет, но мы никогда не договаривались, что я буду платить, когда меня нет."],
  ["uk", "Мій сусід каже, що я винен йому половину рахунку за інтернет, але ми ніколи не домовлялися, що я платитиму, коли мене немає."],
  ["hi", "मेरा रूममेट कहता है कि मुझे इंटरनेट बिल का आधा देना है, लेकिन हमने कभी यह तय नहीं किया था कि मैं बाहर रहने पर भी पैसे दूँगा।"],
  ["mr", "माझा रूममेट म्हणतो की मला इंटरनेट बिलाचे निम्मे द्यावे लागेल, पण मी बाहेर असताना मी पैसे देईन असे आम्ही कधीच ठरवले नाही आणि तो ऐकत नाही."],
  ["bn", "আমার রুমমেট বলছে ইন্টারনেট বিলের অর্ধেক আমাকে দিতে হবে, কিন্তু আমরা কখনো ঠিক করিনি যে আমি বাইরে থাকলেও দেব।"],
  ["gu", "મારો રૂમમેટ કહે છે કે મારે ઇન્ટરનેટ બિલનો અડધો ભાગ આપવો પડશે, પણ અમે ક્યારેય નક્કી કર્યું નહોતું."],
  ["pa", "ਮੇਰਾ ਰੂਮਮੇਟ ਕਹਿੰਦਾ ਹੈ ਕਿ ਮੈਨੂੰ ਇੰਟਰਨੈੱਟ ਬਿੱਲ ਦਾ ਅੱਧਾ ਦੇਣਾ ਪਵੇਗਾ, ਪਰ ਅਸੀਂ ਕਦੇ ਇਹ ਤੈਅ ਨਹੀਂ ਕੀਤਾ ਸੀ।"],
  ["or", "ମୋ ରୁମମେଟ କହୁଛି ମୋତେ ଇଣ୍ଟରନେଟ ବିଲର ଅଧା ଦେବାକୁ ପଡିବ, କିନ୍ତୁ ଆମେ କେବେ ଏହା ଠିକ୍ କରିନଥିଲୁ।"],
  ["ta", "என் அறைத்தோழன் இணையக் கட்டணத்தில் பாதியை நான் தர வேண்டும் என்கிறான், ஆனால் நாங்கள் அப்படி ஒப்புக்கொள்ளவே இல்லை."],
  ["te", "నా రూమ్‌మేట్ ఇంటర్నెట్ బిల్లులో సగం నేను ఇవ్వాలని అంటున్నాడు, కానీ మేము ఎప్పుడూ అలా ఒప్పుకోలేదు."],
  ["kn", "ನನ್ನ ರೂಮ್‌ಮೇಟ್ ಇಂಟರ್ನೆಟ್ ಬಿಲ್‌ನ ಅರ್ಧ ನಾನು ಕೊಡಬೇಕು ಎನ್ನುತ್ತಾನೆ, ಆದರೆ ನಾವು ಎಂದೂ ಹಾಗೆ ಒಪ್ಪಿಕೊಂಡಿರಲಿಲ್ಲ."],
  ["ml", "എന്റെ റൂംമേറ്റ് പറയുന്നു ഇന്റർനെറ്റ് ബില്ലിന്റെ പകുതി ഞാൻ നൽകണമെന്ന്, പക്ഷേ ഞങ്ങൾ ഒരിക്കലും അങ്ങനെ സമ്മതിച്ചിട്ടില്ല."],
  ["th", "เพื่อนร่วมห้องบอกว่าฉันต้องจ่ายค่าอินเทอร์เน็ตครึ่งหนึ่ง แต่เราไม่เคยตกลงกันว่าฉันจะจ่ายตอนที่ไม่อยู่"],
  ["ja", "ルームメイトはインターネット料金の半分を私が払うべきだと言いますが、留守の間も払うとは一度も決めていません。"],
  ["ko", "룸메이트는 제가 인터넷 요금의 절반을 내야 한다고 하지만, 제가 집에 없을 때도 내기로 정한 적은 없습니다."],
  ["zh-Hans", "我的室友说我要付一半的网费，但是我们从来没有说好我不在家的时候也要付钱。"],
  ["zh-Hant", "我的室友說我要付一半的網路費，但是我們從來沒有說好我不在家的時候也要付錢。"],
];

describe("detectLang", () => {
  it.each(LATIN)("recognizes %s", (lang, text) => {
    expect(detectLang(text)).toBe(lang);
  });

  it.each(OTHER)("recognizes %s", (lang, text) => {
    expect(detectLang(text)).toBe(lang);
  });

  it("reads typed-without-accents Turkish", () => {
    expect(detectLang("Arkadasim bana borcu oldugunu soyluyor ama ben ona hicbir sey borclu degilim, cunku bunu konusmadik.")).toBe("tr");
  });

  it("tells English from the app language even with names and numbers in it", () => {
    expect(detectLang("Dave and I split a $240 camping trip, and he says that I should pay 60 percent because I ate more.")).toBe("en");
  });

  it("is null for text too short to tell", () => {
    expect(detectLang("")).toBeNull();
    expect(detectLang("Hi")).toBeNull();
    expect(detectLang("ok tamam")).toBeNull();
    expect(detectLang("12345 67890 !!!")).toBeNull();
  });

  it("is null for a mix of two languages", () => {
    const mixed = "My roommate says I owe him half of the bill and I told him that we never agreed on it. Mi compañero dice que le debo la mitad de la factura, pero nunca acordamos eso cuando yo estaba fuera.";
    expect(detectLang(mixed)).toBeNull();
    expect(detectLang("هذا هو الخلاف الذي بيننا and this is the dispute between us over the money")).toBeNull();
  });

  it("follows the majority when a language only quotes a few words of another", () => {
    const text =
      "Ev arkadaşım internet faturasının yarısını bana ödetmek istiyor ama ben evde olmadığım zamanlar için ödemeyeceğimizi konuşmuştuk. Ona 'we never agreed on that' dedim.";
    expect(detectLang(text)).toBe("tr");
  });

  it("is null for a language Judge does not write in", () => {
    // Persian, Bulgarian, Swahili, Afrikaans-like Latin text and Armenian.
    expect(detectLang("هم‌اتاقی من می‌گوید که باید نصف قبض اینترنت را بپردازم، اما ما هرگز چنین توافقی نکرده‌ایم.")).toBeNull();
    expect(detectLang("Съквартирантът ми твърди, че му дължа половината от сметката за интернет, но никога не сме се уговаряли за това.")).toBeNull();
    expect(detectLang("Mwenzangu wa chumba anasema ninadaiwa nusu ya bili ya intaneti, lakini hatukukubaliana hivyo kamwe.")).toBeNull();
    expect(detectLang("Իմ սենյակակիցն ասում է, որ ես պետք է վճարեմ ինտերնետի հաշվի կեսը, բայց մենք երբեք չենք համաձայնել։")).toBeNull();
  });

  it("settles Portuguese and Chinese variants by the app language only when the text cannot", () => {
    const pt = "Meu amigo disse que eu devo dinheiro para ele porque ele pagou o jantar, mas nós combinamos que cada um pagaria o seu.";
    expect(detectLang(pt, "pt-PT")).toBe("pt-PT");
    expect(detectLang(pt, "en")).toBe("pt-BR");
    expect(detectLang("我和朋友吃饭的时候，他说是我请客，可是我记得我们是各付各的。", "zh-Hant")).toBe("zh-Hans");
    expect(detectLang("我跟朋友一起吃飯，他說是我請客，可是我記得我們各付各的。", "zh-Hans")).toBe("zh-Hant");
    expect(detectLang("我和他是好朋友，明天一起去公園玩。", "zh-Hant")).toBe("zh-Hant");
    expect(detectLang("我和他是好朋友，明天一起去公園玩。", "en")).toBe("zh-Hans");
    expect(detectLang("我和他一起去吃饭了呢", "zh-Hant")).toBe("zh-Hans");
  });
});

describe("answerLang", () => {
  it("answers in the language of the text, not the app", () => {
    expect(answerLang(LATIN[0][1], "tr")).toBe("en");
    expect(answerLang(LATIN[1][1], "en")).toBe("tr");
    expect(answerLang(OTHER[0][1], "de")).toBe("ar");
  });

  it("falls back to the app language when the text cannot be placed", () => {
    expect(answerLang("Hi", "tr")).toBe("tr");
    expect(answerLang("Съквартирантът ми твърди, че му дължа половината от сметката за интернет.", "es")).toBe("es");
  });
});
