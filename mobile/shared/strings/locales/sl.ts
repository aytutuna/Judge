import type { AppLocale } from "../app-strings";

// Informal "ti", no gendered past tense for the reader, as on the web.
const sl: AppLocale = {
  strings: {
    "app.name": "Judge",
    "app.tab.new": "Novo",
    "app.tab.settings": "Nastavitve",
    "app.input.counter": "{count} / {max}",
    "app.history.empty":
      "Razsodb še ni. Ko razčistiš prvi prepir, se razsodba prikaže tukaj.",
    "app.history.deviceOnly":
      "Shranjeno samo na tem telefonu. Če razsodbo izbrišeš tukaj, njena povezava za deljenje še vedno deluje.",
    "app.history.delete": "Izbriši",
    "app.history.select": "Izberi",
    "app.history.selectAll": "Izberi vse",
    "app.history.deselectAll": "Odznači vse",
    "app.history.selected": "{n} izbranih",
    "app.history.deleteCount": "Izbriši ({count})",
    "app.history.deleteConfirm":
      "Želiš s tega telefona izbrisati {n} razsodb? Njihove povezave za deljenje še vedno delujejo.",
    "app.history.rowSelected": "Izbrano",
    "app.history.rowNotSelected": "Ni izbrano",
    "app.pricing.free.account": "Prijavi se z Apple, Googlom ali e-pošto",
    "app.pricing.headline": "Prva razsodba gre na naš račun.",
    "app.pricing.sub":
      "Ustvari račun in prva razsodba je brezplačna, z vsemi funkcijami. Potem izberi paket ali mesečno naročnino.",
    "app.pricing.headlineMember": "Več razsodb.",
    "app.pricing.subMember":
      "Izberi paket ali mesečno naročnino. Pri vsaki razsodbi sodelujejo vsi sodniki.",
    "app.balance.left": "Na voljo še {n} razsodb",
    "app.balance.monthly": "Ta mesec na voljo še {left} od {cap}",
    "app.balance.none": "Nimaš več razsodb",
    "app.balance.caseCost": "Pošiljanje povezave porabi 1 razsodbo",
    "app.cancel": "Prekliči",
    "app.retry": "Poskusi znova",
    "app.error.offline":
      "Kaže, da ni povezave s spletom. Preveri povezavo in poskusi znova.",
    "app.error.timeout":
      "Sodniki so za odgovor potrebovali preveč časa. Poskusi znova čez minuto.",
    "app.error.interrupted":
      "Povezava se je prekinila, ko je bil Judge v ozadju. Poskusi znova in pusti aplikacijo odprto, dokler ne prispe razsodba.",
    "app.turnstile.error":
      "Preverjanja, da si človek, ni bilo mogoče naložiti. Preveri povezavo in poskusi znova.",
    "app.factcheck.sourceAria": "{title}, odpre spletno stran",
    "app.error.badOrigin":
      "Ta zahteva je prišla iz neznanega vira. Preveri, ali je aplikacija posodobljena, in poskusi znova.",
    "app.translate.offline":
      "Brez povezave ne moremo prevajati, zato je tu izvirnik.",
    "app.share.title": "Deli razsodbo",
    "app.settings.language": "Jezik",
    "app.settings.languageDevice": "Jezik telefona",
    "app.settings.about": "O aplikaciji Judge",
    "app.settings.version": "Različica {version}",
    "app.signin.required": "Prijavi se in dobi razsodbo.",
    "app.signin.or": "ali",
    "app.signin.codeRequest": "Pošlji mi kodo po e-pošti",
    "app.signin.codeSent": "Na {email} smo poslali kodo. Velja 10 minut.",
    "app.signin.codeLabel": "Vpiši 6-mestno kodo",
    "app.signin.codeSubmit": "Prijavi se",
    "app.signin.codeInvalid":
      "Ta koda ni pravilna. Preveri e-pošto in poskusi znova.",
    "app.signin.codeExpired": "Ta koda je potekla. Zahtevaj novo.",
    "app.signin.codeTooMany":
      "Preveč napačnih poskusov za to kodo. Zahtevaj novo.",
    "app.signin.codeResend": "Pošlji novo kodo",
    "app.signin.changeEmail": "Uporabi drug e-poštni naslov",
    "app.signin.rateLimited":
      "Preveč poskusov. Počakaj minuto in poskusi znova.",
    "app.signin.unavailable": "Prijava trenutno ni na voljo. Poskusi pozneje.",
    "app.account.deleteTitle": "Želiš izbrisati račun?",
    "app.account.deleteBody":
      "Izbrišejo se tvoji podatki za prijavo, krediti, naročnina in osebni podatki, povezave za deljenje pa prenehajo delovati. Besedilo razsodb ostane shranjeno brez tvojega imena, kot je pojasnjeno v politiki zasebnosti.",
    "app.account.deleteConfirm": "Izbriši račun",
    "app.account.deleted": "Tvoj račun je izbrisan.",
    "app.account.signOutConfirm": "Se želiš na tem telefonu odjaviti iz aplikacije Judge?",
    "app.account.signedOut": "Odjava je uspela.",
    "app.account.sessionExpired":
      "Seja je potekla. Za nadaljevanje se znova prijavi.",
    "app.close": "Zapri",
    "app.home.lead":
      "Napiši obe plati ali drugi osebi pošlji povezavo, da napiše svojo.",
    "app.home.leadSolo":
      "Napiši svojo plat, pa še plat druge osebe, če jo poznaš.",
    "app.home.yourSide": "Tvoja plat",
    "app.home.theirSide": "Druga plat",
    "app.home.yourName": "Tvoje ime",
    "app.home.theirName": "Ime druge osebe",
    "app.home.yourPlaceholder": "Kaj se je po tvoje zgodilo?",
    "app.home.theirPlaceholder":
      "Kaj pravi druga oseba? Napiši tako, kot bi povedala sama.",
    "app.home.yourSideLabel": "Tvoja plat v prepiru",
    "app.home.theirSideLabel": "Plat druge osebe v prepiru",
    "app.home.sendLink": "Ali pa drugi osebi pošlji povezavo, da svojo plat napiše sama",
    "app.home.says": "{name} pravi:",
    "app.home.mySide": "Moja plat:",
    "app.home.otherSide": "Plat druge osebe:",
    "app.home.example": "Poskusi s primerom",
    "app.example.dishwasher.aName": "Ana",
    "app.example.dishwasher.a":
      "Sklede si spet zložil v zgornjo košaro. Tam se nikoli ne pomijejo do konca, za to je spodnja.",
    "app.example.dishwasher.bName": "Matic",
    "app.example.dishwasher.b":
      "Zgoraj čisto lepo gredo, spodaj pa ostane prostor za lonce. Pomivalni stroj tako polnim že leta in še nikoli ni nič ostalo umazano.",
    "app.example.bill.aName": "Petra",
    "app.example.bill.a":
      "Nisem nič pila, zato ne bi smela plačati četrtine vina. Hrano pa lahko razdelimo na enake dele, s tem se strinjam.",
    "app.example.bill.bName": "Jure",
    "app.example.bill.b":
      "Vedno vse razdelimo na štiri. Vsakič računati, kdo je kaj imel, je muka, razlika pa tako ali tako ni velika.",
    "app.example.thermostat.aName": "Nina",
    "app.example.thermostat.a":
      "Tukaj je 19 stopinj in me zebe celo v puloverju s kapuco. Gretje naviti na 22 res ni nič pretiranega.",
    "app.example.thermostat.bName": "Gašper",
    "app.example.thermostat.b":
      "Pri 22 stopinjah se ne da spati, prevroče je. Ti lahko oblečeš še eno plast, jaz pa ne morem sleči ničesar več.",
    "app.example.roadTrip.aName": "Tina",
    "app.example.roadTrip.a":
      "Celih šest ur tja sem vozila jaz. Pošteno je, da nazaj voziš ti.",
    "app.example.roadTrip.bName": "Rok",
    "app.example.roadTrip.b":
      "Že pred odhodom sem rekel, da ponoči ne maram voziti, odhajamo pa ob sedmih zvečer. Na naslednjem izletu bom zjutraj vozil jaz.",
    "app.example.seat.aName": "Sara",
    "app.example.seat.a":
      "Moj sedež se da nagniti, zato ga nagnem. Nočni let je, vsi poskušajo spati.",
    "app.example.seat.bName": "Blaž",
    "app.example.seat.b":
      "Visok sem 1,91 m in s koleni že tako tiščim v tvoj sedež. Lahko bi vsaj vprašala, preden ga spustiš čisto nazaj.",
    "app.example.spoiler.aName": "Maja",
    "app.example.spoiler.a":
      "Povedal si mi, kdo je morilec, še preden sem sploh začela zadnjo epizodo. Ves teden sem čakala nanjo.",
    "app.example.spoiler.bName": "Jan",
    "app.example.spoiler.b":
      "Serija je izšla pred tremi tedni, ti pa si rekla, da si jo že pogledala do konca. Ne morem si zapomniti, do kod je kdo prišel.",
    "app.example.jacket.aName": "Matej",
    "app.example.jacket.a":
      "Mojo jeans jakno si oblekla na koncert, ne da bi me vprašala. Vrnila si jo vso smrdečo po dimu.",
    "app.example.jacket.bName": "Eva",
    "app.example.jacket.b":
      "Visela je pri vratih, ti pa je nikoli ne nosiš. Vprašala bi te, ampak si spal, jaz pa sem že tako zamujala.",
    "app.example.lastSlice.aName": "Nejc",
    "app.example.lastSlice.a":
      "Še pred filmom sem rekel: „Zadnji kos je moj.“ Vsi so slišali.",
    "app.example.lastSlice.bName": "Lara",
    "app.example.lastSlice.b":
      "Ne moreš si rezervirati kosa in se ga potem dve uri ne dotakniti. Kar ležal je tam in se hladil, zato sem ga pojedla.",
    "app.case.waitingKicker": "Spor · čaka",
    "app.case.waitingFor": "Čakamo na odgovor: {name}",
    "app.case.waitingLead":
      "{name} svojo plat napiše brez računa. Do razsodbe nihče od vaju ne vidi besedila drugega.",
    "app.case.waitingLeadAnon":
      "Druga oseba svojo plat napiše brez računa. Do razsodbe nihče od vaju ne vidi besedila drugega.",
    "app.case.sendTo": "Pošlji to povezavo osebi {name}",
    "app.case.stepYou": "Tvoja plat je napisana",
    "app.case.stepYouNote": "Zapečatena do razsodbe",
    "app.case.stepThem": "{name} napiše svojo plat",
    "app.case.stepThemAnon": "Druga oseba napiše svojo plat",
    "app.case.stepThemNote": "Ko prispe, se ta stran posodobi",
    "app.case.stepJudges": "Trije sodniki razsodijo",
    "app.case.stepJudgesNote": "Ali pa takoj razsodi samo svojo plat",
    "app.case.judgeNowWithout": "Razsodi zdaj brez osebe {name}",
    "app.verdict.vs": "proti",
    "app.verdict.leanTo": "{name} ima pri sodnikih prednost",
    "app.verdict.leanNone": "Sodniki se niso nagnili na nobeno stran",
    "app.verdict.sides": "Na čem stoji vsaka plat",
    "app.verdict.claims": "Kako je vsaka plat prišla do sklepa",
    "app.verdict.back": "Razsodba",
    "app.appeal.title": "Dodaj kontekst za ponovno presojo",
    "app.appeal.intro":
      "So sodniki kaj spregledali? Dodaj to in znova bodo razsodili. Prva razsodba ostane zabeležena.",
    "app.appeal.ask": "Kaj bi morali vedeti?",
    "app.appeal.placeholder":
      "Dejstvo, sporočilo ali to, kar je bilo v resnici dogovorjeno.",
    "app.appeal.cost":
      "Porabi 1 razsodbo. Pri eni razsodbi lahko to narediš dvakrat – še na voljo: {left}.",
    "app.appeal.costCase":
      "Porabi 1 razsodbo. Pri enem sporu lahko to narediš enkrat.",
    "app.appeal.submit": "Znova razsodi",
    "app.appeal.upsell":
      "Kaj manjka? Dodaj kontekst in sodniki znova presodijo. Stane 1 razsodbo.",
    "app.appeal.signIn": "Prijavi se in dodaj kontekst",
    "app.appeal.used": "Pri tem sporu je tvoj kontekst že dodan.",
    "app.appeal.limit":
      "Kontekst je dodan že dvakrat. To je meja za eno razsodbo.",
    "app.purchase.buying": "Nakup poteka…",
    "app.purchase.success": "Hvala! Nakup je uspel.",
    "app.purchase.pending":
      "Nakup je v obdelavi. Lahko traja minuto, preden se prikaže.",
    "app.purchase.arriving": "Krediti so na poti…",
    "app.purchase.slow": "Lahko traja minuto, preden se prikaže tukaj.",
    "app.purchase.failed": "Nakup ni uspel. Poskusi znova čez trenutek.",
    "app.purchase.restore": "Obnovi nakupe",
    "app.purchase.restoreDone": "Nakupi so obnovljeni.",
    "app.purchase.restoreNone": "Ni nakupov za obnovitev.",
  },
  plurals: {
    "app.balance.left": {
      one: "Na voljo še {n} razsodba",
      two: "Na voljo še {n} razsodbi",
      few: "Na voljo še {n} razsodbe",
    },
    "app.history.selected": {
      one: "{n} izbrana",
      two: "{n} izbrani",
      few: "{n} izbrane",
    },
    "app.history.deleteConfirm": {
      one: "Želiš s tega telefona izbrisati {n} razsodbo? Njena povezava za deljenje še vedno deluje.",
      two: "Želiš s tega telefona izbrisati {n} razsodbi? Njuni povezavi za deljenje še vedno delujeta.",
      few: "Želiš s tega telefona izbrisati {n} razsodbe? Njihove povezave za deljenje še vedno delujejo.",
    },
  },
};

export default sl;
