import type { AppLocale } from "../app-strings";

// Informal "du" throughout, as on the web.
const nb: AppLocale = {
  strings: {
    "app.name": "Judge",
    "app.tab.new": "Ny",
    "app.tab.settings": "Innstillinger",
    "app.input.counter": "{count} / {max}",
    "app.history.empty":
      "Ingen dommer ennå. Få avgjort den første diskusjonen din, så dukker den opp her.",
    "app.history.deviceOnly":
      "Lagres bare på denne telefonen. Sletter du en dom her, fjernes ikke delingslenken.",
    "app.history.delete": "Slett",
    "app.history.select": "Velg",
    "app.history.selectAll": "Velg alle",
    "app.history.deselectAll": "Fjern alle valg",
    "app.history.selected": "{n} valgt",
    "app.history.deleteCount": "Slett ({count})",
    "app.history.deleteConfirm":
      "Vil du slette {n} dommer fra denne telefonen? Delingslenkene virker fortsatt.",
    "app.history.rowSelected": "Valgt",
    "app.history.rowNotSelected": "Ikke valgt",
    "app.history.phoneOnly": "Bare på denne telefonen",
    "app.history.phoneOnlyNote":
      "Ikke i kontoen din: disse er bare lagret på denne telefonen. Sletter du en dom her, fjernes ikke delingslenken.",
    "app.history.removeConfirm":
      "Vil du fjerne {n} dommer fra kontoen din? Det du skrev og navnene slettes, og delingslenkene slutter å virke på alle enheter. Dette kan ikke angres.",
    "app.history.phoneOnlyAlso":
      "{n} dommer som bare er lagret på denne telefonen, slettes herfra. Delingslenkene virker fortsatt.",
    "app.history.removeFailed": "Vi fikk ikke fjernet {n} av dem. Sjekk tilkoblingen og prøv igjen.",
    "app.history.offlineRemove": "Du er ikke på nett. Du trenger nettforbindelse for å fjerne dommer.",
    "app.pricing.free.account": "Logg inn med Apple, Google eller e-post",
    "app.pricing.context": "Kontekstbilder blir lest og deretter kastet, uten ekstra kostnad",
    "app.pricing.headline": "Den første dommen spanderer vi.",
    "app.pricing.sub":
      "Opprett en konto, så er den første dommen gratis, med alle funksjoner. Etter det velger du en pakke eller går over til månedsabonnement.",
    "app.pricing.headlineMember": "Få flere dommer.",
    "app.pricing.subMember":
      "Velg en pakke eller et månedsabonnement. Hver dom får hele panelet.",
    "app.balance.left": "{n} dommer igjen",
    "app.balance.monthly": "{left} av {cap} igjen denne måneden",
    "app.balance.none": "Ingen dommer igjen",
    "app.cancel": "Avbryt",
    "app.retry": "Prøv igjen",
    "app.error.offline":
      "Det ser ut som du ikke er på nett. Sjekk tilkoblingen og prøv igjen.",
    "app.error.timeout":
      "Dommerne brukte for lang tid på å svare. Prøv igjen om et minutt.",
    "app.error.interrupted":
      "Tilkoblingen ble brutt mens Judge var i bakgrunnen. Prøv igjen, og hold appen åpen til dommen kommer.",
    "app.turnstile.error":
      "Menneskesjekken kunne ikke lastes. Sjekk tilkoblingen og prøv igjen.",
    "app.factcheck.sourceAria": "{title}, åpner nettsiden",
    "app.error.badOrigin":
      "Den forespørselen kom fra et sted vi ikke kjenner igjen. Sjekk at appen er oppdatert, og prøv igjen.",
    "app.translate.offline":
      "Vi kan ikke oversette uten nett, så her er originalen.",
    "app.share.title": "Del dommen",
    "app.settings.language": "Språk",
    "app.settings.languageDevice": "Samme som telefonen",
    "app.settings.appearance": "Utseende",
    "app.settings.appearanceSystem": "Samme som telefonen",
    "app.settings.appearanceLight": "Lyst",
    "app.settings.appearanceDark": "Mørkt",
    "app.settings.usageStats": "Bruksstatistikk",
    "app.settings.usageStatsHint":
      "Tellinger av hvilke skjermer og funksjoner som brukes, knyttet til kontoen din når du er logget inn. Tekst fra saker sendes aldri.",
    "app.settings.about": "Om Judge",
    "app.settings.version": "Versjon {version}",
    "app.signin.required": "Logg inn for å få en dom.",
    "app.signin.or": "eller",
    "app.signin.codeRequest": "Send meg en kode på e-post",
    "app.signin.codeSent":
      "Vi har sendt en kode til {email}. Den virker i 10 minutter.",
    "app.signin.codeLabel": "Skriv inn den 6-sifrede koden",
    "app.signin.codeSubmit": "Logg inn",
    "app.signin.codeInvalid":
      "Den koden stemmer ikke. Sjekk e-posten og prøv igjen.",
    "app.signin.codeExpired": "Den koden har utløpt. Be om en ny.",
    "app.signin.codeTooMany":
      "Du har skrevet feil kode for mange ganger. Be om en ny.",
    "app.signin.codeResend": "Send en ny kode",
    "app.signin.changeEmail": "Bruk en annen e-postadresse",
    "app.signin.rateLimited": "For mange forsøk. Vent et minutt og prøv igjen.",
    "app.signin.unavailable":
      "Innlogging er ikke tilgjengelig akkurat nå. Prøv igjen senere.",
    "app.account.deleteTitle": "Vil du slette kontoen din?",
    "app.account.deleteBody":
      "Innloggingsopplysningene, kredittene, abonnementet og personopplysningene dine slettes, og delingslenkene dine slutter å virke. Teksten i dommene beholdes uten navnet ditt, slik det står i personvernerklæringen.",
    "app.account.deleteConfirm": "Slett konto",
    "app.account.deleted": "Kontoen din er slettet.",
    "app.account.signOutConfirm":
      "Vil du logge ut av Judge på denne telefonen?",
    "app.account.signedOut": "Du er logget ut.",
    "app.account.sessionExpired":
      "Du har blitt logget ut. Logg inn igjen for å fortsette.",
    "app.close": "Lukk",
    "app.home.yourSide": "Din side",
    "app.home.theirSide": "Den andres side",
    "app.home.yourName": "Navnet ditt",
    "app.home.theirName": "Den andres navn",
    "app.home.yourPlaceholder": "Hva er problemet?",
    "app.home.theirPlaceholder":
      "Hva sier den andre? Skriv det med den andres ord.",
    "app.home.yourSideLabel": "Din side av diskusjonen",
    "app.home.theirSideLabel": "Den andres side av diskusjonen",
    "app.home.sendLink": "Send en lenke",
    "app.home.addContext": "Legg til kontekst",
    "app.home.says": "{name} sier:",
    "app.home.mySide": "Min side:",
    "app.home.otherSide": "Den andres side:",
    "app.home.example": "Prøv et eksempel",
    "app.home.addTheirSide": "Legg til den andres side",
    "app.home.removeTheirSide": "Fjern den andres side",
    "app.home.clear": "Tøm",
    "app.case.waitingKicker": "Sak · venter",
    "app.case.waitingFor": "Venter på {name}",
    "app.case.waitingLead":
      "{name} skriver sin side uten konto. Ingen av dere ser hva den andre har skrevet før dommen.",
    "app.case.waitingLeadAnon":
      "Den andre skriver sin side uten konto. Ingen av dere ser hva den andre har skrevet før dommen.",
    "app.case.sendTo": "Send denne lenken til {name}",
    "app.case.stepYou": "Du har skrevet din side",
    "app.case.stepYouNote": "Forseglet fram til dommen",
    "app.case.stepThem": "{name} skriver sin",
    "app.case.stepThemAnon": "Den andre skriver sin",
    "app.case.stepThemNote": "Siden oppdateres når svaret er inne",
    "app.case.stepJudges": "Tre dommere avgjør",
    "app.case.stepJudgesNote": "Eller få en dom nå bare på din side",
    "app.case.judgeNowWithout": "Døm nå uten {name}",
    "app.verdict.vs": "mot",
    "app.verdict.leanTo": "Dommerne heller mot {name}",
    "app.verdict.leanNone": "Dommerne heller ikke mot noen av sidene",
    "app.verdict.sides": "Hva hver side bygger på",
    "app.verdict.claims": "Hvordan hver side kom fram til det",
    "app.verdict.back": "Dom",
    "app.appeal.title": "Legg til kontekst og anke",
    "app.appeal.placeholder":
      "Hva gikk dommerne glipp av? Et faktum, en melding eller hva dere faktisk ble enige om.",
    "app.appeal.cost":
      "Koster 1 dom. Du kan gjøre dette to ganger per dom ({left} igjen).",
    "app.appeal.costCase": "Koster 1 dom. Du kan gjøre dette én gang per sak.",
    "app.appeal.submit": "Døm på nytt",
    "app.appeal.upsell":
      "Mangler noe? Legg til kontekst og få saken dømt på nytt for 1 dom.",
    "app.appeal.signIn": "Logg inn for å legge til kontekst og anke",
    "app.appeal.used": "Du har allerede lagt til kontekst i denne saken.",
    "app.appeal.limit":
      "Du har lagt til kontekst to ganger. Det er grensen for én dom.",
    "app.purchase.buying": "Kjøper…",
    "app.purchase.success": "Takk! Kjøpet er gjennomført.",
    "app.purchase.pending":
      "Kjøpet behandles. Det kan ta et minutt før det dukker opp.",
    "app.purchase.arriving": "Kredittene dine er på vei…",
    "app.purchase.slow": "Det kan ta et minutt før det dukker opp her.",
    "app.purchase.failed": "Kjøpet gikk ikke gjennom. Prøv igjen om litt.",
    "app.purchase.restore": "Gjenopprett kjøp",
    "app.purchase.restoreDone": "Kjøpene dine er gjenopprettet.",
    "app.purchase.restoreNone": "Fant ingen kjøp å gjenopprette.",
    "app.signin.legal": "En ekstern KI leser diskusjonene dine. Ved å fortsette godtar du ",
    "app.signin.legalTerms": "bruksvilkårene",
    "app.signin.legalAnd": " og ",
    "app.signin.legalPrivacy": "personvernerklæringen",
    "app.signin.legalAfter": ".",
    "app.legal.terms": "Bruksvilkår",
    "app.legal.privacy": "Personvernerklæring",
    "app.pricing.autoRenew":
      "Månedsabonnementet fornyes automatisk hver måned til du sier det opp i abonnementsinnstillingene på telefonen.",
    "app.age.checkbox": "Jeg er 18 år eller eldre",
    "app.age.title": "Bekreft alderen din",
    "app.age.lead": "Judge er for voksne. Bekreft at du er 18 år eller eldre for å fortsette å bruke appen.",
    "app.age.continue": "Fortsett",
    "app.age.required": "Bekreft at du er 18 år eller eldre for å fortsette.",
    "app.age.blockedTitle": "Judge er bare for voksne",
    "app.age.blockedBody":
      "Du må være 18 år eller eldre for å bruke Judge. Hvis du tror dette er en feil, skriv til oss på {email}.",
  },
  plurals: {
    "app.balance.left": { one: "{n} dom igjen" },
    "app.history.selected": { one: "{n} valgt" },
    "app.history.deleteConfirm": {
      one: "Vil du slette denne dommen fra telefonen? Delingslenken virker fortsatt.",
    },
    "app.history.removeConfirm": {
      one: "Vil du fjerne denne dommen fra kontoen din? Det du skrev og navnene slettes, og delingslenken slutter å virke på alle enheter. Dette kan ikke angres.",
    },
    "app.history.phoneOnlyAlso": {
      one: "1 dom som bare er lagret på denne telefonen, slettes herfra. Delingslenken virker fortsatt.",
    },
    "app.history.removeFailed": { one: "Vi fikk ikke fjernet den. Sjekk tilkoblingen og prøv igjen." },
  },
};

export default nb;
