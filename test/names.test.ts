import { describe, expect, it } from "vitest";
import {
  bareName,
  canonicalLabel,
  partyNames,
  personalizeResult,
  resolveParties,
  restoreNames,
  trSuffix,
  type Parties,
} from "../lib/names";
import type { NameMapping, VerdictResult } from "../lib/types";

const named = (a: string, b: string): Parties =>
  new Map([
    ["A", { name: a, self: false }],
    ["B", { name: b, self: false }],
  ]);
const narrator = (b: string, self = "Ben"): Parties =>
  new Map([
    ["A", { name: self, self: true }],
    ["B", { name: b, self: false }],
  ]);

describe("bareName", () => {
  it.each([
    ["Deniz'in", "Deniz"],
    ["Deniz’in", "Deniz"],
    ["Deniz'e", "Deniz"],
    ["Deniz'den", "Deniz"],
    ["Ayşe'nin", "Ayşe"],
    ["Ali'yi", "Ali"],
    ["Mark's", "Mark"],
    ["Mark’s", "Mark"],
    ["İrem'le", "İrem"],
    ["Ahmet Bey'e", "Ahmet Bey"],
    ["  Deniz  ", "Deniz"],
    ['"Deniz"', "Deniz"],
  ])("%s -> %s", (input, expected) => {
    expect(bareName(input)).toBe(expected);
  });

  it.each(["O'Brien", "D'angelo", "Deniz", "Jean-Luc"])("keeps %s whole", (name) => {
    expect(bareName(name)).toBe(name);
  });
});

describe("canonicalLabel", () => {
  it.each([
    ["Party A", "Party A"],
    ["party b", "Party B"],
    ["Taraf B", "Party B"],
    ["Taraf B'ye", "Party B"],
    ["Party A's", "Party A"],
    ["Person C", "Person C"],
    ["Kişi D", "Person D"],
  ])("%s -> %s", (input, expected) => {
    expect(canonicalLabel(input)).toBe(expected);
  });

  it.each(["the company", "Party C", "Person A", "their school"])("%s is not a person label", (input) => {
    expect(canonicalLabel(input)).toBeNull();
  });
});

describe("trSuffix (vowel harmony, buffers, d/t)", () => {
  it.each([
    // name, case, suffix
    ["Deniz", "gen", "in"],
    ["Deniz", "acc", "i"],
    ["Deniz", "dat", "e"],
    ["Deniz", "loc", "de"],
    ["Deniz", "abl", "den"],
    ["Deniz", "ins", "le"],
    ["Deniz", "genki", "inki"],
    ["Deniz", "locki", "deki"],
    ["Ayşe", "gen", "nin"],
    ["Ayşe", "acc", "yi"],
    ["Ayşe", "dat", "ye"],
    ["Ayşe", "loc", "de"],
    ["Ayşe", "ins", "yle"],
    ["Ali", "gen", "nin"],
    ["Ali", "dat", "ye"],
    ["Burak", "gen", "ın"],
    ["Burak", "dat", "a"],
    ["Burak", "loc", "ta"],
    ["Burak", "abl", "tan"],
    ["Ahmet", "loc", "te"],
    ["Ahmet", "abl", "ten"],
    ["Ahmet", "past", "ti"],
    ["Umut", "gen", "un"],
    ["Umut", "acc", "u"],
    ["Umut", "dat", "a"],
    ["Gül", "gen", "ün"],
    ["Gül", "acc", "ü"],
    ["Gül", "dat", "e"],
    ["Örsün", "gen", "ün"],
    ["Oya", "gen", "nın"],
    ["Oya", "acc", "yı"],
    ["Oya", "dat", "ya"],
    ["Mert", "loc", "te"],
    ["Kemal", "gen", "in"],
    ["Kemal", "dat", "e"],
    ["İrem", "gen", "in"],
    ["Irmak", "gen", "ın"],
    ["Selin", "ins", "le"],
    ["Ayşe", "past", "ydi"],
    ["Mark", "gen", "ın"],
    ["Mark", "loc", "ta"],
  ] as const)("%s + %s -> %s", (name, c, suffix) => {
    expect(trSuffix(name, c)).toBe(suffix);
  });

  it("gives up on a name with no vowel", () => {
    expect(trSuffix("JJ", "gen")).toBeNull();
  });
});

describe("restoreNames: Turkish, named parties", () => {
  const p = named("Mert", "Deniz");

  it.each([
    ["Taraf B haklı.", "Deniz haklı."],
    ["Taraf B'nin itirazı yerinde.", "Deniz'in itirazı yerinde."],
    ["Taraf B’nin itirazı yerinde.", "Deniz’in itirazı yerinde."],
    ["Taraf A, Taraf B'yi suçluyor.", "Mert, Deniz'i suçluyor."],
    ["Taraf A, Taraf B'ye söz verdi.", "Mert, Deniz'e söz verdi."],
    ["Fikir Taraf B'den çıktı.", "Fikir Deniz'den çıktı."],
    ["Karar Taraf B'de.", "Karar Deniz'de."],
    ["Taraf B'yle konuştu.", "Deniz'le konuştu."],
    ["Taraf B'nınki daha güçlü.", "Deniz'inki daha güçlü."],
    ["Taraf B'deki sorun", "Deniz'deki sorun"],
    ["Taraf A'nın planı ve Taraf B'nin tepkisi", "Mert'in planı ve Deniz'in tepkisi"],
    ["Taraf A'da kalan para", "Mert'te kalan para"],
    ["Taraf A'dan özür bekleniyor.", "Mert'ten özür bekleniyor."],
    ["Taraf A ile Taraf B", "Mert ile Deniz"],
    ["Asıl soru Taraf A'nın sözü.", "Asıl soru Mert'in sözü."],
  ])("%s -> %s", (input, expected) => {
    expect(restoreNames(input, p, "tr")).toBe(expected);
  });

  it("harmonises for names ending in a vowel", () => {
    const vowel = named("Ayşe", "Oya");
    expect(restoreNames("Taraf A'nın sözü, Taraf B'ye karşı.", vowel, "tr")).toBe("Ayşe'nin sözü, Oya'ya karşı.");
    expect(restoreNames("Taraf B'yi ikna etmedi; Taraf A'yla tartıştı.", vowel, "tr")).toBe(
      "Oya'yı ikna etmedi; Ayşe'yle tartıştı.",
    );
  });

  it("harmonises rounded and back vowels", () => {
    const rounded = named("Umut", "Gül");
    expect(restoreNames("Taraf A'nın Taraf B'ye borcu", rounded, "tr")).toBe("Umut'un Gül'e borcu");
    expect(restoreNames("Taraf B'nin Taraf A'yı", rounded, "tr")).toBe("Gül'ün Umut'u");
  });

  it('restores a name that is also a common word ("Deniz")', () => {
    expect(restoreNames("Taraf B denize girmek istedi.", named("Mert", "Deniz"), "tr")).toBe(
      "Deniz denize girmek istedi.",
    );
  });

  it("restores English labels and the Kişi/Person placeholders in Turkish text", () => {
    const p2: Parties = new Map([
      ["A", { name: "Mert", self: false }],
      ["B", { name: "Deniz", self: false }],
      ["C", { name: "Selin", self: false }],
    ]);
    expect(restoreNames("Party B'ye göre Person C'nin evi", p2, "tr")).toBe("Deniz'e göre Selin'in evi");
    expect(restoreNames("Kişi C'ye sordu", p2, "tr")).toBe("Selin'e sordu");
  });

  it("keeps a label it cannot inflect safely", () => {
    expect(restoreNames("Taraf B'nin", named("Mert", "JJ"), "tr")).toBe("Taraf B'nin");
    expect(restoreNames("Taraf B'lerin", named("Mert", "Deniz"), "tr")).toBe("Taraf B'lerin");
  });

  it("leaves labels without a mapping alone", () => {
    const onlyB: Parties = new Map([["B", { name: "Deniz", self: false }]]);
    expect(restoreNames("Taraf A, Taraf B'ye kızdı.", onlyB, "tr")).toBe("Taraf A, Deniz'e kızdı.");
  });

  it("does not touch words that merely contain a label", () => {
    expect(restoreNames("Taraftar Ayakta", named("Mert", "Deniz"), "tr")).toBe("Taraftar Ayakta");
    expect(restoreNames("Taraf AB", named("Mert", "Deniz"), "tr")).toBe("Taraf AB");
  });
});

describe("restoreNames: Turkish narrator (sen)", () => {
  const p = narrator("Deniz");

  it.each([
    ["Taraf B, Taraf A'ya yalan söyledi.", "Deniz, sana yalan söyledi."],
    ["Taraf B, Taraf A'yı suçluyor.", "Deniz, seni suçluyor."],
    ["Taraf B, Taraf A’dan özür bekliyor.", "Deniz, senden özür bekliyor."],
    ["Anahtar Taraf A'da kaldı.", "Anahtar sende kaldı."],
    ["Not Taraf A'daki defterde.", "Not sendeki defterde."],
    ["Taraf B, Taraf A'yla konuşmadı.", "Deniz, seninle konuşmadı."],
    ["Taraf A'nınki daha mantıklı.", "Seninki daha mantıklı."],
    ["Taraf A'ya göre durum açık.", "Sana göre durum açık."],
    ["Taraf A haklı.", "Sen haklısın."],
    ["Taraf A daha haklı: çay hazır değildi.", "Sen daha haklısın: çay hazır değildi."],
    ["Taraf A haksız.", "Sen haksızsın."],
    ["Taraf A haklıydı.", "Sen haklıydın."],
    ["Bu konuda Taraf A için zor bir durum var.", "Bu konuda senin için zor bir durum var."],
    ["Taraf A ile Taraf B anlaşamadı.", "Seninle Deniz anlaşamadı."],
    ["Taraf A açısından bakınca", "Senin açından bakınca"],
    ["Taraf A'nın istediği şey", "Senin istediğin şey"],
    ["Taraf A'nın olduğu yer", "Senin olduğun yer"],
    ["Taraf A'nın çocuğu geldi.", "Senin çocuğun geldi."],
    ["Taraf A'nın gelmesi gerekiyordu.", "Senin gelmen gerekiyordu."],
    ["Taraf A'nın gelmemesi sorun oldu.", "Senin gelmemen sorun oldu."],
    ["Taraf A'nın yapmasına izin verdi.", "Senin yapmana izin verdi."],
    ["Taraf A'nın kalmasını istedi.", "Senin kalmanı istedi."],
    ["Taraf A'nın gelmesinden sonra", "Senin gelmenden sonra"],
    ["Taraf A'nın gelmesiyle başladı.", "Senin gelmenle başladı."],
  ])("%s -> %s", (input, expected) => {
    expect(restoreNames(input, p, "tr")).toBe(expected);
  });

  it.each([
    // The word after "Taraf A'nın" is not the possessed noun, or its
    // second-person form depends on a stem that cannot be told apart.
    "Taraf A'nın bunu yapması gerekirdi.", // not "Senin bunu yapması"
    "Taraf A'nın buna itirazı yok.", // not "Senin buna itirazı"
    "Taraf A'nın sorunu şu: çay soğuk.", // not "Senin sorunu" (sorunun)
    "Taraf A'nın düğünü yarın.", // not "Senin düğünü" (düğünün)
    "Taraf A'nın düğününe gitmedi.",
    "Taraf A'nın sonunda haklı çıkması şaşırtmadı.", // not "Senin sonunda ... çıkması"
    "Taraf A'nın başkasını suçlaması yanlış.", // not "başkanı"
    "Taraf A'nın başkası", // not "başkan"
    "Taraf A'nın otobüsü geç kaldı.", // s stem: "otobüsün", not "otobün"
    "Taraf A'nın hevesi kaçtı.", // "hevesin", not "heven"
    "Taraf A'nın çoğu iddiası doğru.", // quantifier, not "çoğun"
    "Taraf A'nın arabası bozuldu.", // vowel stem, but indistinguishable from an s stem
    "Taraf A'nın arabasına bindi.",
    "Taraf A'nın evinde buluştular.",
    "Taraf A'nın dediğine göre",
    "Taraf A'nın sözüyle",
    "Taraf A'nın kapıyla ilgili sorunu", // "kapı-yla", not a possessive
    "Taraf A'nın sesine kulak verdi",
    "Taraf A'nın elması",
    "Taraf A'nın teması",
  ])("keeps the narrator label in the genitive when unsure: %s", (input) => {
    expect(restoreNames(input, p, "tr")).toBe(input);
  });

  it.each([
    // Verb agreement would change: leave the label.
    "Taraf A çayı demlemeden bıraktı.",
    "Taraf A haklı çünkü söz vermişti.",
    "Taraf A ve Taraf B",
    // A bare consonant + vowel word may be an adjective: leave the label.
    "Taraf A'nın planı işe yaramadı.",
    "Taraf A'nın haklı olduğu açık.",
    "Taraf A'nın.",
    "Taraf A'dır.",
  ])("keeps the narrator label where Turkish would break: %s", (input) => {
    const out = restoreNames(input, p, "tr");
    expect(out).toContain("Taraf A");
    expect(out).not.toMatch(/\bsen\b|\bSen\b/);
  });

  it("still restores the other party in a sentence where the narrator label stays", () => {
    expect(restoreNames("Taraf A, Taraf B'nin sözüne güvendi.", p, "tr")).toBe("Taraf A, Deniz'in sözüne güvendi.");
  });

  it("capitalises only at the start of a sentence", () => {
    expect(restoreNames("Taraf A'ya göre evet. Taraf A'ya göre hayır.", p, "tr")).toBe(
      "Sana göre evet. Sana göre hayır.",
    );
    expect(restoreNames("Bence Taraf A'ya göre", p, "tr")).toBe("Bence sana göre");
  });
});

describe("restoreNames: English", () => {
  it.each([
    ["Party B is right.", "Deniz is right."],
    ["Party B's point holds.", "Deniz's point holds."],
    ["Party B’s point holds.", "Deniz’s point holds."],
    ["Party A promised Party B a lift.", "Mert promised Deniz a lift."],
    ["Both Party A and Party B agree.", "Both Mert and Deniz agree."],
    ["Party C's car", "Party C's car"],
  ])("named: %s -> %s", (input, expected) => {
    expect(restoreNames(input, named("Mert", "Deniz"), "en")).toBe(expected);
  });

  it("restores a name ending in s with 's", () => {
    expect(restoreNames("Party B's plan", named("Mert", "Chris"), "en")).toBe("Chris's plan");
  });

  const p = narrator("Deniz", "I");
  it.each([
    ["Party A is right.", "You are right."],
    ["Party A was late.", "You were late."],
    ["Party A has a point.", "You have a point."],
    ["Party A isn't wrong.", "You aren't wrong."],
    ["Party A doesn't owe anything.", "You don't owe anything."],
    ["Party A wasn't there.", "You weren't there."],
    ["Party A hasn't paid.", "You haven't paid."],
    ["Party A wins the tea debate.", "You win the tea debate."],
    ["Party A tries hard.", "You try hard."],
    ["Party A misses the point.", "You miss the point."],
    ["Party A focuses on the rule.", "You focus on the rule."],
    ["Party A stopped there.", "You stopped there."],
    ["Party A can't prove it.", "You can't prove it."],
    ["Party A's promise counted.", "Your promise counted."],
    ["It hinges on Party A's promise.", "It hinges on your promise."],
    ["March and April were Party A's.", "March and April were yours."],
    ["The bike was Party A's, not Party B's.", "The bike was yours, not Deniz's."],
    ["Party B's turn and Party A's are both in March.", "Deniz's turn and yours are both in March."],
    ["The call is Party A's and nobody else's.", "The call is yours and nobody else's."],
    ["The blame is Party A's", "The blame is yours"],
    ["Party B owes Party A an apology.", "Deniz owes you an apology."],
    ["Party B gives Party A lots of credit.", "Deniz gives you lots of credit."],
    ["What matters to Party A is fairness.", "What matters to you is fairness."],
    ["Party B thinks Party A is wrong.", "Deniz thinks you are wrong."],
    ["Deniz is right, but Party A wants more.", "Deniz is right, but you want more."],
    ["The thing Party A wants is respect.", "The thing you want is respect."],
    ["Party B is more patient than Party A is.", "Deniz is more patient than you are."],
    ["Fine. Party A agrees.", "Fine. You agree."],
    ["“Party A is right”", "“You are right”"],
    ["Party A won't budge.", "You won't budge."],
    ["Party A will pay.", "You will pay."],
    ["Deniz blames Party A.", "Deniz blames you."],
    ["Party A and Party B both want tea.", "You and Deniz both want tea."],
    ["Deniz and Party A are both wrong.", "Deniz and you are both wrong."],
  ])("narrator: %s -> %s", (input, expected) => {
    expect(restoreNames(input, p, "en")).toBe(expected);
  });

  it.each([
    // Only the word IMMEDIATELY after the label is trusted; anything else
    // keeps the label rather than risk "you is" / "you pays".
    "Party A, however, is right.",
    "Party A, who is right, left.",
    "Party A, not Jake, pays.",
    "Party A alone pays.",
    "Party A nonetheless pays.",
    "Party A always says yes.",
    "Party A was and is right.",
    "Party A himself admitted it.",
    "Party A themselves admitted it.",
    "Party A herself admitted it.",
    "Deniz gives Party A points.",
    "Deniz blames Party A, not the weather.",
  ])("keeps the English narrator label when the sentence shape is unsure: %s", (input) => {
    expect(restoreNames(input, p, "en")).toBe(input);
  });

  it("drops a Turkish suffix left in English text", () => {
    expect(restoreNames("Party B'nin plan", named("Mert", "Deniz"), "en")).toBe("Deniz's plan");
    expect(restoreNames("Taraf B'ye", named("Mert", "Deniz"), "en")).toBe("Deniz");
  });
});

describe("resolveParties / partyNames", () => {
  it("strips suffixes from originals and accepts label variants", () => {
    const map: NameMapping[] = [
      { original: "Deniz'in", replacement: "Party B" },
      { original: "Ben", replacement: "Taraf A" },
    ];
    expect(partyNames(map, "tr")).toEqual({ nameA: "Sen", nameB: "Deniz", aIsSelf: true, bIsSelf: false });
  });

  it.each(["bence", "bana", "beni", "benim", "benden", "Bende", "kendim"])(
    'Turkish narrator form "%s" in slot A becomes Sen/You',
    (form) => {
      const map = [{ original: form, replacement: "Party A" }];
      expect(partyNames(map, "tr").nameA).toBe("Sen");
      expect(partyNames(map, "en", "tr").nameA).toBe("You");
    },
  );

  it("the narrator wins slot A over a name; the first name wins otherwise", () => {
    const parties = resolveParties(
      [
        { original: "Deniz", replacement: "Party B" },
        { original: "Den", replacement: "Party B" },
        { original: "Ben", replacement: "Party A" },
      ],
      "tr",
    );
    expect(parties.get("A")).toEqual({ name: "Ben", self: true });
    expect(parties.get("B")).toEqual({ name: "Deniz", self: false });
  });

  it("a capitalized name beats a lowercase description for the same slot", () => {
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "my roommate", replacement: "Party B" },
      { original: "Jake", replacement: "Party B" },
      { original: "Jacob", replacement: "Party B" },
    ];
    expect(partyNames(map, "en")).toEqual({ nameA: "You", nameB: "Jake", aIsSelf: true, bIsSelf: false });
  });

  it("ignores non-person replacements", () => {
    expect(resolveParties([{ original: "Acme", replacement: "the company" }], "en").size).toBe(0);
  });
});

const BASE: VerdictResult = {
  verdict: "side_b",
  dispute_type: "factual",
  headline: "Taraf B haklı: çay hazır değildi",
  crux: "Taraf A'nın çayı demlemeden servis etmesi yeterli mi?",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Taraf A'ya göre kaynayan su yeterli.", kind: "value" }],
    side_b: [{ claim: "Taraf B'ye göre demlenme şart.", kind: "fact" }],
    bedrock_a: "Hız",
    bedrock_b: "Taraf B'nin damak zevki",
  },
  facts_relied_on: ["Çay 5 dakika demlenir; Taraf B'nin dediği doğru."],
  losing_side_best_point: "Taraf A'nın acelesi anlaşılır.",
  confidence: 4,
  runs: ["side_b", "side_b", "side_b"],
  demo: false,
  lang: "tr",
  lean: { party: "b", unanimous: true, reason: "Taraf A'dan beklenen demlemekti." },
  fact_check: {
    status: "checked",
    claims: [{ claim: "Taraf B'nin iddiası", status: "supported", summary: "Taraf A'ya katılmıyor.", sources: [] }],
  },
};

describe("personalizeResult", () => {
  const map: NameMapping[] = [
    { original: "Ben", replacement: "Party A" },
    { original: "Deniz", replacement: "Party B" },
  ];

  it("restores names across every text field, display-only", () => {
    const frozen = structuredClone(BASE);
    const out = personalizeResult(BASE, map, "tr");
    expect(out.headline).toBe("Deniz haklı: çay hazır değildi");
    expect(out.crux).toBe("Taraf A'nın çayı demlemeden servis etmesi yeterli mi?");
    expect(out.argument_map.side_a[0].claim).toBe("Sana göre kaynayan su yeterli.");
    expect(out.argument_map.side_b[0].claim).toBe("Deniz'e göre demlenme şart.");
    expect(out.argument_map.bedrock_b).toBe("Deniz'in damak zevki");
    expect(out.facts_relied_on[0]).toBe("Çay 5 dakika demlenir; Deniz'in dediği doğru.");
    expect(out.lean?.reason).toBe("Senden beklenen demlemekti.");
    expect(out.fact_check?.claims[0].claim).toBe("Deniz'in iddiası");
    expect(out.fact_check?.claims[0].summary).toBe("Sana katılmıyor.");
    // The stored verdict object is untouched.
    expect(BASE).toEqual(frozen);
  });

  it("returns the same object without a name map (share pages)", () => {
    expect(personalizeResult(BASE, undefined, "tr")).toBe(BASE);
    expect(personalizeResult(BASE, [], "tr")).toBe(BASE);
  });

  it("follows the language the text is in after translation", () => {
    const en: VerdictResult = {
      ...BASE,
      lang: "en",
      headline: "Party B is right: the tea wasn't ready",
      losing_side_best_point: "Party A's hurry is understandable.",
      lean: { party: "b", unanimous: true, reason: "Party A stopped at boiling." },
    };
    const out = personalizeResult(en, map, "tr");
    expect(out.headline).toBe("Deniz is right: the tea wasn't ready");
    expect(out.losing_side_best_point).toBe("Your hurry is understandable.");
    expect(out.lean?.reason).toBe("You stopped at boiling.");
  });

  it("restores split points and conditional branches", () => {
    const r: VerdictResult = {
      ...BASE,
      verdict: "conditional",
      split_points: [{ party: "a", point: "Taraf A'nın zamanı kısıtlıydı." }],
      conditional: [{ if_value: "Taraf B'nin zevkine öncelik veriyorsan", then: "Taraf B haklı" }],
    };
    const out = personalizeResult(r, [{ original: "Mert", replacement: "Party A" }, ...map.slice(1)], "tr");
    expect(out.split_points?.[0].point).toBe("Mert'in zamanı kısıtlıydı.");
    expect(out.conditional?.[0]).toEqual({ if_value: "Deniz'in zevkine öncelik veriyorsan", then: "Deniz haklı" });
  });
});

describe("selfParty B: the respondent's own view of a two-sided case", () => {
  // The respondent's submission map: they narrate as Party B, and the person
  // who invited them is Party A.
  const map: NameMapping[] = [
    { original: "I", replacement: "Party B" },
    { original: "Aytu", replacement: "Party A" },
    { original: "Sarah", replacement: "Person C" },
  ];

  it("makes Party B the narrator and Party A a name", () => {
    expect(partyNames(map, "en", "en", "B")).toEqual({
      nameA: "Aytu",
      nameB: "You",
      aIsSelf: false,
      bIsSelf: true,
    });
    expect(partyNames(map, "tr", "tr", "B")).toEqual({
      nameA: "Aytu",
      nameB: "Sen",
      aIsSelf: false,
      bIsSelf: true,
    });
  });

  it("keeps the default (Party A) behavior unchanged for the same map", () => {
    const p = partyNames(map, "en");
    expect(p.bIsSelf).toBe(false);
    expect(p.aIsSelf).toBe(false);
    // "I" only ever means the narrator in the narrator's own slot.
    expect(p.nameB).toBe("I");
  });

  it("applies the pronoun slot guard to Party B only", () => {
    const parties = resolveParties(
      [
        { original: "Ben", replacement: "Party A" },
        { original: "ben", replacement: "Party B" },
      ],
      "tr",
      "B",
    );
    expect(parties.get("A")).toEqual({ name: "Ben", self: false });
    expect(parties.get("B")).toEqual({ name: "ben", self: true });
  });

  it("restores names in the two-sided fields and the appeal summary", () => {
    const result: VerdictResult = {
      verdict: "side_b",
      dispute_type: "factual",
      headline: "Party B paid the bill",
      crux: "Who paid in April.",
      split_points: null,
      conditional: null,
      argument_map: {
        side_a: [{ claim: "Party A says it was Party B's turn.", kind: "fact" }],
        side_b: [{ claim: "Party B says they paid.", kind: "fact" }],
        bedrock_a: "Turns.",
        bedrock_b: "Receipts.",
      },
      facts_relied_on: [],
      losing_side_best_point: "Party A kept the calendar.",
      confidence: 4,
      runs: ["side_b", "side_b", "side_b"],
      demo: false,
      lang: "en",
      two_sided: true,
      agreed_facts: ["Person C saw the bill."],
      disputed_facts: [
        { fact: "Who paid", party_a: "Party B did not pay", party_b: "Party B paid", finding: "b", decisive: true },
      ],
      would_change: ["A bank record from Party A"],
      appeal: {
        by: "a",
        outcome: "upheld",
        previous_id: "v1",
        previous_verdict: "side_b",
        previous_confidence: 4,
        confidence_change: 0,
        summary: "Party A's new context did not change it.",
      },
    };
    const out = personalizeResult(result, map, "en", "B");
    expect(out.agreed_facts).toEqual(["Sarah saw the bill."]);
    expect(out.disputed_facts?.[0].party_a).toBe("You did not pay");
    expect(out.disputed_facts?.[0].finding).toBe("b");
    expect(out.would_change).toEqual(["A bank record from Aytu"]);
    expect(out.appeal?.summary).toBe("Aytu's new context did not change it.");
    expect(out.headline).toBe("You paid the bill");
  });
});

describe("partyNames: a known viewer without names in this browser", () => {
  it("labels the viewer's party and flags it as self, only when asked and only when the map is silent", () => {
    expect(partyNames([], "en", "en", "A", true)).toEqual({
      nameA: "Party A (you)",
      nameB: "Party B",
      aIsSelf: true,
      bIsSelf: false,
    });
    expect(partyNames(undefined, "tr", "tr", "B", true)).toEqual({
      nameA: "Taraf A",
      nameB: "Taraf B (sen)",
      aIsSelf: false,
      bIsSelf: true,
    });
    // Share pages (no viewer) never get it.
    expect(partyNames([], "en")).toEqual({ nameA: "Party A", nameB: "Party B", aIsSelf: false, bIsSelf: false });
    // A map that names the party wins.
    const map: NameMapping[] = [
      { original: "I", replacement: "Party A" },
      { original: "Deniz", replacement: "Party B" },
    ];
    expect(partyNames(map, "en", "en", "A", true)).toEqual({ nameA: "You", nameB: "Deniz", aIsSelf: true, bIsSelf: false });
  });
});
